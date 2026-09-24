import { useEffect, useRef, useState } from 'react';
import {
  Activity, Boxes, Clock, Copy, ExternalLink, History, RefreshCw, RotateCcw,
  Server, ShieldCheck, Trash2, UserMinus, Users,
} from 'lucide-react';
import {
  PREVIEW_POLL_MS, runtime, avatarUser, formatBytes, jsonBody, previewImageUrl, relativeTime, siteDetailKey, SITES_LIST_KEY,
  type DirectoryResponse, type SiteDetailResponse, type SiteView, type Visibility,
} from './runtime.js';
import { displayStatus, STATUS_STRING, STATUS_TONE, VISIBILITY_ICON, VISIBILITY_ORDER, VISIBILITY_STRING, VISIBILITY_TONE } from './meta.js';
import { ReadOnlySiteAddress, SiteDomains } from './SiteDomains.js';

const basePath = (siteId: string): string => `/plugins/sites/api/site/${siteId}`;

/** The picture of the published page, with the one control that takes a new one.
 *
 *  It leads the drawer because it is the page: everything else here only describes the site, while this
 *  is what they will actually see. The refresh control is the manager's, and the server rate-limits it,
 *  so a second press inside the window comes back as the refusal it is rather than as a second browser.
 *  Nothing here is fetched by the drawer itself: the picture has its own endpoint and its own version, so
 *  a new one arrives as a new address rather than as a stale cache entry. */
function PreviewBlock({ site, notice, busy, onRefresh, strings }: {
  site: SiteView;
  notice: string | null;
  busy: boolean;
  onRefresh(): void;
  strings: Record<string, string>;
}) {
  const { components } = runtime();
  const { Badge, Button } = components;
  const preview = site.preview;
  const [refusedVersion, setRefusedVersion] = useState<number | null>(null);
  const picture = preview.version > 0 && refusedVersion !== preview.version;
  const taken = preview.capturedAt ? strings.previewCapturedAt.replace('{time}', relativeTime(preview.capturedAt)) : null;

  return (
    <section className="flex flex-col gap-2">
      <div className="relative aspect-[16/6] w-full overflow-hidden rounded-lg border border-border/60 bg-muted/40">
        {picture ? (
            <img
            key={preview.version}
            src={previewImageUrl(site.id, preview.version)}
            alt=""
            aria-hidden
            data-site-picture={site.id}
            onError={() => setRefusedVersion(preview.version)}
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        ) : (
          <span
            className={`absolute inset-0 flex items-center justify-center px-4 text-center text-caption text-muted-foreground ${preview.state === 'pending' ? 'motion-safe:animate-pulse' : ''}`}
          >
            {preview.state === 'pending' ? strings.previewPending : strings.previewNone}
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {/* When the picture was taken, said once, next to the thing it describes. That it is older than
            the register would like is not stated anywhere: the register is already taking a new one. */}
        {taken ? <span className="min-w-0 truncate text-caption text-muted-foreground">{taken}</span> : null}
        {preview.state === 'failed' ? <Badge tone="danger">{strings.previewFailed}</Badge> : null}
        <span className="flex-1" />
        {site.canManage ? (
          <Button
            variant="ghost"
            icon={RefreshCw}
            disabled={busy || preview.state === 'pending'}
            onClick={onRefresh}
          >
            {strings.previewRefresh}
          </Button>
        ) : null}
      </div>
      {notice ? <p className="text-caption leading-tight text-muted-foreground">{notice}</p> : null}
    </section>
  );
}

/** Everything about one site, as a single scrolling document inside the workspace drawer.
 *
 *  Deliberately NOT tabbed: the drawer is one fixed size on every surface, and a tab strip inside it
 *  would make the same drawer feel like four differently shaped panels. Every choice here is a
 *  dropdown, a picker or a confirmed action — there is no field to type an id or a name into. */
export function SiteDetail({ siteId, allowPublicSites, onDeleted, onBusyChange }: {
  siteId: string;
  allowPublicSites: boolean;
  onDeleted(): void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { components, hooks, utils } = runtime();
  const {
    Avatar, Badge, Button, IconButton, SelectMenu, ConfirmDialog, ManageSelectionModal,
    DetailBlock, EmptyState, ErrorState, LoadingLine,
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
  const [failedAction, setFailedAction] = useState<{ path: string; init: RequestInit; done?: string; message: string } | null>(null);
  const [failedGuests, setFailedGuests] = useState<{ next: Set<string>; message: string } | null>(null);
  const callRef = useRef(false);
  const guestsRef = useRef(false);

  const detail = hooks.useQuery<SiteDetailResponse>({
    queryKey: siteDetailKey(siteId),
    queryFn: () => runtime().api(basePath(siteId)),
    // A capture is the only reason this drawer has to look again on its own, and only while one is running:
    // a register nothing is happening in asks for nothing.
    refetchInterval: (query: { state: { data?: SiteDetailResponse } }) =>
      query.state.data?.site.preview.state === 'pending' ? PREVIEW_POLL_MS : false,
  });
  const detailRefetch = useRef(detail.refetch);
  detailRefetch.current = detail.refetch;

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
    onSuccess: (_data: unknown, vars: { path: string; init: RequestInit; done?: string }) => {
      setFailedAction(null);
      const deleted = vars.path === basePath(siteId) && vars.init.method === 'DELETE';
      // Unmount the detail query before refreshing the list. Invalidating the deleted id while this drawer
      // is still mounted immediately asks the API for a row that cannot exist and turns success into a 404.
      if (deleted) onDeleted();
      else void queryClient.invalidateQueries({ queryKey: siteDetailKey(siteId) });
      void queryClient.invalidateQueries({ queryKey: SITES_LIST_KEY });
      toast(vars.done ?? strings.saved);
    },
    onError: (error: unknown, vars: { path: string; init: RequestInit; done?: string }) => {
      const message = utils.apiErrorMessage(error);
      setFailedAction({ ...vars, message });
      toast(message, 'error');
    },
  });

  /** The picker hands back the whole intended guest list. The server replaces the set in one transaction,
   * so a crash or concurrent refresh cannot leave half the guests from the old and new selections. */
  const saveGuests = hooks.useMutation<unknown, unknown, Set<string>>({
    mutationFn: (next: Set<string>) => runtime().api(`${basePath(siteId)}/members/replace`, jsonBody('POST', {
      userIds: [...next].map(Number),
    })),
    onSuccess: () => { setFailedGuests(null); refresh(); toast(strings.saved); },
    onError: (error: unknown, next: Set<string>) => {
      // A later delta may have landed before the failure. Reconcile the drawer before offering Retry.
      const message = utils.apiErrorMessage(error);
      setFailedGuests({ next: new Set(next), message });
      refresh();
      toast(message, 'error');
    },
  });
  const runCall = (
    vars: { path: string; init: RequestInit; done?: string },
    onSuccess?: () => void,
  ) => {
    if (callRef.current) return;
    callRef.current = true;
    call.mutate(vars, {
      onSuccess: () => { callRef.current = false; onSuccess?.(); },
      onError: () => { callRef.current = false; },
    });
  };
  const runGuests = async (next: Set<string>) => {
    if (guestsRef.current) return;
    guestsRef.current = true;
    try { await saveGuests.mutateAsync(next); }
    finally { guestsRef.current = false; }
  };
  useEffect(() => {
    onBusyChange?.(callRef.current || guestsRef.current || call.isPending || saveGuests.isPending);
  }, [call.isPending, onBusyChange, saveGuests.isPending]);

  if (detail.isError) return <EmptyState title={strings.loadFailed} icon={Server} />;
  if (!site) return <LoadingLine />;

  const setVisibility = (next: string) => {
    if (callRef.current) return;
    if (next === 'public') { setPendingPublic(true); return; }
    runCall({ path: basePath(siteId), init: jsonBody('PATCH', { visibility: next }) });
  };

  const releases = detail.data?.releases ?? [];
  const visits = (detail.data?.hits ?? []).reduce((sum, entry) => sum + entry.count, 0);
  const displayedStatus = displayStatus(site);
  const VisibilityIcon = VISIBILITY_ICON[site.visibility];
  const visibleOptions = VISIBILITY_ORDER.filter((value) => value !== 'public' || allowPublicSites);
  // Guests are picked from every account except the owner, who already holds the site.
  const candidates = (directory.data?.accounts ?? []).filter((account) => account.id !== site.ownerUserId);
  // No address means the hosting gateway is not provisioned. Both actions are about an address, so both
  // are simply unavailable rather than silently copying or opening nothing.
  const copyAddress = () => { if (site.url) { utils.copyText(site.url); toast(strings.copied); } };

  return (
    <div className="flex flex-col gap-5">
      <PreviewBlock
        site={site}
        notice={detail.data?.previewNotice ?? null}
        busy={call.isPending}
        strings={strings}
        onRefresh={() => runCall({
          path: `${basePath(siteId)}/preview/refresh`,
          init: { method: 'POST' },
          done: strings.previewRefreshed,
        })}
      />

      {failedAction ? (
        <ErrorState
          message={failedAction.message}
          onRetry={() => { const retry = failedAction; setFailedAction(null); runCall(retry); }}
        />
      ) : null}
      {failedGuests ? (
        <ErrorState
          message={failedGuests.message}
          onRetry={() => { const retry = failedGuests.next; setFailedGuests(null); void runGuests(retry); }}
        />
      ) : null}
      {/* Identity strip — what this site IS and the two things you do with an address, on one line. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Badge tone={STATUS_TONE[displayedStatus]}>
              {strings[STATUS_STRING[displayedStatus]]}
            </Badge>
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
        {detail.data?.lastError ? <p className="text-caption text-destructive">{detail.data.lastError}</p> : null}
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold leading-snug text-foreground">{site.title}</h2>
        {site.summary ? <p className="text-sm leading-relaxed text-muted-foreground">{site.summary}</p> : null}
      </div>

      <div className="flex items-center gap-2">
        <Avatar size="sm" name={site.owner.name} user={avatarUser(site.owner)} />
        <span className="flex min-w-0 flex-col">
          <span className="text-tiny uppercase tracking-wide text-muted-foreground">{strings.columnOwner}</span>
          <span className="truncate text-xs text-foreground">{site.owner.name}</span>
        </span>
      </div>

      {canManage
        ? <SiteDomains siteId={site.id} />
        : <ReadOnlySiteAddress url={site.url} strings={strings} />}

      <div className="grid grid-cols-3 divide-x divide-border/70 border-y border-border/70">
        <Metric
          icon={Clock}
          label={strings.lastPublish}
          value={site.lastPublishAt ? relativeTime(site.lastPublishAt) : strings.neverPublished}
          title={site.lastPublishAt ? strings.builtBy.replace('{model}', site.lastPublishModel || '—') : undefined}
        />
        <Metric icon={Activity} label={strings.visits} value={String(visits)} />
        {/* A proxy publication owns neither releases nor snapshots, so the slot counts nothing and names
            the thing it does have instead: the forwarder port inside the Project environment. */}
        <Metric
          icon={site.kind === 'proxy' ? Server : History}
          label={site.kind === 'proxy' ? strings.port : strings.releases}
          value={site.kind === 'proxy' ? (site.target || '—') : String(releases.length)}
        />
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
        {!allowPublicSites ? <p className="text-caption text-muted-foreground">{strings.publicDisabled}</p> : null}
      </DetailBlock>

      {/* Owner only. A guest is deliberately not sent the member list, so this block would tell them
          "nobody has been named yet" while they are themselves one of the named guests. */}
      {canManage ? (
        <DetailBlock icon={Users} title={strings.guests} hint={strings.guestsHint}>
          {members.length === 0 ? (
            <p className="text-caption text-muted-foreground">{strings.noGuests}</p>
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
                    onClick={() => runCall({ path: `${basePath(siteId)}/members/${member.id}`, init: { method: 'DELETE' } })}
                  />
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button variant="ghost" icon={Users} disabled={call.isPending || saveGuests.isPending} onClick={() => setGuestPicker(true)}>{strings.manageGuests}</Button>
          </div>
        </DetailBlock>
      ) : null}

      {/* A proxy publication is served by the Project's environment, which this drawer does not own: it
          has no release, no container and therefore no environment control of its own. The branch comes
          first so that a proxy row can never fall through into the environment or releases surface. */}
      {site.kind === 'proxy' ? (
        <DetailBlock icon={Boxes} title={strings.kindProxy}>
          <p className="text-sm text-foreground">
            {strings.projectPublicationLink.replace('{project}', site.projectSlug ?? '—')}
          </p>
          <div>
            <Button variant="ghost" icon={ExternalLink} onClick={() => runtime().navigate(`/projects?project=${site.projectId}`)}>{strings.openProject}</Button>
          </div>
        </DetailBlock>
      ) : (
        <DetailBlock icon={History} title={strings.releases}>
          {releases.length === 0 ? (
            <p className="text-caption text-muted-foreground">{strings.noReleases}</p>
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
                    <span className="truncate text-caption text-muted-foreground">{release.note || release.model}</span>
                  </span>
                  {canManage && !live ? (
                    <IconButton
                      icon={RotateCcw}
                      label={strings.rollback}
                      disabled={call.isPending}
                      onClick={() => runCall({
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
      )}

      {canManage ? (
        <DetailBlock icon={Trash2} title={strings.deleteTitle}>
          <p className="text-caption text-muted-foreground">{strings.deleteHint}</p>
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
        onSave={runGuests}
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
          if (callRef.current) return;
          setPendingPublic(false);
          runCall({ path: basePath(siteId), init: jsonBody('PATCH', { visibility: 'public' satisfies Visibility }) });
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={strings.deleteTitle}
        description={strings.deleteHint}
        confirmLabel={strings.delete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (callRef.current) return;
          setConfirmDelete(false);
          runCall({ path: basePath(siteId), init: { method: 'DELETE' }, done: strings.deleted });
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
      {/* The label keeps to one line: three of these sit side by side, and a label that wraps pushes its
          own value a line below the other two. */}
      <span className="inline-flex min-w-0 items-center gap-1 text-tiny uppercase tracking-wide text-muted-foreground">
        <Icon size={11} aria-hidden className="shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <span className="truncate font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}
