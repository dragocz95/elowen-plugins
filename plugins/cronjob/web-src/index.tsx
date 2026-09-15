/** cronjob — the Automation browser bundle.
 *
 *  The page surface is the calendar workbench; the Settings deck renders a compact agenda of what is
 *  scheduled next, so the same bundle reads calm on both surfaces and the registre's table-based
 *  manager is retired with API 17. `ownsPageFrame` keeps the host from nesting another page frame
 *  around a bundle that draws its own. */
import { useState } from 'react';
import { runtime, type CronCalendarResponse } from './runtime';
import { CreateJobDialog } from './CreateJobDialog';
import { JobDrawer } from './JobDrawer';
import { CalendarDays } from 'lucide-react';
import { AgendaView } from './AgendaView';
import { CalendarPage } from './CalendarPage';

import { registerCronUi } from './runtime';

function CronJobApp({ surface }: { surface: 'page' | 'deck' }) {
  if (surface === 'page') return <CalendarPage />;
  return <DeckAgenda />;
}

/** The Settings deck's compact agenda: the same server summary the page reads, the two creation
 *  actions and the jobs beside them, without ever squeezing a month grid into the panel. */
function DeckAgenda() {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { t } = hooks.useTranslation();
  const me = hooks.useMe();
  const myId = me.data?.user?.id ?? null;
  const isAdmin = me.data?.user?.is_admin === true;
  const destinations = hooks.useNotificationDestinations();
  const models = hooks.useBrainModels();
  const today = new Date().toISOString().slice(0, 10);

  const [opening, setOpening] = useState<'oneShot' | 'recurring' | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);

  const summary = hooks.useQuery<CronCalendarResponse>({
    queryKey: ['cron-calendar', 'summary', today, 7, 'all'],
    queryFn: () => runtime().api(`/plugins/cronjob/api/calendar?detail=summary&start=${encodeURIComponent(today)}&days=7`) as Promise<CronCalendarResponse>,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const jobs = summary.data?.jobs ?? [];
  const agendaOccurrences = (summary.data?.days ?? []).flatMap((d) => d.samples);
  // A one-shot deletes itself when it fires, so the row behind an open drawer can vanish between the
  // click and the next refetch. The drawer is mounted on the FOUND record or not at all.
  const openJob = openJobId !== null ? jobs.find((job) => job.id === openJobId) : undefined;

  return (
    <>
      <C.PluginSection title={s.title} description={s.sectionHint}
        action={
          <span className="flex flex-wrap items-center gap-2">
            <C.Button variant="outline" onClick={() => setOpening('recurring')} disabled={opening !== null}>{s.createRecurring}</C.Button>
            <C.Button variant="accent" onClick={() => setOpening('oneShot')} disabled={opening !== null}>{s.createOneShot}</C.Button>
          </span>
        }
      >
        {summary.isError ? <C.ErrorState message={t.common.daemonUnreachable} onRetry={() => summary.refetch()} />
          : summary.isLoading && !summary.data ? <C.LoadingState variant="cards" />
          : jobs.length === 0 ? <C.EmptyState title={s.calEmptyTitle} description={s.calEmptyHint} icon={CalendarDays} />
          : (
            <div className="flex min-w-0 flex-col gap-2" data-testid="cron-deck-agenda">
              <AgendaView occurrences={agendaOccurrences} jobs={jobs} onOpen={(jobId) => setOpenJobId(jobId)} />
              <span className="text-xs text-muted-foreground">
                {s.metricActive} {jobs.filter((job) => job.enabled !== false).length} · {s.metricPaused} {jobs.filter((job) => job.enabled === false).length} · {s.nextRun}{' '}
                {utils.compactElapsed(Date.now() - Date.parse(jobs.find((job) => job.enabled !== false)?.nextOccurrence?.expectedAt ?? summary.data!.generatedAt))}
              </span>
            </div>
          )}
      </C.PluginSection>
      {opening !== null ? (
        <CreateJobDialog
          lifecycle={opening}
          myId={myId}
          isAdmin={isAdmin}
          onClose={() => setOpening(null)}
          onCreated={() => setOpening(null)}
        />
      ) : null}
      {openJob ? (
        <JobDrawer
          job={openJob}
          myId={myId}
          adminFields={isAdmin}
          destinations={destinations.data ?? []}
          models={models.data ?? []}
          onClose={() => setOpenJobId(null)}
          onRemoved={() => { setOpenJobId(null); void summary.refetch(); }}
          onRefresh={() => void summary.refetch()}
        />
      ) : null}
    </>
  );
}

registerCronUi({
  requiresApiVersion: 17,
  settings: {
    'jobs': CronJobApp,
  },
  ownsPageFrame: ['jobs'],
});
