/** The Automation calendar workbench: ONE summary query drives the month grid and the selected-day
 *  agenda, and every recurrence, local-time, DST, active-hours and catch-up answer comes from the
 *  server engine the scheduler ticks with — never from a browser copy of the grammar. */
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { AgendaView } from './AgendaView';
import { CreateJobDialog } from './CreateJobDialog';
import { JobDrawer } from './JobDrawer';
import { runtime, localDateLabel, type CronCalendarResponse } from './runtime';

export function CalendarPage({ surface }: { surface: 'page' | 'deck' }) {
  const deck = surface === 'deck';
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { t } = hooks.useTranslation();
  const me = hooks.useMe();
  const myId = me.data?.user?.id ?? null;
  const isAdmin = me.data?.user?.is_admin === true;
  const destinations = hooks.useNotificationDestinations();
  const models = hooks.useBrainModels();
  const mobile = hooks.useMobile();
  // The Settings deck renders the compact agenda; only its own page keeps a selection in the address.
  const deepLink = !deck;

  const today = useMemo(() => localDateLabel(new Date()), []);
  const [monthState, setMonthState] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [selected, setSelected] = useState<string | null>(deck ? null : today);
  const [view, setView] = useState<'month' | 'agenda'>('month');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'mine' | 'instance'>('all');
  const [opening, setOpening] = useState<'oneShot' | 'recurring' | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [missingLink, setMissingLink] = useState<string | null>(null);
  // A run-now still queued: 2s refetches for at most two minutes, then the 30s scheduler cadence.
  const [runUntil, setRunUntil] = useState<number | null>(null);
  // Mobile keeps one date pane: agenda first, the month picker inside a single host Modal.
  const [openingDatePane, setOpeningDatePane] = useState<'month' | null>(null);

  const queryClient = hooks.useQueryClient();
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ['cron-calendar'] }); };

  const scopeParam = scope === 'all' ? undefined : scope === 'mine' ? 'personal' : 'instance';
  const monthStart = `${String(monthState.year).padStart(4, '0')}-${String(monthState.month).padStart(2, '0')}-01`;
  const monthDays = new Date(Date.UTC(monthState.year, monthState.month, 0)).getUTCDate();

  const summary = hooks.useQuery<CronCalendarResponse>({
    queryKey: ['cron-calendar', 'summary', monthStart, monthDays, scope],
    queryFn: () => runtime().api(calendarUrl('summary', monthStart, monthDays, scopeParam)) as Promise<CronCalendarResponse>,
    staleTime: 15_000,
    refetchInterval: runUntil !== null ? 2_000 : 30_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (runUntil === null) return;
    const stop = window.setTimeout(() => setRunUntil(null), Math.max(0, runUntil - Date.now()));
    return () => window.clearTimeout(stop);
  }, [runUntil]);

  const agenda = hooks.useQuery<CronCalendarResponse>({
    queryKey: ['cron-calendar', 'agenda', selected, scope],
    enabled: selected !== null,
    queryFn: () => runtime().api(calendarUrl('agenda', selected ?? '', 1, scopeParam, 100)) as Promise<CronCalendarResponse>,
    staleTime: 15_000,
  });

  const stepMonth = (delta: number) => {
    setMonthState((cur) => {
      let year = cur.year; let month = cur.month + delta;
      if (month > 12) { month = 1; year += 1; } else if (month < 1) { month = 12; year -= 1; }
      return { year, month };
    });
  };
  const goToday = () => {
    const label = localDateLabel(new Date());
    setMonthState({ year: Number(label.slice(0, 4)), month: Number(label.slice(5, 7)) });
    setSelected(label);
    setView('agenda');
  };

  const selectJob = (jobId: string) => {
    setOpenJobId(jobId);
    setMissingLink(null);
    if (deepLink) writeJobParam(jobId);
  };
  const closeJob = () => {
    setOpenJobId(null);
    if (deepLink) writeJobParam(null);
  };

  // Deep links: `/p/cronjob?job=<id>` opens the job it names when the loaded list carries it; deleted
  // and foreign ids arrive at the SAME unavailable state, the list already IS the authorized one.
  const [pendingLink] = useState<string | null>(() => (deepLink ? jobIdParam() : null));
  useEffect(() => {
    if (pendingLink === null || !summary.data) return;
    if (summary.data.jobs.some((job) => job.id === pendingLink)) setOpenJobId(pendingLink);
    else setMissingLink(pendingLink);
    // The resolver runs once against the loaded list; the selection afterwards is the reader's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLink, summary.data]);

  const jobs = summary.data?.jobs ?? [];
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
    () => (agenda.data?.occurrences ?? []).filter((o) => filteredIds.has(o.jobId)),
    [agenda.data?.occurrences, filteredIds],
  );

  const sampleDays = useMemo(
    () => new Map((summary.data?.days ?? []).map((day) => [day.date, day])),
    [summary.data?.days],
  );

  // The DayContent ledger: the date, at most three ordered local time labels, then `+N more` — a
  // SELECT, never a hidden popover, so keyboard and touch readers land in the agenda beside it.
  const dayContent = (day: { date: Date; displayMonth: Date }) => {
    const label = localDateLabel(day.date);
    const info = sampleDays.get(label);
    const entries = info?.samples ?? [];
    const inMonth = day.date.getMonth() === day.displayMonth.getMonth();
    const count = info?.total ?? 0;
    return (
      <span
        className="flex min-w-0 flex-col items-center gap-0.5"
        aria-label={count > 0 ? s.calDayAria.replace('{date}', label).replace('{count}', String(count)) : undefined}
        data-testid={`cron-day-${label}`}
      >
        <span className="text-xs tabular-nums">{day.date.getDate()}</span>
        {inMonth ? entries.map((occurrence) => (
          <span key={occurrence.id} className="max-w-full truncate text-[10px] leading-tight text-muted-foreground">
            {occurrence.localTime}
          </span>
        )) : null}
        {inMonth && info && info.overflow > 0 ? (
          <span className="text-[10px] font-medium leading-tight text-primary">{s.calMore.replace('{n}', String(info.overflow))}</span>
        ) : null}
      </span>
    );
  };

  // One toolbar: month stepping and Today for the grid, the two creation actions, search
  // and scope select. On coarse pointer or narrow width the surface falls back to agenda.
  const todayToolbar = (
    <div className="flex min-w-0 flex-wrap items-center gap-2 pb-2">
      <C.Button variant="ghost" icon={ChevronLeft} aria-label={s.calPrevMonth} minHdg={44} onClick={() => stepMonth(-1)} />
      <span className="text-sm font-medium text-foreground tabular-nums">{monthState.year}-{String(monthState.month).padStart(2, '0')}</span>
      <C.Button variant="ghost" icon={ChevronRight} aria-label={s.calNextMonth} minHdg={44} onClick={() => stepMonth(1)} />
      <C.Button variant="outline" onClick={goToday}>{s.calToday}</C.Button>
      <C.Modal
        open={openingDatePane === 'month'}
        title={s.calMonthLabel}
        onClose={() => setOpeningDatePane(null)}
        closeLabel={t.common.close}
      >
        <C.ModalBody>
          {openingDatePane === 'month' ? (
            <C.Calendar
              aria-label={s.calMonthLabel}
              mode="single"
              month={parseDate(monthStart)}
              onMonthChange={(next: Date) => setMonthState(monthKey(localDateLabel(next)))}
              selected={selected ? parseDate(selected) : undefined}
              onSelect={(day: Date | undefined) => { setOpeningDatePane(null); if (day) { setSelected(localDateLabel(day)); setView('agenda'); } }}
            />
          ) : null}
        </C.ModalBody>
      </C.Modal>
      {mobile ? (
        <C.Button variant="outline" onClick={() => setOpeningDatePane('month')}>{s.calDatePicker}</C.Button>
      ) : null}
      <C.Segmented
        value={view}
        onChange={(next: string) => { setView(next as 'month' | 'agenda'); if (next === 'agenda') setSelected(null); }}
        options={[
          { value: 'month', label: s.calMonthLabel },
          { value: 'agenda', label: s.calAgendaHeading },
        ]}
        aria-label={s.calViewTitle}
      />
      <C.Input value={query} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)} placeholder={s.searchPlaceholder} aria-label={s.searchPlaceholder} className="min-w-40 max-w-64" />
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
      {todayToolbar}
      {missingLink ? (
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
      {openingDatePane !== null ? (
        <CreateJobDialog lifecycle="oneShot" myId={myId} isAdmin={isAdmin} onClose={() => setOpeningDatePane(null)} onCreated={(created) => { setOpeningDatePane(null); invalidate(); selectJob(created.id); }} />
      ) : null}
      {selected !== null && !mobile ? (
        <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem] xl:gap-5">
          <div className="min-w-0" data-testid="cron-month-grid">
            <C.Calendar
              mode="single"
              selected={selected ? parseDate(selected) : undefined}
              onSelect={(day: Date | undefined) => { if (day) { setSelected(localDateLabel(day)); } }}
              month={parseDate(monthStart)}
              onMonthChange={(next: Date) => setMonthState(monthKey(localDateLabel(next)))}
              showOutsideDays={false}
              aria-label={s.calMonthLabel}
              components={{ DayContent: dayContent }}
            />
          </div>
          <aside className="flex min-w-0 flex-col gap-2 border-t border-border pt-3 xl:border-t-0 xl:pt-0" aria-label={s.calAgendaHeading}>
            <div aria-live="polite" className="text-sm font-medium text-foreground">{formatLocalDay(selected)}</div>
            <AgendaView occurrences={agendaOccurrences} jobs={filteredJobs} onOpen={(jobId) => selectJob(jobId)} />
          </aside>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-2" data-testid="cron-agenda-only">
          <AgendaView occurrences={agendaOccurrences} jobs={filteredJobs} onOpen={(jobId) => selectJob(jobId)} />
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
          action={
            <span className="flex flex-wrap items-center gap-2">{recurringButton}{oneShotButton}</span>
          }
        />
        {body}
      </C.WorkspacePage>
      {opening !== null ? (
        <CreateJobDialog
          lifecycle={opening}
          myId={myId}
          isAdmin={isAdmin}
          onClose={() => setOpening(null)}
          onCreated={(created) => { invalidate(); setRunUntil(Date.now() + 120_000); setOpening(null); selectJob(created.id); }}
        />
      ) : null}
      {openJobId !== null && summary.data ? (
        <JobDrawer
          job={summary.data.jobs.find((job) => job.id === openJobId)!}
          myId={myId}
          adminFields={isAdmin}
          destinations={destinations.data ?? []}
          models={models.data ?? []}
          onClose={closeJob}
          onRemoved={() => { closeJob(); invalidate(); setRunUntil(Date.now() + 120_000); }}
          onRefresh={() => invalidate()}
        />
      ) : null}
      {summary.data && !summary.data.scheduler.ready ? (
        <p role="status" className="sr-only">{s.schedulerUnavailable}</p>
      ) : null}
    </>
  );
}

// ── date helpers: the page works on local calendar labels the SERVER already derived ─────────────
const parseDate = (label: string): Date => {
  const [, y, mo, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label) ?? [];
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
};
const monthKey = (label: string): { year: number; month: number } => {
  const [y, mo] = label.split('-').map(Number);
  return { year: y, month: mo };
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
const calendarUrl = (detail: 'summary' | 'agenda', startLabel: string, daysCount: number, scopeValue: string | undefined, limit?: number): string => {
  const params = new URLSearchParams({ detail, start: startLabel, days: String(daysCount) });
  if (scopeValue) params.set('scope', scopeValue);
  if (detail === 'agenda' && limit !== undefined) params.set('limit', String(limit));
  return `/plugins/cronjob/api/calendar?${params.toString()}`;
};
