import { useMemo, useState } from 'react';
import { Github, GitPullRequest, Link2 } from 'lucide-react';
import { jsonBody, localizedError, runtime, type Checks, type Preview, type PullRequest, type RepositoryRow, type Session, type StatusResponse } from './runtime';
import { STATUS_KEY } from './GitHubConnectionPanel';

const REPOSITORIES_KEY = ['plugin', 'github', 'repositories'];
interface ProjectProp { id: number; slug: string; path: string }
interface MappingForm { projectId: number; baseOwner: string; baseName: string; pushOwner: string; pushName: string; baseRemote: string; pushRemote: string }
interface PendingAction { action: Record<string, unknown>; preview: Preview }
export function GitHubProjectPanel({ project }: { project: ProjectProp }) {
  const { components: C, hooks, api, utils, navigate } = runtime();
  const s = hooks.usePluginStrings('github');
  const { toast } = hooks.useToast();
  const qc = hooks.useQueryClient();
  const status = hooks.useQuery<StatusResponse>({ queryKey: STATUS_KEY, queryFn: () => api('/plugins/github/api/status') });
  const connected = status.data?.connected === true;

  const repositories = hooks.useQuery<{ repositories: RepositoryRow[] }>({
    queryKey: REPOSITORIES_KEY,
    queryFn: () => api('/plugins/github/api/repositories'),
    enabled: connected,
  });
  const row = repositories.data?.repositories.find((candidate) => candidate.project.id === project.id) ?? null;
  const mapped = row?.mapping?.active === true;
  const pulls = hooks.useQuery<{ pullRequests: PullRequest[] }>({
    queryKey: ['plugin', 'github', 'pulls', String(project.id), 'open'],
    queryFn: () => api(`/plugins/github/api/pull-requests?projectId=${project.id}&state=open`),
    enabled: connected && mapped,
  });
  const sessions = hooks.useQuery<Session[]>({
    queryKey: ['brain', 'sessions', 'github'],
    queryFn: () => api('/brain/sessions'),
    enabled: connected && mapped,
  });

  const [mapping, setMapping] = useState<MappingForm | null>(null);
  const [selectedPr, setSelectedPr] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ title: '', body: '', base: 'main' });
  const [reviewForm, setReviewForm] = useState({ event: 'APPROVE', body: '' });
  const [mergeMethod, setMergeMethod] = useState('squash');

  const selected = useMemo(() => (pulls.data?.pullRequests ?? []).find((pull) => pull.number === selectedPr) ?? null, [pulls.data, selectedPr]);
  const pullDetail = hooks.useQuery<PullRequest>({
    queryKey: ['plugin', 'github', 'pull', String(project.id), selectedPr],
    queryFn: () => api(`/plugins/github/api/pull-request?projectId=${project.id}&number=${selectedPr}`),
    enabled: connected && mapped && selectedPr !== null,
  });
  const checks = hooks.useQuery<Checks>({
    queryKey: ['plugin', 'github', 'checks', String(project.id), selectedPr],
    queryFn: () => api(`/plugins/github/api/checks?projectId=${project.id}&number=${selectedPr}`),
    enabled: connected && mapped && selectedPr !== null,
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: STATUS_KEY }),
      qc.invalidateQueries({ queryKey: REPOSITORIES_KEY }),
      qc.invalidateQueries({ queryKey: ['plugin', 'github', 'pulls'] }),
    ]);
  };
  const mutation = <TVars, TData = unknown>(fn: (value: TVars) => Promise<TData>, success?: string) => hooks.useMutation<TData, unknown, TVars>({
    mutationFn: fn,
    onSuccess: async () => { await invalidate(); if (success) toast(success); },
    onError: (error: unknown) => toast(localizedError(error, s), 'error'),
  });
  const saveMap = mutation<MappingForm>((value) => api('/plugins/github/api/repositories/map', jsonBody(value)), s.mappingSaved);
  const preview = hooks.useMutation<Preview, unknown, Record<string, unknown>>({
    mutationFn: (action: Record<string, unknown>) => api('/plugins/github/api/actions/preview', jsonBody(action)) as Promise<Preview>,
    onSuccess: (value: Preview, action: Record<string, unknown>) => setPending({ action, preview: value }),
    onError: (error: unknown) => toast(localizedError(error, s), 'error'),
  });
  const confirm = hooks.useMutation<unknown, unknown, { action: Record<string, unknown>; token: string }>({
    mutationFn: (value: { action: Record<string, unknown>; token: string }) => api('/plugins/github/api/actions/confirm', jsonBody({ ...value.action, confirmationToken: value.token })),
    onSuccess: async () => { setPending(null); setCreateOpen(false); await invalidate(); toast(s.actionComplete); },
    onError: async (error: unknown) => {
      const code = utils.apiErrorMessage(error);
      const statusCode = error && typeof error === 'object' && 'status' in error ? Number((error as { status?: unknown }).status) : 0;
      if (code === 'state_changed' || code === 'head_changed' || statusCode === 409) {
        setPending(null);
        await Promise.all([
          qc.invalidateQueries({ queryKey: REPOSITORIES_KEY }),
          qc.invalidateQueries({ queryKey: ['plugin', 'github', 'pulls'] }),
          qc.invalidateQueries({ queryKey: ['plugin', 'github', 'pull'] }),
          qc.invalidateQueries({ queryKey: ['plugin', 'github', 'checks'] }),
        ]);
      }
      toast(localizedError(error, s), 'error');
    },
  });

  if (status.isError) return <C.ErrorState message={s.loadError} onRetry={() => status.refetch()} />;
  if (status.isLoading) return <C.LoadingState variant="list" />;

  if (!connected) {
    return <div className="py-4"><C.EmptyState title={s.disconnected} description={s.accountHint} icon={Github} action={<C.Button variant="accent" icon={Github} onClick={() => navigate('/account')}>{s.manageInAccount}</C.Button>} /></div>;
  }

  if (repositories.isError) return <C.ErrorState message={s.loadError} onRetry={() => repositories.refetch()} />;
  if (repositories.isLoading || !row) return <C.LoadingState variant="list" />;

  const mappingLabel = row.mapping ? `${row.mapping.baseOwner}/${row.mapping.baseName}` : row.detected.base ? `${row.detected.base.owner}/${row.detected.base.name}` : '—';
  const pushLabel = row.mapping ? `${row.mapping.pushOwner}/${row.mapping.pushName}` : row.detected.push ? `${row.detected.push.owner}/${row.detected.push.name}` : '—';

  return <>
    <div className="space-y-4 py-4">
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="text-sm font-semibold text-text">{s.projectRepository}</h3><p className="mt-1 truncate font-mono text-xs text-text-muted">{mappingLabel}</p><p className="mt-1 truncate font-mono text-[11px] text-text-muted">{s.pushRepository}: {pushLabel}</p></div>
          <C.Badge tone={mapped ? 'success' : row.detected.ambiguous ? 'warning' : 'neutral'}>{mapped ? s.mappingHealthy : s.mappingMissing}</C.Badge>
        </div>
        <div className="mt-4 flex flex-wrap gap-2"><C.Button icon={Link2} onClick={() => setMapping(mappingFrom(row))}>{s.map}</C.Button>{row.mapping ? <a href={`https://github.com/${encodeURIComponent(row.mapping.baseOwner)}/${encodeURIComponent(row.mapping.baseName)}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center text-xs font-medium text-accent hover:underline">{s.openGitHub}</a> : null}</div>
      </section>

      {mapped ? <>
        <div className="flex flex-col gap-2"><C.SelectMenu value={sessionId} onChange={setSessionId} label={s.conversation} options={(sessions.data ?? []).map((session) => ({ value: session.id, label: session.title }))} /><div className="flex flex-wrap gap-2"><C.Button onClick={() => preview.mutate({ type: 'publish', projectId: project.id, sessionId })} disabled={!sessionId}>{s.publish}</C.Button><C.Button variant="accent" onClick={() => setCreateOpen(true)} disabled={!sessionId}>{s.createPullRequest}</C.Button></div></div>
        {pulls.isError ? <C.ErrorState message={s.loadError} onRetry={() => pulls.refetch()} /> : pulls.isLoading ? <C.LoadingState variant="list" /> : (pulls.data?.pullRequests ?? []).length === 0 ? <C.EmptyState title={s.noPullRequests} icon={GitPullRequest} /> : <C.DataTable ariaLabel={s.tabPullRequests} columns="minmax(0,1fr) minmax(8rem,.5fr)" compactColumns="minmax(0,1fr)"><C.DataTableRow header><C.DataTableCell header>{s.columnPullRequest}</C.DataTableCell><C.DataTableCell header priority="wide">{s.columnChecks}</C.DataTableCell></C.DataTableRow>{(pulls.data?.pullRequests ?? []).map((pull) => <C.DataTableRow key={pull.number} interactive tabIndex={0} onClick={() => setSelectedPr(pull.number)} onKeyDown={(event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedPr(pull.number); } }}><C.DataTableCell><div className="truncate text-sm font-medium text-text">#{pull.number} {pull.title}</div><div className="truncate font-mono text-[11px] text-text-muted">{pull.headRef} → {pull.baseRef}</div></C.DataTableCell><C.DataTableCell priority="wide"><C.Badge tone={pull.mergeable === false ? 'danger' : 'neutral'}>{pull.reviewDecision?.replace('_', ' ') ?? pull.mergeableState ?? 'unknown'}</C.Badge></C.DataTableCell></C.DataTableRow>)}</C.DataTable>}
      </> : <C.EmptyState title={s.mappingMissing} description={s.detectedRemotes} icon={Link2} action={<C.Button icon={Link2} onClick={() => setMapping(mappingFrom(row))}>{s.map}</C.Button>} />}
    </div>

    {mapping ? <C.Modal title={s.map} size="md" onClose={() => setMapping(null)}><C.ModalBody><div className="grid gap-3 sm:grid-cols-2"><C.Field label={`${s.baseRepository} · ${s.owner}`}><C.Input value={mapping.baseOwner} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setMapping({ ...mapping, baseOwner: event.target.value })} /></C.Field><C.Field label={`${s.baseRepository} · ${s.name}`}><C.Input value={mapping.baseName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setMapping({ ...mapping, baseName: event.target.value })} /></C.Field><C.Field label={`${s.pushRepository} · ${s.owner}`}><C.Input value={mapping.pushOwner} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setMapping({ ...mapping, pushOwner: event.target.value })} /></C.Field><C.Field label={`${s.pushRepository} · ${s.name}`}><C.Input value={mapping.pushName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setMapping({ ...mapping, pushName: event.target.value })} /></C.Field></div></C.ModalBody><C.ModalFooter><C.Button variant="ghost" onClick={() => setMapping(null)}>{s.cancel}</C.Button>{row.mapping ? <C.Button variant="danger" onClick={() => preview.mutate({ type: 'remove_mapping', projectId: project.id })}>{s.removeMapping}</C.Button> : null}<C.Button variant="accent" onClick={() => saveMap.mutate(mapping, { onSuccess: () => setMapping(null) })} disabled={!mapping.baseOwner || !mapping.baseName || !mapping.pushOwner || !mapping.pushName}>{s.saveMapping}</C.Button></C.ModalFooter></C.Modal> : null}

    {createOpen ? <C.Modal title={s.createPullRequest} size="md" onClose={() => setCreateOpen(false)}><C.ModalBody><C.Field label={s.pullRequestTitle}><C.Input autoFocus value={createForm.title} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCreateForm({ ...createForm, title: event.target.value })} /></C.Field><C.Field label={s.description}><textarea className="min-h-28 w-full rounded-md border border-border bg-bg p-3 text-sm text-text" value={createForm.body} onChange={(event) => setCreateForm({ ...createForm, body: event.target.value })} /></C.Field><C.Field label={s.baseBranch}><C.Input value={createForm.base} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCreateForm({ ...createForm, base: event.target.value })} /></C.Field></C.ModalBody><C.ModalFooter><C.Button variant="ghost" onClick={() => setCreateOpen(false)}>{s.cancel}</C.Button><C.Button variant="accent" disabled={!sessionId || !createForm.title.trim()} onClick={() => preview.mutate({ type: 'create_pr', projectId: project.id, sessionId, title: createForm.title, body: createForm.body, base: createForm.base })}>{s.createPullRequest}</C.Button></C.ModalFooter></C.Modal> : null}

    {selectedPr ? <C.Modal title={`#${selectedPr} ${selected?.title ?? ''}`} size="xl" onClose={() => setSelectedPr(null)}><C.ModalBody>{pullDetail.isError ? <C.ErrorState message={s.loadError} onRetry={() => pullDetail.refetch()} /> : pullDetail.isLoading ? <C.LoadingState variant="list" /> : pullDetail.data ? <div className="space-y-5"><p className="whitespace-pre-wrap text-sm text-text-muted">{pullDetail.data.body}</p><div className="flex flex-wrap gap-2"><C.Badge tone={checks.data?.state === 'success' ? 'success' : checks.data?.state === 'failure' ? 'danger' : 'warning'}>{checks.data?.state ?? 'pending'}</C.Badge><C.Badge>{pullDetail.data.headRef} → {pullDetail.data.baseRef}</C.Badge></div><section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{s.checks}</h3><div className="space-y-2">{(checks.data?.items ?? []).map((item) => <div key={item.name} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"><span className="font-medium text-text">{item.name}</span><C.Badge>{item.state}</C.Badge></div>)}</div></section><section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{s.changedFiles}</h3>{(pullDetail.data.files ?? []).map((file) => <div key={file.path} className="mb-3 overflow-hidden rounded-lg border border-border"><div className="border-b border-border px-3 py-2 font-mono text-xs text-text">{file.status} {file.path} <span className="text-success">+{file.additions}</span> <span className="text-danger">-{file.deletions}</span></div><C.PatchView diff={file.patch ?? ''} empty="No patch available." /></div>)}</section><C.Field label={s.reviewEvent}><C.SelectMenu value={reviewForm.event} onChange={(event: string) => setReviewForm({ ...reviewForm, event })} label={s.reviewEvent} options={[{ value: 'APPROVE', label: s.approve }, { value: 'REQUEST_CHANGES', label: s.requestChanges }, { value: 'COMMENT', label: s.comment }]} /></C.Field><C.Field label={s.description}><textarea className="min-h-20 w-full rounded-md border border-border bg-bg p-3 text-sm text-text" value={reviewForm.body} onChange={(event) => setReviewForm({ ...reviewForm, body: event.target.value })} /></C.Field><C.Field label={s.mergeMethod}><C.SelectMenu value={mergeMethod} onChange={setMergeMethod} label={s.mergeMethod} options={[{ value: 'squash', label: s.squash }, { value: 'merge', label: s.mergeCommit }, { value: 'rebase', label: s.rebase }]} /></C.Field></div> : null}</C.ModalBody><C.ModalFooter><C.Button variant="ghost" onClick={() => setSelectedPr(null)}>{s.cancel}</C.Button><C.Button onClick={() => preview.mutate({ type: 'review', projectId: project.id, number: selectedPr, event: reviewForm.event, body: reviewForm.body })}>{s.submitReview}</C.Button><C.Button variant="danger" onClick={() => preview.mutate({ type: 'merge', projectId: project.id, number: selectedPr, expectedHeadSha: pullDetail.data?.headSha, method: mergeMethod })} disabled={checks.data?.state !== 'success'}>{s.merge}</C.Button></C.ModalFooter></C.Modal> : null}

    {pending ? <C.ConfirmDialog open title={pending.preview.title || s.confirmExternal} description={`${pending.preview.description}\n\n${s.confirmationExpires}`} confirmLabel={s.confirm} onClose={() => setPending(null)} onConfirm={() => confirm.mutate({ action: pending.action, token: pending.preview.confirmationToken })} /> : null}
  </>;
}

function mappingFrom(row: RepositoryRow): MappingForm {
  return {
    projectId: row.project.id,
    baseOwner: row.mapping?.baseOwner ?? row.detected.base?.owner ?? '',
    baseName: row.mapping?.baseName ?? row.detected.base?.name ?? '',
    pushOwner: row.mapping?.pushOwner ?? row.detected.push?.owner ?? '',
    pushName: row.mapping?.pushName ?? row.detected.push?.name ?? '',
    baseRemote: row.detected.base?.remote ?? '',
    pushRemote: row.detected.push?.remote ?? '',
  };
}
