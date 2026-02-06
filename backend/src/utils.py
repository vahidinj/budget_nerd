"""Small shared helpers used by backend modules."""

from __future__ import annotations

from typing import List
import pandas as pd


def df_to_records(df: pd.DataFrame) -> List[dict]:
    """Convert a DataFrame to JSON-serializable records.

    - Converts pandas NA to None
    - Converts date/datetime objects to ISO strings when possible
    """
    if df is None or df.empty:
        return []
    out = df.to_dict(orient="records")
    for rec in out:
        for k, v in list(rec.items()):
            if pd.isna(v):
                rec[k] = None
            elif hasattr(v, "isoformat"):
                try:
                    rec[k] = v.isoformat()
                except Exception:
                    pass
    return out


def ensure_dates(df: pd.DataFrame, date_col: str = "date") -> pd.DataFrame:
    """Return a DataFrame where ``date_col`` is coerced to datetime (copy on write).

    If the column is absent, the original frame is returned unchanged.
    """
    if date_col in df.columns and not pd.api.types.is_datetime64_any_dtype(
        df[date_col]
    ):
        df = df.copy()
        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    return df


def normalize_number(raw: str | None) -> float | None:
    """Parse a currency-like token into a float with sign.

    See original implementation in `pdf_parser.py` for heuristics.
    """
    if not raw:
        return None
    token = raw.strip()
    neg = False
    if token.endswith("-") and token.count("-") == 1:
        neg = True
        token = token[:-1]
    if token.startswith("(") and token.endswith(")"):
        neg = True
        token = token[1:-1]
    token_nosym = token.replace("$", "").replace(",", "")
    if token_nosym.startswith("-"):
        neg = True
        token_nosym = token_nosym[1:]
    core = token_nosym
    if not __import__("re").fullmatch(r"\d+(?:\.\d+)?", core):
        return None
    if "." not in core and len(core) > 7:
        return None
    if "." in core:
        int_part, frac_part = core.split(".", 1)
        if not (1 <= len(frac_part) <= 2):
            return None
        if len(frac_part) == 1:
            core = int_part + "." + frac_part + "0"
    try:
        v = float(core)
    except ValueError:
        return None
    if v > 1_000_000_000:
        return None
    return -v if neg else v


__all__ = ["df_to_records", "ensure_dates", "normalize_number"]
