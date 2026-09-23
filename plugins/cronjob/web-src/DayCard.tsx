import { Clock3, FileText, Pencil, Play, Pause } from 'lucide-react';
import { runtime, type CronDayCard, type CronJob } from './runtime';

/** One occurrence dot. The state is carried by colour alone in the compact week row, so the readable
 *  label travels with it as screen-reader text wherever the dot is drawn. */
const dotTone = (state: CronDayCard['state']): string => {
  if (state === 'running') return 'animate-pulse bg-primary';
  if (state === 'ok') return 'bg-emerald-500';
  if (state === 'error') return 'bg-destructive';
  if (state === 'skipped') return 'bg-muted-foreground/40';
  if (state === 'paused') return 'border border-muted-foreground/60 bg-transparent';
  return 'border border-muted-foreground/60 bg-transparent';
};

const stateLabel = (state: CronDayCard['state'], s: Record<string, string>): string => ({
  waiting: s.runWaiting || 'Waiting',
  running: s.runRunning || 'Running',
  ok: s.runOk || 'Succeeded',
  error: s.runErrorState || 'Failed',
  skipped: s.runSkipped || 'Skipped',
  paused: s.paused || 'Paused',
})[state];

/** A receipt exists for this job on this day only once the occurrence has left the waiting state; the
 *  week projection derives the card state from that same receipt, so this is the exact condition under
 *  which "show result" has something to open. */
const hasReceipt = (state: CronDayCard['state']): boolean =>
  state === 'ok' || state === 'error' || state === 'skipped' || state === 'running';

export function DayCard({ card, job, localDate, compact = false, onOpen, onRun, onToggle, onShowResult }: {
  card: CronDayCard;
  job: CronJob;
  /** The calendar day this occurrence belongs to — the run register is queried by day, not by "today". */
  localDate: string;
  compact?: boolean;
  onOpen(jobId: string): void;
  onRun(job: CronJob): void;
  onToggle(job: CronJob): void;
  /** Carries the occurrence's own wall-clock time as well: a job that fires several times a day has one
   *  receipt per fire, and the menu belongs to THIS line, not to the day's newest run. */
  onShowResult?(job: CronJob, localDate: string, localTime: string): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const owner = job.owner?.name || job.owner?.username || s.ownerSystem || 'System';
  const hidden = Math.max(0, card.remaining - 1 - card.moreTimes.length);
  const paused = card.state === 'paused';
  const items = [
    ...(onShowResult && hasReceipt(card.state)
      ? [{ id: 'result', label: s.showResult || 'Show result', icon: FileText, onSelect: () => onShowResult(job, localDate, card.localTime) }]
      : []),
    { id: 'run', label: s.runNow || 'Run now', icon: Play, disabled: job.lifecycle === 'oneShot', onSelect: () => onRun(job) },
    { id: 'toggle', label: job.enabled === false ? (s.pauseLabelOn || 'Enable') : (s.pauseLabel || 'Pause'), icon: job.enabled === false ? Clock3 : Pause, onSelect: () => onToggle(job) },
    { id: 'edit', label: s.edit || 'Edit', icon: Pencil, onSelect: () => onOpen(job.id) },
  ];

  // The week column is a dense agenda: one line per occurrence, no card chrome, and the kebab appears
  // only under the pointer (or permanently on touch, where there is no hover to reveal it).
  if (compact) {
    return (
      <div className="group/card relative min-w-0" data-testid={`cron-card-${card.jobId}`}>
        <button
          type="button"
          onClick={() => onOpen(card.jobId)}
          className={`flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md pl-1.5 pr-7 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${paused ? 'opacity-55' : ''} ${card.state === 'error' ? 'bg-destructive/[0.07]' : ''}`}
          /* An `aria-label` REPLACES the element's text, so the time, the owner and the state have to be
             part of it — as sibling `sr-only` text they were simply never announced. */
          aria-label={`${(s.openJob || 'Open “{name}”').replace('{name}', job.name)} · ${card.localTime} · ${owner} · ${stateLabel(card.state, s)}`}
        >
          <span className={`size-1.5 shrink-0 rounded-full ${dotTone(card.state)}`} />
          <span className="shrink-0 font-mono text-meta tabular-nums text-muted-foreground">{card.localTime}</span>
          <span className="truncate text-xs text-foreground">{job.name}</span>
          {card.remaining > 1 ? <span className="ml-auto shrink-0 text-meta tabular-nums text-muted-foreground">+{card.remaining - 1}</span> : null}
        </button>
        {/* Centred with `inset-y-0` and flex, NEVER with a transform: a transformed box becomes a
            stacking context, and the menu it holds — however high its own z-index — is then trapped
            under the rows that come after this one in the document. */}
        <div className="absolute inset-y-0 right-0 flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100 pointer-coarse:opacity-100">
          <C.ActionMenu variant="kebab" label={s.actions || 'Actions'} items={items} />
        </div>
      </div>
    );
  }

  return (
    // The paused wash goes on the ROW, never on this wrapper: an element below full opacity becomes a
    // stacking context, and the actions menu inside it was then painted under the following cards and
    // faded along with them — the three dots were unreadable and the panel see-through.
    <div
      className="relative min-w-0 rounded-lg border border-hairline bg-control"
      data-testid={`cron-card-${card.jobId}`}
    >
      <button
        type="button"
        onClick={() => onOpen(card.jobId)}
        /* `pl-3 pr-10`, never `px-3 pr-10`: both set the row's right padding and the shorthand wins in the
           generated stylesheet, so the space reserved for the kebab disappeared and the owner avatar sat
           under it. */
        className={`flex min-h-[44px] w-full min-w-0 items-center gap-3 rounded-lg py-2.5 pl-3 pr-10 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[var(--touch-target)] ${paused ? 'opacity-70' : ''}`}
        aria-label={(s.openJob || 'Open “{name}”').replace('{name}', job.name)}
      >
        <span className="flex w-14 shrink-0 items-center gap-1.5">
          <span className={`size-2 shrink-0 rounded-full ${dotTone(card.state)}`} />
          <span className="font-mono text-xs font-medium tabular-nums text-foreground">{card.localTime}</span>
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{job.name}</span>
          <span className="truncate text-meta text-muted-foreground">{owner}</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-meta text-muted-foreground">
          {card.remaining > 1 ? <span className="tabular-nums">+{card.remaining - 1}</span> : null}
          {hidden > 0 ? <span className="tabular-nums">+{hidden}</span> : null}
          <C.Avatar name={owner} src={job.owner?.avatar || undefined} size={20} />
        </span>
        <span className="sr-only">{stateLabel(card.state, s)}</span>
      </button>
      <div className="absolute inset-y-0 right-1 flex items-center">
        <C.ActionMenu variant="kebab" label={s.actions || 'Actions'} items={items} />
      </div>
    </div>
  );
}
