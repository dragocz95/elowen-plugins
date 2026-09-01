import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse, listen, resetHandlers, setDefaults, close } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import manifest from '../plugins/editor/elowen-plugin.json' with { type: 'json' };

// View copy is served per-plugin by /plugins/ui; serving the REAL manifest en fallback keeps the
// assertions in lockstep with what production users see. The host dictionary carries none of the
// editor's own labels any more, so a panel that went back to reading them off `t` would break here
// rather than in production once the app deletes the keys nothing references.
const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;

// Monaco is browser-only — stub it with a textarea and capture the Cmd+S command the editor
// registers via `onMount`, so a test can save exactly the way a keyboard user does (the toolbar
// Save button is disabled while a write is pending; Cmd+S is not).
const monaco = vi.hoisted(() => ({
  save: (() => {}) as () => void,
  themes: [] as string[],
  cursorListeners: [] as (() => void)[],
  position: { lineNumber: 1, column: 1 },
  selection: null as { isEmpty(): boolean } | null,
  selectedText: '',
  /** Drives a cursor move the way Monaco would, so the status bar is exercised through its real input. */
  moveCursor(lineNumber: number, column: number, selectedText = '') {
    monaco.position = { lineNumber, column };
    monaco.selectedText = selectedText;
    monaco.selection = { isEmpty: () => selectedText.length === 0 };
    for (const listener of monaco.cursorListeners) listener();
  },
}));

interface MockMonacoEditor {
  addCommand(key: number, cb: () => void): void;
  onDidChangeCursorPosition(cb: () => void): void;
  onDidChangeCursorSelection(cb: () => void): void;
  getPosition(): { lineNumber: number; column: number };
  getSelection(): { isEmpty(): boolean } | null;
  getModel(): { getValueInRange(range: unknown): string };
}
vi.mock('../plugins/editor/web-src/editor/monacoLoader', async () => {
  const { useEffect } = await import('react');
  return {
    MonacoEditor: ({ value, onChange, onMount, beforeMount }: {
      value: string;
      onChange: (v: string | undefined) => void;
      onMount: (editor: MockMonacoEditor, m: { KeyMod: { CtrlCmd: number }; KeyCode: { KeyS: number } }) => void;
      beforeMount?: (m: { editor: { defineTheme: (name: string, theme: unknown) => void } }) => void;
    }) => {
      // The colour table comes from the host runtime, not from the bundle — record what it registers so
      // a runtime that stopped exposing it fails loudly instead of silently rendering Monaco's default.
      beforeMount?.({ editor: { defineTheme: (name) => { monaco.themes.push(name); } } });
      // AFTER mount, which is when the real editor fires it — this used to run during render, and the
      // moment the pane started reporting its cursor position from `onMount` that turned into a
      // setState-during-render loop that hung the suite rather than failing it.
      useEffect(() => {
        onMount({
          addCommand: (_key, cb) => { monaco.save = cb; },
          onDidChangeCursorPosition: (cb) => { monaco.cursorListeners.push(cb); },
          onDidChangeCursorSelection: (cb) => { monaco.cursorListeners.push(cb); },
          getPosition: () => monaco.position,
          getSelection: () => monaco.selection,
          getModel: () => ({ getValueInRange: () => monaco.selectedText }),
        }, { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 } });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <textarea aria-label="editor" value={value} onChange={(e) => onChange(e.target.value)} />;
    },
    MonacoDiffEditor: () => null,
  };
});

// Only the surrounding views are stubbed: the file content itself goes through the real query, so a
// save's cache update is what the pane falls back to when it retires its draft.
vi.mock('../plugins/editor/web-src/editor/MarkdownPreview', () => ({ MarkdownPreview: () => null }));
vi.mock('../plugins/editor/web-src/editor/ImagePreview', () => ({ ImagePreview: ({ path }: { path: string }) => <div>image:{path}</div> }));
vi.mock('../plugins/editor/web-src/editor/PdfPreview', () => ({ PdfPreview: ({ path, office }: { path: string; office?: boolean }) => <div>{office ? 'office' : 'pdf'}:{path}</div> }));
vi.mock('../plugins/editor/web-src/editor/MediaPreview', () => ({ MediaPreview: ({ path }: { path: string }) => <div>media:{path}</div> }));

// The panel resolves its data hooks through window.ElowenUiRuntime, so the host runtime has to be
// installed BEFORE the module is imported (it destructures the hook set at module scope) — which is
// also the order the shipped bundle is loaded in.
let ProjectEditor: ComponentType<{ projectId: number }>;
const desktopMatchMedia = window.matchMedia;
const useMobileViewport = () => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(max-width: 767px)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
};
beforeAll(async () => {
  ensurePluginUiRuntime();
  ({ ProjectEditor } = await import('../plugins/editor/web-src/editor/ProjectEditor'));
});

// Server-side file state. Writes are held open (one gate per path) so a test can type — or start a
// second save — while the first one is still in flight.
const INITIAL = new Map([['a.ts', 'line one\n'], ['b.ts', 'other file\n'], ['data.csv', 'name,value\nalpha,"one,two"\n']]);
let stored = new Map(INITIAL);
const gates = new Map<string, () => void>();
let failing = new Set<string>();
// A read can be parked mid-test: it is the only way to tell the write's own cache update apart from
// the refetch that follows it.
let holdReads = false;
let readGates: Array<() => void> = [];
setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'editor', url: '/plugins/editor/web/index.js', apiVersion: 1, nav: [], settings: [], strings }])),
  http.get('/api/projects/:id/files', () => HttpResponse.json([
    { path: 'a.ts', type: 'file', size: 9 }, { path: 'b.ts', type: 'file', size: 11 },
    { path: 'archive.zip', type: 'file', size: 2048 }, { path: 'report.pdf', type: 'file', size: 1024 },
    { path: 'brief.docx', type: 'file', size: 4096 }, { path: 'clip.mp4', type: 'file', size: 8192 },
    { path: 'huge.mp4', type: 'file', size: 60 * 1024 * 1024 }, { path: 'data.csv', type: 'file', size: 27 },
  ])),
  http.get('/api/projects/:id/file', async ({ url }) => {
    if (holdReads) await new Promise<void>((resolve) => readGates.push(resolve));
    const path = url.searchParams.get('path') ?? '';
    return HttpResponse.json({ content: stored.get(path) ?? '', truncated: false });
  }),
  http.put('/api/projects/:id/file', async ({ request }) => {
    const body = (await request.json()) as { path: string; content: string };
    await new Promise<void>((resolve) => gates.set(body.path, resolve));
    gates.delete(body.path);
    if (failing.has(body.path)) return HttpResponse.json({ error: 'boom' }, { status: 500 });
    stored.set(body.path, body.content);
    return HttpResponse.json({ ok: true });
  }),
  // The tree's changed-file highlighting; a save invalidates it, so it is refetched for real.
  http.get('/api/projects/:id/changed', () => HttpResponse.json({ changed: [] })),
);
// Nothing serves /head, /commit or /changes: those queries are disabled while the edit tab is open on
// the working tree, and an unhandled request here would fail loudly rather than answer a plausible
// empty body — which is stricter than the app-path mock this test used to carry.
beforeAll(() => listen());
beforeEach(() => {
  stored = new Map(INITIAL); gates.clear(); failing = new Set(); holdReads = false; readGates = [];
  // Cursor listeners are registered per mount; without this they accumulate across tests and a later
  // one would drive editors that React has already thrown away.
  monaco.cursorListeners = []; monaco.position = { lineNumber: 1, column: 1 };
  monaco.selection = null; monaco.selectedText = '';
  // Editor preferences persist to localStorage, so one test's font change would leak into the next.
  localStorage.clear();
});
afterEach(() => {
  window.matchMedia = desktopMatchMedia;
  holdReads = false;
  for (const open of [...gates.values(), ...readGates]) open();
  cleanup();
  resetHandlers();
});
afterAll(() => close());

const editorEl = () => screen.getByLabelText('editor') as HTMLTextAreaElement;
const openInTree = (name: string) => fireEvent.click(within(screen.getByRole('tree')).getByRole('button', { name }));
const cachedContent = (client: QueryClient, path: string) =>
  (client.getQueryData(['project-file', 5, path]) as { content: string } | undefined)?.content;

async function renderEditor() {
  const { wrapper: Base, client } = createWrapper();
  const Wrapper = ({ children }: { children: ReactNode }) => <Base><ToastProvider>{children}</ToastProvider></Base>;
  render(<ProjectEditor projectId={5} />, { wrapper: Wrapper });
  // The file listing is a real query here (the app-path mock used to hand it over synchronously), so the
  // tree exists one round-trip after the mount.
  await screen.findByRole('tree');
  openInTree('a.ts');
  await waitFor(() => expect(editorEl().value).toBe('line one\n'));
  return client;
}
const saveNow = async (path: string) => { act(() => monaco.save()); await waitFor(() => expect(gates.has(path)).toBe(true)); };

describe('ProjectEditor copy', () => {
  // The panel used to read these off the host's `t.projects.*`. They are the plugin's own vocabulary and
  // travel with it, so the assertions are literals: comparing against `strings.x` would pass just as
  // happily if the panel had gone back to the host, whereas a literal only holds while the manifest and
  // the rendered text agree.
  it('renders its own manifest copy rather than a host dictionary section', async () => {
    await renderEditor();

    expect(await screen.findByText('Code editor')).toBeInTheDocument();
    // The view modes are one segmented control, so they are tabs rather than loose buttons — the
    // role is the assertion that they read as a single either/or choice and not as five unrelated
    // actions sharing a toolbar.
    expect(screen.getByRole('tab', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Diff' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'View mode' })).toBeInTheDocument();
    // File actions moved into the menu bar; its labels are plugin copy too.
    for (const name of ['File', 'View', 'Settings']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('separator', { name: 'Drag to resize the editor' })).toBeInTheDocument();
    // The file tree's accessible name is plugin copy too — `getByRole('tree')` elsewhere never checks it.
    expect(screen.getByRole('tree')).toHaveAccessibleName('Code editor');
  });

  it('uses accent semantics for the selected file row', async () => {
    await renderEditor();

    const selectedFile = within(screen.getByRole('tree')).getByRole('button', { name: 'a.ts' });
    expect(selectedFile).toHaveClass('bg-accent', 'text-accent-foreground');
    for (const className of ['bg-primary/10', 'text-primary']) {
      expect(selectedFile).not.toHaveClass(className);
    }
  });

  // Fullscreen used to be a hand-rolled `fixed inset-0 z-50 h-screen` div: it measured `vh` rather than
  // `dvh`, it tied with the navigation drawer and the advisor launcher on the shared overlay scale, and
  // its only exit was an unlabelled chevron. It is the host's takeover primitive now, and these are the
  // three properties the hand-rolled surface could not offer.
  it('goes fullscreen as a labelled takeover rather than a hand-rolled overlay', async () => {
    await renderEditor();

    const inlineWorkbench = screen.getByRole('region', { name: 'Code editor' });
    expect(inlineWorkbench).toHaveClass('rounded-lg', 'border', 'border-border', 'bg-card');

    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Fullscreen' }));

    const takeover = await screen.findByRole('dialog', { name: 'Code editor' });
    expect(takeover).toHaveAttribute('data-presentation', 'fullscreen');
    // Production WorkspaceTakeover has two direct rows: its own top strip, then the flex body. Editor
    // controls belong inside that body, never in the takeover strip beside Back and the title.
    const topStrip = takeover.firstElementChild as HTMLElement;
    const takeoverBody = takeover.lastElementChild as HTMLElement;
    const editorToolbar = within(takeover).getByRole('toolbar', { name: 'Code editor' });
    expect(topStrip).not.toBe(takeoverBody);
    expect(within(topStrip).queryByRole('toolbar')).not.toBeInTheDocument();
    expect(topStrip).not.toContainElement(editorToolbar);
    expect(takeoverBody).toContainElement(editorToolbar);
    expect(within(takeover).getAllByRole('toolbar', { name: 'Code editor' })).toHaveLength(1);
    for (const name of ['File', 'View', 'Settings']) {
      expect(within(editorToolbar).getByRole('menuitem', { name })).toBeInTheDocument();
    }

    const fullscreenWorkbench = within(takeoverBody).getByRole('region', { name: 'Code editor' });
    expect(fullscreenWorkbench).toHaveClass('min-h-0', 'min-w-0', 'overflow-hidden');
    for (const className of ['bg-card', 'border', 'rounded-lg']) {
      expect(fullscreenWorkbench).not.toHaveClass(className);
    }
    // One exit, and it says what it does.
    const back = within(topStrip).getByRole('button', { name: 'Exit fullscreen' });

    fireEvent.click(back);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // …and the editor is still there, inline, with the file still open and its card ownership restored.
    expect(editorEl().value).toBe('line one\n');
    expect(screen.getByRole('region', { name: 'Code editor' })).toHaveClass('rounded-lg', 'border', 'bg-card');
  });

  it('exits desktop fullscreen without a discard prompt because the editor stays mounted', async () => {
    await renderEditor();
    fireEvent.change(editorEl(), { target: { value: 'draft text\n' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Fullscreen' }));
    const takeover = await screen.findByRole('dialog', { name: 'Code editor' });
    fireEvent.click(within(takeover).getByRole('button', { name: 'Exit fullscreen' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(confirm).not.toHaveBeenCalled();
    expect(editorEl()).toHaveValue('draft text\n');
    confirm.mockRestore();
  });

  it('discards a dirty tab only after confirmation and does not restore its stale draft', async () => {
    await renderEditor();
    fireEvent.change(editorEl(), { target: { value: 'discard me\n' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    openInTree('a.ts');

    await waitFor(() => expect(editorEl()).toHaveValue('line one\n'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(confirm).toHaveBeenCalledWith(strings.discardChanges);
    confirm.mockRestore();
  });

  it('keeps every file-open control reachable in the wrapping phone toolbar', async () => {
    useMobileViewport();
    const { wrapper: Base } = createWrapper();
    const Wrapper = ({ children }: { children: ReactNode }) => <Base><ToastProvider>{children}</ToastProvider></Base>;
    render(<ProjectEditor projectId={5} />, { wrapper: Wrapper });

    const takeover = await screen.findByRole('dialog', { name: 'Code editor' });
    fireEvent.click(within(takeover).getByRole('button', { name: 'Files' }));
    await screen.findByRole('tree');
    openInTree('a.ts');
    await waitFor(() => expect(editorEl().value).toBe('line one\n'));

    const toolbar = within(takeover).getByRole('toolbar', { name: 'Code editor' });
    expect(toolbar).toHaveClass('flex-wrap', 'max-w-full');
    expect(toolbar.closest('section')).toHaveClass('min-w-0', 'overflow-hidden');
    const trailingControls = toolbar.querySelector('.ml-auto');
    expect(trailingControls).toHaveClass('flex-wrap', 'max-w-full');
    for (const name of ['File', 'View', 'Settings']) {
      expect(within(toolbar).getByRole('menuitem', { name })).toBeInTheDocument();
    }
    expect(within(toolbar).getByRole('tablist', { name: 'View mode' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('reports the caret and the selection size in the status bar', async () => {
    await renderEditor();

    // Monaco is the only thing that knows where the caret is, so the bar is driven the way the real
    // editor drives it — through the cursor events the pane subscribed to.
    act(() => { monaco.moveCursor(4, 9); });
    expect(await screen.findByText(/Ln 4, Col 9/)).toBeInTheDocument();

    // A selection adds its size, which is the reading the bar exists for during a review.
    act(() => { monaco.moveCursor(4, 12, 'abc'); });
    expect(await screen.findByText(/3 selected/)).toBeInTheDocument();
  });
});

describe('ProjectEditor preview routing', () => {
  it('never sends unknown binary files or oversized media to Monaco', async () => {
    await renderEditor();
    openInTree('archive.zip');
    expect(await screen.findByText('application/octet-stream')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.queryByLabelText('editor')).not.toBeInTheDocument();

    openInTree('huge.mp4');
    expect(await screen.findByText('This file is too large to preview safely in the editor.')).toBeInTheDocument();
    expect(screen.getByText('This file is too large to download through the editor.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
    expect(screen.queryByText('media:huge.mp4')).not.toBeInTheDocument();
  });

  it('routes PDF, Office and media files to their dedicated previews', async () => {
    await renderEditor();
    openInTree('report.pdf');
    expect(await screen.findByText('pdf:report.pdf')).toBeInTheDocument();
    openInTree('brief.docx');
    expect(await screen.findByText('office:brief.docx')).toBeInTheDocument();
    openInTree('clip.mp4');
    expect(await screen.findByText('media:clip.mp4')).toBeInTheDocument();
  });

  it('opens CSV as a parsed table and preserves quoted commas', async () => {
    await renderEditor();
    openInTree('data.csv');
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText('one,two')).toBeInTheDocument();
    expect(screen.queryByLabelText('editor')).not.toBeInTheDocument();
  });
});

describe('ProjectEditor save', () => {
  it('themes Monaco from the host runtime rather than a colour table of its own', async () => {
    await renderEditor();
    expect(monaco.themes).toContain('elowen-oled');
  });

  it('keeps edits typed while the save is in flight', async () => {
    const client = await renderEditor();

    fireEvent.change(editorEl(), { target: { value: 'saved text\n' } });
    await saveNow('a.ts');

    // The user keeps typing before the write comes back: the save may only retire a draft that still
    // holds exactly what it sent, or it would swallow these keystrokes.
    fireEvent.change(editorEl(), { target: { value: 'saved text\nstill typing\n' } });
    act(() => { gates.get('a.ts')?.(); });
    await screen.findByText('Saved a.ts');
    await waitFor(() => expect(cachedContent(client, 'a.ts')).toBe('saved text\n'));

    expect(editorEl().value).toBe('saved text\nstill typing\n');
    // …and the file is still dirty, so the newer text can actually be saved.
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('keeps the saved text on screen after retiring the draft', async () => {
    await renderEditor();
    // The refetch the save triggers is parked, so what stays on screen can only come from the cache
    // update the write itself made.
    holdReads = true;

    fireEvent.change(editorEl(), { target: { value: 'saved text\n' } });
    await saveNow('a.ts');
    act(() => { gates.get('a.ts')?.(); });
    await screen.findByText('Saved a.ts');

    // Draft retired → the pane falls back to the file cache. Falling back to the pre-save content
    // here would look to the user like the save had been undone.
    expect(editorEl().value).toBe('saved text\n');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('completes every save, not just the most recent one', async () => {
    // Cmd+S does not block, so the user can save a.ts, switch tab and save b.ts before a.ts answers.
    // Both saves must finish their own cleanup — here the older one fails and has to reach its toast
    // and keep its draft, while the newer one is retired as usual.
    failing.add('a.ts');
    await renderEditor();

    fireEvent.change(editorEl(), { target: { value: 'edited a\n' } });
    await saveNow('a.ts');

    openInTree('b.ts');
    await waitFor(() => expect(editorEl().value).toBe('other file\n'));
    fireEvent.change(editorEl(), { target: { value: 'edited b\n' } });
    await saveNow('b.ts');

    act(() => { gates.get('b.ts')?.(); });
    await screen.findByText('Saved b.ts');
    act(() => { gates.get('a.ts')?.(); });
    await screen.findByText(/elowen 500/);

    // b.ts is saved and clean…
    await waitFor(() => expect(editorEl().value).toBe('edited b\n'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    // …while the failed a.ts keeps its unsaved text.
    openInTree('a.ts');
    await waitFor(() => expect(editorEl().value).toBe('edited a\n'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
