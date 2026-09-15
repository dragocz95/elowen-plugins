import { useState } from 'react';
import { Clock, ExternalLink } from 'lucide-react';
import { runtime, type CronJob, type CronRunRow } from './runtime';

type BrainMessage = {
  id: string;
  role?: string;
  text?: string;
  content?: unknown;
};

const contentText = (message: BrainMessage): string => {
  if (typeof message.text === 'string') return message.text;
  if (typeof message.content === 'string') {
    try {
      const parsed = JSON.parse(message.content) as { content?: unknown };
      if (typeof parsed.content === 'string') return parsed.content;
      if (Array.isArray(parsed.content)) {
        return parsed.content
          .filter((part): part is { type: string; text: string } =>
            typeof part === 'object' && part !== null
            && (part as { type?: unknown }).type === 'text'
            && typeof (part as { text?: unknown }).text === 'string')
          .map((part) => part.text)
          .join('\n');
      }
    } catch {
      return message.content;
    }
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter((part): part is { type: string; text: string } =>
        typeof part === 'object' && part !== null
        && (part as { type?: unknown }).type === 'text'
        && typeof (part as { text?: unknown }).text === 'string')
      .map((part) => part.text)
      .join('\n');
  }
  return '';
};

const statusLabel = (run: CronRunRow, s: Record<string, string>): string => ({
  waiting: s.runWaiting || 'Waiting',
  running: s.runRunning || 'Running',
  ok: s.runOk || 'Succeeded',
  error: s.runErrorState || 'Failed',
  skipped: s.runSkipped || 'Skipped',
})[run.outcome];

const tone = (run: CronRunRow): string =>
  run.outcome === 'ok' ? 'success' : run.outcome === 'error' ? 'danger' : run.outcome === 'running' ? 'accent' : 'muted';

export function RunResultModal({ run: initial, job, onClose, onOpenJob, onRun }: {
  run: CronRunRow;
  job?: CronJob;
  onClose(): void;
  onOpenJob(jobId: string): void;
  onRun?(job: CronJob): void;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('cronjob');
  const { t, locale } = hooks.useTranslation();
  const detail = hooks.useQuery<CronRunRow>({
    queryKey: ['cron-run', initial.id],
    queryFn: () => runtime().api(`/plugins/cronjob/api/runs/${encodeURIComponent(initial.id)}`) as Promise<CronRunRow>,
    staleTime: 30_000,
  });
  const run = detail.data ?? initial;
  const [full, setFull] = useState<{ state: 'idle' | 'loading' | 'ready' | 'gone'; text?: string }>({ state: 'idle' });
  const showFull = async () => {
    if (!run.sessionId || !run.messageId) return;
    setFull({ state: 'loading' });
    try {
      const response = await runtime().api(`/brain/messages?session=${encodeURIComponent(run.sessionId)}`) as BrainMessage[] | { messages?: BrainMessage[] };
      const messages = Array.isArray(response) ? response : response.messages ?? [];
      const exact = messages.find((message) => message.id === run.messageId);
      const text = exact ? contentText(exact) : '';
      setFull(text ? { state: 'ready', text } : { state: 'gone' });
    } catch {
      setFull({ state: 'gone' });
    }
  };
  const format = (value: string | null): string => value
    ? new Intl.DateTimeFormat(locale || undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value))
    : '—';

  return (
    <C.Modal
      title={run.jobName}
      onClose={onClose}
      closeLabel={t.common.close}
      size="lg"
      presentation="auto"
      intent="inspect"
      data-testid="cron-run-modal"
    >
      <C.ModalBody gap={5}>
        <div className="flex flex-wrap items-center gap-2">
          <C.Badge tone={tone(run)}>{statusLabel(run, s)}</C.Badge>
          <span className="text-xs text-muted-foreground">{run.trigger}</span>
        </div>
        {run.errorMessage ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {run.errorMessage}
          </div>
        ) : null}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">{s.runScheduledAt || 'Scheduled'}</dt><dd className="font-mono text-xs">{run.localDate} {run.localTime} {run.timezone}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{s.runStartedAt || 'Started'}</dt><dd>{format(run.startedAt)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{s.runFinishedAt || 'Finished'}</dt><dd>{format(run.finishedAt)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{s.colDuration || 'Duration'}</dt><dd>{run.durationMs === null ? '—' : `${Math.round(run.durationMs / 100) / 10} s`}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{s.schedule || 'Schedule'}</dt><dd>{run.schedule || s.badgeOneShot}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{s.colModel || 'Model'}</dt><dd>{run.model || '—'}{run.tokensTotal !== undefined ? ` · ${run.tokensTotal} tokens` : ''}</dd></div>
        </dl>
        {job ? (
          <C.Button variant="outline" icon={ExternalLink} onClick={() => onOpenJob(job.id)}>
            {s.runOpenJob || 'Open job'}
          </C.Button>
        ) : null}
        <section className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-medium">{s.runResultTitle || 'Result'}</h3>
          {run.preview ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-canvas p-3 text-xs">{run.preview}</pre> : <p className="text-sm text-muted-foreground">{s.runNoResult || 'No result body was recorded.'}</p>}
          {full.state === 'ready' ? (
            <pre className="max-h-[50dvh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-canvas p-3 text-xs" data-testid="cron-run-full-result">{full.text}</pre>
          ) : null}
          {full.state === 'gone' ? <p className="text-sm text-muted-foreground">{s.runResultGone || 'The full transcript result is no longer available. The preview above was retained.'}</p> : null}
          {run.sessionId && run.messageId && full.state !== 'ready' && full.state !== 'gone' ? (
            <C.Button variant="outline" icon={Clock} disabled={full.state === 'loading'} onClick={() => void showFull()}>
              {full.state === 'loading' ? (s.loading || 'Loading…') : (s.runFullResult || 'Show full result')}
            </C.Button>
          ) : null}
        </section>
      </C.ModalBody>
      <C.ModalFooter>
        {run.outcome === 'error' && job && onRun ? <C.Button variant="accent" onClick={() => onRun(job)}>{s.runNow || 'Run now'}</C.Button> : null}
        <C.Button variant="outline" onClick={onClose}>{t.common.close}</C.Button>
      </C.ModalFooter>
    </C.Modal>
  );
}
