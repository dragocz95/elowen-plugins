import { useMemo, useState } from 'react';
import type { DashboardMetricProps } from './runtime';
import { CalendarClock, Plus, Repeat } from 'lucide-react';
import { AutomationPage } from './AutomationPage';
import { CreateJobDialog } from './CreateJobDialog';
import { JobDrawer } from './JobDrawer';
import { ConversationHistoryBranch } from './ConversationHistoryBranch';
import { weekUrl } from './CalendarTab';
import { runtime, registerCronUi, type CronWeekResponse } from './runtime';

export function CronNextRunMetric({ locale }: DashboardMetricProps) {
  const { hooks } = runtime();
  const strings = hooks.usePluginStrings('cronjob');
  const me = hooks.useMe();
  const jobs = hooks.useCronJobs(me.data?.user?.is_admin === true);
  const next = useMemo(() => {
    let best: { at: number; name: string } | null = null;
    for (const job of jobs.data ?? []) {
      const at = job.nextOccurrence ? Date.parse(job.nextOccurrence.expectedAt) : NaN;
      if (Number.isNaN(at)) continue;
      if (!best || at < best.at) best = { at, name: job.name };
    }
    return best;
  }, [jobs.data]);
  return (
    <a href="/p/cronjob/settings/jobs" className="min-w-0 rounded-lg transition-opacity hover:opacity-80">
      <div className="font-mono text-xl font-medium tabular-nums text-foreground @2xl:text-2xl">
        {next ? new Date(next.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '—'}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{strings.nextRun}</div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{next?.name ?? strings.nextRunUnknown}</div>
    </a>
  );
}

function CronJobApp({ surface }: { surface: 'page' | 'deck' }) {
  return surface === 'page' ? <AutomationPage /> : <AutomationDeck />;
}

function AutomationDeck() {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { t } = hooks.useTranslation();
  const me = hooks.useMe();
  const destinations = hooks.useNotificationDestinations();
  const models = hooks.useBrainModels();
  const [opening, setOpening] = useState<'oneShot' | 'recurring' | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const board = hooks.useQuery<CronWeekResponse>({
    queryKey: ['cron-week', null],
    queryFn: () => runtime().api(weekUrl(null)) as Promise<CronWeekResponse>,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const jobs = board.data?.jobs ?? [];
  const openJob = jobs.find((job) => job.id === openJobId);
  const createMenu = (
    <C.ActionMenu
      variant="kebab"
      label={s.newTask}
      trigger={<span className="inline-flex items-center gap-2"><Plus size={14} aria-hidden />{s.newTask}</span>}
      triggerClassName="inline-flex min-h-[44px] items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground pointer-coarse:min-h-[var(--touch-target)]"
      items={[
        { id: 'recurring', label: s.createRecurring, icon: Repeat, onSelect: () => setOpening('recurring') },
        { id: 'oneShot', label: s.createOneShot, icon: CalendarClock, onSelect: () => setOpening('oneShot') },
      ]}
    />
  );
  return (
    <>
      <C.PluginSection title={s.title} description={s.sectionHint} action={createMenu}>
        {board.isError ? <C.ErrorState message={t.common.daemonUnreachable} onRetry={() => board.refetch()} />
          : !board.data ? <C.LoadingState variant="list" />
          : jobs.length === 0 ? <C.EmptyState title={s.calEmptyTitle} description={s.calEmptyHint} icon={CalendarClock} />
          : (
            <C.EntityList>
              {jobs.map((job) => (
                <C.EntityRow key={job.id}>
                  <button
                    type="button"
                    aria-label={(s.openJob || 'Open “{name}”').replace('{name}', job.name)}
                    className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left"
                    onClick={() => setOpenJobId(job.id)}
                  >
                    <span className="min-w-0"><span className="block truncate text-sm font-medium">{job.name}</span><span className="block truncate text-xs text-muted-foreground">{job.schedule}</span></span>
                    <C.Badge tone={job.enabled === false ? 'muted' : 'success'}>{job.enabled === false ? s.paused : s.metricActive}</C.Badge>
                  </button>
                </C.EntityRow>
              ))}
            </C.EntityList>
          )}
      </C.PluginSection>
      {opening ? (
        <CreateJobDialog
          lifecycle={opening}
          myId={me.data?.user?.id ?? null}
          isAdmin={me.data?.user?.is_admin === true}
          onClose={() => setOpening(null)}
          onCreated={(created) => { setOpening(null); void board.refetch(); setOpenJobId(created.id); }}
        />
      ) : null}
      {openJob ? (
        <JobDrawer
          job={openJob}
          myId={me.data?.user?.id ?? null}
          adminFields={me.data?.user?.is_admin === true}
          destinations={destinations.data ?? []}
          models={models.data ?? []}
          onClose={() => setOpenJobId(null)}
          onRemoved={() => { setOpenJobId(null); void board.refetch(); }}
          onRefresh={() => void board.refetch()}
          onRunQueued={() => void board.refetch()}
        />
      ) : null}
    </>
  );
}

registerCronUi({
  requiresApiVersion: 17,
  settings: { jobs: CronJobApp },
  ownsPageFrame: ['jobs'],
  dashboardMetrics: { 'next-run': CronNextRunMetric },
  historyBranches: { cronjob: ConversationHistoryBranch },
});
