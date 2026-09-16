import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Boxes, CalendarClock, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Clock, Layers, PauseCircle, Plus, Repeat, User, XCircle } from 'lucide-react';
import { CalendarTab, shiftDate } from './CalendarTab';
import { CreateJobDialog } from './CreateJobDialog';
import { HistoryTab } from './HistoryTab';
import { JobDrawer } from './JobDrawer';
import { runtime, type CronJob, type CronWeekResponse } from './runtime';

/** One entry of a filter picker: the value behind it, the word the option and its chip show, and the
 *  glyph the option carries. The same shape the Sites register hands its pickers. */
type FilterOption = { value: string; label: string; icon: ReactNode };

const parseDate = (label: string): Date => {
  const [year, month, day] = label.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const jobParam = (): string | null => {
  const value = new URLSearchParams(window.location.search).get('job');
  return value?.trim() || null;
};
const writeJobParam = (id: string | null) => {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('job', id);
  else url.searchParams.delete('job');
  window.history.pushState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
};

export function AutomationPage() {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { locale } = hooks.useTranslation();
  const me = hooks.useMe();
  const mobile = hooks.useMobile();
  const destinations = hooks.useNotificationDestinations();
  const models = hooks.useBrainModels();
  const save = hooks.useSaveCronJob();
  const queryClient = hooks.useQueryClient();

  const [tab, setTab] = useState<'calendar' | 'history'>('calendar');
  const [view, setView] = useState<'day' | 'week'>('week');
  const [start, setStart] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [meta, setMeta] = useState<CronWeekResponse | null>(null);
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState<'all' | 'mine' | 'instance'>('all');
  const [state, setState] = useState<'all' | 'active' | 'paused'>('all');
  const [kind, setKind] = useState<'all' | 'fixed' | 'interval' | 'oneShot'>('all');
  const [outcome, setOutcome] = useState<'all' | 'ok' | 'error' | 'skipped'>('all');
  const [range, setRange] = useState<'today' | '7' | '30'>('7');
  /** What the create dialog is being opened FOR: which lifecycle, and — when the calendar itself asked —
   *  on which day, so a click on a cell arrives in the dialog as that cell's date. */
  const [opening, setOpening] = useState<{ lifecycle: 'oneShot' | 'recurring'; date?: string } | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(jobParam());
  const [missingLink, setMissingLink] = useState(false);

  useEffect(() => { if (mobile) setView('day'); }, [mobile]);
  const jobs = useMemo(() => new Map((meta?.jobs ?? []).map((job) => [job.id, job])), [meta?.jobs]);
  useEffect(() => {
    if (!meta || !openJobId) return;
    setMissingLink(!jobs.has(openJobId));
  }, [jobs, meta, openJobId]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['cron-week'] });
    void queryClient.invalidateQueries({ queryKey: ['cron-runs-day'] });
    void queryClient.invalidateQueries({ queryKey: ['cron-runs-history'] });
  }, [queryClient]);
  const openJob = useCallback((id: string) => {
    setOpenJobId(id);
    setMissingLink(false);
    writeJobParam(id);
  }, []);
  const closeJob = useCallback(() => {
    setOpenJobId(null);
    setMissingLink(false);
    writeJobParam(null);
  }, []);
  const runJob = useCallback(async (job: CronJob) => {
    await runtime().api(`/plugins/cronjob/jobs/${encodeURIComponent(job.id)}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID(), expectedRevision: job.revision ?? 0 }),
    });
    invalidate();
  }, [invalidate]);
  const toggleJob = useCallback((job: CronJob) => {
    save.mutate({ ...job, enabled: job.enabled === false, expectedRevision: job.revision ?? 0 }, {
      onSuccess: invalidate,
    });
  }, [invalidate, save]);
  const onData = useCallback((data: CronWeekResponse) => { setMeta(data); }, []);
  const shiftWindow = useCallback((amount: number) => {
    const base = meta?.window.startLocalDate ?? start;
    if (base) setStart(shiftDate(base, amount));
    setSelectedDate((current) => current ? shiftDate(current, amount) : current);
  }, [meta?.window.startLocalDate, start]);

  const rangeLabel = meta ? new Intl.DateTimeFormat(locale || undefined, {
    day: 'numeric', month: 'short',
    ...(parseDate(meta.window.startLocalDate).getFullYear() !== parseDate(shiftDate(meta.window.endLocalDateExclusive, -1)).getFullYear()
      ? { year: 'numeric' as const }
      : {}),
  }).formatRange(parseDate(meta.window.startLocalDate), parseDate(shiftDate(meta.window.endLocalDateExclusive, -1))) : '…';

  // Every filter is one picker with a glyph per option, neutral FIRST, exactly as on the Sites page.
  // A chip prints the option's LABEL rather than the raw value behind it, so `oneShot` never reads as a
  // key and the period chip never reads as `7`.
  const labelOf = (options: FilterOption[], value: string): string =>
    options.find((option) => option.value === value)?.label ?? value;
  const selectFilter = <T extends string>(value: T, onChange: (next: T) => void, options: FilterOption[], label: string) => (
    <C.SelectMenu value={value} onChange={(next: string) => onChange(next as T)} options={options} label={label} />
  );
  const ownerOptions: FilterOption[] = [
    { value: 'all', label: s.filterAll, icon: <Layers size={14} /> },
    { value: 'mine', label: s.filterMine, icon: <User size={14} /> },
    { value: 'instance', label: s.filterInstance, icon: <Boxes size={14} /> },
  ];
  const stateOptions: FilterOption[] = [
    { value: 'all', label: s.filterAll, icon: <Layers size={14} /> },
    { value: 'active', label: s.metricActive, icon: <CheckCircle2 size={14} /> },
    { value: 'paused', label: s.paused, icon: <PauseCircle size={14} /> },
  ];
  const kindOptions: FilterOption[] = [
    { value: 'all', label: s.filterAll, icon: <Layers size={14} /> },
    { value: 'fixed', label: s.kindFixed || 'Fixed time', icon: <Clock size={14} /> },
    { value: 'interval', label: s.kindInterval || 'Interval', icon: <Repeat size={14} /> },
    { value: 'oneShot', label: s.badgeOneShot, icon: <CalendarClock size={14} /> },
  ];
  const outcomeOptions: FilterOption[] = [
    { value: 'all', label: s.filterAll, icon: <Layers size={14} /> },
    { value: 'ok', label: s.runOk, icon: <CheckCircle2 size={14} /> },
    { value: 'error', label: s.runErrorState, icon: <XCircle size={14} /> },
    { value: 'skipped', label: s.runSkipped, icon: <CircleDashed size={14} /> },
  ];
  // The period axis has no "any period" value to add: its neutral is the 7 days the page loads with, so
  // it comes first and carries `Layers` like every other neutral. The two periods that ARE narrowing get
  // the page's own `CalendarDays`.
  const rangeOptions: FilterOption[] = [
    { value: '7', label: s.range7 || '7 days', icon: <Layers size={14} /> },
    { value: 'today', label: s.rangeToday || 'Today', icon: <CalendarDays size={14} /> },
    { value: '30', label: s.range30 || '30 days', icon: <CalendarDays size={14} /> },
  ];

  const calendarFields = [
    ...(me.data?.user?.is_admin ? [{
      id: 'owner', label: s.filterOwner || 'Owner',
      control: selectFilter(owner, setOwner, ownerOptions, s.filterOwner || 'Owner'),
      ...(owner !== 'all' ? { active: true, activeLabel: `${s.filterOwner}: ${labelOf(ownerOptions, owner)}`, onReset: () => setOwner('all') } : { active: false }),
    }] : []),
    {
      id: 'state', label: s.filterState || 'Status',
      control: selectFilter(state, setState, stateOptions, s.filterState || 'Status'),
      ...(state !== 'all' ? { active: true, activeLabel: `${s.filterState}: ${labelOf(stateOptions, state)}`, onReset: () => setState('all') } : { active: false }),
    },
    {
      id: 'kind', label: s.filterKind || 'Type',
      control: selectFilter(kind, setKind, kindOptions, s.filterKind || 'Type'),
      ...(kind !== 'all' ? { active: true, activeLabel: `${s.filterKind}: ${labelOf(kindOptions, kind)}`, onReset: () => setKind('all') } : { active: false }),
    },
  ];
  const historyFields = [
    ...(me.data?.user?.is_admin ? calendarFields.slice(0, 1) : []),
    {
      id: 'outcome', label: s.filterOutcome || 'Outcome',
      control: selectFilter(outcome, setOutcome, outcomeOptions, s.filterOutcome || 'Outcome'),
      ...(outcome !== 'all' ? { active: true, activeLabel: `${s.filterOutcome}: ${labelOf(outcomeOptions, outcome)}`, onReset: () => setOutcome('all') } : { active: false }),
    },
    {
      id: 'range', label: s.filterRange || 'Range',
      control: selectFilter(range, setRange, rangeOptions, s.filterRange || 'Range'),
      ...(range !== '7' ? { active: true, activeLabel: `${s.filterRange}: ${labelOf(rangeOptions, range)}`, onReset: () => setRange('7') } : { active: false }),
    },
  ];

  const dateNavigator = tab === 'calendar' ? (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="cron-date-navigator">
      <C.IconButton icon={ChevronLeft} label={s.weekPrev || 'Previous week'} onClick={() => shiftWindow(-7)} />
      <C.IconButton icon={ChevronRight} label={s.weekNext || 'Next week'} onClick={() => shiftWindow(7)} />
      <C.Button variant="ghost" onClick={() => { setStart(null); setSelectedDate(null); }}>{s.calToday}</C.Button>
      <span aria-live="polite" className="min-w-28 text-center text-sm font-semibold">{rangeLabel}</span>
      {!mobile ? <C.Segmented value={view} onChange={setView} options={[
        { value: 'day', label: s.viewDay || 'Day' }, { value: 'week', label: s.viewWeek || 'Week' },
      ]} aria-label={s.viewWeek || 'Calendar view'} /> : null}
    </div>
  ) : undefined;

  const createMenu = (
    <C.ActionMenu
      variant="kebab"
      align="right"
      label={s.newTask || 'New task'}
      trigger={<span className="inline-flex items-center gap-2"><Plus size={15} aria-hidden />{s.newTask || 'New task'}</span>}
      triggerClassName="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[var(--touch-target)]"
      items={[
        { id: 'recurring', label: s.createRecurring, icon: Repeat, onSelect: () => setOpening({ lifecycle: 'recurring' }) },
        { id: 'oneShot', label: s.createOneShot, icon: CalendarClock, onSelect: () => setOpening({ lifecycle: 'oneShot' }) },
      ]}
      testId="cron-new-task-menu"
    />
  );

  const selectedJob = openJobId ? jobs.get(openJobId) : undefined;
  return (
    <>
      <C.WorkspaceShell
        variant="register"
        hero={{
          eyebrow: s.workspaceEyebrow,
          title: s.workspaceTitle,
          description: s.sectionHint,
          icon: CalendarClock,
          action: createMenu,
          status: meta ? <span className="workspace-status">{meta.timezone}</span> : undefined,
        }}
        navigation={{
          sections: [
            { id: 'calendar', label: s.tabCalendar || 'Calendar', icon: CalendarDays },
            { id: 'history', label: s.tabHistory || 'History', icon: Clock },
          ],
          value: tab,
          onChange: (next: string) => setTab(next as 'calendar' | 'history'),
          ariaLabel: s.workspaceTitle,
        }}
        toolbar={{
          search: <C.RegisterSearch value={query} onChange={setQuery} onClear={() => setQuery('')} placeholder={s.searchPlaceholder} count={meta?.jobs.length ?? 0} />,
          filters: tab === 'calendar' ? calendarFields : historyFields,
          children: dateNavigator,
        }}
      >
        {missingLink ? (
          <div role="status" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {s.linkUnavailableHint}
          </div>
        ) : null}
        {tab === 'calendar' ? (
          <CalendarTab
            start={start}
            selectedDate={selectedDate}
            view={view}
            query={query}
            owner={owner}
            state={state}
            kind={kind}
            onSelectedDate={setSelectedDate}
            onData={onData}
            onWindowShift={shiftWindow}
            onOpenJob={openJob}
            onRun={(job) => void runJob(job)}
            onToggle={toggleJob}
            onAddAt={(date) => setOpening({ lifecycle: 'oneShot', date })}
          />
        ) : (
          <HistoryTab
            query={query}
            owner={owner}
            outcome={outcome}
            range={range}
            todayLocalDate={meta?.todayLocalDate ?? new Date().toISOString().slice(0, 10)}
            jobs={jobs}
            onOpenJob={openJob}
            onRun={(job) => void runJob(job)}
          />
        )}
      </C.WorkspaceShell>
      {opening ? (
        <CreateJobDialog
          lifecycle={opening.lifecycle}
          {...(opening.date ? { initialDate: opening.date } : {})}
          myId={me.data?.user?.id ?? null}
          isAdmin={me.data?.user?.is_admin === true}
          onClose={() => setOpening(null)}
          onCreated={(created) => { setOpening(null); invalidate(); openJob(created.id); }}
        />
      ) : null}
      {selectedJob ? (
        <JobDrawer
          job={selectedJob}
          myId={me.data?.user?.id ?? null}
          adminFields={me.data?.user?.is_admin === true}
          destinations={destinations.data ?? []}
          models={models.data ?? []}
          onClose={closeJob}
          onRemoved={() => { closeJob(); invalidate(); }}
          onRefresh={invalidate}
          onRunQueued={invalidate}
        />
      ) : null}
    </>
  );
}
