import { useState } from 'react';
import { Globe } from 'lucide-react';
import {
  runtime, formatBytes, jsonBody, relativeTime,
  type DirectoryResponse, type SiteDetailResponse, type Visibility,
} from './runtime.js';

type Tab = 'overview' | 'access' | 'runtime' | 'danger';

const VISIBILITY_ORDER: Visibility[] = ['private', 'project', 'authenticated', 'public'];
const VISIBILITY_STRING: Record<Visibility, string> = {
  private: 'visibilityPrivate',
  project: 'visibilityProject',
  authenticated: 'visibilityAuthenticated',
  public: 'visibilityPublic',
};

export function SiteDetail({ siteId, strings, allowPublicSites, dedicatedHost, onClose }: {
  siteId: string;
  strings: Record<string, string>;
  allowPublicSites: boolean;
  dedicatedHost: boolean;
  onClose(): void;
}) {
  const { components, hooks, utils } = runtime();
  const { Modal, ModalBody, Button, Badge, Avatar, Segmented, ConfirmDialog, Input, LoadingState, ErrorState } = components;
  const { toast } = hooks.useToast();
  const queryClient = hooks.useQueryClient();

  const [tab, setTab] = useState<Tab>('overview');
  const [pendingPublic, setPendingPublic] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [guestFilter, setGuestFilter] = useState('');

  const detail = hooks.useQuery<SiteDetailResponse>({
    queryKey: ['sites', 'detail', siteId],
    queryFn: () => runtime().api(`/plugins/sites/api/site/${siteId}`),
  });

  const directory = hooks.useQuery<DirectoryResponse>({
    queryKey: ['sites', 'directory'],
    queryFn: () => runtime().api('/plugins/sites/api/directory'),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['sites', 'detail', siteId] });
    void queryClient.invalidateQueries({ queryKey: ['sites', 'list'] });
  };

  const call = hooks.useMutation<unknown, unknown, { path: string; init: RequestInit; done?: string }>({
    mutationFn: (vars: { path: string; init: RequestInit }) => runtime().api(vars.path, vars.init),
    onSuccess: (_data: unknown, vars: { done?: string }) => {
      refresh();
      toast(vars.done ?? strings.saved ?? 'Saved');
    },
    onError: (error: unknown) => toast(utils.apiErrorMessage(error), 'error'),
  });

  const site = detail.data?.site;
  const members = detail.data?.members ?? [];
  const memberIds = new Set(members.map((member) => member.id));

  const setVisibility = (next: Visibility) => {
    if (next === 'public') { setPendingPublic(true); return; }
    call.mutate({ path: `/plugins/sites/api/site/${siteId}`, init: jsonBody('PATCH', { visibility: next }) });
  };

  const candidates = (directory.data?.accounts ?? [])
    .filter((account) => !memberIds.has(account.id) && account.id !== site?.ownerUserId)
    .filter((account) => guestFilter.trim() === '' || account.name.toLowerCase().includes(guestFilter.trim().toLowerCase()))
    .slice(0, 8);

  return (
    <Modal
      title={site?.title ?? strings.title ?? 'Site'}
      description={site?.summary || undefined}
      icon={Globe}
      onClose={onClose}
    >
      <ModalBody>
        {detail.isLoading ? <LoadingState /> : null}
        {detail.isError ? <ErrorState title={strings.title ?? 'Sites'} /> : null}

        {site ? (
          <>
            <Segmented
              variant="line"
              value={tab}
              onChange={(value) => setTab(value as Tab)}
              options={[
                { value: 'overview', label: strings.tabOverview ?? 'Overview' },
                { value: 'access', label: strings.tabAccess ?? 'Access' },
                ...(detail.data?.runtime ? [{ value: 'runtime', label: strings.tabRuntime ?? 'Runtime' }] : []),
                ...(site.canManage ? [{ value: 'danger', label: strings.tabDanger ?? 'Delete' }] : []),
              ]}
            />

            {tab === 'overview' ? (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-text-muted">{strings.address ?? 'Address'}</span>
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-xs text-text">{site.url}</span>
                    <Button variant="ghost" onClick={() => { utils.copyText(site.url); toast(strings.copied ?? 'Copied'); }}>
                      {strings.copyLink ?? 'Copy address'}
                    </Button>
                  </div>
                  {!dedicatedHost ? (
                    <p className="text-[11px] text-warning">{strings.passiveNotice}</p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-text-muted">{strings.lastPublish ?? 'Last publish'}</span>
                  <span className="text-xs text-text">
                    {site.lastPublishAt
                      ? `${(strings.builtBy ?? 'Built by {model}').replace('{model}', site.lastPublishModel || '—')} · ${relativeTime(site.lastPublishAt)}`
                      : strings.neverPublished ?? 'Not published yet'}
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-wide text-text-muted">{strings.releases ?? 'Releases'}</span>
                  {(detail.data?.releases ?? []).map((release) => (
                    <div key={release.id} className="flex items-center justify-between gap-3 border border-border bg-elevated/40 px-3 py-2">
                      <div className="flex min-w-0 flex-col">
                        <span className="text-xs text-text">{relativeTime(release.createdAt)} · {release.fileCount} files · {formatBytes(release.sizeBytes)}</span>
                        <span className="truncate text-[11px] text-text-muted">{release.note || release.model}</span>
                      </div>
                      {site.canManage && release.id !== undefined ? (
                        <Button
                          variant="ghost"
                          disabled={call.isPending}
                          onClick={() => call.mutate({
                            path: `/plugins/sites/api/site/${siteId}/rollback`,
                            init: jsonBody('POST', { releaseId: release.id }),
                            done: strings.rollbackDone,
                          })}
                        >
                          {strings.rollback ?? 'Restore'}
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>

                {(detail.data?.hits ?? []).length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide text-text-muted">{strings.visits ?? 'Visits'}</span>
                    <span className="text-xs text-text">
                      {(detail.data?.hits ?? []).reduce((sum, entry) => sum + entry.count, 0)}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {tab === 'access' ? (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-wide text-text-muted">{strings.whoCanOpen ?? 'Who can open this'}</span>
                  <Segmented
                    value={site.visibility}
                    onChange={(value) => setVisibility(value as Visibility)}
                    options={VISIBILITY_ORDER.map((visibility) => ({
                      value: visibility,
                      label: strings[VISIBILITY_STRING[visibility]] ?? visibility,
                      disabled: !site.canManage || (visibility === 'public' && !allowPublicSites),
                    }))}
                  />
                  {!allowPublicSites ? <p className="text-[11px] text-text-muted">{strings.publicDisabled}</p> : null}
                  <p className="text-[11px] text-text-muted">{strings.sourceNotice}</p>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-wide text-text-muted">{strings.guests ?? 'Named guests'}</span>
                  <p className="text-[11px] text-text-muted">{strings.guestsHint}</p>
                  <div className="flex flex-col gap-1">
                    {members.map((member) => (
                      <div key={member.id} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Avatar size="sm" name={member.name} user={{ id: member.id, username: member.name }} />
                          <span className="text-xs text-text">{member.name}</span>
                        </div>
                        {site.canManage ? (
                          <Button
                            variant="ghost-danger"
                            disabled={call.isPending}
                            onClick={() => call.mutate({
                              path: `/plugins/sites/api/site/${siteId}/members/${member.id}`,
                              init: { method: 'DELETE' },
                            })}
                          >
                            {strings.removeGuest ?? 'Remove'}
                          </Button>
                        ) : null}
                      </div>
                    ))}
                    {members.length === 0 ? <span className="text-[11px] text-text-muted">—</span> : null}
                  </div>

                  {site.canManage ? (
                    <div className="flex flex-col gap-2">
                      <Input
                        value={guestFilter}
                        onChange={(event) => setGuestFilter(event.target.value)}
                        placeholder={strings.addGuest ?? 'Add someone'}
                      />
                      <div className="flex flex-wrap gap-2">
                        {candidates.map((account) => (
                          <Button
                            key={account.id}
                            variant="ghost"
                            disabled={call.isPending}
                            onClick={() => call.mutate({
                              path: `/plugins/sites/api/site/${siteId}/members`,
                              init: jsonBody('POST', { userId: account.id }),
                            })}
                          >
                            {account.name}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {tab === 'runtime' && detail.data?.runtime ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <Badge tone={detail.data.runtime.running ? 'success' : 'danger'}>
                    {detail.data.runtime.running ? strings.runtimeRunning ?? 'Running' : strings.runtimeStopped ?? 'Not running'}
                  </Badge>
                  {site.canManage ? (
                    <Button
                      variant="ghost"
                      disabled={call.isPending}
                      onClick={() => call.mutate({
                        path: `/plugins/sites/api/site/${siteId}/restart`,
                        init: { method: 'POST' },
                        done: strings.restarted,
                      })}
                    >
                      {strings.restart ?? 'Restart'}
                    </Button>
                  ) : null}
                </div>

                {detail.data.runtime.startCommand ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide text-text-muted">{strings.runtimeCommand ?? 'Start command'}</span>
                    <code className="break-all font-mono text-[11px] text-text">{detail.data.runtime.startCommand}</code>
                  </div>
                ) : null}

                {detail.data.runtime.lastError ? (
                  <p className="text-[11px] text-danger">{detail.data.runtime.lastError}</p>
                ) : null}

                {detail.data.runtime.logTail !== null ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide text-text-muted">{strings.runtimeLog ?? 'Recent output'}</span>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all border border-border bg-elevated/40 p-3 font-mono text-[11px] text-text-muted">
                      {detail.data.runtime.logTail || strings.runtimeEmptyLog}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}

            {tab === 'danger' && site.canManage ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-wide text-text-muted">{strings.deleteTitle ?? 'Delete this site'}</span>
                <p className="text-[11px] text-text-muted">{strings.deleteHint}</p>
                <div>
                  <Button variant="danger" onClick={() => setConfirmDelete(true)}>{strings.delete ?? 'Delete site'}</Button>
                </div>
              </div>
            ) : null}

            <ConfirmDialog
              open={pendingPublic}
              title={strings.publicConfirm ?? 'Make public'}
              description={strings.publicWarning}
              confirmLabel={strings.publicConfirm ?? 'Make public'}
              onClose={() => setPendingPublic(false)}
              onConfirm={() => {
                setPendingPublic(false);
                call.mutate({ path: `/plugins/sites/api/site/${siteId}`, init: jsonBody('PATCH', { visibility: 'public' }) });
              }}
            />

            <ConfirmDialog
              open={confirmDelete}
              title={strings.deleteTitle ?? 'Delete this site'}
              description={strings.deleteHint}
              confirmLabel={strings.delete ?? 'Delete site'}
              onClose={() => setConfirmDelete(false)}
              onConfirm={() => {
                setConfirmDelete(false);
                call.mutate(
                  { path: `/plugins/sites/api/site/${siteId}`, init: { method: 'DELETE' }, done: strings.deleted },
                  { onSuccess: () => onClose() },
                );
              }}
            />

            {site.status === 'failed' ? <Badge tone="danger">{strings.statusFailed ?? 'Needs attention'}</Badge> : null}
          </>
        ) : null}
      </ModalBody>
    </Modal>
  );
}
