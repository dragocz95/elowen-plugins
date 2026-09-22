import { useState, type ChangeEvent } from 'react';
import { Bot } from 'lucide-react';
import { runtime, apiJson, chatbotApi, jsonRequest } from './runtime';
import type { ChatbotAccountOptionView, ChatbotBotView, ChatbotProjectView } from './types';

/** Creating a chatbot spans four owners: core creates the ACCOUNT, core records the Project assignment,
 *  core holds the account's grants, and this plugin registers its own row. Nothing coordinates them, so the
 *  dialog runs the four calls in order and, when one fails, keeps the account id it already created and
 *  says which step to retry — an account that exists with no chatbot row is a state an administrator can
 *  finish, and it must not be hidden behind a generic failure or "solved" by deleting an account over an
 *  unclear network error. */

type Step = 'account' | 'project' | 'grants' | 'register';

interface Failure {
  step: Step;
  detail: string;
  chatbotUserId: number | null;
}

/** Which step the next attempt resumes from: the failed one, with everything before it already done. */
const NEXT_STEP: Record<Step, Step> = { account: 'account', project: 'project', grants: 'grants', register: 'register' };

/** The account row as core's own list answers it, narrowed to the two grants this dialog adds to. */
interface AccountRow {
  id: number;
  granted_plugins?: string[];
  allowed_tools?: string[];
}

export function CreateBotDialog({ plugin, requiredTools, projects, candidates, onClose, onCreated }: {
  /** The name of THIS plugin. The host passes it to every plugin page, so the grant written below is the
   *  one for the plugin that is asking rather than a name restated in this bundle. */
  plugin: string;
  /** The core tools a chatbot account needs before its turns may act on a visitor's page, as the plugin's
   *  own admin route reports them. */
  requiredTools: string[];
  projects: ChatbotProjectView[];
  candidates: ChatbotAccountOptionView[];
  onClose(): void;
  onCreated(bot: ChatbotBotView): void;
}) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const [mode, setMode] = useState<'new' | 'existing'>(candidates.length > 0 ? 'existing' : 'new');
  const [username, setUsername] = useState('');
  const [accountId, setAccountId] = useState(candidates[0] === undefined ? '' : String(candidates[0].id));
  const [displayName, setDisplayName] = useState('');
  const [projectId, setProjectId] = useState(projects[0] === undefined ? '' : String(projects[0].id));
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const stepLabel: Record<Step, string> = { account: s.stepAccount, project: s.stepProject, grants: s.stepGrants, register: s.stepRegister };
  const ready = projectId !== '' && (mode === 'existing' ? accountId !== '' : username.trim() !== '');

  /** Add THIS plugin and the tools its turns need to whatever the account already has.
   *
   *  The account's current grants are read first and merged into, because the patch replaces each list
   *  wholesale: a chatbot created from an account that already reaches other plugins must not silently lose
   *  them. A grant for this plugin is what lets its tool reach the account at all, and the tool is what lets
   *  a turn touch a page — a chatbot without them answers visitors and can do nothing else. */
  const grant = async (chatbotUserId: number): Promise<void> => {
    const users = await apiJson<AccountRow[]>('/users');
    const account = users.find((candidate) => candidate.id === chatbotUserId);
    if (!account) throw new Error('account_unknown');
    const plugins = new Set(account.granted_plugins ?? []);
    plugins.add(plugin);
    const tools = new Set(account.allowed_tools ?? []);
    for (const tool of requiredTools) tools.add(tool);
    await apiJson(`/users/${chatbotUserId}`, jsonRequest('PATCH', {
      granted_plugins: [...plugins],
      allowed_tools: [...tools],
    }));
  };

  const submit = async () => {
    setPending(true);
    setFailure(null);
    let chatbotUserId = failure?.chatbotUserId ?? null;
    let step: Step = failure === null ? 'account' : NEXT_STEP[failure.step];

    if (mode === 'existing' && chatbotUserId === null) {
      chatbotUserId = Number(accountId);
      step = 'project';
    }

    if (step === 'account') {
      try {
        const created = await apiJson<{ id: number }>('/users', jsonRequest('POST', { username: username.trim(), type: 'chatbot' }));
        chatbotUserId = created.id;
        step = 'project';
      } catch (error) {
        setFailure({ step: 'account', detail: utils.apiErrorMessage(error), chatbotUserId: null });
        setPending(false);
        return;
      }
    }

    if (step === 'project') {
      try {
        await apiJson(`/users/${chatbotUserId}/projects`, jsonRequest('POST', { projectId: Number(projectId) }));
        step = 'grants';
      } catch (error) {
        setFailure({ step: 'project', detail: utils.apiErrorMessage(error), chatbotUserId });
        setPending(false);
        return;
      }
    }

    if (step === 'grants') {
      try {
        await grant(chatbotUserId!);
        step = 'register';
      } catch (error) {
        setFailure({ step: 'grants', detail: utils.apiErrorMessage(error), chatbotUserId });
        setPending(false);
        return;
      }
    }

    try {
      const answer = await apiJson<{ bot: ChatbotBotView }>(chatbotApi.bots(), jsonRequest('POST', {
        chatbotUserId,
        displayName: displayName.trim(),
      }));
      onCreated(answer.bot);
      onClose();
    } catch (error) {
      setFailure({ step: 'register', detail: utils.apiErrorMessage(error), chatbotUserId });
    } finally {
      setPending(false);
    }
  };

  const accountOptions = [{ value: '', label: s.createAccountLabel }, ...candidates.map((candidate) => ({
    value: String(candidate.id),
    label: `@${candidate.username}`,
  }))];
  const projectOptions = projects.length === 0
    ? [{ value: '', label: s.createProjectNone }]
    : projects.map((project) => ({ value: String(project.id), label: project.slug }));

  return (
    <C.Modal
      title={s.createTitle}
      icon={Bot}
      size="md"
      presentation="center"
      onClose={onClose}
      closeLabel={s.cancel}
      closeDisabled={pending}
      {...(pending ? { 'aria-busy': true as const } : {})}
    >
      <C.ModalBody>
        {/* Four short choices in two columns rather than a column of four: the dialog is one screenful on a
            phone and still one glance on a desktop, which is what every creation window in the app is. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <C.Field label={s.createModeLabel}>
            <C.SelectMenu
              value={mode}
              onChange={(value: string) => { setMode(value as 'new' | 'existing'); setFailure(null); }}
              options={[{ value: 'new', label: s.createModeNew }, { value: 'existing', label: s.createModeExisting }]}
              label={s.createModeLabel}
              disabled={pending || failure !== null}
            />
          </C.Field>

          {mode === 'new' ? (
            <C.Field label={s.createUsernameLabel} hint={s.createUsernameHint}>
              <C.Input value={username} onChange={(event: ChangeEvent<HTMLInputElement>) => setUsername(event.target.value)} disabled={pending || failure !== null} />
            </C.Field>
          ) : (
            <C.Field label={s.createAccountLabel} hint={s.createAccountHint}>
              <C.SelectMenu
                value={accountId}
                onChange={(value: string) => setAccountId(value)}
                options={accountOptions}
                label={s.createAccountLabel}
                disabled={pending || failure !== null}
              />
            </C.Field>
          )}

          <C.Field label={s.createDisplayNameLabel} hint={s.createDisplayNameHint}>
            <C.Input value={displayName} onChange={(event: ChangeEvent<HTMLInputElement>) => setDisplayName(event.target.value)} disabled={pending} />
          </C.Field>

          <C.Field label={s.createProjectLabel} hint={s.createProjectHint}>
            <C.SelectMenu
              value={projectId}
              onChange={(value: string) => setProjectId(value)}
              options={projectOptions}
              label={s.createProjectLabel}
              disabled={pending || projects.length === 0 || failure !== null}
            />
          </C.Field>

          {failure === null ? null : (
            <p className="text-xs text-destructive sm:col-span-2" role="alert">
              {failure.chatbotUserId === null
                ? `${s.createFailed} — ${failure.detail}`
                : `${s.createPartial.replace('{step}', stepLabel[failure.step])} — ${failure.detail}`}
            </p>
          )}
        </div>
      </C.ModalBody>
      <C.ModalFooter>
        <C.Button variant="ghost" onClick={onClose} disabled={pending}>{s.cancel}</C.Button>
        <C.Button variant="accent" disabled={pending || !ready} onClick={() => void submit()}>
          {pending ? s.createPending : failure === null ? s.createSubmit : s.retry}
        </C.Button>
      </C.ModalFooter>
    </C.Modal>
  );
}
