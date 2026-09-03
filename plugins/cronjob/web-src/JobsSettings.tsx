import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, CalendarClock, Check, Clock, Hash, MessageSquare, PauseCircle, Play, Plus, Search, Timer, Trash2, X } from 'lucide-react';
import { runtime, type BrainModelOption, type CronJob, type NotificationDestinationOption, type ManageSelectionItem } from './runtime';
import {
  WEEKDAYS, builderForMode, parseActiveHours, parseBuilderSchedule, renderActiveHours,
  renderBuilderSchedule, type ScheduleBuilder, type ScheduleMode,
} from './scheduleBuilder';

/** One page of jobs, matching the register size the built-in workspaces page at. */
const PAGE_SIZE = 20;
type Filter = 'all' | 'active' | 'paused';

const textareaClass = 'w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-ring';

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
  const [confirming, setConfirming] = useState(false);
  const [runPending, setRunPending] = useState(false);
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

  /** A job the daemon's PUT validation would accept — auto-save holds off until the row qualifies, so a
   *  freshly added (still empty) job never fires a 400 toast mid-typing. */
  const isSavable = (j: CronJob): boolean =>
    j.name.trim() !== '' && j.prompt.trim() !== '' && (j.runAt ? true : utils.isValidSchedule(j.schedule));

  const autosave = hooks.useAutoSaveStatus([editVersion], async () => {
    if (deleted.current) return;
    const sent = draftRef.current;
    const { owner: _owner, expectedRevision: _expectedRevision, ...payload } = sent;
    everSaved.current = true;
    const request = save.mutateAsync({ ...payload, expectedRevision: sent.revision ?? 0 });
    inFlight.current = request;
    try {
      await request;
      if (draftRef.current === sent) dirty.current = false; // still clean only if nothing was typed meanwhile
    } catch (error) {
      toast(s.saveError, 'error');
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
  const validSchedule = draft.runAt ? true : utils.isValidSchedule(draft.schedule);
  const lastRunMs = utils.parseTs(job.lastRun);
  const destination = draft.notifyChannelId ? destinations.find((option) => option.value === draft.notifyChannelId) : undefined;
  // An OWNED job has no channel destination at all — it reports in its owner's own conversation and no
  // channel may be set on it, so naming the notification channel here would describe a delivery that
  // never happens. Only an instance job falls back to "default channel".
  const dest = draft.notifyChannelId ? destination?.label ?? draft.notifyChannelId
    : job.ownerUserId != null ? s.channelOwnerChat : null;
  const name = draft.name || s.jobNew;

  return (
    <>
      <C.DataTableRow
        selected={selected}
        aria-selected={selected}
        onOpen={onSelect}
        openLabel={s.openJob.replace('{name}', name)}
        className="group"
      >
        {/* The dot restates in colour what the name cell already carries as the paused badge and as the
            screen-reader text below, so it is decoration — hidden from the accessibility tree together
            with its header, and dropped from the compact layout where its track was width the job name
            needed. */}
        <C.DataTableCell lines="auto" priority="wide" aria-hidden className="flex items-center justify-center">
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${enabled ? 'bg-success' : 'bg-destructive'}`}
            title={enabled ? s.enabled : s.paused}
          />
        </C.DataTableCell>
        <C.DataTableCell lines="auto" title={name} className="flex items-center gap-2">
          <span className="truncate text-sm text-foreground">{name}</span>
          {!enabled ? <C.Badge tone="muted">{s.paused}</C.Badge> : null}
          {/* The state as text, in the column that survives every width: colour alone does not carry it,
              `title` is not reliably announced, and an active job has no badge to speak for it. */}
          <span className="sr-only">{enabled ? s.enabled : s.paused}</span>
        </C.DataTableCell>
        <C.DataTableCell lines="auto" priority="wide" className="whitespace-nowrap">
          <C.Badge tone={validSchedule ? 'default' : 'danger'}>
            {draft.runAt ? <CalendarClock size={10} className="mr-1 inline-block align-[-1px]" aria-hidden /> : <Clock size={10} className="mr-1 inline-block align-[-1px]" aria-hidden />}
            {draft.schedule}
          </C.Badge>
        </C.DataTableCell>
        {ownerLabel !== null ? (
          <C.DataTableCell lines={1} priority="wide" className="text-xs text-muted-foreground">
            {job.owner ? (
              <span className="flex min-w-0 items-center gap-2" title={`${job.owner.name} (#${job.owner.id})`}>
                <C.Avatar name={job.owner.name || job.owner.username} user={job.owner} size={22} />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-xs font-medium text-foreground">{job.owner.name || job.owner.username}</span>
                  <span className="text-[10px] text-muted-foreground">#{job.owner.id}</span>
                </span>
              </span>
            ) : ownerLabel}
          </C.DataTableCell>
        ) : null}
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
            {adminFields ? (
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
            {adminFields ? (
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const addJob = () => {
    // Same id shape the plugin's own CronAdd tool generates.
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setDrafts((cur) => [...cur, { id, name: '', schedule: 'every 1h', prompt: '', enabled: false, createdAt: new Date().toISOString() }]);
    setSelectedId(id); // a job the user just added opens straight into its fields
  };
  const dropDraft = (id: string) => {
    setDrafts((cur) => cur.filter((j) => j.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
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
      {/* Three tracks compact: the job name, the save state and the chevron. The state dot is dropped
          there because at 320px the row has ~194px to spend and its 2rem track plus the gap left the
          `1fr` name column 34px — about three characters of the value that identifies the row. The state
          itself is not lost: it travels as the paused badge and the screen-reader text inside the name
          cell at every width. The save state stays, because the retry it offers after the editor was
          closed exists nowhere else. */}
      <C.DataTable
        ariaLabel={s.title}
        columns={isAdmin ? '2rem minmax(0,1fr) 9.5rem minmax(9rem,11rem) minmax(0,12rem) 7rem 4.5rem 1.25rem' : '2rem minmax(0,1fr) 9.5rem 7rem 4.5rem 1.25rem'}
        compactColumns="minmax(0,1fr) 4.5rem 1.25rem"
      >
        <C.DataTableRow header>
          {/* Presentational, like the dot it heads: the state is announced with the job name instead.
              Both halves are hidden together, or a body row would run one column longer than the header
              and every remaining column would be read against the wrong name. */}
          <C.DataTableCell header lines={1} priority="wide" role="presentation" aria-hidden>{null}</C.DataTableCell>
          <C.DataTableCell header lines={1}>{s.name}</C.DataTableCell>
          <C.DataTableCell header lines={1} priority="wide">{s.schedule}</C.DataTableCell>
          {isAdmin ? <C.DataTableCell header lines={1} priority="wide">{s.ownerColumn}</C.DataTableCell> : null}
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
            onSelect={() => setSelectedId(job.id)}
            onClose={() => setSelectedId(null)}
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
