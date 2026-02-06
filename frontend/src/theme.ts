// Centralized theme configuration for charts and UI.
// Consolidates all color definitions and theming constants for visual consistency.

// Primary color palette
export const COLORS = {
  // Main accent colors
  accent: "#ffb347",           // Amber (filtered charts)
  base: "#384656",             // Dark slate
  
  // Semantic colors
  positive: "#5ad67d",         // Green (income, gains)
  negative: "#ff6b6b",         // Red (spending, losses)
  neutral: "#9d7ef7",          // Purple (other)
  
  // Savings variants
  savings: "#5fbfa6",          // Teal
  savingsLight: "#7fd4bc",     // Light teal
  
  // Categorical
  category1: "#a7c957",        // Olive
  muted: "#bcc5d0",            // Gray
  
  // Text & background
  text: "#e6e9ee",             // Light text
  textDim: "#8a91a0",          // Dimmed text
  background: "rgba(0,0,0,0)", // Transparent
};

// Plot/chart styling
export const PLOT_COLORS = {
  accent: "#ffb347",
  positive: "#5ad67d",
  negative: "#ff6b6b",
  grid: "#1f2833",
  line: "#314051",
  text: "#e6e9ee",
  hoverBg: "#2a3847",
  hoverBorder: "#ffb347",
  markerEdge: "#1a1f28",
  alt: "#9d7ef7",              // Alternate/cumulative
};

// Color sequence for multi-series charts
export const CHART_COLOR_SEQUENCE = [
  COLORS.accent,
  COLORS.positive,
  COLORS.neutral,
  COLORS.negative,
  COLORS.base,
  "#888888",
];

// Layout template for Plotly charts
export const PLOT_LAYOUT_DARK = {
  paper_bgcolor: COLORS.background,
  plot_bgcolor: COLORS.background,
  font: { color: PLOT_COLORS.text, size: 12 },
  xaxis: {
    gridcolor: PLOT_COLORS.grid,
    zerolinecolor: PLOT_COLORS.grid,
    linecolor: PLOT_COLORS.line,
  },
  yaxis: {
    gridcolor: PLOT_COLORS.grid,
    zerolinecolor: PLOT_COLORS.grid,
    linecolor: PLOT_COLORS.line,
  },
  legend: { font: { color: PLOT_COLORS.text }, orientation: "h" as const, y: 1.12 },
  margin: { l: 50, r: 16, t: 50, b: 40 },
};

export default { COLORS, PLOT_COLORS, CHART_COLOR_SEQUENCE, PLOT_LAYOUT_DARK };
