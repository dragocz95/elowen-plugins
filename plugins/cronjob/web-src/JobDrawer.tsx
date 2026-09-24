import { useEffect, useMemo, useRef, useState } from 'react';
import { PauseCircle, Play, Trash2 } from 'lucide-react';
import {
  runtime, apiErrorCode, type BrainModelOption, type CronJob, type NotificationDestinationOption,
} from './runtime';
import { ActiveHoursField, ConversationField, DestinationField, ScheduleField } from './fields';

/** ONE drawer for one job: header with saved state, next occurrence, schedule editor, prompt, filing
 *  and the advanced disclosure — moved out of the old register row so the calendar page and the deck
 *  both open the same editor. Existing jobs keep the debounced autosave with revision CAS; creation
 *  never goes through here (it has its own explicit submit contract). */


/** The fields of a job a client OWNS, i.e. everything the daemon did not derive for display. `owner`,
 *  `conversation`, `conversationUnresolved`, `runLocation`, `lifecycle`, `nextOccurrence` and
 *  `manualQueued` are the daemon's projections; `expectedRevision` is re-stated per write. */
const writablePayload = (job: CronJob): CronJob => {
  const {
    owner: _owner, conversation: _conversation, conversationUnresolved: _unresolved,
    runLocation: _runLocation, lifecycle: _lifecycle, nextOccurrence: _nextOccurrence,
    manualQueued: _manualQueued, expectedRevision: _expectedRevision, ...payload
  } = job;
  return payload;
};

/** A Tier-1 localRunAt for storing into the wire contract — local calendar date plus wall-clock time,
 *  RESOLVED BY THE SERVER into the stored instant. */
const localRunOf = (job: CronJob): { date: string; time: string } => {
  if (typeof job.localRunAt === 'object') return { date: job.localRunAt.date, time: job.localRunAt.time };
  const serverLabel = job.nextOccurrence && job.nextOccurrence.disposition === 'onTime'
    ? { date: job.nextOccurrence.localDate, time: job.nextOccurrence.localTime }
    : null;
  return { date: serverLabel?.date ?? '', time: serverLabel?.time ?? '' };
};

export function JobDrawer({ job, myId, adminFields, destinations, models, onClose, onRemoved, onRefresh, onRunQueued }: {
  job: CronJob;
  /** The signed-in account, so "mine" narrows the owner switch to a real id. */
  myId: number | null;
  /** Whether this caller may set the fields only an INSTANCE job has: the shell guard, the destination
   *  channel and the owner transfer. */
  adminFields: boolean;
  destinations: NotificationDestinationOption[];
  models: BrainModelOption[];
  onClose: () => void;
  onRemoved: (id: string) => void;
  onRefresh: () => void;
  /** The server ACCEPTED a durable manual run (202, including an idempotent replay of one already
   *  queued). The page watches the queue closely until the tick claims it; nothing else does. */
  onRunQueued?: () => void;
}) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { t, locale } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const save = hooks.useSaveCronJob();
  const del = hooks.useDeleteCronJob();
  const projects = hooks.useQuery<{ id: number; slug: string; executionKind: 'host' | 'managed' }[]>({ queryKey: ['projects'], queryFn: () => runtime().api('/projects') });
  const [draft, setDraft] = useState<CronJob>(job);
  const [confirming, setConfirming] = useState(false);
  const [runPending, setRunPending] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  /** Only user edits advance this value. Scheduler stamps and API refreshes may replace the clean draft,
   *  but they must never look like another edit and send the same job back in an endless PUT/refetch loop. */
  const [editVersion, setEditVersion] = useState(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** Edits this editor has not persisted yet. Only a clean draft adopts a server change. */
  const dirty = useRef(false);
  /** The save currently on the wire, and whether this job ever reached the server at all. */
  const inFlight = useRef<Promise<unknown> | null>(null);
  const everSaved = useRef(true);

  const ownerOf = (j: CronJob): number | null => (adminFields ? j.ownerUserId ?? null : myId);

  const isSavable = (j: CronJob): boolean => j.name.trim() !== '' && j.prompt.trim() !== '';

  const autosave = hooks.useAutoSaveStatus([editVersion], async () => {
    if (draft.runAt && !draft.localRunAt) return;
    const sent = draftRef.current;
    const payload = writablePayload(sent);
    everSaved.current = true;
    const request = save.mutateAsync({ ...payload, expectedRevision: sent.revision ?? 0 });
    inFlight.current = request;
    try {
      await request;
      if (draftRef.current === sent) dirty.current = false;
    } catch (error) {
      toast(`${s.saveError} — ${utils.apiErrorMessage(error)}`, 'error');
      throw error;
    } finally {
      if (inFlight.current === request) inFlight.current = null;
    }
  }, { savable: isSavable(draft), delay: 900 });

  // Adopt the server's copy whenever it changes under a draft with nothing unsaved in it.
  const serverCopy = JSON.stringify(job);
  useEffect(() => {
    if (dirty.current) return;
    setDraft(job);
    // serverCopy is the JSON identity of `job` — the intended dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverCopy]);

  const patch = (p: Partial<CronJob>) => {
    dirty.current = true;
    setDraft((cur) => ({ ...cur, ...p }));
    setEditVersion((version) => version + 1);
  };
  const patchLocalRun = (p: Partial<{ date: string; time: string }>) => {
    const clean = { ...localRunOf(job), ...p };
    if (!clean.date || !clean.time) return;
    dirty.current = true;
    // localRunAt is a DRAW value on the wire (a non-persisted field) the daemon resolves in its own
    // timezone; it must never carry the browser's converted instant.
    setDraft((cur) => ({ ...cur, localRunAt: { date: clean.date, time: clean.time } }));
    setEditVersion((version) => version + 1);
  };

  const runNow = async () => {
    if (draft.runAt || dirty.current || autosave.status === 'saving' || runPending) return;
    setRunPending(true);
    try {
      await runtime().api(`/plugins/cronjob/jobs/${encodeURIComponent(job.id)}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: crypto.randomUUID(), expectedRevision: job.revision ?? 0 }),
      });
      toast(s.runQueued, 'ok');
      onRunQueued?.();
      onRefresh();
    } catch (error) {
      if (apiErrorCode(error) === 'run_already_queued') { toast(s.runQueued, 'ok'); onRunQueued?.(); }
      else toast(`${s.runError} — ${utils.apiErrorMessage(error)}`, 'error');
    } finally {
      setRunPending(false);
    }
  };

  /** Pause straight through the PUT: optimistic first, with the previous value coming back on a
   *  refusal (plus the reason). The whole writable payload travels, the same one an autosave would. */
  const toggleEnabled = async (next: boolean) => {
    const canWrite = adminFields || (job.ownerUserId != null && job.ownerUserId === myId);
    if (!canWrite || togglePending) return;
    const before = draftRef.current;
    const sent = { ...before, enabled: next };
    setDraft(sent);
    dirty.current = true;
    setTogglePending(true);
    everSaved.current = true;
    const request = save.mutateAsync({ ...writablePayload(sent), expectedRevision: before.revision ?? 0 });
    inFlight.current = request;
    try {
      await request;
      if (draftRef.current === sent) dirty.current = false;
    } catch (error) {
      if (draftRef.current === sent) { setDraft(before); dirty.current = false; }
      toast(`${s.saveError} — ${utils.apiErrorMessage(error)}`, 'error');
    } finally {
      if (inFlight.current === request) inFlight.current = null;
      setTogglePending(false);
    }
  };

  const remove = async () => {
    setConfirming(false);
    onRemoved(job.id);
    await inFlight.current?.catch(() => {});
    try { await del.mutateAsync(job.id); }
    catch { toast(s.deleteError, 'error'); }
  };

  const oneShot = draft.runAt !== undefined && draft.runAt !== null;
  const localRun = useMemo(() => localRunOf(draft), [draft]);
  const enabled = draft.enabled !== false;
  const mayPatch = adminFields || (job.ownerUserId != null && job.ownerUserId === myId);
  const name = draft.name || s.jobNew;

  const nextOccurrence = job.nextOccurrence;
  const dispositionLine = nextOccurrence?.disposition === 'deferredByHours' ? s.badgeDeferredHint
    : nextOccurrence?.disposition === 'catchUp' ? s.badgeCatchUpHint
    : nextOccurrence?.disposition === 'dueNow' || nextOccurrence?.disposition === 'late' ? s.badgeLateHint
    : nextOccurrence?.guarded ? s.badgeGuardedHint
    : null;

  return (
    <C.WorkspaceDetailRail label={name} closeLabel={t.common.close} onClose={onClose}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <C.Field label={s.name}>
            <C.Input value={draft.name} disabled={!mayPatch} onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch({ name: e.target.value })} placeholder="morning-digest" />
          </C.Field>
          <C.Field label={oneShot ? s.badgeOneShot : s.badgeRecurring}>
            <span className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
              <C.Badge tone="default">{oneShot ? s.badgeOneShot : s.badgeRecurring}</C.Badge>
              {job.manualQueued ? <C.Badge tone="muted">{s.runQueued}</C.Badge> : null}
              {mayPatch ? (
                <C.Toggle
                  checked={enabled}
                  onChange={(v: boolean) => { patch({ enabled: v }); }}
                  disabled={autosave.status === 'saving'}
                  label={`${name}: ${s.enabled}`}
                />
              ) : null}
              <span className="sr-only">{enabled ? s.enabled : s.paused}</span>
              {!enabled ? <span className="inline-flex items-center gap-1" aria-hidden><PauseCircle size={12} />{s.paused}</span> : <span aria-hidden>{s.enabled}</span>}
            </span>
          </C.Field>
        </div>
        {/* What happens next, as the daemon derived it: an instant, a local clock line, the timezone it
            is read in, and — when there is one — why the expected time differs from the planned one. */}
        <div className="flex flex-col gap-1 rounded-md border border-border bg-document px-3 py-2 text-xs text-muted-foreground" data-testid="cron-next-run">
          <span className="text-sm font-medium text-foreground">{s.nextRun}</span>
          {enabled && nextOccurrence ? (
            <>
              <span className="font-mono text-xs text-foreground">{nextOccurrence.localDate} {nextOccurrence.localTime} · {nextOccurrence.timezone}</span>
              {dispositionLine ? <span>{dispositionLine}</span> : null}
            </>
          ) : !enabled ? <span>{s.nextRunPaused}</span> : <span>{s.nextRunUnknown}</span>}
        </div>
        <C.Field label={s.schedule} hint={s.helpSchedule}>
          {oneShot ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <C.Field label={s.date}>
                <C.Input type="date" value={localRun.date} onChange={(e: React.ChangeEvent<HTMLInputElement>) => patchLocalRun({ date: e.target.value })} aria-label={s.date} disabled={!mayPatch} />
              </C.Field>
              <C.Field label={s.time}>
                <C.Input type="time" step={60} value={localRun.time} onChange={(e: React.ChangeEvent<HTMLInputElement>) => patchLocalRun({ time: e.target.value })} aria-label={s.time} disabled={!mayPatch} />
              </C.Field>
              <span className="text-xs text-muted-foreground sm:col-span-2">{s.hoursTimeZone}</span>
            </div>
          ) : (
            <ScheduleField schedule={draft.schedule} onChange={(schedule) => patch({ schedule })} />
          )}
        </C.Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <C.Field label={s.hours} hint={s.helpHours}>
            <ActiveHoursField value={draft.hours} onChange={(hours) => patch({ hours })} />
          </C.Field>
          <C.Field label={s.header} hint={s.helpHeader}>
            <span className="flex h-9 items-center text-sm text-muted-foreground">
              <C.Toggle checked={draft.plain !== true} onChange={(v: boolean) => patch({ plain: v ? undefined : true })} label={`${name}: ${s.header}`} disabled={!mayPatch} />
            </span>
          </C.Field>
        </div>
        {adminFields && (draft.ownerUserId == null || draft.ownerUserId === myId) ? (
          <C.Field label={s.ownerColumn} hint={s.ownerFieldHint}>
            <C.Segmented
              value={draft.ownerUserId != null ? 'mine' : 'instance'}
              onChange={(value: string) => patch({ ownerUserId: value === 'mine' ? myId ?? undefined : null })}
              options={[
                { value: 'instance', label: s.ownerInstance },
                { value: 'mine', label: s.ownerMine },
              ]}
              aria-label={s.ownerColumn}
              nowrap
            />
          </C.Field>
        ) : null}
        <C.Field label={s.executionProject} hint={s.helpExecutionProject}>
          <C.ChoiceField
            title={s.executionProject}
            manageAriaLabel={s.executionProject}
            picker="always"
            value={draft.projectRef ? `${draft.projectRef.kind}:${draft.projectRef.projectId ?? ''}` : ''}
            options={[
              { value: '', label: s.executionLegacy },
              ...(adminFields && ownerOf(draft) === null ? [{ value: 'host:', label: s.executionHost }] : []),
              ...(projects.data ?? []).filter(project => project.executionKind !== 'managed' || ownerOf(draft) !== null).map(project => ({ value: `${project.executionKind}:${project.id}`, label: project.slug })),
            ]}
            onChange={(value: string) => {
              if (value === 'host:') { patch({ projectRef: { kind: 'host' } }); return; }
              const project = projects.data?.find(project => `${project.executionKind}:${project.id}` === value);
              if (project) patch({ projectRef: { kind: project.executionKind, projectId: project.id } });
            }}
            aria-label={s.executionProject}
          />
          {projects.isError ? <p role="alert" className="text-sm text-destructive">{s.executionUnavailable}</p> : null}
        </C.Field>
        {/* Filing, and filing only. A one-shot wake-up is never filed (it deletes itself), so the
            recurring field never doubles as a delivery selector. */}
        {!oneShot ? (
          <C.Field label={s.conversation} hint={s.helpConversation}>
            <ConversationField
              value={draft.conversationSessionId ?? ''}
              saved={job.conversation}
              unresolved={job.conversationUnresolved === true}
              owner={ownerOf(draft)}
              myId={myId}
              required={false}
              mismatch={false}
              onChange={(conversationSessionId) => patch({ conversationSessionId })}
            />
          </C.Field>
        ) : null}
        {adminFields || draft.projectRef?.kind === 'managed' ? (
          <C.Field label={s.check} hint={s.helpCheck}>
            <C.Textarea value={draft.check ?? ''} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => patch({ check: e.target.value || undefined })} rows={2} placeholder="test -n &quot;$(ls /new-bookings 2>/dev/null)&quot; &amp;&amp; cat /new-bookings/*" />
          </C.Field>
        ) : null}
        <C.Field label={s.prompt} hint={s.helpPrompt}>
          <C.Textarea value={draft.prompt} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => patch({ prompt: e.target.value })} rows={8} disabled={!mayPatch} />
        </C.Field>
        {adminFields && (draft.ownerUserId == null || draft.ownerUserId === myId) ? (
          <C.Field label={s.channel} hint={s.helpChannel}>
            <DestinationField
              value={draft.notifyChannelId ?? ''}
              onChange={(v) => patch({ notifyChannelId: v || undefined })}
              destinations={destinations}
            />
          </C.Field>
        ) : null}
        <C.Field label={s.model} hint={s.helpModel}>
          <C.BrainModelField
            value={draft.model ? `${draft.model.provider}/${draft.model.model}` : ''}
            onChange={(v: string) => {
              const slash = v.indexOf('/');
              patch({ model: slash > 0 ? { provider: v.slice(0, slash), model: v.slice(slash + 1) } : undefined });
            }}
            models={models}
            title={s.model}
            subtitle={s.helpModel}
            defaultLabel={s.modelDefault}
            keyOf={(m: BrainModelOption) => `${m.provider}/${m.model}`}
          />
        </C.Field>
        {/* `lastRun` is when execution was CLAIMED, not when it finished; the wording must not promise
            a completed run, and lastResult itself remains unclassified text. */}
        <div className="flex min-w-0 flex-col gap-1" data-testid="cron-last-run">
          <span className="text-sm font-medium text-foreground">{s.lastStarted}</span>
          <span className="text-xs text-muted-foreground">{job.lastRun && utils.parseTs(job.lastRun) != null ? new Date(utils.parseTs(job.lastRun)!).toLocaleString(locale || undefined) : '—'}</span>
          {job.lastResult ? (
            <p className="whitespace-pre-wrap rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">{job.lastResult}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          {!oneShot ? (
            <C.Button
              variant="outline"
              icon={Play}
              disabled={dirty.current || autosave.status === 'saving' || runPending}
              onClick={() => void runNow()}
            >
              {runPending ? s.runStarting : s.runNow}
            </C.Button>
          ) : !job.manualQueued ? null : <span />}
          <span className="ml-auto flex items-center gap-2">
            <C.Button
              variant="outline"
              icon={enabled ? PauseCircle : Play}
              aria-label={enabled ? s.pauseLabel : s.pauseLabelOn}
              disabled={!mayPatch || togglePending}
              onClick={() => void toggleEnabled(!enabled)}
            >
              {enabled ? s.pauseLabel : s.paused}
            </C.Button>
            <C.Button variant="ghost-danger" icon={Trash2} onClick={() => setConfirming(true)}>{s.removeJob}</C.Button>
          </span>
        </div>
        <C.AutoSaveStatus status={autosave.status} onRetry={autosave.retry} />
      </div>
      <C.ConfirmDialog
        open={confirming}
        title={s.deleteTitle}
        description={s.deleteDesc.replace('{name}', name)}
        confirmLabel={s.removeJob}
        onConfirm={remove}
        onClose={() => setConfirming(false)}
      />
    </C.WorkspaceDetailRail>
  );
}
