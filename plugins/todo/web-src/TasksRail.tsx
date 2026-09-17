import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { CheckCircle2, Circle, CircleDot, ListChecks, MoreHorizontal } from 'lucide-react';
import { runtime, type PluginChatRailSectionProps, type SessionTask } from './runtime';

type RailData = { tasks: SessionTask[] };

function parseData(data: unknown): RailData | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const tasks = (data as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return null;
  const parsed = tasks.map((task): SessionTask | null => {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return null;
    const value = task as Record<string, unknown>;
    const subject = typeof value.subject === 'string' ? value.subject : value.label;
    if (typeof value.id !== 'string' || typeof subject !== 'string'
      || (value.status !== 'pending' && value.status !== 'in_progress' && value.status !== 'completed')
      || !Array.isArray(value.blockedBy) || !value.blockedBy.every((item) => typeof item === 'string')) return null;
    return {
      id: value.id,
      subject,
      description: typeof value.description === 'string' ? value.description : '',
      status: value.status,
      blockedBy: value.blockedBy,
      blocks: [],
      ...(typeof value.startedAt === 'number' ? { startedAt: value.startedAt } : {}),
      ...(typeof value.activeForm === 'string' ? { activeForm: value.activeForm } : {}),
    };
  });
  return parsed.every((task): task is SessionTask => task !== null) ? { tasks: parsed } : null;
}

function RailTaskRow({ task, now, onStatus, open, strings, busy, ActionMenu }: {
  task: SessionTask;
  now: number;
  onStatus: (status: SessionTask['status']) => void;
  open: () => void;
  strings: Record<string, string>;
  busy: boolean;
  ActionMenu: ComponentType<any>;
}) {
  const active = task.status === 'in_progress';
  const elapsed = active && task.startedAt != null ? `${Math.max(0, Math.round((now - task.startedAt) / 1000))}s` : null;
  const label = active && task.activeForm ? task.activeForm : task.subject;
  const actions = [
    { label: strings.pending, onSelect: () => onStatus('pending') },
    { label: strings.inProgress, onSelect: () => onStatus('in_progress') },
    { label: strings.completed, onSelect: () => onStatus('completed') },
  ];
  return (
    <li className="flex min-w-0 items-center gap-1.5" data-testid="telemetry-row">
      {active ? <CircleDot size={11} aria-hidden className="shrink-0 text-primary" /> : task.status === 'completed' ? <CheckCircle2 size={11} aria-hidden className="shrink-0 text-success" /> : <Circle size={11} aria-hidden className="shrink-0 text-muted-foreground" />}
      <button type="button" onClick={open} className="min-w-0 flex-1 truncate text-left text-xs text-foreground hover:text-primary" title={task.subject}>{label}</button>
      {elapsed ? <span className="shrink-0 font-mono text-tiny text-muted-foreground">{elapsed}</span> : null}
      {/* A kebab, not the host's default destructive shape: this menu only changes a status, and the
          filled red square both shouts and takes width the subject needs. */}
      <ActionMenu variant="kebab" items={actions} label={strings.actions + ': ' + label} trigger={<MoreHorizontal size={13} aria-hidden />} disabled={busy} />
    </li>
  );
}

export function TasksRail({ variant, data, sessionId, open }: PluginChatRailSectionProps) {
  const { components: C, hooks } = runtime();
  const strings = hooks.usePluginStrings('todo');
  const parsed = useMemo(() => parseData(data), [data]);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const update = hooks.useUpdateSessionTask();
  useEffect(() => {
    if (!parsed?.tasks.some((task) => task.status === 'in_progress' && task.startedAt != null)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [parsed]);
  if (!parsed || parsed.tasks.length === 0) return null;
  const active = parsed.tasks.filter((task) => task.status !== 'completed');
  if (active.length === 0) return null;
  const shown = expanded ? active : active.slice(0, 4);
  const done = parsed.tasks.length - active.length;
  if (variant === 'compact') return <div data-testid="telemetry-compact-tasks" className="flex w-10 flex-col items-center gap-1 rounded-md px-1 py-1.5" title={strings.railTitle ?? strings.title}><ListChecks size={14} aria-hidden className="text-primary" /><span className="font-mono text-[9px] leading-none text-muted-foreground">{done}/{parsed.tasks.length}</span></div>;
  const setStatus = (task: SessionTask, status: SessionTask['status']): void => {
    if (!sessionId || status === task.status) return;
    update.mutate({ sessionId, taskId: task.id, status });
    setNow(Date.now());
  };
  return (
    <section data-testid="telemetry-tasks" className="flex flex-col gap-1">
      <div className="flex w-full min-w-0 items-center gap-1.5 text-xs uppercase tracking-wide text-subtle-foreground">
        <ListChecks size={11} aria-hidden />
        <span className="min-w-0 truncate">{strings.railTitle ?? strings.title}</span>
        <span className="ml-auto shrink-0 rounded bg-muted px-1 py-0 text-tiny tabular-nums">{done}/{parsed.tasks.length}</span>
      </div>
      {variant === 'expanded' ? <C.Progress className="h-1" value={(done / parsed.tasks.length) * 100} aria-label={strings.railTitle ?? strings.title} /> : null}
      <ul className="flex flex-col gap-0.5">
        {shown.map((task) => <RailTaskRow key={task.id} task={task} now={now} onStatus={(status) => setStatus(task, status)} open={() => open('tasks')} strings={strings} busy={update.isPending} ActionMenu={C.ActionMenu} />)}
      </ul>
      {active.length > shown.length ? <button type="button" onClick={() => setExpanded((value) => !value)} className="self-start px-1 text-tiny text-muted-foreground hover:text-foreground">+{active.length - shown.length} {strings.more}</button> : null}
    </section>
  );
}