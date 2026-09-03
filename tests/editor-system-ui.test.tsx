import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { http, HttpResponse, listen, resetHandlers, setDefaults, close } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { en } from './ui/hostDictionary';
import manifest from '../plugins/editor/elowen-plugin.json' with { type: 'json' };
import { SYSTEM_PROJECT_ID } from '../plugins/editor/src/systemRoot';

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;

// The page under test is the project PICKER, not the workbench it opens. Standing the editor in for
// itself keeps the assertions on which root the page selected — and keeps a file tree, a Monaco stub and
// a dozen file queries out of a test about a dropdown.
vi.mock('../plugins/editor/web-src/editor/ProjectEditor', () => ({
  ProjectEditor: ({ projectId }: { projectId: number }) => <div data-testid="workbench">root:{projectId}</div>,
}));

let EditorPage: ComponentType;
// Whether /auth/me answers with an administrator. Every assertion below hangs off this one flag, which
// is what makes the mutation meaningful: flipping it must turn the System assertions red.
let isAdmin = true;

beforeAll(async () => {
  ensurePluginUiRuntime();
  ({ EditorPage } = await import('../plugins/editor/web-src/EditorPage'));
});

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'editor', url: '/plugins/editor/web/index.js', apiVersion: 1, nav: [], settings: [], strings }])),
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: isAdmin ? 'admin' : 'member', is_admin: isAdmin } })),
  http.get('/api/projects', () => HttpResponse.json([
    { id: 5, slug: 'elowen', path: '/var/www/elowen', notes: '', pr_enabled: null },
    { id: 6, slug: 'kolin', path: '/var/www/kolin', notes: '', icon: 'public/brand.svg', pr_enabled: null },
  ])),
  http.get('/api/projects/:id/raw', () => HttpResponse.text('<svg xmlns="http://www.w3.org/2000/svg"/>', {
    headers: { 'content-type': 'image/svg+xml' },
  })),
);

beforeAll(() => listen());
beforeEach(() => { isAdmin = true; localStorage.clear(); });
afterEach(() => { cleanup(); resetHandlers(); });
afterAll(() => close());

function renderPage() {
  const { wrapper: Base } = createWrapper();
  const Wrapper = ({ children }: { children: ReactNode }) => <Base><ToastProvider>{children}</ToastProvider></Base>;
  render(<EditorPage />, { wrapper: Wrapper });
}

/** The host's SelectMenu renders as a labelled `<select>`; the pills render as a radio group. */
const picker = () => screen.getByLabelText(strings.project) as HTMLSelectElement;
const optionLabels = () => [...picker().options].map((option) => option.textContent);

describe('EditorPage system root', () => {
  it('offers the system root to an administrator, alongside the projects', async () => {
    renderPage();
    await waitFor(() => expect(picker()).toBeInTheDocument());
    expect(optionLabels()).toContain(strings.systemRoot);
    expect(strings.systemRoot).toBe('System (/)');
    expect(optionLabels()).toEqual(expect.arrayContaining(['elowen', 'kolin']));
  });

  it('renders System with a drive and every project with the host-owned project identity', async () => {
    renderPage();
    await waitFor(() => expect(picker()).toBeInTheDocument());

    const systemIcon = document.querySelector('[data-select-option-icon="system"]');
    expect(systemIcon?.querySelector('.lucide-hard-drive')).toBeInTheDocument();
    expect(systemIcon?.querySelector('[data-project-icon]')).toBeNull();

    const plainProjectIcon = document.querySelector('[data-select-option-icon="5"]');
    expect(plainProjectIcon?.querySelector('svg')).toBeInTheDocument();
    expect(plainProjectIcon?.querySelector('.lucide-hard-drive')).toBeNull();
    const customProjectIcon = document.querySelector('[data-select-option-icon="6"]');
    expect(customProjectIcon?.querySelector('[data-project-icon="public/brand.svg"]')).toBeInTheDocument();
  });

  it('does not offer it to a non-admin, who keeps the shared project pills', async () => {
    isAdmin = false;
    renderPage();
    // The host's own project filter, unchanged — and no trace of the admin picker or the entry it
    // carries. The two labels differ ('Project' against 'Project filter'), so neither query can match
    // the other control by accident.
    await screen.findByLabelText(en.common.filterProjectsAria);
    expect(screen.queryByLabelText(strings.project)).toBeNull();
    expect(screen.queryByText(strings.systemRoot)).toBeNull();
  });

  it('opens the editor on the reserved root once the system entry is picked', async () => {
    renderPage();
    await waitFor(() => expect(picker()).toBeInTheDocument());
    // Until then the page is on a real project.
    expect(await screen.findByTestId('workbench')).toHaveTextContent('root:5');

    fireEvent.change(picker(), { target: { value: 'system' } });

    await waitFor(() => expect(screen.getByTestId('workbench')).toHaveTextContent(`root:${SYSTEM_PROJECT_ID}`));
    // The page header names the root that is open, absolute path included.
    expect(screen.getByText(strings.workspaceReady.replace('{project}', strings.systemRoot))).toBeInTheDocument();
  });

  it('goes back to a project, and remembers neither choice as the other', async () => {
    renderPage();
    await waitFor(() => expect(picker()).toBeInTheDocument());
    fireEvent.change(picker(), { target: { value: 'system' } });
    await waitFor(() => expect(screen.getByTestId('workbench')).toHaveTextContent(`root:${SYSTEM_PROJECT_ID}`));

    fireEvent.change(picker(), { target: { value: '6' } });
    await waitFor(() => expect(screen.getByTestId('workbench')).toHaveTextContent('root:6'));
    expect(screen.getByText(strings.workspaceReady.replace('{project}', 'kolin'))).toBeInTheDocument();
  });

  it('drops a remembered system root for an account that is no longer an administrator', async () => {
    // The choice is persisted, and an account can lose the admin bit between two visits. The stored
    // value must not survive that as a request the daemon would only refuse.
    localStorage.setItem('elowen.editor.systemRoot', 'on');
    isAdmin = false;
    renderPage();
    await screen.findByLabelText(en.common.filterProjectsAria);
    expect(screen.queryByText(strings.systemRoot)).toBeNull();
    const workbench = await screen.findByTestId('workbench');
    expect(workbench).not.toHaveTextContent(`root:${SYSTEM_PROJECT_ID}`);
  });

  it('keeps the system entry reachable on an instance with a single project', async () => {
    // The shared pills hide themselves below two projects, which is exactly where an operator most
    // needs the filesystem — this is why the admin picker is not those pills.
    resetHandlers();
    setDefaults(
      http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'editor', url: '/x.js', apiVersion: 1, nav: [], settings: [], strings }])),
      http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'admin', is_admin: true } })),
      http.get('/api/projects', () => HttpResponse.json([{ id: 5, slug: 'elowen', path: '/var/www/elowen', notes: '', pr_enabled: null }])),
    );
    renderPage();
    await waitFor(() => expect(picker()).toBeInTheDocument());
    expect(within(picker()).getByText(strings.systemRoot)).toBeInTheDocument();
  });
});
