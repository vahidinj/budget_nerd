"""Statement parser FastAPI service."""

from __future__ import annotations

from tempfile import SpooledTemporaryFile
from typing import Any, Dict, List, Optional
from time import time

from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import JSONResponse

import logging
import os
import traceback
import re

from .pdf_parser import parse_bank_statement, compute_balance_mismatches
from .categorize import (
    warm_ai_category_model,
    categorize_records_with_overrides,
    load_persistent_custom_rules,
    add_persistent_custom_rule,
    clear_all_caches,
    CANONICAL_CATEGORIES,
    get_ai_status,
)
from pydantic import BaseModel
from collections import deque
from .utils import df_to_records
import signal


# ---------------- Telemetry / Categorization endpoints ---------------- #
TELEMETRY_MAX_EVENTS = 500
MAX_META_STR_LEN = 256  # avoid storing arbitrarily large user-provided strings
_telemetry_events: deque[Dict[str, Any]] = deque(maxlen=TELEMETRY_MAX_EVENTS)


def _telemetry_enabled() -> bool:
    return False


def record_event(name: str, meta: Optional[Dict[str, Any]] = None):
    if not _telemetry_enabled():
        return
    safe_meta: Dict[str, Any] = {}
    if isinstance(meta, dict):
        for k, v in meta.items():
            if isinstance(v, (int, float, str, bool)):
                if isinstance(v, str) and len(v) > MAX_META_STR_LEN:
                    safe_meta[k] = v[:MAX_META_STR_LEN] + "…"
                else:
                    safe_meta[k] = v
    _telemetry_events.append({"ts": time(), "event": name, "meta": safe_meta or None})


# Simple in-memory upload rate limiting (per-IP)
_UPLOAD_RATE_WINDOW = int(os.getenv("UPLOAD_RATE_WINDOW", 3600))  # seconds
_UPLOAD_RATE_LIMIT = int(os.getenv("UPLOADS_PER_WINDOW", 10))
_upload_rate_map: dict[str, deque[float]] = {}


def _check_upload_rate(req: Request) -> None:
    try:
        ip = req.client.host if getattr(req, "client", None) else "unknown"
    except Exception:
        ip = "unknown"
    now = time()
    q = _upload_rate_map.get(ip)
    if q is None:
        q = deque()
        _upload_rate_map[ip] = q
    # prune
    while q and (now - q[0]) > _UPLOAD_RATE_WINDOW:
        q.popleft()
    if len(q) >= _UPLOAD_RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Rate limit exceeded for uploads")
    q.append(now)


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


logger = logging.getLogger("statement_api")
logger.setLevel(os.getenv("API_LOG_LEVEL", "INFO"))

app = FastAPI(title="Statement Parser API", version="0.1.0")
app.add_middleware(GZipMiddleware, minimum_size=1024)


# -------- Admin Authentication -------- #
def require_admin_token(request: Request) -> bool:
    """Validate admin token for protected endpoints."""
    require = os.getenv("REQUIRE_ADMIN", "1").lower() in {"1", "true", "yes", "on"}
    if not require:
        return True

    expected_token = os.getenv("ADMIN_TOKEN")
    if not expected_token:
        logger.warning("REQUIRE_ADMIN=1 but ADMIN_TOKEN not set. Blocking access.")
        raise HTTPException(status_code=503, detail="Admin token not configured")

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=401, detail="Missing or invalid Authorization header"
        )

    token = auth_header[7:]
    if not token or token != expected_token:
        raise HTTPException(status_code=403, detail="Invalid admin token")
    return True


# ------------------ Rate limiting (optional) ------------------ #
# Prefer an industry package (slowapi) when available; fall back to no-op decorators.
try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded
    from slowapi.middleware import SlowAPIMiddleware

    limiter = Limiter(key_func=get_remote_address)
    # Install middleware/exception handler (best-effort)
    try:
        app.state.limiter = limiter
        app.add_middleware(SlowAPIMiddleware)
        from slowapi import _rate_limit_exceeded_handler

        app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    except Exception:
        # If middleware registration fails, continue with limiter available
        pass

    def rate_limit(limit_str: str):
        def _decorator(f):
            return limiter.limit(limit_str)(f)

        return _decorator
except Exception:
    limiter = None

    def rate_limit(limit_str: str):
        def _decorator(f):
            return f

        return _decorator


def _sanitize_filename(fn: str | None) -> str:
    """Sanitize filename to prevent path traversal and XSS."""
    if not fn:
        return "statement"
    # Strip any path components
    fn = fn.split("/")[-1].split("\\")[-1]
    # Replace unsafe chars
    fn = re.sub(r"[^\w\-\. ]", "_", fn)
    fn = fn.strip(".")
    return fn[:100] or "statement"


def _test_regex_safety(
    pattern: str, test_string: str = "a" * 2000, timeout: float = 0.1
) -> bool:
    """Run a regex against a long string with a short timeout; return False on timeout or compile error."""

    def _raise_timeout(signum, frame):
        raise TimeoutError()

    try:
        comp = re.compile(pattern, re.IGNORECASE)
    except re.error:
        return False
    old = signal.getsignal(signal.SIGALRM)
    try:
        signal.signal(signal.SIGALRM, _raise_timeout)
        signal.setitimer(signal.ITIMER_REAL, timeout)
        try:
            comp.search(test_string)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
    except TimeoutError:
        return False
    finally:
        signal.signal(signal.SIGALRM, old)
    return True


local_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
prod_origins = ["https://www.mybudgetnerd.com", "https://mybudgetnerd.com"]

# Allow additional origins via environment variable `API_CORS_ORIGINS` (comma-separated)
env_extra = os.getenv("API_CORS_ORIGINS", "")
extra_origins = [x.strip() for x in env_extra.split(",") if x.strip()]


api_env = "production"
if api_env == "production":
    origins = prod_origins + extra_origins
    allow_credentials = True
else:
    origins = local_origins
    allow_credentials = False

# (Removed duplicate GZip registration; already added once above)

try:
    from starlette.middleware.proxy_headers import (
        ProxyHeadersMiddleware as _ProxyHeadersMiddleware,
    )
except ImportError:
    _ProxyHeadersMiddleware = None

if _ProxyHeadersMiddleware is not None:
    app.add_middleware(_ProxyHeadersMiddleware)

env_trusted = os.getenv("API_TRUSTED_HOSTS", "")
trusted = [h.strip() for h in env_trusted.split(",") if h.strip()]
if not trusted:
    trusted = ["mybudgetnerd.com", "www.mybudgetnerd.com", "localhost"]
if api_env == "production":
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=trusted)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- Security Headers Middleware ---------------- #
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add minimal security headers to responses."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        if api_env == "production":
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=63072000; includeSubDomains; preload",
            )
        return response


app.add_middleware(SecurityHeadersMiddleware)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "statement-parser", "status": "ok"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health-eb")
def health_eb() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ai/status")
def ai_status(validate: bool = False) -> dict[str, Any]:
    """Return AI/OpenAI connectivity status for UI indicator."""
    return get_ai_status(validate=validate)


# ------------------------- Warm-up Endpoint ------------------------- #
_WARMED = False
_WARMED_AT: float | None = None


@app.get("/warmup")
def warmup():  # pragma: no cover - simple performance helper
    """Prime heavy libraries on first call."""
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


MAX_FILE_BYTES = int(os.getenv("MAX_FILE_BYTES", 15 * 1024 * 1024))  # 15MB default
MAX_PARSE_TRANSACTIONS = int(os.getenv("MAX_PARSE_TRANSACTIONS", "5000"))
SHOW_UNPARSED_SAMPLE = os.getenv("SHOW_UNPARSED_SAMPLE", "1").lower() in {
    "1",
    "true",
    "yes",
    "on",
}


@rate_limit("10/hour")
@app.post("/parse")
async def parse_pdf(request: Request, file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    if file.content_type and file.content_type not in {
        "application/pdf",
        "application/octet-stream",
    }:
        # Some browsers may send octet-stream; allow that but reject clearly wrong types
        raise HTTPException(
            status_code=400, detail="Invalid content type; expected PDF"
        )
    # Rate limit uploads per IP to mitigate abuse
    _check_upload_rate(request)
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
    # Basic PDF magic number validation (%PDF-) to prevent obvious non-PDF uploads
    try:
        head = spooled.read(8)
        if b"%PDF" not in head:
            raise HTTPException(
                status_code=400, detail="File is not a valid PDF (missing signature)"
            )
        spooled.seek(0)
    except HTTPException:
        raise
    except Exception:
        spooled.seek(0)  # fall back; let downstream parser attempt
    # Only allow debug in non-production environments
    debug = api_env != "production" and (
        request.query_params.get("debug") == "1" or os.getenv("API_DEBUG") == "1"
    )
    try:
        # parse_bank_statement is CPU / IO bound — run off the event loop
        result = await run_in_threadpool(parse_bank_statement, spooled)
        if not isinstance(result, tuple) or len(result) != 3:
            raise RuntimeError("parse_bank_statement returned unexpected result")
        df, unparsed, raw_lines = result
    except Exception as e:  # pragma: no cover - defensive
        tb = traceback.format_exc()
        logger.error(
            "Parse failure for file %s (content_type=%s, size=%d): %s\n%s",
            getattr(file, "filename", None),
            getattr(file, "content_type", None),
            total,
            e,
            tb,
        )
        detail = {
            "error": "PARSE_FAILURE",
            "message": str(e),
            "file": _sanitize_filename(getattr(file, "filename", None)),
        }
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
    transactions = df_to_records(df)
    total_transactions = len(transactions)
    truncated = False
    if total_transactions > MAX_PARSE_TRANSACTIONS:
        transactions = transactions[:MAX_PARSE_TRANSACTIONS]
        truncated = True
    return {
        "fileName": _sanitize_filename(file.filename),
        "metrics": metrics,
        "transactions": transactions,
        "unparsed_sample": unparsed[:100] if SHOW_UNPARSED_SAMPLE else [],
        "raw_line_count": len(raw_lines),
        "balance_mismatches": mismatches,
        "total_transactions": total_transactions,
        "truncated": truncated,
        "max_transactions": MAX_PARSE_TRANSACTIONS,
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


@rate_limit("10/minute")
@app.get("/custom-rules")
def list_custom_rules(request: Request):
    # Inspect categorize module private rules for current state
    from .categorize import _custom_rules  # type: ignore

    # Require admin token to view custom rules
    require_admin_token(request)
    return {
        "count": len(_custom_rules),
        "rules": [
            {"category": r.category, "regex": r.pattern.pattern} for r in _custom_rules
        ],
        "categories": CANONICAL_CATEGORIES,
    }


@rate_limit("5/minute")
@app.post("/custom-rules")
def add_custom_rule(request: Request, rule: NewRule):
    # Require admin token
    require_admin_token(request)
    if rule.category not in CANONICAL_CATEGORIES:
        raise HTTPException(status_code=400, detail={"message": "Invalid category"})
    # Basic length check
    if not isinstance(rule.regex, str) or len(rule.regex) > 500:
        raise HTTPException(
            status_code=400, detail={"message": "Regex invalid or too long"}
        )
    # Reject unsafe regex patterns that trigger catastrophic backtracking
    if not _test_regex_safety(rule.regex):
        raise HTTPException(
            status_code=400,
            detail={"message": "Regex rejected as too complex or invalid"},
        )
    ok = add_persistent_custom_rule(
        rule.category, rule.regex, prepend=bool(rule.prepend)
    )
    return {"persisted": ok}


@rate_limit("1/minute")
@app.post("/clear-caches")
def clear_caches(request: Request):
    # Require admin token
    require_admin_token(request)
    try:
        summary = clear_all_caches()
        record_event("clear_caches", summary)
        return {"cleared": True, **summary}
    except Exception as e:
        logger.exception("clear_caches failed: %s", e)
        raise HTTPException(
            status_code=500, detail={"message": "Failed to clear caches"}
        )


# ---------------- Global Exception Handler ---------------- #
@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):  # type: ignore[override]
    logger.exception("Unhandled error: %s", exc)
    # Always return a generic message to avoid leaking implementation details.
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
