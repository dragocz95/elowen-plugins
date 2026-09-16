import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, CircleDot, ListChecks } from 'lucide-react';
import { runtime, type PluginChatCardProps, type SessionTask } from './runtime';

function useClock(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

/** The todo plugin's registered chat card. It reads the current task projection so changes made by this
 * card or the full picker are reflected without a core-side card rebuild. */
export function TodoCard({ card, sessionId, live, open }: PluginChatCardProps) {
  const { components: C, hooks, utils } = runtime();
  const strings = hooks.usePluginStrings('todo');
  const query = hooks.useSessionTasks(sessionId);
  const update = hooks.useUpdateSessionTask();
  const tasks = query.data?.tasks ?? (card.items ?? []).flatMap((item) => item.id ? [{
    id: item.id,
    subject: item.label ?? item.text,
    description: '',
    status: item.status ?? 'pending',
    ...(item.startedAt === undefined ? {} : { startedAt: item.startedAt }),
    ...(item.owner === undefined ? {} : { owner: item.owner }),
    blockedBy: item.blockedBy ?? [],
    blocks: [],
  }] : [] as SessionTask[]);
  const now = useClock(live && tasks.some((task) => task.status === 'in_progress' && task.startedAt != null));
  const setStatus = (task: SessionTask, status: SessionTask['status']): void => {
    if (!sessionId || status === task.status) return;
    update.mutate({ sessionId, taskId: task.id, status });
  };
  const taskActions = (task: SessionTask) => [
    { label: strings.pending, icon: Circle, onSelect: () => setStatus(task, 'pending') },
    { label: strings.inProgress, icon: CircleDot, onSelect: () => setStatus(task, 'in_progress') },
    { label: strings.completed, icon: CheckCircle2, onSelect: () => setStatus(task, 'completed') },
  ];
  if (tasks.length > 0 && tasks.every((task) => task.status === 'completed')) return null;
  const done = tasks.filter((task) => task.status === 'completed').length;
  return (
    <div data-testid="chat-card" className="flex max-w-[min(100%,28rem)] flex-col self-start leading-tight">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <button type="button" onClick={() => open('tasks')} className="flex min-w-0 items-center gap-1.5 text-left hover:text-foreground" aria-label={strings.title}>
          <ListChecks size={12} aria-hidden />
          <span className="truncate">{strings.title}</span>
          <span className="tabular-nums opacity-70">{done}/{tasks.length}</span>
        </button>
        <button type="button" onClick={() => open('tasks')} className="ml-auto rounded px-1 text-xs hover:bg-accent" aria-label={strings.open} title={strings.open}>↗</button>
      </div>
      <ul className="flex flex-col">
        {tasks.slice(0, 4).map((task) => {
          const label = task.status === 'in_progress' && task.activeForm ? task.activeForm : task.subject;
          const elapsed = task.status === 'in_progress' && task.startedAt != null ? utils.formatDuration(now - task.startedAt) : null;
          return (
            <li key={task.id} className="flex min-w-0 items-center gap-1">
              <C.ActionMenu
                items={taskActions(task)}
                label={strings.actions + ': ' + label}
                trigger={<span className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent">
                  {task.status === 'in_progress' ? <C.Spinner size="xs" /> : task.status === 'completed' ? <CheckCircle2 size={11} aria-hidden className="shrink-0 text-success" /> : <Circle size={11} aria-hidden className="shrink-0 text-muted-foreground" />}
                  <span className={`min-w-0 flex-1 truncate ${task.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{label}</span>
                  {elapsed ? <span className="shrink-0 tabular-nums text-primary">· {elapsed}</span> : null}
                </span>}
              />
            </li>
          );
        })}
      </ul>
      {tasks.length > 4 ? <button type="button" onClick={() => open('tasks')} className="self-start px-1 text-xs text-muted-foreground hover:text-foreground">+{tasks.length - 4} more</button> : null}
      {card.body ? <div className="whitespace-pre-wrap break-words text-muted-foreground">{card.body}</div> : null}
    </div>
  );
}
