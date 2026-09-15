import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { DayCard } from './DayCard';
import { runtime, type CronJob, type CronWeekDay } from './runtime';

/** How many occurrences a day column shows before it folds the rest behind "+N more". A week of daily
 *  jobs repeats the SAME names in all seven columns, so a high cap buys no information and costs the
 *  whole grid its readability — the fold is the feature, and the reader expands one day at a time. */
const MAX_CARDS_PER_DAY = 3;

const parseDate = (label: string): Date => {
  const [year, month, day] = label.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const weekdayLabel = (label: string, locale: string): string =>
  new Intl.DateTimeFormat(locale || undefined, { weekday: 'short' }).format(parseDate(label));
const dayNumber = (label: string, locale: string): string =>
  new Intl.DateTimeFormat(locale || undefined, { day: 'numeric' }).format(parseDate(label));
const shortDay = (label: string, locale: string): string =>
  new Intl.DateTimeFormat(locale || undefined, { weekday: 'short', day: 'numeric', month: 'numeric' }).format(parseDate(label));

export function WeekGrid({ days, jobs, selectedDate, todayLocalDate, onSelectDate, onOpenJob, onRun, onToggle, onShowResult, onAddAt }: {
  days: CronWeekDay[];
  jobs: Map<string, CronJob>;
  selectedDate: string;
  todayLocalDate: string;
  onSelectDate(date: string): void;
  onOpenJob(jobId: string): void;
  onRun(job: CronJob): void;
  onToggle(job: CronJob): void;
  onShowResult(job: CronJob, localDate: string): void;
  /** Schedule something ON this day — the calendar's own way in, next to the header's New task menu. */
  onAddAt(localDate: string): void;
}) {
  const { hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { locale } = hooks.useTranslation();
  // At most ONE day is unfolded: expanding a second one would recreate the wall of cards the fold exists
  // to prevent, and the grid would jump in height on every click.
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const selectOffset = (offset: number) => {
    const index = days.findIndex((day) => day.localDate === selectedDate);
    const next = days[Math.min(Math.max(index + offset, 0), days.length - 1)];
    if (next) onSelectDate(next.localDate);
  };
  return (
    <div
      role="grid"
      aria-label={s.tabCalendar || 'Calendar'}
      className="grid min-w-0 grid-cols-7 overflow-hidden rounded-xl border border-border/80 bg-document"
      data-testid="cron-week-grid"
    >
      {days.map((day) => {
        const selected = day.localDate === selectedDate;
        const today = day.localDate === todayLocalDate;
        const expanded = expandedDate === day.localDate;
        const shown = expanded ? day.cards : day.cards.slice(0, MAX_CARDS_PER_DAY);
        const folded = day.dayTotal - shown.length;
        return (
          <div
            key={day.localDate}
            className={`flex min-w-0 flex-col border-l border-border/50 first:border-l-0 ${selected ? 'bg-primary/[0.03]' : ''}`}
          >
            <div role="columnheader">
              <button
                type="button"
                aria-current={selected ? 'date' : undefined}
                onClick={() => onSelectDate(day.localDate)}
                onKeyDown={(event: React.KeyboardEvent) => {
                  if (event.key === 'ArrowLeft') { event.preventDefault(); selectOffset(-1); }
                  if (event.key === 'ArrowRight') { event.preventDefault(); selectOffset(1); }
                }}
                className="flex w-full flex-col items-center gap-0.5 px-2 py-2.5 transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[var(--touch-target)]"
              >
                <span className={`text-[10px] font-medium uppercase tracking-[0.08em] ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {weekdayLabel(day.localDate, locale)}
                </span>
                <span
                  className={`flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition-colors ${
                    today ? 'bg-primary text-primary-foreground'
                      : selected ? 'bg-accent text-accent-foreground'
                        : 'text-foreground'
                  }`}
                >
                  {dayNumber(day.localDate, locale)}
                </span>
              </button>
            </div>
            <div className="flex min-h-[13rem] min-w-0 flex-1 flex-col gap-0.5 border-t border-border/50 p-1">
              {shown.map((card) => {
                const job = jobs.get(card.jobId);
                return job ? (
                  <DayCard
                    key={card.jobId}
                    card={card}
                    job={job}
                    localDate={day.localDate}
                    compact
                    onOpen={onOpenJob}
                    onRun={onRun}
                    onToggle={onToggle}
                    onShowResult={onShowResult}
                  />
                ) : null;
              })}
              {folded > 0 ? (
                <button
                  type="button"
                  className="mt-0.5 w-full rounded-md px-1.5 py-1 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[var(--touch-target)]"
                  data-testid={`cron-day-more-${day.localDate}`}
                  onClick={() => { setExpandedDate(day.localDate); onSelectDate(day.localDate); }}
                >
                  {(s.dayMoreCards || '+{n} more').replace('{n}', String(folded))}
                </button>
              ) : null}
              {expanded && day.dayTotal > MAX_CARDS_PER_DAY ? (
                <button
                  type="button"
                  className="mt-0.5 w-full rounded-md px-1.5 py-1 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[var(--touch-target)]"
                  onClick={() => setExpandedDate(null)}
                >
                  {s.dayShowLess || 'Show less'}
                </button>
              ) : null}
              {/* The rest of the column is the day's own "schedule something here": a calendar cell is where
                  a reader expects to click to add, and the free space is exactly the part of it that means
                  "nothing here yet". It stays a real button with a dated label, so it is reachable by
                  keyboard and readable out loud rather than being a mystery click target. */}
              <button
                type="button"
                data-testid={`cron-day-add-${day.localDate}`}
                onClick={() => { onSelectDate(day.localDate); onAddAt(day.localDate); }}
                aria-label={(s.dayAddTask || 'Schedule a task on {date}').replace('{date}', shortDay(day.localDate, locale))}
                className="group/add flex min-h-8 flex-1 items-start justify-center rounded-md pt-1 text-muted-foreground/0 transition-colors hover:bg-accent/60 hover:text-muted-foreground focus-visible:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:text-muted-foreground/60"
              >
                <Plus size={14} aria-hidden />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MobileDayStrip({ days, selectedDate, todayLocalDate, onSelectDate }: {
  days: CronWeekDay[];
  selectedDate: string;
  todayLocalDate: string;
  onSelectDate(date: string): void;
}) {
  const { hooks } = runtime();
  const { locale } = hooks.useTranslation();
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { selectedRef.current?.scrollIntoView?.({ inline: 'center', block: 'nearest' }); }, [selectedDate]);
  return (
    <div className="flex snap-x gap-2 overflow-x-auto pb-2" data-testid="cron-day-strip">
      {days.map((day) => {
        const selected = day.localDate === selectedDate;
        const today = day.localDate === todayLocalDate;
        return (
          <button
            key={day.localDate}
            ref={selected ? selectedRef : undefined}
            type="button"
            aria-current={selected ? 'date' : undefined}
            onClick={() => onSelectDate(day.localDate)}
            className={`flex min-h-[44px] min-w-[4rem] snap-center flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 pointer-coarse:min-h-[var(--touch-target)] ${selected ? 'border-primary/60 bg-primary/10' : 'border-border/70 bg-card'}`}
          >
            <span className="sr-only">{shortDay(day.localDate, locale)}</span>
            <span aria-hidden className={`text-[10px] font-medium uppercase tracking-[0.08em] ${selected ? 'text-primary' : 'text-muted-foreground'}`}>
              {weekdayLabel(day.localDate, locale)}
            </span>
            <span
              aria-hidden
              className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${today ? 'bg-primary text-primary-foreground' : selected ? 'text-primary' : 'text-foreground'}`}
            >
              {dayNumber(day.localDate, locale)}
            </span>
            <span aria-hidden className={`size-1 rounded-full ${day.dayTotal > 0 ? 'bg-muted-foreground/60' : 'bg-transparent'}`} />
          </button>
        );
      })}
    </div>
  );
}
