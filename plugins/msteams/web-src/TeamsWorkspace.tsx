import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, KeyRound, MessageCircle, RefreshCw, Search, Settings2, ShieldCheck, UserCheck, Users } from 'lucide-react';
import { apiJson, runtime, type ConfigField, type PeopleResponse, type PluginDetail, type RolePolicy, type TeamsAccountDetail, type TeamsIdentity, type TeamsPerson, type User } from './runtime';

type WorkspaceTab = 'people' | 'settings';
type PersonFilter = 'all' | 'mapped' | 'unmapped';

export function matchesPerson(policy: RolePolicy, person: TeamsPerson): boolean {
  const roleId = policy.roleId.trim();
  if (roleId === '' || roleId === '*') return false;
  if (person.upn && roleId.includes('@') && roleId.toLowerCase() === person.upn.toLowerCase()) return true;
  return [person.aadObjectId, person.teamsId].some((id) => id !== '' && roleId === id);
}

function isBroadPolicy(policy: RolePolicy): boolean {
  const roleId = policy.roleId.trim();
  return roleId === '*' || roleId.startsWith('a:') || roleId.startsWith('19:');
}

/** Conversation and wildcard policies win over every matching person policy below them, exactly as the
 * adapter's first-match lookup does. */
export function directPolicyIndex(policies: RolePolicy[], person: TeamsPerson): number {
  const direct = policies.findIndex((policy) => matchesPerson(policy, person));
  if (direct < 0) return -1;
  const broad = policies.findIndex(isBroadPolicy);
  return broad < 0 || direct < broad ? direct : -1;
}

export function effectivePersonPolicy(policies: RolePolicy[], person: TeamsPerson): RolePolicy | undefined {
  return policies.find((policy) => policy.roleId.trim() === '*' || matchesPerson(policy, person));
}

/** Insert or relocate one person's policy before every conversation/wildcard fallback. */
export function upsertDirectPolicy(policies: RolePolicy[], person: TeamsPerson, nextPolicy: RolePolicy): RolePolicy[] {
  const existing = policies.find((policy) => matchesPerson(policy, person));
  const next = policies.filter((policy) => !matchesPerson(policy, person));
  const broad = next.findIndex(isBroadPolicy);
  next.splice(broad < 0 ? next.length : broad, 0, existing ?? nextPolicy);
  return next;
}

function primaryId(person: TeamsPerson): string {
  return person.aadObjectId || person.upn || person.teamsId || person.key;
}

function policiesOf(values: Record<string, unknown>): RolePolicy[] {
  return Array.isArray(values.rolePolicies) ? values.rolePolicies as RolePolicy[] : [];
}

/** Person access owns rolePolicies. The global settings tab keeps the same draft but must not expose a
 * second editor for the same ordered authorization list. Existing fallback policies stay persisted. */
export function globalSettingsDetail(detail: PluginDetail): PluginDetail {
  return {
    ...detail,
    configSchema: detail.configSchema.filter((field) => field.key !== 'sec_roles' && field.key !== 'rolePolicies'),
  };
}

export function linkedUserFor(person: TeamsPerson, users: User[]): User | undefined {
  const identityUser = person.identity?.user;
  if (!identityUser) return undefined;
  return users.find((user) => user.id === identityUser.id || user.username.toLowerCase() === identityUser.username.toLowerCase());
}

export function accountDetailPath(aadObjectId: string): string {
  return `/plugins/msteams/people/${encodeURIComponent(aadObjectId)}/account`;
}

export function accountIdentityFromDetail(detail: TeamsAccountDetail): TeamsIdentity {
  return {
    linked: detail.linked,
    ...(detail.user ? { user: { id: detail.user.id, username: detail.user.username, isAdmin: detail.user.isAdmin } } : {}),
    ...(detail.linkedAt ? { linkedAt: detail.linkedAt } : {}),
  };
}

export function bindAccountRequest(userId: number, replace = false): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, ...(replace ? { replace: true } : {}) }),
  };
}

export function peopleWithAccountDetail(response: PeopleResponse, aadObjectId: string, detail: TeamsAccountDetail): PeopleResponse {
  return {
    ...response,
    people: response.people.map((person) => person.aadObjectId === aadObjectId
      ? { ...person, identity: accountIdentityFromDetail(detail) }
      : person),
  };
}

/**
 * SelectMenu resolves a value that matches no option to the first one, so an identity with no linked
 * account would render as if the first account in the list were already linked. The unlinked state
 * therefore needs an option of its own; once an account is linked the field only offers replacements.
 */
export function accountLinkOptions(linkedUserId: number | undefined, users: User[], noneLabel: string): { value: string; label: string; user?: User }[] {
  return [
    ...(linkedUserId === undefined ? [{ value: '', label: noneLabel }] : []),
    ...users.map((user) => ({
      value: String(user.id),
      label: user.name ? `${user.name} · @${user.username}` : `@${user.username}`,
      user,
    })),
  ];
}

function formatTimestamp(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function IdentityCard({ person, users, onDetail }: {
  person: TeamsPerson;
  users: User[];
  onDetail(aadObjectId: string, detail: TeamsAccountDetail): void;
}) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('msteams');
  const [detail, setDetail] = useState<TeamsAccountDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacement, setReplacement] = useState<User | null>(null);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setError(null);
    setReplacement(null);
    if (!person.aadObjectId) {
      setLoading(false);
      return () => { live = false; };
    }
    setLoading(true);
    void apiJson<TeamsAccountDetail>(accountDetailPath(person.aadObjectId))
      .then((value) => {
        if (!live) return;
        setDetail(value);
        onDetail(person.aadObjectId, value);
      })
      .catch((reason) => { if (live) setError(utils.apiErrorMessage(reason)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [onDetail, person.aadObjectId, utils]);

  const applyDetail = (value: TeamsAccountDetail) => {
    setDetail(value);
    setError(null);
    onDetail(person.aadObjectId, value);
  };
  const bind = async (user: User, replace: boolean) => {
    setPending(true);
    setError(null);
    try {
      applyDetail(await apiJson<TeamsAccountDetail>(accountDetailPath(person.aadObjectId), bindAccountRequest(user.id, replace)));
      setReplacement(null);
    } catch (reason) {
      setError(utils.apiErrorMessage(reason));
    } finally {
      setPending(false);
    }
  };
  const signOut = async () => {
    setPending(true);
    setError(null);
    try {
      applyDetail(await apiJson<TeamsAccountDetail>(`${accountDetailPath(person.aadObjectId).replace(/\/account$/, '')}/signout`, { method: 'POST' }));
    } catch (reason) {
      setError(utils.apiErrorMessage(reason));
    } finally {
      setPending(false);
    }
  };

  const identity = detail ?? { linked: person.identity?.linked === true, user: person.identity?.user, linkedAt: person.identity?.linkedAt, signedIn: false };
  const linkedHostUser = identity.user
    ? users.find((user) => user.id === identity.user?.id || user.username.toLowerCase() === identity.user?.username.toLowerCase())
    : undefined;
  const accountOptions = accountLinkOptions(identity.user?.id, users, s.accountNone).map((option) => ({
    value: option.value,
    label: option.label,
    icon: option.user
      ? <C.Avatar name={option.user.name || option.user.username} user={option.user} size="sm" />
      : <UserCheck size={15} />,
  }));
  const statusLabel = identity.linked ? (identity.signedIn ? s.identityConnected : s.identityNeedsSignIn) : s.identityNotLinked;
  const profile = detail?.profile;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.identityTitle}</p>
          <div className="mt-2 flex items-center gap-2">
            <C.Badge tone={identity.signedIn ? 'success' : identity.linked ? 'warning' : undefined}>{statusLabel}</C.Badge>
            {loading ? <span className="text-xs text-muted-foreground">{s.identityLoading}</span> : null}
          </div>
        </div>
        <C.Button variant="ghost" icon={RefreshCw} disabled={pending || !person.aadObjectId} onClick={() => void signOut()}>
          {s.identityForceSignIn}
        </C.Button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-foreground">{s.identityMicrosoftProfile}</p>
          <p className="text-sm text-foreground">{profile?.displayName || person.name || s.personFallback}</p>
          <p className="break-all text-xs text-muted-foreground">{profile?.userPrincipalName || person.upn || '—'}</p>
          {profile?.mail && profile.mail !== profile.userPrincipalName ? <p className="break-all text-xs text-muted-foreground">{profile.mail}</p> : null}
          <p className="break-all font-mono text-[11px] text-subtle-foreground">{profile?.id || person.aadObjectId || '—'}</p>
          {profile ? <p className="text-xs text-muted-foreground">{profile.userType} · {profile.accountEnabled ? s.identityAccountEnabled : s.identityAccountDisabled}</p> : null}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-foreground">{s.identityElowenAccount}</p>
          {identity.user ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <C.Avatar name={linkedHostUser?.name || identity.user.username} user={linkedHostUser} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{linkedHostUser?.name || `@${identity.user.username}`}</p>
                <p className="truncate text-xs text-muted-foreground">@{identity.user.username}</p>
              </div>
              {identity.user.isAdmin ? <C.Badge tone="accent">{s.identityAdmin}</C.Badge> : null}
            </div>
          ) : <p className="text-xs text-muted-foreground">{s.identityNoElowenAccount}</p>}
          <C.Field label={identity.user ? s.identityChangeAccount : s.identityLinkAccount} hint={s.identityLinkAccountHint}>
            <C.SelectMenu
              value={identity.user ? String(identity.user.id) : ''}
              onChange={(value: string) => {
                const user = users.find((candidate) => String(candidate.id) === value);
                if (!user || user.id === identity.user?.id) return;
                if (identity.linked) setReplacement(user);
                else void bind(user, false);
              }}
              options={accountOptions}
              label={identity.user ? s.identityChangeAccount : s.identityLinkAccount}
              disabled={pending}
            />
          </C.Field>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>{person.hasPersonalChat ? s.identityPersonalChatOpen : s.identityPersonalChatMissing}</span>
        <span>{s.identityLastSeen.replace('{value}', formatTimestamp(person.lastSeenAt))}</span>
        <span>{identity.signedIn ? s.identitySessionActive : s.identitySessionSignedOut}</span>
        {identity.linkedAt ? <span>{s.identityLinkedAt.replace('{value}', formatTimestamp(identity.linkedAt))}</span> : null}
        {detail?.verifiedAt ? <span>{s.identityVerifiedAt.replace('{value}', formatTimestamp(detail.verifiedAt))}</span> : null}
      </div>
      {pending ? <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">{s.identitySaving}</p> : null}
      {error ? <p className="mt-3 text-xs text-destructive" role="alert">{error}</p> : null}

      <C.ConfirmDialog
        open={replacement !== null}
        title={s.identityReplaceTitle}
        description={replacement ? s.identityReplaceDescription.replace('{username}', replacement.username) : ''}
        confirmLabel={s.identityReplaceConfirm}
        onConfirm={() => { if (replacement) void bind(replacement, true); }}
        onClose={() => setReplacement(null)}
      />
    </section>
  );
}

function PeopleAccess({ draft, response, onIdentityDetail }: {
  draft: ReturnType<ReturnType<typeof runtime>['hooks']['usePluginConfigDraft']>;
  response: PeopleResponse;
  onIdentityDetail(aadObjectId: string, detail: TeamsAccountDetail): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('msteams');
  const users = hooks.useUsers().data ?? [];
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<PersonFilter>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(response.people[0]?.key ?? null);

  const policies = policiesOf(draft.values);
  const visible = response.people.filter((person) => {
    const mapped = directPolicyIndex(policies, person) >= 0;
    if (filter === 'mapped' && !mapped) return false;
    if (filter === 'unmapped' && mapped) return false;
    const haystack = `${person.name} ${person.upn} ${person.aadObjectId}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });
  const selected = response.people.find((person) => person.key === selectedKey) ?? visible[0] ?? null;
  const policyIndex = selected === null ? -1 : directPolicyIndex(policies, selected);
  const policy = policyIndex >= 0 ? policies[policyIndex]! : null;
  const accountLinking = draft.values.accountLinking === true;
  const selectedUser = selected === null ? undefined : linkedUserFor(selected, users);

  const replacePolicies = (next: RolePolicy[]) => draft.setValue('rolePolicies', next);
  const createPolicy = () => {
    if (selected === null) return;
    const nextPolicy = { roleId: primaryId(selected), name: selected.name || selected.upn || s.personFallback, prompt: '' };
    replacePolicies(upsertDirectPolicy(policies, selected, nextPolicy));
  };
  const patchPolicy = (patch: Partial<RolePolicy>) => {
    if (policyIndex < 0) return;
    replacePolicies(policies.map((item, index) => index === policyIndex ? { ...item, ...patch } : item));
  };
  const removePolicy = () => {
    if (policyIndex < 0) return;
    replacePolicies(policies.filter((_, index) => index !== policyIndex));
  };

  const inherited = policies.some((item) => item.roleId === '*');

  return (
    <C.ControlSurfaceDocument>
      {/* The toolbar is itself a wrapping flex row whose children may shrink, so the search field and
          the filter need no wrapper of their own — the copy-pasted `min-w-[15rem]` box around the input
          was what pushed the filter out of the surface at 320px. */}
      <C.ControlSurfaceToolbar>
        <C.RegisterSearch
          value={search}
          onChange={setSearch}
          placeholder={s.peopleSearch}
          label={s.peopleSearch}
          onClear={() => setSearch('')}
          clearLabel={s.peopleSearchClear}
          count={visible.length}
          countLabel={s.peopleSearchCount}
        />
        <C.Segmented
          aria-label={s.peopleFilter}
          nowrap
          value={filter}
          onChange={(value: string) => setFilter(value as PersonFilter)}
          options={[
            { value: 'all', label: s.filterAll },
            { value: 'mapped', label: s.filterMapped },
            { value: 'unmapped', label: s.filterUnmapped },
          ]}
        />
      </C.ControlSurfaceToolbar>

      {response.people.length === 0 ? (
        <C.ControlSurfaceState>
          <C.EmptyState title={s.peopleEmptyTitle} description={s.peopleEmptyDescription} icon={Users} />
        </C.ControlSurfaceState>
      ) : visible.length === 0 ? (
        <C.ControlSurfaceState>
          <C.EmptyState title={s.peopleNoResults} description={s.peopleNoResultsDescription} icon={Search} />
        </C.ControlSurfaceState>
      ) : (
        <C.ControlSurfaceRegister className="grid min-h-[31rem] grid-cols-1 gap-4 p-4 lg:!grid-cols-[19rem_minmax(0,1fr)] lg:items-start">
          <div className="flex min-w-0 flex-col gap-1 lg:max-h-[calc(100dvh-15rem)] lg:overflow-y-auto lg:pr-1">
            {visible.map((person) => {
              const mapped = directPolicyIndex(policies, person) >= 0;
              const linkedUser = linkedUserFor(person, users);
              const active = selected?.key === person.key;
              const accessLabel = mapped ? s.badgeMapped : inherited ? s.badgeInherited : s.badgeUnmapped;
              return (
                <button
                  type="button"
                  key={person.key}
                  aria-pressed={active}
                  onClick={() => setSelectedKey(person.key)}
                  className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${active ? 'border-primary/50 bg-accent text-accent-foreground' : 'border-transparent bg-transparent text-foreground hover:border-border hover:bg-accent hover:text-accent-foreground'}`}
                >
                  <C.Avatar name={person.name || person.upn || s.personFallback} src={person.teamsAvatarUrl} user={linkedUser} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{person.name || s.personFallback}</span>
                    <span className={`block truncate text-xs ${active ? 'text-accent-foreground opacity-70' : 'text-muted-foreground group-hover:text-accent-foreground'}`}>{person.upn || person.aadObjectId}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center" title={accessLabel} aria-label={accessLabel}>
                    <span className={`size-2 rounded-full ${mapped ? 'bg-primary' : 'bg-border-strong'}`} aria-hidden />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="min-w-0 rounded-xl border border-border bg-muted/30 p-5 lg:sticky lg:top-4 lg:self-start">
            {selected === null ? null : (
              <div className="flex flex-col gap-5">
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                  <C.Avatar name={selected.name || selected.upn || s.personFallback} src={selected.teamsAvatarUrl} user={selectedUser} size="lg" />
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-foreground">{selected.name || s.personFallback}</h2>
                    <p className="truncate text-sm text-muted-foreground">{selected.upn || selected.aadObjectId}</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-subtle-foreground">{selected.aadObjectId || selected.teamsId}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <C.Badge tone={policy ? 'accent' : undefined}>{policy ? s.badgeMapped : inherited ? s.badgeInherited : s.badgeUnmapped}</C.Badge>
                      {selected.hasPersonalChat ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><MessageCircle size={12} aria-hidden />{s.chatOpen}</span> : null}
                    </div>
                  </div>
                  {policy ? <div className="col-span-2 sm:col-span-1"><C.Button variant="ghost" onClick={removePolicy}>{s.removeAccess}</C.Button></div> : null}
                </div>

                {accountLinking ? <IdentityCard key={selected.key} person={selected} users={users} onDetail={onIdentityDetail} /> : null}

                {policy === null ? (
                  <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 text-center">
                    <UserCheck size={28} className="text-muted-foreground" aria-hidden />
                    <div>
                      <p className="text-sm font-semibold text-foreground">{inherited ? s.inheritedTitle : s.unmappedTitle}</p>
                      <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{inherited ? s.inheritedDescription : s.unmappedDescription}</p>
                    </div>
                    <C.Button variant="accent" icon={KeyRound} onClick={createPolicy}>{s.configureAccess}</C.Button>
                  </div>
                ) : (
                  <>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3">
                      <C.Toggle checked={policy.admin === true} onChange={(value: boolean) => patchPolicy({ admin: value })} label={s.adminLabel} />
                      <span>
                        <span className="block text-sm font-medium text-foreground">{s.adminLabel}</span>
                        <span className="block text-xs leading-relaxed text-muted-foreground">{s.adminHint}</span>
                      </span>
                    </label>

                    <C.Field label={s.promptLabel} hint={s.promptHint}>
                      <textarea
                        value={policy.prompt ?? ''}
                        onChange={(event) => patchPolicy({ prompt: event.target.value })}
                        rows={5}
                        className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
                        placeholder={s.promptPlaceholder}
                      />
                    </C.Field>
                  </>
                )}
              </div>
            )}
          </div>
        </C.ControlSurfaceRegister>
      )}
    </C.ControlSurfaceDocument>
  );
}

function LoadedWorkspace({ detail }: { detail: PluginDetail }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('msteams');
  const { locale } = hooks.useTranslation();
  const draft = hooks.usePluginConfigDraft('msteams', detail);
  const [tab, setTab] = useState<WorkspaceTab>('people');
  const [people, setPeople] = useState<PeopleResponse | null>(null);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const updateIdentityDetail = useCallback((aadObjectId: string, account: TeamsAccountDetail) => {
    setPeople((current) => current ? peopleWithAccountDetail(current, aadObjectId, account) : current);
  }, []);

  useEffect(() => {
    let live = true;
    void apiJson<PeopleResponse>('/plugins/msteams/people')
      .then((value) => { if (live) setPeople(value); })
      .catch((error) => { if (live) setPeopleError(utils.apiErrorMessage(error)); });
    return () => { live = false; };
  }, [utils]);

  const policies = policiesOf(draft.values);
  const mappedCount = people?.people.filter((person) => directPolicyIndex(policies, person) >= 0).length ?? 0;
  const openChats = people?.people.filter((person) => person.hasPersonalChat).length ?? 0;
  const adminCount = people === null ? '—' : people.people.filter((person) => effectivePersonPolicy(policies, person)?.admin === true).length;
  const configured = Boolean(String(draft.values.appId ?? '').trim() && String(draft.values.tenantId ?? '').trim() && detail.secretsSet.includes('appPassword'));
  const overlay = detail.i18n?.[locale]?.fields ?? {};
  const fieldLabel = (field: ConfigField) => overlay[field.key]?.label ?? field.label;
  const fieldHint = (field: ConfigField) => overlay[field.key]?.hint ?? field.hint;
  const fieldOptions = (field: ConfigField) => (field.options ?? []).map((option) => ({ value: option.value, label: overlay[field.key]?.options?.[option.value] ?? option.label }));
  const riskText = (risk: 'low' | 'medium' | 'high') => risk === 'high' ? s.riskHigh : risk === 'medium' ? s.riskMedium : s.riskLow;

  const hero = {
    eyebrow: s.workspaceEyebrow,
    title: s.title,
    description: s.workspaceIntro,
    mascot: peopleError !== null || !configured ? 'error' : draft.status === 'saving' ? 'saving' : 'idle',
    status: (
      <span className="flex items-center gap-3">
        <span className="workspace-status">{configured && people?.active ? s.workspaceReady : s.workspaceSetup}</span>
        <C.AutoSaveStatus status={draft.status} onRetry={draft.retry} />
      </span>
    ),
    action: (
      <C.Button variant="accent" icon={Download} disabled={!configured} onClick={() => { window.location.href = '/api/plugins/msteams/app-package'; }}>
        {s.downloadPackage}
      </C.Button>
    ),
    metrics: (
      <>
        <C.WorkspaceMetric label={s.metricPeople} value={people?.people.length ?? '—'} icon={Users} />
        <C.WorkspaceMetric label={s.metricMapped} value={people === null ? '—' : mappedCount} icon={UserCheck} />
        <C.WorkspaceMetric label={s.metricChats} value={people === null ? '—' : openChats} icon={MessageCircle} />
        <C.WorkspaceMetric label={s.metricAdmins} value={adminCount} icon={ShieldCheck} />
      </>
    ),
  };

  return (
    <C.WorkspaceShell
      variant="register"
      hero={hero}
      navigation={{
        sections: [
          { id: 'people', label: s.peopleTab, icon: Users },
          { id: 'settings', label: s.settingsTab, icon: Settings2 },
        ],
        value: tab,
        onChange: (value: WorkspaceTab) => setTab(value),
        ariaLabel: s.title,
      }}
    >
      {tab === 'people' ? (
        peopleError !== null ? (
          <C.ControlSurfaceDocument><C.ControlSurfaceState tone="danger"><C.ErrorState message={`${s.peopleLoadError} — ${peopleError}`} /></C.ControlSurfaceState></C.ControlSurfaceDocument>
        ) : people === null ? (
          <C.ControlSurfaceDocument><C.ControlSurfaceState><C.LoadingState variant="list" /></C.ControlSurfaceState></C.ControlSurfaceDocument>
        ) : <PeopleAccess draft={draft} response={people} onIdentityDetail={updateIdentityDetail} />
      ) : (
        <C.SettingsDocument>
          <C.PluginConfigEditor
            name="msteams"
            detail={globalSettingsDetail(detail)}
            draft={draft}
            mode="all"
            showAppPackage={false}
            fieldLabel={fieldLabel}
            fieldHint={fieldHint}
            fieldOptions={fieldOptions}
            riskText={riskText}
          />
        </C.SettingsDocument>
      )}
    </C.WorkspaceShell>
  );
}

export function TeamsWorkspace() {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('msteams');
  const detail = hooks.usePluginDetail('msteams');
  const hero = useMemo(() => ({ eyebrow: s.workspaceEyebrow, title: s.title, description: s.workspaceIntro }), [s]);
  if (detail.isError) {
    return <C.WorkspaceShell variant="register" hero={hero}><C.ControlSurfaceDocument><C.ControlSurfaceState tone="danger"><C.ErrorState message={s.settingsLoadError} onRetry={() => detail.refetch()} /></C.ControlSurfaceState></C.ControlSurfaceDocument></C.WorkspaceShell>;
  }
  if (detail.isLoading || detail.data === undefined) {
    return <C.WorkspaceShell variant="register" hero={hero}><C.ControlSurfaceDocument><C.ControlSurfaceState><C.LoadingState variant="cards" /></C.ControlSurfaceState></C.ControlSurfaceDocument></C.WorkspaceShell>;
  }
  return <LoadedWorkspace detail={detail.data} />;
}
