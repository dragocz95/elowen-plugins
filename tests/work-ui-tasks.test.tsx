/** The work bundle's task register: the card, the epic group, the list view, its project filter and
 *  the detail rail.
 *
 *  The panels resolve every component, hook and helper through `window.ElowenUiRuntime` at module scope,
 *  so the runtime is installed BEFORE they are imported — the same order the host page uses in the
 *  browser. HTTP goes through the fetch router in tests/ui/http.ts; each block installs its own fixture
 *  in a `beforeEach`, because these views disagree about what the workspace contains (one project or
 *  two, six tasks or none) and a single merged default would make every assertion read against a
 *  workspace no single test describes.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import type { ComponentProps, DragEvent } from 'react';
import { http, HttpResponse, setupServer, onUnhandledRequest } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';

ensurePluginUiRuntime();
const { TaskCard } = await import('../plugins/work/web-src/tasks/TaskCard');
const { useTaskDrop } = await import('../plugins/work/web-src/tasks/useTaskDrop');
const { EpicGroup } = await import('../plugins/work/web-src/tasks/EpicGroup');
const { TasksView } = await import('../plugins/work/web-src/tasks/TasksView');
const { TaskDetailPane } = await import('../plugins/work/web-src/tasks/TaskDetailPane');
const { TaskConversation } = await import('../plugins/work/web-src/tasks/TaskConversation');
const { TaskResultsModal } = await import('../plugins/work/web-src/tasks/TaskResultsModal');

import type { Task } from '../plugins/work/web-src/types';
import { parseExecRef } from '../plugins/work/web-src/lib/execs';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest }));
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); server.resetHandlers(); });
afterAll(() => server.close());

const makeDrop = (taskId: string) => ({ dataTransfer: { getData: () => taskId, setData: () => {}, dropEffect: '' } });

// ── TaskCard ─────────────────────────────────────────────────────────────────

describe('TaskCard drag-onto-card', () => {
  const task = (over: Partial<Task> & { id: string }): Task => ({ title: over.id, status: 'open', project_id: 1, ...over });

  beforeEach(() => {
    server.use(
      http.get('*/api/sessions', () => HttpResponse.json([])),
      http.get('*/api/projects', () => HttpResponse.json([{ id: 1, slug: 'elowen', path: '/var/www/elowen', notes: '', icon: '', pr_enabled: null }])),
      http.get('*/api/config', () => HttpResponse.json({})),
    );
  });

  it('opens from Enter or Space without handling key events from nested controls', () => {
    const open = vi.fn();
    const { wrapper: W } = createWrapper();
    render(
      <ToastProvider><TaskCard task={task({ id: 'keyboard', title: 'Keyboard task' })} onEdit={open} /></ToastProvider>,
      { wrapper: W },
    );

    const card = screen.getByText('Keyboard task').closest('[role="button"]')!;
    expect(card).toHaveClass('px-4');
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(open).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Start' }), { key: 'Enter' });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('dropping a dragged task onto a plain task card opens the make-subtask/add-dependency choice', () => {
    function Harness() {
      const a = task({ id: 'a', title: 'Alpha' });
      const b = task({ id: 'b', title: 'Beta' });
      const taskDrop = useTaskDrop([a, b], new Map(), new Set());
      return (
        <>
          <TaskCard task={b} onEdit={() => {}} onDropTask={(e) => taskDrop.handleDrop(e, b)} dropTargetValid={taskDrop.isValidTarget('a', b)} />
          {taskDrop.popup}
        </>
      );
    }
    const { wrapper: W } = createWrapper();
    render(<ToastProvider><Harness /></ToastProvider>, { wrapper: W });
    fireEvent.drop(screen.getByText('Beta'), makeDrop('a'));
    expect(screen.getByRole('menuitem', { name: 'Make subtask of Beta' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Add dependency on Beta' })).toBeTruthy();
  });

  it('dropping onto an epic card reparents directly with no popup', async () => {
    server.use(http.patch('*/api/tasks/:id', () => HttpResponse.json({ id: 'a', title: 'Alpha', status: 'open', type: 'task', parent_id: 'epic' })));
    function Harness() {
      const a = task({ id: 'a', title: 'Alpha' });
      const epic = task({ id: 'epic', title: 'Mission Epic', type: 'epic' });
      const taskDrop = useTaskDrop([a, epic], new Map(), new Set());
      return (
        <>
          <TaskCard task={epic} onEdit={() => {}} onDropTask={(e) => taskDrop.handleDrop(e, epic)} dropTargetValid={taskDrop.isValidTarget('a', epic)} />
          {taskDrop.popup}
        </>
      );
    }
    const { wrapper: W } = createWrapper();
    render(<ToastProvider><Harness /></ToastProvider>, { wrapper: W });
    fireEvent.drop(screen.getByText('Mission Epic'), makeDrop('a'));
    expect(screen.queryByRole('menuitem')).toBeNull();
    await waitFor(() => expect(screen.getByText('Added as a subtask of Mission Epic')).toBeTruthy());
  });

  it('a phase card (isPhase) is not draggable and ignores drops', () => {
    const { wrapper: W } = createWrapper();
    render(
      <ToastProvider><TaskCard task={task({ id: 'p', title: 'Phase' })} onEdit={() => {}} isPhase onDropTask={() => { throw new Error('must not be called'); }} /></ToastProvider>,
      { wrapper: W },
    );
    const card = screen.getByText('Phase').closest('[role="button"]')!;
    expect(card.getAttribute('draggable')).toBe('false');
    expect(() => fireEvent.drop(card, makeDrop('x'))).not.toThrow();
  });
});

// ── EpicGroup ────────────────────────────────────────────────────────────────

const epic: Task = { id: 'elowen-epic', title: 'Ship feature', status: 'in_progress', type: 'epic', project_id: 1 };
const phases: Task[] = [
  { id: 'elowen-p1', title: 'Phase One', status: 'closed', parent_id: 'elowen-epic' },
  { id: 'elowen-p2', title: 'Phase Two', status: 'open', parent_id: 'elowen-epic' },
];

function renderEpic(extra: Partial<ComponentProps<typeof EpicGroup>> = {}) {
  const { wrapper: W } = createWrapper();
  return render(
    <ToastProvider>
      <EpicGroup
        epic={epic}
        phases={phases}
        expanded={false}
        onToggle={() => {}}
        onEdit={() => {}}
        onSelect={() => {}}
        activeId={null}
        blockedBy={new Map()}
        {...extra}
      />
    </ToastProvider>,
    { wrapper: W },
  );
}

/** The workspace EpicGroup reads: one project, the agents plugin present, no missions yet. */
function epicFixture() {
  server.use(
    http.get('*/api/plugins/ui', () => HttpResponse.json([{ name: 'agents', url: '/plugins/agents/web/index.js', apiVersion: 1, nav: [], settings: [] }])),
    http.get('*/api/sessions', () => HttpResponse.json([])),
    http.get('*/api/projects', () => HttpResponse.json([{ id: 1, slug: 'elowen', path: '/var/www/elowen', notes: '', icon: '', pr_enabled: null }])),
    // EpicGroup now drives the mission lifecycle + rolled-up cost, so it reads these too.
    http.get('*/api/missions', () => HttpResponse.json([])),
    http.get('*/api/config', () => HttpResponse.json({})),
    http.get('*/api/tasks/:id/usage', () => HttpResponse.json({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: null })),
  );
}

describe('EpicGroup — delete mission', () => {
  beforeEach(epicFixture);

  it('uses the same horizontal register rhythm as plain task rows', () => {
    renderEpic();
    expect(screen.getByRole('button', { name: /ship feature/i })).toHaveClass('px-4');
  });

  it('confirming the delete-mission action issues DELETE /tasks/:id?subtree=1', async () => {
    let deleted: { id: string; subtree: string | null } | null = null;
    server.use(
      http.delete('*/api/tasks/:id', ({ params, request }) => {
        const url = new URL(request.url);
        deleted = { id: params.id as string, subtree: url.searchParams.get('subtree') };
        return HttpResponse.json({ ok: true, tasks: 3 });
      }),
    );

    renderEpic();

    // Open the epic action menu, then pick "Delete mission" → opens the confirm dialog.
    fireEvent.click(screen.getByRole('button', { name: /mission actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /delete mission/i }));

    // Confirm copy makes the irreversible, files-untouched scope explicit.
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(screen.getByText(/does not touch any files/i)).toBeInTheDocument();

    // The confirm button lives in the dialog footer (not the menu trigger, which has aria-haspopup).
    const confirm = screen.getAllByRole('button', { name: /delete mission/i }).find((b) => !b.hasAttribute('aria-haspopup'));
    fireEvent.click(confirm!);

    await waitFor(() => expect(deleted).toEqual({ id: 'elowen-epic', subtree: '1' }));
  });

  it('cancelling the confirm dialog does not delete', async () => {
    const calls = vi.fn();
    server.use(
      http.delete('*/api/tasks/:id', () => { calls(); return HttpResponse.json({ ok: true, tasks: 0 }); }),
    );

    renderEpic();
    fireEvent.click(screen.getByRole('button', { name: /mission actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /delete mission/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await new Promise((r) => setTimeout(r, 20));
    expect(calls).not.toHaveBeenCalled();
  });
});

describe('EpicGroup — agents plugin gating', () => {
  beforeEach(epicFixture);

  it('hides the whole mission actions row (engage & co.) when the agents plugin is absent', async () => {
    // Every pill in the row drives the plugin's mission engine / PR flow — without the plugin the
    // clicks could only answer 503, so the row hides as one block.
    server.use(http.get('*/api/plugins/ui', () => HttpResponse.json([])));
    renderEpic();
    await screen.findByText('Ship feature'); // rendered
    expect(screen.queryByRole('button', { name: /engage/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /open pr/i })).toBeNull();
  });
});

describe('EpicGroup — PR-native surface', () => {
  beforeEach(epicFixture);

  const mission = (pr: unknown) => ({ id: 'm-elowen-epic', epic_id: 'elowen-epic', autonomy: 'L3', max_sessions: 1, state: 'disengaged', pr });

  it('links out to the open PR when one exists', async () => {
    server.use(http.get('*/api/missions', () => HttpResponse.json([mission({ branch: 'elowen/x', prNumber: 42, prUrl: 'https://github.com/o/r/pull/42', prState: 'open' })])));
    renderEpic();
    const link = await screen.findByTitle(/view pull request/i);
    expect(link).toHaveAttribute('href', 'https://github.com/o/r/pull/42');
    expect(link.textContent).toContain('42');
  });

  it('offers "Open PR" (POST /missions/:id/pr) only once the mission is ready', async () => {
    let opened: string | null = null;
    server.use(
      http.get('*/api/missions', () => HttpResponse.json([mission({ branch: 'elowen/x', prNumber: null, prUrl: null, prState: 'ready' })])),
      http.post('*/api/missions/:id/pr', ({ params }) => { opened = params.id as string; return HttpResponse.json({ url: 'https://github.com/o/r/pull/9', number: 9 }); }),
    );
    renderEpic();
    const btn = await screen.findByRole('button', { name: /open pr/i });
    fireEvent.click(btn);
    await waitFor(() => expect(opened).toBe('m-elowen-epic'));
  });

  it('does NOT offer "Open PR" mid-mission (worktree provisioned but no phases done yet)', async () => {
    // The regression guard: prState null means the mission just engaged / is still running — the
    // affordance must stay hidden so a partial PR can't be opened after only the first phase.
    server.use(http.get('*/api/missions', () => HttpResponse.json([mission({ branch: 'elowen/x', prNumber: null, prUrl: null, prState: null })])));
    renderEpic();
    await screen.findByText('Ship feature'); // rendered
    expect(screen.queryByRole('button', { name: /open pr/i })).toBeNull();
  });

  it('shows neither link nor button when the verify gate failed', async () => {
    server.use(http.get('*/api/missions', () => HttpResponse.json([mission({ branch: 'elowen/x', prNumber: null, prUrl: null, prState: 'verify_failed' })])));
    renderEpic();
    await screen.findByText('Ship feature'); // rendered
    expect(screen.queryByRole('link', { name: /view pull request/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /open pr/i })).toBeNull();
  });
});

describe('EpicGroup — drag a task card onto the group header', () => {
  beforeEach(epicFixture);

  it('routes a card-onto-header drop to onDropTask (the mission-attach gesture)', () => {
    const onDropTask = vi.fn((e: DragEvent) => e.preventDefault());
    renderEpic({ onDropTask, dropTargetValid: true });
    fireEvent.drop(screen.getByText('Ship feature'), makeDrop('elowen-other'));
    expect(onDropTask).toHaveBeenCalledTimes(1);
  });

  it('applies an accent highlight while a valid drag hovers, and clears it after drop', () => {
    const onDropTask = vi.fn((e: DragEvent) => e.preventDefault());
    renderEpic({ onDropTask, dropTargetValid: true });
    const header = screen.getByText('Ship feature');
    fireEvent.dragEnter(header, makeDrop('elowen-other'));
    const card = header.closest('.group\\/epic')!;
    expect(card.className).toMatch(/ring-accent/);
    fireEvent.drop(header, makeDrop('elowen-other'));
    expect(card.className).not.toMatch(/ring-accent/);
  });
});

// ── TasksView ────────────────────────────────────────────────────────────────

describe('TasksView', () => {
  let spawnBody: unknown = null;

  beforeEach(() => {
    spawnBody = null;
    server.use(
      http.get('*/api/tasks', () => HttpResponse.json([
        { id: 'elowen-1', title: 'Build', status: 'in_progress', type: 'task', labels: [] },
        { id: 'elowen-2', title: 'Plan', status: 'open', type: 'task', labels: [] },
        { id: 'elowen-3', title: 'Wait', status: 'blocked', type: 'task', labels: [] },
        { id: 'elowen-4', title: 'Done', status: 'closed', type: 'task', labels: [] },
        { id: 'elowen-5', title: 'Mission', status: 'open', type: 'epic', labels: [] },
        { id: 'elowen-6', parent_id: 'elowen-5', title: 'Phase', status: 'open', type: 'task', labels: [] },
      ])),
      http.get('*/api/projects', () => HttpResponse.json([
        { id: 1, slug: 'alpha', path: '/repo/alpha', notes: '', icon: '', pr_enabled: null },
        { id: 2, slug: 'beta', path: '/repo/beta', notes: '', icon: '', pr_enabled: null },
      ])),
      http.get('*/api/config', () => HttpResponse.json({ autopilot: { overseerExec: '' }, defaults: { exec: '', autonomy: 'L3', maxSessions: 1 } })),
      http.post('*/api/sessions', async ({ request }) => { spawnBody = await request.json(); return HttpResponse.json({ session: 'elowen-A' }, { status: 201 }); }),
    );
  });

  it('uses one mascot-led hero and a counted spatial status rail instead of pills', async () => {
    const { wrapper: Wrapper } = createWrapper();
    const { container } = render(<Wrapper><ToastProvider><TasksView /></ToastProvider></Wrapper>);
    const projects = await screen.findByRole('button', { name: /project/i });
    const toolbar = projects.parentElement?.parentElement!;
    const statuses = screen.getByRole('radiogroup', { name: 'Task status' });
    expect(toolbar.className).toContain('flex-wrap');
    expect(toolbar.className).not.toContain('overflow-x-auto');
    expect(statuses.closest('[data-testid="spatial-section-rail"]')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Active 1/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Open 2/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Autopilot 1/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /All 5/ })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Elowen' })).toHaveLength(1);
    expect(screen.getByTestId('spatial-workspace-layout')).toBeInTheDocument();
    expect(container.querySelector('.workspace-tabs')).toBeNull();
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument();
    expect(screen.getByText('Build').closest('.control-surface-register')).toBeInTheDocument();
  });

  it('launches a task via the Launch action', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><TasksView /></ToastProvider></Wrapper>);
    await waitFor(() => expect(screen.getByText('elowen-1')).toBeInTheDocument());
    // No live session for this task → the run control shows "Start"
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(spawnBody).toMatchObject({ taskId: 'elowen-1' }));
  });

  it('switches the spatial rail and persists the selected filter', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><TasksView /></ToastProvider></Wrapper>);
    const open = await screen.findByRole('radio', { name: /Open 2/ });
    fireEvent.click(open);
    expect(open).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('elowen.tasks.filter')).toBe('open');
    expect(screen.getByText('Plan')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Build')).toBeNull());
  });

  // The deep link the dashboard, the timeline and the legacy /tasks redirect all use. The bundle reads
  // it through its own useSearchParams shim, and the effect that applies it depends on that value's
  // IDENTITY: a shim returning a fresh object per render would re-apply the id after every state change,
  // which reads as a detail pane that cannot be closed or switched away from.
  it('opens the task named by ?select= and lets it be closed again', async () => {
    window.history.replaceState(null, '', '/p/work/tasks?select=elowen-2');
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><TasksView /></ToastProvider></Wrapper>);
    const rail = await screen.findByRole('dialog', { name: 'Task detail' });
    expect(await within(rail).findByText('Plan')).toBeInTheDocument();
    fireEvent.click(within(rail).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Task detail' })).toBeNull());
    // …and stays closed: the URL still carries ?select=, so a re-running effect would re-open it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('dialog', { name: 'Task detail' })).toBeNull();
    window.history.replaceState(null, '', '/p/work/tasks');
  });

  it('opens task context in the workspace detail rail', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><TasksView /></ToastProvider></Wrapper>);
    const row = (await screen.findByText('Build')).closest('[role="button"]')!;
    fireEvent.click(row);
    expect(await screen.findByRole('dialog', { name: 'Task detail' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Task detail' })).toBeNull();
  });
});

// ── TasksView project filter ─────────────────────────────────────────────────

describe('TasksView project pills', () => {
  const PROJECTS = [
    { id: 1, slug: 'elowen', path: '/var/www/elowen', notes: '', icon: '', pr_enabled: null },
    { id: 2, slug: 'other', path: '/var/www/other', notes: '', icon: '', pr_enabled: null },
  ];
  // Two tasks in project 1, one in project 2.
  const ALL = [
    { id: 't-a', title: 'Alpha', status: 'in_progress', type: 'task', labels: [], project_id: 1 },
    { id: 't-b', title: 'Beta', status: 'in_progress', type: 'task', labels: [], project_id: 2 },
  ];

  let lastTasksUrl = '';
  beforeEach(() => {
    lastTasksUrl = '';
    server.use(
      http.get('*/api/projects', () => HttpResponse.json(PROJECTS)),
      http.get('*/api/tasks', ({ request }) => {
        lastTasksUrl = request.url;
        const u = new URL(request.url);
        const pid = u.searchParams.get('project_id');
        const scoped = pid ? ALL.filter((t) => t.project_id === Number(pid)) : ALL;
        return HttpResponse.json(scoped);
      }),
    );
  });

  it('narrow the list via /tasks?project_id=N and "All" resets it', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><TasksView /></ToastProvider></Wrapper>);

    // Default = "All projects" → both tasks load.
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(lastTasksUrl).not.toContain('project_id=');

    // Open the project dropdown and choose "other" → only Beta.
    fireEvent.click(screen.getByRole('button', { name: 'Project filter' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'other' }));
    await waitFor(() => expect(lastTasksUrl).toContain('project_id=2'));
    await waitFor(() => expect(screen.queryByText('Alpha')).not.toBeInTheDocument());
    expect(screen.getByText('Beta')).toBeInTheDocument();

    // Reopen the dropdown and choose "All projects" → both back.
    fireEvent.click(screen.getByRole('button', { name: 'Project filter' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'All projects' }));
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    expect(lastTasksUrl).not.toContain('project_id=');
  });
});

// ── TaskDetailPane ───────────────────────────────────────────────────────────

describe('TaskDetailPane', () => {
  beforeEach(() => {
    server.use(
      http.get('*/api/tasks/deps', () => HttpResponse.json([])),
      http.get('*/api/activity', () => HttpResponse.json([])),
      http.get('*/api/sessions/elowen-nova/pane', () => HttpResponse.json({ pane: 'npm test\nall good' })),
    );
  });

  it('renders the result summary for a closed task', async () => {
    const { wrapper: Wrapper, client } = createWrapper();
    client.setQueryData(['tasks'], [{ id: 'tc', title: 'Closed one', status: 'closed', outcome: 'ok', result_summary: 'shipped it' }]);
    render(<Wrapper><ToastProvider><TaskDetailPane taskId="tc" /></ToastProvider></Wrapper>);
    expect(await screen.findByText('shipped it')).toBeTruthy();
    expect(screen.getByText('Result')).toBeTruthy();
  });

  it('renders the mission summary under a distinct label for a closed epic', async () => {
    const { wrapper: Wrapper, client } = createWrapper();
    client.setQueryData(['tasks'], [{ id: 'ep', title: 'Big mission', type: 'epic', status: 'closed', outcome: 'ok', result_summary: 'three phases shipped' }]);
    render(<Wrapper><ToastProvider><TaskDetailPane taskId="ep" /></ToastProvider></Wrapper>);
    expect(await screen.findByText('three phases shipped')).toBeTruthy();
    expect(screen.getByText('Mission summary')).toBeTruthy(); // not the generic "Result" — an epic carries the autopilot mission summary
  });

  it('renders the live tail for a running task', async () => {
    const { wrapper: Wrapper, client } = createWrapper();
    client.setQueryData(['tasks'], [{ id: 'tr', title: 'Running one', status: 'in_progress', labels: ['agent:nova'] }]);
    client.setQueryData(['sessions'], [{ name: 'elowen-nova', role: 'agent', agent: 'nova' }]);
    render(<Wrapper><ToastProvider><TaskDetailPane taskId="tr" /></ToastProvider></Wrapper>);
    expect(await screen.findByText('Live output')).toBeTruthy();
    expect(await screen.findByText(/all good/)).toBeTruthy();
  });
});

// ── TaskConversation ─────────────────────────────────────────────────────────

/** Build a stored `message` activity row (detail is JSON {role,text}, as eventStore.toRow writes it). */
const msg = (id: number, role: 'agent' | 'autopilot' | 'human', text: string, ts: string) =>
  ({ id, type: 'message', detail: JSON.stringify({ role, text }), ts });

describe('TaskConversation', () => {
  it('takes a structured worker identity program literally', () => {
    expect(parseExecRef({ program: 'elowen', provider: 'relay', model: 'vendor/model' })?.program).toBe('elowen');
    expect(parseExecRef({ program: 'opencode', model: 'vendor/model' })?.program).toBe('opencode');
    expect(parseExecRef({ program: 'codex', model: 'vendor/model' })?.program).toBe('codex');
    expect(parseExecRef('vendor/model')?.program).toBe('opencode');
  });

  beforeEach(() => {
    // The thread is seeded through the cache; these keep the background refetch from rejecting.
    server.use(
      http.get('*/api/tasks/:id/activity', () => HttpResponse.json([])),
      http.get('*/api/tasks/:id/commits', () => HttpResponse.json({ commits: [] })),
    );
  });

  it('renders the worker↔autopilot message turns as a chronological thread', () => {
    const { wrapper: Wrapper, client } = createWrapper();
    client.setQueryData(['task-activity', 't1'], [
      msg(1, 'agent', 'Use Postgres or SQLite?', '2026-06-29 10:00:00'),
      msg(2, 'autopilot', 'SQLite — it matches the existing store.', '2026-06-29 10:01:00'),
    ]);
    client.setQueryData(['task-commits', 't1'], { commits: [] });
    render(<Wrapper><TaskConversation task={{ id: 't1' }} /></Wrapper>);

    expect(screen.getByText('Use Postgres or SQLite?')).toBeTruthy();
    expect(screen.getByText('SQLite — it matches the existing store.')).toBeTruthy();
    expect(screen.getByText('Agent asks')).toBeTruthy();
    expect(screen.getByText('Autopilot replies')).toBeTruthy();
  });

  it('labels a human reply distinctly from the autopilot', () => {
    const { wrapper: Wrapper, client } = createWrapper();
    client.setQueryData(['task-activity', 't2'], [
      msg(1, 'agent', '?', '2026-06-29 10:00:00'),
      msg(2, 'human', 'go with A', '2026-06-29 10:05:00'),
    ]);
    client.setQueryData(['task-commits', 't2'], { commits: [] });
    render(<Wrapper><TaskConversation task={{ id: 't2' }} /></Wrapper>);

    expect(screen.getByText('Your reply')).toBeTruthy();
    expect(screen.getByText('go with A')).toBeTruthy();
  });

  it('skips a malformed message detail without dropping the rest of the feed', () => {
    const { wrapper: Wrapper, client } = createWrapper();
    client.setQueryData(['task-activity', 't3'], [
      { id: 1, type: 'message', detail: '{not json', ts: '2026-06-29 10:00:00' },
      msg(2, 'autopilot', 'still here', '2026-06-29 10:01:00'),
    ]);
    client.setQueryData(['task-commits', 't3'], { commits: [] });
    render(<Wrapper><TaskConversation task={{ id: 't3' }} /></Wrapper>);

    expect(screen.getByText('still here')).toBeTruthy();
  });
});

// ── TaskResultsModal ─────────────────────────────────────────────────────────

const closedTask: Task = {
  id: 'elowen-ab12cd34',
  title: 'Add CSV export',
  status: 'closed',
  type: 'feature',
  outcome: 'ok',
  result_summary: 'Implemented CSV export and added tests.',
  labels: ['exec:sonnet', 'agent:nova'],
  created_at: '2026-06-18 10:00:00',
  closed_at: '2026-06-18 10:03:30',
};

describe('TaskResultsModal', () => {
  it('shows the result summary, outcome and a finished/duration view for a closed task', () => {
    const { wrapper } = createWrapper();
    render(<TaskResultsModal task={closedTask} onClose={() => {}} />, { wrapper });
    expect(screen.getByText('Add CSV export')).toBeInTheDocument();
    expect(screen.getByText('Implemented CSV export and added tests.')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
    // run lasted 3m 30s
    expect(screen.getByText('3m 30s')).toBeInTheDocument();
  });

  it('falls back to a no-summary note when the task closed without one', () => {
    const { wrapper } = createWrapper();
    render(<TaskResultsModal task={{ ...closedTask, result_summary: null }} onClose={() => {}} />, { wrapper });
    expect(screen.getByText('Closed without a summary.')).toBeInTheDocument();
  });

  it('closes via the footer button', () => {
    const onClose = vi.fn();
    const { wrapper } = createWrapper();
    render(<TaskResultsModal task={closedTask} onClose={onClose} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
