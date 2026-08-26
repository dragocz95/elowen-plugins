import { useMemo } from 'react';
import { runtime } from '../runtime';
import type { DayUsage } from '../types';

const formatTokens = (value: number, locale: string) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const formatCost = (value: number | null, locale: string) => value == null
  ? '—'
  : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value);

/** Daily tokens against daily cost.
 *
 *  This used to be paired CSS bars, each normalised to its OWN maximum with no axis at all — so a
 *  full-height token bar beside a full-height cost bar said nothing about either, and "how much" was
 *  unanswerable without hovering every column. The host chart gives both series a real scale on their
 *  own axis, which is the whole reason the two units can share one canvas. */
export function UsageTrend({ data, locale, tokenLabel, costLabel, emptyText }: {
  data: DayUsage[];
  locale: string;
  tokenLabel: string;
  costLabel: string;
  emptyText: string;
}) {
  const { components: C } = runtime();
  const points = useMemo(() => data.map((row) => ({ label: row.day, tokens: row.tokens, cost: row.cost })), [data]);
  const series = useMemo(() => [
    { key: 'tokens', label: tokenLabel, colour: 'var(--color-accent)', variant: 'bar' as const, axis: 'left' as const, format: (value: number) => formatTokens(value, locale) },
    { key: 'cost', label: costLabel, colour: 'var(--color-warning)', variant: 'line' as const, axis: 'right' as const, format: (value: number) => formatCost(value, locale) },
  ], [costLabel, locale, tokenLabel]);

  return <C.TimeSeriesChart data={points} series={series} height={220} emptyText={emptyText} />;
}
