/** The Automation calendar workbench: ONE summary query drives the month grid and the selected-day
 *  agenda, and every recurrence, local-time, DST, active-hours and catch-up answer comes from the
 *  server engine the scheduler ticks with — never from a browser copy of the grammar.
 *
 *  The scheduler's own wall clock ("today") is the SERVER's answer (`todayLocalDate`); the browser
 *  starts from its own date only until the first summary lands, then adopts it once and never loops. */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { AgendaView } from './AgendaView';
import { CreateJobDialog } from './CreateJobDialog';
import { JobDrawer } from './JobDrawer';
import {
  runtime, localDateLabel, apiErrorCode,
  type CalendarDayButtonProps, type CronCalendarDay, type CronCalendarResponse, type CronOccurrence,
} from './runtime';

/** How many local dates the Agenda view and the phone read forward from the selected day. */
const AGENDA_WINDOW_DAYS = 7;
/** The fast cadence after an accepted run-now, and the cap it falls back from. */
const RUN_WATCH_MS = 2_000;
const RUN_WATCH_CAP_MS = 120_000;

export function CalendarPage() {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { t } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const me = hooks.useMe();
  const myId = me.data?.user?.id ?? null;
  const isAdmin = me.data?.user?.is_admin === true;
  const destinations = hooks.useNotificationDestinations();
  const models = hooks.useBrainModels();
  const mobile = hooks.useMobile();

  /** The browser date the very first window uses; once the server states its today, this is IT. */
  const [today, setToday] = useState<string>(() => localDateLabel(new Date()));
  const [monthState, setMonthState] = useState(() => monthOf(today));
  /** An authoritative selection: always a local date, never cleared by a view switch. */
  const [selected, setSelected] = useState<string>(today);
  const [view, setView] = useState<'month' | 'agenda'>('month');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'mine' | 'instance'>('all');
  const [opening, setOpening] = useState<'oneShot' | 'recurring' | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [missingLink, setMissingLink] = useState<string | null>(null);
  // Mobile keeps ONE date chooser behind a `Date` button; no creation flow ever nests inside it.
  const [datePaneOpen, setDatePaneOpen] = useState(false);

  const queryClient = hooks.useQueryClient();
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ['cron-calendar'] }); };

  const scopeParam = scope === 'all' ? undefined : scope === 'mine' ? 'personal' : 'instance';
  const monthStart = `${String(monthState.year).padStart(4, '0')}-${String(monthState.month).padStart(2, '0')}-01`;
  const monthDays = daysInMonth(monthState.year, monthState.month);

  // A run-now accepted by the server: refetch every 2s until the queued request LEAVES the projection,
  // capped at two minutes. Nothing else arms it — a create or a delete has no queued work to watch.
  const [runWatch, setRunWatch] = useState<{ until: number; sawQueued: boolean } | null>(null);

  const summary = hooks.useQuery<CronCalendarResponse>({
    queryKey: ['cron-calendar', 'summary', monthStart, monthDays, scope],
    queryFn: () => runtime().api(calendarUrl('summary', monthStart, monthDays, scopeParam)) as Promise<CronCalendarResponse>,
    staleTime: 15_000,
    refetchInterval: runWatch !== null ? RUN_WATCH_MS : 30_000,
    refetchIntervalInBackground: false,
  });

  // Adopt the scheduler's wall clock ONCE: the first summary carries `todayLocalDate`, and the month
  // plus the selection move to it without a second sync (refetches may not re-own the surface).
  const [syncedToday, setSyncedToday] = useState<string | null>(null);
  useEffect(() => {
    const serverToday = summary.data?.todayLocalDate;
    if (syncedToday !== null || typeof serverToday !== 'string' || !DATE_LABEL.test(serverToday)) return;
    setSyncedToday(serverToday);
    setToday(serverToday);
    setSelected(serverToday);
    setMonthState(monthOf(serverToday));
  }, [summary.data?.todayLocalDate, syncedToday]);

  const jobs = useMemo(() => summary.data?.jobs ?? [], [summary.data?.jobs]);
  const manualQueued = useMemo(() => jobs.some((job) => job.manualQueued === true), [jobs]);
  // The watch ends when the request the run armed has been SEEN queued and then seen gone — the tick
  // claimed it. Two minutes is the ceiling, not the expected duration.
  useEffect(() => {
    if (runWatch === null) return;
    if (manualQueued && !runWatch.sawQueued) { setRunWatch({ ...runWatch, sawQueued: true }); return; }
    if (!manualQueued && runWatch.sawQueued) setRunWatch(null);
  }, [manualQueued, runWatch]);
  useEffect(() => {
    if (runWatch === null) return;
    const stop = window.setTimeout(() => setRunWatch(null), Math.max(0, runWatch.until - Date.now()));
    return () => window.clearTimeout(stop);
  }, [runWatch]);

  // The agenda window: the month side panel reads ONE day; the Agenda view and a phone read up to
  // seven local dates from the selected day onwards. The selection survives every mode switch.
  const agendaView = mobile || view === 'agenda';
  const agendaDays = agendaView ? AGENDA_WINDOW_DAYS : 1;
  const agenda = hooks.useQuery<CronCalendarResponse>({
    queryKey: ['cron-calendar', 'agenda', selected, scope, agendaDays],
    queryFn: () => runtime().api(calendarUrl('agenda', selected, agendaDays, scopeParam)) as Promise<CronCalendarResponse>,
    staleTime: 15_000,
  });

  // Agenda pagination: the server hands out an opaque cursor bound to the snapshot it expanded. Pages
  // are appended in order; a snapshot that moved under the reader restarts at page one instead of
  // stitching two schedule states together. `>100 occurrences` is never silently dropped.
  const [morePages, setMorePages] = useState<{ occurrences: CronOccurrence[]; nextCursor?: string } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const agendaSnapshot = agenda.data?.snapshot;
  useEffect(() => { setMorePages(null); }, [agendaSnapshot, selected, scope, agendaDays]);
  const nextCursor = morePages !== null ? morePages.nextCursor : agenda.data?.nextCursor;
  const loadMore = async () => {
    if (loadingMore || agendaSnapshot === undefined || nextCursor === undefined) return;
    setLoadingMore(true);
    try {
      const page = await runtime().api(
        calendarUrl('agenda', selected, agendaDays, scopeParam, { cursor: nextCursor, snapshot: agendaSnapshot }),
      ) as CronCalendarResponse;
      setMorePages((cur) => ({
        occurrences: [...(cur?.occurrences ?? []), ...(page.occurrences ?? [])],
        nextCursor: page.nextCursor,
      }));
    } catch (error) {
      if (apiErrorCode(error) === 'snapshot_changed') {
        setMorePages(null);
        agenda.refetch();
        toast(s.calAgendaTruncated, 'ok');
      } else {
        toast(`${s.calAgendaMore} — ${utils.apiErrorMessage(error)}`, 'error');
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const goToday = () => {
    setMonthState(monthOf(today));
    setSelected(today);
  };

  const selectJob = (jobId: string) => {
    setOpenJobId(jobId);
    setMissingLink(null);
    writeJobParam(jobId);
  };
  const closeJob = () => {
    setOpenJobId(null);
    writeJobParam(null);
  };

  // Deep links: `/p/cronjob?job=<id>` opens the job it names when the loaded list carries it; deleted
  // and foreign ids arrive at the SAME unavailable state, the list already IS the authorized one.
  const [pendingLink] = useState<string | null>(() => jobIdParam());
  useEffect(() => {
    if (pendingLink === null || !summary.data) return;
    if (summary.data.jobs.some((job) => job.id === pendingLink)) setOpenJobId(pendingLink);
    else setMissingLink(pendingLink);
    // The resolver runs once against the loaded list; the selection afterwards is the reader's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLink, summary.data]);

  const filteredJobs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return jobs.filter((job) => {
      if (scope === 'mine' && !(job.ownerUserId != null && job.ownerUserId === myId)) return false;
      if (scope === 'instance' && job.ownerUserId != null) return false;
      if (needle === '') return true;
      return (job.name ?? '').toLowerCase().includes(needle)
        || (job.schedule ?? '').toLowerCase().includes(needle)
        || (job.prompt ?? '').toLowerCase().includes(needle);
    });
  }, [jobs, query, scope, myId]);
  const filteredIds = useMemo(() => new Set(filteredJobs.map((j) => j.id)), [filteredJobs]);
  const agendaOccurrences = useMemo(
    () => [...(agenda.data?.occurrences ?? []), ...(morePages?.occurrences ?? [])]
      .filter((occurrence) => filteredIds.has(occurrence.jobId)),
    [agenda.data?.occurrences, morePages, filteredIds],
  );

  // A one-shot may delete itself between the click and the next refetch; a job may also become
  // invisible to a scope change. Both arrive at the same unavailable state as a stale deep link:
  // never render a drawer over an undefined record.
  const openJob = openJobId !== null ? jobs.find((job) => job.id === openJobId) : undefined;
  const jobVanished = openJobId !== null && Boolean(summary.data) && !openJob;

  const sampleDays = useMemo(
    () => new Map((summary.data?.days ?? []).map((day) => [day.date, day])),
    [summary.data?.days],
  );
  const ledger = useMemo(() => ({ days: sampleDays, strings: s }), [sampleDays, s]);

  // The mobile day strip: seven days from the selected one, 44px buttons, previous/next controls —
  // agenda-first, never a squeezed seven-column month grid.
  const stripDates = useMemo(
    () => Array.from({ length: AGENDA_WINDOW_DAYS }, (_unused, index) => addDays(selected, index)),
    [selected],
  );
  const stripShift = (weeks: number) => setSelected(addDays(selected, weeks * AGENDA_WINDOW_DAYS));

  // One toolbar: the month grid's Today and the two views, search, and the admin scope filter.
  const toolbar = (
    <div className="flex min-w-0 flex-wrap items-center gap-2 pb-2" data-testid="cron-toolbar">
      <C.Button variant="outline" onClick={goToday}>{s.calToday}</C.Button>
      {!mobile ? (
        <C.Segmented
          value={view}
          onChange={(next: string) => setView(next === 'agenda' ? 'agenda' : 'month')}
          options={[
            { value: 'month', label: s.calMonthLabel },
            { value: 'agenda', label: s.calAgendaHeading },
          ]}
          aria-label={s.calViewTitle}
        />
      ) : null}
      <C.Input value={query} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder={s.searchPlaceholder} aria-label={s.searchPlaceholder} className="min-w-40 max-w-64" />
      {isAdmin ? (
        <C.Segmented
          value={scope}
          onChange={(next: string) => setScope(next as 'all' | 'mine' | 'instance')}
          options={[
            { value: 'all', label: s.filterAll },
            { value: 'mine', label: s.filterMine },
            { value: 'instance', label: s.filterInstance },
          ]}
          aria-label={s.ownerColumn}
        />
      ) : null}
    </div>
  );

  const oneShotButton = (
    <C.Button variant="accent" onClick={() => setOpening('oneShot')} disabled={opening !== null}>
      {s.createOneShot}
    </C.Button>
  );
  const recurringButton = (
    <C.Button variant="outline" onClick={() => setOpening('recurring')} disabled={opening !== null}>
      {s.createRecurring}
    </C.Button>
  );

  const runningStatus = summary.data?.scheduler.ready && summary.data.scheduler.runningJobId
    ? ` · ${s.runningSince.replace('{t}', utils.compactElapsed(Date.now() - Date.parse(summary.data.scheduler.runningSince ?? summary.data.generatedAt)))}`
    : null;

  /** The agenda list plus its own truthful "there is more" affordance, shared by every surface. */
  const agendaBlock = (
    <>
      <AgendaView occurrences={agendaOccurrences} jobs={filteredJobs} onOpen={selectJob} />
      {nextCursor !== undefined ? (
        <div className="flex min-w-0 flex-col gap-1" data-testid="cron-agenda-more">
          <span role="status" className="text-xs text-muted-foreground">{s.calAgendaTruncated}</span>
          <C.Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>{s.calAgendaMore}</C.Button>
        </div>
      ) : null}
    </>
  );

  const body = summary.isError ? (
    <C.ErrorState message={t.common.daemonUnreachable} onRetry={() => summary.refetch()} />
  ) : !summary.data ? (
    <C.LoadingState variant="cards" />
  ) : jobs.length === 0 ? (
    <C.EmptyState
      title={s.calEmptyTitle}
      description={s.calEmptyHint}
      icon={CalendarDays}
      action={scope === 'all' && query === '' ? (
        <span className="flex flex-wrap items-center gap-2">{recurringButton}{oneShotButton}</span>
      ) : undefined}
    />
  ) : (
    <div className="flex min-w-0 flex-col gap-3" aria-busy={summary.isLoading} data-testid="cron-calendar-body">
      {toolbar}
      {missingLink || jobVanished ? (
        <div role="status" className="flex flex-col gap-0.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          <span className="font-medium text-destructive">{s.linkUnavailable}</span>
          <span className="text-muted-foreground">{s.linkUnavailableHint}</span>
        </div>
      ) : null}
      {summary.data.truncated ? (
        <div role="status" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          <span className="font-medium text-destructive">{s.calTruncated}</span>
          <span className="block text-muted-foreground">{s.calTruncatedHint}</span>
        </div>
      ) : null}
      {/* On a phone or coarse pointer the month grid NEVER squeezes in: the day strip selects, the
          agenda follows. The full grid lives inside the Date chooser. */}
      {mobile ? (
        <>
          <div className="flex min-w-0 items-center justify-center gap-2" data-testid="cron-day-strip">
            <C.Button variant="ghost" icon={ChevronLeft} aria-label={s.calPrevWeek} className="size-11 shrink-0" onClick={() => stripShift(-1)} />
            <div className="flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto">
              {stripDates.map((label) => {
                const info = sampleDays.get(label);
                return (
                  <button
                    key={label}
                    type="button"
                    className="min-h-[44px] min-w-[44px] shrink-0 snap-start rounded-md border border-border bg-document px-2 py-1 text-center"
                    aria-pressed={label === selected}
                    aria-label={s.calDayAria.replace('{date}', label).replace('{count}', String(info?.total ?? 0))}
                    onClick={() => setSelected(label)}
                  >
                    <span className={`text-xs tabular-nums ${info?.total ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{Number(label.slice(8, 10))}</span>
                    <span className="block text-[10px] leading-tight text-muted-foreground">{info ? `${info.total}` : '·'}</span>
                  </button>
                );
              })}
            </div>
            <C.Button variant="ghost" icon={ChevronRight} aria-label={s.calNextWeek} className="size-11 shrink-0" onClick={() => stripShift(1)} />
          </div>
          <div aria-live="polite" className="text-sm font-medium text-foreground">{formatLocalDay(selected)}</div>
          {agendaBlock}
        </>
      ) : view === 'agenda' ? (
        /* The Agenda view REPLACES the month grid: one chronological list across the whole seven-day
           window, under its own range heading. It is what a dense interval schedule is read in. */
        <div className="flex min-w-0 flex-col gap-2" data-testid="cron-agenda-view">
          <h2 aria-live="polite" className="text-sm font-medium text-foreground" data-testid="cron-agenda-range">
            {s.calAgendaRange
              .replace('{from}', formatLocalDay(selected))
              .replace('{to}', formatLocalDay(addDays(selected, AGENDA_WINDOW_DAYS - 1)))}
          </h2>
          {agendaBlock}
        </div>
      ) : (
        <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem] xl:gap-5">
          <div className="min-w-0" data-testid="cron-month-grid">
            <LedgerContext.Provider value={ledger}>
              <C.Calendar
                mode="single"
                selected={parseDate(selected)}
                onSelect={(day: Date | undefined) => { if (day) setSelected(localDateLabel(day)); }}
                month={parseDate(monthStart)}
                onMonthChange={(next: Date) => setMonthState(monthOf(localDateLabel(next)))}
                showOutsideDays={false}
                aria-label={s.calMonthLabel}
                components={CALENDAR_COMPONENTS}
                className="w-full bg-transparent p-0"
                classNames={LEDGER_CLASSNAMES}
              />
            </LedgerContext.Provider>
          </div>
          <aside className="flex min-w-0 flex-col gap-2 border-t border-border pt-3 xl:border-t-0 xl:pt-0" aria-label={s.calAgendaHeading}>
            <div aria-live="polite" className="text-sm font-medium text-foreground">{formatLocalDay(selected)}</div>
            {agendaBlock}
          </aside>
        </div>
      )}
    </div>
  );

  return (
    <>
      <C.ModuleHeader title={s.calModuleTitle} icon={CalendarDays} />
      <C.WorkspacePage>
        <C.WorkspaceHero
          eyebrow={s.workspaceEyebrow}
          title={s.workspaceTitle}
          icon={CalendarDays}
          description={s.calDescription}
          status={summary.data ? (
            <span className="workspace-status" data-testid="cron-calendar-timezone">
              {summary.data.timezone}{runningStatus}
            </span>
          ) : undefined}
          action={(
            <span className="flex flex-wrap items-center gap-2">
              {mobile ? <C.Button variant="outline" onClick={() => setDatePaneOpen(true)}>{s.calDatePicker}</C.Button> : null}
              {recurringButton}
              {oneShotButton}
            </span>
          )}
        />
        {body}
      </C.WorkspacePage>
      {opening !== null ? (
        <CreateJobDialog
          lifecycle={opening}
          myId={myId}
          isAdmin={isAdmin}
          onClose={() => setOpening(null)}
          onCreated={(created) => { invalidate(); setOpening(null); selectJob(created.id); }}
        />
      ) : null}
      {openJob ? (
        <JobDrawer
          job={openJob}
          myId={myId}
          adminFields={isAdmin}
          destinations={destinations.data ?? []}
          models={models.data ?? []}
          onClose={closeJob}
          onRemoved={() => { closeJob(); invalidate(); }}
          onRefresh={invalidate}
          onRunQueued={() => setRunWatch({ until: Date.now() + RUN_WATCH_CAP_MS, sawQueued: false })}
        />
      ) : null}
      {summary.data && !summary.data.scheduler.ready ? (
        <p role="status" className="sr-only">{s.schedulerUnavailable}</p>
      ) : null}
      {/* The canonical month chooser lives in ONE host Modal, opened only by `Date`. The host Modal is
          MOUNTED WHEN OPEN — it has no `open` prop — so the mount itself is the open state, and
          nothing else (no creation flow) ever mounts on top of it. */}
      {mobile && datePaneOpen ? (
        <C.Modal
          title={s.calMonthLabel}
          onClose={() => setDatePaneOpen(false)}
          closeLabel={t.common.close}
        >
          <C.ModalBody>
            <C.Calendar
              aria-label={s.calMonthLabel}
              mode="single"
              month={parseDate(monthStart)}
              onMonthChange={(next: Date) => setMonthState(monthOf(localDateLabel(next)))}
              selected={parseDate(selected)}
              onSelect={(day: Date | undefined) => { setDatePaneOpen(false); if (day) setSelected(localDateLabel(day)); }}
            />
          </C.ModalBody>
        </C.Modal>
      ) : null}
    </>
  );
}

// ── the day ledger ────────────────────────────────────────────────────────────────────────────────

/** What the day cells read. It travels through context rather than a closure because the override
 *  below must keep ONE component identity across renders: a function recreated per render is a
 *  different element type, and React would remount every cell — throwing away the focus the arrow
 *  keys had just moved. */
const LedgerContext = createContext<{ days: Map<string, CronCalendarDay>; strings: Record<string, string> }>({
  days: new Map(),
  strings: {},
});

/** The schedule ledger inside one day: the date, at most three ordered local time labels and
 *  `+N more`. Nothing inside is separately interactive — the day button owns selection and the agenda
 *  beside it owns opening, which is what keeps a month of dozens of cramped tab stops from existing.
 *
 *  react-day-picker v9 replaces the day BUTTON itself (`components.DayButton`; v9 has no
 *  `DayContent`), so this component IS the button: every prop the library computed — its classes,
 *  `tabIndex`, accessible name, and the whole keyboard/pointer handler set — has to reach the element,
 *  and `modifiers.focused` has to move real DOM focus exactly as the library's own default does.
 *  Dropping either is what silently breaks arrows, Home/End and PageUp/PageDown. */
function CronDayButton({ day, modifiers, children, 'aria-label': dayName, ...buttonProps }: CalendarDayButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (modifiers.focused) ref.current?.focus(); }, [modifiers.focused]);
  const { days, strings } = useContext(LedgerContext);
  const label = localDateLabel(day.date);
  const info = days.get(label);
  const count = info?.total ?? 0;
  return (
    <button
      ref={ref}
      {...buttonProps}
      aria-label={count > 0 && dayName
        ? strings.calDayAria?.replace('{date}', dayName).replace('{count}', String(count))
        : dayName}
      data-testid={`cron-day-${label}`}
    >
      <span className="flex min-w-0 flex-col items-center gap-0.5">
        <span className="text-xs tabular-nums">{children}</span>
        {(info?.samples ?? []).map((occurrence) => (
          <span
            key={occurrence.id}
            className="max-w-full truncate text-[10px] leading-tight text-muted-foreground group-data-[selected=true]/day:text-primary-foreground"
          >
            {occurrence.localTime}
          </span>
        ))}
        {info && info.overflow > 0 ? (
          <span className="text-[10px] font-medium leading-tight text-primary group-data-[selected=true]/day:text-primary-foreground">
            {strings.calMore?.replace('{n}', String(info.overflow))}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** Declared once, outside the render, so the Calendar never sees a new component type. */
const CALENDAR_COMPONENTS = { DayButton: CronDayButton };

/** The host Calendar is a DATE PICKER by default: a 32px square day, which is the right size for
 *  choosing one date and far too small for a day that also lists what runs on it. A ledger day is a
 *  block, so the cell stops being square and the button grows to its content and fills the cell.
 *
 *  Only geometry is overridden. The state classes (`selected`, `today`, `outside`, `disabled`) reach
 *  the button through its cell in the host primitive and keep working untouched, which is what keeps
 *  the month reading as the host's calendar rather than a plugin repaint. */
const LEDGER_CLASSNAMES = {
  months: 'relative flex w-full flex-col',
  month: 'relative flex w-full flex-col gap-2',
  weekdays: 'flex w-full',
  weekday: 'flex-1 select-none px-1 text-[0.8rem] font-normal text-muted-foreground',
  week: 'mt-1 flex w-full gap-1',
  // `group/day` is the host's own hook for styling a button THROUGH its cell's state; the ledger's
  // muted text has to follow the selected day's foreground or it goes unreadable on the accent.
  day: 'group/day relative h-auto w-full flex-1 select-none p-0 text-center align-top',
  day_button: 'flex min-h-16 w-full cursor-pointer flex-col items-center justify-start gap-0.5 rounded-md border border-transparent p-1 font-normal leading-none transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-[44px]',
};

// ── date helpers: the page works on local calendar labels the SERVER already derived ─────────────
//
// `parseDate` builds at LOCAL midnight and `localDateLabel` reads local fields — one consistent pair.
// A Date built at UTC midnight and read back through local getters lands on the previous day
// everywhere west of UTC, and react-day-picker is local-time as well.
const DATE_LABEL = /^(\d{4})-(\d{2})-(\d{2})$/;
const parseDate = (label: string): Date => {
  const [, y, mo, d] = DATE_LABEL.exec(label) ?? [];
  return new Date(Number(y), Number(mo) - 1, Number(d));
};
const monthOf = (label: string): { year: number; month: number } =>
  ({ year: Number(label.slice(0, 4)), month: Number(label.slice(5, 7)) });
const daysInMonth = (year: number, month: number): number => new Date(year, month, 0).getDate();
/** Calendar-date arithmetic, not 24h arithmetic: a day step across a DST boundary keeps its date. */
const addDays = (label: string, delta: number): string => {
  const base = parseDate(label);
  return localDateLabel(new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta));
};
const formatLocalDay = (label: string): string =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'long', year: 'numeric', day: 'numeric' })
    .format(parseDate(label));

/** The address parameter a conversation's scheduled-jobs branch links to: `/p/cronjob?job=<id>` opens
 *  the workbench on the job it names, selects one job and writes nothing. */
const JOB_PARAM = 'job';
const jobIdParam = (): string | null => {
  const value = new URLSearchParams(window.location.search).get(JOB_PARAM);
  return value && value.trim() !== '' ? value : null;
};
const writeJobParam = (id: string | null): void => {
  const url = new URL(window.location.href);
  if (id === null) url.searchParams.delete(JOB_PARAM);
  else url.searchParams.set(JOB_PARAM, id);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  window.history.pushState(window.history.state, '', next);
};
/** One calendar query URL: every server-read field is explicit, so React Query keys are exact copies. */
const calendarUrl = (
  detail: 'summary' | 'agenda',
  startLabel: string,
  daysCount: number,
  scopeValue: string | undefined,
  page?: { cursor: string; snapshot: string },
): string => {
  const params = new URLSearchParams({ detail, start: startLabel, days: String(daysCount) });
  if (scopeValue) params.set('scope', scopeValue);
  // A cursor always travels with the snapshot it was cut against, so a schedule that moved conflicts
  // out (409) instead of appending occurrences from a different state.
  if (page) { params.set('cursor', page.cursor); params.set('snapshot', page.snapshot); }
  return `/plugins/cronjob/api/calendar?${params.toString()}`;
};
