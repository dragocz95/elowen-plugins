import { useMemo, useState } from 'react';
import { CheckCircle2, Circle, CircleDot, ListChecks, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { runtime, type PluginChatPickerProps, type SessionTask } from './runtime';

export function TasksPicker({ sessionId, close }: PluginChatPickerProps) {
  const { components: C, hooks, utils } = runtime();
  const strings = hooks.usePluginStrings('todo');
  const { toast } = hooks.useToast();
  const query = hooks.useSessionTasks(sessionId);
  const update = hooks.useUpdateSessionTask();
  const remove = hooks.useDeleteSessionTask();
  const clear = hooks.useClearSessionTasks();
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SessionTask | null>(null);
  const [clearTarget, setClearTarget] = useState<'completed' | 'all' | null>(null);
  const busy = update.isPending || remove.isPending || clear.isPending;
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = query.data?.tasks ?? [];
    return needle ? all.filter((task) => task.subject.toLowerCase().includes(needle) || task.description.toLowerCase().includes(needle)) : all;
  }, [filter, query.data]);
  const patch = (task: SessionTask, value: Partial<Pick<SessionTask, 'status' | 'subject'>>) => {
    if (!sessionId) return;
    update.mutate({ sessionId, taskId: task.id, ...value }, { onError: (error) => toast(utils.apiErrorMessage(error), 'error') });
  };
  const taskActions = (task: SessionTask) => [
    { label: strings.pending, icon: Circle, onSelect: () => patch(task, { status: 'pending' }) },
    { label: strings.inProgress, icon: CircleDot, onSelect: () => patch(task, { status: 'in_progress' }) },
    { label: strings.completed, icon: CheckCircle2, onSelect: () => patch(task, { status: 'completed' }) },
    { label: strings.rename, icon: Pencil, onSelect: () => { setDraft(task.subject); setRenaming(task.id); } },
    { label: strings.delete, icon: Trash2, tone: 'danger', onSelect: () => setDeleteTarget(task) },
  ];
  const runDelete = () => {
    if (!sessionId || !deleteTarget) return;
    remove.mutate({ sessionId, taskId: deleteTarget.id }, { onSuccess: () => setDeleteTarget(null), onError: (error) => toast(utils.apiErrorMessage(error), 'error') });
  };
  const runClear = () => {
    if (!sessionId || !clearTarget) return;
    clear.mutate({ sessionId, scope: clearTarget }, { onSuccess: () => setClearTarget(null), onError: (error) => toast(utils.apiErrorMessage(error), 'error') });
  };
  return (
    <>
      <C.Modal title={strings.title} onClose={close} size="md" icon={ListChecks} intent="inspect">
        <C.ModalBody gap={4}>
          <C.Input value={filter} onChange={(event: { target: { value: string } }) => setFilter(event.target.value)} placeholder={strings.filter} aria-label={strings.filter} />
          {query.isLoading ? <C.LoadingState variant="list" /> : query.isError ? <C.ErrorState message={strings.unavailable} onRetry={() => query.refetch()} /> : rows.length === 0 ? <C.EmptyState title={strings.empty} description={strings.emptyDesc} icon={ListChecks} /> : (
            <div className="flex flex-col gap-px overflow-hidden rounded-md border border-border bg-border/50">
              {rows.map((task) => (
                <div key={task.id} className="flex items-center gap-2 bg-card px-3 py-2">
                  {task.status === 'in_progress' ? <C.Spinner size="xs" /> : <C.Checkbox checked={task.status === 'completed'} disabled={busy} onCheckedChange={() => patch(task, { status: task.status === 'completed' ? 'pending' : 'completed' })} aria-label={task.subject} />}
                  <div className="min-w-0 flex-1">
                    {renaming === task.id ? <C.Input autoFocus value={draft} onChange={(event: { target: { value: string } }) => setDraft(event.target.value)} onBlur={() => { if (draft.trim()) patch(task, { subject: draft.trim() }); setRenaming(null); }} onKeyDown={(event: { key: string; preventDefault(): void }) => { if (event.key === 'Enter') { event.preventDefault(); if (draft.trim()) patch(task, { subject: draft.trim() }); setRenaming(null); } }} /> : <span className={task.status === 'completed' ? 'text-sm text-muted-foreground line-through' : 'text-sm text-foreground'}>{task.subject}</span>}
                    {task.description ? <div className="text-xs text-muted-foreground">{task.description}</div> : null}
                  </div>
                  <C.ActionMenu items={taskActions(task)} label={strings.actions + ': ' + task.subject} trigger={<MoreHorizontal size={15} aria-hidden />} />
                </div>
              ))}
            </div>
          )}
        </C.ModalBody>
        {query.data?.tasks.length ? <C.ModalFooter><C.Button variant="ghost" disabled={busy || !query.data.tasks.some((task) => task.status === 'completed')} onClick={() => setClearTarget('completed')}>{strings.clearCompleted}</C.Button><C.Button variant="ghost-danger" disabled={busy} onClick={() => setClearTarget('all')}>{strings.clearAll}</C.Button></C.ModalFooter> : null}
      </C.Modal>
      <C.ConfirmDialog open={deleteTarget !== null} title={strings.deleteTitle} description={deleteTarget?.subject} pending={remove.isPending} onConfirm={runDelete} onClose={() => setDeleteTarget(null)} />
      <C.ConfirmDialog open={clearTarget !== null} title={clearTarget === 'completed' ? strings.clearCompletedTitle : strings.clearAllTitle} description={clearTarget === 'completed' ? strings.clearCompletedDesc : strings.clearAllDesc} confirmLabel={clearTarget === 'completed' ? strings.clearCompleted : strings.clearAll} pending={clear.isPending} onConfirm={runClear} onClose={() => setClearTarget(null)} />
    </>
  );
}
