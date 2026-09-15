import { useEffect, useRef } from 'react';
import { DayCard } from './DayCard';
import { runtime, type CronJob, type CronWeekDay } from './runtime';

const MAX_CARDS_PER_DAY = 6;
const parseDate = (label: string): Date => {
  const [year, month, day] = label.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const shortDay = (label: string, locale: string): string =>
  new Intl.DateTimeFormat(locale || undefined, { weekday: 'short', day: 'numeric', month: 'numeric' }).format(parseDate(label));

export function WeekGrid({ days, jobs, selectedDate, onSelectDate, onOpenJob, onRun, onToggle }: {
  days: CronWeekDay[];
  jobs: Map<string, CronJob>;
  selectedDate: string;
  onSelectDate(date: string): void;
  onOpenJob(jobId: string): void;
  onRun(job: CronJob): void;
  onToggle(job: CronJob): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { locale } = hooks.useTranslation();
  const selectOffset = (offset: number) => {
    const index = days.findIndex((day) => day.localDate === selectedDate);
    const next = days[Math.min(Math.max(index + offset, 0), days.length - 1)];
    if (next) onSelectDate(next.localDate);
  };
  return (
    <div
      role="grid"
      aria-label={s.tabCalendar || 'Calendar'}
      className="grid min-w-0 grid-cols-7 overflow-hidden rounded-lg border border-border/80 bg-document"
      data-testid="cron-week-grid"
    >
      {days.map((day) => {
        const selected = day.localDate === selectedDate;
        const shown = day.cards.slice(0, MAX_CARDS_PER_DAY);
        return (
          <div
            key={day.localDate}
            className={`min-w-0 border-l border-border/60 first:border-l-0 ${selected ? 'bg-primary/[0.035]' : ''}`}
            onClick={() => onSelectDate(day.localDate)}
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
                className={`min-h-[44px] w-full border-t-2 px-2 py-2 text-center text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[var(--touch-target)] ${selected ? 'border-t-primary bg-primary/10 text-primary' : 'border-t-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
              >
                {shortDay(day.localDate, locale)}
              </button>
            </div>
            <div className="flex min-h-[22rem] min-w-0 flex-col gap-1.5 border-t border-border/60 p-1.5">
              {shown.map((card) => {
                const job = jobs.get(card.jobId);
                return job ? (
                  <DayCard
                    key={card.jobId}
                    card={card}
                    job={job}
                    compact
                    onOpen={onOpenJob}
                    onRun={onRun}
                    onToggle={onToggle}
                  />
                ) : null;
              })}
              {day.dayTotal > MAX_CARDS_PER_DAY ? (
                <C.Button
                  variant="ghost"
                  size="sm"
                  className="min-h-[44px] w-full pointer-coarse:min-h-[var(--touch-target)]"
                  onClick={() => onSelectDate(day.localDate)}
                >
                  {(s.dayMoreCards || '+{n} more').replace('{n}', String(day.dayTotal - MAX_CARDS_PER_DAY))}
                </C.Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MobileDayStrip({ days, selectedDate, onSelectDate }: {
  days: CronWeekDay[];
  selectedDate: string;
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
        return (
          <button
            key={day.localDate}
            ref={selected ? selectedRef : undefined}
            type="button"
            aria-current={selected ? 'date' : undefined}
            onClick={() => onSelectDate(day.localDate)}
            className={`min-h-[44px] min-w-[4.5rem] snap-center rounded-md border px-2 py-2 text-xs font-medium pointer-coarse:min-h-[var(--touch-target)] ${selected ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground'}`}
          >
            {shortDay(day.localDate, locale)}
          </button>
        );
      })}
    </div>
  );
}
