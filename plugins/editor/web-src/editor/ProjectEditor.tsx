import { useMemo, useRef, useState, useEffect, type MouseEvent } from 'react';
import { File as FileIcon, Save, Code2, GitCompare, HardDrive, FolderTree, AlertTriangle, X, FilePlus, FolderPlus, Pencil, Copy, Trash2, ClipboardCopy, Eye, WrapText, Maximize2, Minimize2, PanelLeft, Upload, Download, Type, AlignLeft, Map as MapIcon, Check } from 'lucide-react';
import { runtime } from '../runtime';
import { buildTree, parentDir, joinPath, copyName, fileKindOf, baseName, langOf, type TreeNode } from './helpers';
import { MAX_BUFFERED_BYTES, MAX_MEDIA_PREVIEW_BYTES, MAX_OFFICE_BYTES } from '../../src/fileTypes';
import { SYSTEM_PROJECT_ID, SYSTEM_ROOT } from '../../src/systemRoot';
import { DEFAULT_EDITOR_ROOT, EDITOR_ROOTS, GUEST_SYSTEM_ROOT, type EditorRoot } from '../../src/editorRoots';
import { useEditorFile, useEditorTree, useEditorTreeMutations, editorFileKey, editorTreeKey, saveEditorFile } from './fileData';
import { editorFileUrl } from './fileUrls';
import { useLazyDirs } from './lazyTree';
import { FileTree } from './FileTree';
import { PromptDialog, ConfirmDialog } from './dialogs';
import { EditorPane, type CursorState } from './EditorPane';
import { DiffEditorPane } from './DiffEditorPane';
import { MenuBar } from './MenuBar';
import { ViewSwitch } from './ViewSwitch';
import { StatusBar } from './StatusBar';
import { uploadFile, UploadError } from './upload';
import { DIVIDER, type ContextMenuState, type MenuDescriptor, type MenuEntry } from './menu';
import { normalisePrefs, DEFAULT_PREFS, TAB_SIZES, MIN_FONT_SIZE, MAX_FONT_SIZE, type EditorPrefs } from './editorOptions';
import { MarkdownPreview } from './MarkdownPreview';
import { ImagePreview } from './ImagePreview';
import { PdfPreview } from './PdfPreview';
import { MediaPreview } from './MediaPreview';
import { BinaryPreview } from './BinaryPreview';
import { CsvPreview } from './CsvPreview';
import { Tabs } from './Tabs';

const { hooks, components, utils } = runtime();
const { useProjects, useProjectFileAtHead, useProjectCommit, useProjectCommitFileDiff, useProjectChanged, useProjectChanges, useMobile, useToast, useTranslation, usePluginStrings, usePersistentState } = hooks;
// PatchView is the host's own diff renderer — the editor carried a verbatim copy of it until the
// runtime started publishing it.
const { Button, LoadingState, EmptyState, ContextMenu, PatchView, WorkspaceTakeover } = components;

type Tab = 'edit' | 'diff' | 'preview';
type Dialog =
  | { kind: 'newFile' | 'newFolder'; dir: string }
  | { kind: 'rename' | 'duplicate' | 'delete'; target: string };

// Embedded (non-fullscreen) editor height, persisted per device. The user drags the full bottom edge
// (see the resize handle below); Monaco reflows itself via `automaticLayout`.
const EDITOR_H_KEY = 'elowen:editor:height';
const PREFS_KEY = 'elowen:editor:prefs';
/** The root a managed project reopens on. Remembered across reloads so returning to the environment does
 *  not silently drop back to the project tree, and validated on restore because the slot is
 *  user-writable. A deep link naming a root still wins over it. */
const ROOT_KEY = 'elowen.editor.root';
const MIN_EDITOR_H = 320;
const clampEditorH = (px: number) =>
  Math.max(MIN_EDITOR_H, Math.min(typeof window !== 'undefined' ? window.innerHeight * 0.96 : 4000, px));

/** Full project code editor: file tree with a right-click file-manager (new/rename/duplicate/delete),
 *  open-file tabs, Monaco editor (Cmd+S save), side-by-side working diff, Markdown/image previews,
 *  plus read-only commit-diff views when opened from the git log. */
export function ProjectEditor({ projectId, onClose, initialCommit, initialWorking, initialRoot, fill = false }: { projectId: number; onClose?: () => void; initialCommit?: string | null; initialWorking?: boolean; initialRoot?: EditorRoot; fill?: boolean }) {
  // `s` is this plugin's own copy (manifest `web.strings` + i18n/<lang>.json); `t` is the host's shared
  // vocabulary, which still owns the generic Save/Close/Back labels the whole app spells the same way.
  const s = usePluginStrings('editor');
  const queryClient = hooks.useQueryClient();
  const { t } = useTranslation();
  const { toast } = useToast();
  // The HOST system root is the whole server filesystem behind a reserved project id (admin only — the
  // daemon, not this flag, is what refuses it to anyone else). It is browsed one directory at a time and
  // has no repository behind it, so the git views are not offered. It is a different thing from a managed
  // project's system root below, which is that project's own guest filesystem.
  const hostSystem = projectId === SYSTEM_PROJECT_ID;
  const projects = useProjects();
  const projectRow = projects.data?.find((item) => item.id === projectId);
  // Only a managed project has two roots. A host project is a directory on this server and keeps the one
  // it always had; the whole-filesystem view stays an administrator capability behind the reserved id.
  const dualRoot = projectRow?.executionKind === 'managed';
  const [storedRoot, setStoredRoot] = usePersistentState<EditorRoot>(ROOT_KEY, initialRoot ?? DEFAULT_EDITOR_ROOT, EDITOR_ROOTS);
  // Clamped, not merely defaulted: a remembered `system` must not travel to a project that has no such
  // root, where every request would be refused and the tree would read as an empty project.
  const root: EditorRoot = dualRoot ? storedRoot : DEFAULT_EDITOR_ROOT;
  const systemRoot = hostSystem || root === 'system';
  // Which root to ask for is known only after TWO things have settled: the remembered choice, which
  // localStorage hands over in an effect, and the project row, which says whether this project has a
  // second root at all. Asking before then spends a guest crossing on the wrong root — for a managed
  // project that is a container execution — and flashes its files before replacing them.
  const [restored, setRestored] = useState(false);
  useEffect(() => { setRestored(true); }, []);
  const rootReady = restored && !projects.isLoading;
  const files = useEditorTree(projectId, root, rootReady);
  // Bumped after every file operation so the opened levels are read again: react-query refetches the
  // root listing on its own, but it knows nothing about the levels below it.
  const [treeEpoch, setTreeEpoch] = useState(0);
  const bumpTree = () => setTreeEpoch((n) => n + 1);
  const [selected, setSelected] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [commit] = useState<string | null>(initialCommit ?? null);
  const [working] = useState<boolean>(!!initialWorking);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>('edit');
  const [prefs, setPrefs] = useState<EditorPrefs>(DEFAULT_PREFS);
  const [cursor, setCursor] = useState<CursorState | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // Embedded height (px), hydrated from localStorage on mount; defaults to ~70vh.
  const [editorH, setEditorH] = useState(560);
  const dragY = useRef<number | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Mirror of `drafts` for save continuations: they run after a network round-trip, by which time the
  // closure they were created in holds a stale copy. It is written together with the state, never from
  // an effect — a continuation that read a mirror one keystroke behind would retire a draft that
  // already holds newer text, so the mirror must not depend on when React flushes effects.
  const draftsRef = useRef(drafts);
  const draftVersions = useRef<Record<string, string>>({});
  const saveQueues = useRef(new Map<string, Promise<unknown>>());
  const updateDrafts = (fn: (d: Record<string, string>) => Record<string, string>) => {
    draftsRef.current = fn(draftsRef.current);
    setDrafts(draftsRef.current);
  };
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set());
  // On mobile the file tree is hidden by default in fullscreen (it eats too much of the narrow
  // viewport); a toggle surfaces it as an overlay. On desktop the tree is always visible.
  const mobile = useMobile();
  const [showTree, setShowTree] = useState(false);

  // Hydrate the saved embedded height (or fall back to ~70vh) once on mount, then persist on change.
  useEffect(() => {
    let stored: number | null = null;
    try {
      const raw = localStorage.getItem(EDITOR_H_KEY);
      if (raw) { const n = Number(raw); if (Number.isFinite(n)) stored = n; }
    } catch { /* localStorage unavailable (private mode / SSR) */ }
    setEditorH(clampEditorH(stored ?? window.innerHeight * 0.7));
  }, []);
  useEffect(() => {
    try { localStorage.setItem(EDITOR_H_KEY, String(editorH)); } catch { /* ignore */ }
  }, [editorH]);

  // Editor preferences, same lifecycle as the height above. Everything restored goes through
  // `normalisePrefs` because localStorage is user-writable: a font size of 0 read back verbatim would
  // render an editor nobody can use, including the menu that would put it right.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) setPrefs(normalisePrefs(JSON.parse(raw)));
    } catch { /* absent, unreadable, or not JSON — the defaults already stand */ }
  }, []);
  const updatePrefs = (patch: Partial<EditorPrefs>) => {
    setPrefs((current) => {
      const next = normalisePrefs({ ...current, ...patch });
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Every git read is disabled under a system root rather than left to answer empty: `/` is not a
  // checkout, and a query per panel would spend a request each to be told so. The daemon says the same
  // thing on its own — version history belongs to the project root — so this is the view agreeing with
  // it rather than the only thing enforcing it.
  const gitId = systemRoot ? null : projectId;
  const commitData = useProjectCommit(gitId, commit);
  const changesData = useProjectChanges(gitId, working);
  const commitFileDiff = useProjectCommitFileDiff(gitId, commit, commit ? selected : null);
  // Keep the raw query value (stable ref) out of the memo deps; default to [] inside the callback so a
  // fresh `?? []` doesn't change the deps on every render.
  const workingChanged = useProjectChanged(gitId).data?.changed;
  // In commit mode highlight the files that commit touched; otherwise the uncommitted working set.
  const changedSet = useMemo(
    () => new Set(commit ? (commitData.data?.files ?? []) : (workingChanged ?? [])),
    [commit, commitData.data?.files, workingChanged],
  );

  // The root listing plus every level opened under it. Both roots are read one directory at a time: a
  // project is not small enough to arrive whole, and a depth bound that holds for a repository with a
  // vendored dependency tree does not exist.
  //
  // A project folder that cannot be read is reported, and it collapses rather than sitting open and
  // empty. A filesystem root stays silent, where an unreadable directory is ordinary.
  const lazyDirs = useLazyDirs(projectId, root, rootReady, expanded, treeEpoch, systemRoot ? undefined : (dir, error) => {
    setExpanded((current) => { const next = new Set(current); next.delete(dir); return next; });
    toast(`${dir}: ${utils.apiErrorMessage(error)}`, 'error');
  });
  const nodes = useMemo(() => {
    const byPath = new Map((files.data ?? []).map((node) => [node.path, node]));
    for (const node of lazyDirs) byPath.set(node.path, node);
    return [...byPath.values()];
  }, [files.data, lazyDirs]);

  const selectedFile = selected ? nodes.find((node) => node.type === 'file' && node.path === selected) : undefined;
  const fileKind = selected ? fileKindOf(selected) : null;
  const textFile = fileKind === 'text' || fileKind === 'markdown' || fileKind === 'csv';
  const fileData = useEditorFile(projectId, root, textFile ? selected : null);
  const { newFile, newDir, rename, copy, remove: del } = useEditorTreeMutations(projectId, root);

  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const serverContent = fileData.data?.content ?? '';
  const draft = selected != null ? drafts[selected] : undefined;
  const value = draft ?? serverContent;
  const dirty = selected != null && dirtyPaths.has(selected);
  const previewableText = fileKind === 'markdown' || fileKind === 'csv';
  const editable = selected != null && textFile && !commit && !working;
  const effTab: Tab = (tab === 'preview' && !previewableText) || (tab === 'diff' && systemRoot) ? 'edit' : tab;
  const fileSize = selectedFile?.size ?? 0;
  // Where the open file actually lives, for the roots whose relative paths mean nothing on their own.
  // A managed project's mount comes from the host's projection (`guestRoot`), so the slug rule is stated
  // once — on the daemon, which also resolves every request from it — and the interface only repeats it.
  // A host project shows nothing here: its tree is the project and there is no second place to be.
  const rootDisplay = hostSystem ? SYSTEM_ROOT : root === 'system' ? GUEST_SYSTEM_ROOT : (projectRow?.guestRoot ?? null);
  const absoluteHint = rootDisplay === null ? null
    : rootDisplay === '/' ? `/${selected ?? ''}`
    : selected ? `${rootDisplay}/${selected}` : rootDisplay;

  const headData = useProjectFileAtHead(gitId, selected, editable && effTab === 'diff');

  const openFile = (p: string) => { setSelected(p); setOpenTabs((tabs) => (tabs.includes(p) ? tabs : [...tabs, p])); setTab(fileKindOf(p) === 'csv' ? 'preview' : 'edit'); };
  // In commit mode, picking a file shows its diff within that commit (read-only); else open the file.
  const selectInTree = (p: string) => { if (commit) setSelected(p); else openFile(p); };
  const onChange = (v: string) => {
    if (selected == null) return;
    if (draftsRef.current[selected] === undefined && fileData.data?.version) draftVersions.current[selected] = fileData.data.version;
    updateDrafts((d) => ({ ...d, [selected]: v }));
    setDirtyPaths((cur) => { const n = new Set(cur); v !== serverContent ? n.add(selected) : n.delete(selected); return n; });
  };
  const toggle = (p: string) => setExpanded((cur) => { const n = new Set(cur); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const expandPath = (dir: string) => setExpanded((cur) => { const n = new Set(cur); let acc = ''; for (const part of dir.split('/').filter(Boolean)) { acc = acc ? `${acc}/${part}` : part; n.add(acc); } return n; });

  const confirmDiscard = () => dirtyPaths.size === 0 || window.confirm(s.discardChanges);

  /** Switch which root the editor is looking at.
   *
   *  Everything that names a path is cleared rather than carried over. `src/app.ts` is a file in the
   *  project tree and, under the system root, a path that usually does not exist at all — and where it
   *  does, it is a different file. Remapping would therefore be a guess; the tabs, drafts, expanded
   *  folders and selection are dropped, and unsaved work is confirmed first exactly as closing a tab
   *  confirms it. */
  const changeRoot = (next: EditorRoot) => {
    if (next === root || !dualRoot) return;
    if (!confirmDiscard()) return;
    updateDrafts(() => ({}));
    draftVersions.current = {};
    setDirtyPaths(new Set());
    setOpenTabs([]);
    setSelected(null);
    setExpanded(new Set());
    setTab('edit');
    setStoredRoot(next);
    bumpTree();
  };
  // A deep link naming a root wins over the remembered one, the way a linked project wins over the
  // remembered filter, and then BECOMES the remembered one so a reload stays where the link put the
  // user. It waits for the project row: until that arrives nothing knows whether this project has a
  // second root at all, and consuming the link before then would drop it silently.
  const linkedRoot = useRef(initialRoot);
  useEffect(() => {
    if (!linkedRoot.current || !dualRoot) return;
    const wanted = linkedRoot.current;
    linkedRoot.current = undefined;
    setStoredRoot(wanted);
  }, [dualRoot, setStoredRoot]);

  // The one exit from the fullscreen takeover — its back control and Escape both land here. On a phone
  // the takeover replaced the app navigation and fullscreen is not the user's choice (it is forced
  // below), so leaving means leaving the editor; on desktop it only drops back to the still-mounted
  // inline card and therefore must not ask to discard drafts that remain intact.
  //
  // A dialog registers with the host's overlay stack and takes Escape before the takeover ever sees it,
  // but the context menu is portalled outside that stack, so it is dismissed here instead of letting
  // one key press close both it and the editor.
  const leaveFullscreen = () => {
    if (menu) { setMenu(null); setOpenMenu(null); return; }
    if (mobile && onClose) {
      if (!confirmDiscard()) return;
      setShowTree(false);
      onClose();
      return;
    }
    setShowTree(false);
    setFullscreen(false);
  };

  const closeEditor = () => {
    if (confirmDiscard()) onClose?.();
  };

  // Auto-fullscreen on mobile so the editor owns the whole viewport (the inline card is too cramped on
  // a phone). There is no inline view to return to there — the takeover's back control leaves the
  // editor instead, which is what `leaveFullscreen` does above.
  useEffect(() => { if (mobile) setFullscreen(true); }, [mobile]);
  // Reset the tree overlay whenever it stops being relevant (exit fullscreen, or switch to desktop).
  useEffect(() => { if (!fullscreen || !mobile) setShowTree(false); }, [fullscreen, mobile]);
  useEffect(() => {
    if (dirtyPaths.size === 0) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyPaths.size]);

  // Cmd+S doesn't block on a pending write, so several saves can overlap. Each one awaits its OWN
  // promise: `mutate(…, { onSuccess })` would attach the callbacks to the hook's single observer, and
  // the next save would detach them — the earlier file's draft would never be retired and its failure
  // would never reach a toast.
  const save = () => {
    if (selected == null) return;
    const path = selected;
    const sent = value;
    const version = draftVersions.current[path] ?? fileData.data?.version;
    const fileKey = editorFileKey(projectId, root, path);
    setSaving(true);
    // Every save of one path queues behind the previous one, whether or not the destination carries a
    // content version. Two overlapping writes to the same file used to be ordered only on the versioned
    // path, so on a host project the slower, older request could settle last and put stale text back
    // into the cache and onto disk.
    const operation = (saveQueues.current.get(path) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const next = await saveEditorFile(projectId, root, path, sent, draftVersions.current[path] ?? version);
      if (next !== undefined) draftVersions.current[path] = next;
      queryClient.setQueryData(fileKey, { content: sent, truncated: false, version: next });
      void queryClient.invalidateQueries({ queryKey: fileKey });
      void queryClient.invalidateQueries({ queryKey: editorTreeKey(projectId, root) });
      void queryClient.invalidateQueries({ queryKey: ['project-changed', projectId] });
    });
    saveQueues.current.set(path, operation);
    void operation.then(
      () => {
        // The user can keep typing while the write is in flight, and the draft is what the pane
        // renders. Retire it only when it still holds exactly what we sent — otherwise clearing it
        // would drop those newer keystrokes and fall back to the saved content.
        const current = draftsRef.current[path];
        if (current === undefined || current === sent) {
          updateDrafts((d) => { const n = { ...d }; delete n[path]; return n; });
          setDirtyPaths((cur) => { const n = new Set(cur); n.delete(path); return n; });
        }
        toast(s.fileSaved.replace('{path}', path));
      },
      (e: unknown) => toast(utils.apiErrorMessage(e), 'error'),
    ).finally(() => {
      setSaving(false);
      if (saveQueues.current.get(path) === operation) saveQueues.current.delete(path);
    });
  };

  const closeTab = (p: string) => {
    if (dirtyPaths.has(p)) {
      if (!window.confirm(s.discardChanges)) return;
      updateDrafts((drafts) => { const next = { ...drafts }; delete next[p]; return next; });
      setDirtyPaths((paths) => { const next = new Set(paths); next.delete(p); return next; });
    }
    setOpenTabs((tabs) => {
      const next = tabs.filter((x) => x !== p);
      if (selected === p) setSelected(next[next.length - 1] ?? null);
      return next;
    });
  };

  // Drop a path (and anything under it, for a directory) from open tabs, drafts, and selection.
  const forgetPath = (path: string) => {
    const under = (x: string) => x === path || x.startsWith(path + '/');
    setOpenTabs((tabs) => tabs.filter((x) => !under(x)));
    updateDrafts((d) => { const n = { ...d }; for (const k of Object.keys(n)) if (under(k)) delete n[k]; return n; });
    setDirtyPaths((cur) => { const n = new Set([...cur].filter((x) => !under(x))); return n; });
    setSelected((cur) => (cur && under(cur) ? null : cur));
  };
  // Re-point a moved path (and descendants) across tabs, drafts, and selection.
  const remapPath = (from: string, to: string) => {
    const remap = (x: string) => (x === from ? to : x.startsWith(from + '/') ? to + x.slice(from.length) : x);
    setOpenTabs((tabs) => tabs.map(remap));
    updateDrafts((d) => { const n: Record<string, string> = {}; for (const [k, v] of Object.entries(d)) n[remap(k)] = v; return n; });
    setDirtyPaths((cur) => new Set([...cur].map(remap)));
    setSelected((cur) => (cur ? remap(cur) : cur));
  };

  const err = (e: unknown) => toast(utils.apiErrorMessage(e), 'error');
  const copyPath = (p: string) => { void utils.copyText(p).then((ok) => { if (ok) toast(s.pathCopied); else toast(s.copyFailed, 'error'); }); };

  // A picked or dropped file lands beside whatever is selected, and in the project root otherwise —
  // the same place a "New file" would have gone, so there is one rule to learn rather than two.
  const uploadDir = selected ? parentDir(selected) : '';
  const runUpload = (chosen: File[], dir: string) => {
    if (!chosen.length || uploading) return;
    setUploading(true);
    void (async () => {
      let done = 0;
      for (const file of chosen) {
        try {
          await uploadFile(projectId, root, joinPath(dir, file.name), file);
          done += 1;
        } catch (error) {
          // Report per file and keep going: refusing the whole drop because the third file already
          // exists would throw away two transfers that were perfectly fine.
          toast(`${file.name}: ${error instanceof UploadError ? error.message : String(error)}`, 'error');
        }
      }
      setUploading(false);
      if (done > 0) {
        // The tree is a query, and nothing else knows the project gained a file.
        files.refetch();
        bumpTree();
        expandPath(dir);
        toast(s.uploaded.replace('{count}', String(done)));
      }
    })();
  };
  const download = (path: string) => {
    const anchor = document.createElement('a');
    anchor.href = editorFileUrl(projectId, 'raw', root, { path, download: '1' });
    anchor.download = baseName(path);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const submitDialog = (val: string) => {
    if (!dialog) return;
    if (dialog.kind === 'newFile') {
      const path = joinPath(dialog.dir, val);
      newFile.mutate({ path }, { onSuccess: () => { bumpTree(); expandPath(dialog.dir); openFile(path); toast(s.fileCreated.replace('{path}', path)); }, onError: err });
    } else if (dialog.kind === 'newFolder') {
      const path = joinPath(dialog.dir, val);
      newDir.mutate({ path }, { onSuccess: () => { bumpTree(); expandPath(path); toast(s.folderCreated.replace('{path}', path)); }, onError: err });
    } else if (dialog.kind === 'rename') {
      const to = joinPath(parentDir(dialog.target), val);
      rename.mutate({ from: dialog.target, to }, { onSuccess: () => { bumpTree(); remapPath(dialog.target, to); toast(s.renamed.replace('{path}', to)); }, onError: err });
    } else if (dialog.kind === 'duplicate') {
      const to = joinPath(parentDir(dialog.target), val);
      copy.mutate({ from: dialog.target, to }, { onSuccess: () => { bumpTree(); toast(s.duplicated.replace('{path}', to)); }, onError: err });
    }
    setDialog(null);
  };
  const confirmDelete = () => {
    if (dialog?.kind !== 'delete') return;
    const path = dialog.target;
    del.mutate({ path }, { onSuccess: () => { bumpTree(); forgetPath(path); toast(s.deleted.replace('{path}', path)); }, onError: err });
    setDialog(null);
  };

  // Build the right-click menu for a node (file or dir) or the tree background (null → project root).
  const buildMenu = (node: TreeNode | null): MenuEntry[] => {
    if (!node) return [
      { label: s.ctxNewFile, icon: FilePlus, onClick: () => setDialog({ kind: 'newFile', dir: '' }) },
      { label: s.ctxNewFolder, icon: FolderPlus, onClick: () => setDialog({ kind: 'newFolder', dir: '' }) },
    ];
    const common: MenuEntry[] = [
      { label: s.ctxRename, icon: Pencil, onClick: () => setDialog({ kind: 'rename', target: node.path }) },
      { label: s.ctxDuplicate, icon: Copy, onClick: () => setDialog({ kind: 'duplicate', target: node.path }) },
      { label: s.ctxDelete, icon: Trash2, danger: true, onClick: () => setDialog({ kind: 'delete', target: node.path }) },
      DIVIDER,
      { label: s.ctxCopyPath, icon: ClipboardCopy, onClick: () => copyPath(node.path) },
    ];
    if (node.type === 'dir') return [
      { label: s.ctxNewFile, icon: FilePlus, onClick: () => setDialog({ kind: 'newFile', dir: node.path }) },
      { label: s.ctxNewFolder, icon: FolderPlus, onClick: () => setDialog({ kind: 'newFolder', dir: node.path }) },
      DIVIDER, ...common,
    ];
    return [
      { label: s.ctxOpen, icon: FileIcon, onClick: () => openFile(node.path) },
      DIVIDER, ...common,
    ];
  };
  const onContextMenu = (e: MouseEvent, node: TreeNode | null) => { setOpenMenu(null); setMenu({ x: e.clientX, y: e.clientY, items: buildMenu(node) }); };

  // The toolbar menus. They are built from the SAME MenuEntry shape as the right-click menu, so an
  // action reads and behaves identically wherever the user reaches for it. A toggle shows its state
  // through a check in the icon slot rather than a marker glued into the label.
  const menus: MenuDescriptor[] = [
    { id: 'file', label: s.menuFile, items: [
      // Which root is open belongs with the file actions rather than beside the view mode: it decides
      // WHICH files everything else in this menu operates on. As a submenu it costs the toolbar no
      // width, and the host's menu is the shadcn/Radix one, so arrow keys, Enter, Escape and the
      // checked state come with it. Only a managed project has a second root to offer.
      ...(dualRoot ? [
        {
          label: s.rootLabel,
          icon: rootDisplay === GUEST_SYSTEM_ROOT ? HardDrive : FolderTree,
          items: [
            { label: s.rootProject, icon: root === 'project' ? Check : FolderTree, onClick: () => changeRoot('project') },
            { label: s.rootSystem, icon: root === 'system' ? Check : HardDrive, onClick: () => changeRoot('system') },
          ],
        } as MenuEntry,
        DIVIDER,
      ] : []),
      { label: s.ctxNewFile, icon: FilePlus, onClick: () => setDialog({ kind: 'newFile', dir: uploadDir }) },
      { label: s.ctxNewFolder, icon: FolderPlus, onClick: () => setDialog({ kind: 'newFolder', dir: uploadDir }) },
      DIVIDER,
      { label: s.menuUpload, icon: Upload, disabled: uploading, onClick: () => fileInput.current?.click() },
      { label: s.download, icon: Download, disabled: !selected, onClick: () => { if (selected) download(selected); } },
      DIVIDER,
      { label: s.ctxRename, icon: Pencil, disabled: !selected, onClick: () => { if (selected) setDialog({ kind: 'rename', target: selected }); } },
      { label: s.ctxDuplicate, icon: Copy, disabled: !selected, onClick: () => { if (selected) setDialog({ kind: 'duplicate', target: selected }); } },
      { label: s.ctxDelete, icon: Trash2, danger: true, disabled: !selected, onClick: () => { if (selected) setDialog({ kind: 'delete', target: selected }); } },
    ] },
    { id: 'view', label: s.menuView, items: [
      { label: s.wordWrap, icon: prefs.wordWrap ? Check : WrapText, onClick: () => updatePrefs({ wordWrap: !prefs.wordWrap }) },
      { label: s.menuMinimap, icon: prefs.minimap ? Check : MapIcon, onClick: () => updatePrefs({ minimap: !prefs.minimap }) },
      DIVIDER,
      { label: fullscreen ? s.exitFullscreen : s.fullscreen, icon: fullscreen ? Minimize2 : Maximize2, onClick: () => setFullscreen((f) => !f) },
    ] },
    { id: 'settings', label: s.menuSettings, items: [
      { label: s.fontBigger, icon: Type, disabled: prefs.fontSize >= MAX_FONT_SIZE, onClick: () => updatePrefs({ fontSize: prefs.fontSize + 1 }) },
      { label: s.fontSmaller, icon: Type, disabled: prefs.fontSize <= MIN_FONT_SIZE, onClick: () => updatePrefs({ fontSize: prefs.fontSize - 1 }) },
      DIVIDER,
      ...TAB_SIZES.map((n): MenuEntry => ({
        label: s.tabSizeOption.replace('{n}', String(n)),
        icon: prefs.tabSize === n ? Check : AlignLeft,
        onClick: () => updatePrefs({ tabSize: n }),
      })),
    ] },
  ];
  const openTopMenu = (menu: MenuDescriptor | null, x: number, y: number) => {
    if (!menu) { setOpenMenu(null); setMenu(null); return; }
    setOpenMenu(menu.id);
    setMenu({ x, y, items: menu.items });
  };

  const dialogTitle = dialog?.kind === 'newFile' ? s.dlgNewFile
    : dialog?.kind === 'newFolder' ? s.dlgNewFolder
    : dialog?.kind === 'rename' ? s.dlgRename
    : dialog?.kind === 'duplicate' ? s.dlgDuplicate : '';
  const dialogInitial = dialog?.kind === 'rename' ? baseName(dialog.target)
    : dialog?.kind === 'duplicate' ? baseName(copyName(dialog.target)) : '';

  // The view mode and Save stay with File / View / Settings in the editor-owned wrapping toolbar.
  // The takeover header has one job: identify the workbench and provide its single exit.
  const viewControls = editable ? (
    <>
      <ViewSwitch
        label={s.viewMode}
        value={effTab}
        onChange={setTab}
        options={[
          { id: 'edit' as Tab, label: s.tabEdit, icon: Code2 },
          ...(previewableText ? [{ id: 'preview' as Tab, label: s.tabPreview, icon: Eye }] : []),
          // Nothing to diff against under a system root — there is no HEAD behind `/`.
          ...(systemRoot ? [] : [{ id: 'diff' as Tab, label: s.tabDiff, icon: GitCompare }]),
        ]}
      />
      <Button variant="accent" icon={Save} disabled={!dirty || saving} onClick={save}>{t.common.save}</Button>
    </>
  ) : null;

  const surface = (
    <>
      {/* Toolbar. Both the row and its trailing controls wrap: at phone width File / View / Settings,
          the view switch and Save remain reachable without widening the takeover page. */}
      <div role="toolbar" aria-label={s.editorTitle} className="flex max-w-full flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {/* On mobile (fullscreen + tree hidden) a toggle surfaces the file tree as an overlay. */}
        {mobile && fullscreen && (
          <button
            type="button"
            onClick={() => setShowTree((cur) => !cur)}
            aria-pressed={showTree}
            aria-label={s.toggleTree}
            title={s.toggleTree}
            className={`overlay-touch-target flex h-7 w-7 items-center justify-center rounded-md transition-colors ${showTree ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
          >
            <PanelLeft size={15} />
          </button>
        )}
        {/* In fullscreen the takeover's header already names the surface, so the icon and the static
            "Code editor" label would be the same title twice. */}
        {!fullscreen && (
          <>
            <Code2 size={15} className="shrink-0 text-primary" aria-hidden />
            <span className="text-sm font-semibold text-foreground">{s.editorTitle}</span>
          </>
        )}
        {working ? <span className="truncate font-mono text-xs text-warning"><GitCompare size={11} className="mr-1 inline" aria-hidden />{s.workingChanges}</span>
          : commit ? <button type="button" onClick={() => setSelected(null)} disabled={!selected} title={selected ? s.viewCommit : undefined} className="overlay-menu-item flex min-w-0 items-center truncate font-mono text-xs text-primary transition-colors enabled:hover:text-primary-hot disabled:cursor-default"><GitCompare size={11} className="mr-1 inline shrink-0" aria-hidden /><span className="truncate">{s.commitLabel} {commit.slice(0, 8)}{selected ? ` · ${selected}` : ''}</span></button>
          : null}
        {/* The menu bar owns the file actions, so they stop competing with the view mode and Save for
            the same strip of toolbar. Hidden in the read-only commit and working-diff views, where
            every one of its entries would be inapplicable. It used to be hidden on a phone as well,
            which left new/rename/delete with no reachable trigger there at all — a touch device has no
            right-click either; the takeover header now carries the title and the exit, so the row has
            the space for it. */}
        {!commit && !working ? <MenuBar menus={menus} openId={openMenu} onOpen={openTopMenu} /> : null}
        {uploading ? <span className="text-xs text-muted-foreground">{s.uploading}</span> : null}
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
          {/* A path relative to a root the user cannot see is a path relative to nothing, so the header
              carries the absolute one. It is also the only place the root itself is named once a file is
              open, and for a managed project it is the guest directory the daemon resolved — reported by
              the host projection, never re-derived here.

              It reads as a status at the trailing edge rather than sitting between the title and the
              menus, where a path that grows with every file opened kept pushing the menus along. The
              flexible gap belongs to this group, so the path is right-aligned and shrinks before
              anything else does: `min-w-0` with hidden overflow lets it ellipsis down to nothing, which
              is also what keeps it from wrapping the row. On a phone it is not drawn at all — the menus
              and the actions are what a narrow row has space for. */}
          {absoluteHint && !mobile ? (
            <span className="min-w-0 shrink truncate text-right font-mono text-xs text-muted-foreground" title={absoluteHint}>
              <HardDrive size={11} className="mr-1 inline shrink-0 text-primary" aria-hidden />
              {absoluteHint}
            </span>
          ) : null}
          {viewControls}
          {!fullscreen && onClose ? <button type="button" aria-label={t.common.close} onClick={closeEditor} className="overlay-touch-target flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"><X size={15} /></button> : null}
        </div>
      </div>

      {/* `relative` scopes the mobile tree overlay (absolute) to this row — without it the overlay
          resolves against the fixed fullscreen container and rides up over the toolbar. */}
      <div className="relative flex min-h-0 flex-1">
        {/* File tree. On desktop it's a fixed 256px sidebar. On mobile fullscreen it's a togglable
            overlay (default hidden) so it never eats the narrow viewport. */}
        {(mobile && fullscreen && !showTree) ? null : (
          <div
            // Dropping is scoped to the tree rather than the whole editor on purpose: Monaco handles
            // drops itself (dragged text lands in the buffer), and a page-wide catcher would quietly
            // take that over.
            onDragOver={(e) => { if (commit || working) return; e.preventDefault(); setDropping(true); }}
            onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; setDropping(false); }}
            onDrop={(e) => {
              if (commit || working) return;
              e.preventDefault();
              setDropping(false);
              runUpload(Array.from(e.dataTransfer.files ?? []), uploadDir);
            }}
            // The desktop width is proportional with bounds rather than a flat 16rem. The app used to
            // be drawn on a 1900px canvas and scaled down to fit the window, so that 16rem reached the
            // user as ~11.5rem on a 1024px screen; rendering natively it took a quarter of the width
            // away from the editor. The clamp lands on the old apparent size at 1024px and grows back
            // to the full 16rem on the wide screen it was drawn for.
            className={`relative flex shrink-0 flex-col border-r border-border ${(mobile && fullscreen) ? 'absolute inset-y-0 left-0 z-10 w-[80%] max-w-72 bg-card shadow-[var(--shadow-raised)]' : 'w-[clamp(11rem,18vw,16rem)] bg-background'} ${dropping ? 'ring-2 ring-inset ring-primary' : ''}`}
          >
            {dropping ? (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-primary/10 px-3 text-center text-xs font-medium text-primary">
                {s.dropHere.replace('{dir}', uploadDir || '/')}
              </div>
            ) : null}
            <div className="editor-file-tree-scroll min-h-0 flex-1 overflow-auto p-1.5">
              {/* A listing that FAILED is not an empty folder, and rendering it as one is how a project
                  full of files reads as a project with none — the exact appearance of the bug this root
                  work exists to end. The refusal is shown with the daemon's own wording, which already
                  names what went wrong (a listing too large to render, an environment that is not
                  running, access that was revoked), and the retry is offered beside it. */}
              {files.isError ? (
                <div role="alert" aria-label={s.treeFailed} className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
                  <AlertTriangle size={18} className="text-warning" aria-hidden />
                  <p className="text-xs font-medium text-foreground">{s.treeFailed}</p>
                  <p className="break-words text-xs text-muted-foreground">{utils.apiErrorMessage(files.error)}</p>
                  <button
                    type="button"
                    onClick={() => files.refetch()}
                    className="overlay-menu-item rounded-md border border-border bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {s.treeRetry}
                  </button>
                </div>
              ) : files.isLoading ? <LoadingState />
                : <FileTree tree={tree} expanded={expanded} onToggle={toggle} selected={selected} onSelect={(p) => { selectInTree(p); if (mobile && fullscreen) setShowTree(false); }} changed={changedSet} onContextMenu={onContextMenu} emptyLabel={s.noFiles} treeLabel={s.editorTitle} />}
            </div>
            {/* Only the way IN. A takeover has exactly one exit — its own back control — and a second
                button carrying the same label from inside it made "Exit fullscreen" ambiguous. */}
            {!fullscreen ? (
              <div className="shrink-0 border-t border-border p-1.5">
                <button
                  type="button"
                  onClick={() => setFullscreen(true)}
                  title={s.fullscreen}
                  className="overlay-menu-item flex w-full items-center justify-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:border-border-strong hover:bg-accent hover:text-accent-foreground"
                >
                  <Maximize2 size={13} aria-hidden />
                  {s.fullscreen}
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* editor / diff / preview / commit / working changes */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!commit && !working ? <Tabs tabs={openTabs} active={selected} dirty={dirtyPaths} onSelect={setSelected} onClose={closeTab} closeLabel={t.common.close} /> : null}
          <div className="min-h-0 flex-1">
            {working ? <PatchView diff={changesData.data?.diff ?? ''} loading={changesData.isLoading} empty={s.noChanges} />
              : commit && selected ? <PatchView diff={commitFileDiff.data?.diff ?? ''} loading={commitFileDiff.isLoading} empty={s.noChanges} />
              : commit ? <PatchView diff={commitData.data?.diff ?? ''} loading={commitData.isLoading} empty={s.noChanges} />
              : !selected ? <EmptyState title={s.selectFile} icon={FileIcon} />
              : fileKind === 'image' && fileSize <= MAX_BUFFERED_BYTES ? <ImagePreview projectId={projectId} root={root} path={selected} />
              : fileKind === 'pdf' && fileSize <= MAX_BUFFERED_BYTES ? <PdfPreview projectId={projectId} root={root} path={selected} failedLabel={s.previewFailed} />
              : fileKind === 'office' && fileSize <= MAX_OFFICE_BYTES ? <PdfPreview projectId={projectId} root={root} path={selected} failedLabel={s.previewFailed} office />
              : (fileKind === 'video' || fileKind === 'audio') && fileSize <= MAX_MEDIA_PREVIEW_BYTES ? <MediaPreview projectId={projectId} root={root} path={selected} kind={fileKind} />
              : fileKind === 'binary' || fileKind === 'image' || fileKind === 'pdf' || fileKind === 'office' || fileKind === 'video' || fileKind === 'audio'
                ? <BinaryPreview projectId={projectId} root={root} path={selected} size={fileSize} message={fileKind === 'binary' ? s.binaryFile : s.previewTooLarge} downloadLabel={s.download} sizeLabel={s.fileSize} typeLabel={s.fileType} downloadAvailable={fileSize <= MAX_BUFFERED_BYTES} downloadUnavailableLabel={s.downloadUnavailable} />
              : fileData.isLoading ? <LoadingState />
              : fileData.data?.truncated ? <p className="p-4 text-center text-sm text-muted-foreground">{s.fileTooBig}</p>
              : effTab === 'diff' ? (headData.isLoading ? <LoadingState /> : <DiffEditorPane path={selected} original={headData.data?.content ?? ''} modified={value} prefs={prefs} />)
              : effTab === 'preview' && fileKind === 'csv' ? <CsvPreview source={value} invalidLabel={s.csvInvalid} limitedLabel={s.csvLimited} />
              : effTab === 'preview' ? <MarkdownPreview source={value} />
              : <EditorPane path={selected} value={value} onChange={onChange} onSave={save} prefs={prefs} onCursor={setCursor} />}
          </div>
          {/* Only under the editor itself: on a preview or a commit diff every reading it offers would
              describe a file the pane above is not letting you edit. */}
          {selected && textFile && !commit && !working && effTab === 'edit' ? (
            <StatusBar
              path={selected}
              cursor={cursor}
              language={langOf(selected)}
              tabSize={prefs.tabSize}
              size={fileSize}
              dirty={dirty}
              labels={{ line: s.statusLine, column: s.statusColumn, selected: s.statusSelected, spaces: s.statusSpaces, unsaved: s.statusUnsaved }}
            />
          ) : null}
        </div>
      </div>

      {/* Full-width bottom drag edge: grab anywhere along it to resize the embedded editor. The centered
          pill hints at the affordance (same visual language as the sidebar handle). */}
      {!fullscreen && !fill ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={s.resizeEditor}
          title={s.resizeEditor}
          onPointerDown={(e) => { e.preventDefault(); dragY.current = e.clientY; e.currentTarget.setPointerCapture?.(e.pointerId); }}
          onPointerMove={(e) => { if (dragY.current === null) return; const dy = e.clientY - dragY.current; dragY.current = e.clientY; setEditorH((h) => clampEditorH(h + dy)); }}
          onPointerUp={(e) => { if (dragY.current === null) return; dragY.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId); }}
          onLostPointerCapture={() => { dragY.current = null; }}
          className="group flex h-3.5 shrink-0 cursor-row-resize items-center justify-center border-t border-border bg-muted transition-colors hover:bg-accent"
        >
          <span className="h-1 w-10 rounded-full bg-border transition-all duration-200 group-hover:w-16 group-hover:bg-muted-foreground" />
        </div>
      ) : null}

      {/* The file picker for the Upload menu entry. Reset to '' after every pick so choosing the SAME
          file twice in a row still fires a change event. */}
      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => { runUpload(Array.from(e.target.files ?? []), uploadDir); e.target.value = ''; }}
      />

      {menu ? <ContextMenu state={menu} onClose={() => { setMenu(null); setOpenMenu(null); }} /> : null}
      {dialog && dialog.kind === 'delete'
        ? <ConfirmDialog title={s.dlgDelete} message={s.dlgDeleteMsg.replace('{name}', baseName(dialog.target))} confirmLabel={s.ctxDelete} danger icon={Trash2} onConfirm={confirmDelete} onCancel={() => setDialog(null)} />
        : dialog
        ? <PromptDialog title={dialogTitle} label={s.dlgName} initialValue={dialogInitial} confirmLabel={t.common.save} onConfirm={submitDialog} onCancel={() => setDialog(null)} />
        : null}
    </>
  );

  // Fullscreen is a takeover, not a hand-rolled `fixed inset-0 z-50 h-screen` overlay: that measured
  // `vh`, so on a phone with a visible browser toolbar the file toolbar along the bottom fell outside
  // the viewport; it sat at a literal z-index of fifty, tying with the navigation drawer, the advisor
  // launcher and the toasts; and its only exit was an unlabelled 28px chevron. The primitive owns the
  // dvh sizing, the safe-area padding, the modal layer, the focus trap, Escape and a labelled back
  // control that meets the touch floor.
  if (fullscreen) {
    return (
      <WorkspaceTakeover
        title={s.editorTitle}
        onBack={leaveFullscreen}
        backLabel={mobile && onClose ? t.common.back : s.exitFullscreen}
      >
        <section aria-label={s.editorTitle} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
          {surface}
        </section>
      </WorkspaceTakeover>
    );
  }
  return (
    <section aria-label={s.editorTitle} className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card" style={{ height: fill ? '100%' : editorH }}>
      {surface}
    </section>
  );
}
