/** The hook set the host installs on `window.ElowenUiRuntime.hooks`.
 *
 *  Ported from web/lib/queries.ts + web/lib/mutations.ts, on the REAL @tanstack/react-query — the panel's
 *  behaviour under test is react-query behaviour (the optimistic disclosure toggle, its rollback on
 *  error, the refetch on settle), so a hand-rolled stand-in would be testing the stand-in.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { elowenClient, type CronJobRow, type PluginSkillRow, type SkillOwner } from './hostClient';
export { useAutoSaveStatus } from './useAutoSaveStatus';

// ── i18n ─────────────────────────────────────────────────────────────────────────────────────────────
// The app's own English dictionary, narrowed to the keys the shared register and the plugin panel read.
// These are CORE labels, not plugin ones — the "All" option of the scope filter is the clearest case:
// the register owns that option, which is why the plugin ships no string for it.

export const DICTIONARY = {
  common: {
    daemonUnreachable: 'elowen daemon unreachable',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    retry: 'Retry',
    close: 'Close',
    back: 'Back',
    loading: 'Loading…',
    saving: 'Saving…',
    saved: 'Saved',
    saveFailed: 'Couldn\'t save',
  },
  // The managed-selection vocabulary (SelectionSummary + ManageSelectionModal). These are CORE labels
  // too: the picker owns its search box, its "All" chip and its Save button, which is why the cronjob
  // plugin ships none of them.
  managePicker: {
    manage: 'Manage',
    searchPlaceholder: 'Search…',
    all: 'All',
    selectedCount: '{n} selected',
    saveChanges: 'Save changes',
    noResults: 'No results',
    filterByGroup: 'Filter by group',
    groupChannels: 'Channels',
    groupThreads: 'Threads',
  },
  // The editor panel's copy. CORE labels again: the editor plugin ships no string for any of them,
  // because the code editor was part of the app before it became a plugin and its vocabulary stayed in
  // the app dictionary — so the panel keeps reading `t.projects.*` off the host.
  projects: {
    editorTitle: 'Code editor',
    tabEdit: 'Edit',
    tabDiff: 'Diff',
    tabPreview: 'Preview',
    noFiles: 'No files',
    selectFile: 'Select a file to edit',
    fileTooBig: 'File is too large or binary to edit here.',
    noChanges: 'No uncommitted changes in this file.',
    fileSaved: 'Saved {path}',
    commitLabel: 'Commit',
    viewCommit: 'View this commit\'s changes',
    workingChanges: 'Uncommitted changes',
    wordWrap: 'Word wrap',
    resizeEditor: 'Drag to resize the editor',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen',
    toggleTree: 'Files',
    ctxOpen: 'Open',
    ctxNewFile: 'New file',
    ctxNewFolder: 'New folder',
    ctxRename: 'Rename',
    ctxDuplicate: 'Duplicate',
    ctxDelete: 'Delete',
    ctxCopyPath: 'Copy path',
    dlgNewFile: 'New file',
    dlgNewFolder: 'New folder',
    dlgRename: 'Rename',
    dlgDuplicate: 'Duplicate',
    dlgName: 'Name',
    dlgDelete: 'Delete item?',
    dlgDeleteMsg: 'Really delete “{name}”? This cannot be undone.',
    fileCreated: 'Created {path}',
    folderCreated: 'Folder created {path}',
    renamed: 'Renamed to {path}',
    duplicated: 'Copied to {path}',
    deleted: 'Deleted {path}',
    pathCopied: 'Path copied',
    copyFailed: 'Copy failed',
  },
  assetEditor: {
    search: 'Search…',
    emptySearch: 'Nothing matches the filter',
    filterAll: 'All',
    filterUser: 'Custom',
    filterBuiltin: 'Built-in',
    colName: 'Name',
    colDescription: 'Description',
    pageRange: '{from}–{to} of {total}',
    pageLabel: 'Page {page} of {pages}',
    prevPage: 'Back',
    nextPage: 'Next',
  },
} as const;

export const useTranslation = () => ({ t: DICTIONARY as unknown as Record<string, Record<string, string>>, locale: 'en' });

// ── toasts ───────────────────────────────────────────────────────────────────────────────────────────

export interface ToastRecord { message: string; tone: 'ok' | 'error' }
const ToastContext = createContext<{ toast: (message: string, tone?: 'ok' | 'error') => void; toasts: ToastRecord[] }>({ toast: () => {}, toasts: [] });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const value = useMemo(() => ({
    toasts,
    toast: (message: string, tone: 'ok' | 'error' = 'ok') => setToasts((cur) => [...cur, { message, tone }]),
  }), [toasts]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* The app renders every toast as a card carrying its message (web/components/ui/Toast.tsx), so a
          panel's "did the user get told" is assertable on screen. Kept as a plain live region — the
          card's countdown and auto-dismiss are the app's chrome, not a plugin contract. */}
      <div role="status" aria-live="polite">
        {toasts.map((toast, i) => <p key={i} data-tone={toast.tone}>{toast.message}</p>)}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ── data plane ───────────────────────────────────────────────────────────────────────────────────────

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: elowenClient.me, staleTime: 5 * 60 * 1000 });

export const usePluginUi = (locale: string) =>
  useQuery({ queryKey: ['plugin-ui', locale], queryFn: () => elowenClient.pluginUi(locale), staleTime: 60_000 });

/** Localized view strings for one plugin's bundle: the /plugins/ui listing's merged `strings` record.
 *
 *  TOTAL by construction — an unknown key reads as the empty string rather than `undefined`. The record
 *  is empty for the paint or two before the listing resolves, and a view that formats its copy would not
 *  render a blank label there, it would throw and take the whole page down. */
export function usePluginStrings(plugin: string): Record<string, string> {
  const { locale } = useTranslation();
  const listing = usePluginUi(locale);
  const strings = listing.data?.find((p) => p.name === plugin)?.strings;
  return useMemo(() => new Proxy(strings ?? {}, {
    get: (target, key) => (typeof key === 'string' ? target[key] ?? '' : undefined),
  }), [strings]);
}

export const usePluginSkills = () => useQuery({ queryKey: ['plugin-skills'], queryFn: elowenClient.pluginSkills });

export function useCreatePluginSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skill: { name: string; description: string; content: string; disableModelInvocation?: boolean; owner?: SkillOwner }) => elowenClient.createPluginSkill(skill),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugin-skills'] }),
  });
}

/** Edit a user skill in place — description/content and the disable-model-invocation flag. Optimistic:
 *  the row flips instantly (the daemon's plugin hot-reload can take a while, and the old
 *  wait-for-refetch behaviour left the toggle greyed out until a manual reload). On error the change
 *  rolls back; on settle the list re-fetches the real backend state. */
export function useUpdatePluginSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; owner?: SkillOwner; patch: { description?: string; content?: string; disableModelInvocation?: boolean } }) =>
      elowenClient.updatePluginSkill(v.name, v.patch, v.owner),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['plugin-skills'] });
      const prev = qc.getQueryData<PluginSkillRow[]>(['plugin-skills']);
      // Match on name AND owner: the same name can legitimately exist for two accounts, and an
      // optimistic patch keyed on the name alone would flip a row belonging to someone else.
      const targetOwner = v.owner === 'instance' || v.owner == null ? null : v.owner;
      qc.setQueryData<PluginSkillRow[]>(['plugin-skills'], (cur) => cur?.map((s) => (s.name === v.name && (s.owner ?? null) === targetOwner ? { ...s, ...v.patch } : s)));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['plugin-skills'], ctx.prev); },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['plugin-skills'] }); },
  });
}

export function useDeletePluginSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; owner?: SkillOwner }) => elowenClient.deletePluginSkill(v.name, v.owner),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugin-skills'] }),
  });
}

/** The provider tree a plugin panel is mounted inside — one QueryClient per test, so no cache leaks
 *  between them, and no retries (a deliberate 500 must surface as an error, not as three more requests). */
export function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  };
}

// ── cronjob panel ────────────────────────────────────────────────────────────────────────────────────
// Ported from the host's web/lib/queries.ts + mutations.ts, cache keys included: the panel's refetch
// after a save is react-query invalidating 'cron-jobs', so the key has to be the real one.

/** The cronjob plugin's scheduled jobs (admin-only endpoint). */
export const useCronJobs = (enabled = true) =>
  useQuery({ queryKey: ['cron-jobs'], queryFn: elowenClient.cronJobs, enabled });

/** Text channels + active threads of the configured Discord guild (the cron destination picker). */
export const useDiscordChannels = () =>
  useQuery({ queryKey: ['discord-channels'], queryFn: elowenClient.discordChannels, staleTime: 60_000 });

/** Pickable brain models across all configured providers. */
export const useBrainModels = () =>
  useQuery({ queryKey: ['brain-models'], queryFn: elowenClient.brainModels });

export function useSaveCronJob() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (job: CronJobRow) => elowenClient.saveCronJob(job), onSuccess: () => qc.invalidateQueries({ queryKey: ['cron-jobs'] }) });
}

export function useDeleteCronJob() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => elowenClient.deleteCronJob(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['cron-jobs'] }) });
}

// ── editor panel ─────────────────────────────────────────────────────────────────────────────────────
// Ported from the host's web/lib/queries.ts + mutations.ts, cache keys and `enabled` flags included. The
// editor's save behaviour IS this cache plumbing — the pane retires its draft and falls back to the
// ['project-file', id, path] entry the write itself updates — so a stand-in that skipped the cache would
// leave the one thing worth testing untested.

export const useProjectFiles = (id: number | null) =>
  useQuery({ queryKey: ['project-files', id], queryFn: () => elowenClient.projectFiles(id as number), enabled: !!id });

export const useProjectFile = (id: number | null, path: string | null) =>
  useQuery({ queryKey: ['project-file', id, path], queryFn: () => elowenClient.projectFile(id as number, path as string), enabled: !!id && !!path });

export const useProjectFileAtHead = (id: number | null, path: string | null, enabled: boolean) =>
  useQuery({ queryKey: ['project-head', id, path], queryFn: () => elowenClient.projectFileAtHead(id as number, path as string), enabled: !!id && !!path && enabled });

export const useProjectCommit = (id: number | null, hash: string | null) =>
  useQuery({ queryKey: ['project-commit', id, hash], queryFn: () => elowenClient.projectCommit(id as number, hash as string), enabled: !!id && !!hash });

export const useProjectCommitFileDiff = (id: number | null, hash: string | null, path: string | null) =>
  useQuery({ queryKey: ['project-commit-file', id, hash, path], queryFn: () => elowenClient.projectCommitFileDiff(id as number, hash as string, path as string), enabled: !!id && !!hash && !!path });

export const useProjectChanged = (id: number | null, enabled = true) =>
  useQuery({ queryKey: ['project-changed', id], queryFn: () => elowenClient.projectChanged(id as number), enabled: !!id && enabled });

export const useProjectChanges = (id: number | null, enabled: boolean) =>
  useQuery({ queryKey: ['project-changes', id], queryFn: () => elowenClient.projectChanges(id as number), enabled: !!id && enabled });

/** Writes to one file are serialized: Cmd+S does not block, so two saves of the same path can overlap and
 *  the loser would decide the file's final content. allSettled, because a failed write must not block the
 *  next save of that file. */
const inFlightFileWrites = new Map<string, Promise<unknown>>();
function writeProjectFileSerialized(id: number, path: string, content: string): Promise<{ ok: boolean }> {
  const key = `${id}\u0000${path}`;
  const previous = inFlightFileWrites.get(key);
  const run = Promise.allSettled([previous]).then(() => elowenClient.writeProjectFile(id, path, content));
  inFlightFileWrites.set(key, run);
  return run.finally(() => { if (inFlightFileWrites.get(key) === run) inFlightFileWrites.delete(key); });
}

export function useWriteProjectFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; path: string; content: string }) => writeProjectFileSerialized(v.id, v.path, v.content),
    onSuccess: (_r, v) => {
      // Update the file cache with what we just wrote before invalidating — the editor clears its local
      // draft on save and falls back to this cache, so without the update it would briefly flash the
      // stale pre-save content until the refetch below resolves.
      qc.setQueryData<{ content: string; truncated: boolean }>(['project-file', v.id, v.path], { content: v.content, truncated: false });
      qc.invalidateQueries({ queryKey: ['project-file', v.id, v.path] });
      // 'project-changed' is where the editor gets its highlighted (dirty) paths — without this the tree
      // keeps claiming the just-saved path is unchanged until something else invalidates it.
      qc.invalidateQueries({ queryKey: ['project-changed', v.id] });
    },
  });
}

/** Invalidate everything a file-tree mutation (create/rename/copy/delete) can affect. */
function invalidateProjectTree(qc: ReturnType<typeof useQueryClient>, id: number) {
  qc.invalidateQueries({ queryKey: ['project-files', id] });
  qc.invalidateQueries({ queryKey: ['project-changed', id] });
}

export function useNewProjectFile() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: number; path: string }) => elowenClient.newProjectFile(v.id, v.path), onSuccess: (_r, v) => invalidateProjectTree(qc, v.id) });
}
export function useNewProjectDir() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: number; path: string }) => elowenClient.newProjectDir(v.id, v.path), onSuccess: (_r, v) => invalidateProjectTree(qc, v.id) });
}
export function useRenameProjectEntry() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: number; from: string; to: string }) => elowenClient.renameProjectEntry(v.id, v.from, v.to), onSuccess: (_r, v) => invalidateProjectTree(qc, v.id) });
}
export function useCopyProjectEntry() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: number; from: string; to: string }) => elowenClient.copyProjectEntry(v.id, v.from, v.to), onSuccess: (_r, v) => invalidateProjectTree(qc, v.id) });
}
export function useDeleteProjectEntry() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: number; path: string }) => elowenClient.deleteProjectEntry(v.id, v.path), onSuccess: (_r, v) => invalidateProjectTree(qc, v.id) });
}

/** The viewport against the app's mobile breakpoint (≤ 767px), with "not measured yet" reading as
 *  desktop — ported from web/lib/useMobile.ts. The editor auto-fullscreens on a phone, so a panel that
 *  read this wrong would mount the wrong layout. */
export function useMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return mobile;
}
