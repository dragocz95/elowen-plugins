import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, listen, resetHandlers, setupServer, close } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { TasksPicker } from '../plugins/todo/web-src/TasksPicker';
import { TodoCard } from '../plugins/todo/web-src/TodoCard';
import manifest from '../plugins/todo/elowen-plugin.json';

/** Behaviour of the task surfaces the core handed to this plugin.
 *
 *  `web/tests/modules/advisor/TasksModal.test.tsx` covered these in the core and was deleted when the
 *  modal moved here; the replacement on the core side is one mount assertion, so without this file the
 *  behaviour is asserted nowhere in either repository. These cases are the moved ones, written against
 *  the components that now own the behaviour: what the reader sees, what reaches the daemon, and what
 *  happens when the daemon refuses.
 *
 *  The host hooks are the real ones (`tests/ui/hostHooks`, ported from web/lib/queries + mutations on the
 *  real react-query), so the optimistic patch, its rollback and the invalidation are the app's own. */

ensurePluginUiRuntime();

const SESSION = 'sess-1';
const task = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 't1', subject: 'Write the migration', description: 'Needs the new column first',
  status: 'pending', blockedBy: [] as string[], blocks: [] as string[], ...over,
});

let tasks: ReturnType<typeof task>[] = [];
const received: { patches: unknown[]; deletes: string[]; clears: string[] } = { patches: [], deletes: [], clears: [] };
let patchStatus = 200;

const server = setupServer(
  http.get('/api/plugins/ui', () => HttpResponse.json([{
    name: 'todo', url: '/plugins/todo/web/hash.js', apiVersion: 4,
    nav: [], account: [], user: [], project: [], settings: [],
    strings: manifest.web.strings,
  }])),
  http.get('/api/plugins/todo/api/tasks', () => HttpResponse.json({ tasks })),
  http.patch('/api/plugins/todo/api/task', async ({ request }) => {
    const body = await request.json() as { taskId: string; status?: string; subject?: string };
    received.patches.push(body);
    if (patchStatus !== 200) return HttpResponse.json({ error: 'task is blocked' }, { status: patchStatus });
    tasks = tasks.map((row) => row.id === body.taskId ? { ...row, ...body } : row);
    return HttpResponse.json({ task: tasks.find((row) => row.id === body.taskId), tasks });
  }),
  http.delete('/api/plugins/todo/api/task', ({ request }) => {
    const id = new URL(request.url).searchParams.get('taskId') ?? '';
    received.deletes.push(id);
    tasks = tasks.filter((row) => row.id !== id);
    return HttpResponse.json({ success: true, taskId: id, tasks });
  }),
  http.delete('/api/plugins/todo/api/tasks', ({ request }) => {
    const scope = new URL(request.url).searchParams.get('scope') ?? '';
    received.clears.push(scope);
    tasks = scope === 'all' ? [] : tasks.filter((row) => row.status !== 'completed');
    return HttpResponse.json({ success: true, removed: 1, tasks });
  }),
);

beforeAll(() => listen());
afterEach(() => {
  cleanup();
  resetHandlers();
  tasks = [];
  received.patches = [];
  received.deletes = [];
  received.clears = [];
  patchStatus = 200;
});
afterAll(() => close());

function mount(node: React.ReactNode) {
  const { wrapper: Wrapper } = createWrapper();
  render(<Wrapper><ToastProvider>{node}</ToastProvider></Wrapper>);
}

const picker = (sessionId: string | null = SESSION) =>
  mount(<TasksPicker plugin="todo" command="tasks" sessionId={sessionId} send={() => {}} close={() => {}} />);

describe('the task picker', () => {
  it('shows a task with its description, so a row is readable without opening anything', async () => {
    tasks = [task()];
    picker();
    expect(await screen.findByText('Write the migration')).toBeTruthy();
    // The description is the context the old modal revealed on demand; here it is simply present.
    expect(screen.getByText('Needs the new column first')).toBeTruthy();
  });

  it('ticks a task off through the checkbox and sends exactly that status', async () => {
    tasks = [task()];
    picker();
    const box = await screen.findByLabelText('Write the migration');
    fireEvent.click(box);
    await waitFor(() => expect(received.patches).toEqual([{ taskId: 't1', status: 'completed' }]));
  });

  it('un-ticks a completed task back to pending rather than cycling it forward', async () => {
    tasks = [task({ status: 'completed' })];
    picker();
    const box = await screen.findByLabelText('Write the migration');
    fireEvent.click(box);
    await waitFor(() => expect(received.patches).toEqual([{ taskId: 't1', status: 'pending' }]));
  });

  it('shows a running task as a spinner instead of an unchecked box, so it cannot be ticked by accident', async () => {
    tasks = [task({ status: 'in_progress' })];
    picker();
    expect(await screen.findByText('Write the migration')).toBeTruthy();
    expect(screen.queryByLabelText('Write the migration')).toBeNull();
  });

  it('filters on subject AND description, not on the subject alone', async () => {
    tasks = [task(), task({ id: 't2', subject: 'Ship it', description: 'after review' })];
    picker();
    const filter = await screen.findByLabelText('Filter tasks');
    fireEvent.change(filter, { target: { value: 'review' } });
    await waitFor(() => expect(screen.queryByText('Write the migration')).toBeNull());
    expect(screen.getByText('Ship it')).toBeTruthy();
  });

  it('reports a refused patch and leaves the row as it was, rather than showing it done', async () => {
    tasks = [task()];
    patchStatus = 409;
    picker();
    const box = await screen.findByLabelText('Write the migration');
    fireEvent.click(box);
    // The optimistic flip must roll back: a refused change that stayed on screen is a lie about state.
    expect(await screen.findByText('task is blocked')).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('Write the migration') as HTMLInputElement).getAttribute('data-state')).not.toBe('checked'));
  });

  it('asks before deleting and names the task in the confirmation', async () => {
    tasks = [task()];
    picker();
    const menu = await screen.findByLabelText('Task actions: Write the migration');
    fireEvent.click(menu);
    fireEvent.click(await screen.findByText('Delete'));
    const dialog = await screen.findByRole('dialog', { name: /Delete this task\?/ });
    // Naming the row is the point of the confirmation: it is what tells the reader WHICH task goes.
    expect(within(dialog).getByText('Write the migration')).toBeTruthy();
    expect(received.deletes).toEqual([]);
  });

  it('deletes only after the confirmation is accepted', async () => {
    tasks = [task()];
    picker();
    fireEvent.click(await screen.findByLabelText('Task actions: Write the migration'));
    fireEvent.click(await screen.findByText('Delete'));
    const dialog = await screen.findByRole('dialog', { name: /Delete this task\?/ });
    fireEvent.click(within(dialog).getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(received.deletes).toEqual(['t1']));
  });

  it('offers Clear completed only while something is completed', async () => {
    tasks = [task()];
    picker();
    const button = await screen.findByRole('button', { name: 'Clear completed' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('clears completed tasks behind its own confirmation', async () => {
    tasks = [task({ status: 'completed' }), task({ id: 't2', subject: 'Ship it' })];
    picker();
    fireEvent.click(await screen.findByRole('button', { name: 'Clear completed' }));
    const dialog = await screen.findByRole('dialog', { name: /Clear completed tasks\?/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear completed' }));
    await waitFor(() => expect(received.clears).toEqual(['completed']));
  });

  it('renames a task on Enter and sends the new subject, not a status', async () => {
    tasks = [task()];
    picker();
    fireEvent.click(await screen.findByLabelText('Task actions: Write the migration'));
    fireEvent.click(await screen.findByText('Rename'));
    const input = await screen.findByDisplayValue('Write the migration');
    fireEvent.change(input, { target: { value: 'Write the migration properly' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(received.patches).toEqual([{ taskId: 't1', subject: 'Write the migration properly' }]));
  });

  it('never writes without a session, because a task has nowhere to land', async () => {
    tasks = [task()];
    picker(null);
    expect(await screen.findByText('No tasks')).toBeTruthy();
    expect(received.patches).toEqual([]);
  });
});

describe('the todo chat card', () => {
  it('reads the live task list rather than the frozen card snapshot', async () => {
    // The card arrives with stale text; the query is the newer truth and must win, or a card that was
    // emitted before the last change keeps showing it.
    tasks = [task({ subject: 'Write the migration' })];
    mount(<TodoCard
      card={{ id: 'c1', title: 'Tasks', items: [{ text: 'an older label', id: 't1', status: 'pending' }] }}
      sessionId={SESSION}
      live
      open={() => {}}
    />);
    expect(await screen.findByText('Write the migration')).toBeTruthy();
    expect(screen.queryByText('an older label')).toBeNull();
  });

  it('completes a task from its row menu and reaches the same route the picker uses', async () => {
    // The card is deliberately menu-driven rather than checkbox-driven: its row IS the menu trigger, so
    // a stray click in a narrow chat column cannot silently change a task's status.
    tasks = [task()];
    mount(<TodoCard card={{ id: 'c1', title: 'Tasks', items: [] }} sessionId={SESSION} live open={() => {}} />);
    fireEvent.click(await screen.findByLabelText('Task actions: Write the migration'));
    fireEvent.click(await screen.findByText('Completed'));
    await waitFor(() => expect(received.patches).toEqual([{ taskId: 't1', status: 'completed' }]));
  });

  it('folds the rows away on a click on the head and still says how much is done', async () => {
    tasks = [
      task({ id: 't1', subject: 'Read the code', status: 'completed' }),
      task({ id: 't2', subject: 'Run the suite', status: 'in_progress', startedAt: Date.now() - 60_000 }),
    ];
    mount(<TodoCard card={{ id: 'c1', title: 'Tasks', items: [] }} sessionId={SESSION} live open={() => {}} />);

    // The head is the fold's only trigger, and it starts unfolded.
    const head = await screen.findByRole('button', { expanded: true });
    fireEvent.click(head);
    await waitFor(() => expect(screen.queryByText('Run the suite')).toBeNull());
    // A folded card still reports what it is holding.
    expect(screen.getByText('1/2')).toBeTruthy();

    fireEvent.click(head);
    expect(await screen.findByText('Run the suite')).toBeTruthy();
  });

  it('keeps finished and waiting work in view instead of a flat first four', async () => {
    // Four finished rows sit at the head of the list; the work that matters now is behind them.
    tasks = [
      task({ id: 't1', subject: 'Read the code', status: 'completed' }),
      task({ id: 't2', subject: 'Draft the notes', status: 'completed' }),
      task({ id: 't3', subject: 'Write the migration', status: 'completed' }),
      task({ id: 't4', subject: 'Add the index', status: 'completed' }),
      task({ id: 't5', subject: 'Run the suite', status: 'in_progress', startedAt: Date.now() - 65_000 }),
      task({ id: 't6', subject: 'Ship the release', status: 'pending' }),
    ];
    mount(<TodoCard card={{ id: 'c1', title: 'Tasks', items: [] }} sessionId={SESSION} live open={() => {}} />);

    // Exactly four rows, and they are the host rule's four: the two most recent finished rows, the
    // running one and the waiting one — in source order. A plain first-four preview renders the first
    // two finished rows here instead, which is the regression this guards.
    await screen.findByText('Run the suite');
    expect(screen.getAllByRole('button', { name: /^Task actions: / })).toHaveLength(4);
    expect(screen.getByText('Write the migration')).toBeTruthy();
    expect(screen.getByText('Add the index')).toBeTruthy();
    expect(screen.getByText('Run the suite')).toBeTruthy();
    expect(screen.getByText('Ship the release')).toBeTruthy();
    expect(screen.queryByText('Read the code')).toBeNull();
    expect(screen.queryByText('Draft the notes')).toBeNull();
    // And the card still offers the rest through the list.
    expect(screen.getByRole('button', { name: '+2 more' })).toBeTruthy();
  });

  it('shows the running clock on the in-progress row, ticking', async () => {
    tasks = [
      task({ id: 't1', subject: 'Read the code', status: 'completed' }),
      task({ id: 't2', subject: 'Draft the notes', status: 'completed' }),
      task({ id: 't3', subject: 'Write the migration', status: 'completed' }),
      task({ id: 't4', subject: 'Add the index', status: 'completed' }),
      task({ id: 't5', subject: 'Run the suite', status: 'in_progress', startedAt: Date.now() - 65_000 }),
    ];
    mount(<TodoCard card={{ id: 'c1', title: 'Tasks', items: [] }} sessionId={SESSION} live open={() => {}} />);

    const clock = await screen.findByTestId('chat-card-elapsed');
    expect(clock).toHaveTextContent(/· 1m \d+s/);
    // It is a clock, not a timestamp: a live turn's row keeps counting.
    const first = clock.textContent;
    await waitFor(() => expect(clock.textContent).not.toBe(first), { timeout: 3_000 });
  });
});
