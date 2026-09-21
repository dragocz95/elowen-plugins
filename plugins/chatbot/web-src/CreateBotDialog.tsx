import { useState, type ChangeEvent } from 'react';
import { runtime, apiJson, jsonRequest, type ChatbotAccountOption, type ChatbotBotView, type ChatbotProjectOption } from './runtime';

/** Creating a chatbot spans three owners: core creates the ACCOUNT, core records the Project assignment, and
 *  this plugin registers its own row. Nothing coordinates them, so the dialog runs the three calls in order
 *  and, when one fails, keeps the account id it already created and says which step to retry — an account
 *  that exists with no chatbot row is a state an administrator can finish, and it must not be hidden behind
 *  a generic failure or "solved" by deleting an account over an unclear network error. */

type Step = 'account' | 'project' | 'register';

interface Failure {
  step: Step;
  detail: string;
  chatbotUserId: number | null;
}

// Which step the next attempt resumes from: the failed one, with everything before it already done.
const NEXT_STEP: Record<Step, Step> = { account: 'account', project: 'project', register: 'register' };

export function CreateBotDialog({ projects, candidates, onClose, onCreated }: {
  projects: ChatbotProjectOption[];
  candidates: ChatbotAccountOption[];
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

  const stepLabel: Record<Step, string> = { account: s.stepAccount, project: s.stepProject, register: s.stepRegister };
  const ready = projectId !== '' && (mode === 'existing' ? accountId !== '' : username.trim() !== '');

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
        step = 'register';
      } catch (error) {
        setFailure({ step: 'project', detail: utils.apiErrorMessage(error), chatbotUserId });
        setPending(false);
        return;
      }
    }

    try {
      const answer = await apiJson<{ bot: ChatbotBotView }>('/plugins/chatbot/api/bots', jsonRequest('POST', {
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
      onClose={onClose}
      closeLabel={s.cancel}
      closeDisabled={pending}
      {...(pending ? { 'aria-busy': true as const } : {})}
    >
      <C.ModalBody>
        <div className="flex flex-col gap-4">
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
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground" role="alert">
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
