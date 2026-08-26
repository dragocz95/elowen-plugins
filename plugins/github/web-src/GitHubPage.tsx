import { useMemo, useState } from 'react';
import { FolderGit2, Github, GitPullRequest, Link2, Search, ShieldCheck } from 'lucide-react';
import { jsonBody, localizedError, runtime, type Checks, type Preview, type PullRequest, type RepositoryRow, type Session, type StatusResponse } from './runtime';

const STATUS_KEY = ['plugin', 'github', 'status'];
const REPOSITORIES_KEY = ['plugin', 'github', 'repositories'];

type Tab = 'overview' | 'repositories' | 'pulls';
interface MappingForm { projectId: number; baseOwner: string; baseName: string; pushOwner: string; pushName: string; baseRemote: string; pushRemote: string }
interface PendingAction { action: Record<string, unknown>; preview: Preview }

export function GitHubPage() {
  const { components: C, hooks, api } = runtime();
  const s = hooks.usePluginStrings('github');
  const { toast } = hooks.useToast();
  const qc = hooks.useQueryClient();
  const me = hooks.useMe();
  const status = hooks.useQuery<StatusResponse>({ queryKey: STATUS_KEY, queryFn: () => api('/plugins/github/api/status') });
  const connected = status.data?.connected === true;
  const [tab, setTab] = useState<Tab>('overview');
  const [secret, setSecret] = useState('');
  const [mapping, setMapping] = useState<MappingForm | null>(null);
  const [projectFilter, setProjectFilter] = useState('');
  const [prState, setPrState] = useState('open');
  const [search, setSearch] = useState('');
  const [selectedPr, setSelectedPr] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [publishSession, setPublishSession] = useState('');
  const [createForm, setCreateForm] = useState({ title: '', body: '', base: '' });
  const [reviewForm, setReviewForm] = useState({ event: 'APPROVE', body: '' });
  const [mergeMethod, setMergeMethod] = useState('squash');
  const [connectionTest, setConnectionTest] = useState<{ rateLimit: { limit: number; remaining: number; reset: number } | null } | null>(null);

  const repositories = hooks.useQuery<{ repositories: RepositoryRow[] }>({
    queryKey: REPOSITORIES_KEY, queryFn: () => api('/plugins/github/api/repositories'), enabled: connected,
  });
  const rows = repositories.data?.repositories ?? [];
  const mapped = rows.filter((row) => row.mapping?.active);
  const activeProject = projectFilter || String(mapped[0]?.project.id ?? '');
  const pulls = hooks.useQuery<{ pullRequests: PullRequest[] }>({
    queryKey: ['plugin', 'github', 'pulls', activeProject, prState],
    queryFn: () => api(`/plugins/github/api/pull-requests?projectId=${encodeURIComponent(activeProject)}&state=${prState}`),
    enabled: connected && !!activeProject && tab === 'pulls',
  });
  const detail = hooks.useQuery<PullRequest>({
    queryKey: ['plugin', 'github', 'pull', activeProject, selectedPr],
    queryFn: () => api(`/plugins/github/api/pull-request?projectId=${encodeURIComponent(activeProject)}&number=${selectedPr}`),
    enabled: connected && !!activeProject && !!selectedPr && tab === 'pulls',
  });
  const checks = hooks.useQuery<Checks>({
    queryKey: ['plugin', 'github', 'checks', activeProject, selectedPr],
    queryFn: () => api(`/plugins/github/api/checks?projectId=${encodeURIComponent(activeProject)}&number=${selectedPr}`),
    enabled: connected && !!activeProject && !!selectedPr && tab === 'pulls',
  });
  const sessions = hooks.useQuery<Session[]>({ queryKey: ['brain', 'sessions', 'github'], queryFn: () => api('/brain/sessions'), enabled: connected });

  const invalidate = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: STATUS_KEY }), qc.invalidateQueries({ queryKey: REPOSITORIES_KEY }), qc.invalidateQueries({ queryKey: ['plugin', 'github', 'pulls'] })]);
  };
  const mutation = <TVars, TData = unknown>(fn: (value: TVars) => Promise<TData>, success?: string) => hooks.useMutation<TData, unknown, TVars>({
    mutationFn: fn,
    onSuccess: async () => { await invalidate(); if (success) toast(success); },
    onError: (error: unknown) => toast(localizedError(error, s), 'error'),
  });
  const saveSecret = mutation<{ clientSecret: string }>((value) => api('/plugins/github/api/setup/secret', jsonBody(value)) as Promise<unknown>, s.secretSaved);
  const test = hooks.useMutation<{ rateLimit: { limit: number; remaining: number; reset: number } | null }, unknown, void>({
    mutationFn: () => api('/plugins/github/api/test', jsonBody({})) as Promise<{ rateLimit: { limit: number; remaining: number; reset: number } | null }>,
    onSuccess: (value: { rateLimit: { limit: number; remaining: number; reset: number } | null }) => { setConnectionTest(value); toast(s.connectionHealthy); },
    onError: (error: unknown) => toast(localizedError(error, s), 'error'),
  });
  const saveMap = mutation<MappingForm>((value) => api('/plugins/github/api/repositories/map', jsonBody(value)) as Promise<unknown>, s.mappingSaved);
  const preview = hooks.useMutation<Preview, unknown, Record<string, unknown>>({
    mutationFn: (action: Record<string, unknown>) => api('/plugins/github/api/actions/preview', jsonBody(action)) as Promise<Preview>,
    onSuccess: (value: Preview, action: Record<string, unknown>) => setPending({ action, preview: value }),
    onError: (error: unknown) => toast(localizedError(error, s), 'error'),
  });
  const confirm = mutation<{ action: Record<string, unknown>; token: string }>((value) => api('/plugins/github/api/actions/confirm', jsonBody({ ...value.action, confirmationToken: value.token })) as Promise<unknown>, s.actionComplete);
  const connect = mutation<{ replaceIdentity?: boolean; reconnect?: boolean; confirmationToken?: string }, { authorizeUrl: string }>((value) => api('/plugins/github/api/auth/start', jsonBody(value)) as Promise<{ authorizeUrl: string }>);

  const beginConnect = () => connect.mutate(status.data?.reconnectRequired ? { reconnect: true } : {}, { onSuccess: (value) => window.location.assign(value.authorizeUrl) });
  const beginReplace = () => preview.mutate({ type: 'replace_identity' });
  const completePending = () => {
    if (!pending) return;
    if (pending.action.type === 'replace_identity') {
      connect.mutate({ replaceIdentity: true, confirmationToken: pending.preview.confirmationToken }, { onSuccess: (value) => window.location.assign(value.authorizeUrl) });
      return;
    }
    confirm.mutate({ action: pending.action, token: pending.preview.confirmationToken }, { onSuccess: () => setPending(null) });
  };

  const filteredPulls = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (pulls.data?.pullRequests ?? []).filter((pull) => !needle || [pull.title, pull.author, pull.headRef, String(pull.number)].some((value) => value.toLowerCase().includes(needle)));
  }, [pulls.data, search]);

  if (status.isError) return <C.ErrorState message={s.loadError} onRetry={() => status.refetch()} />;
  if (status.isLoading) return <C.LoadingState variant="page" />;

  const overview = (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,.7fr)]">
      <section className="rounded-2xl border border-border bg-surface p-5">
        {connected && status.data?.account ? (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              {status.data.account.avatarUrl ? <img src={status.data.account.avatarUrl} alt="" className="size-14 rounded-full border border-border" /> : <Github className="size-12" />}
              <div className="min-w-0"><div className="truncate text-lg font-semibold text-text">{status.data.account.name || status.data.account.login}</div><div className="text-sm text-text-muted">@{status.data.account.login}</div></div>
              <C.Badge tone={status.data.reconnectRequired ? 'danger' : 'success'}>{status.data.reconnectRequired ? s.reconnectRequired : s.connected}</C.Badge>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2 text-sm">
              <div><dt className="text-text-muted">{s.tokenExpiry}</dt><dd className="text-text">{new Date(status.data.account.tokenExpiresAt).toLocaleString()}</dd></div>
              <div><dt className="text-text-muted">{s.refreshExpiry}</dt><dd className="text-text">{new Date(status.data.account.refreshExpiresAt).toLocaleString()}</dd></div>
              <div><dt className="text-text-muted">{s.mappings}</dt><dd className="font-mono text-text">{status.data.mappings}</dd></div>
              <div><dt className="text-text-muted">GitHub ID</dt><dd className="font-mono text-text">{status.data.account.githubUserId}</dd></div>
              {connectionTest?.rateLimit ? <div><dt className="text-text-muted">{s.rateLimit}</dt><dd className="font-mono text-text">{connectionTest.rateLimit.remaining} / {connectionTest.rateLimit.limit}</dd></div> : null}
            </dl>
            <div className="flex flex-wrap gap-2"><C.Button onClick={() => test.mutate()} disabled={test.isPending}>{s.testConnection}</C.Button><C.Button onClick={beginReplace}>{s.replaceIdentity}</C.Button><C.Button variant="danger" onClick={() => preview.mutate({ type: 'disconnect' })}>{s.disconnect}</C.Button></div>
          </div>
        ) : (
          <C.EmptyState title={status.data?.reconnectRequired ? s.reconnectRequired : s.disconnected} description={status.data?.setup.configured ? s.intro : s.setupHint} icon={Github} action={<C.Button variant="accent" onClick={beginConnect} disabled={!status.data?.setup.configured}>{status.data?.reconnectRequired ? s.reconnect : s.connect}</C.Button>} />
        )}
      </section>
      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-4 flex items-center gap-2"><ShieldCheck size={18} className="text-accent" /><h2 className="font-semibold text-text">GitHub App</h2></div>
        <div className="space-y-3 text-sm"><div><div className="text-text-muted">{s.callbackUrl}</div><code className="block break-all rounded-lg bg-bg p-2 text-xs text-text">{status.data?.setup.callbackUrl ?? s.setupIncomplete}</code></div>
          {me.data?.user?.is_admin ? <><C.Field label={s.clientSecret}><C.Input type="password" value={secret} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSecret(event.target.value)} /></C.Field><C.Button onClick={() => saveSecret.mutate({ clientSecret: secret }, { onSuccess: () => setSecret('') })} disabled={saveSecret.isPending || secret.length < 20}>{s.saveSecret}</C.Button></> : null}
        </div>
      </section>
    </div>
  );

  const repositoriesView = !connected ? <C.EmptyState title={s.disconnected} description={s.intro} icon={Link2} /> : repositories.isError ? <C.ErrorState message={s.loadError} onRetry={() => repositories.refetch()} /> : repositories.isLoading ? <C.LoadingState variant="list" /> : rows.length === 0 ? <C.EmptyState title={s.noRepositories} icon={FolderGit2} /> : (
    <C.DataTable ariaLabel={s.repositories} columns="minmax(12rem,1fr) minmax(15rem,1.2fr) minmax(15rem,1.2fr) minmax(10rem,.7fr)" compactColumns="minmax(0,1fr)">
      <C.DataTableRow header><C.DataTableCell header>{s.columnProject}</C.DataTableCell><C.DataTableCell header priority="wide">{s.baseRepository}</C.DataTableCell><C.DataTableCell header priority="wide">{s.pushRepository}</C.DataTableCell><C.DataTableCell header priority="wide">{s.mappingHealthy}</C.DataTableCell></C.DataTableRow>
      {rows.map((row) => <C.DataTableRow key={row.project.id} interactive tabIndex={0} onClick={() => setMapping(mappingFrom(row))} onKeyDown={(event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setMapping(mappingFrom(row)); } }}>
        <C.DataTableCell><div className="font-medium text-text">{row.project.slug}</div><div className="mt-1 sm:hidden"><C.Badge tone={row.mapping ? 'success' : 'neutral'}>{row.mapping ? s.mappingHealthy : s.mappingMissing}</C.Badge></div></C.DataTableCell>
        <C.DataTableCell priority="wide" className="font-mono text-xs text-text-muted">{row.mapping ? `${row.mapping.baseOwner}/${row.mapping.baseName}` : row.detected.base ? `${row.detected.base.owner}/${row.detected.base.name}` : '—'}</C.DataTableCell>
        <C.DataTableCell priority="wide" className="font-mono text-xs text-text-muted">{row.mapping ? `${row.mapping.pushOwner}/${row.mapping.pushName}` : row.detected.push ? `${row.detected.push.owner}/${row.detected.push.name}` : '—'}</C.DataTableCell>
        <C.DataTableCell priority="wide"><C.Badge tone={row.mapping ? 'success' : row.detected.ambiguous ? 'warning' : 'neutral'}>{row.mapping ? s.mappingHealthy : s.mappingMissing}</C.Badge></C.DataTableCell>
      </C.DataTableRow>)}
    </C.DataTable>
  );

  const pullsView = !connected ? <C.EmptyState title={s.disconnected} icon={GitPullRequest} /> : mapped.length === 0 ? <C.EmptyState title={s.mappingMissing} description={s.setupHint} icon={Link2} /> : (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row"><C.SelectMenu value={activeProject} onChange={(value: string) => { setProjectFilter(value); setSelectedPr(null); }} label={s.filterProject} options={mapped.map((row) => ({ value: String(row.project.id), label: row.project.slug }))} /><C.SelectMenu value={prState} onChange={setPrState} label={s.filterState} options={[{ value: 'open', label: s.stateOpen }, { value: 'closed', label: s.stateClosed }, { value: 'all', label: s.stateAll }]} /><div className="relative flex-1"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" /><C.Input value={search} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)} placeholder={s.search} className="pl-9" /></div></div>
      {pulls.isError ? <C.ErrorState message={s.loadError} onRetry={() => pulls.refetch()} /> : pulls.isLoading ? <C.LoadingState variant="list" /> : filteredPulls.length === 0 ? <C.EmptyState title={s.noPullRequests} icon={GitPullRequest} /> : <C.DataTable ariaLabel={s.tabPullRequests} columns="minmax(18rem,1.4fr) minmax(14rem,1fr) minmax(8rem,.5fr) minmax(10rem,.7fr)" compactColumns="minmax(0,1fr)">
        <C.DataTableRow header><C.DataTableCell header>{s.columnPullRequest}</C.DataTableCell><C.DataTableCell header priority="wide">{s.columnBranch}</C.DataTableCell><C.DataTableCell header priority="wide">{s.columnChecks}</C.DataTableCell><C.DataTableCell header priority="wide">{s.columnUpdated}</C.DataTableCell></C.DataTableRow>
        {filteredPulls.map((pull) => <C.DataTableRow key={pull.number} interactive selected={pull.number === selectedPr} tabIndex={0} onClick={() => setSelectedPr(pull.number)} onKeyDown={(event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedPr(pull.number); } }}><C.DataTableCell><div className="font-medium text-text">#{pull.number} {pull.title}</div><div className="text-xs text-text-muted">@{pull.author}{pull.draft ? ' · Draft' : ''}</div></C.DataTableCell><C.DataTableCell priority="wide" className="font-mono text-xs text-text-muted">{pull.headRef} → {pull.baseRef}</C.DataTableCell><C.DataTableCell priority="wide"><div className="flex flex-wrap gap-1"><C.Badge tone={pull.mergeable === false ? 'danger' : 'neutral'}>{pull.mergeableState ?? 'unknown'}</C.Badge>{pull.reviewDecision ? <C.Badge tone={pull.reviewDecision === 'approved' ? 'success' : pull.reviewDecision === 'changes_requested' ? 'danger' : 'neutral'}>{pull.reviewDecision.replace('_', ' ')}</C.Badge> : null}</div></C.DataTableCell><C.DataTableCell priority="wide" className="text-xs text-text-muted">{new Date(pull.updatedAt).toLocaleString()}</C.DataTableCell></C.DataTableRow>)}
      </C.DataTable>}
      {selectedPr ? <C.WorkspaceDetailRail label={`#${selectedPr}`} closeLabel={s.cancel} onClose={() => setSelectedPr(null)}>{detail.isError ? <C.ErrorState message={s.loadError} onRetry={() => detail.refetch()} /> : detail.isLoading ? <C.LoadingState variant="detail" /> : detail.data ? <div className="flex flex-col gap-5 p-4"><div><h2 className="text-lg font-semibold text-text">{detail.data.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm text-text-muted">{detail.data.body}</p></div><div className="flex flex-wrap gap-2"><C.Badge tone={checks.data?.state === 'success' ? 'success' : checks.data?.state === 'failure' ? 'danger' : 'warning'}>{checks.data?.state ?? 'pending'}</C.Badge><C.Badge>{detail.data.headRef} → {detail.data.baseRef}</C.Badge></div><section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{s.checks}</h3><div className="space-y-2">{(checks.data?.items ?? []).map((item) => <div key={item.name} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"><div><div className="font-medium text-text">{item.name}</div>{item.description ? <div className="text-xs text-text-muted">{item.description}</div> : null}</div>{item.targetUrl ? <a href={item.targetUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">{item.state}</a> : <C.Badge>{item.state}</C.Badge>}</div>)}</div></section><section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{s.changedFiles}</h3>{(detail.data.files ?? []).map((file) => <div key={file.path} className="mb-3 overflow-hidden rounded-lg border border-border"><div className="border-b border-border px-3 py-2 font-mono text-xs text-text">{file.status} {file.path} <span className="text-success">+{file.additions}</span> <span className="text-danger">-{file.deletions}</span></div><C.PatchView diff={file.patch ?? ''} empty="No patch available." /></div>)}</section><section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{s.reviews}</h3>{(detail.data.reviews ?? []).map((review) => <div key={review.id} className="mb-2 rounded-lg border border-border p-3 text-sm"><strong>{review.user}</strong> · {review.state}<p className="mt-1 text-text-muted">{review.body}</p></div>)}</section><div className="flex flex-wrap gap-2"><C.Button onClick={() => preview.mutate({ type: 'publish', projectId: Number(activeProject), sessionId: publishSession })} disabled={!publishSession}>{s.publish}</C.Button><C.Button variant="accent" onClick={() => preview.mutate({ type: 'create_pr', projectId: Number(activeProject), sessionId: publishSession, title: createForm.title || detail.data?.title, body: createForm.body, base: createForm.base || detail.data?.baseRef })} disabled={!publishSession}>{s.createPullRequest}</C.Button><C.Button onClick={() => preview.mutate({ type: 'review', projectId: Number(activeProject), number: selectedPr, event: reviewForm.event, body: reviewForm.body })}>{s.submitReview}</C.Button><C.Button variant="danger" onClick={() => preview.mutate({ type: 'merge', projectId: Number(activeProject), number: selectedPr, expectedHeadSha: detail.data?.headSha, method: mergeMethod })} disabled={checks.data?.state !== 'success'}>{s.merge}</C.Button></div><C.Field label={s.conversation}><C.SelectMenu value={publishSession} onChange={setPublishSession} label={s.conversation} options={(sessions.data ?? []).map((session) => ({ value: session.id, label: session.title }))} /></C.Field><C.Field label={s.pullRequestTitle}><C.Input value={createForm.title} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCreateForm({ ...createForm, title: event.target.value })} /></C.Field><C.Field label={s.description}><textarea className="min-h-24 w-full rounded-md border border-border bg-bg p-3 text-sm text-text" value={createForm.body} onChange={(event) => setCreateForm({ ...createForm, body: event.target.value })} /></C.Field><C.Field label={s.reviewEvent}><C.SelectMenu value={reviewForm.event} onChange={(event: string) => setReviewForm({ ...reviewForm, event })} label={s.reviewEvent} options={[{ value: 'APPROVE', label: s.approve }, { value: 'REQUEST_CHANGES', label: s.requestChanges }, { value: 'COMMENT', label: s.comment }]} /></C.Field><C.Field label={s.description}><textarea className="min-h-20 w-full rounded-md border border-border bg-bg p-3 text-sm text-text" value={reviewForm.body} onChange={(event) => setReviewForm({ ...reviewForm, body: event.target.value })} /></C.Field><C.Field label={s.mergeMethod}><C.SelectMenu value={mergeMethod} onChange={setMergeMethod} label={s.mergeMethod} options={[{ value: 'squash', label: s.squash }, { value: 'merge', label: s.mergeCommit }, { value: 'rebase', label: s.rebase }]} /></C.Field></div> : null}</C.WorkspaceDetailRail> : null}
    </div>
  );

  return <>
    <C.SpatialWorkspaceLayout hero={{ eyebrow: s.eyebrow, title: s.title, description: s.intro, mascotState: status.data?.reconnectRequired ? 'error' : connected ? 'idle' : 'sleeping', metrics: <><C.WorkspaceMetric label={s.connected} value={connected ? '1' : '0'} icon={Github} /><C.WorkspaceMetric label={s.mappings} value={status.data?.mappings ?? 0} icon={Link2} /><C.WorkspaceMetric label={s.tabPullRequests} value={pulls.data?.pullRequests.length ?? 0} icon={GitPullRequest} /></> }}>
      <div className="flex min-h-0 flex-1 flex-col gap-4"><C.Segmented value={tab} onChange={setTab} options={[{ value: 'overview', label: s.tabOverview }, { value: 'repositories', label: s.tabRepositories }, { value: 'pulls', label: s.tabPullRequests }]} />{tab === 'overview' ? overview : tab === 'repositories' ? repositoriesView : pullsView}</div>
    </C.SpatialWorkspaceLayout>
    {mapping ? <C.Modal title={s.map} size="md" onClose={() => setMapping(null)}><C.ModalBody><div className="grid gap-3 sm:grid-cols-2"><C.Field label={s.owner}><C.Input value={mapping.baseOwner} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setMapping({ ...mapping, baseOwner: event.target.value })} /></C.Field><C.Field label={s.name}><C.Input value={mapping.baseName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setMapping({ ...mapping, baseName: event.target.value })} /></C.Field><C.Field label={s.owner}><C.Input value={mapping.pushOwner} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setMapping({ ...mapping, pushOwner: event.target.value })} /></C.Field><C.Field label={s.name}><C.Input value={mapping.pushName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setMapping({ ...mapping, pushName: event.target.value })} /></C.Field></div>{mapping.baseOwner && mapping.baseName ? <a href={`https://github.com/${encodeURIComponent(mapping.baseOwner)}/${encodeURIComponent(mapping.baseName)}`} target="_blank" rel="noreferrer" className="mt-4 inline-flex text-sm text-accent hover:underline">{s.openGitHub}</a> : null}</C.ModalBody><C.ModalFooter><C.Button variant="ghost" onClick={() => setMapping(null)}>{s.cancel}</C.Button>{rows.find((row) => row.project.id === mapping.projectId)?.mapping ? <C.Button variant="danger" onClick={() => preview.mutate({ type: 'remove_mapping', projectId: mapping.projectId })}>{s.removeMapping}</C.Button> : null}<C.Button variant="accent" onClick={() => saveMap.mutate(mapping, { onSuccess: () => setMapping(null) })} disabled={!mapping.baseOwner || !mapping.baseName || !mapping.pushOwner || !mapping.pushName}>{s.saveMapping}</C.Button></C.ModalFooter></C.Modal> : null}
    {pending ? <C.ConfirmDialog open title={pending.preview.title || s.confirmExternal} description={`${pending.preview.description}\n\n${s.confirmationExpires}`} confirmLabel={s.confirm} onClose={() => setPending(null)} onConfirm={completePending} /> : null}
  </>;
}

function mappingFrom(row: RepositoryRow): MappingForm {
  return {
    projectId: row.project.id,
    baseOwner: row.mapping?.baseOwner ?? row.detected.base?.owner ?? '', baseName: row.mapping?.baseName ?? row.detected.base?.name ?? '',
    pushOwner: row.mapping?.pushOwner ?? row.detected.push?.owner ?? '', pushName: row.mapping?.pushName ?? row.detected.push?.name ?? '',
    baseRemote: row.detected.base?.remote ?? '', pushRemote: row.detected.push?.remote ?? '',
  };
}
