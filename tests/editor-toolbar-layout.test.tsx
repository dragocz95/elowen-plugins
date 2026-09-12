import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { http, HttpResponse, listen, resetHandlers, setDefaults, close } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import manifest from '../plugins/editor/elowen-plugin.json' with { type: 'json' };

/** The editor toolbar's reading order, and what gives way when the row runs out of width.
 *
 *  The root path used to sit between the title and the File menu, so it pushed the menus along as it
 *  grew with every file opened and the row never held still. It belongs at the trailing edge as a
 *  status: right-aligned through the group's flexible gap, and the first thing to shrink.
 *
 *  jsdom has no layout engine, so this asserts the layout CONTRACT — document order, which element owns
 *  the flexible gap, and the shrink and overflow rules that decide who gives way — plus the one piece of
 *  behaviour that is not CSS at all: the path is not drawn on a phone, where the menus and the actions
 *  are what the row has space for. */

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

const toolbar = () => screen.getByRole('toolbar', { name: strings.editorTitle });
const follows = (first: Element, second: Element): boolean =>
  (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('the editor toolbar at desktop width', () => {
  it('reads title, then menus, then the root path at the trailing edge', async () => {
    renderEditor();
    const path = await screen.findByTitle(GUEST_ROOT);
    const bar = toolbar();
    const title = within(bar).getByText(strings.editorTitle);
    const menus = within(bar).getByRole('menubar');

    expect(follows(title, menus)).toBe(true);
    expect(follows(menus, path)).toBe(true);
    // The menus stay compact behind the title: nothing of the path lies between them.
    expect(follows(title, path)).toBe(true);
  });

  it('right-aligns the path through the trailing group, which also holds the actions', async () => {
    renderEditor();
    const path = await screen.findByTitle(GUEST_ROOT);
    const group = path.parentElement!;

    // The flexible gap belongs to this group, which is what pushes it to the trailing edge.
    expect(group.className).toContain('ml-auto');
    expect(group.className).toContain('justify-end');
    // The actions live here too, and AFTER the path, so the path can never displace them.
    const closeButton = within(group).getByRole('button', { name: /close|zavřít|zavrieť/i });
    expect(follows(path, closeButton)).toBe(true);
    // It is the last thing in the row: nothing is placed to the right of the actions.
    expect(toolbar().lastElementChild).toBe(group);
  });

  it('is a muted monospace status with no frame and nothing to operate', async () => {
    renderEditor();
    const path = await screen.findByTitle(GUEST_ROOT);

    expect(path.tagName).toBe('SPAN');
    expect(path.className).toContain('font-mono');
    expect(path.className).toContain('text-muted-foreground');
    expect(path.className).not.toMatch(/\bborder\b|\bborder-/);
    expect(path.className).not.toMatch(/\brounded/);
    // Not a control: nothing to focus, nothing to press, no handler to reach by keyboard.
    expect(path.getAttribute('tabindex')).toBeNull();
    expect(within(path).queryByRole('button')).toBeNull();
    expect(path).not.toHaveAttribute('aria-pressed');
  });

  it('shrinks and ellipsis before the row wraps, however long the path grows', async () => {
    renderEditor();
    // A deep file makes the path the longest thing in the row.
    const path = await screen.findByTitle(GUEST_ROOT);
    // `min-w-0` plus hidden overflow is what lets it give way instead of pushing the row to a second
    // line; `truncate` carries the ellipsis and the nowrap with it.
    expect(path.className).toContain('min-w-0');
    expect(path.className).toContain('truncate');
    expect(path.className).toContain('shrink');
    // The full value stays reachable on hover even once it is cut.
    expect(path).toHaveAttribute('title', GUEST_ROOT);
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
