/** cronjob — the Automation browser bundle.
 *
 *  The page surface is the day board: one local date drawn as a day planner, with each job on it
 *  exactly once. The Settings deck shows the same bounded day as a compact list, so both surfaces
 *  read from ONE endpoint and neither can expand a schedule into its runs. `ownsPageFrame` keeps the
 *  host from nesting another page frame around a bundle that draws its own.
 */
import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { runtime, registerCronUi, type CronDayResponse } from './runtime';
import { CreateJobDialog } from './CreateJobDialog';
import { JobDrawer } from './JobDrawer';
import { CompactJobRow, DayBoard, dayUrl } from './DayBoard';

function CronJobApp({ surface }: { surface: 'page' | 'deck' }) {
  if (surface === 'page') return <DayBoard />;
  return <DeckDay />;
}

/** The Settings deck: today's board as a compact list, plus the two creation actions. It reads the
 *  SAME one-row-per-job day the page reads — a panel this size can never carry a day rail, but it
 *  must never carry a different answer either. */
function DeckDay() {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { t } = hooks.useTranslation();
  const me = hooks.useMe();
  const myId = me.data?.user?.id ?? null;
  const isAdmin = me.data?.user?.is_admin === true;
  const destinations = hooks.useNotificationDestinations();
  const models = hooks.useBrainModels();

  const [opening, setOpening] = useState<'oneShot' | 'recurring' | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);

  const board = hooks.useQuery<CronDayResponse>({
    queryKey: ['cron-day', null],
    queryFn: () => runtime().api(dayUrl(null)) as Promise<CronDayResponse>,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const jobs = board.data?.jobs ?? [];
  const rows = board.data?.rows ?? [];
  // A one-shot deletes itself when it fires, so the row behind an open drawer can vanish between the
  // click and the next refetch. The drawer is mounted on the FOUND record or not at all.
  const openJob = openJobId !== null ? jobs.find((job) => job.id === openJobId) : undefined;

  return (
    <>
      <C.PluginSection
        title={s.title}
        description={s.sectionHint}
        action={
          <span className="flex flex-wrap items-center gap-2">
            <C.Button variant="outline" onClick={() => setOpening('recurring')} disabled={opening !== null}>{s.createRecurring}</C.Button>
            <C.Button variant="accent" onClick={() => setOpening('oneShot')} disabled={opening !== null}>{s.createOneShot}</C.Button>
          </span>
        }
      >
        {board.isError ? <C.ErrorState message={t.common.daemonUnreachable} onRetry={() => board.refetch()} />
          : board.data === undefined ? <C.LoadingState variant="cards" />
          : jobs.length === 0 ? <C.EmptyState title={s.calEmptyTitle} description={s.calEmptyHint} icon={CalendarDays} />
          : (
            <div className="flex min-w-0 flex-col gap-2" data-testid="cron-deck-day">
              {rows.length === 0 ? (
                <C.EmptyState title={s.calDayEmpty} description={s.calDayEmptyHint} icon={CalendarDays} />
              ) : (
                <C.EntityList>
                  {rows.map((row) => (
                    <CompactJobRow
                      key={row.jobId}
                      row={row}
                      job={jobs.find((job) => job.id === row.jobId)}
                      onOpen={(jobId) => setOpenJobId(jobId)}
                    />
                  ))}
                </C.EntityList>
              )}
              <span className="text-xs text-muted-foreground">
                {s.metricActive} {jobs.filter((job) => job.enabled !== false).length} · {s.metricPaused} {jobs.filter((job) => job.enabled === false).length} · {s.nextRun}{' '}
                {utils.compactElapsed(Date.now() - Date.parse(jobs.find((job) => job.enabled !== false)?.nextOccurrence?.expectedAt ?? board.data.generatedAt))}
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
          onRemoved={() => { setOpenJobId(null); void board.refetch(); }}
          onRefresh={() => void board.refetch()}
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
