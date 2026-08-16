import { useState } from 'react';
import type { DayUsage } from '../types';

const formatTokens = (value: number, locale: string) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const formatCost = (value: number | null, locale: string) => value == null
  ? '—'
  : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value);

export function UsageTrend({ data, locale, tokenLabel, costLabel, emptyText }: {
  data: DayUsage[];
  locale: string;
  tokenLabel: string;
  costLabel: string;
  emptyText: string;
}) {
  const [activeDay, setActiveDay] = useState<string | null>(null);
  if (data.length === 0) return <p className="py-10 text-center text-sm text-text-muted">{emptyText}</p>;
  const maxTokens = Math.max(1, ...data.map((row) => row.tokens));
  const maxCost = Math.max(0.000001, ...data.map((row) => row.cost ?? 0));
  const active = data.find((row) => row.day === activeDay) ?? null;
  // Reading a day used to mean waiting out the browser's native `title` bubble. Tracking the hover in
  // React instead makes it instant and matches how the pie reads, which is the whole point of a pair
  // of charts sitting on one page.
  const hover = (day: string | null) => () => setActiveDay(day);

  return (
    <figure className="flex min-w-0 flex-col gap-3">
      <figcaption className="flex min-w-0 items-center gap-4 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent" aria-hidden />{tokenLabel}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-warning" aria-hidden />{costLabel}</span>
        {active ? (
          <span className="ml-auto flex min-w-0 items-center gap-3 font-mono tabular-nums">
            <span className="truncate text-text">{active.day}</span>
            <span className="whitespace-nowrap text-accent">{formatTokens(active.tokens, locale)}</span>
            <span className="whitespace-nowrap text-warning">{formatCost(active.cost, locale)}</span>
          </span>
        ) : null}
      </figcaption>
      <div className="flex h-36 min-w-0 items-end gap-1 overflow-hidden border-b border-border px-1" aria-hidden>
        {data.map((row) => (
          <div
            key={row.day}
            className="flex h-full min-w-[3px] flex-1 cursor-pointer items-end justify-center gap-px transition-opacity duration-150"
            style={{ opacity: active && active.day !== row.day ? 0.3 : 1 }}
            onMouseEnter={hover(row.day)}
            onMouseLeave={hover(null)}
          >
            <span className="w-1/2 min-w-px rounded-t-sm bg-accent" style={{ height: `${Math.max(2, (row.tokens / maxTokens) * 100)}%` }} />
            <span className="w-1/2 min-w-px rounded-t-sm bg-warning" style={{ height: `${row.cost == null ? 0 : Math.max(2, (row.cost / maxCost) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-text-muted" aria-hidden>
        <span>{data[0]?.day}</span><span>{data[data.length - 1]?.day}</span>
      </div>
      <ul className="sr-only">
        {data.map((row) => <li key={row.day}>{row.day}: {tokenLabel} {formatTokens(row.tokens, locale)}, {costLabel} {formatCost(row.cost, locale)}</li>)}
      </ul>
    </figure>
  );
}
