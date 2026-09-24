import { useEffect, useMemo, useState } from 'react';
import { RunResultModal } from './RunResultModal';
import { runsUrl } from './runsApi';
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
  useEffect(() => { setPage(0); }, [query, owner, outcome, range, todayLocalDate]);
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
  // A register can be shorter than the offset the reader is standing on — a filter narrowed it, or rows
  // were deleted since — and the request above would keep asking for a page past the end. The answer is an
  // empty page whose footer disables both arrows, because the pager clamps only what it DRAWS, so a
  // filter the reader cannot page away from would be a dead end. An empty page is therefore pulled back
  // onto the last page that holds rows, and only ever when an answer actually ARRIVED and is empty:
  // while a new page is in flight there is no data at all, and clamping on that absence would hold the
  // reader on page one for good.
  const lastPage = request.data ? Math.max(0, Math.ceil(request.data.total / pageSize) - 1) : 0;
  useEffect(() => {
    if (!request.data || rows.length > 0 || page <= lastPage) return;
    setPage(lastPage);
  }, [lastPage, page, request.data, rows.length]);
  const format = useMemo(() => new Intl.DateTimeFormat(locale || undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  }), [locale]);

  // Error before loading, and both before the register: a failed read owes the reader Retry rather than
  // an empty table, and the two states stand in the same place the register would.
  if (request.isError) {
    return (
      <C.ControlSurfaceDocument>
        <C.ControlSurfaceState tone="danger">
          <C.ErrorState message={t.common.daemonUnreachable} onRetry={() => request.refetch()} />
        </C.ControlSurfaceState>
      </C.ControlSurfaceDocument>
    );
  }
  if (!request.data) {
    return (
      <C.ControlSurfaceDocument>
        <C.ControlSurfaceState><C.LoadingState variant="cards" /></C.ControlSurfaceState>
      </C.ControlSurfaceDocument>
    );
  }

  return (
    <C.ControlSurfaceDocument>
      <C.ControlSurfaceRegister className="flex flex-col gap-3" data-testid="cron-history-tab">
        {rows.length === 0 ? (
          <C.EmptyState
            title={s.historyEmpty || 'No run history'}
            description={s.historyEmptyHint || 'Run history is recorded from this upgrade onward.'}
          />
        ) : (
          <C.DataTable
            ariaLabel={s.tabHistory}
            columns="11rem minmax(0,2fr) minmax(0,1fr) 6rem 8rem minmax(0,1fr) 1.25rem"
            // The compact register keeps the receipt, the state and the chevron: a run is identified by
            // what ran and whether it worked, and the trailing track is what makes the row openable by
            // the same affordance every register in the app uses.
            compactColumns="minmax(0,1fr) 6rem 1.25rem"
          >
            <C.DataTableRow header>
              <C.DataTableCell header lines={1} priority="wide">{s.colTime || 'Time'}</C.DataTableCell>
              <C.DataTableCell header lines={1}>{s.name}</C.DataTableCell>
              <C.DataTableCell header lines={1} priority="wide">{s.colOwner || 'Owner'}</C.DataTableCell>
              <C.DataTableCell header lines={1} priority="wide">{s.colDuration || 'Duration'}</C.DataTableCell>
              <C.DataTableCell header lines={1}>{s.colState || 'Status'}</C.DataTableCell>
              <C.DataTableCell header lines={1} priority="wide">{s.colModel || 'Model'}</C.DataTableCell>
              {/* The trailing open affordance: an affordance, not a column, so its header is empty. */}
              <C.DataTableCell header lines={1} aria-hidden>{null}</C.DataTableCell>
            </C.DataTableRow>
            {rows.map((run) => (
              <C.DataTableRow key={run.id} height="tall" onOpen={() => setSelected(run)} openLabel={run.jobName}>
                <C.DataTableCell lines="auto" priority="wide" className="font-mono text-xs">{format.format(new Date(run.startedAt))}</C.DataTableCell>
                <C.DataTableCell lines="auto"><span className="font-medium">{run.jobName}</span><span className="text-caption text-muted-foreground">{run.schedule || s.badgeOneShot}</span></C.DataTableCell>
                <C.DataTableCell lines="auto" priority="wide">{run.owner?.name || s.ownerSystem || 'System'}</C.DataTableCell>
                <C.DataTableCell lines={1} priority="wide">{run.durationMs === null ? '—' : `${Math.round(run.durationMs / 100) / 10} s`}</C.DataTableCell>
                <C.DataTableCell lines="auto"><C.Badge tone={tone(run)}>{statusLabel(run, s)}</C.Badge></C.DataTableCell>
                <C.DataTableCell lines={1} priority="wide">{run.model || '—'}</C.DataTableCell>
                <C.DataTableChevronCell />
              </C.DataTableRow>
            ))}
          </C.DataTable>
        )}
        {/* A register the reader has paged past the end of still owes them the way back, so the footer
            follows the rows the SERVER says exist rather than the ones this page happens to hold. */}
        {request.data.total > 0 ? (
          <C.Pager
            page={page}
            pageSize={pageSize}
            total={request.data.total}
            onPageChange={setPage}
            onPageSizeChange={(size: number) => { setPage(0); setPageSize(size); }}
            ariaLabel={s.tabHistory}
          />
        ) : null}
      </C.ControlSurfaceRegister>
      {selected ? (
        <RunResultModal
          run={selected}
          job={jobs.get(selected.jobId)}
          onClose={() => setSelected(null)}
          onOpenJob={(jobId) => { setSelected(null); onOpenJob(jobId); }}
          onRun={onRun}
        />
      ) : null}
    </C.ControlSurfaceDocument>
  );
}
