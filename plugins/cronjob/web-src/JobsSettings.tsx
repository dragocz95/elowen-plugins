import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, CalendarClock, Check, Clock, Hash, MessageSquare, MessagesSquare, PauseCircle, Play, Plus, Search, Timer, Trash2, X } from 'lucide-react';
import {
  runtime, type BrainModelOption, type CronConversation, type CronConversationOption,
  type CronConversationsResponse, type CronJob, type NotificationDestinationOption, type ManageSelectionItem,
} from './runtime';
import {
  WEEKDAYS, builderForMode, parseActiveHours, parseBuilderSchedule, renderActiveHours,
  renderBuilderSchedule, type ScheduleBuilder, type ScheduleMode,
} from './scheduleBuilder';

/** One page of jobs, matching the register size the built-in workspaces page at. */
const PAGE_SIZE = 20;
type Filter = 'all' | 'active' | 'paused';

/** The address parameter a conversation's scheduled-jobs branch links to: `/p/cronjob?job=<id>` opens
 *  THIS register on the job it names. It selects an existing job and nothing else — no job is created,
 *  none is enabled and nothing is written by arriving here. */
const JOB_PARAM = 'job';

const linkedJobId = (): string | null => {
  const value = new URLSearchParams(window.location.search).get(JOB_PARAM);
  return value && value.trim() !== '' ? value : null;
};

/** Put the selection in the address, leaving every other parameter of the page alone. `pushState` rather
 *  than a router push: the selection is state of a mounted page, and pushing an entry is what makes the
 *  browser's Back button walk back through the jobs that were opened. The host's SPA router reads the
 *  History API, so nothing here needs the router itself. */
const writeJobParam = (id: string | null): void => {
  const url = new URL(window.location.href);
  if (id === null) url.searchParams.delete(JOB_PARAM);
  else url.searchParams.set(JOB_PARAM, id);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  window.history.pushState(window.history.state, '', next);
};

const textareaClass = 'w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-ring';

/** The fields of a job a client OWNS, i.e. everything the daemon did not derive for display. `owner`,
 *  `conversation`, `conversationUnresolved` and `runLocation` are the daemon's projections of its own
 *  state, resolved from keys this page never sees; sending them back would ask it to trust a client's
 *  copy of its own answer. `expectedRevision` is re-stated per write from the draft's revision. */
const writablePayload = (job: CronJob): CronJob => {
  const {
    owner: _owner, conversation: _conversation, conversationUnresolved: _unresolved,
    runLocation: _runLocation, expectedRevision: _expectedRevision, ...payload
  } = job;
  return payload;
};

/** Single-select notification target across every enabled platform. A saved opaque value whose provider
 *  is currently unavailable stays pinned, so opening and saving the editor never silently drops it. */
function DestinationField({ value, onChange, destinations }: { value: string; onChange: (v: string) => void; destinations: NotificationDestinationOption[] }) {
  const { components: C, hooks } = runtime();
  const { t } = hooks.useTranslation();
  const s = hooks.usePluginStrings('cronjob');
  const [open, setOpen] = useState(false);
  const selected = destinations.find((destination) => destination.value === value);
  const icon = (kind: NotificationDestinationOption['kind']) =>
    kind === 'channel' ? <Hash size={12} aria-hidden /> : <MessageSquare size={12} aria-hidden />;
  const items: ManageSelectionItem[] = [
    { id: '', label: s.pillDefault, group: '' },
    ...(value && !selected ? [{ id: value, label: value, group: '', icon: <Hash size={12} aria-hidden /> }] : []),
    ...destinations.map((destination) => ({
      id: destination.value,
      label: destination.label,
      group: `${destination.platform}:${destination.group ?? destination.platform}`,
      groupLabel: destination.group ?? destination.platform,
      icon: icon(destination.kind),
      badges: destination.subtitle ? [{ text: destination.subtitle }] : undefined,
    })),
  ];
  return (
    <>
      <C.SelectionSummary
        countText={value ? '' : '—'}
        samples={value ? [{ label: selected?.label ?? value, icon: icon(selected?.kind ?? 'channel') }] : []}
        moreCount={0}
        onManage={() => setOpen(true)}
        manageLabel={t.managePicker.manage}
      />
      <C.ManageSelectionModal
        title={s.channel}
        subtitle={s.helpChannel}
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        selected={new Set([value])}
        single
        onSave={(next: Set<string>) => onChange([...next][0] ?? '')}
      />
    </>
  );
}

/** The conversation a recurring job is FILED under. Organization only: this picker decides where the job
 *  appears in the conversation list and nothing else — not the context it runs with, not its model, not
 *  its permissions, and not where its result is delivered.
 *
 *  The catalog comes from the plugin's own picker route, and the SCOPE it is asked in follows the job's
 *  owner, because that is the rule the daemon validates against: a personal job may only be filed under a
 *  conversation of its own account, an instance job under any eligible one an administrator can read.
 *  Nothing here is ever cleared — the daemon refuses a blank value rather than reading it as "unfile". */
function ConversationField({ value, saved, unresolved, owner, myId, required, mismatch, onChange }: {
  /** The draft's filed conversation id; '' = nothing chosen yet. */
  value: string;
  /** The server's projection of the SAVED filing: `undefined` = never filed, `null` = its target is gone. */
  saved: CronConversation | null | undefined;
  /** The daemon could not read the conversation directory, so `saved === null` is "not known right now"
   *  rather than "deleted" — the reader is told that instead of being sent to refile a good job. */
  unresolved: boolean;
  /** Who the job belongs to AFTER this edit; null = an instance job. */
  owner: number | null;
  myId: number | null;
  /** A job the server does not have yet: it cannot be saved before it is filed. */
  required: boolean;
  /** The owner changed and the filed conversation belongs to the previous one. */
  mismatch: boolean;
  onChange: (id: string) => void;
}) {
  const { components: C, hooks } = runtime();
  const { t } = hooks.useTranslation();
  const s = hooks.usePluginStrings('cronjob');
  const [open, setOpen] = useState(false);
  /** The option the user just chose, so the summary names it before the save round-trips. */
  const [picked, setPicked] = useState<CronConversationOption | null>(null);
  const query = owner === null ? '?scope=instance' : owner === myId ? '' : `?owner=${encodeURIComponent(String(owner))}`;
  // Fetched when the picker opens: the saved filing already travels with the job, so a page of rows owes
  // the daemon no request until somebody actually files one.
  const list = hooks.useQuery<CronConversationsResponse>({
    queryKey: ['cronjob-conversations', query],
    queryFn: () => runtime().api(`/plugins/cronjob/api/conversations${query}`) as Promise<CronConversationsResponse>,
    enabled: open,
    staleTime: 30_000,
  });
  const options = list.data?.status === 'available' ? list.data.conversations : [];
  const chosen: CronConversation | null = picked?.id === value ? picked
    : saved?.id === value ? saved
    : options.find((c) => c.id === value) ?? null;
  /** A filing whose conversation is GONE — an explicit state, not an empty one, and not the same as a
   *  directory the daemon could not read, which claims nothing about the target either way. */
  const unavailable = saved === null && chosen === null && !unresolved;
  const icon = <MessagesSquare size={12} aria-hidden />;
  const items: ManageSelectionItem[] = [
    ...(unavailable
      ? [{ id: value, label: s.conversationUnavailable, group: '', disabled: true, disabledHint: s.conversationUnavailableHint }]
      : chosen && !options.some((c) => c.id === chosen.id)
        ? [{ id: chosen.id, label: chosen.title || chosen.id, group: '', icon }]
        : []),
    ...options.map((c) => ({
      id: c.id,
      label: c.title || c.id,
      group: c.platform ?? 'own',
      groupLabel: c.platform ?? s.conversationOwnChat,
      icon,
    })),
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <C.SelectionSummary
        // No count line: one conversation is not a count, and the line below already says what an
        // unfiled, unavailable or conflicting job needs.
        countText=""
        samples={chosen ? [{ label: chosen.title || chosen.id, icon }] : unavailable ? [{ label: s.conversationUnavailable, icon }] : []}
        moreCount={0}
        onManage={() => setOpen(true)}
        manageLabel={t.managePicker.manage}
        manageAriaLabel={s.conversationManage}
      />
      {/* One line of direction under the summary, and only when there is something to do: an unavailable
          target, a filing the new owner cannot keep, or a new job that is not filed yet. */}
      {unavailable ? <p className="text-xs text-destructive">{s.conversationUnavailableHint}</p>
        : unresolved ? <p className="text-xs text-muted-foreground">{s.conversationUnresolvedHint}</p>
        : mismatch ? <p className="text-xs text-destructive">{s.conversationOwnerHint}</p>
        : required && !chosen ? <p className="text-xs text-muted-foreground">{s.conversationRequired}</p>
        : !value ? <C.Badge tone="muted">{s.conversationUnassigned}</C.Badge>
        : null}
      <C.ManageSelectionModal
        title={s.conversation}
        // A list that is still coming, and one that failed to come, both render as no rows — and an empty
        // picker reads as "you have no conversations", which is an answer neither of them gave.
        subtitle={list.isLoading ? s.conversationLoading
          : list.isError ? s.conversationListError
          : list.data?.status === 'unavailable' ? s.conversationDirectoryUnavailable
          : s.helpConversation}
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        selected={new Set(value ? [value] : [])}
        single
        onSave={(next: Set<string>) => {
          const id = [...next][0] ?? '';
          if (!id || id === value) return;
          setPicked(options.find((c) => c.id === id) ?? null);
          onChange(id);
        }}
      />
    </div>
  );
}

function ScheduleField({ schedule, valid, onChange }: { schedule: string; valid: boolean; onChange: (value: string) => void }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const parsed = parseBuilderSchedule(schedule);
  const [mode, setMode] = useState<ScheduleMode>(parsed?.mode ?? 'advanced');
  const emitted = useRef<string | null>(null);

  useEffect(() => {
    if (emitted.current === schedule) {
      emitted.current = null;
      return;
    }
    setMode(parseBuilderSchedule(schedule)?.mode ?? 'advanced');
  }, [schedule]);

  const emit = (value: string) => {
    emitted.current = value;
    onChange(value);
  };
  const selectMode = (next: ScheduleMode) => {
    setMode(next);
    if (next === 'advanced') return;
    const value = renderBuilderSchedule(builderForMode(next, parsed));
    if (value !== schedule) emit(value);
  };
  const updateBuilder = (builder: ScheduleBuilder) => emit(renderBuilderSchedule(builder));
  const builder = mode === 'advanced' ? null : builderForMode(mode, parsed);
  const weekdayLabels = WEEKDAYS.map((day) => ({
    value: day,
    label: s[`weekday${day[0]!.toUpperCase()}${day.slice(1)}`],
  }));

  return (
    <div className="flex flex-col gap-3">
      <C.Segmented
        value={mode}
        onChange={selectMode}
        options={[
          { value: 'every', label: s.scheduleEvery },
          { value: 'daily', label: s.scheduleDaily },
          { value: 'weekly', label: s.scheduleWeekly },
          { value: 'advanced', label: s.scheduleAdvanced },
        ]}
        aria-label={s.scheduleMode}
      />
      {builder?.mode === 'every' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <C.Field label={s.scheduleInterval}>
            <C.Input
              type="number"
              min={1}
              step={1}
              value={builder.amount}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                const amount = Number(event.target.value);
                if (Number.isSafeInteger(amount) && amount >= 1) updateBuilder({ ...builder, amount });
              }}
            />
          </C.Field>
          <C.Field label={s.scheduleUnit}>
            <C.Segmented
              value={builder.unit}
              onChange={(unit: 'm' | 'h') => updateBuilder({ ...builder, unit })}
              options={[
                { value: 'm', label: s.scheduleMinutes },
                { value: 'h', label: s.scheduleHours },
              ]}
              aria-label={s.scheduleUnit}
            />
          </C.Field>
        </div>
      ) : null}
      {builder?.mode === 'daily' || builder?.mode === 'weekly' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {builder.mode === 'weekly' ? (
            <C.Field label={s.scheduleWeekday}>
              <C.ChoiceField
                title={s.scheduleWeekday}
                options={weekdayLabels}
                value={builder.day}
                onChange={(day: typeof builder.day) => updateBuilder({ ...builder, day })}
                manageAriaLabel={s.scheduleWeekday}
              />
            </C.Field>
          ) : null}
          <C.Field label={s.scheduleTime}>
            <C.Input
              type="time"
              step={60}
              value={builder.time}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                if (/^([01]\d|2[0-3]):[0-5]\d$/.test(event.target.value)) {
                  updateBuilder({ ...builder, time: event.target.value });
                }
              }}
            />
          </C.Field>
        </div>
      ) : null}
      {builder ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{s.scheduleGenerated}</span>
          <code className="rounded border border-border bg-background px-2 py-1 text-foreground">{renderBuilderSchedule(builder)}</code>
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="relative">
            <C.Input
              value={schedule}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => emit(event.target.value)}
              className="pr-8 font-mono"
              placeholder="0 9 * * 1-5"
              aria-label={s.scheduleAdvancedValue}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2" title={valid ? s.scheduleValid : s.scheduleInvalid}>
              {valid
                ? <Check size={14} className="text-success" aria-label={s.scheduleValid} />
                : <X size={14} className="text-destructive" aria-label={s.scheduleInvalid} />}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{s.scheduleAdvancedHint}</p>
        </div>
      )}
    </div>
  );
}

function ActiveHoursField({ value, onChange }: { value: string | undefined; onChange: (value: string | undefined) => void }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const parsed = parseActiveHours(value);
  const legacy = Boolean(value && !parsed);
  const mode = legacy ? 'legacy' : parsed ? 'window' : 'off';
  const options = [
    { value: 'off', label: s.hoursOff },
    { value: 'window', label: s.hoursWindow },
    ...(legacy ? [{ value: 'legacy', label: s.hoursLegacy }] : []),
  ];
  const setHour = (part: 'start' | 'end', raw: string) => {
    if (!parsed || raw === '') return;
    const hour = Number(raw);
    const next = renderActiveHours(part === 'start' ? hour : parsed.start, part === 'end' ? hour : parsed.end);
    if (next) onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <C.Segmented
        value={mode}
        onChange={(next: string) => {
          if (next === 'off') onChange(undefined);
          else if (next === 'window' && !parsed) onChange('8-17');
        }}
        options={options}
        aria-label={s.hoursMode}
      />
      {parsed ? (
        <div className="grid grid-cols-2 gap-3">
          <C.Field label={s.hoursStart}>
            <C.Input
              type="number"
              min={0}
              max={23}
              step={1}
              value={parsed.start}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setHour('start', event.target.value)}
            />
          </C.Field>
          <C.Field label={s.hoursEnd}>
            <C.Input
              type="number"
              min={0}
              max={23}
              step={1}
              value={parsed.end}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setHour('end', event.target.value)}
            />
          </C.Field>
        </div>
      ) : legacy ? (
        <p className="text-xs text-muted-foreground">{s.hoursLegacyHint} <code className="text-foreground">{value}</code></p>
      ) : null}
    </div>
  );
}

/** One job: a table row, plus its editor in the workspace's detail drawer while the row is the selected
 *  one. The component stays mounted whether or not the drawer is open — the drawer portals out of this
 *  subtree — so a save that fails after the user closed the editor still shows itself, and still offers
 *  Retry, on the row it belongs to. Unmounting it on close would have thrown the unsaved draft away.
 *
 *  The row edits and persists ITSELF (one PUT of this job), so a page that has not seen a job someone
 *  else just added can never write it away.
 *
 *  `job` is the server's copy and stays the source of truth for the scheduler-owned fields (last run,
 *  last result); `draft` holds what the user is typing. When the server's copy changes and the row has no
 *  unsaved edit, the draft adopts it — otherwise a job the brain's cron tools changed behind this page's
 *  back would be shown stale and overwritten by the row's next save. */
function CronJobRow({ job, persisted, ownerLabel, adminFields, myId, destinations, models, selected, onSelect, onClose, onRemoved, onRefresh }: {
  job: CronJob;
  persisted: boolean;
  /** Who owns the job, for the admin's owner column; null hides the column (everyone else sees only their own). */
  ownerLabel: string | null;
  /** Whether this caller may set the fields only an INSTANCE job has: the shell guard (it runs a command
   *  on the host) and the destination channel (it belongs to the operator). The server refuses both on an
   *  owned job, so offering them to somebody whose save would be rejected is worse than not showing them. */
  adminFields: boolean;
  /** The signed-in account, so "mine" on the owner switch names a real id rather than a guess. */
  myId: number | null;
  destinations: NotificationDestinationOption[];
  models: BrainModelOption[];
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRemoved: (id: string) => void;
  onRefresh: () => void;
}) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { t } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const save = hooks.useSaveCronJob();
  const del = hooks.useDeleteCronJob();
  const [draft, setDraft] = useState<CronJob>(job);
  const projects = hooks.useQuery<{ id: number; slug: string; executionKind: 'host' | 'managed' }[]>({ queryKey: ['projects'], queryFn: () => runtime().api('/projects') });
  const [confirming, setConfirming] = useState(false);
  const [runPending, setRunPending] = useState(false);
  /** The row's own enable switch is on the wire. It writes immediately rather than through the debounced
   *  auto-save, so the row says so itself instead of borrowing the editor's indicator. */
  const [togglePending, setTogglePending] = useState(false);
  /** Only user edits advance this value. Scheduler stamps and API refreshes may replace the clean draft,
   *  but they must never look like another edit and send the same job back in an endless PUT/refetch loop. */
  const [editVersion, setEditVersion] = useState(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** Edits this row has not persisted yet. Only a clean row adopts a server change. */
  const dirty = useRef(false);
  /** Deleting a row unmounts it, and the auto-save flushes a pending edit on unmount — which would
   *  recreate the job we just deleted. Once it is gone, its save is a no-op; a DELETE that FAILS clears
   *  this again, or the row would sit there swallowing every further edit while reporting "saved". */
  const deleted = useRef(false);
  /** The save currently on the wire, and whether this row ever reached the server at all. A delete has to
   *  wait for the former (or the PUT lands after the DELETE and the job comes back) and only needs to send
   *  a DELETE when the latter is true. */
  const inFlight = useRef<Promise<unknown> | null>(null);
  const everSaved = useRef(persisted);

  /** Who the job belongs to after this edit — the scope its filing is validated in. A non-admin always
   *  writes his own job, whatever the draft carries, which is what the server does with it too. */
  const ownerOf = (j: CronJob): number | null => (adminFields ? j.ownerUserId ?? null : myId);
  /** An ownership change cannot carry a conversation that belongs to the PREVIOUS owner: the daemon
   *  refuses it, so the row asks for a compatible one instead of collecting that 400 from the autosave.
   *  Only a filing that is still the saved one can conflict — anything chosen since came from a picker
   *  already scoped to the new owner. */
  const ownerConflict = (j: CronJob): boolean => {
    const filed = job.conversation;
    if (!filed || j.conversationSessionId !== job.conversationSessionId) return false;
    const owner = ownerOf(j);
    return owner !== null && filed.ownerUserId !== owner;
  };
  /** Whether the job's FILING is settled. A one-shot wake-up is never filed; a new recurring job cannot
   *  be saved before it names a conversation; an existing one preserves its filing by omission. */
  const filingReady = (j: CronJob): boolean => {
    if (j.runAt) return true;
    if (!persisted) return j.projectRef !== undefined && (j.conversationSessionId ?? '').trim() !== '';
    return !ownerConflict(j);
  };

  /** A job the daemon's PUT validation would accept — auto-save holds off until the row qualifies, so a
   *  freshly added (still empty) job never fires a 400 toast mid-typing. */
  const isSavable = (j: CronJob): boolean =>
    j.name.trim() !== '' && j.prompt.trim() !== '' && (j.runAt ? true : utils.isValidSchedule(j.schedule)) && filingReady(j);

  const autosave = hooks.useAutoSaveStatus([editVersion], async () => {
    if (deleted.current) return;
    const sent = draftRef.current;
    // `conversation` is the server's live projection of the filing, resolved from an immutable key this
    // page never sees; sending it back would ask the daemon to trust a client's copy of its own answer.
    const payload = writablePayload(sent);
    everSaved.current = true;
    const request = save.mutateAsync({ ...payload, expectedRevision: sent.revision ?? 0 });
    inFlight.current = request;
    try {
      await request;
      if (draftRef.current === sent) dirty.current = false; // still clean only if nothing was typed meanwhile
    } catch (error) {
      toast(`${s.saveError} — ${utils.apiErrorMessage(error)}`, 'error');
      throw error;
    } finally {
      if (inFlight.current === request) inFlight.current = null;
    }
  }, { savable: isSavable(draft), delay: 900 });

  // Adopt the server's copy whenever it changes under a row with nothing unsaved in it.
  const serverCopy = JSON.stringify(job);
  useEffect(() => {
    if (dirty.current || deleted.current) return;
    setDraft(job);
    // serverCopy is the JSON identity of `job` — the intended dependency. Depending on `job` itself
    // would re-run on every render that hands over a new object with the same contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverCopy]);

  const patch = (p: Partial<CronJob>) => {
    dirty.current = true;
    setDraft((cur) => ({ ...cur, ...p }));
    setEditVersion((version) => version + 1);
  };

  const runNow = async () => {
    if (!persisted || draft.runAt || dirty.current || autosave.status === 'saving') return;
    setRunPending(true);
    try {
      await runtime().api(`/plugins/cronjob/jobs/${encodeURIComponent(job.id)}/run`, { method: 'POST' });
      toast(s.runQueued, 'ok');
      // The endpoint returns once the scheduler accepted the job; lastRun is stamped synchronously as the
      // detached turn starts, so one short refresh makes the state visible without polling the model turn.
      window.setTimeout(onRefresh, 600);
    } catch (error) {
      toast(`${s.runError} — ${utils.apiErrorMessage(error)}`, 'error');
    } finally {
      setRunPending(false);
    }
  };

  /** Enable or pause the job straight from the row. The draft flips FIRST, so the switch answers the
   *  click at once, and the previous value comes back if the daemon refuses — with the reason it gave,
   *  the way the editor's save path reports one. The whole draft travels, because that is what the
   *  auto-save would have sent anyway; a partial write here would silently drop a pending edit. */
  const toggleEnabled = async (next: boolean) => {
    if (!persisted || !mayToggle || togglePending || deleted.current) return;
    const before = draftRef.current;
    const sent = { ...before, enabled: next };
    setDraft(sent);
    dirty.current = true;
    setTogglePending(true);
    everSaved.current = true;
    const request = save.mutateAsync({ ...writablePayload(sent), expectedRevision: before.revision ?? 0 });
    inFlight.current = request; // a DELETE must not overtake the write it would undo
    try {
      await request;
      if (draftRef.current === sent) dirty.current = false;
    } catch (error) {
      // Only revert what is still the optimistic value: anything typed meanwhile is the user's and the
      // auto-save owns it from here.
      if (draftRef.current === sent) { setDraft(before); dirty.current = false; }
      toast(`${s.saveError} — ${utils.apiErrorMessage(error)}`, 'error');
    } finally {
      if (inFlight.current === request) inFlight.current = null;
      setTogglePending(false);
    }
  };

  const remove = async () => {
    deleted.current = true;
    setConfirming(false);
    onRemoved(job.id);
    await inFlight.current?.catch(() => {}); // a DELETE must not overtake the save it would undo
    if (!everSaved.current) return;          // a row that never reached the server has nothing to delete
    try { await del.mutateAsync(job.id); }
    catch {
      deleted.current = false; // the job is still there — let the row keep saving
      toast(s.deleteError, 'error');
    }
  };

  const enabled = draft.enabled !== false;
  /** Who may pause this job from the row. The daemon enforces the same rule; offering a switch whose
   *  every write comes back 403 is worse than showing the state as read-only. */
  const mayToggle = adminFields || (job.ownerUserId != null && job.ownerUserId === myId);
  const validSchedule = draft.runAt ? true : utils.isValidSchedule(draft.schedule);
  const lastRunMs = utils.parseTs(job.lastRun);
  const destination = draft.notifyChannelId ? destinations.find((option) => option.value === draft.notifyChannelId) : undefined;
  // An OWNED job has no channel destination at all — it reports in its owner's own conversation and no
  // channel may be set on it, so naming the notification channel here would describe a delivery that
  // never happens. Only an instance job falls back to "default channel".
  const dest = draft.notifyChannelId ? destination?.label ?? draft.notifyChannelId
    : job.ownerUserId != null ? s.channelOwnerChat : null;
  const name = draft.name || s.jobNew;
  /** The conversation the job is FILED under, as the row can state it: the four answers the daemon
   *  distinguishes, in the same words the editor uses below. A one-shot wake-up is never filed. */
  const filed = draft.runAt ? null
    : job.conversationUnresolved === true ? s.conversationUnknown
    : job.conversation ? job.conversation.title || job.conversation.id
    : job.conversation === null ? s.conversationUnavailable
    : s.conversationUnassigned;
  /** Where its turns actually RUN, and only when that is somewhere else. A job whose runs land in the
   *  very conversation it is filed under would just say the same thing twice. */
  const runsIn = job.runLocation?.kind === 'dedicated' ? s.runInOwnConversation
    : job.runLocation?.kind === 'channel' ? s.runInChannel
    : job.runLocation?.kind === 'origin' && job.runLocation.sessionId !== draft.conversationSessionId ? s.runInOrigin
    : null;
  const where = [filed, runsIn].filter(Boolean).join(' · ');

  return (
    <>
      <C.DataTableRow
        selected={selected}
        aria-selected={selected}
        onOpen={onSelect}
        openLabel={s.openJob.replace('{name}', name)}
        className="group"
      >
        {/* The switch stands where the state dot did, because the two state the same thing and only one
            of them may: a control beside a read-only copy of its own value is two truths waiting to
            disagree. It is operable, so neither it nor its header is hidden from the accessibility tree
            any more. It keeps the dot's `wide` priority — at 320px its track is width the job name
            needs, and the state still travels there as the paused badge and the text below, with the
            editor's own switch a tap away. */}
        <C.DataTableCell lines="auto" priority="wide" className="flex items-center justify-center">
          <C.Toggle
            checked={enabled}
            onChange={(next: boolean) => void toggleEnabled(next)}
            label={`${name}: ${s.enabled}`}
            disabled={!persisted || !mayToggle || togglePending || autosave.status === 'saving'}
          />
        </C.DataTableCell>
        <C.DataTableCell lines="auto" title={name} className="flex min-w-0 flex-col justify-center gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm text-foreground">{name}</span>
            {!enabled ? <C.Badge tone="muted">{s.paused}</C.Badge> : null}
            {/* The state as text, in the column that survives every width: colour alone does not carry
                it, `title` is not reliably announced, and an active job has no badge to speak for it. */}
            <span className="sr-only">{enabled ? s.enabled : s.paused}</span>
          </span>
          {/* Owner and conversation as one secondary line, so both are readable at every width instead of
              only inside the editor or only on a wide fold. The owner half is left out where it is
              implied: a non-admin's list is already nothing but their own jobs. */}
          {ownerLabel !== null || where ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
              {ownerLabel !== null ? (
                job.owner ? (
                  <span className="flex min-w-0 items-center gap-1" title={`${job.owner.name} (#${job.owner.id})`}>
                    <C.Avatar name={job.owner.name || job.owner.username} user={job.owner} size={16} />
                    <span className="truncate">{job.owner.name || job.owner.username}</span>
                    <span className="shrink-0 text-[10px]">#{job.owner.id}</span>
                  </span>
                ) : <span className="shrink-0">{ownerLabel}</span>
              ) : null}
              {ownerLabel !== null && where ? <span className="shrink-0" aria-hidden>·</span> : null}
              {where ? <span className="truncate" title={`${s.conversation}: ${where}`}>{where}</span> : null}
            </span>
          ) : null}
        </C.DataTableCell>
        <C.DataTableCell lines="auto" priority="wide" className="whitespace-nowrap">
          <C.Badge tone={validSchedule ? 'default' : 'danger'}>
            {draft.runAt ? <CalendarClock size={10} className="mr-1 inline-block align-[-1px]" aria-hidden /> : <Clock size={10} className="mr-1 inline-block align-[-1px]" aria-hidden />}
            {draft.schedule}
          </C.Badge>
        </C.DataTableCell>
        {/* Destination: one line that truncates, full name on hover. A channel or thread title can be far
            longer than the column, and wrapping it pushed every other row out of alignment. Shown only to
            an admin: an owned job always reports in its owner's own conversation and they cannot change
            that, so the column would repeat one value down the whole page — and "default channel" would
            name a channel the job never writes to. */}
        {adminFields ? (
          <C.DataTableCell lines={1} priority="wide" title={dest ?? s.channelDefault} className="text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0">
                {destination && destination.kind !== 'channel' ? <MessageSquare size={12} aria-hidden /> : <Hash size={12} aria-hidden />}
              </span>
              <span className={`truncate ${dest ? '' : 'italic text-muted-foreground'}`}>{dest ?? s.channelDefault}</span>
            </span>
          </C.DataTableCell>
        ) : null}
        <C.DataTableCell lines={1} priority="wide" title={lastRunMs != null ? new Date(lastRunMs).toLocaleString() : undefined} className="whitespace-nowrap text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Timer size={12} aria-hidden />
            <span className={lastRunMs == null ? 'text-muted-foreground' : undefined}>
              {lastRunMs != null ? utils.compactElapsed(Date.now() - lastRunMs) : '—'}
            </span>
          </span>
        </C.DataTableCell>
        <C.DataTableCell lines="auto" className="flex items-center justify-end">
          {/* On the row, not only in the drawer: a save that fails after the user closed the editor still
              has to show itself — and still has to offer Retry. */}
          <C.AutoSaveStatus status={autosave.status} onRetry={autosave.retry} />
        </C.DataTableCell>
        <C.DataTableChevronCell />
      </C.DataTableRow>

      {selected ? (
        <C.WorkspaceDetailRail label={name} closeLabel={t.common.close} onClose={onClose}>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <C.Field label={s.name}>
                <C.Input value={draft.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch({ name: e.target.value })} placeholder="morning-digest" />
              </C.Field>
              <C.Field label={s.enabled}>
                <span className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                  <C.Toggle checked={enabled} onChange={(v: boolean) => patch({ enabled: v })} label={`${name}: ${s.enabled}`} />
                  {enabled ? s.enabled : s.paused}
                </span>
              </C.Field>
            </div>
            <C.Field label={s.schedule} hint={s.helpSchedule}>
              <ScheduleField schedule={draft.schedule} valid={validSchedule} onChange={(schedule) => patch({ schedule })} />
            </C.Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <C.Field label={s.hours} hint={s.helpHours}>
                <ActiveHoursField value={draft.hours} onChange={(hours) => patch({ hours })} />
              </C.Field>
              {/* Positive toggle over the stored `plain` flag: checked = header shown (plain unset). */}
              <C.Field label={s.header} hint={s.helpHeader}>
                <span className="flex h-9 items-center text-sm text-muted-foreground">
                  <C.Toggle checked={draft.plain !== true} onChange={(v: boolean) => patch({ plain: v ? undefined : true })} label={`${name}: ${s.header}`} />
                </span>
              </C.Field>
            </div>
            {/* Only an admin may hand a job over, and only on a job that is instance-wide or already his:
                on somebody else's, "Mine" would read as a label and act as taking it from them. Moving a
                job also RE-DERIVES where it reports — the server drops the binding to the conversation it
                was scheduled from, which belonged to the previous owner. */}
            {adminFields && (job.ownerUserId == null || job.ownerUserId === myId) ? (
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
                  { value: '', label: persisted ? s.executionLegacy : s.executionSelect },
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
            {/* Where the job is FILED. Organization only, and never offered for a one-shot wake-up: it
                fires once and deletes itself, so it belongs to no conversation's job branch. */}
            {!draft.runAt ? (
              <C.Field label={s.conversation} hint={s.helpConversation}>
                <ConversationField
                  value={draft.conversationSessionId ?? ''}
                  saved={job.conversation}
                  unresolved={job.conversationUnresolved === true}
                  owner={ownerOf(draft)}
                  myId={myId}
                  required={!persisted}
                  mismatch={ownerConflict(draft)}
                  onChange={(conversationSessionId) => patch({ conversationSessionId })}
                />
              </C.Field>
            ) : null}
            {adminFields || draft.projectRef?.kind === 'managed' ? (
              <C.Field label={s.check} hint={s.helpCheck}>
                <textarea
                  value={draft.check ?? ''}
                  onChange={(e) => patch({ check: e.target.value || undefined })}
                  rows={2}
                  className={textareaClass}
                  placeholder="test -n &quot;$(ls /new-bookings 2>/dev/null)&quot; &amp;&amp; cat /new-bookings/*"
                />
              </C.Field>
            ) : null}
            <C.Field label={s.prompt} hint={s.helpPrompt}>
              <textarea value={draft.prompt} onChange={(e) => patch({ prompt: e.target.value })} rows={8} className={textareaClass} />
            </C.Field>
            {/* A destination channel is an instance-job capability, or an operator's own: the server refuses it
                on somebody else's personal job, so it is not offered there — the row shows where it reports. */}
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
            {job.lastResult ? (
              <C.Field label={s.lastResult}>
                <p className="whitespace-pre-wrap rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">{job.lastResult}</p>
              </C.Field>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <C.Button
                variant="outline"
                icon={Play}
                disabled={!persisted || Boolean(draft.runAt) || dirty.current || autosave.status === 'saving' || runPending}
                onClick={() => void runNow()}
              >
                {runPending ? s.runStarting : s.runNow}
              </C.Button>
              <C.Button variant="ghost-danger" icon={Trash2} onClick={() => setConfirming(true)}>{s.removeJob}</C.Button>
            </div>
          </div>
        </C.WorkspaceDetailRail>
      ) : null}

      <C.ConfirmDialog
        open={confirming}
        title={s.deleteTitle}
        description={s.deleteDesc.replace('{name}', name)}
        confirmLabel={s.removeJob}
        onConfirm={remove}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}

/** Cron jobs manager (the cronjob plugin's own page). The list is the SERVER's — a job the scheduler or
 *  the brain's CronAdd tool creates shows up on the next refetch — and each row persists itself. A row
 *  added here lives locally only until the server has it; from then on the server's copy is the row. */
export function JobsSettings({ surface }: { surface: 'page' | 'deck' }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { t } = hooks.useTranslation();
  const { data, isLoading, isError, refetch } = hooks.useCronJobs();
  const me = hooks.useMe();
  const myId = me.data?.user?.id ?? null;
  const isAdmin = me.data?.user?.is_admin === true;
  const destinations = hooks.useNotificationDestinations();
  const models = hooks.useBrainModels();
  const [drafts, setDrafts] = useState<CronJob[]>([]);
  // Only the page carries the selection in its address; inside the Settings deck the address belongs to
  // the deck, and writing a job into it would leave a parameter no page reads.
  const deepLink = surface === 'page';
  const [selectedId, setSelectedId] = useState<string | null>(() => (deepLink ? linkedJobId() : null));
  /** A selection that came from the ADDRESS and still has to be found: it decides which register page is
   *  shown. Cleared once resolved, so paging away afterwards is the user's business. */
  const [pendingLink, setPendingLink] = useState<string | null>(() => (deepLink ? linkedJobId() : null));
  /** A linked id that is not in the loaded list. It was deleted, or it belongs to another account — the
   *  same answer either way, because the list this page holds IS the authorized one. */
  const [missingLink, setMissingLink] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // Only an admin sees more than one owner's jobs, so only he is offered the scope filter.
  const [scope, setScope] = useState<'all' | 'mine' | 'instance'>('all');
  const [page, setPage] = useState(0);

  // A draft the server has taken is the server's now. Keeping it would resurrect the job as an unsaved
  // row the moment anything else deletes it — and one keystroke there would write it straight back.
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.map((j) => j.id));
    setDrafts((cur) => (cur.some((j) => ids.has(j.id)) ? cur.filter((j) => !ids.has(j.id)) : cur));
  }, [data]);

  const saved = useMemo(() => new Set((data ?? []).map((j) => j.id)), [data]);
  const rows = useMemo(() => [...(data ?? []), ...drafts.filter((j) => !saved.has(j.id))], [data, drafts, saved]);
  const active = rows.filter((j) => j.enabled !== false).length;
  const lastRun = rows.reduce<number | null>((newest, j) => {
    const ms = utils.parseTs(j.lastRun);
    return ms != null && (newest == null || ms > newest) ? ms : newest;
  }, null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((j) => {
      if (filter === 'active' && j.enabled === false) return false;
      if (filter === 'paused' && j.enabled !== false) return false;
      if (scope === 'mine' && !(j.ownerUserId != null && j.ownerUserId === myId)) return false;
      if (scope === 'instance' && j.ownerUserId != null) return false;
      if (needle === '') return true;
      return j.name.toLowerCase().includes(needle) || j.schedule.toLowerCase().includes(needle) || j.prompt.toLowerCase().includes(needle);
    });
  }, [rows, query, filter, scope, myId]);
  // A narrowed list can be shorter than the page the user is on; landing on an empty page reads as
  // "nothing matches" when the matches are simply on page 1.
  useEffect(() => { setPage(0); }, [query, filter, scope]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageItems = useMemo(() => filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE), [filtered, clampedPage]);

  /** Open or close a job, and say so in the address when this surface owns one. */
  const select = (id: string | null) => {
    setSelectedId(id);
    setMissingLink(null);
    if (deepLink) writeJobParam(id);
  };

  // Back and forward move through the jobs that were opened. The page stays mounted across them, so the
  // address is the only thing that changed and re-reading it is the whole handler.
  useEffect(() => {
    if (!deepLink) return;
    const follow = () => {
      const id = linkedJobId();
      setSelectedId(id);
      setPendingLink(id);
      setMissingLink(null);
    };
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, [deepLink]);

  // Resolve a linked job against the loaded list: show the page it sits on, reveal it if a filter is
  // hiding it, and report the ones this account cannot see exactly as it reports the deleted ones.
  useEffect(() => {
    if (pendingLink === null || !data) return;
    if (!rows.some((j) => j.id === pendingLink)) {
      setPendingLink(null);
      setSelectedId(null);
      setMissingLink(pendingLink);
      return;
    }
    const at = filtered.findIndex((j) => j.id === pendingLink);
    if (at < 0) { setQuery(''); setFilter('all'); setScope('all'); return; }
    setPage(Math.floor(at / PAGE_SIZE));
    setPendingLink(null);
  }, [pendingLink, data, rows, filtered]);

  const addJob = () => {
    // Same id shape the plugin's own CronAdd tool generates.
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setDrafts((cur) => [...cur, { id, name: '', schedule: 'every 1h', prompt: '', enabled: false, createdAt: new Date().toISOString() }]);
    select(id); // a job the user just added opens straight into its fields
  };
  const dropDraft = (id: string) => {
    setDrafts((cur) => cur.filter((j) => j.id !== id));
    if (selectedId === id) select(null);
  };

  const addButton = <C.Button variant="accent" icon={Plus} onClick={addJob}>{s.addJob}</C.Button>;
  const toolbarFilters = [
    {
      id: 'status',
      label: s.enabled,
      control: (
        <C.Segmented
          value={filter}
          onChange={(value: string) => setFilter(value as Filter)}
          options={[{ value: 'all', label: s.filterAll }, { value: 'active', label: s.filterActive }, { value: 'paused', label: s.filterPaused }]}
          aria-label={s.enabled}
        />
      ),
      ...(filter === 'all'
        ? { active: false as const }
        : { active: true as const, activeLabel: `${s.enabled}: ${filter === 'active' ? s.filterActive : s.filterPaused}`, onReset: () => setFilter('all') }),
    },
    ...(isAdmin ? [{
      id: 'owner',
      label: s.ownerColumn,
      control: (
        <C.Segmented
          value={scope}
          onChange={(value: string) => setScope(value as 'all' | 'mine' | 'instance')}
          options={[{ value: 'all', label: s.filterAll }, { value: 'mine', label: s.filterMine }, { value: 'instance', label: s.filterInstance }]}
          aria-label={s.ownerColumn}
        />
      ),
      ...(scope === 'all'
        ? { active: false as const }
        : { active: true as const, activeLabel: `${s.ownerColumn}: ${scope === 'mine' ? s.filterMine : s.filterInstance}`, onReset: () => setScope('all') }),
    }] : []),
  ];

  const table = (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Three tracks compact: the job name, the save state and the chevron. The switch column is dropped
          there because at 320px the row has ~194px to spend and its track plus the gap left the `1fr`
          name column about three characters of the value that identifies the row. Nothing is lost: the
          state travels as the paused badge and the screen-reader text inside the name cell at every
          width, and the editor carries the same switch one tap away. The save state stays, because the
          retry it offers after the editor was closed exists nowhere else. */}
      <C.DataTable
        ariaLabel={s.title}
        columns={isAdmin ? '2.75rem minmax(0,1fr) 9.5rem minmax(0,12rem) 7rem 4.5rem 1.25rem' : '2.75rem minmax(0,1fr) 9.5rem 7rem 4.5rem 1.25rem'}
        compactColumns="minmax(0,1fr) 4.5rem 1.25rem"
      >
        <C.DataTableRow header>
          {/* The switch column carries an operable control, so it is named rather than hidden — with the
              name for assistive technology alone, the way the save-state column below is: the switches
              speak for themselves on screen and a second visible "Enabled" would head a column of them. */}
          <C.DataTableCell header lines={1} priority="wide" labelHidden>{s.enabled}</C.DataTableCell>
          <C.DataTableCell header lines={1}>{s.name}</C.DataTableCell>
          <C.DataTableCell header lines={1} priority="wide">{s.schedule}</C.DataTableCell>
          {isAdmin ? <C.DataTableCell header lines={1} priority="wide">{s.channel}</C.DataTableCell> : null}
          <C.DataTableCell header lines={1} priority="wide" className="whitespace-nowrap">{s.colLastRun}</C.DataTableCell>
          {/* The save-state column holds an autosave indicator AND its Retry button, so its content is
              both announced and operable — a presentational header left that content in a column with no
              name and made the header row one column shorter than every body row. It carries no visible
              label because the indicator speaks for itself on screen, which is what `labelHidden` is for.
              (The chevron below is hidden on BOTH sides, so it stays symmetrical.) */}
          <C.DataTableCell header lines={1} labelHidden>{s.colSaveState}</C.DataTableCell>
          <C.DataTableCell header lines={1} aria-hidden>{null}</C.DataTableCell>
        </C.DataTableRow>
        {pageItems.map((job) => (
          <CronJobRow
            key={job.id}
            job={job}
            persisted={saved.has(job.id)}
            ownerLabel={isAdmin ? (job.ownerUserId == null ? s.ownerInstance : `#${job.ownerUserId}`) : null}
            adminFields={isAdmin}
            myId={myId}
            destinations={destinations.data ?? []}
            models={models.data ?? []}
            selected={selectedId === job.id}
            onSelect={() => select(job.id)}
            onClose={() => select(null)}
            onRemoved={dropDraft}
            onRefresh={refetch}
          />
        ))}
      </C.DataTable>

      <C.Pager page={clampedPage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} ariaLabel={s.title} />
    </div>
  );

  const surfaceDocument = (
    <C.ControlSurfaceDocument>
      <C.ControlSurfaceToolbar
        search={<C.RegisterSearch value={query} onChange={setQuery} placeholder={s.searchPlaceholder} label={s.searchPlaceholder} />}
        filters={toolbarFilters}
        actions={surface === 'deck' ? addButton : undefined}
      />
      {isError ? <C.ControlSurfaceState tone="danger"><C.ErrorState message={t.common.daemonUnreachable} onRetry={() => refetch()} /></C.ControlSurfaceState>
        : isLoading || !data ? <C.ControlSurfaceState><C.LoadingState variant="cards" /></C.ControlSurfaceState>
        : (
          <div className="flex min-w-0 flex-col gap-4">
            {/* A link to a job this account cannot open. Deleted and foreign are the same answer: the
                list already IS the authorized one, so naming which of the two it was would answer a
                question about somebody else's schedule. */}
            {missingLink ? (
              <div role="status" className="flex flex-col gap-0.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                <span className="font-medium text-destructive">{s.linkUnavailable}</span>
                <span className="text-muted-foreground">{s.linkUnavailableHint}</span>
              </div>
            ) : null}
            <C.ControlSurfaceRegister className="flex flex-col gap-4">
              {rows.length === 0
                ? <C.EmptyState title={s.empty} icon={Clock} action={addButton} />
                : filtered.length === 0
                  ? <C.EmptyState title={s.emptySearch} icon={Search} />
                  : table}
            </C.ControlSurfaceRegister>
          </div>
        )}
    </C.ControlSurfaceDocument>
  );

  // In the Settings deck the surrounding panel supplies the page frame; on its own page the section
  // draws the whole frame itself, which is why the bundle declares `jobs` in `ownsPageFrame`.
  if (surface === 'deck') return surfaceDocument;
  return (
    <C.WorkspaceShell
      variant="register"
      hero={{
        eyebrow: s.workspaceEyebrow,
        title: s.title,
        count: rows.length,
        description: s.sectionHint,
        mascot: isLoading ? 'saving' : isError ? 'error' : 'idle',
        status: !isLoading && !isError ? <span className="workspace-status">{s.workspaceReady}</span> : undefined,
        action: addButton,
        metrics: <>
          <C.WorkspaceMetric label={s.metricActive} value={active} icon={Activity} />
          <C.WorkspaceMetric label={s.metricPaused} value={rows.length - active} icon={PauseCircle} />
          <C.WorkspaceMetric label={s.colLastRun} value={lastRun != null ? utils.compactElapsed(Date.now() - lastRun) : '—'} icon={Timer} />
        </>,
      }}
    >
      {surfaceDocument}
    </C.WorkspaceShell>
  );
}
