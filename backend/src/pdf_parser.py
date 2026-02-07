"""PDF parsing helpers used by the backend."""

import re
from itertools import islice
from datetime import datetime, date
from typing import List, Tuple, Union, Literal, Optional, Iterable
import pandas as pd
import pdfplumber
from collections import Counter
from .utils import normalize_number
from .constants import (
    STATEMENT_PERIOD_RX,
    DATE_START_RX,
    AMOUNT_TOKEN_RX,
    YEAR_IN_RANGE_RX,
    ACCOUNT_HEADER_RX,
    ACCOUNT_HEADER_INLINE_RX,
    DATE_RANGE_RX,
    HEADER_FOOTER_PATTERNS_RX,
    DATE_PREFIX_RX,
    CREDIT_CARD_DETECT_PATTERNS,
    CC_TXN_LINE_RX,
    CC_PAYMENT_KEYWORDS,
    CC_CREDIT_KEYWORDS,
    DATE_FORMATS,
    SKIP_DESC,
    SKIP_CONTAINS,
)

__all__ = [
    "parse_bank_statement",
    "compute_balance_mismatches",
    "infer_date_order",
    "normalize_number",
    "parse_line",
    "parse_line_credit",
    "extract_raw_lines",
]


ACCOUNT_NUMBER_LABEL_RX = re.compile(
    r"(?:Primary\s+)?Account number:\s*([\d-]+)", re.IGNORECASE
)
ACCOUNT_SUMMARY_NAME_RX = re.compile(
    r"^(?P<name>.+?)\s+Account Summary$", re.IGNORECASE
)
SECTION_CREDIT_RX = re.compile(
    r"\b(Deposits?|Credits?|Other Additions|Other Credits|Additions|Payments and Credits|Interest)\b",
    re.IGNORECASE,
)
SECTION_DEBIT_RX = re.compile(
    r"\b(Withdrawals?|Debits?|Deductions|Other Deductions|Other Debits|Checks?|Fees|Service Charges|Payments)\b",
    re.IGNORECASE,
)
DATE_AMOUNT_DESC_HEADER_RX = re.compile(r"^Date\s+Amount\s+Description$", re.IGNORECASE)
DATE_DESC_AMOUNT_BAL_HEADER_RX = re.compile(
    r"^Date\s+Description\s+Amount(?:\s+Balance)?$", re.IGNORECASE
)
DATE_DESC_DEBIT_CREDIT_BAL_HEADER_RX = re.compile(
    r"^Date\s+Description\s+(?:Debit|Withdrawal)s?\s+(?:Credit|Deposit)s?\s+Balance$",
    re.IGNORECASE,
)
DATE_DESC_BAL_HEADER_RX = re.compile(r"^Date\s+Description\s+Balance$", re.IGNORECASE)
DAILY_BALANCE_RX = re.compile(r"\bDaily Balance\b", re.IGNORECASE)
CREDIT_DESC_HINTS = [
    "DEPOSIT",
    "CREDIT",
    "INTEREST",
    "REFUND",
    "REVERSAL",
    "PAYROLL",
    "PAYMENT RECEIVED",
]
DEBIT_DESC_HINTS = [
    "WITHDRAW",
    "DEBIT",
    "PURCHASE",
    "PAYMENT",
    "FEE",
    "CHARGE",
    "CHECK",
    "BILLPAY",
    "PMT",
]
TABLE_LAYOUTS = {
    "date_amount_desc",
    "date_desc_amount_balance",
    "date_desc_debit_credit_balance",
}
SECTION_HEADER_HINT_RX = re.compile(
    r"\bThere (?:were|was)\b|\btotaling\b", re.IGNORECASE
)
CC_PAYMENT_STRICT_RX = re.compile(
    r"\b(PAYMENT RECEIVED|ONLINE PAYMENT|ELECTRONIC PAYMENT|ACH PAYMENT|BILL PAYMENT|AUTO ?PAY|AUTOPAY)\b",
    re.IGNORECASE,
)
CC_PAYMENT_TOKEN_RX = re.compile(r"\bPMT\b", re.IGNORECASE)


def classify_account(name: str | None) -> str | None:
    """Normalize account name to 'checking' or 'savings'."""
    if not name or not isinstance(name, str):
        return None
    n = name.lower().strip()
    n_norm = re.sub(r"[^a-z0-9 ]+", " ", n)
    # Identify checking style names first
    if (
        "checking" in n_norm
        or re.search(r"\bchk\b", n_norm)
        or "share draft" in n_norm
        or re.search(r"\bdraft\b", n_norm)
    ):
        return "checking"
    # Everything else that looks like savings / money market -> savings
    if (
        "savings" in n_norm
        or "saving" in n_norm
        or "money market" in n_norm
        or re.search(r"\bmm(sa)?\b", n_norm)
        or ("share" in n_norm and "draft" not in n_norm)
    ):
        return "savings"
    # Fallback bucket -> savings (so we only ever have two categories)
    return "savings"


def detect_credit_card(lines: Iterable[str]) -> bool:
    """Light heuristic to detect credit-card statements.

    Stops early once 2 distinct CC indicator patterns are found. Accepts any
    iterable of strings; will only examine the first 120 items.
    """
    if lines is None:
        return False
    score = 0
    for ln in islice(lines, 120):
        if not isinstance(ln, str):
            ln = str(ln)
        for rx in CREDIT_CARD_DETECT_PATTERNS:
            if rx.search(ln):
                score += 1
                if score >= 2:
                    return True
    return False


def parse_line_credit(
    line: str,
    default_year: int | None,
    account_name: str | None,
    account_number: str | None,
    account_type: str | None,
    date_order: str | None = None,
):
    """Parse a credit-card style transaction line and return a record or None."""
    m = CC_TXN_LINE_RX.match(line)
    if not m:
        return None
    tdate_raw = m.group("trans_date")
    pdate_raw = m.group("post_date")
    ref = m.group("ref")
    rest = m.group("rest").strip()
    amount_raw = m.group("amount")
    amount = normalize_number(amount_raw)
    if amount is None:
        return None
    desc = f"{rest}".strip()
    desc_up = desc.upper()
    # Determine sign: purchases/fees -> negative (outflow / increase liability), payments & credits -> positive
    payment_hit = bool(CC_PAYMENT_STRICT_RX.search(desc_up)) or bool(
        CC_PAYMENT_TOKEN_RX.search(desc_up)
    )
    credit_hit = any(k in desc_up for k in CC_CREDIT_KEYWORDS)
    if payment_hit or credit_hit:
        signed_amount = abs(amount)  # reduces liability
    else:
        signed_amount = -abs(amount)  # spending / charges
    # Date parsing (prefer transaction date as primary)
    d_primary = parse_date(tdate_raw, default_year, date_order)
    return {
        "date": d_primary,
        "date_raw": tdate_raw,
        "post_date": parse_date(pdate_raw, default_year, date_order),
        "description": f"{desc} REF:{ref}",
        "amount": signed_amount,
        "debit": abs(signed_amount) if signed_amount < 0 else None,
        "credit": signed_amount if signed_amount > 0 else None,
        "balance": None,  # typical CC lines do not show running balance here
        "account_name": account_name,
        "account_number": account_number,
        "account_type": account_type or "credit_card",
        "line_type": "transaction",
        "raw_line": line,
    }


def infer_year(all_lines: list[str]) -> int | None:
    years: list[int] = []
    period_years: list[int] = []
    for line in all_lines:
        for m in YEAR_IN_RANGE_RX.finditer(line):
            y = m.group(1)
            y_full = int(("20" + y) if len(y) == 2 else y)
            years.append(y_full)
        for pm in STATEMENT_PERIOD_RX.finditer(line):
            y1_raw = pm.group(2)
            y2_raw = pm.group(4)
            for y_raw in (y1_raw, y2_raw):
                y_full = int(("20" + y_raw) if len(y_raw) == 2 else y_raw)
                period_years.append(y_full)
    if not years:
        return None
    counter = Counter(years)
    if len(counter) == 2:
        y_sorted = sorted(counter.keys())
        if abs(y_sorted[0] - y_sorted[1]) == 1 and period_years:
            period_counts = [(y, counter[y]) for y in set(period_years) if y in counter]
            if period_counts:
                period_counts.sort(key=lambda t: t[1], reverse=True)
                return period_counts[0][0]
    return counter.most_common(1)[0][0]


def parse_date(
    raw: str, default_year: int | None, date_order: str | None
) -> Union[date, str]:
    """Parse various short/long date formats; return date or raw on failure."""
    parts = re.split(r"[/-]", raw)
    if len(parts) == 2 and default_year:
        try:
            a = int(parts[0])
            b = int(parts[1])
        except ValueError:
            return raw
        if a > 12 and b <= 12:
            day, month = a, b
        elif b > 12 and a <= 12:
            month, day = a, b
        else:
            if date_order == "DM":
                day, month = a, b
            else:
                month, day = a, b
        try:
            return datetime(default_year, month, day).date()
        except ValueError:
            return raw
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return raw


def _normalize_space(s: str) -> str:
    return re.sub(r"[ \t]+", " ", s.replace("\u00a0", " ")).strip()


def extract_raw_lines(
    pdf_file,
    mode: str = "raw",
    merge_wrapped: bool = True,
    include_coords: bool = False,
    drop_header_footer: bool = True,
) -> List[Tuple[int, str]]:
    """Extract textual lines from a PDF (returns list of (page, text))."""
    lines: List[Tuple[int, str]] = []
    try:
        with pdfplumber.open(pdf_file) as pdf:
            for p_idx, page in enumerate(pdf.pages, start=1):
                if mode == "raw":
                    text = page.extract_text() or ""
                    for raw_line in text.splitlines():
                        s = raw_line.strip()
                        if not s:
                            continue
                        s_norm = _normalize_space(s)
                        if not s_norm or (
                            drop_header_footer
                            and any(
                                rx.match(s_norm) for rx in HEADER_FOOTER_PATTERNS_RX
                            )
                        ):
                            continue
                        lines.append((p_idx, s_norm))
                else:
                    words = page.extract_words() or []
                    grouped = []
                    y_tol = 3
                    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
                        if not grouped:
                            grouped.append([w])
                            continue
                        last_line = grouped[-1]
                        if abs(w["top"] - last_line[0]["top"]) <= y_tol:
                            last_line.append(w)
                        else:
                            grouped.append([w])
                    for group in grouped:
                        group_sorted = sorted(group, key=lambda w: w["x0"])
                        text_line = " ".join(g["text"] for g in group_sorted)
                        s_norm = _normalize_space(text_line)
                        if not s_norm or (
                            drop_header_footer
                            and any(
                                rx.match(s_norm) for rx in HEADER_FOOTER_PATTERNS_RX
                            )
                        ):
                            continue
                        lines.append((p_idx, s_norm))
    except Exception:
        return []

    if merge_wrapped and lines:
        merged: List[Tuple[int, str]] = []
        for pg, text in lines:
            if not merged:
                merged.append((pg, text))
                continue
            prev_pg, prev_text = merged[-1]
            prev_starts_with_date = bool(DATE_PREFIX_RX.match(prev_text))
            curr_starts_with_date = bool(DATE_PREFIX_RX.match(text))
            prev_has_header = bool(ACCOUNT_HEADER_INLINE_RX.search(prev_text))
            curr_has_header = bool(ACCOUNT_HEADER_INLINE_RX.search(text))
            if (
                pg == prev_pg
                and not prev_starts_with_date
                and not curr_starts_with_date
                and not prev_has_header
                and not curr_has_header
            ):
                merged[-1] = (prev_pg, prev_text + " " + text)
            else:
                merged.append((pg, text))
        lines = merged

    return lines


def should_skip_desc(desc: str) -> bool:
    if desc in SKIP_DESC:
        return True
    for frag in SKIP_CONTAINS:
        if frag in desc:
            return True
    return False


def detect_layout(lines: List[str], credit_card_mode: bool) -> str:
    if credit_card_mode:
        return "credit_card"
    for ln in lines[:300]:
        if DATE_DESC_DEBIT_CREDIT_BAL_HEADER_RX.search(ln):
            return "date_desc_debit_credit_balance"
        if DATE_DESC_AMOUNT_BAL_HEADER_RX.search(ln):
            return "date_desc_amount_balance"
        if DATE_AMOUNT_DESC_HEADER_RX.search(ln):
            return "date_amount_desc"
    return "standard"


def is_table_header(line: str) -> bool:
    return bool(
        DATE_DESC_DEBIT_CREDIT_BAL_HEADER_RX.search(line)
        or DATE_DESC_AMOUNT_BAL_HEADER_RX.search(line)
        or DATE_AMOUNT_DESC_HEADER_RX.search(line)
        or DATE_DESC_BAL_HEADER_RX.search(line)
    )


def is_section_header(line: str) -> bool:
    if DATE_PREFIX_RX.match(line):
        return False
    return bool(SECTION_HEADER_HINT_RX.search(line))


def infer_signed_amount(amount: float, desc: str, section_sign: int | None) -> float:
    if section_sign == 1:
        return abs(amount)
    if section_sign == -1:
        return -abs(amount)
    desc_up = desc.upper()
    if re.search(r"\bINTEREST (PAYMENT|PAID)\b", desc_up):
        return abs(amount)
    if re.search(r"\bCREDIT CARD (PMT|PAYMENT)\b", desc_up):
        return -abs(amount)
    credit_hit = any(h in desc_up for h in CREDIT_DESC_HINTS)
    debit_hit = any(h in desc_up for h in DEBIT_DESC_HINTS)
    if credit_hit and debit_hit:
        return -abs(amount)
    if credit_hit:
        return abs(amount)
    if debit_hit:
        return -abs(amount)
    return amount


def parse_line(
    line: str,
    default_year: int | None,
    account_name: str | None,
    account_number: str | None,
    account_type: str | None = None,
    date_order: str | None = None,
):
    m = DATE_START_RX.match(line)
    if not m:
        return None
    date_raw = m.group("date")
    rest = line[m.end() :].strip()
    tokens = rest.split()
    if not tokens:
        return None

    trailing: list[str] = []
    while tokens and AMOUNT_TOKEN_RX.match(tokens[-1]) and len(trailing) < 3:
        trailing.append(tokens.pop())
    trailing.reverse()

    description = " ".join(tokens).strip()
    if not description:
        return None
    # Handle explicit beginning / ending balance marker lines so they are not flagged unparsed
    if description in {"Beginning Balance", "Ending Balance"}:
        bal_val = None
        if len(trailing) == 1:
            bal_val = normalize_number(trailing[0])
        elif len(trailing) >= 2:  # sometimes an extra reference then amount
            # try last token
            bal_val = normalize_number(trailing[-1])
        return {
            "date": parse_date(date_raw, default_year, date_order),
            "date_raw": date_raw,
            "description": description,
            "amount": None,
            "debit": None,
            "credit": None,
            "balance": bal_val,
            "account_name": account_name,
            "account_number": account_number,
            "account_type": account_type,
            "line_type": "marker",
            "raw_line": line,
        }

    amount = balance = None
    debit = credit = None

    if len(trailing) == 3:
        ref_candidate = trailing[0]
        monetary_tail = trailing[1:]

        def _looks_money(tok: str) -> bool:
            return bool(re.search(r"[().-]", tok)) or "." in tok

        if (
            ref_candidate.isdigit()
            and len(ref_candidate) >= 5
            and "." not in ref_candidate
            and any(_looks_money(t) for t in monetary_tail)
        ):
            description = (description + " " + ref_candidate).strip()
            trailing = trailing[1:]
    if len(trailing) == 3:
        a1 = normalize_number(trailing[0])
        a2 = normalize_number(trailing[1])
        b = normalize_number(trailing[2])
        if a1 is not None and a2 is not None and b is not None:
            if (a1 < 0 < a2) or (a2 < 0 < a1):
                debit = abs(a1) if a1 < 0 else abs(a2) if a2 < 0 else None
                credit = a1 if a1 > 0 else a2 if a2 > 0 else None
                amount = (credit or 0) - (debit or 0)
                balance = b
            else:
                amount = a1
                balance = b
        elif a1 is not None and b is not None:
            amount = a1
            balance = b
    elif len(trailing) == 2:
        t0, t1 = trailing
        looks_ref = t0.isdigit() and len(t0) >= 5 and "." not in t0
        looks_money = bool(re.search(r"[().-]", t1) or "." in t1)
        if looks_ref and looks_money:
            description = (description + " " + t0).strip()
            trailing = [t1]
            a1 = normalize_number(trailing[0])
            if a1 is not None and not (trailing[0].isdigit() and len(trailing[0]) > 8):
                amount = a1
        else:
            a1 = normalize_number(t0)
            a2 = normalize_number(t1)
            if a1 is not None and a2 is not None:
                if (abs(a2) >= abs(a1)) or ("," in t1 and "," not in t0):
                    amount = a1
                    balance = a2
                else:
                    amount = a1
            elif a1 is not None:
                amount = a1
            elif a2 is not None:
                amount = a2
    elif len(trailing) == 1:
        a1 = normalize_number(trailing[0])
        if a1 is not None and not (trailing[0].isdigit() and len(trailing[0]) > 8):
            amount = a1
        else:
            if trailing[0]:
                description = (description + " " + trailing[0]).strip()

    if amount is not None and debit is None and credit is None:
        if amount < 0:
            debit = -amount
        elif amount > 0:
            credit = amount

    if all(v is None for v in (amount, balance, debit, credit)):
        return None

    line_type = "transaction"

    return {
        "date": parse_date(date_raw, default_year, date_order),
        "date_raw": date_raw,
        "description": description,
        "amount": amount,
        "debit": debit,
        "credit": credit,
        "balance": balance,
        "account_name": account_name,
        "account_number": account_number,
        "account_type": account_type,
        "line_type": line_type,
        "raw_line": line,
    }


def parse_line_date_amount_desc(
    line: str,
    default_year: int | None,
    account_name: str | None,
    account_number: str | None,
    account_type: str | None = None,
    date_order: str | None = None,
    section_sign: int | None = None,
):
    tokens = line.split()
    if len(tokens) < 3:
        return None
    if not DATE_PREFIX_RX.match(tokens[0]):
        return None
    if not AMOUNT_TOKEN_RX.match(tokens[1]):
        return None
    amount = normalize_number(tokens[1])
    if amount is None:
        return None
    description = " ".join(tokens[2:]).strip()
    if not description:
        return None
    signed_amount = infer_signed_amount(amount, description, section_sign)
    debit = abs(signed_amount) if signed_amount < 0 else None
    credit = signed_amount if signed_amount > 0 else None
    return {
        "date": parse_date(tokens[0], default_year, date_order),
        "date_raw": tokens[0],
        "description": description,
        "amount": signed_amount,
        "debit": debit,
        "credit": credit,
        "balance": None,
        "account_name": account_name,
        "account_number": account_number,
        "account_type": account_type,
        "line_type": "transaction",
        "raw_line": line,
    }


def parse_line_date_desc_amount_balance(
    line: str,
    default_year: int | None,
    account_name: str | None,
    account_number: str | None,
    account_type: str | None = None,
    date_order: str | None = None,
    section_sign: int | None = None,
):
    tokens = line.split()
    if len(tokens) < 4:
        return None
    if not DATE_PREFIX_RX.match(tokens[0]):
        return None
    trailing: list[str] = []
    while tokens and AMOUNT_TOKEN_RX.match(tokens[-1]) and len(trailing) < 3:
        trailing.append(tokens.pop())
    trailing.reverse()
    if len(trailing) != 2:
        return None
    amount = normalize_number(trailing[0])
    balance = normalize_number(trailing[1])
    if amount is None or balance is None:
        return None
    description = " ".join(tokens[1:]).strip()
    if not description:
        return None
    signed_amount = infer_signed_amount(amount, description, section_sign)
    debit = abs(signed_amount) if signed_amount < 0 else None
    credit = signed_amount if signed_amount > 0 else None
    return {
        "date": parse_date(tokens[0], default_year, date_order),
        "date_raw": tokens[0],
        "description": description,
        "amount": signed_amount,
        "debit": debit,
        "credit": credit,
        "balance": balance,
        "account_name": account_name,
        "account_number": account_number,
        "account_type": account_type,
        "line_type": "transaction",
        "raw_line": line,
    }


def parse_line_date_desc_debit_credit_balance(
    line: str,
    default_year: int | None,
    account_name: str | None,
    account_number: str | None,
    account_type: str | None = None,
    date_order: str | None = None,
    section_sign: int | None = None,
):
    tokens = line.split()
    if len(tokens) < 4:
        return None
    if not DATE_PREFIX_RX.match(tokens[0]):
        return None
    trailing: list[str] = []
    while tokens and AMOUNT_TOKEN_RX.match(tokens[-1]) and len(trailing) < 4:
        trailing.append(tokens.pop())
    trailing.reverse()
    if len(trailing) < 2:
        return None
    description = " ".join(tokens[1:]).strip()
    if not description:
        return None
    balance = normalize_number(trailing[-1])
    if balance is None:
        return None
    debit = credit = None
    signed_amount = None
    if len(trailing) >= 3:
        debit = normalize_number(trailing[-3])
        credit = normalize_number(trailing[-2])
        if debit is None and credit is None:
            return None
        debit = abs(debit) if debit is not None else None
        credit = abs(credit) if credit is not None else None
        signed_amount = (credit or 0) - (debit or 0)
    else:
        amount = normalize_number(trailing[0])
        if amount is None:
            return None
        signed_amount = infer_signed_amount(amount, description, section_sign)
        if signed_amount < 0:
            debit = abs(signed_amount)
        elif signed_amount > 0:
            credit = signed_amount
    return {
        "date": parse_date(tokens[0], default_year, date_order),
        "date_raw": tokens[0],
        "description": description,
        "amount": signed_amount,
        "debit": debit,
        "credit": credit,
        "balance": balance,
        "account_name": account_name,
        "account_number": account_number,
        "account_type": account_type,
        "line_type": "transaction",
        "raw_line": line,
    }


def parse_bank_statement(
    pdf_file,
) -> tuple[pd.DataFrame, list[str], List[Tuple[int, str]]]:
    raw_lines = extract_raw_lines(pdf_file)
    if not raw_lines:
        return pd.DataFrame(), [], []

    # Cache just the textual component for repeated heuristics.
    line_texts = [lt for _, lt in raw_lines]
    default_year = infer_year(line_texts)
    date_order = infer_date_order(line_texts)
    credit_card_mode = detect_credit_card(line_texts)
    layout = detect_layout(line_texts, credit_card_mode)
    if layout in TABLE_LAYOUTS:
        word_lines = extract_raw_lines(pdf_file, mode="words")
        if word_lines:
            raw_lines = word_lines
            line_texts = [lt for _, lt in raw_lines]
            default_year = infer_year(line_texts)
            date_order = infer_date_order(line_texts)

    rows: List[dict] = []
    unparsed: list[str] = []
    account_name = account_number = account_type = None
    section_sign: int | None = None
    last_parsed_kind: str | None = None
    daily_balance_mode = False
    current_layout = layout
    raw_index = 0

    for pg, line in raw_lines:
        hdr = ACCOUNT_HEADER_RX.match(line) or ACCOUNT_HEADER_INLINE_RX.search(line)
        if hdr:
            account_name = hdr.group("name").strip()
            account_number = hdr.group("number")
            account_type = classify_account(account_name)
            daily_balance_mode = False
        acct_label = ACCOUNT_NUMBER_LABEL_RX.search(line)
        if acct_label:
            acct_digits = re.sub(r"\D", "", acct_label.group(1))
            account_number = acct_digits or acct_label.group(1)
        acct_summary = ACCOUNT_SUMMARY_NAME_RX.match(line)
        if acct_summary and not account_name:
            account_name = acct_summary.group("name").strip()
            account_type = classify_account(account_name)
        if is_section_header(line):
            credit_hit = SECTION_CREDIT_RX.search(line)
            debit_hit = SECTION_DEBIT_RX.search(line)
            if credit_hit and debit_hit:
                section_sign = None
            elif credit_hit:
                section_sign = 1
                daily_balance_mode = False
            elif debit_hit:
                section_sign = -1
                daily_balance_mode = False
        if DATE_DESC_DEBIT_CREDIT_BAL_HEADER_RX.search(line):
            current_layout = "date_desc_debit_credit_balance"
            daily_balance_mode = False
            continue
        if DATE_DESC_AMOUNT_BAL_HEADER_RX.search(line):
            current_layout = "date_desc_amount_balance"
            daily_balance_mode = False
            continue
        if DATE_AMOUNT_DESC_HEADER_RX.search(line):
            current_layout = "date_amount_desc"
            daily_balance_mode = False
            continue
        if "Average Daily Balance" in line:
            continue
        if DAILY_BALANCE_RX.search(line):
            if not credit_card_mode:
                if last_parsed_kind == "table" and "Daily Balance" in line:
                    prefix = line.split("Daily Balance", 1)[0].strip()
                    if prefix and rows:
                        rows[-1]["description"] = (
                            rows[-1]["description"] + " " + prefix
                        ).strip()
                        rows[-1]["raw_line"] = rows[-1]["raw_line"] + " " + prefix
                daily_balance_mode = True
                last_parsed_kind = None
            continue
        if DATE_RANGE_RX.match(line):  # statement period headers -> skip
            continue
        if is_table_header(line):
            continue
        if daily_balance_mode:
            continue
        # Select parser (credit card style has distinct line grammar)
        rec = None
        if credit_card_mode:
            rec = parse_line_credit(
                line,
                default_year,
                account_name,
                account_number,
                account_type or "credit_card",
                date_order,
            )
            if rec:
                last_parsed_kind = "credit"
        if not rec:
            rec = parse_line_date_amount_desc(
                line,
                default_year,
                account_name,
                account_number,
                account_type,
                date_order,
                section_sign,
            )
            if rec and current_layout not in TABLE_LAYOUTS:
                current_layout = "date_amount_desc"
        if not rec and current_layout == "date_desc_amount_balance":
            rec = parse_line_date_desc_amount_balance(
                line,
                default_year,
                account_name,
                account_number,
                account_type,
                date_order,
                section_sign,
            )
        if not rec and current_layout == "date_desc_debit_credit_balance":
            rec = parse_line_date_desc_debit_credit_balance(
                line,
                default_year,
                account_name,
                account_number,
                account_type,
                date_order,
                section_sign,
            )
        if rec and current_layout in TABLE_LAYOUTS:
            last_parsed_kind = "table"
        if not rec:  # fallback to standard bank line parser
            rec = parse_line(
                line,
                default_year,
                account_name,
                account_number,
                account_type,
                date_order,
            )
            if rec:
                last_parsed_kind = "standard"
        if rec:
            rec["page"] = pg
            rec["raw_line_index"] = raw_index
            raw_index += 1
            rows.append(rec)
        else:
            if last_parsed_kind == "table" and not daily_balance_mode:
                if (
                    not DATE_PREFIX_RX.match(line)
                    and not DATE_RANGE_RX.match(line)
                    and not is_table_header(line)
                    and not SECTION_CREDIT_RX.search(line)
                    and not SECTION_DEBIT_RX.search(line)
                    and not ACCOUNT_HEADER_INLINE_RX.search(line)
                    and not DAILY_BALANCE_RX.search(line)
                ):
                    if rows:
                        rows[-1]["description"] = (
                            rows[-1]["description"] + " " + line
                        ).strip()
                        rows[-1]["raw_line"] = rows[-1]["raw_line"] + " " + line
                    continue
            if DATE_PREFIX_RX.match(line):  # looked like a txn start but failed parse
                unparsed.append(f"[p{pg}] {line}")
    df = pd.DataFrame(rows)
    if not df.empty:
        try:
            df["_d"] = pd.to_datetime(df["date"], errors="coerce")
            sort_cols = [
                c for c in ["account_type", "account_number", "_d"] if c in df.columns
            ]
            df = df.sort_values(sort_cols).drop(columns=["_d"])
            # Outlier filtering only if sufficient rows to justify (>=50)
            if "amount" in df.columns and len(df) >= 50:
                amt_series = df["amount"].dropna()
                if not amt_series.empty:
                    med = amt_series.abs().median()
                    if med > 0:
                        cutoff = med * 50  # generous multiplier
                        mask_out = df["amount"].abs() > cutoff
                        if mask_out.any():
                            df.loc[mask_out, ["amount", "debit", "credit"]] = None
            mask_all_none = (
                df[["amount", "debit", "credit", "balance"]].isna().all(axis=1)
            )
            if mask_all_none.any():
                df = df[~mask_all_none]
            # Normalize account types: if credit_card present keep it; else collapse to checking/savings
            if "account_type" in df.columns:
                if (df["account_type"] == "credit_card").any():
                    df.loc[df["account_type"].isna(), "account_type"] = "credit_card"
                else:
                    df["account_type"] = (
                        df["account_type"]
                        .fillna("savings")
                        .apply(lambda v: "checking" if v == "checking" else "savings")
                    )
            # Convert selected string columns to category for memory/perf gains
            for cat_col in ["account_type", "account_number"]:
                if cat_col in df.columns and df[cat_col].dtype == object:
                    try:
                        df[cat_col] = df[cat_col].astype("category")
                    except Exception:
                        pass
            # For credit card mode, attempt synthetic running balance ONLY if both 'Previous Balance' & 'New Balance' present
            if credit_card_mode and "amount" in df.columns:
                prev_bal = None
                new_bal = None
                for _, ln in raw_lines:
                    if prev_bal is None:
                        m_prev = re.search(
                            r"Previous Balance \$([0-9,]+(?:\.\d{2})?)",
                            ln,
                            re.IGNORECASE,
                        )
                        if m_prev:
                            prev_bal = normalize_number(m_prev.group(1))
                    if new_bal is None:
                        m_new = re.search(
                            r"New Balance \$([0-9,]+(?:\.\d{2})?)", ln, re.IGNORECASE
                        )
                        if m_new:
                            new_bal = normalize_number(m_new.group(1))
                    if prev_bal is not None and new_bal is not None:
                        break
                if prev_bal is not None and new_bal is not None:
                    ordered = df.sort_values(
                        [c for c in ["account_number", "date_raw"] if c in df.columns]
                    )
                    running = prev_bal + ordered["amount"].cumsum()
                    # Only assign if end matches expected new balance within tolerance
                    if abs(running.iloc[-1] - new_bal) < 0.05:
                        df.loc[ordered.index, "balance"] = running
            # Infer missing running balances for non-credit accounts when we have a starting balance
            if not credit_card_mode and {"amount", "balance"}.issubset(df.columns):
                try:
                    # Work on already-sorted frame to preserve chronological order
                    by_cols = [
                        c
                        for c in ["account_type", "account_number", "date_raw"]
                        if c in df.columns
                    ]
                    if by_cols:
                        df = df.sort_values(by_cols)

                    def _fill_group(g: pd.DataFrame) -> pd.DataFrame:
                        current = None
                        # find first non-null balance to seed
                        for _, r in g.iterrows():
                            if pd.notna(r.get("balance")):
                                current = r["balance"]
                                break
                        if current is None:
                            return g
                        balances = []
                        for _, r in g.iterrows():
                            if r.get("line_type") == "marker" and pd.notna(
                                r.get("balance")
                            ):
                                current = r["balance"]
                                balances.append(r.get("balance"))
                                continue
                            amt = r.get("amount")
                            bal = r.get("balance")
                            if pd.isna(bal) and pd.notna(amt) and pd.notna(current):
                                # infer
                                current = round(current + amt, 2)
                                balances.append(current)
                            else:
                                if pd.notna(bal):
                                    current = bal
                                balances.append(bal)
                        g["balance"] = balances
                        return g

                    df = df.groupby(
                        [c for c in ["account_number"] if c in df.columns],
                        dropna=False,
                        group_keys=False,
                    ).apply(_fill_group)
                except Exception:
                    pass
        except Exception:
            pass
    return df, unparsed, raw_lines


# ---------------- Additional heuristics & helpers ---------------- #
def infer_date_order(lines: List[str]) -> Optional[Literal["MD", "DM"]]:
    """Infer whether dates are MD or DM from sample lines, or return None."""
    dm_flag = False
    md_flag = False
    for ln in lines[:400]:
        m = DATE_START_RX.match(ln)
        if not m:
            continue
        token = m.group("date")
        parts = re.split(r"[/-]", token)
        if len(parts) != 2:  # skip those already with year
            continue
        try:
            a = int(parts[0])
            b = int(parts[1])
        except ValueError:
            continue
        if a > 12 and b <= 12:
            dm_flag = True  # day-month pattern
        elif b > 12 and a <= 12:
            md_flag = True  # month-day pattern
        if dm_flag and md_flag:
            return None  # conflicting evidence
    if dm_flag and not md_flag:
        return "DM"
    if md_flag and not dm_flag:
        return "MD"
    return None


def compute_balance_mismatches(df: pd.DataFrame, tolerance: float = 0.01) -> list[dict]:
    """Find rows where balance does not match prior balance + amount."""
    mismatches: list[dict] = []
    if df.empty:
        return mismatches
    for acct, g in df.sort_values(["account_number", "date_raw"]).groupby(
        "account_number", dropna=False
    ):
        last_balance = None
        for idx, row in g.iterrows():
            if row.get("line_type") == "marker":
                if row.get("balance") is not None:
                    last_balance = row["balance"]
                continue
            amount = row.get("amount")
            bal = row.get("balance")
            if amount is not None and bal is not None and last_balance is not None:
                expected = round(last_balance + amount, 2)
                provided = round(bal, 2)
                if abs(expected - provided) > tolerance:
                    mismatches.append(
                        {
                            "index": idx,
                            "account_number": acct,
                            "date": row.get("date"),
                            "description": row.get("description"),
                            "amount": amount,
                            "prev_balance": last_balance,
                            "expected_balance": expected,
                            "provided_balance": provided,
                            "delta": round(provided - expected, 2),
                        }
                    )
            if bal is not None:
                last_balance = bal
    return mismatches
