import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, listen, resetHandlers, setupServer, close } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { ProjectIconPicker } from '../plugins/editor/web-src/ProjectIconPicker';
import { ProjectIcon } from './ui/hostProjectIcon';
import manifest from '../plugins/editor/elowen-plugin.json';

ensurePluginUiRuntime();

const managed = { id: 7, slug: 'analysis', path: '', notes: '', icon: '', pr_enabled: null, executionKind: 'managed' as const };
const requested = { files: 0, raw: [] as string[], patched: [] as unknown[], environment: 0, other: [] as string[] };

const environmentState = (state: string) => http.get('/api/plugins/sandbox/api/projects/7/environment', () => {
  requested.environment += 1;
  return HttpResponse.json({ environment: { projectId: 7, generation: 1, state, desiredState: 'running', lastError: null, limits: {} } });
});
const lifecycleTrap = http.post('/api/plugins/sandbox/api/projects/7/environment', async ({ request }) => {
  requested.other.push(`POST environment ${JSON.stringify(await request.json())}`);
  return HttpResponse.json({ error: 'the picker must never request a lifecycle change' }, { status: 500 });
});
const server = setupServer(
  // The picker's copy is the PLUGIN's own (`web.strings` in the manifest), not host vocabulary, so the
  // listing has to carry it exactly as the daemon serves it. Serving `{}` here would leave every label
  // blank and assert nothing about the strings the reader actually sees.
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'editor', url: '/plugins/editor/web/hash.js', apiVersion: 4, nav: [], account: [], user: [], project: [], settings: [], strings: manifest.web.strings }])),
  environmentState('running'),
  lifecycleTrap,
  http.get('/api/projects/7/files', () => {
    requested.files += 1;
    return HttpResponse.json([
      { path: 'assets/logo.png', type: 'file' },
      { path: 'docs/diagram.svg', type: 'file' },
      { path: 'README.md', type: 'file' },
    ]);
  }),
  http.get('/api/projects/7/raw', ({ request }) => {
    requested.raw.push(new URL(request.url).searchParams.get('path') ?? '');
    return new HttpResponse(new Blob([new Uint8Array([137, 80, 78, 71])]), { headers: { 'content-type': 'image/png' } });
  }),
  http.patch('/api/projects/7', async ({ request }) => {
    requested.patched.push(await request.json());
    return HttpResponse.json({ ...managed, icon: 'assets/logo.png' });
  }),
);
beforeAll(() => listen());
afterEach(() => {
  cleanup();
  resetHandlers();
  requested.files = 0;
  requested.raw = [];
  requested.patched = [];
  requested.environment = 0;
  requested.other = [];
});
afterAll(() => close());

function mount(node: React.ReactNode) {
  const { wrapper: Wrapper } = createWrapper();
  render(<Wrapper><ToastProvider>{node}</ToastProvider></Wrapper>);
}

describe('project icon from a managed workspace', () => {
  it('lists images inside the environment and persists a project-relative path', async () => {
    mount(<ProjectIconPicker project={managed} onClose={() => {}} />);
    const dialog = within(await screen.findByRole('dialog', { name: 'Choose icon' }));
    expect(await dialog.findByTitle('assets/logo.png')).toBeInTheDocument();
    expect(dialog.getByTitle('docs/diagram.svg')).toBeInTheDocument();
    expect(dialog.queryByTitle('README.md')).toBeNull();
    expect(requested.files).toBe(1);

    fireEvent.click(dialog.getByTitle('assets/logo.png'));
    fireEvent.click(dialog.getByRole('button', { name: 'Select' }));
    await waitFor(() => expect(requested.patched).toEqual([{ icon: 'assets/logo.png' }]));
    expect(requested.raw.every((path) => !path.startsWith('/'))).toBe(true);
  });

  it('does not read or start a stopped environment while opening the picker', async () => {
    server.use(environmentState('stopped'));
    mount(<ProjectIconPicker project={managed} onClose={() => {}} />);
    const dialog = within(await screen.findByRole('dialog', { name: 'Choose icon' }));
    expect(dialog.getByRole('button', { name: 'Select' })).toBeDisabled();
    expect(requested.environment).toBeGreaterThan(0);
    expect(requested.files).toBe(0);
    expect(requested.other).toEqual([]);
    expect(requested.patched).toEqual([]);
  });

  it('reports a refused file read without falling back to the host', async () => {
    server.use(http.get('/api/projects/7/files', () => HttpResponse.json({ error: 'forbidden' }, { status: 403 })));
    mount(<ProjectIconPicker project={{ ...managed, executionKind: 'host', path: '/srv/analysis' }} onClose={() => {}} />);
    const dialog = within(await screen.findByRole('dialog', { name: 'Choose icon' }));
    expect(await dialog.findByText(/forbidden/i)).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Select' })).toBeDisabled();
    expect(requested.patched).toEqual([]);
  });

  it('renders a persisted managed icon through the authorized raw route', async () => {
    mount(<ProjectIcon project={{ id: 7, icon: 'assets/logo.png' }} size={24} />);
    await waitFor(() => expect(requested.raw).toEqual(['assets/logo.png']));
    expect(document.querySelector('[data-project-icon="assets/logo.png"]')).toBeTruthy();
  });
});
