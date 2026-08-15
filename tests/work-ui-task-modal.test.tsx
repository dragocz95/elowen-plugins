/** The work bundle's task modal: the create/edit form, its project selector, the async autopilot
 *  planning flow and the dependency picker.
 *
 *  The panels read the host runtime at module scope, so it is installed before they are imported.
 *  HTTP goes through the fetch router in tests/ui/http.ts; each block installs its own fixture in a
 *  `beforeEach`, because the modal's behaviour is driven almost entirely by what /api/config and
 *  /api/projects answer and no single default describes all four blocks.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { http, HttpResponse, setupServer, onUnhandledRequest } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';

// ProjectIcon lives in its own host module for exactly this: the selector's job here is to prove the
// configured image reaches it, not to fetch and decode a blob in jsdom.
vi.mock('./ui/hostProjectIcon', () => ({
  ProjectIcon: ({ project }: { project: { id: number; icon?: string } }) => <span data-testid={`project-icon-${project.id}`} data-icon={project.icon} />,
}));

ensurePluginUiRuntime();
const { TaskModal } = await import('../plugins/work/web-src/tasks/TaskModal');
const { DepPickerModal } = await import('../plugins/work/web-src/tasks/DepPickerModal');

import type { Task } from '../plugins/work/web-src/types';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => { cleanup(); server.resetHandlers(); });
afterAll(() => server.close());

const FULL_CONFIG = {
  allowedExecs: ['sonnet'], customModels: [], hiddenPresets: [], modelNotes: { sonnet: 'coder' },
  autopilot: { model: 'm', overseerModel: '', apiUrl: 'u', apiKeySet: true, notes: '', prompt: '', pilotExec: '', overseerExec: '', reviewOnDone: false },
  providers: {}, defaults: { exec: 'sonnet', autonomy: 'L3', maxSessions: 1 }, security: { tokenTtlDays: 30 },
};

// ── auto model toggle ────────────────────────────────────────────────────────

describe('TaskModal — auto model toggle', () => {
  interface PlanBody { autoModel?: boolean; exec?: string; pilotExec?: string; overseerExec?: string }
  let planBody: PlanBody | null = null;

  beforeEach(() => {
    planBody = null;
    server.use(
      http.get('*/api/plugins/ui', () => HttpResponse.json([{ name: 'agents', url: '/plugins/agents/web/index.js', apiVersion: 1, nav: [], settings: [] }])),
      http.get('*/api/config', () => HttpResponse.json(FULL_CONFIG)),
      http.get('*/api/tasks', () => HttpResponse.json([])),
      http.get('*/api/projects', () => HttpResponse.json([])),
      http.get('*/api/brain/models', () => HttpResponse.json([])),
      http.post('*/api/tasks/plan', async ({ request }) => { planBody = await request.json() as PlanBody; return HttpResponse.json({ jobId: 'pj-1', epicId: 'e1' }, { status: 202 }); }),
      http.get('*/api/plan/pj-1', () => HttpResponse.json({ id: 'pj-1', status: 'done', phases: [], epicId: 'e1', goal: '', projectId: 1 })),
    );
  });

  it('submits per-mission planner and overseer choices', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><TaskModal onClose={() => {}} /></ToastProvider></Wrapper>);
    await waitFor(() => screen.getByText('Autopilot · Planning'));
    fireEvent.click(screen.getByText('Autopilot · Planning'));
    fireEvent.change(screen.getByPlaceholderText('Describe the goal to plan…'), { target: { value: 'build x' } });

    fireEvent.click(screen.getByRole('button', { name: 'Planner' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Claude Sonnet 4.5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    fireEvent.click(screen.getByRole('button', { name: 'Overseer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Claude Sonnet 4.5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    fireEvent.click(screen.getByRole('button', { name: 'Generate plan' }));
    await waitFor(() => expect(planBody).not.toBeNull());
    expect(planBody).toMatchObject({ pilotExec: 'sonnet', overseerExec: 'sonnet' });
  });

  it('hides the executor picker and sends autoModel without exec', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><TaskModal onClose={() => {}} /></ToastProvider></Wrapper>);
    // Switch to autopilot planning mode (Segmented option).
    await waitFor(() => screen.getByText('Autopilot · Planning'));
    fireEvent.click(screen.getByText('Autopilot · Planning'));
    // Target the goal textarea by placeholder — the optional mission-name input is also a textbox.
    fireEvent.change(screen.getByPlaceholderText('Describe the goal to plan…'), { target: { value: 'build x' } });

    // Planning mode shows the executor picker (its "Executor" field label).
    expect(screen.getByText('Executor')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Autopilot picks the model' }));
    // Auto-model on → the executor picker is hidden.
    expect(screen.queryByText('Executor')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Generate plan' }));
    await waitFor(() => expect(planBody).not.toBeNull());
    expect(planBody).toMatchObject({ autoModel: true });
    expect(planBody).not.toHaveProperty('exec'); // undefined exec is dropped by JSON.stringify
  });
});

// ── project default ──────────────────────────────────────────────────────────

describe('TaskModal — defaultProjectId (active project filter carries into New task)', () => {
  interface CreateBody { title?: string; project_id?: number }
  let createBody: CreateBody | null = null;
  const projects = [
    { id: 1, slug: 'elowen', path: '/var/www/elowen', notes: '', icon: 'assets/icon.png', pr_enabled: null },
    { id: 2, slug: 'shop', path: '/srv/shop', notes: '', icon: '', pr_enabled: null },
  ];

  beforeEach(() => {
    createBody = null;
    server.use(
      http.get('*/api/config', () => HttpResponse.json({ ...FULL_CONFIG, modelNotes: {} })),
      http.get('*/api/tasks', () => HttpResponse.json([])),
      http.get('*/api/projects', () => HttpResponse.json(projects)),
      http.get('*/api/brain/models', () => HttpResponse.json([])),
      http.get('*/api/projects/1/raw', () => new HttpResponse(new Blob(['icon'], { type: 'image/png' }))),
      http.post('*/api/tasks', async ({ request }) => { createBody = await request.json() as CreateBody; return HttpResponse.json({ id: 'elowen-1', title: createBody.title, status: 'open', project_id: createBody.project_id }, { status: 201 }); }),
    );
  });

  it('renders the configured project image in the project selector', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><TaskModal onClose={() => {}} /></ToastProvider></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('project-icon-1')).toHaveAttribute('data-icon', 'assets/icon.png'));
  });

  it('pre-selects the project pill matching defaultProjectId, with no click needed', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><TaskModal onClose={() => {}} defaultProjectId={2} /></ToastProvider></Wrapper>);
    await waitFor(() => expect(screen.getByText('shop').closest('button')!.className).toMatch(/border-accent/));
    fireEvent.change(screen.getByPlaceholderText('What needs doing?'), { target: { value: 'Fix bug' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createBody).not.toBeNull());
    expect(createBody).toMatchObject({ project_id: 2 });
  });

  it('falls back to the first project when no defaultProjectId is given (unfiltered "all" view)', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><TaskModal onClose={() => {}} /></ToastProvider></Wrapper>);
    await waitFor(() => expect(screen.getByText('elowen').closest('button')!.className).toMatch(/border-accent/));
    fireEvent.change(screen.getByPlaceholderText('What needs doing?'), { target: { value: 'Fix bug' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createBody).not.toBeNull());
    expect(createBody).toMatchObject({ project_id: 1 });
  });

  it('clicking a different pill still overrides the default', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><TaskModal onClose={() => {}} defaultProjectId={2} /></ToastProvider></Wrapper>);
    await waitFor(() => screen.getByText('elowen'));
    fireEvent.click(screen.getByText('elowen'));
    fireEvent.change(screen.getByPlaceholderText('What needs doing?'), { target: { value: 'Fix bug' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createBody).not.toBeNull());
    expect(createBody).toMatchObject({ project_id: 1 });
  });
});

// ── async planning ───────────────────────────────────────────────────────────
//
// The core copy of this suite stubbed the app's xterm panel (`StreamTerminal`) and `next/dynamic` so
// the expanded terminal would render synchronously in jsdom. Neither exists here: the bundle asks the
// HOST for `TerminalModal`, and the host's own terminal pane is already a plain node. The assertions
// are unchanged — the terminal opens and is titled by the pilot role.

describe('async autopilot planning in TaskModal', () => {
  const config = {
    allowedExecs: ['sonnet'], customModels: [], hiddenPresets: [],
    autopilot: { model: 'm', overseerModel: '', apiUrl: 'u', apiKeySet: true, notes: '', prompt: '', pilotExec: '', overseerExec: '', reviewOnDone: false },
    providers: {}, defaults: { exec: 'sonnet', autonomy: 'L3', maxSessions: 1 },
  };
  const lastJob = 'pj-1';

  beforeEach(() => {
    server.use(
      http.get('*/api/config', () => HttpResponse.json(config)),
      http.get('*/api/tasks', () => HttpResponse.json([])),
      // Autopilot planning now returns 202 with a job id (async).
      http.post('*/api/tasks/plan', () => HttpResponse.json({ jobId: lastJob, epicId: 'elowen-ep' }, { status: 202 })),
      // The job resolves to done with its phases.
      http.get('*/api/plan/:jobId', ({ params }) => HttpResponse.json({ id: params.jobId, epicId: 'elowen-ep', goal: 'g', status: 'done', phases: [{ title: 'Phase A', type: 'task' }, { title: 'Phase B', type: 'feature' }] })),
    );
  });

  it('submits a goal, polls the job, and renders the resolved phases', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><TaskModal onClose={() => {}} /></ToastProvider></Wrapper>);
    await waitFor(() => expect(screen.getByText('Autopilot · Planning')).toBeTruthy());

    fireEvent.click(screen.getByText('Autopilot · Planning'));
    fireEvent.change(screen.getByPlaceholderText('Describe the goal to plan…'), { target: { value: 'build a thing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate plan' }));

    // The job resolves to done → its phases render in the outcome list.
    await waitFor(() => expect(screen.getByText('Phase A')).toBeTruthy());
    expect(screen.getByText('Phase B')).toBeTruthy();
  });

  it('live-previews the planner pane while the agent-mode job is still planning', async () => {
    // Agent-mode planning stays `planning` and exposes the Pilot's tmux session; the modal should
    // render a live preview of that pane under the loader until the plan resolves.
    server.use(
      http.get('*/api/plan/:jobId', ({ params }) => HttpResponse.json({ id: params.jobId, epicId: null, goal: 'g', status: 'planning', phases: [], sessionName: 'elowen-pilot-Nova' })),
      http.get('*/api/sessions/elowen-pilot-Nova/pane', () => HttpResponse.json({ pane: 'reading the repo…' })),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><TaskModal onClose={() => {}} /></ToastProvider></Wrapper>);
    await waitFor(() => expect(screen.getByText('Autopilot · Planning')).toBeTruthy());

    fireEvent.click(screen.getByText('Autopilot · Planning'));
    fireEvent.change(screen.getByPlaceholderText('Describe the goal to plan…'), { target: { value: 'build a thing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate plan' }));

    // The Pilot's pane is streamed live under the planning loader.
    await waitFor(() => expect(screen.getByText('reading the repo…')).toBeTruthy());
    expect(screen.getByText('Planner at work')).toBeTruthy();
  });

  it('expands the planner preview into the full terminal modal on click', async () => {
    server.use(
      http.get('*/api/plan/:jobId', ({ params }) => HttpResponse.json({ id: params.jobId, epicId: null, goal: 'g', status: 'planning', phases: [], sessionName: 'elowen-pilot-Nova' })),
      http.get('*/api/sessions/elowen-pilot-Nova/pane', () => HttpResponse.json({ pane: 'reading the repo…' })),
      // Both useSessionInfos (modal title) and useCloseOnAgentDone (keep-open) read this list.
      http.get('*/api/sessions', () => HttpResponse.json([{ name: 'elowen-pilot-Nova', role: 'pilot', agent: 'Nova' }])),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><TaskModal onClose={() => {}} /></ToastProvider></Wrapper>);
    await waitFor(() => expect(screen.getByText('Autopilot · Planning')).toBeTruthy());

    fireEvent.click(screen.getByText('Autopilot · Planning'));
    fireEvent.change(screen.getByPlaceholderText('Describe the goal to plan…'), { target: { value: 'build a thing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate plan' }));

    // Click the live tail → the full session terminal opens over the modal, titled by the pilot role.
    await waitFor(() => expect(screen.getByText('reading the repo…')).toBeTruthy());
    fireEvent.click(screen.getByText('reading the repo…'));
    await waitFor(() => expect(screen.getByText('Planner')).toBeTruthy()); // the TerminalModal title (rolePilot)
  });
});

// ── dependency picker ────────────────────────────────────────────────────────

describe('DepPickerModal (auto-save)', () => {
  const task = (over: Partial<Task> = {}): Task =>
    ({ id: 'T-1', project_id: 1, title: 't', type: 'task', status: 'open', priority: 'normal', created_at: '2026-01-01', ...over } as Task);

  it('auto-saves the dependency set on toggle — no Save button — and Done closes', async () => {
    let patched: unknown = null;
    server.use(
      http.get('*/api/tasks/T-1/deps', () => HttpResponse.json([])),
      http.get('*/api/tasks', () => HttpResponse.json([task({ id: 'T-1' }), task({ id: 'T-2', title: 'blocker' })])),
      http.patch('*/api/tasks/T-1', async ({ request }) => { patched = await request.json(); return HttpResponse.json(task()); }),
    );
    let closed = false;
    const onClose = () => { closed = true; };
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><DepPickerModal task={task()} onClose={onClose} /></ToastProvider></Wrapper>);

    // The picker seeded from the server; pick the candidate blocker.
    const candidate = await screen.findByText('blocker');
    // No manual Save button — persistence is automatic.
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    fireEvent.click(candidate);

    // Toggling auto-PATCHes the whole dep set.
    await waitFor(() => expect((patched as { deps: string[] })?.deps).toEqual(['T-2']));

    // Done closes the modal.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(closed).toBe(true);
  });
});
