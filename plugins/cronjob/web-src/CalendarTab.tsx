import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Plus } from 'lucide-react';
import { DayCard } from './DayCard';
import { DayPanel } from './DayPanel';
import { IntervalsTable } from './IntervalsTable';
import { RunResultModal } from './RunResultModal';
import { MobileDayStrip, WeekGrid } from './WeekGrid';
import { runsUrl, useRunFeed } from './useRunFeed';
import { runtime, type CronJob, type CronRunRow, type CronRunsResponse, type CronWeekResponse } from './runtime';

export const shiftDate = (date: string, days: number): string => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};
export const weekUrl = (start: string | null, days = 7): string => {
  const query = new URLSearchParams();
  if (start) query.set('start', start);
  if (days !== 7) query.set('days', String(days));
  const suffix = query.toString();
  return `/plugins/cronjob/api/week${suffix ? `?${suffix}` : ''}`;
};

export function CalendarTab({ start, selectedDate, view, query, owner, state, kind, onSelectedDate, onData, onWindowShift, onOpenJob, onRun, onToggle, onAddAt }: {
  start: string | null;
  selectedDate: string | null;
  view: 'day' | 'week';
  query: string;
  owner: 'all' | 'mine' | 'instance';
  state: 'all' | 'active' | 'paused';
  kind: 'all' | 'fixed' | 'interval' | 'oneShot';
  onSelectedDate(date: string): void;
  onData(data: CronWeekResponse): void;
  onWindowShift(days: number): void;
  onOpenJob(jobId: string): void;
  onRun(job: CronJob): void;
  onToggle(job: CronJob): void;
  onAddAt(localDate: string): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { t } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const me = hooks.useMe();
  const mobile = hooks.useMobile();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<CronRunRow | null>(null);
  /** "Show result" asks the run register for what this job actually did on THAT calendar day, rather than
   *  reusing the selected day's feed — the reader opens it from a cell that may not be the selected one. */
  const showResult = useCallback(async (job: CronJob, localDate: string) => {
    const response = await runtime().api(runsUrl({ date: localDate, jobId: job.id, limit: 1 })) as CronRunsResponse;
    const run = response.runs[0];
    if (run) setOpenRun(run);
    else toast(s.runNoneForDay || 'No run was recorded for this job on that day.', 'ok');
  }, [s.runNoneForDay, toast]);
  const week = hooks.useQuery<CronWeekResponse>({
    queryKey: ['cron-week', start],
    queryFn: () => runtime().api(weekUrl(start)) as Promise<CronWeekResponse>,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const data = week.data;
  useEffect(() => {
    if (!data) return;
    onData(data);
    if (!selectedDate || !data.days.some((day) => day.localDate === selectedDate)) {
      onSelectedDate(data.days.find((day) => day.localDate === data.todayLocalDate)?.localDate ?? data.days[0]!.localDate);
    }
  }, [data, onData, onSelectedDate, selectedDate]);
  const actualDate = selectedDate && data?.days.some((day) => day.localDate === selectedDate)
    ? selectedDate
    : data?.days[0]?.localDate ?? null;
  const feed = useRunFeed(actualDate);

  const filtered = useMemo(() => {
    if (!data) return null;
    const myId = me.data?.user?.id ?? null;
    const needle = query.trim().toLowerCase();
    const visibleJobs = data.jobs.filter((job) => {
      if (owner === 'mine' && job.ownerUserId !== myId) return false;
      if (owner === 'instance' && job.ownerUserId != null) return false;
      if (state === 'active' && job.enabled === false) return false;
      if (state === 'paused' && job.enabled !== false) return false;
      const jobKind = job.lifecycle === 'oneShot' ? 'oneShot'
        : data.intervals.some((row) => row.jobId === job.id) ? 'interval' : 'fixed';
      if (kind !== 'all' && kind !== jobKind) return false;
      return !needle || job.name.toLowerCase().includes(needle)
        || job.schedule.toLowerCase().includes(needle)
        || job.prompt.toLowerCase().includes(needle);
    });
    const ids = new Set(visibleJobs.map((job) => job.id));
    return {
      jobs: new Map(visibleJobs.map((job) => [job.id, job])),
      days: data.days.map((day) => {
        const cards = day.cards.filter((card) => ids.has(card.jobId));
        return { ...day, cards, dayTotal: cards.length };
      }),
      intervals: data.intervals.filter((row) => ids.has(row.jobId)),
    };
  }, [data, kind, me.data?.user?.id, owner, query, state]);

  if (week.isError) return <C.ErrorState message={t.common.daemonUnreachable} onRetry={() => week.refetch()} />;
  if (!data || !filtered || !actualDate) return <C.LoadingState variant="cards" />;
  const selectedDay = filtered.days.find((day) => day.localDate === actualDate) ?? filtered.days[0]!;
  const selectedIndex = filtered.days.findIndex((day) => day.localDate === selectedDay.localDate);
  const moveDay = (offset: number) => {
    const next = filtered.days[selectedIndex + offset];
    if (next) onSelectedDate(next.localDate);
    else onWindowShift(offset < 0 ? -7 : 7);
  };
  const showWeek = view === 'week' && !mobile;

  return (
    <div className="flex min-w-0 flex-col gap-6" aria-busy={week.isLoading} data-testid="cron-calendar-tab">
      {mobile ? <MobileDayStrip days={filtered.days} selectedDate={selectedDay.localDate} todayLocalDate={data.todayLocalDate} onSelectDate={onSelectedDate} /> : null}
      {showWeek ? (
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <WeekGrid
              days={filtered.days}
              jobs={filtered.jobs}
              selectedDate={selectedDay.localDate}
              todayLocalDate={data.todayLocalDate}
              onSelectDate={(date) => { onSelectedDate(date); setSelectedJobId(null); }}
              onOpenJob={onOpenJob}
              onRun={onRun}
              onToggle={onToggle}
              onShowResult={(job, date) => void showResult(job, date)}
              onAddAt={onAddAt}
            />
            <IntervalsTable rows={filtered.intervals} jobs={filtered.jobs} onOpen={onOpenJob} onRun={onRun} />
          </div>
          <div className="rounded-lg border border-border/80 bg-document p-4">
            <DayPanel
              day={selectedDay}
              todayLocalDate={data.todayLocalDate}
              intervals={selectedDay.localDate === data.todayLocalDate ? filtered.intervals : []}
              jobs={filtered.jobs}
              runs={feed.rows}
              loading={feed.isLoading}
              hasMore={feed.hasMore}
              onLoadMore={feed.loadMore}
              selectedJobId={selectedJobId}
              onSelectJob={setSelectedJobId}
              onOpenRun={setOpenRun}
              onOpenJob={onOpenJob}
              onPreviousDay={() => moveDay(-1)}
              onNextDay={() => moveDay(1)}
            />
          </div>
        </div>
      ) : (
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
          <section className="flex min-w-0 flex-col gap-3" data-testid="cron-day-cards">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{s.viewDay || 'Day'}</h2>
              <C.Button variant="ghost" icon={Plus} onClick={() => onAddAt(selectedDay.localDate)} data-testid="cron-day-add-selected">
                {s.addJob || 'Add job'}
              </C.Button>
            </div>
            {selectedDay.cards.length === 0 ? <C.EmptyState title={s.dayNothing || 'No fixed-time jobs'} icon={CalendarDays} /> : selectedDay.cards.map((card) => {
              const job = filtered.jobs.get(card.jobId);
              return job ? (
                <DayCard
                  key={card.jobId}
                  card={card}
                  job={job}
                  localDate={selectedDay.localDate}
                  onOpen={onOpenJob}
                  onRun={onRun}
                  onToggle={onToggle}
                  onShowResult={(target, date) => void showResult(target, date)}
                />
              ) : null;
            })}
            <IntervalsTable rows={filtered.intervals} jobs={filtered.jobs} onOpen={onOpenJob} onRun={onRun} />
          </section>
          <div className="rounded-lg border border-border/80 bg-document p-4">
            <DayPanel
              day={selectedDay}
              todayLocalDate={data.todayLocalDate}
              intervals={selectedDay.localDate === data.todayLocalDate ? filtered.intervals : []}
              jobs={filtered.jobs}
              runs={feed.rows}
              loading={feed.isLoading}
              hasMore={feed.hasMore}
              onLoadMore={feed.loadMore}
              selectedJobId={selectedJobId}
              onSelectJob={setSelectedJobId}
              onOpenRun={setOpenRun}
              onOpenJob={onOpenJob}
              onPreviousDay={() => moveDay(-1)}
              onNextDay={() => moveDay(1)}
              mobile={mobile}
            />
          </div>
        </div>
      )}
      {openRun ? (
        <RunResultModal
          run={openRun}
          job={data.jobs.find((job) => job.id === openRun.jobId)}
          onClose={() => setOpenRun(null)}
          onOpenJob={(jobId) => { setOpenRun(null); onOpenJob(jobId); }}
          onRun={onRun}
        />
      ) : null}
    </div>
  );
}
