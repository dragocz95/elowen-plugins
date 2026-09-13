import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { http, HttpResponse, listen, resetHandlers, setDefaults, close } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import manifest from '../plugins/editor/elowen-plugin.json' with { type: 'json' };

/** The editor toolbar stays dedicated to menus and actions at every width. The full file path belongs
 *  to the status bar below the editor, where it does not move the controls as files change. */

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;

vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <textarea aria-label="editor" value={value} readOnly />,
  DiffEditor: () => <div data-testid="diff" />,
  loader: { config: () => {} },
}));

let ProjectEditor: ComponentType<{ projectId: number; onClose?: () => void }>;
const PROJECT_ID = 4;
const GUEST_ROOT = '/sdilene';

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'editor', url: '/plugins/editor/web/index.js', apiVersion: 1, nav: [], settings: [], strings }])),
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'member', is_admin: false } })),
  http.get('/api/projects', () => HttpResponse.json([
    { id: PROJECT_ID, slug: 'sdilene', path: '', notes: '', icon: '', pr_enabled: null, executionKind: 'managed', guestRoot: GUEST_ROOT },
  ])),
  http.get('/api/projects/:id/files', () => HttpResponse.json([{ path: 'README.md', type: 'file', size: 9 }, { path: 'src', type: 'dir' }])),
  http.get('/api/projects/:id/file', () => HttpResponse.json({ content: 'hello\n', truncated: false, version: 'v1' })),
  http.get('/api/projects/:id/changed', () => HttpResponse.json({ changed: [] })),
);

/** The viewport the component reads through `useMobile`. The shim in `tests/ui/setup.ts` answers every
 *  query with `matches: false`, which is the desktop branch; a narrow run answers the app's own
 *  breakpoint query instead. */
function setViewport(narrow: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: narrow && query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeAll(async () => {
  ensurePluginUiRuntime();
  ({ ProjectEditor } = await import('../plugins/editor/web-src/editor/ProjectEditor'));
  listen();
});
beforeEach(() => { localStorage.clear(); setViewport(false); });
afterEach(() => { cleanup(); resetHandlers(); });
afterAll(() => close());

function renderEditor() {
  const { wrapper: Base } = createWrapper();
  const Wrapper = ({ children }: { children: ReactNode }) => <Base><ToastProvider>{children}</ToastProvider></Base>;
  render(<ProjectEditor projectId={PROJECT_ID} onClose={() => {}} />, { wrapper: Wrapper });
}

describe('the editor toolbar at desktop width', () => {
  it('keeps the root path out of the toolbar', async () => {
    renderEditor();
    const bar = await screen.findByRole('toolbar', { name: strings.editorTitle });

    expect(within(bar).getByText(strings.editorTitle)).toBeInTheDocument();
    expect(within(bar).getByRole('menubar')).toBeInTheDocument();
    expect(within(bar).queryByTitle(GUEST_ROOT)).toBeNull();
  });

  it('keeps the trailing action group aligned without path content', async () => {
    renderEditor();
    const group = (await screen.findByRole('toolbar', { name: strings.editorTitle })).lastElementChild!;

    expect(group.className).toContain('ml-auto');
    expect(group.className).toContain('justify-end');
    expect(within(group as HTMLElement).getByRole('button', { name: /close|zavřít|zavrieť/i })).toBeInTheDocument();
  });
});

describe('the editor toolbar at narrow width', () => {
  it('drops the path and keeps the menus and the actions', async () => {
    setViewport(true);
    renderEditor();
    const bar = await screen.findByRole('toolbar', { name: strings.editorTitle });

    expect(within(bar).getByRole('menubar')).toBeInTheDocument();
    expect(within(bar).getByRole('menuitem', { name: strings.menuFile })).toBeInTheDocument();
    // The path gives way first, so it cannot wrap the row or crowd out what is operable.
    expect(screen.queryByTitle(GUEST_ROOT)).toBeNull();
  });

  it('keeps the file menu reachable, so the root can still be changed there', async () => {
    setViewport(true);
    renderEditor();
    const file = await screen.findByRole('menuitem', { name: strings.menuFile });

    expect(file).toHaveAttribute('aria-haspopup', 'menu');
    expect(file).toHaveAttribute('aria-expanded', 'false');
  });
});
