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
  'var(--color-accent)',
  'var(--color-info)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-danger)',
  'var(--color-text-muted)',
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

export function PieChart({ title, data, emptyText }: { title: string; data: PieDatum[]; emptyText: string }) {
  const segments = calculatePieSegments(data);
  if (segments.length === 0) return <p className="py-10 text-center text-sm text-text-muted">{emptyText}</p>;

  return (
    <figure className="grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center" aria-label={title}>
      <svg viewBox="0 0 42 42" role="img" aria-label={title} className="mx-auto h-36 w-36 -rotate-90">
        <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--color-border)" strokeWidth="6" />
        {segments.map((segment, index) => (
          <circle
            key={segment.id}
            cx="21"
            cy="21"
            r="15.9155"
            fill="none"
            stroke={COLORS[index % COLORS.length]}
            strokeWidth="6"
            strokeDasharray={segment.dashArray}
            strokeDashoffset={segment.dashOffset}
            aria-hidden
          />
        ))}
      </svg>
      <figcaption>
        <ul className="flex min-w-0 flex-col gap-2">
          {segments.map((segment, index) => (
            <li key={segment.id} className="grid min-w-0 grid-cols-[0.75rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLORS[index % COLORS.length] }} aria-hidden />
              <span className="truncate text-text" title={segment.label}>{segment.label}</span>
              <span className="whitespace-nowrap font-mono tabular-nums text-text-muted">
                {segment.percentage.toFixed(1)}% · {segment.valueLabel}
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
