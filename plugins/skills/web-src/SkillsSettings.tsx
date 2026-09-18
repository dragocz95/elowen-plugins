import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Hand, Package, Plus, Puzzle, ShieldCheck, User } from 'lucide-react';
import { runtime, type PluginSkill, type SkillAccount, type SkillFilterField, type SkillOwner } from './runtime';

type SkillExtra = { disableModelInvocation: boolean; owner: SkillOwner; editingOwner: SkillOwner; revision?: number };
type SkillForm = { editing: string | null; name: string; description: string; body: string } & SkillExtra;
const BLANK_FORM: SkillForm = { editing: null, name: '', description: '', body: '', disableModelInvocation: false, owner: null, editingOwner: null };

/** The `?owner=` / body value naming a set: an account id, the shared set, or the caller's own. */
const ownerParam = (owner: SkillOwner): string => (owner === 'instance' ? 'instance' : owner === null ? 'me' : String(owner));

export function SkillsSettings({ surface }: { surface: 'page' | 'deck' }) {
  const { components: C, hooks, utils, api } = runtime();
  const s = hooks.usePluginStrings('skills');
  const { t } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const me = hooks.useMe();
  const myId = me.data?.user?.id ?? null;
  const isAdmin = me.data?.user?.is_admin === true;
  const create = hooks.useCreatePluginSkill();
  const update = hooks.useUpdatePluginSkill();
  const remove = hooks.useDeletePluginSkill();
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [skills, setSkills] = useState<PluginSkill[]>();
  const [accounts, setAccounts] = useState<SkillAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [availabilityKey, setAvailabilityKey] = useState<string | null>(null);
  const submitRef = useRef(false);
  const skillRequestRef = useRef(0);
  const selectedAccountRef = useRef<number | null>(null);

  useEffect(() => {
    if (myId !== null && selectedAccount === null) {
      selectedAccountRef.current = myId;
      setSelectedAccount(myId);
    }
  }, [myId, selectedAccount]);

  const loadAccounts = useCallback(async () => {
    if (!isAdmin) return;
    try { setAccounts(await api('/plugins/skills/accounts') as SkillAccount[]); }
    catch (error) { toast(utils.apiErrorMessage(error), 'error'); }
  }, [api, isAdmin, toast, utils]);

  const loadSkills = useCallback(async (account = selectedAccountRef.current) => {
    if (account === null || selectedAccountRef.current !== account) return;
    const requestId = ++skillRequestRef.current;
    try {
      setLoadError(false);
      const suffix = isAdmin ? `?account=${encodeURIComponent(String(account))}` : '';
      const rows = await api(`/plugins/skills/list${suffix}`) as PluginSkill[];
      if (requestId !== skillRequestRef.current || selectedAccountRef.current !== account) return;
      setSkills(rows);
    } catch (error) {
      if (requestId !== skillRequestRef.current || selectedAccountRef.current !== account) return;
      setLoadError(true);
      toast(utils.apiErrorMessage(error), 'error');
    }
  }, [api, isAdmin, toast, utils]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  useEffect(() => {
    if (selectedAccount === null) return;
    selectedAccountRef.current = selectedAccount;
    skillRequestRef.current += 1;
    setSkills(undefined);
    void loadSkills(selectedAccount);
  }, [loadSkills, selectedAccount]);

  const query = useMemo(() => ({
    data: skills,
    isLoading: skills === undefined && !loadError,
    isError: loadError,
    refetch: () => { void loadSkills(); },
  }), [loadError, loadSkills, skills]);

  const targetOwner = (skill: PluginSkill): SkillOwner => (skill.owner === null ? 'instance' : skill.owner);
  const selectedPersonalOwner: SkillOwner = selectedAccount === myId ? null : selectedAccount;

  const toggleInvocation = (skill: PluginSkill, enabled: boolean) => {
    const account = selectedAccountRef.current;
    const before = skills;
    setSkills((current) => current?.map((item) => item === skill ? { ...item, disableModelInvocation: !enabled } : item));
    update.mutate(
      { name: skill.name, owner: targetOwner(skill), patch: { disableModelInvocation: !enabled } },
      {
        onSuccess: () => { void loadSkills(account); },
        onError: (error) => {
          if (selectedAccountRef.current === account) setSkills(before);
          toast(utils.apiErrorMessage(error), 'error');
        },
      },
    );
  };

  const togglePluginAvailability = async (skill: PluginSkill, enabled: boolean) => {
    const account = selectedAccountRef.current;
    if (!isAdmin || account === null || !skill.pluginKey) return;
    const before = skills;
    const pendingKey = `${account}:${skill.pluginKey}`;
    setAvailabilityKey(pendingKey);
    setSkills((current) => current?.map((item) => item.pluginKey === skill.pluginKey
      ? enabled ? { ...item, enabledForAccount: true } : {
        ...item, enabledForAccount: false, effective: false, unavailableReason: 'disabled-for-account',
      }
      : item));
    try {
      await api('/plugins/skills/plugin-availability', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: account, key: skill.pluginKey, enabled }),
      });
      await loadSkills(account);
    } catch (error) {
      if (selectedAccountRef.current === account) {
        setSkills(before);
        await loadSkills(account);
      }
      toast(utils.apiErrorMessage(error), 'error');
    } finally {
      setAvailabilityKey((current) => current === pendingKey ? null : current);
    }
  };

  const accountName = (id: number | null): string => {
    if (id === null) return s.ownerInstance;
    if (id === myId) return s.ownerMine;
    const account = accounts.find((candidate) => candidate.id === id);
    return account?.name || account?.username || `#${id}`;
  };

  const ownerLabel = (skill: PluginSkill): string => {
    // A contributed skill is OWNED by the plugin that ships it, so the owner column — which has the width
    // for a name — is where that name belongs. Beside the source badge it shared a 16rem cell and clipped,
    // which is how a row ended in a bare ellipsis instead of saying who owns the skill.
    if (skill.catalogSource === 'plugin') return skill.contributorPlugin || s.scopePlugin;
    if (skill.catalogSource === 'bundled') return s.scopeBundled;
    if (skill.catalogSource === 'instance') return s.ownerInstance;
    return accountName(skill.owner);
  };

  const editedSkill = (form: SkillForm): PluginSkill | undefined =>
    (form.editing === null ? undefined : skills?.find((skill) =>
      skill.name === form.editing && targetOwner(skill) === form.editingOwner));
  const scopeSwitchable = (form: SkillForm): boolean => {
    if (form.editing === null) return true;
    const skill = editedSkill(form);
    return skill !== undefined && skill.catalogSource !== 'plugin' && (skill.owner === null || skill.owner === selectedAccount);
  };

  const userCount = skills?.filter((skill) => skill.catalogSource === 'personal' || skill.catalogSource === 'instance').length ?? 0;
  const pluginCount = skills?.filter((skill) => skill.catalogSource === 'plugin').length ?? 0;
  const manualCount = skills?.filter((skill) => skill.disableModelInvocation).length ?? 0;
  const effectiveCount = skills?.filter((skill) => skill.effective).length ?? 0;
  const emptyForm = useMemo<SkillForm>(() => ({ ...BLANK_FORM, owner: selectedPersonalOwner }), [selectedPersonalOwner]);

  const addButton = <C.Button variant="accent" icon={Plus} onClick={() => setCreating(true)}>{s.add}</C.Button>;

  // Switching whose catalogue is on screen is one operation however it was reached — from the control in
  // the filter panel or from the chip that dismisses it. The entry being written belongs to the account
  // you are leaving, so it closes first; then the two race guards: bumping the request counter voids a
  // list response still in flight for the account being left, and clearing the list keeps a late
  // response from painting over the account just chosen.
  const chooseAccount = (account: number) => {
    setCreating(false);
    selectedAccountRef.current = account;
    skillRequestRef.current += 1;
    setSkills(undefined);
    setSelectedAccount(account);
  };

  // Whose catalogue is being read narrows EVERY row on the page, so the account choice is a filter: it
  // rides in the page's one filter control beside the scope filter, in the same field shell, and reports
  // itself as a chip like any other filter does. Your own account is the neutral state, so the chip only
  // appears while you are reading somebody else's list and taking it off puts you back on your own.
  const accountFieldBase = isAdmin && selectedAccount !== null ? {
    id: 'skill-account',
    label: s.accountLabel,
    hint: s.accountHint,
    control: (
      <C.SelectMenu
        value={String(selectedAccount)}
        onChange={(value: string) => chooseAccount(Number(value))}
        options={(accounts.length ? accounts : [{ id: selectedAccount, username: accountName(selectedAccount) }]).map((account) => ({
          value: String(account.id), label: account.name || account.username, icon: <User size={14} />,
        }))}
        label={s.accountLabel}
      />
    ),
  } : null;
  // A non-admin has exactly one account to look at, so they contribute no field at all: no row in the
  // panel, no chip, and a filter surface identical to the one they had before this control existed.
  const accountFilter: SkillFilterField | undefined = accountFieldBase === null ? undefined
    : myId !== null && selectedAccount !== myId
      ? {
        ...accountFieldBase,
        active: true,
        activeLabel: `${s.accountLabel}: ${accountName(selectedAccount)}`,
        onReset: () => chooseAccount(myId),
      }
      : { ...accountFieldBase, active: false };

  const surfaceDocument = (
    <C.ControlSurfaceDocument>
      <C.MarkdownAssetEditor
        query={query}
        creating={creating}
        onCreatingChange={setCreating}
        addAction={surface === 'deck' ? addButton : undefined}
        labels={{
          empty: s.empty,
          badgeUser: s.badgeUser,
          badgeBuiltin: s.badgeProvided,
          addTitle: s.add,
          edit: s.edit,
          remove: s.remove,
          save: s.save,
          cancel: s.cancel,
          name: s.name,
          nameHint: s.helpName,
          namePlaceholder: 'deploy-checklist',
          description: s.description,
          descriptionHint: s.helpDescription,
          body: s.content,
          bodyHint: s.helpContent,
          created: s.created,
          updated: s.updated,
          deleted: s.deleted,
          deleteTitle: s.deleteTitle,
          deleteDesc: s.deleteDesc,
        }}
        emptyForm={emptyForm}
        formFromItem={(skill: PluginSkill): SkillForm => ({
          editing: skill.name,
          name: skill.name,
          description: skill.description,
          body: skill.content ?? '',
          disableModelInvocation: skill.disableModelInvocation,
          owner: targetOwner(skill),
          editingOwner: targetOwner(skill),
          revision: skill.revision ?? skill.version ?? 0,
        })}
        ownership={{
          header: s.ownerColumn,
          label: ownerLabel,
          scopes: [
            { value: 'personal', label: s.scopeMine, icon: User, matches: (skill: PluginSkill) => skill.catalogSource === 'personal' && skill.owner === selectedAccount },
            { value: 'instance', label: s.scopeInstance, icon: Boxes, matches: (skill: PluginSkill) => skill.catalogSource === 'instance' },
            // `Package` is the bundled catalogue and `Puzzle` the plugin-contributed one: the two were
            // both reading as a package, which is the collision the register's glyphs exist to avoid.
            { value: 'bundled', label: s.scopeBundled, icon: Package, matches: (skill: PluginSkill) => skill.catalogSource === 'bundled' },
            { value: 'plugin', label: s.scopePlugin, icon: Puzzle, matches: (skill: PluginSkill) => skill.catalogSource === 'plugin' },
          ],
        }}
        extraFilters={accountFilter ? [accountFilter] : undefined}
        // A register row marks what is WRONG and nothing else. The row's switch states whether the model
        // may invoke the skill, the owner column names the account or the plugin it belongs to, and the
        // scope filter names its catalogue — so "effective", "manual only", "bundled" and the contributor's
        // name were four marks restating what the row already said, and together they overran the source
        // cell, which then clipped into a bare ellipsis. What is left is the reason a skill cannot be used,
        // which nothing else on the row can tell.
        renderBadges={(skill: PluginSkill) => (
          <>
            {skill.unavailableReason === 'disabled-for-account' ? <C.Badge tone="warning">{s.statusDisabled}</C.Badge> : null}
            {skill.unavailableReason === 'plugin-unavailable' ? <C.Badge tone="warning">{s.statusUnavailable}</C.Badge> : null}
            {skill.unavailableReason === 'shadowed' ? <C.Badge tone="warning">{s.statusShadowed}</C.Badge> : null}
          </>
        )}
        renderRowControl={(skill: PluginSkill) => skill.catalogSource === 'plugin' ? (isAdmin ? (
          <C.Toggle
            checked={skill.enabledForAccount}
            onChange={(enabled: boolean) => { void togglePluginAvailability(skill, enabled); }}
            label={`${s.pluginAvailability}: ${skill.name}`}
            disabled={availabilityKey === `${selectedAccount}:${skill.pluginKey}`}
          />
        ) : null) : (
          <C.Toggle
            checked={!skill.disableModelInvocation}
            onChange={(enabled: boolean) => toggleInvocation(skill, enabled)}
            label={`${s.disableModelInvocation}: ${skill.name}`}
            disabled={!skill.canDelete || (update.isPending && update.variables?.name === skill.name && update.variables?.owner === targetOwner(skill))}
          />
        )}
        renderFieldsAfterBody={(form: SkillForm, patch: (value: Partial<SkillForm>) => void) => (
          <>
            {isAdmin && scopeSwitchable(form) ? (
              <C.Field label={s.scopeFieldLabel} hint={form.editing === null ? s.scopeFieldHint : s.scopeMoveHint}>
                <C.Segmented
                  value={form.owner === 'instance' ? 'instance' : 'personal'}
                  onChange={(value: string) => patch({ owner: value === 'instance' ? 'instance' : selectedPersonalOwner })}
                  options={[
                    { value: 'personal', label: s.scopeFieldPersonal },
                    { value: 'instance', label: s.scopeFieldInstance },
                  ]}
                  aria-label={s.scopeFieldLabel}
                  nowrap
                />
              </C.Field>
            ) : null}
            <label className="flex items-center gap-2">
              <C.Toggle
                checked={!form.disableModelInvocation}
                onChange={(enabled: boolean) => patch({ disableModelInvocation: !enabled })}
                label={s.disableModelInvocation}
              />
              <span className="flex flex-col">
                <span className="text-sm text-foreground">{s.disableModelInvocation}</span>
                <span className="text-xs text-muted-foreground">{s.disableModelInvocationHint}</span>
              </span>
            </label>
          </>
        )}
        onSave={(form: SkillForm, callbacks: { onSuccess: () => void; onError: (error: unknown) => void }) => {
          if (submitRef.current) return;
          submitRef.current = true;
          setSubmitting(true);
          const guarded = {
            onSuccess: () => { submitRef.current = false; setSubmitting(false); void loadSkills(); callbacks.onSuccess(); },
            onError: (error: unknown) => { submitRef.current = false; setSubmitting(false); void loadSkills(); callbacks.onError(error); },
          };
          if (form.editing !== null) {
            const name = form.editing;
            const from = form.editingOwner;
            const patch = { description: form.description.trim(), content: form.body, disableModelInvocation: form.disableModelInvocation };
            const revision = form.revision ?? 0;
            void (async () => {
              const path = form.owner !== from
                ? `/plugins/skills/${encodeURIComponent(name)}/owner?owner=${encodeURIComponent(ownerParam(from))}`
                : `/plugins/skills/${encodeURIComponent(name)}?owner=${encodeURIComponent(ownerParam(from))}`;
              const body = form.owner !== from
                ? { owner: ownerParam(form.owner), expectedRevision: revision, patch }
                : { ...patch, expectedRevision: revision };
              try {
                await api(path, { method: form.owner !== from ? 'POST' : 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
                guarded.onSuccess();
              } catch (error) { guarded.onError(error); }
            })();
          } else {
            create.mutate(
              { name: form.name.trim(), description: form.description.trim(), content: form.body, disableModelInvocation: form.disableModelInvocation, owner: form.owner },
              guarded,
            );
          }
        }}
        saving={submitting || create.isPending || update.isPending}
        onDelete={(skill: PluginSkill, callbacks: { onSuccess: () => void; onError: (error: unknown) => void }) =>
          remove.mutate({ name: skill.name, owner: targetOwner(skill) }, {
            onSuccess: () => { void loadSkills(); callbacks.onSuccess(); },
            onError: callbacks.onError,
          })}
      />
    </C.ControlSurfaceDocument>
  );

  if (surface === 'deck') return surfaceDocument;
  return (
    <C.WorkspaceShell
      variant="register"
      hero={{
        eyebrow: s.workspaceEyebrow,
        title: s.title,
        count: skills?.length ?? 0,
        description: s.sectionHint,
        mascot: query.isLoading ? 'saving' : query.isError ? 'error' : 'idle',
        status: !query.isLoading && !query.isError ? <span className="workspace-status">{s.workspaceReady}</span> : undefined,
        action: addButton,
        metrics: <>
          <C.WorkspaceMetric label={s.statusEffective} value={effectiveCount} icon={ShieldCheck} />
          <C.WorkspaceMetric label={t.assetEditor.filterUser} value={userCount} icon={User} />
          <C.WorkspaceMetric label={s.scopePlugin} value={pluginCount} icon={Puzzle} />
          <C.WorkspaceMetric label={s.manualOnlyBadge} value={manualCount} icon={Hand} />
        </>,
      }}
    >
      {surfaceDocument}
    </C.WorkspaceShell>
  );
}
