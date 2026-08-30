import { useState, type ReactNode } from 'react';

export interface PieDatum {
  id: string;
  label: string;
  value: number;
  valueLabel: string;
}

export interface PieSegment extends PieDatum {
  percentage: number;
  dashArray: string;
  dashOffset: number;
}

const COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
];

export function calculatePieSegments(data: PieDatum[]): PieSegment[] {
  const valid = data.filter((item) => Number.isFinite(item.value) && item.value > 0);
  const total = valid.reduce((sum, item) => sum + item.value, 0);
  let consumed = 0;
  return valid
    .sort((a, b) => b.value - a.value)
    .map((item) => {
      const percentage = (item.value / total) * 100;
      const segment = {
        ...item,
        percentage,
        dashArray: `${percentage} ${100 - percentage}`,
        dashOffset: -consumed,
      };
      consumed += percentage;
      return segment;
    });
}

/** `renderIcon` is how the host's ModelIcon reaches this file without importing the UI runtime here,
 *  which keeps the segment maths a pure function the tests can drive without a browser. */
export function PieChart({ title, data, emptyText, renderIcon }: {
  title: string;
  data: PieDatum[];
  emptyText: string;
  renderIcon?: (datum: PieDatum) => ReactNode;
}) {
  const segments = calculatePieSegments(data);
  const [activeId, setActiveId] = useState<string | null>(null);
  if (segments.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>;

  const active = segments.find((segment) => segment.id === activeId) ?? null;
  // Hovering either a slice or its legend row lights up the same model, so the pointer affordance works
  // from both halves of the figure while the legend stays the readable source for everyone else.
  const hover = (id: string | null) => () => setActiveId(id);

  return (
    <figure className="grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center" aria-label={title}>
      <div className="relative mx-auto h-36 w-36">
        <svg viewBox="0 0 42 42" role="img" aria-label={title} className="h-full w-full -rotate-90">
          <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--color-border)" strokeWidth="6" />
          {segments.map((segment, index) => (
            <circle
              key={segment.id}
              cx="21"
              cy="21"
              r="15.9155"
              fill="none"
              stroke={COLORS[index % COLORS.length]}
              strokeWidth={active?.id === segment.id ? 7.5 : 6}
              strokeDasharray={segment.dashArray}
              strokeDashoffset={segment.dashOffset}
              opacity={active && active.id !== segment.id ? 0.3 : 1}
              className="cursor-pointer transition-all duration-150"
              onMouseEnter={hover(segment.id)}
              onMouseLeave={hover(null)}
              aria-hidden
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-7 text-center">
          {active ? (
            <>
              {renderIcon?.(active)}
              <span className="font-mono text-sm tabular-nums text-foreground">{active.percentage.toFixed(1)}%</span>
              <span className="w-full truncate text-[0.65rem] text-muted-foreground">{active.valueLabel}</span>
            </>
          ) : null}
        </div>
      </div>
      <figcaption>
        <ul className="flex min-w-0 flex-col gap-2">
          {segments.map((segment, index) => (
            <li
              key={segment.id}
              className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-1 py-0.5 text-xs transition-colors ${active?.id === segment.id ? 'bg-muted' : 'hover:bg-muted'}`}
              onMouseEnter={hover(segment.id)}
              onMouseLeave={hover(null)}
            >
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLORS[index % COLORS.length] }} aria-hidden />
                {renderIcon?.(segment)}
              </span>
              <span className="truncate text-foreground" title={segment.label}>{segment.label}</span>
              <span className="whitespace-nowrap font-mono tabular-nums text-muted-foreground">
                {segment.percentage.toFixed(1)}% · {segment.valueLabel}
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
