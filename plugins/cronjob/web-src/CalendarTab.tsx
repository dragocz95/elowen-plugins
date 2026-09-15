import { useEffect, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { DayCard } from './DayCard';
import { DayPanel } from './DayPanel';
import { IntervalsTable } from './IntervalsTable';
import { RunResultModal } from './RunResultModal';
import { MobileDayStrip, WeekGrid } from './WeekGrid';
import { useRunFeed } from './useRunFeed';
import { runtime, type CronJob, type CronRunRow, type CronWeekResponse } from './runtime';

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

export function CalendarTab({ start, selectedDate, view, query, owner, state, kind, onSelectedDate, onData, onWindowShift, onOpenJob, onRun, onToggle }: {
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
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { t } = hooks.useTranslation();
  const me = hooks.useMe();
  const mobile = hooks.useMobile();
  const [intervalQuery, setIntervalQuery] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<CronRunRow | null>(null);
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
      {mobile ? <MobileDayStrip days={filtered.days} selectedDate={selectedDay.localDate} onSelectDate={onSelectedDate} /> : null}
      {showWeek ? (
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
          <WeekGrid
            days={filtered.days}
            jobs={filtered.jobs}
            selectedDate={selectedDay.localDate}
            onSelectDate={(date) => { onSelectedDate(date); setSelectedJobId(null); }}
            onOpenJob={onOpenJob}
            onRun={onRun}
            onToggle={onToggle}
          />
          <div className="rounded-lg border border-border/80 bg-document p-4">
            <DayPanel
              day={selectedDay}
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
            <h2 className="text-lg font-semibold">{s.viewDay || 'Day'}</h2>
            {selectedDay.cards.length === 0 ? <C.EmptyState title={s.dayNothing || 'No fixed-time jobs'} icon={CalendarDays} /> : selectedDay.cards.map((card) => {
              const job = filtered.jobs.get(card.jobId);
              return job ? <DayCard key={card.jobId} card={card} job={job} onOpen={onOpenJob} onRun={onRun} onToggle={onToggle} /> : null;
            })}
          </section>
          <div className="rounded-lg border border-border/80 bg-document p-4">
            <DayPanel
              day={selectedDay}
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
      <IntervalsTable
        rows={filtered.intervals}
        jobs={filtered.jobs}
        query={intervalQuery}
        onQueryChange={setIntervalQuery}
        onOpen={onOpenJob}
        onRun={onRun}
      />
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
