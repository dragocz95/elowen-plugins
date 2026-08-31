/** Runtime colour tokens guaranteed by the host skin contract.
 *
 * Plugin bundles are compiled separately from the host, so Tailwind's tree-shaken `--color-chart-*`
 * theme variables may not exist when only the plugin references them. These semantic/brand tokens are
 * emitted by every skin and keep charts coloured without hard-coding a palette into the bundle. */
export const STATS_SERIES_COLORS = [
  'var(--color-primary)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-info)',
  'var(--color-ember)',
] as const;

export const STATS_TREND_COLORS = {
  tokens: STATS_SERIES_COLORS[0],
  cost: STATS_SERIES_COLORS[1],
} as const;
