import { useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { RunResultModal } from './RunResultModal';
import { runsUrl } from './useRunFeed';
import { shiftDate } from './CalendarTab';
import { runtime, type CronJob, type CronRunRow, type CronRunsResponse } from './runtime';

const statusLabel = (run: CronRunRow, s: Record<string, string>): string => ({
  waiting: s.runWaiting || 'Waiting',
  running: s.runRunning || 'Running',
  ok: s.runOk || 'Succeeded',
  error: s.runErrorState || 'Failed',
  skipped: s.runSkipped || 'Skipped',
})[run.outcome];
const tone = (run: CronRunRow): string =>
  run.outcome === 'ok' ? 'success' : run.outcome === 'error' ? 'danger' : run.outcome === 'running' ? 'accent' : 'muted';

export function HistoryTab({ query, owner, outcome, range, todayLocalDate, jobs, onOpenJob, onRun }: {
  query: string;
  owner: 'all' | 'mine' | 'instance';
  outcome: 'all' | 'ok' | 'error' | 'skipped';
  range: 'today' | '7' | '30';
  todayLocalDate: string;
  jobs: Map<string, CronJob>;
  onOpenJob(jobId: string): void;
  onRun(job: CronJob): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { t, locale } = hooks.useTranslation();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<CronRunRow | null>(null);
  const from = range === 'today' ? todayLocalDate : shiftDate(todayLocalDate, -(Number(range) - 1));
  const request = hooks.useQuery<CronRunsResponse>({
    queryKey: ['cron-runs-history', query, owner, outcome, range, page, pageSize, todayLocalDate],
    queryFn: () => runtime().api(runsUrl({
      from,
      to: todayLocalDate,
      q: query || undefined,
      owner: owner === 'all' ? undefined : owner,
      outcome: outcome === 'all' ? undefined : outcome,
      limit: pageSize,
      offset: page * pageSize,
    })) as Promise<CronRunsResponse>,
    staleTime: 10_000,
  });
  const rows = request.data?.runs ?? [];
  const format = useMemo(() => new Intl.DateTimeFormat(locale || undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  }), [locale]);

  if (request.isError) return <C.ErrorState message={t.common.daemonUnreachable} onRetry={() => request.refetch()} />;
  if (!request.data) return <C.LoadingState variant="list" />;

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="cron-history-tab">
      {rows.length === 0 ? (
        <C.EmptyState
          title={s.historyEmpty || 'No run history'}
          description={s.historyEmptyHint || 'Run history is recorded from this upgrade onward.'}
        />
      ) : (
        <C.DataTable
          ariaLabel={s.tabHistory}
          columns="11rem minmax(0,2fr) minmax(0,1fr) 6rem 8rem minmax(0,1fr) 3rem"
        >
          <C.DataTableRow header>
            <C.DataTableCell header lines={1} priority="wide">{s.colTime || 'Time'}</C.DataTableCell>
            <C.DataTableCell header lines={1}>{s.name}</C.DataTableCell>
            <C.DataTableCell header lines={1} priority="wide">{s.colOwner || 'Owner'}</C.DataTableCell>
            <C.DataTableCell header lines={1} priority="wide">{s.colDuration || 'Duration'}</C.DataTableCell>
            <C.DataTableCell header lines={1}>{s.colState || 'Status'}</C.DataTableCell>
            <C.DataTableCell header lines={1} priority="wide">{s.colModel || 'Model'}</C.DataTableCell>
            <C.DataTableCell header lines={1} aria-hidden />
          </C.DataTableRow>
          {rows.map((run) => (
            <C.DataTableRow key={run.id} height="tall" onOpen={() => setSelected(run)} openLabel={run.jobName}>
              <C.DataTableCell lines="auto" priority="wide" className="font-mono text-xs">{format.format(new Date(run.startedAt))}</C.DataTableCell>
              <C.DataTableCell lines="auto"><span className="font-medium">{run.jobName}</span><span className="text-[11px] text-muted-foreground">{run.schedule || s.badgeOneShot}</span></C.DataTableCell>
              <C.DataTableCell lines="auto" priority="wide">{run.owner?.name || s.ownerInstance}</C.DataTableCell>
              <C.DataTableCell lines={1} priority="wide">{run.durationMs === null ? '—' : `${Math.round(run.durationMs / 100) / 10} s`}</C.DataTableCell>
              <C.DataTableCell lines="auto"><C.Badge tone={tone(run)}>{statusLabel(run, s)}</C.Badge></C.DataTableCell>
              <C.DataTableCell lines={1} priority="wide">{run.model || '—'}</C.DataTableCell>
              <C.DataTableCell lines="auto"><MoreHorizontal size={14} aria-hidden /></C.DataTableCell>
            </C.DataTableRow>
          ))}
        </C.DataTable>
      )}
      <C.Pager
        page={page}
        pageSize={pageSize}
        total={request.data.total}
        onPageChange={setPage}
        onPageSizeChange={(size: number) => { setPage(0); setPageSize(size); }}
        ariaLabel={s.tabHistory}
      />
      {selected ? (
        <RunResultModal
          run={selected}
          job={jobs.get(selected.jobId)}
          onClose={() => setSelected(null)}
          onOpenJob={(jobId) => { setSelected(null); onOpenJob(jobId); }}
          onRun={onRun}
        />
      ) : null}
    </div>
  );
}
