import { ArrowRight } from 'lucide-react';
import { runtime, type CronIntervalRow, type CronJob } from './runtime';

/** Interval jobs are not occurrences OF a day: one of them fires hundreds of times, on every day of the
 *  week alike. Listing them in the columns would bury the timed work, so they live once under the
 *  calendar. The next fire has its own calendar day, so its time is shown only when that day is the one
 *  the reader is looking at. */
export function IntervalsStrip({ intervals, jobs, referenceDate, onOpenJob }: {
  intervals: CronIntervalRow[];
  jobs: Map<string, CronJob>;
  referenceDate: string;
  onOpenJob(jobId: string): void;
}) {
  const { hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const rows = intervals.filter((row) => jobs.has(row.jobId));
  if (rows.length === 0) return null;
  return (
    <section className="flex min-w-0 flex-col gap-2" data-testid="cron-intervals-strip">
      <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{s.intervalsTitle || 'Recurring jobs'}</h3>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((row) => {
          const job = jobs.get(row.jobId)!;
          const nextHere = row.nextLocalTime && row.nextLocalDate === referenceDate ? row.nextLocalTime : null;
          const state = row.enabled ? '' : ` · ${s.paused}`;
          return (
            <button
              key={row.jobId}
              type="button"
              onClick={() => onOpenJob(row.jobId)}
              className={`flex min-h-8 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[var(--touch-target)] ${row.enabled ? 'text-foreground' : 'text-muted-foreground opacity-70'}`}
              aria-label={`${(s.openJob || 'Open “{name}”').replace('{name}', job.name)} · ${row.intervalLabel}${nextHere ? ` · ${s.nextRun || 'Next run'} ${nextHere}` : ''}${state}`}
            >
              <span className="truncate">{job.name}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{row.intervalLabel}</span>
              {nextHere ? (
                <span className="flex items-center gap-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                  <ArrowRight size={11} aria-hidden />{nextHere}
                </span>
              ) : null}
              {row.enabled ? null : <span className="text-[11px]">{s.paused}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
