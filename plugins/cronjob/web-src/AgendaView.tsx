import { CalendarClock, Clock, ShieldQuestion, AlarmClock } from 'lucide-react';
import {
  runtime, type CronJob, type CronOccurrence,
} from './runtime';

/** The chronological view one calendar day (or up to seven): time-ordered occurrence cards shared by
 *  the desktop side agenda, the full Agenda page view, the mobile daily agenda and the Settings deck.
 *  Cards group simultaneous occurrences but every job stays independently operable, and status words —
 *  Recurring, One-shot, Paused, Guarded, Late, Deferred — never rely on colour alone. */

const statusBadge = (occurrence: CronOccurrence, s: Record<string, string>) => {
  const { components: C } = runtime();
  switch (occurrence.disposition) {
    case 'late': return <C.Badge tone="danger">{s.badgeLate}</C.Badge>;
    case 'catchUp': return <span className="inline-flex items-center gap-1"><AlarmClock size={10} aria-hidden /><C.Badge tone="muted">{s.badgeCatchUp}</C.Badge></span>;
    case 'deferredByHours': return <span className="inline-flex items-center gap-1" title={s.badgeDeferredHint}><ShieldQuestion size={10} aria-hidden /><C.Badge tone="muted">{s.badgeDeferred}</C.Badge></span>;
    case 'dueNow': return <C.Badge tone="muted">{s.badgeDueNow}</C.Badge>;
    default: return null;
  }
};

/** One run as the agenda names it: nearest time, the job behind it, and its state in words. */
function OccurrenceCard({ occurrence, job, onOpen }: {
  occurrence: CronOccurrence;
  job: CronJob | undefined;
  onOpen: (jobId: string) => void;
}) {
  const { components: C } = runtime();
  const s = runtime().hooks.usePluginStrings('cronjob');
  const name = job?.name ?? occurrence.jobId;
  const oneShot = occurrence.lifecycle === 'oneShot';
  const paused = job?.enabled === false;
  return (
    <button
      type="button"
      className="flex min-h-[44px] w-full min-w-0 items-start gap-3 rounded-md border border-border bg-document px-3 py-2 text-left transition-colors hover:border-ring focus-visible:outline-2 focus-visible:outline-ring"
      onClick={() => onOpen(occurrence.jobId)}
      aria-label={s.openJob.replace('{name}', name)}
    >
      <span className="shrink-0 pt-0.5 font-mono text-xs text-foreground tabular-nums">{occurrence.localTime}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm text-foreground">{name}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
          {/* The schedule line: what makes this entry happen. Text, never an anonymous dot. */}
          <span className="inline-flex max-w-full items-center gap-1 truncate">
            {oneShot ? <CalendarClock size={10} aria-hidden /> : <Clock size={10} aria-hidden />}
            {oneShot ? s.badgeOneShot : occurrence.guarded ? <span title={s.badgeGuardedHint}>{job?.schedule ?? ''}</span> : job?.schedule ?? ''}
          </span>
          {occurrence.guarded ? <span className="inline-flex items-center gap-1" title={s.badgeGuardedHint}><ShieldQuestion size={10} aria-hidden /><C.Badge tone="muted">{s.badgeGuarded}</C.Badge></span> : null}
          {paused ? <C.Badge tone="muted">{s.paused}</C.Badge> : null}
          {!paused ? statusBadge(occurrence, s) : null}
          {!paused && !oneShot ? <span className="sr-only">{s.badgeRecurring}</span> : null}
        </span>
      </span>
    </button>
  );
}

/** A chronological day of occurrences, newest planned time first as the server sorted them. */
export function AgendaView({ occurrences, jobs, onOpen }: {
  occurrences: CronOccurrence[];
  jobs: CronJob[];
  onOpen: (jobId: string) => void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const byJob = new Map(jobs.map((j) => [j.id, j]));
  // Paused jobs never expand into occurrences; they stay discoverable in the jobs list, which the
  // deck shows next to the day's occurrences.
  const paused = jobs.filter((j) => j.enabled === false);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="cron-agenda">
      {occurrences.length === 0 && paused.length === 0 ? (
        <C.EmptyState title={s.calDayEmpty} icon={Clock} />
      ) : (
        <>
          {occurrences.map((occurrence) => (
            <OccurrenceCard key={occurrence.id} occurrence={occurrence} job={byJob.get(occurrence.jobId)} onOpen={onOpen} />
          ))}
          {paused.map((job) => (
            <button
              key={job.id}
              type="button"
              className="flex min-h-[44px] w-full min-w-0 items-start gap-3 rounded-md border border-border bg-document px-3 py-2 text-left transition-colors hover:border-ring focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => onOpen(job.id)}
              aria-label={s.openJob.replace('{name}', job.name || s.jobNew)}
            >
              <span className="shrink-0 pt-0.5 font-mono text-xs text-muted-foreground" aria-hidden>—</span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm text-muted-foreground">{job.name || s.jobNew}</span>
                <span className="text-[11px] text-muted-foreground">{s.paused}</span>
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
