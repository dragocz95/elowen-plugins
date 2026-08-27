import { useState } from 'react';
import { Cloud, CloudOff, ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react';
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
  return row.status === 'syncing' ? s.statusSyncing : s.statusIdle;
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
  const resolve = hooks.useMutation<unknown, unknown, { rel: string; keep: 'local' | 'remote' }>({
    mutationFn: (vars: { rel: string; keep: 'local' | 'remote' }) =>
      api('/plugins/onedrive/api/conflicts/resolve', jsonBody({ id: row.id, ...vars })),
    onSuccess: () => { conflicts.refetch(); onResolved(); },
  });

  return (
    <C.WorkspaceDetailRail label={s.conflicts} closeLabel={s.close} onClose={onClose}>
      <p className="mb-3 text-xs text-text-muted">{s.conflictsHint}</p>
      {conflicts.isLoading ? <C.LoadingState variant="list" />
        : conflicts.isError
          // A failed load must not look like "no conflicts": this is the screen someone uses to decide
          // which copy of their work survives.
          ? <C.ErrorState message={utils.apiErrorMessage(conflicts.error)} onRetry={() => conflicts.refetch()} />
          : (
            <C.DataTable ariaLabel={s.conflicts} columns="minmax(0,1fr) auto" compactColumns="minmax(0,1fr)">
              {(conflicts.data?.conflicts ?? []).map((conflict) => (
                <C.DataTableRow key={conflict.rel}>
                  <C.DataTableCell><span className="truncate font-mono text-xs" title={conflict.rel}>{conflict.rel}</span></C.DataTableCell>
                  <C.DataTableCell className="justify-end">
                    <div className="flex justify-end gap-2">
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
    </C.WorkspaceDetailRail>
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
        <C.Badge tone={statusTone(row)}>{statusLabel(row, s)}</C.Badge>
        <span>{s.lastSync}: <span className="text-text">{syncedAt}</span></span>
        <span aria-hidden>·</span>
        <span>{s.files}: <span className="text-text">{row.fileCount} · {humanBytes(row.byteCount)}</span></span>
      </div>

      {row.error ? <C.ErrorState message={row.error} /> : null}

      {/* The refusal asked a question; this is the button that answers it. Confirmation is deliberately
          a distinct action rather than a quieter Sync now, because the answer authorises deletion. */}
      {row.status === 'blocked' && (
        <C.Button variant="danger" disabled={busy} onClick={onConfirmSync}>
          {s.confirmDeletions}
        </C.Button>
      )}

      {row.conflictCount > 0 && (
        <button type="button" onClick={onConflicts}
          className="flex w-full items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-left text-sm hover:bg-surface-2">
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
        <C.Button icon={RefreshCw} disabled={busy} onClick={onSync}>{s.syncNow}</C.Button>
        <C.Button variant="ghost" onClick={onPause}>{row.enabled ? s.pause : s.resume}</C.Button>
        <C.Button variant="ghost-danger" onClick={onDisconnect}>{s.disconnect}</C.Button>
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
  const [conflictsFor, setConflictsFor] = useState<MirrorRow | null>(null);
  const [disconnecting, setDisconnecting] = useState<MirrorRow | null>(null);

  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); };
  const fail = (error: unknown) => toast(utils.apiErrorMessage(error), 'error');

  const connect = hooks.useMutation<unknown, unknown, { workspaceId: string | null }>({
    mutationFn: (vars: { workspaceId: string | null }) =>
      api('/plugins/onedrive/api/connect', jsonBody({ projectId: project.id, workspaceId: vars.workspaceId })),
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
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
              <Cloud size={14} aria-hidden /> {s.title}
            </h3>
            <p className="mt-1 text-xs text-text-muted">{s.connectHint}</p>
          </div>
          {projectLink ? null : (
            <C.Button variant="accent" onClick={() => setConnectFor({ workspaceId: null, label: project.slug })}>
              {s.connectCta}
            </C.Button>
          )}
        </div>
        {projectLink ? (
          <MirrorCard
            row={projectLink}
            busy={syncNow.isPending}
            onConflicts={() => setConflictsFor(projectLink)}
            onDisconnect={() => setDisconnecting(projectLink)}
            onPause={() => pause.mutate({ id: projectLink.id, enabled: !projectLink.enabled })}
            onSync={() => syncNow.mutate({ id: projectLink.id })}
            onConfirmSync={() => syncNow.mutate({ id: projectLink.id, confirmDeletions: true })}
          />
        ) : <p className="text-xs text-text-muted">{s.mirrorScopeHint}</p>}
      </section>

      {data.workspaces.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
              <Cloud size={14} aria-hidden /> {s.workspaces}
            </h3>
            <p className="mt-1 text-xs text-text-muted">{s.workspacesHint}</p>
          </div>
          <C.DataTable ariaLabel={s.workspaces} columns="minmax(0,1fr) 7rem auto" compactColumns="minmax(0,1fr)">
            {data.workspaces.map((workspace) => {
              const row = data.links.find((link) => link.workspaceId === workspace.workspaceId) ?? null;
              return (
                <C.DataTableRow key={workspace.workspaceId}>
                  <C.DataTableCell>{workspace.label}</C.DataTableCell>
                  <C.DataTableCell>
                    {row ? <C.Badge tone={statusTone(row)}>{statusLabel(row, s)}</C.Badge> : null}
                  </C.DataTableCell>
                  <C.DataTableCell className="justify-end">
                    <div className="flex flex-col items-end gap-2">
                      {/* A workspace mirror can block on a bulk deletion or fail exactly like the project
                          one. Showing only a badge left those states with nothing to click, so the same
                          controls appear here rather than a reduced set. */}
                      {row?.error ? <p className="text-xs text-danger text-right">{row.error}</p> : null}
                      <div className="flex justify-end gap-2">
                      {row && row.status === 'blocked' && (
                        <C.Button variant="danger" disabled={syncNow.isPending}
                          onClick={() => syncNow.mutate({ id: row.id, confirmDeletions: true })}>
                          {s.confirmDeletions}
                        </C.Button>
                      )}
                      {row && (
                        <C.Button disabled={syncNow.isPending}
                          onClick={() => syncNow.mutate({ id: row.id })}>{s.syncNow}</C.Button>
                      )}
                      {row && row.conflictCount > 0 && (
                        <C.Button onClick={() => setConflictsFor(row)}>
                          {s.conflicts} ({row.conflictCount})
                        </C.Button>
                      )}
                      {row ? (
                        <C.Button variant="ghost-danger" onClick={() => setDisconnecting(row)}>{s.disconnect}</C.Button>
                      ) : (
                        <C.Button
                          onClick={() => setConnectFor({ workspaceId: workspace.workspaceId, label: workspace.label })}>
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
        <div className="space-y-3 text-sm">
          <p className="text-sm font-medium">{connectFor.label}</p>
          <div>
            <p className="text-text-muted text-xs uppercase tracking-wide">{s.folder}</p>
            <p className="font-mono text-xs">{`${data.rootFolder}/${connectFor.workspaceId ? 'workspaces' : 'projects'}/${project.slug}`}</p>
          </div>
          <div>
            <p className="text-text-muted text-xs uppercase tracking-wide">{s.mirrorScope}</p>
            <p className="text-xs">{s.mirrorScopeHint}</p>
          </div>
          <C.Button
            variant="accent"
            onClick={() => connect.mutate({ workspaceId: connectFor.workspaceId })}
            disabled={connect.isPending}
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
        onConfirm={() => disconnecting && disconnect.mutate({ id: disconnecting.id })}
      />
    </div>
  );
}
