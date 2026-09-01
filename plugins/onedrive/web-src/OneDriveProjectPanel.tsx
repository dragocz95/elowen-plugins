import { useEffect, useState } from 'react';
import { ChevronRight, Cloud, CloudOff, ExternalLink, Folder, FolderOpen, RefreshCw, TriangleAlert } from 'lucide-react';
import { humanBytes, jsonBody, runtime, type ConflictRow, type MirrorRow, type Overview } from './runtime';

interface ProjectProp { id: number; slug: string; path: string }

const statusTone = (row: MirrorRow): 'success' | 'accent' | 'warning' | 'danger' | 'muted' => {
  if (row.status === 'error') return 'danger';
  if (row.status === 'blocked') return 'warning';
  if (!row.enabled) return 'muted';
  if (row.conflictCount > 0) return 'warning';
  return row.status === 'syncing' ? 'accent' : 'success';
};

const statusLabel = (row: MirrorRow, s: Record<string, string>): string => {
  if (row.status === 'error') return s.statusError;
  if (row.status === 'blocked') return s.statusBlocked;
  if (!row.enabled) return s.statusPaused;
  if (row.status === 'syncing') return s.statusSyncing;
  // An unanswered conflict is not a working mirror. Calling it "in sync" tells somebody everything is
  // fine while a file of theirs sits waiting for a decision only they can make.
  if (row.conflictCount > 0) return s.statusConflict;
  return row.lastSyncAt ? s.statusIdle : s.statusFirstRun;
};

/** Defined at module scope ON PURPOSE. A component declared inside another component's body is a NEW
 *  component type on every render, so React unmounts and remounts it — here that meant the conflict rail
 *  losing its in-flight mutation state every time the 15-second refresh landed, which let the same
 *  resolution be submitted twice. */
function ConflictsRail({ row, onClose, onResolved }: { row: MirrorRow; onClose: () => void; onResolved: () => void }) {
  const { components: C, hooks, api, utils } = runtime();
  const s = hooks.usePluginStrings('onedrive');
  const conflicts = hooks.useQuery<{ conflicts: ConflictRow[] }>({
    queryKey: ['plugin', 'onedrive', 'conflicts', String(row.id)],
    queryFn: () => api(`/plugins/onedrive/api/conflicts?id=${row.id}`),
  });
  // The host's mutation handle exposes only `mutate` and `isPending`, so a failure has to be held here
  // to be shown at all.
  const [resolveError, setResolveError] = useState<string | null>(null);
  const resolve = hooks.useMutation<unknown, unknown, { rel: string; keep: 'local' | 'remote' }>({
    mutationFn: (vars: { rel: string; keep: 'local' | 'remote' }) =>
      api('/plugins/onedrive/api/conflicts/resolve', jsonBody({ id: row.id, ...vars })),
    onSuccess: () => { setResolveError(null); conflicts.refetch(); onResolved(); },
    // A 409 is ordinary here - the OneDrive copy can change between opening this list and answering it.
    // Without this the button simply did nothing and the row stayed put, which reads as a broken page.
    onError: (error: unknown) => { setResolveError(utils.apiErrorMessage(error)); conflicts.refetch(); },
  });

  return (
    <C.WorkspaceDetailRail label={s.conflicts} closeLabel={s.close} onClose={onClose}>
      <p className="mb-3 text-xs text-muted-foreground">{s.conflictsHint}</p>
      {conflicts.isLoading ? <C.LoadingState variant="list" />
        : conflicts.isError
          // A failed load must not look like "no conflicts": this is the screen someone uses to decide
          // which copy of their work survives.
          ? <C.ErrorState message={utils.apiErrorMessage(conflicts.error)} onRetry={() => conflicts.refetch()} />
          : (conflicts.data?.conflicts ?? []).length === 0
            ? <C.EmptyState title={s.conflictsEmpty} />
            : (
            <C.DataTable ariaLabel={s.conflicts} columns="minmax(0,1fr) auto" compactColumns="minmax(0,1fr)">
              {(conflicts.data?.conflicts ?? []).map((conflict) => (
                <C.DataTableRow key={conflict.rel}>
                  <C.DataTableCell lines={1} className="font-mono text-xs">{conflict.rel}</C.DataTableCell>
                  <C.DataTableCell lines="auto" className="justify-end">
                    <div className="flex flex-wrap justify-end gap-2">
                      <C.Button disabled={resolve.isPending}
                        onClick={() => resolve.mutate({ rel: conflict.rel, keep: 'local' })}>{s.keepLocal}</C.Button>
                      <C.Button variant="ghost" disabled={resolve.isPending}
                        onClick={() => resolve.mutate({ rel: conflict.rel, keep: 'remote' })}>{s.keepRemote}</C.Button>
                    </div>
                  </C.DataTableCell>
                </C.DataTableRow>
              ))}
            </C.DataTable>
          )}
      {resolveError ? <div className="mt-3"><C.ErrorState message={resolveError} onRetry={() => { setResolveError(null); conflicts.refetch(); }} /></div> : null}
    </C.WorkspaceDetailRail>
  );
}

/** Choose WHICH folder of the project is mirrored, by clicking into it.
 *
 *  Mirroring a whole project into someone's personal OneDrive is usually far more than they meant to
 *  share, so the whole project is offered as one choice among the folders rather than as the only
 *  option. Descending is a click; the breadcrumb walks back out. Only directories the mirror could
 *  actually take are listed - the server applies the same ignore floor the sync cycle does, so the
 *  picker cannot offer something the cycle would then refuse. */
type FolderChoice = { subpath: string; remotePath: string };

function FolderPicker({ projectId, workspaceId, value, onChange, rootLabel }: {
  projectId: number;
  workspaceId: string | null;
  value: FolderChoice | null;
  onChange: (choice: FolderChoice) => void;
  rootLabel: string;
}) {
  const { components: C, hooks, api, utils } = runtime();
  const s = hooks.usePluginStrings('onedrive');
  const [browsing, setBrowsing] = useState('');
  const query = new URLSearchParams({ projectId: String(projectId), path: browsing });
  if (workspaceId) query.set('workspaceId', workspaceId);
  const listing = hooks.useQuery<{ path: string; remotePath: string; folders: { name: string; path: string; remotePath: string }[] }>({
    queryKey: ['plugin', 'onedrive', 'folders', String(projectId), workspaceId ?? '', browsing],
    queryFn: () => api(`/plugins/onedrive/api/folders?${query.toString()}`),
  });

  // The whole project is the default, so it is SELECTED as soon as the picker knows where that would
  // land - otherwise the first row reads "Selected" while the connect button stays dead, which is the
  // picker telling two different stories about the same state.
  const rootRemotePath = browsing === '' ? listing.data?.remotePath : undefined;
  useEffect(() => {
    if (!value && rootRemotePath !== undefined) onChange({ subpath: '', remotePath: rootRemotePath });
  }, [value, rootRemotePath, onChange]);

  const crumbs = browsing ? browsing.split('/') : [];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <button type="button" onClick={() => setBrowsing('')}
          className={`rounded px-1.5 py-0.5 hover:bg-accent hover:text-accent-foreground ${browsing === '' ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
          {rootLabel}
        </button>
        {crumbs.map((crumb, index) => (
          <span key={crumbs.slice(0, index + 1).join('/')} className="flex items-center gap-1">
            <ChevronRight size={12} className="text-subtle-foreground" aria-hidden />
            <button type="button" onClick={() => setBrowsing(crumbs.slice(0, index + 1).join('/'))}
              title={crumb}
              className={`max-w-[10rem] truncate rounded px-1.5 py-0.5 hover:bg-accent hover:text-accent-foreground ${index === crumbs.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              {crumb}
            </button>
          </span>
        ))}
      </div>

      <div className="max-h-52 overflow-y-auto rounded-md border border-border/70">
        {/* Selecting the folder you are standing in is the same act as selecting one you can see, so it
            is the first row of the same list rather than a separate control somewhere else. */}
        <button type="button" aria-pressed={value?.subpath === browsing}
          disabled={!listing.data}
          onClick={() => listing.data && onChange({ subpath: browsing, remotePath: listing.data.remotePath })}
          className={`flex w-full items-center gap-2 border-b border-border/70 px-3 py-2 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:opacity-50 ${
            value?.subpath === browsing ? 'bg-accent text-accent-foreground' : ''}`}>
          <FolderOpen size={13} aria-hidden />
          <span className="truncate">{browsing === '' ? s.mirrorWholeProject : `${s.mirrorThisFolder}: ${browsing}`}</span>
          {value?.subpath === browsing ? <span className="ml-auto shrink-0 font-medium">{s.selected}</span> : null}
        </button>
        {listing.isError
          ? <div className="p-3"><C.ErrorState message={utils.apiErrorMessage(listing.error)} onRetry={() => listing.refetch()} /></div>
          : listing.isLoading
            ? <div className="p-3"><C.LoadingState variant="list" /></div>
            : (listing.data?.folders ?? []).length === 0
              ? <p className="px-3 py-2 text-xs text-muted-foreground">{s.noSubfolders}</p>
              : (listing.data?.folders ?? []).map((folder) => (
                <div key={folder.path} className="flex items-stretch border-b border-border/70 last:border-b-0">
                  <button type="button" aria-pressed={value?.subpath === folder.path}
                    onClick={() => onChange({ subpath: folder.path, remotePath: folder.remotePath })}
                    className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent hover:text-accent-foreground ${
                      value?.subpath === folder.path ? 'bg-accent text-accent-foreground' : ''}`}>
                    <Folder size={13} aria-hidden />
                    <span className="truncate" title={folder.path}>{folder.name}</span>
                    {value?.subpath === folder.path ? <span className="ml-auto shrink-0 font-medium">{s.selected}</span> : null}
                  </button>
                  <button type="button" onClick={() => setBrowsing(folder.path)} aria-label={`${s.openFolderLabel}: ${folder.name}`}
                    className="px-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                    <ChevronRight size={14} aria-hidden />
                  </button>
                </div>
              ))}
      </div>
    </div>
  );
}

function MirrorCard({ row, onConflicts, onConfirmSync, onDisconnect, onPause, onSync, busy }: {
  row: MirrorRow;
  onConflicts: () => void;
  onConfirmSync: () => void;
  onDisconnect: () => void;
  onPause: () => void;
  onSync: () => void;
  busy: boolean;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('onedrive');
  const { locale } = hooks.useTranslation();
  // WorkspaceMetric is hero furniture - big numerals, one per line. In a drawer this width it turned a
  // three-value summary into half a screen, so the same three values go in one quiet line instead.
  const syncedAt = row.lastSyncAt
    ? new Date(row.lastSyncAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
    : s.never;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <C.Badge tone={statusTone(row)}>{statusLabel(row, s)}</C.Badge>
        <span>{s.lastSync}: <span className="text-foreground">{syncedAt}</span></span>
        <span aria-hidden>·</span>
        <span>{s.files}: <span className="text-foreground">{row.fileCount} · {humanBytes(row.byteCount)}</span></span>
        <span aria-hidden>·</span>
        <span>{s.mirroredFolder}: <span className="font-mono text-foreground" title={row.subpath || undefined}>
          {row.subpath || s.wholeProject}
        </span></span>
      </div>
      {/* Which OneDrive folder this is. Somebody who connected weeks ago has no other way to find out. */}
      <p className="break-all text-xs text-muted-foreground">
        {s.destination}: <span className="font-mono text-foreground">{row.remotePath}</span>
      </p>

      {row.status === 'blocked' ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
          <p className="text-sm font-medium">{s.blockedTitle.replace('{count}', String(row.blockedDeletions))}</p>
          <p className="mt-1 text-xs text-muted-foreground">{s.blockedBody.replace('{count}', String(row.blockedDeletions))}</p>
        </div>
      ) : row.error ? <C.ErrorState message={row.error} /> : null}

      {/* The refusal asked a question; this is the button that answers it. Confirmation is deliberately
          a distinct action rather than a quieter Sync now, because the answer authorises deletion. */}
      {row.status === 'blocked' && (
        <C.Button variant="danger" disabled={busy} onClick={onConfirmSync}>
          {s.confirmDeletions.replace('{count}', String(row.blockedDeletions))}
        </C.Button>
      )}

      {row.conflictCount > 0 && (
        <button type="button" onClick={onConflicts}
          className="flex w-full items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground">
          <TriangleAlert size={15} className="text-warning" aria-hidden />
          <span>{s.conflicts}</span>
          <C.Badge tone="warning">{row.conflictCount}</C.Badge>
        </button>
      )}

      <div className="flex flex-wrap gap-2">
        {row.webUrl && (
          <C.Button icon={ExternalLink} onClick={() => window.open(row.webUrl!, '_blank', 'noopener')}>
            {s.openFolder}
          </C.Button>
        )}
        {/* The cycle skips a disabled link, so this button would do nothing at all while paused.
            Resume is the action that state has. */}
        {row.enabled ? (
          <C.Button icon={RefreshCw} disabled={busy} onClick={onSync}>{s.syncNow}</C.Button>
        ) : null}
        <C.Button variant="ghost" disabled={busy} onClick={onPause}>{row.enabled ? s.pause : s.resume}</C.Button>
        <C.Button variant="ghost-danger" disabled={busy} onClick={onDisconnect}>{s.disconnect}</C.Button>
      </div>
    </div>
  );
}

export function OneDriveProjectPanel({ project }: { project: ProjectProp }) {
  const { components: C, hooks, api, utils } = runtime();
  const s = hooks.usePluginStrings('onedrive');
  const { toast } = hooks.useToast();
  const qc = hooks.useQueryClient();

  const key = ['plugin', 'onedrive', 'overview', String(project.id)];
  const overview = hooks.useQuery<Overview>({
    queryKey: key,
    queryFn: () => api(`/plugins/onedrive/api/overview?projectId=${project.id}`),
    refetchInterval: 15_000,
  });

  const [connectFor, setConnectFor] = useState<{ workspaceId: string | null; label: string } | null>(null);
  // Reset with each drawer, so the previous choice never quietly applies to a different target.
  const [choice, setChoice] = useState<FolderChoice | null>(null);
  const [conflictsFor, setConflictsFor] = useState<MirrorRow | null>(null);
  const [disconnecting, setDisconnecting] = useState<MirrorRow | null>(null);

  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); };
  const fail = (error: unknown) => toast(utils.apiErrorMessage(error), 'error');

  const connect = hooks.useMutation<unknown, unknown, { workspaceId: string | null; subpath: string }>({
    mutationFn: (vars: { workspaceId: string | null; subpath: string }) =>
      api('/plugins/onedrive/api/connect', jsonBody({ projectId: project.id, workspaceId: vars.workspaceId, subpath: vars.subpath })),
    onSuccess: () => { setConnectFor(null); refresh(); },
    onError: fail,
  });
  const disconnect = hooks.useMutation<unknown, unknown, { id: number }>({
    mutationFn: (vars: { id: number }) => api('/plugins/onedrive/api/disconnect', jsonBody(vars)),
    onSuccess: () => { setDisconnecting(null); refresh(); },
    onError: fail,
  });
  const pause = hooks.useMutation<unknown, unknown, { id: number; enabled: boolean }>({
    mutationFn: (vars: { id: number; enabled: boolean }) => api('/plugins/onedrive/api/pause', jsonBody(vars)),
    onSuccess: refresh,
    onError: fail,
  });
  const syncNow = hooks.useMutation<unknown, unknown, { id: number; confirmDeletions?: boolean }>({
    mutationFn: (vars: { id: number; confirmDeletions?: boolean }) =>
      api('/plugins/onedrive/api/sync-now', jsonBody(vars)),
    onSuccess: refresh,
    onError: fail,
  });

  if (overview.isLoading) return <C.LoadingState variant="list" />;
  if (overview.isError) return <C.ErrorState message={utils.apiErrorMessage(overview.error)} onRetry={() => overview.refetch()} />;

  const data = overview.data;
  // The tab is normally hidden for an account with no Microsoft identity, but the panel must still stand
  // on its own: the listing can be a few seconds stale, and this route is reachable directly.
  if (!data || data.identity.linked !== true) {
    return <C.EmptyState icon={CloudOff} title={s.title} description={s.notLinked} />;
  }

  const projectLink = data.links.find((row) => row.workspaceId === null) ?? null;

  return (
    <div className="space-y-4 py-3">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Cloud size={14} aria-hidden /> {s.title}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">{s.connectHint}</p>
          </div>
          {projectLink ? null : (
            <C.Button variant="accent" onClick={() => { setChoice(null); setConnectFor({ workspaceId: null, label: project.slug }); }}>
              {s.connectCta}
            </C.Button>
          )}
        </div>
        {projectLink ? (
          <MirrorCard
            row={projectLink}
            busy={syncNow.isPending || pause.isPending || disconnect.isPending}
            onConflicts={() => setConflictsFor(projectLink)}
            onDisconnect={() => setDisconnecting(projectLink)}
            onPause={() => pause.mutate({ id: projectLink.id, enabled: !projectLink.enabled })}
            onSync={() => syncNow.mutate({ id: projectLink.id })}
            onConfirmSync={() => syncNow.mutate({ id: projectLink.id, confirmDeletions: true })}
          />
        ) : <p className="text-xs text-muted-foreground">{s.mirrorScopeHint}</p>}
      </section>

      {data.workspaces.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Cloud size={14} aria-hidden /> {s.workspaces}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">{s.workspacesHint}</p>
          </div>
          <C.DataTable ariaLabel={s.workspaces} columns="minmax(0,1fr) 7rem auto" compactColumns="minmax(0,1fr)">
            {data.workspaces.map((workspace) => {
              const row = data.links.find((link) => link.workspaceId === workspace.workspaceId) ?? null;
              return (
                <C.DataTableRow key={workspace.workspaceId}>
                  <C.DataTableCell lines={1}>{workspace.label}</C.DataTableCell>
                  <C.DataTableCell lines="auto">
                    {row ? <C.Badge tone={statusTone(row)}>{statusLabel(row, s)}</C.Badge> : null}
                  </C.DataTableCell>
                  <C.DataTableCell lines="auto" className="justify-end">
                    <div className="flex flex-col items-end gap-2">
                      {/* A workspace mirror can block on a bulk deletion or fail exactly like the project
                          one. Showing only a badge left those states with nothing to click, so the same
                          controls appear here rather than a reduced set. */}
                      {row?.status === 'blocked' ? (
                        <p className="text-right text-xs text-warning">
                          {s.blockedTitle.replace('{count}', String(row.blockedDeletions))}
                        </p>
                      ) : row?.error ? <p className="text-xs text-destructive text-right">{row.error}</p> : null}
                      <div className="flex flex-wrap justify-end gap-2">
                      {row && row.status === 'blocked' && (
                        <C.Button variant="danger" disabled={syncNow.isPending}
                          onClick={() => syncNow.mutate({ id: row.id, confirmDeletions: true })}>
                          {s.confirmDeletions.replace('{count}', String(row.blockedDeletions))}
                        </C.Button>
                      )}
                      {/* A paused mirror is skipped by the cycle, so offering Sync now would be a button
                          that does nothing. Resume is the action that state actually has. */}
                      {row && (
                        <C.Button disabled={pause.isPending}
                          onClick={() => pause.mutate({ id: row.id, enabled: !row.enabled })}>
                          {row.enabled ? s.pause : s.resume}
                        </C.Button>
                      )}
                      {row && row.enabled && (
                        <C.Button disabled={syncNow.isPending}
                          onClick={() => syncNow.mutate({ id: row.id })}>{s.syncNow}</C.Button>
                      )}
                      {row && row.conflictCount > 0 && (
                        <C.Button onClick={() => setConflictsFor(row)}>
                          {s.conflicts} ({row.conflictCount})
                        </C.Button>
                      )}
                      {row ? (
                        <C.Button variant="ghost-danger" disabled={pause.isPending || syncNow.isPending || disconnect.isPending} onClick={() => setDisconnecting(row)}>{s.disconnect}</C.Button>
                      ) : (
                        <C.Button
                          onClick={() => { setChoice(null); setConnectFor({ workspaceId: workspace.workspaceId, label: workspace.label }); }}>
                          {s.connectCta}
                        </C.Button>
                      )}
                      </div>
                    </div>
                  </C.DataTableCell>
                </C.DataTableRow>
              );
            })}
          </C.DataTable>
        </section>
      )}

      {/* First click opens a drawer; a centred window is only ever the second step from one. The rail has
          no `open` prop - it renders whenever it is mounted - so the condition belongs HERE. */}
      {connectFor && (
      <C.WorkspaceDetailRail label={s.connectCta} closeLabel={s.close} onClose={() => setConnectFor(null)}>
        <div className="space-y-4 text-sm">
          <p className="text-sm font-medium">{connectFor.label}</p>

          <div className="space-y-2">
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide">{s.chooseFolder}</p>
              <p className="text-xs text-muted-foreground">{s.chooseFolderHint}</p>
            </div>
            <FolderPicker
              projectId={project.id}
              workspaceId={connectFor.workspaceId}
              value={choice}
              onChange={setChoice}
              rootLabel={connectFor.label}
            />
          </div>

          {/* Where it lands in OneDrive. The path is whatever the server said it would be for this exact
              choice - a workspace mirror sits under `workspaces/<slug>/<label> (<id>)`, and a template
              here got that wrong once already. */}
          {choice ? (
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide">{s.destination}</p>
              <p className="break-all font-mono text-xs">{choice.remotePath}</p>
            </div>
          ) : null}

          {data.identity?.upn ? (
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide">{s.account}</p>
              <p className="break-all text-xs">{data.identity.upn}</p>
            </div>
          ) : null}

          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">{s.mirrorScope}</p>
            <p className="text-xs">{s.mirrorScopeHint}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.safetyHint}</p>
          </div>

          <C.Button
            variant="accent"
            onClick={() => choice && connect.mutate({ workspaceId: connectFor.workspaceId, subpath: choice.subpath })}
            disabled={connect.isPending || !choice}
          >
            {s.connectConfirm}
          </C.Button>
        </div>
      </C.WorkspaceDetailRail>
      )}

      {conflictsFor && (
        <ConflictsRail row={conflictsFor} onClose={() => setConflictsFor(null)} onResolved={refresh} />
      )}

      <C.ConfirmDialog
        open={disconnecting !== null}
        title={s.disconnect}
        description={s.disconnectHint}
        confirmLabel={s.disconnect}
        onClose={() => setDisconnecting(null)}
        onConfirm={() => {
          if (disconnecting && !disconnect.isPending) disconnect.mutate({ id: disconnecting.id });
        }}
      />
    </div>
  );
}
