import { useState } from 'react';
import {
  Activity, Clock, Copy, ExternalLink, History, Link2, RefreshCw, RotateCcw,
  Server, ShieldCheck, Terminal, Trash2, UserMinus, Users,
} from 'lucide-react';
import {
  runtime, avatarUser, formatBytes, jsonBody, relativeTime, siteDetailKey, SITES_LIST_KEY,
  type DirectoryResponse, type SiteDetailResponse, type Visibility,
} from './runtime.js';
import { STATUS_STRING, STATUS_TONE, VISIBILITY_ICON, VISIBILITY_ORDER, VISIBILITY_STRING, VISIBILITY_TONE } from './meta.js';

const basePath = (siteId: string): string => `/plugins/sites/api/site/${siteId}`;

/** Everything about one site, as a single scrolling document inside the workspace drawer.
 *
 *  Deliberately NOT tabbed: the drawer is one fixed size on every surface, and a tab strip inside it
 *  would make the same drawer feel like four differently shaped panels. Every choice here is a
 *  dropdown, a picker or a confirmed action — there is no field to type an id or a name into. */
export function SiteDetail({ siteId, allowPublicSites, onDeleted }: {
  siteId: string;
  allowPublicSites: boolean;
  onDeleted(): void;
}) {
  const { components, hooks, utils } = runtime();
  const {
    Avatar, Badge, Button, IconButton, SelectMenu, ConfirmDialog, ManageSelectionModal,
    DetailBlock, EmptyState, LoadingLine,
  } = components;
  // Bound here rather than handed down as a prop: the static contract test can only verify a key a
  // file reads through its OWN `usePluginStrings` binding, and a drawer this large is exactly where a
  // renamed manifest key would otherwise go unnoticed until it rendered as a blank label.
  const strings = hooks.usePluginStrings('sites');
  const { toast } = hooks.useToast();
  const queryClient = hooks.useQueryClient();

  const [pendingPublic, setPendingPublic] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [guestPicker, setGuestPicker] = useState(false);

  const detail = hooks.useQuery<SiteDetailResponse>({
    queryKey: siteDetailKey(siteId),
    queryFn: () => runtime().api(basePath(siteId)),
  });

  const site = detail.data?.site;
  const members = detail.data?.members ?? [];
  const canManage = site?.canManage === true;

  // The account directory answers only to somebody who owns a site to share, so a guest looking at a
  // shared page must not ask for it at all.
  const directory = hooks.useQuery<DirectoryResponse>({
    queryKey: ['sites', 'directory'],
    queryFn: () => runtime().api('/plugins/sites/api/directory'),
    enabled: canManage,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: siteDetailKey(siteId) });
    void queryClient.invalidateQueries({ queryKey: SITES_LIST_KEY });
  };

  const call = hooks.useMutation<unknown, unknown, { path: string; init: RequestInit; done?: string }>({
    mutationFn: (vars: { path: string; init: RequestInit }) => runtime().api(vars.path, vars.init),
    onSuccess: (_data: unknown, vars: { done?: string }) => {
      refresh();
      toast(vars.done ?? strings.saved);
    },
    onError: (error: unknown) => toast(utils.apiErrorMessage(error), 'error'),
  });

  /** The picker hands back the whole intended guest list, so the difference against the current one is
   *  what actually gets written. Sequential on purpose: each write bumps the site's access generation,
   *  and firing them together makes the resulting invalidations race. */
  const saveGuests = hooks.useMutation<unknown, unknown, Set<string>>({
    mutationFn: async (next: Set<string>) => {
      const current = new Set(members.map((member) => String(member.id)));
      for (const id of next) {
        if (!current.has(id)) await runtime().api(`${basePath(siteId)}/members`, jsonBody('POST', { userId: Number(id) }));
      }
      for (const id of current) {
        if (!next.has(id)) await runtime().api(`${basePath(siteId)}/members/${id}`, { method: 'DELETE' });
      }
    },
    onSuccess: () => { refresh(); toast(strings.saved); },
    onError: (error: unknown) => toast(utils.apiErrorMessage(error), 'error'),
  });

  if (detail.isError) return <EmptyState title={strings.loadFailed} icon={Server} />;
  if (!site) return <LoadingLine />;

  const setVisibility = (next: string) => {
    if (next === 'public') { setPendingPublic(true); return; }
    call.mutate({ path: basePath(siteId), init: jsonBody('PATCH', { visibility: next }) });
  };

  const releases = detail.data?.releases ?? [];
  const visits = (detail.data?.hits ?? []).reduce((sum, entry) => sum + entry.count, 0);
  const runtimeState = detail.data?.runtime ?? null;
  const VisibilityIcon = VISIBILITY_ICON[site.visibility];
  const visibleOptions = VISIBILITY_ORDER.filter((value) => value !== 'public' || allowPublicSites);
  // Guests are picked from every account except the owner, who already holds the site.
  const candidates = (directory.data?.accounts ?? []).filter((account) => account.id !== site.ownerUserId);
  // No address means the hosting gateway is not provisioned. Both actions are about an address, so both
  // are simply unavailable rather than silently copying or opening nothing.
  const copyAddress = () => { if (site.url) { utils.copyText(site.url); toast(strings.copied); } };

  return (
    <div className="flex flex-col gap-5">
      {/* Identity strip — what this site IS and the two things you do with an address, on one line. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge tone={STATUS_TONE[site.status]}>{strings[STATUS_STRING[site.status]]}</Badge>
          <Badge tone={VISIBILITY_TONE[site.visibility]}>
            <VisibilityIcon size={10} aria-hidden className="mr-1" />
            {strings[VISIBILITY_STRING[site.visibility]]}
          </Badge>
          {site.projectSlug ? <Badge tone="muted">{site.projectSlug}</Badge> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IconButton icon={Copy} label={strings.copyLink} disabled={site.url === null} onClick={copyAddress} />
          <IconButton
            icon={ExternalLink}
            label={strings.openSite}
            disabled={site.status !== 'live' || site.url === null}
            onClick={() => { if (site.url) window.open(site.url, '_blank', 'noopener,noreferrer'); }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold leading-snug text-foreground">{site.title}</h2>
        {site.summary ? <p className="text-sm leading-relaxed text-muted-foreground">{site.summary}</p> : null}
      </div>

      <div className="flex items-center gap-2">
        <Avatar size="sm" name={site.owner.name} user={avatarUser(site.owner)} />
        <span className="flex min-w-0 flex-col">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{strings.columnOwner}</span>
          <span className="truncate text-xs text-foreground">{site.owner.name}</span>
        </span>
      </div>

      <DetailBlock icon={Link2} title={strings.address}>
        <code className="break-all font-mono text-xs text-foreground">{site.url}</code>
      </DetailBlock>

      <div className="grid grid-cols-3 divide-x divide-border/70 border-y border-border/70">
        <Metric
          icon={Clock}
          label={strings.lastPublish}
          value={site.lastPublishAt ? relativeTime(site.lastPublishAt) : strings.neverPublished}
          title={site.lastPublishAt ? strings.builtBy.replace('{model}', site.lastPublishModel || '—') : undefined}
        />
        <Metric icon={Activity} label={strings.visits} value={String(visits)} />
        <Metric icon={History} label={strings.releases} value={String(releases.length)} />
      </div>

      <DetailBlock icon={ShieldCheck} title={strings.whoCanOpen} hint={strings.sourceNotice}>
        {canManage ? (
          <SelectMenu
            value={site.visibility}
            onChange={setVisibility}
            label={strings.whoCanOpen}
            options={visibleOptions.map((value) => {
              const Icon = VISIBILITY_ICON[value];
              return { value, label: strings[VISIBILITY_STRING[value]], icon: <Icon size={16} /> };
            })}
          />
        ) : (
          <span className="text-sm text-foreground">{strings[VISIBILITY_STRING[site.visibility]]}</span>
        )}
        {!allowPublicSites ? <p className="text-[11px] text-muted-foreground">{strings.publicDisabled}</p> : null}
      </DetailBlock>

      {/* Owner only. A guest is deliberately not sent the member list, so this block would tell them
          "nobody has been named yet" while they are themselves one of the named guests. */}
      {canManage ? (
        <DetailBlock icon={Users} title={strings.guests} hint={strings.guestsHint}>
          {members.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{strings.noGuests}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {members.map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar size="sm" name={member.name} user={avatarUser(member)} />
                    <span className="truncate text-sm text-foreground">{member.name}</span>
                  </span>
                  <IconButton
                    icon={UserMinus}
                    label={strings.removeGuest}
                    variant="danger"
                    disabled={call.isPending || saveGuests.isPending}
                    onClick={() => call.mutate({ path: `${basePath(siteId)}/members/${member.id}`, init: { method: 'DELETE' } })}
                  />
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button variant="ghost" icon={Users} onClick={() => setGuestPicker(true)}>{strings.manageGuests}</Button>
          </div>
        </DetailBlock>
      ) : null}

      <DetailBlock icon={History} title={strings.releases}>
        {releases.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{strings.noReleases}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {releases.map((release) => {
              const live = release.id === site.currentReleaseId;
              return (
              <li key={release.id} className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${live ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted/40'}`}>
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2 text-xs text-foreground">
                    {relativeTime(release.createdAt)} · {strings.releaseSummary
                      .replace('{files}', String(release.fileCount))
                      .replace('{size}', formatBytes(release.sizeBytes))}
                    {live ? <Badge tone="success">{strings.releaseLive}</Badge> : null}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">{release.note || release.model}</span>
                </span>
                {canManage && !live ? (
                  <IconButton
                    icon={RotateCcw}
                    label={strings.rollback}
                    disabled={call.isPending}
                    onClick={() => call.mutate({
                      path: `${basePath(siteId)}/rollback`,
                      init: jsonBody('POST', { releaseId: release.id }),
                      done: strings.rollbackDone,
                    })}
                  />
                ) : null}
              </li>
              );
            })}
          </ul>
        )}
      </DetailBlock>

      {runtimeState ? (
        <DetailBlock icon={Terminal} title={strings.runtime}>
          <div className="flex items-center justify-between gap-3">
            <Badge tone={runtimeState.running ? 'success' : 'danger'}>
              {runtimeState.running ? strings.runtimeRunning : strings.runtimeStopped}
            </Badge>
            {canManage ? (
              <IconButton
                icon={RefreshCw}
                label={strings.restart}
                disabled={call.isPending}
                onClick={() => call.mutate({ path: `${basePath(siteId)}/restart`, init: { method: 'POST' }, done: strings.restarted })}
              />
            ) : null}
          </div>
          {runtimeState.startCommand ? (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{strings.runtimeCommand}</span>
              <code className="break-all font-mono text-[11px] text-foreground">{runtimeState.startCommand}</code>
            </div>
          ) : null}
          {runtimeState.lastError ? <p className="text-[11px] text-destructive">{runtimeState.lastError}</p> : null}
          {runtimeState.logTail !== null ? (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{strings.runtimeLog}</span>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] text-muted-foreground">
                {runtimeState.logTail || strings.runtimeEmptyLog}
              </pre>
            </div>
          ) : null}
        </DetailBlock>
      ) : null}

      {canManage ? (
        <DetailBlock icon={Trash2} title={strings.deleteTitle}>
          <p className="text-[11px] text-muted-foreground">{strings.deleteHint}</p>
          <div>
            <Button variant="ghost-danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>{strings.delete}</Button>
          </div>
        </DetailBlock>
      ) : null}

      <ManageSelectionModal
        open={guestPicker}
        title={strings.guestsPickerTitle}
        subtitle={strings.guestsPickerSubtitle}
        onClose={() => setGuestPicker(false)}
        items={candidates.map((account) => ({
          id: String(account.id),
          label: account.name,
          group: 'accounts',
          groupLabel: strings.guestsGroup,
          icon: <Avatar size={20} name={account.name} user={avatarUser(account)} />,
        }))}
        countLabel={(count: number) => strings.guestsCount.replace('{n}', String(count))}
        selected={new Set(members.map((member) => String(member.id)))}
        onSave={async (next: Set<string>) => { await saveGuests.mutateAsync(next); }}
        saving={saveGuests.isPending}
        emptySelectionHint={strings.noGuests}
      />

      <ConfirmDialog
        open={pendingPublic}
        title={strings.publicConfirm}
        description={strings.publicWarning}
        confirmLabel={strings.publicConfirm}
        onClose={() => setPendingPublic(false)}
        onConfirm={() => {
          setPendingPublic(false);
          call.mutate({ path: basePath(siteId), init: jsonBody('PATCH', { visibility: 'public' satisfies Visibility }) });
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={strings.deleteTitle}
        description={strings.deleteHint}
        confirmLabel={strings.delete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          call.mutate(
            { path: basePath(siteId), init: { method: 'DELETE' }, done: strings.deleted },
            { onSuccess: () => onDeleted() },
          );
        }}
      />
    </div>
  );
}

function Metric({ icon: Icon, label, value, title }: {
  icon: typeof Clock;
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-2 py-3" title={title}>
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon size={11} aria-hidden />{label}
      </span>
      <span className="truncate font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}
