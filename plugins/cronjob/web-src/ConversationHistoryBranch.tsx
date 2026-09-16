import { Clock } from 'lucide-react';
import { runtime, type PluginHistoryBranchProps } from './runtime';

type Job = { jobId: string; name: string; enabled: boolean; href: string; run?: { sessionId: string; continuable: boolean } };
function parseJobs(items: readonly unknown[]): Job[] | null {
  const jobs = items.map((item): Job | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const value = item as Record<string, unknown>;
    if (typeof value.jobId !== 'string' || typeof value.name !== 'string' || typeof value.enabled !== 'boolean' || typeof value.href !== 'string') return null;
    const run = value.run;
    if (run === undefined) return { jobId: value.jobId, name: value.name, enabled: value.enabled, href: value.href };
    if (!run || typeof run !== 'object' || typeof (run as { sessionId?: unknown }).sessionId !== 'string' || typeof (run as { continuable?: unknown }).continuable !== 'boolean') return null;
    return { jobId: value.jobId, name: value.name, enabled: value.enabled, href: value.href, run: run as Job['run'] };
  });
  return jobs.every((job): job is Job => job !== null) ? jobs : null;
}

export function ConversationHistoryBranch({ parent, items, expanded, toggle, open }: PluginHistoryBranchProps) {
  const { components: C, hooks } = runtime();
  const strings = hooks.usePluginStrings('cronjob');
  const jobs = parseJobs(items);
  if (!jobs || jobs.length === 0) return null;
  return (
    <>
      <C.DataTableRow data-tree-row="jobs" data-parent-session={parent.id}><C.DataTableCell lines="auto" className="flex items-center gap-1.5" style={{ gridColumn: '1 / -1' }}><button type="button" onClick={toggle} aria-expanded={expanded} className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"><span aria-hidden>{expanded ? '⌄' : '›'}</span><span className="truncate">{strings.historyBranch}</span><span className="font-mono tabular-nums">{jobs.length}</span></button></C.DataTableCell></C.DataTableRow>
      {expanded ? jobs.map((job) => job.run ? <C.DataTableRow key={job.jobId} data-tree-row="job"><C.DataTableCell lines="auto" style={{ gridColumn: '1 / -1' }}><button type="button" onClick={() => open('session:' + encodeURIComponent(job.run?.sessionId ?? '') + ':' + (job.run?.continuable === true ? '1' : '0'))} className="flex min-w-0 items-center gap-1.5 text-left text-xs hover:text-primary"><Clock size={12} aria-hidden /><span className="truncate">{job.name}</span>{job.enabled ? null : <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-tiny text-muted-foreground">{strings.paused}</span>}</button></C.DataTableCell></C.DataTableRow> : <C.DataTableRow key={job.jobId} data-tree-row="job"><C.DataTableCell lines="auto" style={{ gridColumn: '1 / -1' }}><a href={job.href} className="flex min-w-0 items-center gap-1.5 text-left text-xs hover:text-primary"><Clock size={12} aria-hidden /><span className="truncate">{job.name}</span>{job.enabled ? null : <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-tiny text-muted-foreground">{strings.paused}</span>}</a></C.DataTableCell></C.DataTableRow>) : null}
    </>
  );
}