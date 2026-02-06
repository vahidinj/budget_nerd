"""Plotly visualization helpers for the statement parser app."""

from __future__ import annotations


import pandas as pd
import plotly.express as px
from plotly.graph_objects import Figure, Scatter
from .utils import ensure_dates

###############################################################################
# Theming & palette
###############################################################################

PRIMARY_ACCENT = "#ffb347"  # amber (matches frontend filtered color)
PRIMARY_BASE = "#384656"  # dark slate (matches frontend overall color)
POSITIVE = "#5ad67d"
NEGATIVE = "#ff6b6b"
NEUTRAL = "#9d7ef7"
TEXT_COLOR = "#e6e9ee"
GRID_COLOR = "#1f2833"
AXIS_LINE = "#314051"

COLOR_SEQUENCE = [PRIMARY_ACCENT, POSITIVE, NEUTRAL, NEGATIVE, PRIMARY_BASE, "#888888"]

_DARK_LAYOUT: dict = {
    "paper_bgcolor": "rgba(0,0,0,0)",
    "plot_bgcolor": "rgba(0,0,0,0)",
    "font": {"color": TEXT_COLOR, "size": 12},
    "xaxis": {
        "gridcolor": GRID_COLOR,
        "zerolinecolor": GRID_COLOR,
        "linecolor": AXIS_LINE,
    },
    "yaxis": {
        "gridcolor": GRID_COLOR,
        "zerolinecolor": GRID_COLOR,
        "linecolor": AXIS_LINE,
    },
    "legend": {"font": {"color": TEXT_COLOR}, "orientation": "h", "y": 1.12},
    "margin": {"l": 50, "r": 16, "t": 50, "b": 40},
}


def _rgba(hex_color: str, alpha: float) -> str:
    """Convert a hex color like "#ffb347" to an rgba string with given alpha.

    Falls back to the original hex if parsing fails.
    """
    try:
        hex_clean = hex_color.lstrip("#")
        if len(hex_clean) == 3:  # short form
            hex_clean = "".join(c * 2 for c in hex_clean)
        r = int(hex_clean[0:2], 16)
        g = int(hex_clean[2:4], 16)
        b = int(hex_clean[4:6], 16)
        return f"rgba({r},{g},{b},{alpha})"
    except Exception:  # pragma: no cover - defensive
        return hex_color


def _adaptive_nticks(height: int | None) -> int | None:
    """Heuristic number of y (or x for horizontal bars) ticks based on chart height."""
    if not height:
        return None
    if height < 220:
        return 4
    if height < 340:
        return 6
    return 8


def _abbrev_format(value: float) -> str:
    """Return abbreviated string (4.2K, 1.3M) for axis tick display.

    Uses decimal units (K, M, B). Handles negatives gracefully.
    """
    try:
        num = float(value)
    except Exception:
        return str(value)
    sign = "-" if num < 0 else ""
    num = abs(num)
    for unit, thresh in [("B", 1_000_000_000), ("M", 1_000_000), ("K", 1_000)]:
        if num >= thresh:
            return f"{sign}{num / thresh:.1f}{unit}".replace(".0", "")
    return f"{sign}{num:.0f}"


def _apply_abbrev_axis(fig: Figure, axis: str = "y") -> None:
    """Apply abbreviated tick labels to specified axis (in-place) while keeping hover intact.

    Axis should be 'x' or 'y'. Works by enabling automargin then setting tickformat via ticktext override
    computed from auto-generated tickvals after initial layout pass. For static export, this is approximate.
    """
    ax = fig.layout[axis + "axis"]
    tickvals = getattr(ax, "tickvals", None)
    if tickvals:
        fig.update_layout(
            {axis + "axis": dict(ticktext=[_abbrev_format(v) for v in tickvals])}
        )
    else:
        fig.update_layout({axis + "axis": dict(tickformat="~s")})


def _apply_dark(
    fig: Figure,
    title: str | None = None,
    height: int | None = None,
    *,
    show_legend: bool = True,
) -> Figure:
    """Apply the shared dark layout + title/height.

    Parameters
    ----------
    fig:
        The figure to mutate (returned for chaining).
    title:
        Optional title text.
    height:
        Optional fixed pixel height.
    show_legend:
        Whether to keep legend visible (some single‑trace charts can hide it for clarity).
    """
    fig.update_layout(_DARK_LAYOUT, showlegend=show_legend)
    if title:
        fig.update_layout(
            title={"text": title, "font": {"color": TEXT_COLOR, "size": 16}}
        )
    if height:
        fig.update_layout(height=height)
    return fig


def _ensure_dates(df: pd.DataFrame, date_col: str = "date") -> pd.DataFrame:
    return ensure_dates(df, date_col)


def _placeholder(msg: str) -> Figure:
    """Uniform placeholder for missing column scenarios."""
    fig = px.scatter(title=msg)
    return _apply_dark(fig, msg, 260, show_legend=False)


def _daily_aggregate(df: pd.DataFrame, date_col: str, amount_col: str) -> pd.DataFrame:
    """Aggregate amount by (normalized) date including cumulative sum.

    Returns a DataFrame with columns: ``date``, ``daily_amount``, ``cumulative``.
    Rows with NA dates or amounts are dropped prior to aggregation.
    """
    df2 = df.dropna(subset=[date_col, amount_col])
    if df2.empty:
        return pd.DataFrame(columns=["date", "daily_amount", "cumulative"])
    g = (
        df2.groupby(df2[date_col].dt.date)[amount_col]
        .sum()
        .reset_index(name="daily_amount")
        .rename(columns={date_col: "date"})
        .sort_values("date")
    )
    g["cumulative"] = g["daily_amount"].cumsum()
    return g


def daily_amount_line(
    df: pd.DataFrame, date_col: str = "date", amount_col: str = "amount"
) -> Figure:
    """Line chart of daily net amount with cumulative overlay.

    Optimized to build only one base figure and append a cumulative ``Scatter`` trace
    instead of creating a second full PX figure.
    """
    if date_col not in df.columns or amount_col not in df.columns:
        return _placeholder("Daily Net Amount (missing columns)")
    df = _ensure_dates(df, date_col)
    g = _daily_aggregate(df, date_col, amount_col)
    if g.empty:
        return _placeholder("Daily Net Amount (no valid rows)")
    fig = px.line(
        g, x="date", y="daily_amount", markers=True, color_discrete_sequence=[POSITIVE]
    )
    # Subtle area fill (simulated gradient by semi‑transparent fill to zero)
    if fig.data:
        fill_rgba = _rgba(POSITIVE, 0.18)
        fig.data[0].update(fill="tozeroy", fillcolor=fill_rgba)
    # Add cumulative as dotted overlay & interactivity aids
    # Add cumulative as dotted overlay
    fig.add_trace(
        Scatter(
            x=g["date"],
            y=g["cumulative"],
            name="Cumulative",
            mode="lines",
            line=dict(dash="dot", color=PRIMARY_ACCENT),
            hovertemplate="Cumulative %{x}<br>%{y:,.2f}<extra></extra>",
        )
    )
    fig.update_traces(
        hovertemplate="Daily %{x}<br>%{y:,.2f}<extra></extra>",
        selector=dict(name="daily_amount"),
    )
    height = 300
    fig = _apply_dark(fig, "Daily Net Amount", height)
    # Unified hover shows both traces when hovering any x
    fig.update_layout(hovermode="x unified")
    # Legend behavior: single click isolates trace, double toggles default
    fig.update_layout(legend=dict(itemclick="toggleothers", itemdoubleclick="toggle"))
    # Range selector buttons (All resets to full range)
    fig.update_xaxes(
        rangeselector=dict(
            buttons=[
                dict(count=7, step="day", stepmode="backward", label="7d"),
                dict(count=30, step="day", stepmode="backward", label="30d"),
                dict(step="all", label="All"),
            ]
        ),
        rangeslider=dict(visible=False),
        type="date",
    )
    # Adaptive tick density
    nt = _adaptive_nticks(height)
    if nt:
        fig.update_yaxes(nticks=nt)
    _apply_abbrev_axis(fig, "y")
    return fig


def account_type_breakdown(df: pd.DataFrame, amount_col: str = "amount") -> Figure:
    """Pie chart of summed amounts per ``account_type`` with consistent ordering.

    Slices are ordered by descending absolute contribution for readability.
    """
    if "account_type" not in df.columns or amount_col not in df.columns:
        return _placeholder("Account Type Breakdown (missing columns)")
    g = (
        df.dropna(subset=["account_type", amount_col])
        .groupby("account_type")[amount_col]
        .sum()
        .reset_index()
    )
    if g.empty:
        return _placeholder("Account Type Breakdown (no data)")
    g["abs_val"] = g[amount_col].abs()
    g.sort_values("abs_val", ascending=False, inplace=True)
    fig = px.pie(
        g,
        names="account_type",
        values=amount_col,
        color="account_type",
        color_discrete_sequence=COLOR_SEQUENCE,
        hole=0.35,
    )
    fig.update_traces(textposition="inside", textinfo="percent+label")
    return _apply_dark(fig, "Amount by Account Type", 300)


def top_descriptions_bar(
    df: pd.DataFrame,
    amount_col: str = "amount",
    desc_col: str = "description",
    n: int = 10,
) -> Figure:
    """Horizontal bar chart of top N descriptions by summed amount.

    The bars are displayed ascending vertically for legibility while the numeric
    selection is based on descending totals.
    """
    if desc_col not in df.columns or amount_col not in df.columns:
        return _placeholder("Top Descriptions (missing columns)")
    g = (
        df.dropna(subset=[desc_col, amount_col])
        .groupby(desc_col)[amount_col]
        .sum()
        .reset_index()
        .sort_values(amount_col, ascending=False)
        .head(n)
        .sort_values(amount_col)  # final order for horizontal display
    )
    if g.empty:
        return _placeholder("Top Descriptions (no data)")
    fig = px.bar(
        g,
        x=amount_col,
        y=desc_col,
        orientation="h",
        text=amount_col,
        color=desc_col,
        color_discrete_sequence=COLOR_SEQUENCE,
    )
    fig.update_traces(
        texttemplate="%{text:,.2f}",
        textposition="outside",
        cliponaxis=False,
        marker_line=dict(color=AXIS_LINE, width=1),
    )
    fig.update_layout(margin=dict(l=10, r=16, t=55, b=10))
    height = 350
    fig = _apply_dark(fig, f"Top {len(g)} Descriptions by Amount", height)
    # Abbreviate axis ticks (amount axis is x for horizontal bars)
    _apply_abbrev_axis(fig, "x")
    # Truncate long labels with ellipsis but keep full in hover
    max_label = 24
    full_labels = list(g[desc_col])
    truncated = [
        lbl if len(lbl) <= max_label else lbl[: max_label - 1] + "…"
        for lbl in full_labels
    ]
    fig.update_yaxes(ticktext=truncated, tickvals=full_labels, automargin=True)
    # Provide custom hover template with full label
    fig.update_traces(hovertemplate="%{y}<br>%{x:,.2f}<extra></extra>")
    # Adaptive ticks for x axis
    nt = _adaptive_nticks(height)
    if nt:
        fig.update_xaxes(nticks=nt)
    return fig


def filtered_vs_total_bar(
    df: pd.DataFrame, filtered_df: pd.DataFrame, amount_col: str = "amount"
) -> Figure:
    """Horizontal bar comparing filtered vs overall net amounts.

    Adds an inline delta annotation when the values materially differ.
    """
    if amount_col not in df.columns:
        return _placeholder("Filtered vs Overall (missing amount)")
    total = df[amount_col].dropna().sum()
    filtered = (
        filtered_df[amount_col].dropna().sum()
        if amount_col in filtered_df.columns
        else 0
    )
    # Ensure consistent ordering (Filtered always first / left)
    categories = ["Filtered", "Overall"]
    data = pd.DataFrame({"Category": categories, "Amount": [filtered, total]})
    data["Category"] = pd.Categorical(
        data["Category"], categories=categories, ordered=True
    )
    fig = px.bar(
        data,
        x="Amount",
        y="Category",
        orientation="h",
        text="Amount",
        color="Category",
        color_discrete_map={"Filtered": PRIMARY_ACCENT, "Overall": PRIMARY_BASE},
    )
    fig.update_layout(yaxis=dict(categoryorder="array", categoryarray=categories))
    fig.update_traces(
        texttemplate="%{text:,.2f}", textposition="outside", cliponaxis=False
    )
    if abs(filtered - total) > 1e-9:
        delta = filtered - total
        sign = "+" if delta > 0 else ""
        fig.add_annotation(
            x=max(filtered, total),
            y=0.5,
            text=f"Delta {sign}{delta:,.2f}",
            showarrow=False,
            xanchor="left",
            font=dict(color=TEXT_COLOR),
        )
    fig.update_layout(margin=dict(l=10, r=16, t=55, b=16))
    fig = _apply_dark(fig, "Filtered vs Overall Net Amount", 300)
    _apply_abbrev_axis(fig, "x")
    return fig


__all__ = [
    "daily_amount_line",
    "account_type_breakdown",
    "top_descriptions_bar",
    "filtered_vs_total_bar",
]
