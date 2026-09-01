import { useRef, useState } from 'react';
import { Hand, Package, Plus, User } from 'lucide-react';
import { runtime, type PluginSkill, type SkillOwner } from './runtime';

type SkillExtra = { disableModelInvocation: boolean; owner: SkillOwner; editingOwner: SkillOwner };
type SkillForm = { editing: string | null; name: string; description: string; body: string } & SkillExtra;
// `owner: null` on a NEW skill means "mine" — the daemon resolves an absent owner to the caller's own
// set. Only an admin can switch the form to the instance set. `editingOwner` remains the original
// identity while the draft owner is changed, so a move still addresses the correct source row.
const EMPTY_FORM: SkillForm = { editing: null, name: '', description: '', body: '', disableModelInvocation: false, owner: null, editingOwner: null };

/** Skills manager (the skills plugin's own page): bundled skills ship read-only with the install; user
 *  skills are one .md file each and can be created, edited and deleted here. Changes hot-reload the
 *  plugins, so NEW brain conversations pick them up immediately. The `disable-model-invocation` toggle
 *  hides a skill from progressive disclosure while keeping it reachable via /skill:name. */
/** The `?owner=` / body value naming a set: an account id, the shared set, or the caller's own. */
const ownerParam = (owner: SkillOwner): string => (owner === 'instance' ? 'instance' : owner === null ? 'me' : String(owner));

export function SkillsSettings({ surface }: { surface: 'page' | 'deck' }) {
  const { components: C, hooks, utils, api } = runtime();
  const s = hooks.usePluginStrings('skills');
  const { t } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const query = hooks.usePluginSkills();
  const me = hooks.useMe();
  const myId = me.data?.user?.id ?? null;
  const isAdmin = me.data?.user?.is_admin === true;
  const create = hooks.useCreatePluginSkill();
  const update = hooks.useUpdatePluginSkill();
  const remove = hooks.useDeletePluginSkill();
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** The shared editor disables Save after React renders. This lock also rejects a second click in the
   * same event turn, and remains held across the move-then-PATCH sequence. */
  const submitRef = useRef(false);

  // Quick per-row switch: flip the flag without opening the full editor.
  // Which set a write addresses. A skill of MINE is written without an owner (the daemon resolves it to
  // the caller), an instance-wide one explicitly, and — for an admin cleaning up — someone else's by id.
  const targetOwner = (skill: PluginSkill): SkillOwner => (skill.owner === null ? 'instance' : skill.owner);

  const toggleInvocation = (skill: PluginSkill, enabled: boolean) => {
    update.mutate(
      { name: skill.name, owner: targetOwner(skill), patch: { disableModelInvocation: !enabled } },
      { onError: (e) => toast(utils.apiErrorMessage(e), 'error') },
    );
  };

  /** Move a skill to another set. Separate from the PATCH that saves an edit, because on the daemon it
   *  is a filesystem move that can be refused on its own (a name already taken in the destination). */
  const moveSkill = (name: string, from: SkillOwner, to: SkillOwner) => api(
    `/plugins/skills/${encodeURIComponent(name)}/owner?owner=${encodeURIComponent(ownerParam(from))}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: ownerParam(to) }) },
  );

  const ownerLabel = (skill: PluginSkill): string => {
    if (skill.owner === null) return s.ownerInstance;
    return skill.owner === myId ? s.ownerMine : `#${skill.owner}`;
  };

  const skills: PluginSkill[] = query.data ?? [];
  const editedSkill = (form: SkillForm): PluginSkill | undefined =>
    (form.editing === null ? undefined : skills.find((skill) =>
      skill.name === form.editing && targetOwner(skill) === form.editingOwner));
  /** A new skill, an instance-wide one, or the admin's own — see the switch's comment for why somebody
   *  else's personal skill is excluded. Fail CLOSED on an editing form whose skill is not in the list: a
   *  refetch error or an in-flight invalidation empties it, and "unknown owner" must not read as
   *  "switchable" — the form would show a foreign skill as "Only me" with that option already selected. */
  const scopeSwitchable = (form: SkillForm): boolean => {
    if (form.editing === null) return true;
    const skill = editedSkill(form);
    return skill !== undefined && (skill.owner === null || skill.owner === myId);
  };
  const userCount = skills.filter((skill) => skill.source === 'user').length;
  const manualCount = skills.filter((skill) => skill.disableModelInvocation).length;

  const addButton = <C.Button variant="accent" icon={Plus} onClick={() => setCreating(true)}>{s.add}</C.Button>;

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
          badgeBuiltin: s.badgeBundled,
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
        emptyForm={EMPTY_FORM}
        formFromItem={(skill: PluginSkill): SkillForm => ({
          editing: skill.name,
          name: skill.name,
          description: skill.description,
          body: skill.content ?? '',
          disableModelInvocation: skill.disableModelInvocation,
          owner: targetOwner(skill),
          editingOwner: targetOwner(skill),
        })}
        ownership={{
          header: s.ownerColumn,
          label: ownerLabel,
          scopes: [
            { value: 'mine', label: s.scopeMine, matches: (skill: PluginSkill) => skill.owner !== null && skill.owner === myId },
            { value: 'instance', label: s.scopeInstance, matches: (skill: PluginSkill) => skill.owner === null && skill.source === 'user' },
            { value: 'bundled', label: s.scopeBundled, matches: (skill: PluginSkill) => skill.source === 'bundled' },
          ],
        }}
        renderBadges={(skill: PluginSkill) => (
          <>
            {skill.version != null ? <C.Badge tone="default">v{skill.version}</C.Badge> : null}
            {skill.disableModelInvocation ? <C.Badge tone="default">{s.manualOnlyBadge}</C.Badge> : null}
          </>
        )}
        renderRowControl={(skill: PluginSkill) => (
          <C.Toggle
            checked={!skill.disableModelInvocation}
            onChange={(enabled: boolean) => toggleInvocation(skill, enabled)}
            label={s.disableModelInvocation}
            disabled={update.isPending && update.variables?.name === skill.name && update.variables?.owner === targetOwner(skill)}
          />
        )}
        renderFieldsAfterBody={(form: SkillForm, patch: (p: Partial<SkillForm>) => void) => (
          <>
            {/* Only an admin may write the shared set. On an EXISTING skill this switch moves the file, so
                it is offered only for a skill that is instance-wide or the admin's own: for somebody
                else's personal skill "Only me" would read as a label and act as a transfer to the admin. */}
            {isAdmin && scopeSwitchable(form) ? (
              <C.Field label={s.scopeFieldLabel} hint={form.editing === null ? s.scopeFieldHint : s.scopeMoveHint}>
                <C.Segmented
                  value={form.owner === 'instance' ? 'instance' : 'personal'}
                  onChange={(value: string) => patch({ owner: value === 'instance' ? 'instance' : null })}
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
        onSave={(form: SkillForm, callbacks: { onSuccess: () => void; onError: (e: unknown) => void }) => {
          if (submitRef.current) return;
          submitRef.current = true;
          setSubmitting(true);
          const guarded = {
            onSuccess: () => { submitRef.current = false; setSubmitting(false); callbacks.onSuccess(); },
            onError: (e: unknown) => { submitRef.current = false; setSubmitting(false); callbacks.onError(e); },
          };
          if (form.editing !== null) {
            const name = form.editing;
            // The source identity belongs to the draft, not to a refetch that may have removed or moved
            // the row while the editor remained open. Addressing the desired owner here could edit a
            // different same-named skill after a stale refresh.
            const from = form.editingOwner;
            const saveEdit = (owner: SkillOwner) => update.mutate(
              { name, owner, patch: { description: form.description.trim(), content: form.body, disableModelInvocation: form.disableModelInvocation } },
              guarded,
            );
            // Move BEFORE saving the edit: the move is the step that can be refused (a name already taken
            // in the destination), and a refusal must leave the skill exactly as it was rather than
            // half-applied. Once it lands, the edit has to address the skill in its NEW set.
            if (form.owner !== from) {
              void moveSkill(name, from, form.owner).then(
                () => update.mutate(
                  { name, owner: form.owner, patch: { description: form.description.trim(), content: form.body, disableModelInvocation: form.disableModelInvocation } },
                  {
                    onSuccess: guarded.onSuccess,
                    // The move ALREADY landed, so a refused edit (an empty description, say) leaves the
                    // skill in its new set with its old body. Refetch before reporting the error, or the
                    // register goes on naming an owner the skill no longer has.
                    onError: (e: unknown) => { query.refetch(); guarded.onError(e); },
                  },
                ),
                guarded.onError,
              );
            } else saveEdit(from);
          } else {
            create.mutate(
              { name: form.name.trim(), description: form.description.trim(), content: form.body, disableModelInvocation: form.disableModelInvocation, owner: form.owner },
              guarded,
            );
          }
        }}
        saving={submitting || create.isPending || update.isPending}
        onDelete={(skill: PluginSkill, callbacks: { onSuccess: () => void; onError: (e: unknown) => void }) => remove.mutate({ name: skill.name, owner: targetOwner(skill) }, callbacks)}
      />
    </C.ControlSurfaceDocument>
  );

  // In the Settings deck the surrounding panel supplies the page frame; on its own page the section
  // draws the whole frame itself, which is why the bundle declares `skills` in `ownsPageFrame`.
  if (surface === 'deck') return surfaceDocument;
  return (
    <C.WorkspaceShell
      variant="register"
      hero={{
        eyebrow: s.workspaceEyebrow,
        title: s.title,
        count: skills.length,
        description: s.sectionHint,
        mascot: query.isLoading ? 'saving' : query.isError ? 'error' : 'idle',
        status: !query.isLoading && !query.isError ? <span className="workspace-status">{s.workspaceReady}</span> : undefined,
        action: addButton,
        metrics: <>
          <C.WorkspaceMetric label={t.assetEditor.filterUser} value={userCount} icon={User} />
          <C.WorkspaceMetric label={t.assetEditor.filterBuiltin} value={skills.length - userCount} icon={Package} />
          <C.WorkspaceMetric label={s.manualOnlyBadge} value={manualCount} icon={Hand} />
        </>,
      }}
    >
      {surfaceDocument}
    </C.WorkspaceShell>
  );
}
