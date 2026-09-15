import { useRef, useState } from 'react';
import { ActiveHoursField, ConversationField, ScheduleField } from './fields';
import { runtime, apiErrorCode, type CronJob, type CronJobCreateBody, type NotificationDestinationOption, type BrainModelOption } from './runtime';

/** ONE explicit creation request — never an autosaved incomplete row. Both lifecycles: a one-shot
 *  (local date + time, resolved by the server) and a recurring job (schedule + required filing). The
 *  `requestId` is generated once per attempt and RETAINED, so a retried submit replays the same job
 *  instead of creating a duplicate one. */
export function CreateJobDialog({ lifecycle, myId, isAdmin, onClose, onCreated }: {
  lifecycle: 'oneShot' | 'recurring';
  myId: number | null;
  isAdmin: boolean;
  onClose: () => void;
  onCreated: (job: CronJob) => void;
}) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { toast } = hooks.useToast();
  const destinations = hooks.useNotificationDestinations();
  const models = hooks.useBrainModels();
  /** Generated once per submit attempt. An HTTP retry of the same submit must replay the job the
   *  server already stored, never create a second — even a one-shot that already deleted itself. */
  const requestIdRef = useRef(crypto.randomUUID());
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [schedule, setSchedule] = useState('every 1h');
  const [localRun, setLocalRun] = useState({ date: '', time: '' });
  const [conversationSessionId, setConversationSessionId] = useState('');
  const [hours, setHours] = useState<string | undefined>(undefined);
  const [enabled, setEnabled] = useState(true);
  const [scope, setScope] = useState<'instance' | 'mine'>(isAdmin ? 'instance' : 'mine');
  const [projectRef, setProjectRef] = useState<CronJob['projectRef']>(undefined);
  const [model, setModel] = useState<CronJob['model']>(undefined);
  const [notifyChannelId, setNotifyChannelId] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [check, setCheck] = useState<string | undefined>(undefined);
  const [plain, setPlain] = useState<boolean | undefined>(undefined);
  const [useProjectPicker, setUseProjectPicker] = useState(false);

  const oneShot = lifecycle === 'oneShot';
  const filedReady = !oneShot && conversationSessionId.trim() !== '';
  const ready = name.trim() !== '' && prompt.trim() !== '' && (oneShot ? localRun.date !== '' && localRun.time !== '' && /^([01]\d|2[0-3]):[0-5]\d$/.test(localRun.time) : filedReady) && (schedule.trim() !== '');

  const submit = async () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    try {
      const body: CronJobCreateBody = {
        requestId: requestIdRef.current,
        lifecycle: oneShot ? 'oneShot' : 'recurring',
        // Personal scope is ALWAYS the caller on HTTP; an admin has to say instance explicitly.
        scope: scope === 'instance' && isAdmin ? 'instance' : 'personal',
        name: name.trim(),
        prompt,
        ...(oneShot ? { localRunAt: { date: localRun.date, time: localRun.time } } : { schedule, conversationSessionId }),
        ...(enabled ? {} : { enabled: false }),
        ...(oneShot ? {} : { hours, check, plain: plain === true ? true : undefined }),
        ...(projectRef ? { projectRef } : {}),
        ...(model ? { model } : {}),
        ...(notifyChannelId ? { notifyChannelId } : {}),
      };
      // Never fetch created payload through hooks.useCronJobs — the creation receipt replies with the job
      const response = await runtime().api('/plugins/cronjob/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }) as { ok?: boolean; job?: CronJob; idempotentReplay?: boolean };
      if (!response || !response.job) throw new Error(s.saveErrorResponse);
      toast(response.idempotentReplay ? s.createReplayed : s.createDone, 'ok');
      if (response.job) onCreated(response.job);
    } catch (error) {
      if (apiErrorCode(error) === 'idempotency_conflict') {
        toast(s.createPayloadMismatch, 'error');
        requestIdRef.current = crypto.randomUUID(); // the retry becomes a genuinely new attempt
      } else {
        toast(`${s.createError} — ${utils.apiErrorMessage(error)}`, 'error');
      }
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  };

  return (
    <C.Modal
      open
      onClose={submitting ? undefined : onClose}
      title={oneShot ? s.createOneShotTitle : s.createRecurringTitle}
      closeLabel={s.close}
      onOpenChange={(open: boolean) => { if (!open && !submitting) onClose(); }}
    >
      <C.ModalBody>
        <div className="flex min-w-0 flex-col gap-3" data-testid="cron-create-form">
          <C.Field label={s.name}>
            <C.Input value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder={oneShot ? 'verify-deploy' : 'morning-digest'} />
          </C.Field>
          {oneShot ? (
            <>
              {/* The browser never converts the instant: local calendar date plus wall-clock time are
                  carried to the daemon, which resolves them in its own scheduler timezone. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <C.Field label={s.date}>
                  <C.Input type="date" value={localRun.date} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalRun((cur) => ({ ...cur, date: e.target.value }))} aria-label={s.date} />
                </C.Field>
                <C.Field label={s.time}>
                  <C.Input type="time" step={60} value={localRun.time} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalRun((cur) => ({ ...cur, time: e.target.value }))} aria-label={s.time} />
                </C.Field>
              </div>
              <p className="text-xs text-muted-foreground">{s.hoursTimeZone}</p>
            </>
          ) : (
            <ScheduleField schedule={schedule} onChange={setSchedule} />
          )}
          <C.Field label={s.prompt} hint={s.helpCreatePrompt}>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-ring" />
          </C.Field>
          {isAdmin ? (
            <C.Field label={s.ownerColumn} hint={s.ownerFieldHint}>
              <C.Segmented
                value={scope}
                onChange={(value: string) => setScope(value as 'instance' | 'mine')}
                options={[
                  { value: 'mine', label: s.ownerMine },
                  { value: 'instance', label: s.ownerInstance },
                ]}
                aria-label={s.ownerColumn}
              />
            </C.Field>
          ) : null}
          {oneShot ? (
            <details className="flex flex-col gap-3 rounded-md border border-border px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-foreground">{s.createAdvanced}</summary>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <C.Field label={s.hours} hint={s.helpHours}>
                  <ActiveHoursField value={hours} onChange={setHours} />
                </C.Field>
              </div>
              <C.Field label={s.model} hint={s.helpModel}>
                <C.BrainModelField
                  value={model ? `${model.provider}/${model.model}` : ''}
                  onChange={(v: string) => {
                    const slash = v.indexOf('/');
                    setModel(slash > 0 ? { provider: v.slice(0, slash), model: v.slice(slash + 1) } : undefined);
                  }}
                  models={models.data ?? []}
                  title={s.model}
                  subtitle={s.helpModel}
                  defaultLabel={s.modelDefault}
                  keyOf={(m: BrainModelOption) => `${m.provider}/${m.model}`}
                />
              </C.Field>
            </details>
          ) : (
            <>
              <C.Field label={s.conversation} hint={s.helpConversation}>
                <ConversationField
                  value={conversationSessionId}
                  saved={undefined}
                  unresolved={false}
                  owner={scope === 'instance' ? null : myId}
                  myId={myId}
                  required
                  mismatch={false}
                  onChange={setConversationSessionId}
                />
              </C.Field>
              <details className="flex flex-col gap-3 rounded-md border border-border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium text-foreground">{s.createAdvanced}</summary>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <C.Field label={s.hours} hint={s.helpHours}>
                    <ActiveHoursField value={hours} onChange={setHours} />
                  </C.Field>
                  <C.Field label={s.header} hint={s.helpHeader}>
                    <span className="flex h-9 items-center text-sm text-muted-foreground">
                      <C.Toggle checked={plain !== true} onChange={(v: boolean) => setPlain(v ? undefined : true)} label={`${s.header}: ${name ? name : s.jobNew}`} />
                    </span>
                  </C.Field>
                </div>
                <C.Field label={s.model} hint={s.helpModel}>
                  <C.BrainModelField
                    value={model ? `${model.provider}/${model.model}` : ''}
                    onChange={(v: string) => {
                      const slash = v.indexOf('/');
                      setModel(slash > 0 ? { provider: v.slice(0, slash), model: v.slice(slash + 1) } : undefined);
                    }}
                    models={models.data ?? []}
                    title={s.model}
                    subtitle={s.helpModel}
                    defaultLabel={s.modelDefault}
                    keyOf={(m: BrainModelOption) => `${m.provider}/${m.model}`}
                  />
                </C.Field>
              </details>
            </>
          )}
          <C.Field label={s.enabled}>
            <span className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
              <C.Toggle checked={enabled} onChange={setEnabled} label={`${s.createPaused}: ${enabled ? s.enabled : s.paused}`} />
              {enabled ? s.enabled : s.paused}
            </span>
          </C.Field>
        </div>
      </C.ModalBody>
      <C.ModalFooter>
        {/* Dismissal is disabled while a submit is in flight — the confirm must not escape a
            destructive or in-flight create. */}
        <C.Button variant="ghost" onClick={onClose} disabled={submitting}>{s.cancel}</C.Button>
        <C.Button
          variant="accent"
          disabled={!ready || submitting}
          onClick={() => void submit()}
        >
          {oneShot ? s.createOneShotSubmit : s.createRecurringSubmit}
        </C.Button>
        {!oneShot && !filedReady ? <p className="text-xs text-muted-foreground">{s.conversationRequired}</p> : null}
      </C.ModalFooter>
    </C.Modal>
  );
}
