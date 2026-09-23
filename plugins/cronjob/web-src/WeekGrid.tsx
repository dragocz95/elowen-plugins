import { useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import { DayCard } from './DayCard';
import { runtime, type CronJob, type CronWeekDay } from './runtime';

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
  onShowResult(job: CronJob, localDate: string, localTime: string): void;
  /** Schedule something ON this day — the calendar's own way in, next to the header's New task menu. */
  onAddAt(localDate: string): void;
}) {
  const { hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { locale } = hooks.useTranslation();
  const selectOffset = (offset: number) => {
    const index = days.findIndex((day) => day.localDate === selectedDate);
    const next = days[Math.min(Math.max(index + offset, 0), days.length - 1)];
    if (next) onSelectDate(next.localDate);
  };
  return (
    // NOT `role="grid"`: a day column holds a variable number of entries and none of them is a cell in a
    // shared row, so the grid pattern's rows, cells and focus contract cannot be honoured here. Each day is
    // a labelled region instead, which is what this actually is — seven small agendas side by side.
    <div
      aria-label={s.tabCalendar || 'Calendar'}
      className="grid min-w-0 grid-cols-7 overflow-hidden rounded-xl border border-hairline bg-raised"
      data-testid="cron-week-grid"
    >
      {days.map((day) => {
        const selected = day.localDate === selectedDate;
        const today = day.localDate === todayLocalDate;
        return (
          <section
            key={day.localDate}
            aria-label={shortDay(day.localDate, locale)}
            className={`flex min-w-0 flex-col border-l border-border/50 first:border-l-0 ${selected ? 'bg-primary/[0.03]' : ''}`}
          >
            <div>
              <button
                type="button"
                aria-current={selected ? 'date' : undefined}
                onClick={() => onSelectDate(day.localDate)}
                onKeyDown={(event: React.KeyboardEvent) => {
                  if (event.key === 'ArrowLeft') { event.preventDefault(); selectOffset(-1); }
                  if (event.key === 'ArrowRight') { event.preventDefault(); selectOffset(1); }
                }}
                className="flex w-full flex-col items-center gap-0.5 px-2 py-2.5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[var(--touch-target)]"
              >
                <span className={`text-meta font-medium uppercase tracking-[0.08em] ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
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
                {/* Today is drawn as a filled disc; colour alone is not an accessible distinction, so the
                    word travels with it. */}
                {today ? <span className="sr-only">{s.calToday || 'Today'}</span> : null}
              </button>
            </div>
            {/* Every occurrence of the day is listed: the column grows with the day's work instead of
                folding the rest away, so the week is read in one look. */}
            <div className="flex min-h-[13rem] min-w-0 flex-1 flex-col gap-0.5 border-t border-border/50 p-1">
              {day.cards.map((card) => {
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
              {/* The rest of the column is the day's own "schedule something here": a calendar cell is where
                  a reader expects to click to add, and the free space is exactly the part of it that means
                  "nothing here yet". It stays a real button with a dated label, so it is reachable by
                  keyboard and readable out loud rather than being a mystery click target. */}
              <button
                type="button"
                data-testid={`cron-day-add-${day.localDate}`}
                onClick={() => { onSelectDate(day.localDate); onAddAt(day.localDate); }}
                aria-label={(s.dayAddTask || 'Schedule a task on {date}').replace('{date}', shortDay(day.localDate, locale))}
                className="group/add flex min-h-8 flex-1 items-start justify-center rounded-md pt-1 text-muted-foreground/0 transition-colors hover:bg-accent hover:text-muted-foreground focus-visible:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:text-muted-foreground/60"
              >
                <Plus size={14} aria-hidden />
              </button>
            </div>
          </section>
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
            className={`flex min-h-[44px] min-w-[4rem] snap-center flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 pointer-coarse:min-h-[var(--touch-target)] ${selected ? 'border-primary/60 bg-primary/10' : 'border-border/70 bg-control'}`}
          >
            <span className="sr-only">{shortDay(day.localDate, locale)}</span>
            <span aria-hidden className={`text-meta font-medium uppercase tracking-[0.08em] ${selected ? 'text-primary' : 'text-muted-foreground'}`}>
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
