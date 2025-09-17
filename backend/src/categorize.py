"""Generic 7‑bucket transaction categorization.

Goal: collapse many granular vendor/style tags into the most common, broadly
useful personal finance groupings while remaining easily extensible.

Canonical categories (exactly seven):
  1. Housing          (mortgage, rent, home improvement)
  2. Transportation   (fuel, rideshare, transit, parking, auto loan)
  3. Food             (groceries + dining / restaurants)
  4. Utilities        (telecom, internet, electricity, water, core services)
  5. Health           (medical, pharmacy, insurance)
  6. Recreation       (shopping discretionary, entertainment, travel, subs)
  7. Finance          (income, transfers, refunds, fees, interest, charity, education, other financial adjustments)

Any description that does not match a rule falls back to "Finance" only if it
looks like a financial adjustment (ACH/TRANSFER/INT/REFUND etc.) else to
"Recreation" as the broad discretionary bucket; this keeps the count at seven.

Extensibility:
  * Environment variable CATEGORY_RULES_FILE (JSON) can supply overrides:
        { "Housing": ["REGEX1", "REGEX2"], ... }
    These replace (not merge) the default patterns for listed categories.
  * A helper `register_custom_rule(category, pattern, prepend=False)` allows
    runtime injection (e.g. UI-driven user tagging) without editing this file.
"""

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

if TYPE_CHECKING:
    # Only import pandas for type checking to avoid hard runtime dependency at import time
    import pandas as pd  # type: ignore

CategoryName = str

CANONICAL_CATEGORIES: List[CategoryName] = [
    "Housing",
    "Transportation",
    "Food",
    "Utilities",
    "Health",
    "Recreation",
    "Finance",
]


class CategoryRule(NamedTuple):
    category: CategoryName
    pattern: Pattern


_custom_rules: List[CategoryRule] = []  # user/runtime injected
_custom_rules_lock = RLock()
_custom_rules_persist_path: str | None = None

# Default vendor / keyword patterns grouped per canonical category.
DEFAULT_CATEGORY_REGEX: Dict[CategoryName, List[str]] = {
    "Housing": [
        r"\b(MORTGAGE|RENT|HOME ?LOAN|LOAN PAYMENT)\b",
        r"\b(LOWE'S|HOME DEPOT|MENARDS)\b",
        r"\b(HOA|PROPERTY TAX|APARTMENT|APT\b|LEASE PAYMENT)\b",
        r"\b(IKEA|WAYFAIR|OVERSTOCK|ASHLEY FURNITURE|FURNITURE)\b",
        r"\b(HVAC|PLUMB(ER|ING)|ELECTRICIAN|ROOF(ING)?|PEST CONTROL)\b",
        r"\b(LAWN CARE|LANDSCAPING|GARDEN CENTER|HOME IMPROVEMENT)\b",
        r"\b(SECURITY SYSTEM|ADT SECURITY|RING SUBSCRIPTION)\b",
    ],
    "Transportation": [
        r"\b(LYFT|UBER|METRO|SUBWAY|TRAIN|PARKING|TOLL)\b",
        r"\b(SHELL|EXXON|CHEVRON|BP|GAS STATION|FUEL)\b",
        r"\b(AUTO LOAN|CAR PAYMENT|CAR WASH)\b",
        r"\b(AUTOZONE|O'REILLY|ADVANCE AUTO|NAPA AUTO|AUTO PARTS)\b",
        r"\b(OIL CHANGE|MECHANIC|TIRES?|TIRE KING|DISCOUNT TIRE)\b",
        r"\b(U-?HAUL|RENTAL CAR|ENTERPRISE RENT|HERTZ|AVIS|BUDGET RENTAL)\b",
        r"\b(DMV|VEHICLE REG(ISTRATION)?|EMISSIONS TEST|SMOG CHECK)\b",
        r"\b(EV CHARGE|CHARGING STATION|SUPERCHARGER)\b",
        # Automotive finance / payment descriptors (e.g. "Chase Automotive Online Pmt")
        r"\b(CHASE AUTOMOTIVE|AUTOMOTIVE|AUTO FINANCE|AUTO PMT|AUTO PAYMENT)\b",
    ],
    "Food": [
        r"\b(WALMART|SAFEWAY|KROGER|WHOLE ?FOODS|TRADER JOE'S|ALDI|LIDL|PUBLIX)\b",
        r"\b(STARBUCKS|UBER EATS|DOORDASH|GRUBHUB|CAFE|DINER|PIZZA|CHIPOTLE|MCDONALD|BURGER KING|SUBWAY|TACO BELL|RESTAURANT)\b",
        r"\b(COSTCO|SAM'S CLUB|SAMS CLUB|BJ'S WHOLESALE|WHOLESALE CLUB)\b",
        r"\b(PANERA|WENDY'S|KFC|POPEYES|DOMINO'S|DOMINOS|DUNKIN|JIMMY JOHN'S)\b",
        r"\b(GROCERY|SUPERMARKET|MARKETPLACE|FARMERS MARKET)\b",
        r"\b(LIQUOR|WINERY|DISTILLERY|BEER STORE|ALCOHOL)\b",
        r"\b(INSTACART|MEAL KIT|BLUE APRON|HELLOFRESH|DOOR DASH)\b",
        r"\b(FRESH MARKET|D&W FRESH MARKET|D&W FRESH)\b",
        r"\b(MEIJER|H\.?E\.?B\.?|HEB|SHOPRITE|SHOP RITE|STOP ?& ?SHOP|FOOD LION)\b",
        r"\b(GIANT EAGLE|GIANT\b|HARRIS TEETER|SPROUTS|WINCO|RALPHS|KING SOOPERS)\b",
        r"\b(FRY'S FOOD|FRY'S|FRYS FOOD|JEWEL(?:-?OSCO)?|PIGGLY WIGGLY|MARKET BASKET|ALBERTSONS?)\b",
        r"\b(SPROUTS FARMERS MARKET|BUTCHER SHOP|DELI)\b",
    ],
    "Utilities": [
        r"\b(COMCAST|XFINITY|VERIZON|T-MOBILE|AT&T|ATT\b|ELECTRIC|UTILITY|WATER BILL|GAS BILL|INTERNET)\b",
        r"\b(TRASH|WASTE|SEWER)\b",
        r"\b(DUKE ENERGY|PG&E|PGE|CON EDISON|NATIONAL GRID|SCE|ELECTRIC BILL)\b",
        r"\b(SPECTRUM|CHARTER|COX COMMUNICATIONS|DIRECTV|DISH NETWORK)\b",
        r"\b(NATURAL GAS|GAS SERVICE|WATER SERVICE|UTILITY BILL)\b",
        r"\b(SOLAR LEASE|SOLAR CITY|SUNRUN)\b",
        r"\b(HOSTING|CLOUD STORAGE|GOOGLE WORKSPACE|MICROSOFT 365)\b",
    ],
    "Health": [
        r"\b(PHARMACY|CVS|WALGREENS|DENTAL|DENTIST|ORTHO|HOSPITAL|MEDICAL|HEALTH|CLINIC)\b",
        r"\b(INSURANCE|INS PREM|GEICO|STATE FARM|ALLSTATE|PROGRESSIVE)\b",
        # Generic doctor / practitioner markers (avoid matching DRIVE etc by requiring word boundary and optional period)
        r"\b(DR\.?\s+[A-Z]|DR\.?\b|M\.?D\.?\b|DDS\b|DPM\b|DO\b)",
        r"\b(BLUE CROSS|BLUE SHIELD|AETNA|CIGNA|KAISER|UNITED HEALTH)\b",
        r"\b(OPTUM|LABCORP|QUEST DIAGNOSTICS|RADIOLOGY|IMAGING CENTER)\b",
        r"\b(PHYSICAL THERAPY|PT VISIT|OCCUPATIONAL THERAPY|SPEECH THERAPY)\b",
        r"\b(URGENT CARE|WALK-IN CLINIC|EMERGENCY ROOM|ER VISIT)\b",
        r"\b(VISION CENTER|OPTICAL|EYE CARE|DERMATOLOGY|PEDIATRIC|CARDIOLOGY)\b",
    ],
    "Recreation": [
        r"\b(SPOTIFY|NETFLIX|HULU|DISNEY\+|APPLE MUSIC|GAMESTOP|STEAM|AMC)\b",
        r"\b(HOTEL|MARRIOTT|HILTON|AIRBNB|DELTA|UNITED AIR|AMERICAN AIR|BOOKING\.COM|TRAVEL)\b",
        r"\b(AMAZON|TARGET|BEST BUY|ETSY|EBAY|POS PURCHASE)\b",
        r"\b(SUBSCRIPTION|SUBSCRIPT|RENEWAL|PLAN FEE)\b",
        r"\b(YOUTUBE PREMIUM|PLAYSTATION|PSN|XBOX LIVE|EPIC GAMES|NINTENDO)\b",
        r"\b(SOUTHWEST|JETBLUE|ALASKA AIR|FRONTIER AIR|RYANAIR|EASYJET)\b",
        r"\b(TICKETMASTER|EVENTBRITE|STUBHUB|FANDANGO|LIVE NATION)\b",
        r"\b(GOLF COURSE|SKI PASS|RESORT FEE|MUSEUM|THEME PARK)\b",
        r"\b(GYM MEMBERSHIP|PILATES|YOGA STUDIO|DANCE CLASS)\b",
    ],
    "Finance": [
        r"\b(PAYROLL|DIRECT DEP|DIR DEP|ACH CREDIT|SALARY|DEPOSIT|INCOME|PAYMENT FROM)\b",  # income
        r"\b(TRANSFER|XFER|ACH DEBIT|ACH WITHDRAWAL|TO SAVINGS|FROM SAVINGS)\b",  # transfers
        r"\b(REFUND|REVERSAL|RETURNED)\b",  # refunds
        r"\b(OVERDRAFT|NSF|SERVICE CHARGE|MAINTENANCE FEE|FEE\b)\b",  # fees
        r"\b(INTEREST|DIVIDEND)\b",  # interest / earnings
        r"\b(LOAN PAYMENT|STUDENT LOAN|AUTO LOAN)\b",  # loan servicing
        r"\b(TUITION|SCHOOL|UNIVERSITY|COLLEGE|CHARITY|DONATION|FOUNDATION)\b",  # misc financial/charitable
        r"\b(VANGUARD|FIDELITY|SCHWAB|ROBINHOOD|ETRADE|MERRILL)\b",
        r"\b(COINBASE|CRYPTO|BITCOIN|BLOCKFI)\b",
        r"\b(ZELLE|VENMO|PAYPAL|CASH APP|APPLE CASH)\b",
        r"\b(IRS PAYMENT|TAX PAYMENT|TAX REFUND|STATE TAX|FED TAX)\b",
        r"\b(BILL PAY|AUTO PAY|DIRECT PAY|ELECTRONIC PAYMENT)\b",
    ],
}


BALANCE_SKIP_RX = re.compile(
    r"\b((BEGINNING|OPENING) BALANCE|(ENDING|CLOSING) BALANCE|BALANCE FORWARD|NEW BALANCE)\b",
    re.IGNORECASE,
)
FINANCE_FALLBACK_RX = re.compile(
    r"\b(ACH|TRANSFER|XFER|FEE|REFUND|INTEREST|DIVIDEND|DEPOSIT|PAYROLL)\b",
    re.IGNORECASE,
)
TRANSFER_RX = re.compile(
    r"\b(TRANSFER|XFER|TO SAVINGS|FROM SAVINGS|INTERNAL TRANSFER)\b",
    re.IGNORECASE,
)


def register_custom_rule(
    category: CategoryName, regex: str, prepend: bool = False
) -> None:
    """Register a custom regex rule at runtime.

    Args:
        category: One of CANONICAL_CATEGORIES (else ValueError).
        regex:    Regex string (case-insensitive implied) applied to UPPER description.
        prepend:  If True, rule evaluated before default rules of same category.
    """
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
    # Custom rules appended (or prepended if specified via register_custom_rule)
    # Custom precedence: inserted custom rules retain relative order but appear before standard rules of same category when prepend requested.
    if _custom_rules:
        rules = list(_custom_rules) + rules
    return rules


def _heuristic_categorize(desc: str) -> str:
    """Heuristic (regex) categorization for a single description.

    Kept as a private function so the public `categorize_description` can wrap
    it with optional AI refinement without duplicating logic or names.
    """
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
    """Add a `category` column (categorical dtype) if absent.

    Keeps existing `category` column intact. Safe on empty / missing description.
    """
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

# ---------------- Optional AI Enhancement (privacy-preserving) ---------------- #
"""AI Category Enhancement

If the environment variable USE_AI_CATEGORIES is set to a truthy value (e.g. "1"),
an additional embedding-based classifier refines (or replaces) heuristic results.

Design goals:
  * Privacy: All inference local; no network calls after model download.
  * Safety: If model or dependency missing, silently fallback to heuristic.
  * Performance: Cache embeddings per unique description (case-insensitive key).
  * Determinism: Embedding similarity; no randomness.

Current refinement behavior (2025-08-31):
    The embedding model now evaluates EVERY non-blank heuristic category result.
    Previously only Recreation/Finance were refined. Balance roll-forward lines
    still return an empty string and bypass AI.

Configuration via environment variables:
  USE_AI_CATEGORIES=1              -> enable feature
  AI_CATEGORY_MODE=embedding       -> (default) lightweight sentence-transformers
  AI_MIN_CONF=0.05                 -> minimum cosine delta over heuristic to override

To pre-download the model for Azure deployment (so build image has it and runtime
avoids outbound fetch), run the helper script `python -m download_models` or invoke
`warm_ai_category_model()` during startup with USE_AI_CATEGORIES=1.
"""

_EMBED_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
_ai_model = None  # lazy
_ai_cat_labels = CANONICAL_CATEGORIES
_ai_cat_prompts = [
    "Housing costs: mortgage rent home improvement repairs",
    "Transportation: fuel gas rideshare transit parking vehicle loan",
    "Food: groceries supermarkets dining restaurants cafes delivery",
    "Utilities: electricity water gas internet phone trash sewer",
    "Health: medical pharmacy insurance dental hospital wellness",
    "Recreation: shopping entertainment travel leisure subscription streaming",
    "Finance: income payroll deposit transfer refund interest fee loan charity",
]
_ai_cat_emb = None
_desc_emb_cache: dict[str, tuple[str, float]] = {}


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


def _load_embed_model():  # lazy import guarded by flag
    global _ai_model, _ai_cat_emb
    if _ai_model is not None:
        return
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore

        _ai_model = SentenceTransformer(_EMBED_MODEL_NAME)
        _ai_cat_emb = _ai_model.encode(_ai_cat_prompts, normalize_embeddings=True)
    except Exception:
        _ai_model = None
        _ai_cat_emb = None


def warm_ai_category_model():
    """Explicitly load the embedding model (optional)."""
    if _use_ai():
        _load_embed_model()


def ai_refine_category(description: str, base_category: str) -> str:
    """Backward-compatible wrapper returning only final category."""
    final, *_ = ai_refine_with_info(description, base_category)
    return final


def ai_refine_with_info(
    description: str,
    base_category: str,
    use_ai_override: bool | None = None,
) -> tuple[str, str | None, float | None, float | None]:
    """Refine category and return (final, ai_candidate, margin, best_score).

    ai_candidate is None if model unused or no change considered. margin/best_score
    may be None if embedding unavailable.
    """
    # Explicit override precedence: False disables regardless of env; True enables even if env flag off.
    if use_ai_override is False:
        return base_category, None, None, None
    if (
        (use_ai_override is None and not _use_ai())
        or not isinstance(description, str)
        or not description.strip()
    ):
        return base_category, None, None, None
    _load_embed_model()
    if _ai_model is None or _ai_cat_emb is None:
        return base_category, None, None, None
    key = description.strip().upper()
    cached = _desc_emb_cache.get(key)
    if cached:
        # We only cached final category + score earlier; margin unknown here.
        return cached[0], None, None, cached[1]
    try:
        emb = _ai_model.encode([description], normalize_embeddings=True)
    except Exception:
        return base_category, None, None, None
    import numpy as np  # lazy import

    sims = (emb @ _ai_cat_emb.T)[0]
    best_idx = int(np.argmax(sims))
    best_score = float(sims[best_idx])
    sorted_scores = sorted(sims, reverse=True)
    margin = best_score - float(sorted_scores[1]) if len(sorted_scores) > 1 else 1.0
    min_conf = float(os.environ.get("AI_MIN_CONF", "0.05"))
    ai_cat = _ai_cat_labels[best_idx]
    if ai_cat != base_category and margin >= min_conf:
        _desc_emb_cache[key] = (ai_cat, best_score)
        return ai_cat, ai_cat, margin, best_score
    _desc_emb_cache[key] = (base_category, best_score)
    return (
        base_category,
        ai_cat if ai_cat != base_category else None,
        margin,
        best_score,
    )


def clear_all_caches() -> dict[str, int | bool]:
    """Clear in-memory categorization caches & custom rules.

    Returns a summary dict with counts of items cleared. Safe to call any time.
    """
    global _ai_model, _ai_cat_emb
    # Clear compiled rule cache & embedding description cache
    try:
        _compile_rules.cache_clear()  # type: ignore[attr-defined]
    except Exception:
        pass
    try:
        normalize_description.cache_clear()  # type: ignore[attr-defined]
    except Exception:
        pass
    desc_cache_size = len(_desc_emb_cache)
    _desc_emb_cache.clear()
    # Clear custom rules
    with _custom_rules_lock:
        custom_count = len(_custom_rules)
        _custom_rules.clear()
    # Drop loaded model/embeddings to free memory (lazy reload later)
    _ai_model = None
    _ai_cat_emb = None
    return {
        "custom_rules_cleared": custom_count,
        "desc_embedding_cache_cleared": desc_cache_size,
        "model_reset": True,
    }


def reload_rules() -> int:
    """Clear compiled rule cache and force recompilation.

    Returns the number of compiled rules after reload.
    """
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
    """Return rich categorization metadata for a single description.

    Keys:
      description, base_category (pre-AI heuristic), final_category, source,
      matched_pattern, ai_original_category, ai_margin, ai_best_score, skipped (bool)
    source in {skip, regex, fallback, ai} (override handled later).
    """
    info: Dict[str, Any] = {
        "description": desc,
        "base_category": None,
        "final_category": "",
        "source": None,
        "matched_pattern": None,
        "ai_original_category": None,
        "ai_margin": None,
        "ai_best_score": None,
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
    final, ai_candidate, margin, best_score = ai_refine_with_info(
        desc, info["base_category"] or "", use_ai_override=use_ai
    )
    info["final_category"] = final
    if ai_candidate and final != info["base_category"]:
        info["source"] = "ai"
        info["ai_original_category"] = ai_candidate
        info["ai_margin"] = margin
        info["ai_best_score"] = best_score
    return info


def categorize_records_with_overrides(
    records: list[dict], use_ai: bool | None = None
) -> list[Dict[str, Any]]:
    """Categorize list of records returning metadata + overrides applied.

    Adds keys:
      override_applied (bool), transfer (bool), final_category (post-override)
      original_final_category (pre-override), override_reason
    Income/Savings overrides suppressed if description looks like an internal transfer.
    """
    out: list[Dict[str, Any]] = []
    for rec in records:
        desc = (rec.get("description") or "") if isinstance(rec, dict) else ""
        meta = categorize_with_metadata(desc, use_ai=use_ai)
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
    """Return (normalized_display, normalized_for_rules_upper).

    Steps:
      * Preserve original (returned as-is in metadata separately by caller)
      * Uppercase working copy (rule patterns expect word boundaries capital-insensitive)
      * Remove common statement noise tokens (POS PURCHASE, DEBIT CARD ####, etc.)
      * Collapse repeated whitespace
    The first element is a cleaned lowercase display-friendly string (without noise),
    second is the uppercase string used for rule matching.
    """
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
