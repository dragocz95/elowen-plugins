import { useEffect, useRef, useState } from 'react';
import { Check, Hash, MessageSquare, MessagesSquare, X } from 'lucide-react';
import {
  runtime, type BrainModelOption, type CronConversation, type CronConversationOption,
  type CronConversationsResponse, type CronSchedulePreview, type NotificationDestinationOption, type ManageSelectionItem,
} from './runtime';
import {
  WEEKDAYS, builderForMode, parseActiveHours, parseBuilderSchedule, renderActiveHours,
  renderBuilderSchedule, type ScheduleBuilder, type ScheduleMode,
} from './scheduleBuilder';

/** The editor fields one job needs, shared by the drawer's editor and the two creation dialogs: a
 *  conversation filing, a schedule drafted locally and validated by the SERVER, and an active-hours
 *  window. Extraction keeps the recurring creation contract and the in-place editor from drifting —
 *  they must validate exactly alike for the daemon's routes to keep answering both. */

/** Validity of a DRAFT schedule comes from the daemon (schedule-preview): it is the only place that
 *  parses five-field cron. The debounce matches the plan's 300ms; the query is disabled when the
 *  builder already knows a legitimate mode, whose manual controls carry their own truth. */
export function useSchedulePreview(schedule: string | undefined, hours?: string): CronSchedulePreview | undefined {
  const { hooks } = runtime();
  const query = hooks.useQuery<CronSchedulePreview>({
    queryKey: ['cron-schedule-preview', schedule ?? '', hours ?? ''],
    enabled: schedule !== undefined,
    queryFn: async () =>
      runtime().api('/plugins/cronjob/api/schedule-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schedule, hours }), // schedule always a string when enabled
      }) as Promise<CronSchedulePreview>,
    // The draft is typist input: a value 300ms old is what the reader sees, so hold it a beat.
    staleTime: 0,
  });
  return query.data;
}

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
export function ConversationField({ value, saved, unresolved, owner, myId, required, mismatch, onChange }: {
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

export interface ScheduleFieldProps {
  schedule: string;
  onChange: (value: string) => void;
}

/** A draft schedule with ordinary modes first; the raw cron input is validated by the server, never by
 *  a browser copy of the grammar. */
export function ScheduleField({ schedule, onChange }: ScheduleFieldProps) {
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
  // Advanced validity is the daemon's; ordinary modes are rendered by controls that cannot emit an
  // invalid value, so the preview is asked for only there.
  const preview = useSchedulePreview(builder ? undefined : schedule);
  const valid = builder ? true : preview?.valid === true;

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
              invalid={schedule !== '' && preview?.valid === false}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
              {preview === undefined ? null
                : valid
                  ? <Check size={14} className="text-success" aria-label={s.scheduleValid} />
                  : <X size={14} className="text-destructive" aria-label={s.scheduleInvalid} />}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {preview?.error ? `${s.scheduleInvalid}: ${preview.error}` : s.scheduleAdvancedHint}
          </p>
          {schedule !== '' && preview?.valid === true && preview.occurrences.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {s.schedulePreviewNext}{' '}
              {preview.occurrences.slice(0, 3).map((occurrence) => occurrence.localTime).join(', ')} · {preview.timezone}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}


export function ActiveHoursField({ value, onChange }: { value: string | undefined; onChange: (value: string | undefined) => void }) {
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

export { DestinationField };
