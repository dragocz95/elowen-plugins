import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { runtime, type CronDayCard, type CronIntervalRow, type CronJob, type CronRunRow, type CronWeekDay } from './runtime';

const parseDate = (label: string): Date => {
  const [year, month, day] = label.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const dayTitle = (label: string, locale: string): string =>
  new Intl.DateTimeFormat(locale || undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(parseDate(label));
const status = (outcome: CronRunRow['outcome'], s: Record<string, string>): string => ({
  waiting: s.runWaiting || 'Waiting',
  running: s.runRunning || 'Running',
  ok: s.runOk || 'Succeeded',
  error: s.runErrorState || 'Failed',
  skipped: s.runSkipped || 'Skipped',
})[outcome];
const tone = (outcome: CronRunRow['outcome']): string =>
  outcome === 'ok' ? 'success' : outcome === 'error' ? 'danger' : outcome === 'running' ? 'accent' : 'muted';

type WaitingRow = { key: string; job: CronJob; time: string; source: CronDayCard | CronIntervalRow };

export function DayPanel({ day, todayLocalDate, intervals, jobs, runs, loading, hasMore, onLoadMore, selectedJobId, onSelectJob, onOpenRun, onOpenJob, onPreviousDay, onNextDay, mobile = false }: {
  day: CronWeekDay;
  todayLocalDate: string;
  intervals: CronIntervalRow[];
  jobs: Map<string, CronJob>;
  runs: CronRunRow[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore(): void;
  selectedJobId: string | null;
  onSelectJob(jobId: string): void;
  onOpenRun(run: CronRunRow): void;
  onOpenJob(jobId: string): void;
  onPreviousDay(): void;
  onNextDay(): void;
  mobile?: boolean;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { locale } = hooks.useTranslation();
  const waiting: WaitingRow[] = [
    ...day.cards
      .filter((card) => card.state === 'waiting' || card.state === 'paused')
      .map((card) => ({ key: `card-${card.jobId}`, job: jobs.get(card.jobId)!, time: card.localTime, source: card }))
      .filter((row) => row.job),
    ...intervals
      .filter((row) => row.nextLocalTime && jobs.has(row.jobId))
      .map((row) => ({ key: `interval-${row.jobId}`, job: jobs.get(row.jobId)!, time: row.nextLocalTime!, source: row })),
  ].sort((a, b) => a.time.localeCompare(b.time));
  const selectedJob = selectedJobId ? jobs.get(selectedJobId) : undefined;
  const plannedCount = day.dayTotal + intervals.filter((row) => row.enabled).length;
  const countCopy = plannedCount === 1
    ? (s.dayScheduledOne || '1 scheduled task')
    : (s.dayScheduledCount || '{n} scheduled tasks').replace('{n}', String(plannedCount));

  return (
    <aside
      className={mobile ? 'flex min-w-0 flex-col gap-4' : 'flex min-w-0 flex-col gap-4 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto'}
      data-testid="cron-day-panel"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold capitalize text-foreground">{dayTitle(day.localDate, locale)}</h2>
          <p className="text-xs text-muted-foreground">{countCopy}</p>
        </div>
        <div className="flex gap-1">
          <C.IconButton icon={ChevronLeft} label={s.dayPrevious || 'Previous day'} onClick={onPreviousDay} />
          <C.IconButton icon={ChevronRight} label={s.dayNext || 'Next day'} onClick={onNextDay} />
        </div>
      </header>
      <div className="border-t border-border/60 pt-3">
        {loading && runs.length === 0 ? <C.LoadingState variant="list" /> : runs.length === 0 && waiting.length === 0 ? (
          <C.EmptyState
            title={s.dayNothing || 'Nothing ran or is scheduled for this day'}
            description={day.localDate < todayLocalDate ? (s.dayBeforeHistory || 'Run history is recorded from this upgrade onward.') : undefined}
          />
        ) : (
          <C.EntityList>
            {runs.map((run) => (
              <C.EntityRow key={run.id}>
                <button
                  type="button"
                  className="grid min-h-[44px] w-full min-w-0 grid-cols-[3.5rem_0.5rem_minmax(0,1fr)_auto] items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[var(--touch-target)]"
                  onClick={() => { onSelectJob(run.jobId); onOpenRun(run); }}
                  data-testid={`cron-run-${run.id}`}
                >
                  <span className="font-mono text-xs tabular-nums">{run.localTime}</span>
                  <span className={`size-2 rounded-full ${run.outcome === 'ok' ? 'bg-emerald-500' : run.outcome === 'error' ? 'bg-destructive' : run.outcome === 'running' ? 'animate-pulse bg-primary' : 'border border-muted-foreground'}`} />
                  <span className="truncate text-sm">{run.owner?.name || s.ownerSystem || 'System'} · {run.jobName}</span>
                  <C.Badge tone={tone(run.outcome)}>{status(run.outcome, s)}</C.Badge>
                </button>
              </C.EntityRow>
            ))}
            {waiting.map((row) => (
              <C.EntityRow key={row.key}>
                <button
                  type="button"
                  className="grid min-h-[44px] w-full min-w-0 grid-cols-[3.5rem_0.5rem_minmax(0,1fr)_auto] items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[var(--touch-target)]"
                  onClick={() => { onSelectJob(row.job.id); onOpenJob(row.job.id); }}
                >
                  <span className="font-mono text-xs tabular-nums">{row.time}</span>
                  <span className="size-2 rounded-full border border-muted-foreground" />
                  <span className="truncate text-sm">{row.job.owner?.name || s.ownerSystem || 'System'} · {row.job.name}</span>
                  <C.Badge tone="muted">{row.job.enabled === false ? s.paused : s.runWaiting}</C.Badge>
                </button>
              </C.EntityRow>
            ))}
          </C.EntityList>
        )}
        {hasMore ? <C.Button variant="ghost" className="mt-2 w-full" onClick={onLoadMore}>{s.loadOlder || 'Load older'}</C.Button> : null}
      </div>
      {selectedJob ? (
        <section className="flex min-w-0 flex-col gap-3 border-t border-border/60 pt-4" data-testid="cron-selected-job">
          <div className="flex items-center gap-2">
            <C.Avatar name={selectedJob.owner?.name || s.ownerSystem || 'System'} src={selectedJob.owner?.avatar || undefined} />
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold">{selectedJob.name}</h3>
              <p className="truncate text-xs text-muted-foreground">{selectedJob.owner?.name || s.ownerSystem || 'System'}</p>
            </div>
          </div>
          <dl className="grid gap-2 text-sm">
            <div><dt className="text-xs text-muted-foreground">{s.schedule}</dt><dd>{selectedJob.schedule}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{s.nextRun}</dt><dd>{selectedJob.nextOccurrence?.localDate} {selectedJob.nextOccurrence?.localTime || '—'}</dd></div>
          </dl>
          <p className="line-clamp-4 text-sm text-muted-foreground">{selectedJob.prompt}</p>
          <C.Button variant="outline" icon={ExternalLink} onClick={() => onOpenJob(selectedJob.id)}>
            {s.runOpenJob || 'Open job'}
          </C.Button>
        </section>
      ) : null}
    </aside>
  );
}
