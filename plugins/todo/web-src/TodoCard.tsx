import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, Circle, CircleDot, ListChecks } from 'lucide-react';
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
 * card or the full picker are reflected without a core-side card rebuild.
 *
 *  The card folds from its head — the ticked tally and the meter stay on screen when the rows are away —
 *  and it previews through the HOST's `todoPreviewItems`, so finished and open work share the four
 *  visible rows instead of a finished block crowding the running one out of the card. Both come from
 *  `window.ElowenUiRuntime`: the host card, the CLI panel and this bundle all show the same selection. */
export function TodoCard({ card, sessionId, live, open }: PluginChatCardProps) {
  const { components: C, hooks, utils } = runtime();
  const strings = hooks.usePluginStrings('todo');
  const query = hooks.useSessionTasks(sessionId);
  const update = hooks.useUpdateSessionTask();
  const [collapsed, setCollapsed] = useState(false);
  // The pushed card is the plugin's own snapshot, taken when the list last changed: a task tool emits one
  // per call, and a browser mutation writes one from its route. NOTHING else invalidates this query while
  // an agent works, so the cached read has to follow the push — otherwise the card keeps rendering the
  // list as it was at the last fetch while the rail, which the host feeds from the card itself, is new.
  // The daemon hands over a fresh card object per event, and only such an object refetches: the read on
  // mount already covers the payload the card arrives with.
  const { refetch } = query;
  const pushedCard = useRef(card);
  useEffect(() => {
    if (pushedCard.current === card) return;
    pushedCard.current = card;
    if (sessionId) void refetch();
  }, [card, refetch, sessionId]);
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
  const previewable = tasks.length > utils.TODO_PREVIEW_ITEMS;
  const shown = collapsed ? [] : utils.todoPreviewItems(tasks, utils.TODO_PREVIEW_ITEMS);
  return (
    <div data-testid="chat-card" className="flex max-w-[min(100%,28rem)] flex-col self-start leading-tight">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          className="flex min-w-0 items-center gap-1.5 text-left text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight size={11} aria-hidden className={`shrink-0 opacity-60 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
          <span className="truncate">{strings.title}</span>
          <span className="shrink-0 tabular-nums opacity-70">{done}/{tasks.length}</span>
        </button>
        <C.Progress className="h-0.5 w-10 shrink-0" value={(done / tasks.length) * 100} aria-label={strings.title} />
        <C.Button
          variant="ghost"
          size="icon"
          onClick={() => open('tasks')}
          aria-label={strings.open}
          title={strings.open}
          className="size-6 shrink-0 rounded"
        >
          <ListChecks size={12} aria-hidden />
        </C.Button>
      </div>
      {shown.length > 0 ? (
        <ul className="flex flex-col">
          {shown.map((task) => {
            const label = task.status === 'in_progress' && task.activeForm ? task.activeForm : task.subject;
            const elapsed = task.status === 'in_progress' && task.startedAt != null ? utils.formatDuration(now - task.startedAt) : null;
            return (
              <li key={task.id} className="flex min-w-0 items-center gap-1">
                <C.ActionMenu
                  items={taskActions(task)}
                  label={strings.actions + ': ' + label}
                  align="left"
                  openOnHover={false}
                  // Without these the host styles the trigger as its DEFAULT icon button — a fixed 32x32
                  // destructive square — which squeezes the subject to zero width and pushes the elapsed
                  // time past the card's edge. The row is a full-width line, so it claims the column
                  // (`min-w-0 flex-1` on the wrapper, `w-full` on the trigger) and only the subject gives.
                  className="min-w-0 flex-1"
                  triggerClassName="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-accent"
                  trigger={<>
                    {task.status === 'in_progress' ? <C.Spinner size="xs" tone="text-primary" /> : task.status === 'completed' ? <CheckCircle2 size={11} aria-hidden className="shrink-0 text-success" /> : <Circle size={11} aria-hidden className="shrink-0 text-muted-foreground" />}
                    <span title={label} className={`min-w-0 flex-1 truncate ${task.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{label}</span>
                    {elapsed ? <span data-testid="chat-card-elapsed" className="shrink-0 tabular-nums text-primary">· {elapsed}</span> : null}
                  </>}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
      {!collapsed && previewable ? (
        <button type="button" onClick={() => open('tasks')} className="self-start px-1 text-xs text-muted-foreground hover:text-foreground">+{tasks.length - utils.TODO_PREVIEW_ITEMS} {strings.more}</button>
      ) : null}
      {!collapsed && card.body ? <div className="whitespace-pre-wrap break-words text-muted-foreground">{card.body}</div> : null}
    </div>
  );
}
