import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { http, HttpResponse, listen, resetHandlers, setDefaults, close } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import manifest from '../plugins/editor/elowen-plugin.json' with { type: 'json' };
import { editorFileKey, editorTreeKey } from '../plugins/editor/web-src/editor/fileData';

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;

// Monaco is browser-only. A textarea stands in for it, exactly as the other editor UI tests do.
vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange?: (value: string) => void }) => (
    <textarea aria-label="editor" value={value} onChange={(event) => onChange?.(event.target.value)} />
  ),
  DiffEditor: () => <div data-testid="diff" />,
  loader: { config: () => {} },
}));

let ProjectEditor: ComponentType<{ projectId: number; initialRoot?: 'project' | 'system' }>;

const PROJECT_ID = 9;
/** What each root answers with. The two listings share no path on purpose: a tree that came from the
 *  wrong root is then visible as a name that cannot belong to the one on screen. */
const TREES: Record<string, { path: string; type: 'file' | 'dir'; size?: number }[]> = {
  project: [{ path: 'README.md', type: 'file', size: 9 }, { path: 'src', type: 'dir' }],
  system: [{ path: 'etc', type: 'dir' }, { path: 'usr', type: 'dir' }, { path: 'sdilene', type: 'dir' }],
};
const CONTENT: Record<string, string> = { 'README.md': 'project file\n', 'etc': '' };
let treeRequests: string[] = [];
let fileRequests: { root: string; path: string }[] = [];

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'editor', url: '/plugins/editor/web/index.js', apiVersion: 1, nav: [], settings: [], strings }])),
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'member', is_admin: false } })),
  http.get('/api/projects', () => HttpResponse.json([
    { id: PROJECT_ID, slug: 'sdilene', path: '', notes: '', icon: '', pr_enabled: null, executionKind: 'managed', guestRoot: '/sdilene' },
  ])),
  http.get('/api/projects/:id/files', ({ url }) => {
    const root = url.searchParams.get('root') ?? '';
    treeRequests.push(root);
    // A directory expansion under the system root asks for one level and gets one level.
    if (url.searchParams.get('path')) return HttpResponse.json([{ path: `${url.searchParams.get('path')}/hosts`, type: 'file', size: 4 }]);
    return HttpResponse.json(TREES[root] ?? []);
  }),
  http.get('/api/projects/:id/file', ({ url }) => {
    const root = url.searchParams.get('root') ?? '';
    const path = url.searchParams.get('path') ?? '';
    fileRequests.push({ root, path });
    return HttpResponse.json({ content: CONTENT[path] ?? `${root}:${path}\n`, truncated: false, version: 'v1' });
  }),
  http.get('/api/projects/:id/changed', () => HttpResponse.json({ changed: [] })),
);

beforeAll(async () => {
  ensurePluginUiRuntime();
  ({ ProjectEditor } = await import('../plugins/editor/web-src/editor/ProjectEditor'));
  listen();
});
beforeEach(() => { treeRequests = []; fileRequests = []; localStorage.clear(); });
afterEach(() => { cleanup(); resetHandlers(); });
afterAll(() => close());

function renderEditor(initialRoot?: 'project' | 'system') {
  const { wrapper: Base, client } = createWrapper();
  const Wrapper = ({ children }: { children: ReactNode }) => <Base><ToastProvider>{children}</ToastProvider></Base>;
  render(<ProjectEditor projectId={PROJECT_ID} initialRoot={initialRoot} />, { wrapper: Wrapper });
  return client;
}
const rootSwitch = () => screen.getByRole('tablist', { name: strings.rootLabel });
const pickRoot = (label: string) => fireEvent.click(within(rootSwitch()).getByRole('tab', { name: label }));
const treeButton = (name: string) => within(screen.getByRole('tree')).getByRole('button', { name });

describe('a managed project offers two roots', () => {
  it('opens on the project root and names the guest directory it is mounted at', async () => {
    renderEditor();
    await screen.findByRole('tablist', { name: strings.rootLabel });
    expect(await screen.findByText('README.md')).toBeInTheDocument();
    expect(treeRequests).toEqual(['project']);
    // The mount is reported by the daemon; the interface repeats it rather than deriving it from a slug.
    expect(screen.getByTitle('/sdilene')).toBeInTheDocument();
  });

  it('switches to the guest filesystem and shows the base image beside the project mount', async () => {
    renderEditor();
    await screen.findByText('README.md');
    pickRoot(strings.rootSystem);

    await waitFor(() => expect(treeButton('etc')).toBeInTheDocument());
    expect(treeButton('sdilene')).toBeInTheDocument();
    // The roots stay separate: nothing of the project tree is mixed into the filesystem listing.
    expect(within(screen.getByRole('tree')).queryByRole('button', { name: 'README.md' })).toBeNull();
    expect(treeRequests).toEqual(['project', 'system']);
    expect(screen.getByTitle('/')).toBeInTheDocument();
  });

  it('keeps each root in its own cache entry', async () => {
    const client = renderEditor();
    await screen.findByText('README.md');
    pickRoot(strings.rootSystem);
    await waitFor(() => expect(treeButton('etc')).toBeInTheDocument());

    // Both listings are cached, under keys that cannot answer for one another.
    expect(client.getQueryData(editorTreeKey(PROJECT_ID, 'project'))).toEqual(TREES.project);
    expect(client.getQueryData(editorTreeKey(PROJECT_ID, 'system'))).toEqual(TREES.system);

    // Going back shows the project tree again without the filesystem leaking into it.
    pickRoot(strings.rootProject);
    await waitFor(() => expect(treeButton('README.md')).toBeInTheDocument());
    expect(within(screen.getByRole('tree')).queryByRole('button', { name: 'etc' })).toBeNull();
  });

  it('clears the open file when the root changes, and reads the new root for the next one', async () => {
    const client = renderEditor();
    await screen.findByText('README.md');
    fireEvent.click(treeButton('README.md'));
    await waitFor(() => expect((screen.getByLabelText('editor') as HTMLTextAreaElement).value).toBe('project file\n'));
    expect(fileRequests).toEqual([{ root: 'project', path: 'README.md' }]);

    pickRoot(strings.rootSystem);
    // The selection is dropped rather than carried: the same relative path under the other root is a
    // different file, and usually not a file at all.
    await screen.findByText(strings.selectFile);
    expect(screen.queryByLabelText('editor')).toBeNull();
    expect(client.getQueryData(editorFileKey(PROJECT_ID, 'project', 'README.md'))).toMatchObject({ content: 'project file\n' });
    expect(client.getQueryData(editorFileKey(PROJECT_ID, 'system', 'README.md'))).toBeUndefined();
    expect(fileRequests).toHaveLength(1);
  });

  it('hides version history under the guest filesystem and offers it in the project', async () => {
    renderEditor();
    await screen.findByText('README.md');
    fireEvent.click(treeButton('README.md'));
    await waitFor(() => expect(screen.getByRole('tablist', { name: strings.viewMode })).toBeInTheDocument());
    expect(within(screen.getByRole('tablist', { name: strings.viewMode })).getByRole('tab', { name: strings.tabDiff })).toBeInTheDocument();

    pickRoot(strings.rootSystem);
    await waitFor(() => expect(treeButton('etc')).toBeInTheDocument());
    fireEvent.click(treeButton('etc'));
    // Whatever is opened there, the diff tab is not on offer: `/` is not a checkout.
    expect(screen.queryByRole('tab', { name: strings.tabDiff })).toBeNull();
  });

  it('opens on the root a deep link names, and remembers it across a remount', async () => {
    renderEditor('system');
    await waitFor(() => expect(treeButton('etc')).toBeInTheDocument());
    expect(treeRequests.at(-1)).toBe('system');
    cleanup();

    // No `initialRoot` this time: the remembered choice is what reopens, which is what a reload does.
    treeRequests = [];
    renderEditor();
    await waitFor(() => expect(treeButton('etc')).toBeInTheDocument());
    expect(treeRequests).toEqual(['system']);
  });
});

describe('a host project keeps its single root', () => {
  it('offers no root switch and asks for no second tree', async () => {
    resetHandlers();
    setDefaults(
      http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'editor', url: '/x.js', apiVersion: 1, nav: [], settings: [], strings }])),
      http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'member', is_admin: false } })),
      http.get('/api/projects', () => HttpResponse.json([{ id: PROJECT_ID, slug: 'kolin', path: '/var/www/kolin', notes: '', icon: '', pr_enabled: null, executionKind: 'host' }])),
      http.get('/api/projects/:id/files', ({ url }) => { treeRequests.push(url.searchParams.get('root') ?? ''); return HttpResponse.json(TREES.project); }),
      http.get('/api/projects/:id/changed', () => HttpResponse.json({ changed: [] })),
    );
    renderEditor();
    await screen.findByText('README.md');
    expect(screen.queryByRole('tablist', { name: strings.rootLabel })).toBeNull();
    expect(treeRequests).toEqual(['project']);
    // No guest mount to name, so the header carries no absolute path.
    expect(screen.queryByTitle('/kolin')).toBeNull();
  });

  it('ignores a remembered guest root that this project does not have', async () => {
    // The choice is persisted across projects, and a host project must not inherit it as a request the
    // daemon would only refuse.
    localStorage.setItem('elowen.editor.root', 'system');
    resetHandlers();
    setDefaults(
      http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'editor', url: '/x.js', apiVersion: 1, nav: [], settings: [], strings }])),
      http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'member', is_admin: false } })),
      http.get('/api/projects', () => HttpResponse.json([{ id: PROJECT_ID, slug: 'kolin', path: '/var/www/kolin', notes: '', icon: '', pr_enabled: null, executionKind: 'host' }])),
      http.get('/api/projects/:id/files', ({ url }) => { treeRequests.push(url.searchParams.get('root') ?? ''); return HttpResponse.json(TREES.project); }),
      http.get('/api/projects/:id/changed', () => HttpResponse.json({ changed: [] })),
    );
    renderEditor();
    await screen.findByText('README.md');
    expect(treeRequests).toEqual(['project']);
  });
});
