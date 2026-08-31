/** Public chart tokens emitted by every compatible host and overridden by skins as one palette. */
export const STATS_SERIES_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
] as const;

export const STATS_TREND_COLORS = {
  tokens: STATS_SERIES_COLORS[0],
  cost: STATS_SERIES_COLORS[1],
} as const;
