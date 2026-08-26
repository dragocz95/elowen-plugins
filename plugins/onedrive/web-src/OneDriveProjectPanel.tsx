import { useState } from 'react';
import { Cloud, CloudOff, ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react';
import { humanBytes, jsonBody, runtime, type ConflictRow, type MirrorRow, type Overview } from './runtime';

interface ProjectProp { id: number; slug: string; path: string }

const statusTone = (row: MirrorRow): 'success' | 'accent' | 'warning' | 'danger' | 'muted' => {
  if (row.status === 'error') return 'danger';
  if (!row.enabled) return 'muted';
  if (row.conflictCount > 0) return 'warning';
  return row.status === 'syncing' ? 'accent' : 'success';
};

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
  const syncNow = hooks.useMutation<unknown, unknown, { id: number }>({
    mutationFn: (vars: { id: number }) => api('/plugins/onedrive/api/sync-now', jsonBody(vars)),
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
      <C.PluginSection
        surface="project"
        title={s.title}
        description={s.connectHint}
        icon={Cloud}
        action={projectLink ? undefined : (
          <C.Button size="sm" onClick={() => setConnectFor({ workspaceId: null, label: project.slug })}>
            {s.connectCta}
          </C.Button>
        )}
      >
        {projectLink ? <MirrorCard row={projectLink} /> : (
          <p className="text-xs text-text-muted">{s.mirrorScopeHint}</p>
        )}
      </C.PluginSection>

      {data.workspaces.length > 0 && (
        <C.PluginSection surface="project" title={s.workspaces} description={s.workspacesHint} icon={Cloud}>
          <C.DataTable>
            {data.workspaces.map((workspace) => {
              const row = data.links.find((link) => link.workspaceId === workspace.workspaceId) ?? null;
              return (
                <C.DataTableRow key={workspace.workspaceId}>
                  <C.DataTableCell>{workspace.label}</C.DataTableCell>
                  <C.DataTableCell>
                    {row ? <C.Badge tone={statusTone(row)}>{statusLabel(row)}</C.Badge> : null}
                  </C.DataTableCell>
                  <C.DataTableCell align="right">
                    {row ? (
                      <C.Button variant="ghost" size="sm" onClick={() => setDisconnecting(row)}>{s.disconnect}</C.Button>
                    ) : (
                      <C.Button variant="secondary" size="sm"
                        onClick={() => setConnectFor({ workspaceId: workspace.workspaceId, label: workspace.label })}>
                        {s.connectCta}
                      </C.Button>
                    )}
                  </C.DataTableCell>
                </C.DataTableRow>
              );
            })}
          </C.DataTable>
        </C.PluginSection>
      )}

      {/* First click opens a drawer; a centred window is only ever the second step from one. */}
      <C.WorkspaceDetailRail
        open={connectFor !== null}
        onClose={() => setConnectFor(null)}
        title={s.connectCta}
        subtitle={connectFor?.label}
      >
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-text-muted text-xs uppercase tracking-wide">{s.folder}</p>
            <p className="font-mono text-xs">{`${data.rootFolder}/${connectFor?.workspaceId ? 'workspaces' : 'projects'}/${project.slug}`}</p>
          </div>
          <div>
            <p className="text-text-muted text-xs uppercase tracking-wide">{s.mirrorScope}</p>
            <p className="text-xs">{s.mirrorScopeHint}</p>
          </div>
          <C.Button
            onClick={() => connect.mutate({ workspaceId: connectFor?.workspaceId ?? null })}
            disabled={connect.isPending}
          >
            {s.connectConfirm}
          </C.Button>
        </div>
      </C.WorkspaceDetailRail>

      <ConflictsRail row={conflictsFor} onClose={() => { setConflictsFor(null); refresh(); }} />

      <C.ConfirmDialog
        open={disconnecting !== null}
        title={s.disconnect}
        description={s.disconnectHint}
        confirmLabel={s.disconnect}
        tone="danger"
        onCancel={() => setDisconnecting(null)}
        onConfirm={() => disconnecting && disconnect.mutate({ id: disconnecting.id })}
      />
    </div>
  );

  function statusLabel(row: MirrorRow): string {
    if (row.status === 'error') return s.statusError;
    if (!row.enabled) return s.statusPaused;
    return row.status === 'syncing' ? s.statusSyncing : s.statusIdle;
  }

  function MirrorCard({ row }: { row: MirrorRow }) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <C.WorkspaceMetric label={s.statusIdle} value={<C.Badge tone={statusTone(row)}>{statusLabel(row)}</C.Badge>} />
          <C.WorkspaceMetric label={s.lastSync} value={row.lastSyncAt ? new Date(row.lastSyncAt).toLocaleString() : s.never} />
          <C.WorkspaceMetric label={s.files} value={`${row.fileCount} · ${humanBytes(row.byteCount)}`} />
        </div>

        {row.error ? <C.ErrorState message={row.error} /> : null}

        {row.conflictCount > 0 && (
          <button type="button" onClick={() => setConflictsFor(row)}
            className="flex w-full items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-left text-sm hover:bg-surface-2">
            <TriangleAlert size={15} className="text-warning" aria-hidden />
            <span>{s.conflicts}</span>
            <C.Badge tone="warning">{row.conflictCount}</C.Badge>
          </button>
        )}

        <div className="flex flex-wrap gap-2">
          {row.webUrl && (
            <C.Button variant="secondary" size="sm" onClick={() => window.open(row.webUrl!, '_blank', 'noopener')}>
              <ExternalLink size={14} aria-hidden /> {s.openFolder}
            </C.Button>
          )}
          <C.Button variant="secondary" size="sm" disabled={syncNow.isPending} onClick={() => syncNow.mutate({ id: row.id })}>
            <RefreshCw size={14} aria-hidden /> {s.syncNow}
          </C.Button>
          <C.Button variant="ghost" size="sm" onClick={() => pause.mutate({ id: row.id, enabled: !row.enabled })}>
            {row.enabled ? s.pause : s.resume}
          </C.Button>
          <C.Button variant="ghost" size="sm" tone="danger" onClick={() => setDisconnecting(row)}>{s.disconnect}</C.Button>
        </div>
      </div>
    );
  }

  function ConflictsRail({ row, onClose }: { row: MirrorRow | null; onClose: () => void }) {
    const conflicts = hooks.useQuery<{ conflicts: ConflictRow[] }>({
      queryKey: ['plugin', 'onedrive', 'conflicts', String(row?.id ?? 0)],
      queryFn: () => api(`/plugins/onedrive/api/conflicts?id=${row!.id}`),
      enabled: row !== null,
    });
    const resolve = hooks.useMutation<unknown, unknown, { rel: string; keep: 'local' | 'remote' }>({
      mutationFn: (vars: { rel: string; keep: 'local' | 'remote' }) =>
        api('/plugins/onedrive/api/conflicts/resolve', jsonBody({ id: row!.id, ...vars })),
      onSuccess: () => { conflicts.refetch(); refresh(); },
      onError: fail,
    });

    return (
      <C.WorkspaceDetailRail open={row !== null} onClose={onClose} title={s.conflicts} subtitle={s.conflictsHint}>
        {conflicts.isLoading ? <C.LoadingState variant="list" /> : (
          <C.DataTable>
            {(conflicts.data?.conflicts ?? []).map((conflict) => (
              <C.DataTableRow key={conflict.rel}>
                <C.DataTableCell>
                  <span className="font-mono text-xs">{conflict.rel}</span>
                </C.DataTableCell>
                <C.DataTableCell align="right">
                  <div className="flex justify-end gap-2">
                    <C.Button size="sm" variant="secondary" disabled={resolve.isPending}
                      onClick={() => resolve.mutate({ rel: conflict.rel, keep: 'local' })}>{s.keepLocal}</C.Button>
                    <C.Button size="sm" variant="ghost" disabled={resolve.isPending}
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
}
