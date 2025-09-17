"""FastAPI service exposing PDF statement parsing for the React frontend.

Endpoints:
  POST /parse  (multipart/form-data: file=<pdf>) -> parsed transactions + metrics
  GET  /health -> simple health check

Run (dev): uvicorn api:app --reload --port 8000
"""

from __future__ import annotations

from tempfile import SpooledTemporaryFile
from typing import Any, Dict, List, Optional
from time import time

from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.concurrency import run_in_threadpool

import logging
import os
import traceback

from .pdf_parser import parse_bank_statement, compute_balance_mismatches
from .categorize import (
    warm_ai_category_model,
    categorize_records_with_overrides,
    load_persistent_custom_rules,
    add_persistent_custom_rule,
    clear_all_caches,
    CANONICAL_CATEGORIES,
)
from pydantic import BaseModel
from collections import deque
from .utils import df_to_records


# ---------------- Telemetry / Categorization endpoints ---------------- #
TELEMETRY_MAX_EVENTS = 500
_telemetry_events: deque[Dict[str, Any]] = deque(maxlen=TELEMETRY_MAX_EVENTS)


def _telemetry_enabled() -> bool:
    return os.environ.get("ENABLE_TELEMETRY", "").lower() in {"1", "true", "yes", "on"}


def record_event(name: str, meta: Optional[Dict[str, Any]] = None):
    if not _telemetry_enabled():
        return
    safe_meta: Dict[str, Any] = {}
    if isinstance(meta, dict):
        for k, v in meta.items():
            if isinstance(v, (int, float, str, bool)):
                safe_meta[k] = v
    _telemetry_events.append(
        {"ts": time.time(), "event": name, "meta": safe_meta or None}
    )


class CategorizeRecord(BaseModel):
    description: Optional[str] = None
    amount: Optional[float] = None
    account_type: Optional[str] = None


class CategorizeRequest(BaseModel):
    records: List[CategorizeRecord]
    use_ai: Optional[bool] = None


class CategorizeResponse(BaseModel):
    categories: List[str]
    metadata: List[dict]


logging.basicConfig(level=os.getenv("API_LOG_LEVEL", "INFO"))
logger = logging.getLogger("statement_api")

app = FastAPI(title="Statement Parser API", version="0.1.0")
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():  # simple root for quick manual test
    return {"service": "statement-parser", "status": "ok"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ------------------------- Warm-up Endpoint ------------------------- #
_WARMED = False
_WARMED_AT: float | None = None


@app.get("/warmup")
def warmup():  # pragma: no cover - simple performance helper
    """Lightweight endpoint to prime expensive imports / first-use costs.

    On first invocation it will run a trivial parse attempt against an empty
    in-memory file object (errors suppressed) so that heavy libraries
    (pdfplumber/pdfminer, pandas regex engines, etc.) are loaded before the
    user's real upload. Subsequent calls are fast and idempotent.
    """
    global _WARMED, _WARMED_AT
    already = _WARMED
    if not _WARMED:
        try:
            # Attempt a harmless parse with an empty spooled file to trigger
            # module-level lazy imports. Failures are ignored intentionally.
            from io import BytesIO

            bio = BytesIO(b"")
            try:
                parse_bank_statement(bio)
            except Exception:
                pass
        finally:
            _WARMED = True
            _WARMED_AT = time()
    return {
        "status": "warmed",
        "already": already,
        "warmed_at": _WARMED_AT,
        "pid": os.getpid(),
    }


@app.on_event("startup")
def _startup_tasks() -> None:
    """Warm optional AI model and load any persistent custom rules on startup."""
    try:
        warm_ai_category_model()
    except Exception:
        pass
    try:
        load_persistent_custom_rules()
    except Exception:
        pass


_df_to_records = df_to_records


MAX_FILE_BYTES = int(os.getenv("MAX_FILE_BYTES", 15 * 1024 * 1024))  # 15MB default


@app.post("/parse")
async def parse_pdf(request: Request, file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    # Size guard (read streamingly into spooled file)
    spooled: SpooledTemporaryFile[bytes] = SpooledTemporaryFile(
        max_size=MAX_FILE_BYTES + 1024
    )
    total = 0
    chunk_size = 1024 * 64
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_FILE_BYTES:
            spooled.close()
            raise HTTPException(
                status_code=413,
                detail=f"File too large (> {MAX_FILE_BYTES // (1024 * 1024)}MB)",
            )
        spooled.write(chunk)
    if total == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    spooled.seek(0)
    debug = request.query_params.get("debug") == "1" or os.getenv("API_DEBUG") == "1"
    try:
        # parse_bank_statement is CPU / IO bound — run off the event loop
        df, unparsed, raw_lines = await run_in_threadpool(parse_bank_statement, spooled)
    except Exception as e:  # pragma: no cover - defensive
        tb = traceback.format_exc()
        logger.error("Parse failure: %s\n%s", e, tb)
        detail = {"error": "PARSE_FAILURE", "message": str(e)}
        if debug:
            detail["traceback"] = tb
        raise HTTPException(status_code=500, detail=detail) from e
    # Optionally compute balance mismatches (can be expensive on large statements)
    mismatches_flag = request.query_params.get("mismatches") == "1"
    mismatches = (
        await run_in_threadpool(compute_balance_mismatches, df)
        if (mismatches_flag and df is not None)
        else []
    )
    amount_sum = (
        float(df["amount"].dropna().sum())
        if (df is not None and "amount" in df.columns)
        else 0.0
    )
    account_types_list = (
        sorted([a for a in df["account_type"].dropna().unique()])
        if (df is not None and "account_type" in df.columns)
        else []
    )
    metrics = {
        "transaction_count": int(len(df)) if df is not None else 0,
        "accounts": len(account_types_list),
        "net_amount": amount_sum,
    }
    if account_types_list:  # omit if empty to reduce payload
        metrics["account_types"] = account_types_list
    # record a lightweight telemetry event for successful parse (best-effort)
    record_event("parse_success", {"txns": metrics.get("transaction_count", 0)})
    return {
        "fileName": file.filename,
        "metrics": metrics,
        "transactions": _df_to_records(df),
        "unparsed_sample": unparsed[:100],
        "raw_line_count": len(raw_lines),
        "balance_mismatches": mismatches,
    }


# ------------------ Categorization & Rules Endpoints ------------------ #


@app.post("/categorize", response_model=CategorizeResponse)
def categorize(req: CategorizeRequest):
    recs = [r.dict() for r in req.records]
    meta = categorize_records_with_overrides(recs, use_ai=req.use_ai)
    cats = [m.get("final_category", "") for m in meta]
    record_event("categorize", {"rows": len(recs), "ai": bool(req.use_ai)})
    return CategorizeResponse(categories=cats, metadata=meta)


class NewRule(BaseModel):
    category: str
    regex: str
    prepend: Optional[bool] = False


@app.get("/custom-rules")
def list_custom_rules():
    # Inspect categorize module private rules for current state
    from .categorize import _custom_rules  # type: ignore

    return {
        "count": len(_custom_rules),
        "rules": [
            {"category": r.category, "regex": r.pattern.pattern} for r in _custom_rules
        ],
        "categories": CANONICAL_CATEGORIES,
    }


@app.post("/custom-rules")
def add_custom_rule(rule: NewRule):
    if rule.category not in CANONICAL_CATEGORIES:
        raise HTTPException(status_code=400, detail={"message": "Invalid category"})
    ok = add_persistent_custom_rule(
        rule.category, rule.regex, prepend=bool(rule.prepend)
    )
    return {"persisted": ok}


@app.post("/clear-caches")
def clear_caches():
    try:
        summary = clear_all_caches()
        record_event("clear_caches", summary)
        return {"cleared": True, **summary}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail={"message": f"Failed to clear caches: {e}"}
        )


# ------------------ Telemetry endpoints ------------------ #


@app.post("/telemetry")
def ingest_telemetry(event: dict):
    name = str(event.get("event") or "frontend_event")
    meta = event.get("meta") if isinstance(event.get("meta"), dict) else None
    record_event(name, meta)
    return {"accepted": True}


@app.get("/telemetry/recent")
def telemetry_recent(limit: int = 50):
    if not _telemetry_enabled():
        return {"enabled": False, "events": []}
    limit = max(1, min(limit, 200))
    events = list(_telemetry_events)[-limit:][::-1]
    return {"enabled": True, "count": len(events), "events": events}


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
