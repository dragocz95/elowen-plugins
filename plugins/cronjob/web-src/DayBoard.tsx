/** The Automation day board: ONE local date, drawn as a day planner, with each job on it exactly once.
 *
 *  It replaced a month calendar for a measured reason. On a real instance the month view asked the
 *  server for 42 days of every job's runs and drew a row per run: polling jobs alone produced between
 *  455 and 1253 entries for a single day, the page took seconds to arrive, and the answer a person
 *  actually wanted — "what runs today, and what is that job doing" — was buried in it.
 *
 *  The shape that replaced it is deliberately two different things, because the day holds two
 *  different kinds of work:
 *
 *   - Work that happens AT A TIME (fixed-time recurrences and one-shots) is a real vertical day rail:
 *     hour gutter, hour bands, and a block sitting in the band it runs in, plus a now line. That is
 *     what makes a glance answer "what is coming".
 *   - Work that happens AT A RATE (interval polling) is a separate lane of compact rows. A two-minute
 *     poll has 720 runs a day; drawing it on the rail would bury every real appointment under it, so
 *     the lane names the RATE, the next instant and how many runs remain — one row, never 720.
 *
 *  Every count, next instant, timezone, DST, active-hours and catch-up answer comes from the server
 *  engine the scheduler ticks with; the page never parses a schedule and never expands one. Visual
 *  richness is layout over a bounded DTO and must never reintroduce an occurrence per run.
 *
 *  The primitives are the host's published ones (API 17): Button, Badge, Input, Segmented, Modal +
 *  the real shadcn Calendar, EntityList/EntityRow, EmptyState, LoadingState, ErrorState. The host
 *  publishes no Card, Separator, ScrollArea or Tooltip primitive, so grouping uses the host's own
 *  EntityList surface and the rail's rules are layout on host tokens — nothing here re-implements a
 *  control the host owns.
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock, CalendarClock, ShieldQuestion, AlarmClock, Repeat } from 'lucide-react';
import { CreateJobDialog } from './CreateJobDialog';
import { JobDrawer } from './JobDrawer';
import {
  runtime, localDateLabel,
  type CronDayResponse, type CronDayRow, type CronDisposition, type CronJob,
} from './runtime';

/** The fast cadence after an accepted run-now, and the ceiling it falls back from. */
const RUN_WATCH_MS = 2_000;
const RUN_WATCH_CAP_MS = 120_000;
/** The board's resting cadence: a scheduled day changes when a job runs, not continuously. */
const IDLE_REFETCH_MS = 30_000;

export function DayBoard() {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { t, locale } = hooks.useTranslation();
  const me = hooks.useMe();
  const myId = me.data?.user?.id ?? null;
  const isAdmin = me.data?.user?.is_admin === true;
  const destinations = hooks.useNotificationDestinations();
  const models = hooks.useBrainModels();

  /** `null` is the scheduler's OWN today: the first request names no date at all, so the board opens
   *  on the right day in one round trip and a browser in another timezone never has to correct it. */
  const [date, setDate] = useState<string | null>(null);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState<'all' | 'mine' | 'instance'>('all');
  const [opening, setOpening] = useState<'oneShot' | 'recurring' | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [missingLink, setMissingLink] = useState<string | null>(null);
  const [runWatch, setRunWatch] = useState<{ until: number; sawQueued: boolean } | null>(null);

  const queryClient = hooks.useQueryClient();
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ['cron-day'] }); };

  const board = hooks.useQuery<CronDayResponse>({
    queryKey: ['cron-day', date],
    queryFn: () => runtime().api(dayUrl(date)) as Promise<CronDayResponse>,
    staleTime: 15_000,
    refetchInterval: runWatch !== null ? RUN_WATCH_MS : IDLE_REFETCH_MS,
    refetchIntervalInBackground: false,
  });

  const data = board.data;
  const jobs = useMemo(() => data?.jobs ?? [], [data?.jobs]);
  const byId = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);

  // A run-now the server accepted: poll every 2s until the queued request LEAVES the projection, and
  // never longer than two minutes. Nothing else arms it — a create or a delete has no queued work.
  const manualQueued = useMemo(() => jobs.some((job) => job.manualQueued === true), [jobs]);
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
  // and foreign ids arrive at the SAME unavailable state, because that list already IS the authorized one.
  const [pendingLink] = useState<string | null>(() => jobIdParam());
  useEffect(() => {
    if (pendingLink === null || !data) return;
    if (data.jobs.some((job) => job.id === pendingLink)) setOpenJobId(pendingLink);
    else setMissingLink(pendingLink);
    // Resolved once against the loaded list; every selection after that is the reader's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLink, data]);

  // Search and the owner filter narrow rows ALREADY on the page. They never re-query: the board is
  // one bounded row per job, so there is nothing further to fetch and nothing to wait for.
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.rows ?? []).filter((row) => {
      const job = byId.get(row.jobId);
      if (!job) return false;
      if (owner === 'mine' && !(job.ownerUserId != null && job.ownerUserId === myId)) return false;
      if (owner === 'instance' && job.ownerUserId != null) return false;
      if (needle === '') return true;
      return (job.name ?? '').toLowerCase().includes(needle)
        || (job.schedule ?? '').toLowerCase().includes(needle)
        || (job.prompt ?? '').toLowerCase().includes(needle);
    });
  }, [data?.rows, byId, query, owner, myId]);

  // The rail holds what happens at a TIME; the lane holds what happens at a RATE.
  const timed = useMemo(() => rows.filter((row) => row.section !== 'recurring' && row.next !== null), [rows]);
  const recurring = useMemo(() => rows.filter((row) => row.section === 'recurring'), [rows]);

  // A one-shot can delete itself between the click and the next refetch, and a job can leave the
  // filter. Both arrive at the same unavailable state as a stale deep link: never a drawer over an
  // undefined record.
  const openJob = openJobId !== null ? byId.get(openJobId) : undefined;
  const jobVanished = openJobId !== null && Boolean(data) && !openJob;

  const isToday = data !== undefined && data.localDate === data.todayLocalDate;
  const isPast = data !== undefined && data.localDate < data.todayLocalDate;
  const nowMinutes = data !== undefined && isToday ? minutesOf(data.nowLocalTime) : null;

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

  const runningStatus = data?.scheduler.ready && data.scheduler.runningJobId
    ? ` · ${s.runningSince.replace('{t}', utils.compactElapsed(Date.now() - Date.parse(data.scheduler.runningSince ?? data.generatedAt)))}`
    : null;

  const body = board.isError ? (
    <C.ErrorState message={t.common.daemonUnreachable} onRetry={() => board.refetch()} />
  ) : data === undefined ? (
    <C.LoadingState variant="cards" />
  ) : (
    <div className="flex min-w-0 flex-col gap-6" aria-busy={board.isLoading} data-testid="cron-day-board">
      {/* The day owns the top of the page: which day am I reading, and one way to read another. */}
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {isToday ? s.calToday : isPast ? s.calDayPast : s.boardScheduled}
          </span>
          <h2 aria-live="polite" className="min-w-0 text-2xl font-semibold leading-tight text-foreground" data-testid="cron-day-heading">
            {formatDay(data.localDate, locale)}
          </h2>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          {!isToday ? <C.Button variant="ghost" onClick={() => setDate(null)}>{s.calToday}</C.Button> : null}
          <C.Button variant="outline" icon={CalendarDays} onClick={() => setDayPickerOpen(true)}>
            {s.boardOtherDay}
          </C.Button>
        </span>
      </div>

      {jobs.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="cron-toolbar">
          <C.Input
            value={query}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            placeholder={s.searchPlaceholder}
            aria-label={s.searchPlaceholder}
            className="min-w-40 max-w-64"
          />
          {isAdmin ? (
            <C.Segmented
              value={owner}
              onChange={(next: string) => setOwner(next as 'all' | 'mine' | 'instance')}
              options={[
                { value: 'all', label: s.filterAll },
                { value: 'mine', label: s.filterMine },
                { value: 'instance', label: s.filterInstance },
              ]}
              aria-label={s.filterAll}
            />
          ) : null}
        </div>
      ) : null}

      {missingLink || jobVanished ? (
        <div role="status" className="flex flex-col gap-0.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          <span className="font-medium text-destructive">{s.linkUnavailable}</span>
          <span className="text-muted-foreground">{s.linkUnavailableHint}</span>
        </div>
      ) : null}
      {data.truncated ? (
        <div role="status" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          <span className="font-medium text-destructive">{s.calTruncated}</span>
          <span className="block text-muted-foreground">{s.calTruncatedHint}</span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <C.EmptyState
          title={isPast ? s.calDayPast : jobs.length === 0 ? s.calEmptyTitle : s.calDayEmpty}
          description={isPast ? undefined : jobs.length === 0 ? s.calEmptyHint : s.calDayEmptyHint}
          icon={isPast ? Clock : CalendarDays}
          action={!isPast && query === '' && owner === 'all' ? (
            <span className="flex flex-wrap items-center gap-2">{recurringButton}{oneShotButton}</span>
          ) : undefined}
        />
      ) : (
        <div className={`grid min-w-0 gap-6 ${recurring.length > 0 ? 'xl:grid-cols-[minmax(0,1fr)_21rem] xl:gap-8' : ''}`}>
          <section className="flex min-w-0 flex-col gap-3" aria-label={s.sectionDay} data-testid="cron-timeline">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.sectionDay}</h3>
            <DayRail rows={timed} jobs={byId} nowMinutes={nowMinutes} onOpen={selectJob} />
          </section>
          {recurring.length > 0 ? (
            <aside className="flex min-w-0 flex-col gap-3" aria-label={s.sectionRecurring} data-testid="cron-recurring-lane">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.sectionRecurring}</h3>
              <C.EntityList>
                {recurring.map((row) => (
                  <CompactJobRow key={row.jobId} row={row} job={byId.get(row.jobId)} onOpen={selectJob} />
                ))}
              </C.EntityList>
              <p className="text-[11px] leading-snug text-muted-foreground">{s.boardRecurringHint}</p>
            </aside>
          ) : null}
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
          status={data ? (
            <span className="workspace-status" data-testid="cron-day-timezone">
              {data.timezone}{runningStatus}
            </span>
          ) : undefined}
          action={<span className="flex flex-wrap items-center gap-2">{recurringButton}{oneShotButton}</span>}
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
      {data && !data.scheduler.ready ? (
        <p role="status" className="sr-only">{s.schedulerUnavailable}</p>
      ) : null}
      {/* The one place a month grid still earns its keep: choosing a different date. The host Modal is
          MOUNTED WHEN OPEN — it has no `open` prop — so the mount itself is the open state. */}
      {dayPickerOpen ? (
        <C.Modal
          title={s.boardOtherDay}
          onClose={() => setDayPickerOpen(false)}
          closeLabel={t.common.close}
          size="sm"
          presentation="center"
        >
          <C.ModalBody>
            {/* A date picker is a fixed-size object. The host Calendar fills whatever box it is given,
                so a month handed a wide dialog becomes a grid of enormous empty cells — the smallest
                modal, with the grid sized to its content and centred, keeps it the size of a calendar. */}
            <div className="flex w-full justify-center">
              <C.Calendar
                aria-label={s.calMonthLabel}
                mode="single"
                className="w-fit"
                selected={data ? parseDate(data.localDate) : undefined}
                onSelect={(day: Date | undefined) => {
                  setDayPickerOpen(false);
                  if (day) setDate(localDateLabel(day));
                }}
              />
            </div>
          </C.ModalBody>
        </C.Modal>
      ) : null}
    </>
  );
}

// ── the day rail ──────────────────────────────────────────────────────────────────────────────────

/** The vertical day: an hour gutter, one band per hour, and each job's block in the band it runs in.
 *
 *  The rail spans only the hours the day actually uses (plus the current hour on today), because a
 *  fixed 00–23 rail is twenty empty bands above the first thing that happens. Empty bands INSIDE the
 *  span are kept — they are what makes the rail read as a day rather than as a list. */
function DayRail({ rows, jobs, nowMinutes, onOpen }: {
  rows: CronDayRow[];
  jobs: Map<string, CronJob>;
  nowMinutes: number | null;
  onOpen: (jobId: string) => void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');

  const byHour = useMemo(() => {
    const map = new Map<number, CronDayRow[]>();
    for (const row of rows) {
      const hour = Math.floor(minutesOf(row.next?.localTime ?? '00:00') / 60);
      const bucket = map.get(hour);
      if (bucket) bucket.push(row);
      else map.set(hour, [row]);
    }
    return map;
  }, [rows]);

  const hours = useMemo(() => {
    const marks = [...byHour.keys()];
    if (nowMinutes !== null) marks.push(Math.floor(nowMinutes / 60));
    if (marks.length === 0) return [];
    const from = Math.min(...marks);
    const to = Math.max(...marks);
    return Array.from({ length: to - from + 1 }, (_unused, index) => from + index);
  }, [byHour, nowMinutes]);

  if (hours.length === 0) {
    return <C.EmptyState title={s.boardNoTimed} description={s.boardNoTimedHint} icon={Clock} />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/80 bg-document" data-testid="cron-day-rail">
      {hours.map((hour) => {
        const inThisHour = byHour.get(hour) ?? [];
        const nowHere = nowMinutes !== null && Math.floor(nowMinutes / 60) === hour;
        return (
          <div
            key={hour}
            className="grid min-h-[4.5rem] grid-cols-[3.25rem_minmax(0,1fr)] border-t border-border/60 first:border-t-0"
            data-testid={`cron-hour-${String(hour).padStart(2, '0')}`}
          >
            <span className="px-2 pt-2 text-right font-mono text-[11px] leading-none tabular-nums text-muted-foreground">
              {String(hour).padStart(2, '0')}:00
            </span>
            <div className="relative flex min-w-0 flex-col gap-2 border-l border-border/60 py-2 pl-3 pr-3">
              {/* The now line: the same accent a calendar uses for the present moment, positioned by the
                  minute the SERVER reports in the scheduler's own timezone. */}
              {nowHere ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                  style={{ top: `${((nowMinutes % 60) / 60) * 100}%` }}
                  data-testid="cron-now-line"
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="h-px min-w-0 flex-1 bg-primary/70" />
                </span>
              ) : null}
              {inThisHour.map((row) => (
                <EventBlock key={row.jobId} row={row} job={jobs.get(row.jobId)} onOpen={onOpen} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One job's appointment on the rail. A job with several fixed times today names the others INSIDE
 *  this block — never as a second block, which is what kept the old view from ever being readable. */
function EventBlock({ row, job, onOpen }: {
  row: CronDayRow;
  job: CronJob | undefined;
  onOpen: (jobId: string) => void;
}) {
  const { hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const name = job?.name?.trim() || s.jobNew;
  const oneShot = row.section === 'oneShot';
  const hiddenTimes = Math.max(row.remaining - 1 - row.moreTimes.length, 0);

  return (
    <button
      type="button"
      onClick={() => onOpen(row.jobId)}
      aria-label={s.openJob.replace('{name}', name)}
      data-testid={`cron-row-${row.jobId}`}
      className={`flex min-h-[44px] w-full min-w-0 flex-col gap-1 rounded-md border border-border border-l-[3px] bg-canvas px-3 py-2 text-left shadow-sm transition-colors hover:border-ring focus-visible:outline-2 focus-visible:outline-ring ${oneShot ? 'border-l-accent-foreground/60' : 'border-l-primary'}`}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 font-mono text-sm font-medium tabular-nums text-foreground">
          {row.next?.localTime ?? '—'}
        </span>
        <span className="truncate text-sm text-foreground">{name}</span>
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
        <span className="inline-flex max-w-full items-center gap-1 truncate">
          {oneShot ? <CalendarClock size={10} aria-hidden /> : <Clock size={10} aria-hidden />}
          {oneShot ? s.badgeOneShot : row.schedule ?? ''}
        </span>
        {row.moreTimes.length > 0 ? (
          <span className="truncate font-mono tabular-nums" data-testid={`cron-times-${row.jobId}`}>
            {s.boardAlsoAt.replace('{times}', row.moreTimes.join(' · '))}
          </span>
        ) : null}
        {hiddenTimes > 0 ? <span className="font-medium text-primary">{s.calMore.replace('{n}', String(hiddenTimes))}</span> : null}
        <RowBadges row={row} />
      </span>
    </button>
  );
}

/** One job as a compact row inside the host's grouped list: what makes it run, when it next does, and
 *  how much of the day is left of it.
 *
 *  The Recurring lane is built from these, and so is the Settings deck. A polling job is deliberately
 *  NOT on the rail — a job that runs every two minutes has no single place to sit on a day, and
 *  putting it in 720 places is the failure this whole surface was rebuilt to undo. */
export function CompactJobRow({ row, job, onOpen }: {
  row: CronDayRow;
  job: CronJob | undefined;
  onOpen: (jobId: string) => void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const name = job?.name?.trim() || s.jobNew;
  const oneShot = row.section === 'oneShot';
  const Icon = oneShot ? CalendarClock : row.kind === 'interval' ? Repeat : Clock;

  return (
    <C.EntityRow>
      <button
        type="button"
        onClick={() => onOpen(row.jobId)}
        aria-label={s.openJob.replace('{name}', name)}
        data-testid={`cron-row-${row.jobId}`}
        className="flex min-h-[44px] w-full min-w-0 flex-col gap-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="truncate text-sm text-foreground">{name}</span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {row.next?.localTime ?? '—'}
          </span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
          <span className="inline-flex max-w-full items-center gap-1 truncate">
            <Icon size={10} aria-hidden />
            {oneShot ? s.badgeOneShot : row.schedule ?? ''}
          </span>
          {/* An interval is a rate: how many runs the day still holds, never each of them. */}
          {row.kind === 'interval' && row.remaining > 0 ? (
            <C.Badge tone="muted">{s.boardRemaining.replace('{n}', String(row.remaining))}</C.Badge>
          ) : null}
          <RowBadges row={row} />
        </span>
      </button>
    </C.EntityRow>
  );
}

/** The state words every row carries, in words and never colour alone: guarded, paused, a count that
 *  is a floor, nothing left today, and why the next instant is what it is. */
function RowBadges({ row }: { row: CronDayRow }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const paused = !row.enabled;
  return (
    <>
      {row.truncated ? <C.Badge tone="muted">{s.boardAtLeast}</C.Badge> : null}
      {row.next?.guarded ? (
        <span className="inline-flex items-center gap-1" title={s.badgeGuardedHint}>
          <ShieldQuestion size={10} aria-hidden /><C.Badge tone="muted">{s.badgeGuarded}</C.Badge>
        </span>
      ) : null}
      {paused ? <C.Badge tone="muted">{s.paused}</C.Badge> : null}
      {!paused && row.next === null ? <span>{s.boardNothingLeft}</span> : null}
      {!paused && row.next !== null ? <Disposition disposition={row.next.disposition} /> : null}
      {!paused && row.section !== 'oneShot' ? <span className="sr-only">{s.badgeRecurring}</span> : null}
    </>
  );
}

/** Why the next instant is what it is — in words, never colour alone. */
function Disposition({ disposition }: { disposition: CronDisposition }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  switch (disposition) {
    case 'late': return <C.Badge tone="danger">{s.badgeLate}</C.Badge>;
    case 'catchUp': return (
      <span className="inline-flex items-center gap-1" title={s.badgeCatchUpHint}>
        <AlarmClock size={10} aria-hidden /><C.Badge tone="muted">{s.badgeCatchUp}</C.Badge>
      </span>
    );
    case 'deferredByHours': return (
      <span className="inline-flex items-center gap-1" title={s.badgeDeferredHint}>
        <ShieldQuestion size={10} aria-hidden /><C.Badge tone="muted">{s.badgeDeferred}</C.Badge>
      </span>
    );
    case 'dueNow': return <C.Badge tone="muted">{s.badgeDueNow}</C.Badge>;
    default: return null;
  }
}

// ── local date labels ─────────────────────────────────────────────────────────────────────────────
//
// `parseDate` builds at LOCAL midnight and `localDateLabel` reads local fields — one consistent pair.
// A Date built at UTC midnight and read back through local getters lands on the previous day
// everywhere west of UTC, and react-day-picker is local-time as well. These labels only drive
// FORMATTING and the date chooser; every label that means something is derived by the server in the
// scheduler's timezone and travels as a string.
const DATE_LABEL = /^(\d{4})-(\d{2})-(\d{2})$/;
const parseDate = (label: string): Date => {
  const [, y, mo, d] = DATE_LABEL.exec(label) ?? [];
  return new Date(Number(y), Number(mo) - 1, Number(d));
};
const formatDay = (label: string, locale: string): string =>
  new Intl.DateTimeFormat(locale || undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    .format(parseDate(label));
/** `HH:mm` as minutes past local midnight. The label is the SERVER's, in the scheduler's timezone;
 *  this only turns it into a position on the rail. */
const minutesOf = (label: string): number => {
  const [hour, minute] = label.split(':').map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
};

/** The address parameter a conversation's scheduled-jobs branch links to: `/p/cronjob?job=<id>` opens
 *  the board on the job it names, selects one job and writes nothing. */
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

/** The board's one query URL. A `null` date asks for the scheduler's today and carries NO parameters
 *  at all — the initial load can never be a month or a week, because there is no range to ask for. */
export const dayUrl = (date: string | null): string =>
  date === null ? '/plugins/cronjob/api/day' : `/plugins/cronjob/api/day?date=${encodeURIComponent(date)}`;
