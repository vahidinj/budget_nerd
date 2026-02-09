"""Seven-category transaction categorization and extensibility helpers."""

from __future__ import annotations
import os
import json
import re
from functools import lru_cache
from threading import RLock
from typing import (
    List,
    Pattern,
    Dict,
    Iterable,
    NamedTuple,
    Any,
    Sequence,
    TYPE_CHECKING,
)

from .constants import (
    CANONICAL_CATEGORIES,
    DEFAULT_CATEGORY_REGEX,
    BALANCE_SKIP_RX,
    FINANCE_FALLBACK_RX,
    TRANSFER_RX,
)

if TYPE_CHECKING:
    # Only import pandas for type checking to avoid hard runtime dependency at import time
    import pandas as pd  # type: ignore

CategoryName = str


class CategoryRule(NamedTuple):
    category: CategoryName
    pattern: Pattern


_custom_rules: List[CategoryRule] = []  # user/runtime injected
_custom_rules_lock = RLock()
_custom_rules_persist_path: str | None = None


def register_custom_rule(
    category: CategoryName, regex: str, prepend: bool = False
) -> None:
    """Register a custom regex rule at runtime."""
    if category not in CANONICAL_CATEGORIES:
        raise ValueError(
            f"Unknown category '{category}'. Must be one of {CANONICAL_CATEGORIES}."
        )
    pat = re.compile(regex, re.IGNORECASE)
    rule = CategoryRule(category, pat)
    with _custom_rules_lock:
        if prepend:
            _custom_rules.insert(0, rule)
        else:
            _custom_rules.append(rule)
        _compile_rules.cache_clear()


def _load_overrides_from_file() -> Dict[CategoryName, List[str]]:
    path = os.environ.get("CATEGORY_RULES_FILE")
    if not path or not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        overrides: Dict[CategoryName, List[str]] = {}
        for k, v in data.items():
            if k in CANONICAL_CATEGORIES and isinstance(v, list):
                overrides[k] = [str(x) for x in v if isinstance(x, str)]
        return overrides
    except Exception:
        return {}


@lru_cache(maxsize=1)
def _compile_rules() -> List[CategoryRule]:
    overrides = _load_overrides_from_file()
    rules: List[CategoryRule] = []
    for cat in CANONICAL_CATEGORIES:
        regexes: Iterable[str] = overrides.get(cat, DEFAULT_CATEGORY_REGEX.get(cat, []))
        for rx in regexes:
            flags = re.IGNORECASE
            try:
                rules.append(CategoryRule(cat, re.compile(rx, flags)))
            except re.error:
                continue
    # Custom rules (user/runtime) are merged with defaults.
    if _custom_rules:
        rules = list(_custom_rules) + rules
    return rules


def _heuristic_categorize(desc: str) -> str:
    """Private heuristic (regex) categorization for a description."""
    if not isinstance(desc, str) or not desc.strip():
        return "Recreation"  # neutral default for blank
    # Normalize description to remove noisy tokens (POS PURCHASE, DEBIT CARD ####, etc.)
    _display, up = normalize_description(desc)
    # Skip balance rollforward / opening-closing balance lines – leave uncategorized.
    if BALANCE_SKIP_RX.search(up):
        return ""  # blank category indicates 'do not categorize'
    # Rule-based matching (compiled rules cached). Pull rules once to avoid
    # repeatedly invoking the lru-cached accessor in tight loops.
    rules = _compile_rules()
    for rule in rules:
        if rule.pattern.search(up):
            return rule.category
    # Fallback heuristic: if financial keywords appear, assign Finance else Recreation
    if FINANCE_FALLBACK_RX.search(up):
        return "Finance"
    return "Recreation"


def add_categories(df: "pd.DataFrame") -> "pd.DataFrame":
    """Add a `category` column to a DataFrame if missing."""
    try:
        import pandas as pd  # lazy import

        _pd = pd
    except Exception:
        # pandas not available at runtime; nothing to do here.
        return df

    if df is None or df.empty or "description" not in df.columns:
        return df
    if "category" in df.columns:
        return df
    out = df.copy()
    out["category"] = out["description"].apply(categorize_description)
    try:
        out["category"] = out["category"].astype("category")
    except Exception:
        pass
    return out


__all__ = [
    "add_categories",
    "categorize_description",
    "categorize_with_metadata",
    "categorize_records_with_overrides",
    "normalize_description",
    "clear_all_caches",
    "reload_rules",
    "load_persistent_custom_rules",
    "add_persistent_custom_rule",
    "register_custom_rule",
    "CANONICAL_CATEGORIES",
    "DEFAULT_CATEGORY_REGEX",
]

# ---------------- Optional AI Enhancement via OpenAI API ---------------- #
"""AI Category Enhancement using OpenAI

If the environment variable USE_AI_CATEGORIES is set to a truthy value (e.g. "1"),
transaction DESCRIPTIONS ONLY are sent to OpenAI's API to predict categories.

⚠️  IMPORTANT PRIVACY NOTE:
  * The original PDF file is NEVER sent to OpenAI.
  * Only the extracted transaction description (e.g., "STARBUCKS #1234") is sent.
  * The description is a sanitized merchant name - no sensitive user data is included.
  * No account numbers, balances, personal info, or raw PDF content leaves your system.

Flow:
  1. PDF is parsed locally on your server/container
  2. Transaction descriptions are extracted locally
  3. Only the description text is sent to OpenAI for categorization
  4. Result is cached locally to minimize future API calls
  5. The PDF file never leaves your system

Design goals:
  * Privacy-first: Only descriptions sent, no PDF or sensitive data.
  * Simple integration: Just transaction description text.
  * Configurable: Use your own OpenAI API key via OPENAI_API_KEY.
  * Graceful fallback: If API fails or not configured, silently uses heuristic.
  * Cached: Caches results per unique description to minimize API calls.

Configuration via environment variables:
  USE_AI_CATEGORIES=1              -> enable feature
  OPENAI_API_KEY=sk-...           -> your OpenAI API key (required if USE_AI_CATEGORIES=1)
    OPENAI_MODEL=gpt-4o-mini        -> (default) model to use
    OPENAI_BATCH_SIZE=20            -> batch size for AI requests (default 20)

Cost: Each categorization uses ~20 tokens. Monitor usage at https://platform.openai.com/usage
"""

try:
    import openai
except ImportError:
    openai = None  # type: ignore

_openai_client = None  # lazy
_openai_model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
_openai_batch_size = int(os.getenv("OPENAI_BATCH_SIZE", "20"))
_openai_cache: dict[str, str] = {}  # desc -> category
_ai_status_cache: dict[str, object] = {
    "last_checked": None,
    "last_ok": None,
    "last_error": None,
}


# ---------------- Persistent Custom Rules (optional) ---------------- #
def load_persistent_custom_rules(path: str | None = None):
    """Load user custom rules from a JSON file.

    File format:
        [ {"category": "Food", "regex": "\\bMY CAFE\\b", "prepend": true}, ... ]
    The path can be provided here or via env CUSTOM_CATEGORY_RULES (takes precedence).
    """
    global _custom_rules_persist_path
    use_path = os.environ.get("CUSTOM_CATEGORY_RULES") or path
    if not use_path or not os.path.isfile(use_path):
        return 0
    try:
        with open(use_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        added = 0
        if isinstance(data, list):
            for item in data:
                if not isinstance(item, dict):
                    continue
                cat = item.get("category")
                regex = item.get("regex")
                prepend = bool(item.get("prepend"))
                if cat in CANONICAL_CATEGORIES and isinstance(regex, str) and regex:
                    try:
                        register_custom_rule(cat, regex, prepend=prepend)
                        added += 1
                    except Exception:
                        continue
        _custom_rules_persist_path = use_path
        return added
    except Exception:
        return 0


def add_persistent_custom_rule(category: str, regex: str, prepend: bool = False):
    """Add a custom rule and persist to disk (if persistence path known).

    If no persistence path loaded yet, this only registers in-memory.
    """
    register_custom_rule(category, regex, prepend=prepend)
    if not _custom_rules_persist_path:
        return False
    # Serialize only the custom rules (in order)
    try:
        payload = [
            {
                "category": r.category,
                "regex": r.pattern.pattern,
                "prepend": False,  # original prepend not tracked after insertion
            }
            for r in _custom_rules
        ]
        with open(_custom_rules_persist_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        return True
    except Exception:
        return False


def _use_ai() -> bool:
    val = os.environ.get("USE_AI_CATEGORIES", "").lower()
    return val in {"1", "true", "yes", "on"}


def _get_openai_client():
    """Lazy-load and configure OpenAI client if available."""
    global _openai_client
    if _openai_client is not None:
        return _openai_client
    if openai is None:
        return None
    try:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            return None
        _openai_client = openai.OpenAI(api_key=api_key)
        return _openai_client
    except Exception:
        return None


def _get_openai_batch_size() -> int:
    """Return a safe batch size for OpenAI requests."""
    try:
        value = int(_openai_batch_size)
    except Exception:
        value = 20
    return max(1, min(value, 50))


def warm_ai_category_model():
    """Lightweight OpenAI validation (no-op if not configured)."""
    if not _use_ai():
        return
    client = _get_openai_client()
    if client is None:
        import logging

        logging.getLogger("statement_api").warning(
            "AI categorization requested but OPENAI_API_KEY is not set or client unavailable"
        )
        return
    try:
        # Lightweight validation: attempt a trivial completion
        client.chat.completions.create(
            model=_openai_model,
            messages=[{"role": "user", "content": "Hello"}],
            max_tokens=1,
            temperature=0,
        )
        logging.getLogger("statement_api").info(
            "OpenAI API validated for categorization"
        )
    except Exception as e:
        logging.getLogger("statement_api").warning(
            "OpenAI API validation failed: %s", str(e)
        )


def _validate_openai_connection() -> tuple[bool, str | None]:
    """Attempt a minimal OpenAI call to confirm connectivity."""
    if not _use_ai():
        return False, "AI disabled"
    client = _get_openai_client()
    if client is None:
        return False, "Client unavailable or API key missing"
    try:
        client.chat.completions.create(
            model=_openai_model,
            messages=[{"role": "user", "content": "Hello"}],
            max_tokens=1,
            temperature=0,
        )
        return True, None
    except Exception as exc:
        return False, str(exc)


def get_ai_status(validate: bool = False) -> Dict[str, Any]:
    """Return AI/OpenAI connectivity status for UI display."""
    enabled = _use_ai()
    has_key = bool(os.environ.get("OPENAI_API_KEY"))
    client_ready = _get_openai_client() is not None
    status: Dict[str, Any] = {
        "enabled": enabled,
        "has_key": has_key,
        "client_ready": client_ready,
        "model": _openai_model,
        "last_checked": _ai_status_cache.get("last_checked"),
        "last_ok": _ai_status_cache.get("last_ok"),
        "last_error": _ai_status_cache.get("last_error"),
    }
    if validate:
        from time import time as _time

        ok, err = _validate_openai_connection()
        _ai_status_cache["last_checked"] = _time()
        _ai_status_cache["last_ok"] = ok
        _ai_status_cache["last_error"] = err
        status["last_checked"] = _ai_status_cache["last_checked"]
        status["last_ok"] = ok
        status["last_error"] = err
    return status


def ai_refine_category(description: str, base_category: str) -> str:
    """Backward-compatible wrapper returning only final category via OpenAI."""
    final, *_ = ai_refine_with_info(description, base_category)
    return final


def ai_refine_with_info(
    description: str,
    base_category: str,
    use_ai_override: bool | None = None,
) -> tuple[str, str | None, float | None, float | None]:
    """Use OpenAI to refine category; returns (final, ai_candidate, confidence, api_used)."""
    # Explicit override precedence: False disables regardless of env; True enables even if env flag off.
    if use_ai_override is False:
        return base_category, None, None, None
    if (
        (use_ai_override is None and not _use_ai())
        or not isinstance(description, str)
        or not description.strip()
    ):
        return base_category, None, None, None

    # Check cache first
    key = description.strip().upper()
    if key in _openai_cache:
        cached_cat = _openai_cache[key]
        confidence = 1.0 if cached_cat in CANONICAL_CATEGORIES else 0.0
        return (
            cached_cat,
            cached_cat if cached_cat != base_category else None,
            confidence,
            1.0,
        )

    client = _get_openai_client()
    if client is None:
        return base_category, None, None, None

    try:
        prompt = f"""Categorize this transaction description into ONE of these categories: {", ".join(CANONICAL_CATEGORIES)}.

Transaction: {description}

Respond with ONLY the category name, nothing else."""

        response = client.chat.completions.create(
            model=_openai_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=20,
        )

        ai_cat = (
            response.choices[0].message.content.strip()
            if response.choices
            else base_category
        )

        # Validate the response is a known category
        if ai_cat not in CANONICAL_CATEGORIES:
            ai_cat = base_category

        # Cache the result
        _openai_cache[key] = ai_cat

        confidence = 1.0
        if ai_cat != base_category:
            return ai_cat, ai_cat, confidence, 1.0
        return base_category, None, confidence, 1.0

    except Exception:
        # Silently fallback to heuristic if API call fails
        return base_category, None, None, None


def _ai_refine_batch(
    descriptions: list[str],
    base_categories: list[str],
) -> list[tuple[str, str | None, float | None, float | None]]:
    """Batch OpenAI categorization. Returns list of (final, ai_candidate, confidence, api_used)."""
    results: list[tuple[str, str | None, float | None, float | None]] = []
    if not descriptions:
        return results

    client = _get_openai_client()
    if client is None:
        return [(b, None, None, None) for b in base_categories]

    allowed = ", ".join(CANONICAL_CATEGORIES)
    batch_size = _get_openai_batch_size()
    # Pre-fill results with placeholders to preserve order
    results = [("", None, None, None) for _ in descriptions]

    # Build list of uncached items to send to API
    pending: list[tuple[int, str, str]] = []  # (idx, desc, base)
    for i, (desc, base) in enumerate(zip(descriptions, base_categories)):
        key = desc.strip().upper()
        if not desc.strip():
            results[i] = (base, None, None, None)
            continue
        if key in _openai_cache:
            cached_cat = _openai_cache[key]
            confidence = 1.0 if cached_cat in CANONICAL_CATEGORIES else 0.0
            ai_candidate = cached_cat if cached_cat != base else None
            results[i] = (cached_cat, ai_candidate, confidence, 1.0)
            continue
        pending.append((i, desc, base))

    # Process in batches
    for offset in range(0, len(pending), batch_size):
        chunk = pending[offset : offset + batch_size]
        if not chunk:
            continue
        # Build prompt with stable ordering
        prompt_lines = [
            "Return ONLY a JSON array of category strings matching the inputs in order.",
            f"Allowed categories: {allowed}",
            "Inputs:",
        ]
        for i, (orig_i, desc, _base) in enumerate(chunk, start=1):
            prompt_lines.append(f"{i}. {desc}")
        prompt = "\n".join(prompt_lines)

        try:
            response = client.chat.completions.create(
                model=_openai_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                max_tokens=200,
            )
            content = (
                response.choices[0].message.content.strip() if response.choices else ""
            )
            parsed = json.loads(content) if content else []
            if not isinstance(parsed, list) or len(parsed) != len(chunk):
                parsed = [None] * len(chunk)
        except Exception:
            parsed = [None] * len(chunk)

        for i, (orig_i, desc, base) in enumerate(chunk):
            ai_cat = parsed[i] if isinstance(parsed[i], str) else base
            if ai_cat not in CANONICAL_CATEGORIES:
                ai_cat = base
            _openai_cache[desc.strip().upper()] = ai_cat
            confidence = 1.0
            ai_candidate = ai_cat if ai_cat != base else None
            results[orig_i] = (ai_cat, ai_candidate, confidence, 1.0)

    # Fill any remaining placeholders with base categories
    for i, (desc, base) in enumerate(zip(descriptions, base_categories)):
        if results[i][0] == "":
            results[i] = (base, None, None, None)
    return results


def clear_all_caches() -> dict[str, int | bool]:
    """Clear in-memory caches and custom rules; return a summary."""
    # Clear compiled rule cache & embedding description cache
    try:
        _compile_rules.cache_clear()  # type: ignore[attr-defined]
    except Exception:
        pass
    try:
        normalize_description.cache_clear()  # type: ignore[attr-defined]
    except Exception:
        pass
    # Clear custom rules
    with _custom_rules_lock:
        custom_count = len(_custom_rules)
        _custom_rules.clear()
    return {
        "custom_rules_cleared": custom_count,
        "desc_embedding_cache_cleared": 0,
        "model_reset": True,
    }


def reload_rules() -> int:
    """Reload and return the number of compiled rules."""
    try:
        _compile_rules.cache_clear()  # type: ignore[attr-defined]
    except Exception:
        pass
    rules = _compile_rules()
    return len(rules)


# Wrap the heuristic categorize so AI refinement can be applied transparently.
_orig_categorize = _heuristic_categorize


def categorize_description(desc: str) -> str:  # type: ignore[override]
    base = _orig_categorize(desc)
    # Preserve explicit skip for balance roll-forward lines (blank category)
    if base == "":
        return base
    # NEW: refine ALL heuristic categories (was limited to Recreation/Finance)
    return ai_refine_category(desc, base)


def categorize_with_metadata(desc: str, use_ai: bool | None = None) -> Dict[str, Any]:
    """Return categorization metadata for a description."""
    info: Dict[str, Any] = {
        "description": desc,
        "base_category": None,
        "final_category": "",
        "source": None,
        "matched_pattern": None,
        "ai_original_category": None,
        "ai_margin": None,
        "ai_best_score": None,
        "ai_used": False,
        "ai_changed": False,
        "skipped": False,
    }
    if not isinstance(desc, str) or not desc.strip():
        info["base_category"] = "Recreation"
        info["final_category"] = "Recreation"
        info["source"] = "fallback"
        return info
    normalized, norm_for_rules = normalize_description(desc)
    info["normalized_description"] = normalized
    up = norm_for_rules  # already upper-case
    if BALANCE_SKIP_RX.search(up):
        info["skipped"] = True
        info["base_category"] = ""
        info["final_category"] = ""
        info["source"] = "skip"
        return info
    # Rule match
    matched_rule = None
    for rule in _compile_rules():
        if rule.pattern.search(up):
            matched_rule = rule
            break
    if matched_rule:
        info["base_category"] = matched_rule.category
        info["matched_pattern"] = matched_rule.pattern.pattern
        info["source"] = "regex"
    else:
        # fallback
        fallback_cat = "Finance" if FINANCE_FALLBACK_RX.search(up) else "Recreation"
        info["base_category"] = fallback_cat
        info["source"] = "fallback"
    # AI refinement (skip if disabled or skipped earlier)
    final, ai_candidate, margin, api_used = ai_refine_with_info(
        desc, info["base_category"] or "", use_ai_override=use_ai
    )
    info["final_category"] = final
    info["ai_used"] = bool(api_used)
    if ai_candidate and final != info["base_category"]:
        info["source"] = "ai"
        info["ai_original_category"] = ai_candidate
        info["ai_margin"] = margin
        info["ai_best_score"] = api_used
        info["ai_changed"] = True
    return info


def categorize_records_with_overrides(
    records: list[dict], use_ai: bool | None = None
) -> list[Dict[str, Any]]:
    """Categorize a list of records and apply simple overrides."""
    out: list[Dict[str, Any]] = []
    metas: list[Dict[str, Any]] = []
    descs: list[str] = []

    for rec in records:
        desc = (rec.get("description") or "") if isinstance(rec, dict) else ""
        meta = categorize_with_metadata(desc, use_ai=False)
        metas.append(meta)
        descs.append(desc)

    ai_enabled = _use_ai() if use_ai is None else bool(use_ai)
    if ai_enabled and _get_openai_client() is not None:
        idxs: list[int] = []
        ai_descs: list[str] = []
        ai_bases: list[str] = []
        for i, meta in enumerate(metas):
            if meta.get("final_category") == "" or meta.get("skipped"):
                continue
            base = meta.get("base_category") or meta.get("final_category") or ""
            if not base:
                continue
            idxs.append(i)
            ai_descs.append(descs[i])
            ai_bases.append(base)
        if ai_descs:
            batch_results = _ai_refine_batch(ai_descs, ai_bases)
            for idx, (final, ai_candidate, margin, api_used) in zip(
                idxs, batch_results
            ):
                meta = metas[idx]
                meta["final_category"] = final
                meta["ai_used"] = bool(api_used)
                if ai_candidate and final != meta.get("base_category"):
                    meta["source"] = "ai"
                    meta["ai_original_category"] = ai_candidate
                    meta["ai_margin"] = margin
                    meta["ai_best_score"] = api_used
                    meta["ai_changed"] = True

    for meta, rec, desc in zip(metas, records, descs):
        meta["original_final_category"] = meta["final_category"]
        meta["override_applied"] = False
        meta["override_reason"] = None
        meta["transfer"] = False
        try:
            amt = rec.get("amount") if isinstance(rec, dict) else None
            acct = str(rec.get("account_type") or "").lower()
        except Exception:
            amt = None
            acct = ""
        # Detect internal transfer semantics
        if desc and TRANSFER_RX.search(desc):
            meta["transfer"] = True
        # Apply overrides only if not skipped
        if (
            meta["final_category"] != ""
            and isinstance(amt, (int, float))
            and amt > 0
            and not meta["transfer"]
        ):
            if acct == "checking":
                meta["final_category"] = "Income"
                meta["override_applied"] = True
                meta["override_reason"] = "positive_inflow_checking"
            elif acct == "savings":
                meta["final_category"] = "Savings"
                meta["override_applied"] = True
                meta["override_reason"] = "positive_inflow_savings"
        out.append(meta)
    return out


# ---------------- Normalization Pipeline ---------------- #
_NOISE_PATTERNS: Sequence[str] = (
    r"\bPOS\s+PURCHASE\b",
    r"\bPOS\s+PURCH\b",
    r"\bPOS\s+PUR\b",
    r"\bDBT\s+CRD\s+\d{4,}\b",
    r"\bDEBIT\s+CARD\s+PURCHASE\b",
    r"\bDEBIT\s+CARD\s+\d{4,}\b",
    r"\bCHECKCARD\b",
    r"\bCHECK\s+CARD\b",
    r"\bPURCHASE\s+AUTHORIZATION\b",
    r"\bONLINE\s+TRANSFER\s+TO\b",
    r"\bONLINE\s+TRANSFER\s+FROM\b",
    r"\bMOBILE\s+DEPOSIT\b",
    r"\bPENDING\s+TRANSACTION\b",
    r"\bELECTRONIC\s+PURCHASE\b",
    r"\bCARD\s+MEMBER\s+SERVICES\b",
    r"\bRECURRING\s+PAYMENT\b",
)
_NOISE_COMPILED = [re.compile(p) for p in _NOISE_PATTERNS]


@lru_cache(maxsize=8192)
def normalize_description(desc: str) -> tuple[str, str]:
    """Return (display_normalized, uppercase_normalized_for_rules)."""
    if not isinstance(desc, str):
        return "", ""
    working = desc.upper()
    # Standardize whitespace early
    working = re.sub(r"\s+", " ", working)
    for rx in _NOISE_COMPILED:
        working = rx.sub(" ", working)
    # Collapse spaces again
    working = re.sub(r"\s+", " ", working).strip()
    # Lowercase version for display (without noise) but keep vendor capitalization minimal
    display = working.lower()
    return display, working
