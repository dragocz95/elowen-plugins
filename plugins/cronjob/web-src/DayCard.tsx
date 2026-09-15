import { Clock3, Pencil, Play, Pause } from 'lucide-react';
import { runtime, type CronDayCard, type CronJob } from './runtime';

const stateTone = (state: CronDayCard['state']): string => {
  if (state === 'ok') return 'border-l-emerald-500';
  if (state === 'error') return 'border-l-destructive';
  if (state === 'running') return 'border-l-primary';
  return 'border-l-muted-foreground/50';
};

const stateLabel = (state: CronDayCard['state'], s: Record<string, string>): string => ({
  waiting: s.runWaiting || 'Waiting',
  running: s.runRunning || 'Running',
  ok: s.runOk || 'Succeeded',
  error: s.runErrorState || 'Failed',
  skipped: s.runSkipped || 'Skipped',
  paused: s.paused || 'Paused',
})[state];

export function DayCard({ card, job, compact = false, onOpen, onRun, onToggle }: {
  card: CronDayCard;
  job: CronJob;
  compact?: boolean;
  onOpen(jobId: string): void;
  onRun(job: CronJob): void;
  onToggle(job: CronJob): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const owner = job.owner?.name || job.owner?.username || s.ownerSystem || 'System';
  const hidden = Math.max(0, card.remaining - 1 - card.moreTimes.length);
  return (
    <div
      className={`relative min-w-0 rounded-md border border-border bg-card shadow-[var(--shadow-card)] ${stateTone(card.state)} border-l-[3px]`}
      data-testid={`cron-card-${card.jobId}`}
    >
      <button
        type="button"
        onClick={() => onOpen(card.jobId)}
        className="flex min-h-[44px] w-full min-w-0 flex-col gap-1 px-3 py-2 pr-10 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[var(--touch-target)]"
        aria-label={(s.openJob || 'Open “{name}”').replace('{name}', job.name)}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`size-2 shrink-0 rounded-full ${card.state === 'running' ? 'animate-pulse bg-primary' : card.state === 'ok' ? 'bg-emerald-500' : card.state === 'error' ? 'bg-destructive' : 'bg-muted-foreground/60'}`} />
          <span className="font-mono text-xs font-medium tabular-nums text-foreground">{card.localTime}</span>
          {card.remaining > 1 ? <span className="text-[10px] text-muted-foreground">+{card.remaining - 1}</span> : null}
          <span className="sr-only">{stateLabel(card.state, s)}</span>
        </span>
        <span className="truncate text-sm font-medium text-foreground">{job.name}</span>
        <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
          <C.Avatar name={owner} src={job.owner?.avatar || undefined} size={20} />
          {!compact ? <span className="truncate">{owner}</span> : null}
          {hidden > 0 ? <span className="ml-auto">+{hidden}</span> : null}
        </span>
      </button>
      <div className="absolute right-1 top-1">
        <C.ActionMenu
          variant="kebab"
          label={s.actions || 'Actions'}
          items={[
            { id: 'run', label: s.runNow || 'Run now', icon: Play, disabled: job.lifecycle === 'oneShot', onSelect: () => onRun(job) },
            { id: 'toggle', label: job.enabled === false ? (s.pauseLabelOn || 'Enable') : (s.pauseLabel || 'Pause'), icon: job.enabled === false ? Clock3 : Pause, onSelect: () => onToggle(job) },
            { id: 'edit', label: s.edit || 'Edit', icon: Pencil, onSelect: () => onOpen(job.id) },
          ]}
        />
      </div>
    </div>
  );
}
