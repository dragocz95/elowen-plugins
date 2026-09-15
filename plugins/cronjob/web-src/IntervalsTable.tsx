import { Pencil, Play } from 'lucide-react';
import { runtime, type CronIntervalRow, type CronJob } from './runtime';

export function IntervalsTable({ rows, jobs, onOpen, onRun }: {
  rows: CronIntervalRow[];
  jobs: Map<string, CronJob>;
  onOpen(jobId: string): void;
  onRun(job: CronJob): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  return (
    <section className="flex min-w-0 flex-col gap-3" data-testid="cron-intervals-table">
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{s.intervalsTitle || 'Recurring jobs'}</h2>
            <C.Badge tone="muted">{rows.length}</C.Badge>
          </div>
          <p className="text-xs text-muted-foreground">{s.intervalsHint || 'These jobs run on an interval.'}</p>
        </div>
      </header>
      {rows.length === 0 ? <C.EmptyState title={s.historyEmpty || 'No matching jobs'} /> : (
        <C.DataTable
          ariaLabel={s.intervalsTitle}
          columns="minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 7rem minmax(0,1fr) 3rem"
        >
          <C.DataTableRow header>
            <C.DataTableCell header lines={1}>{s.name}</C.DataTableCell>
            <C.DataTableCell header lines={1}>{s.colSchedule || 'Interval'}</C.DataTableCell>
            <C.DataTableCell header lines={1} priority="mobile">{s.colNext || 'Next run'}</C.DataTableCell>
            <C.DataTableCell header lines={1} priority="mobile">{s.colState || 'Status'}</C.DataTableCell>
            <C.DataTableCell header lines={1} priority="wide">{s.colOwner || 'Owner'}</C.DataTableCell>
            <C.DataTableCell header lines={1} aria-hidden />
          </C.DataTableRow>
          {rows.map((row) => {
            const job = jobs.get(row.jobId)!;
            const owner = job.owner?.name || s.ownerInstance;
            return (
              <C.DataTableRow key={row.jobId} height="tall" onOpen={() => onOpen(row.jobId)} openLabel={(s.openJob || 'Open “{name}”').replace('{name}', job.name)}>
                <C.DataTableCell lines="auto">
                  <span className="truncate text-sm font-medium">{job.name}</span>
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><C.Avatar size={20} name={owner} src={job.owner?.avatar || undefined} />{owner}</span>
                </C.DataTableCell>
                <C.DataTableCell lines={1}>{row.intervalLabel}</C.DataTableCell>
                <C.DataTableCell lines="auto" priority="mobile" title={row.nextExpectedAt || undefined}>{row.nextLocalTime || '—'}</C.DataTableCell>
                <C.DataTableCell lines="auto" priority="mobile"><C.Badge tone={row.enabled ? 'success' : 'muted'}>{row.enabled ? s.metricActive : s.paused}</C.Badge></C.DataTableCell>
                <C.DataTableCell lines="auto" priority="wide"><span className="flex items-center gap-1"><C.Avatar size={20} name={owner} src={job.owner?.avatar || undefined} />{owner}</span></C.DataTableCell>
                <C.DataTableCell lines="auto">
                  <C.ActionMenu variant="kebab" items={[
                    { id: 'run', label: s.runNow, icon: Play, onSelect: () => onRun(job) },
                    { id: 'edit', label: s.edit || 'Edit', icon: Pencil, onSelect: () => onOpen(job.id) },
                  ]} />
                </C.DataTableCell>
              </C.DataTableRow>
            );
          })}
        </C.DataTable>
      )}
    </section>
  );
}
