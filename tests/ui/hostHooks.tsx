/** The hook set the host installs on `window.ElowenUiRuntime.hooks`.
 *
 *  Ported from web/lib/queries.ts + web/lib/mutations.ts, on the REAL @tanstack/react-query — the panel's
 *  behaviour under test is react-query behaviour (the optimistic disclosure toggle, its rollback on
 *  error, the refetch on settle), so a hand-rolled stand-in would be testing the stand-in.
 */
import { useCallback, useEffect, useMemo, useRef, useState, createContext, useContext, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  elowenClient,
  type CronJobRow, type DepEdge, type Mission, type PluginSkillRow, type SkillOwner, type Task,
} from './hostClient';
import { apiErrorMessage } from './hostClient';
import { agentDisplayName, pendingEscalations, taskExec, taskSessionName } from './hostUtils';
import { en } from './hostDictionary';
export { useAutoSaveStatus } from './useAutoSaveStatus';
export { useQueries };

// ── i18n ─────────────────────────────────────────────────────────────────────────────────────────────
// The app's own catalog (hostDictionary), served as the host serves it. These are CORE labels — the
// copy a bundle reads through `useTranslation` — as opposed to a plugin's own manifest `web.strings`.

export const DICTIONARY = en;

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

// ── work + agents data plane ─────────────────────────────────────────────────────────────────────────
// Ported from the host's web/lib/queries.ts + mutations.ts — cache keys, `enabled` gates and
// invalidation targets included. The moved suites seed and read those exact keys (`['tasks']`,
// `['task-activity', id]`, `['activity', 'review', null]`), and the plugin-presence gating is itself
// under test: a board rendered without the agents plugin must hide its mission row rather than fire
// requests at routes nobody serves.

const QUERY_KEYS = {
  tasks: ['tasks'] as const,
  sessions: ['sessions'] as const,
  missions: ['missions'] as const,
  config: ['config'] as const,
  systemSkills: ['system-skills'] as const,
  usageByModel: ['usage-by-model'] as const,
  usageByDay: ['usage-by-day'] as const,
  usageByOrigin: ['usage-by-origin'] as const,
  sessionSignals: ['session-signals'] as const,
};

/** Whether a named plugin contributes a browser UI — read from the SAME /plugins/ui listing the nav
 *  uses. FALSE while the listing loads, so a plugin-less instance never flashes an affordance. */
const usePluginPresent = (name: string): boolean => {
  const { locale } = useTranslation();
  const listing = usePluginUi(locale);
  return (listing.data ?? []).some((p) => p.name === name);
};

/** Whether asking a domain's routes can possibly be answered. Deliberately NOT `usePluginPresent`: an
 *  affordance hides until confirmed, but a READ must not be suppressed on a state we do not know yet —
 *  that would blank every surface of the domain for the length of the listing round-trip. */
const useDomainReachable = (plugin: string): boolean => {
  const { locale } = useTranslation();
  const listing = usePluginUi(locale);
  return listing.data === undefined || listing.data.some((p) => p.name === plugin);
};

export const useAgentsPlugin = (): boolean => usePluginPresent('agents');
export const useEditorPlugin = (): boolean => usePluginPresent('editor');
export const useWorkPlugin = (): boolean => usePluginPresent('work');

// ---- reads ----

export const useSessionSignals = (): Record<string, DerivedSignalShape> => {
  const { data } = useQuery<Record<string, DerivedSignalShape>>({ queryKey: QUERY_KEYS.sessionSignals, queryFn: () => ({}), staleTime: Infinity, initialData: {} });
  return data;
};
export const useSessionSignal = (name: string): DerivedSignalShape | undefined => useSessionSignals()[name];
type DerivedSignalShape = { type: string; question?: string; options?: { id: string; label: string }[] };

/** A bare `useTasks()` keeps the shared `['tasks']` key; a scoped one gets its own entry so a
 *  project-filtered register does not replace the global cache. */
export const useTasks = (projectId?: number) => {
  const work = useDomainReachable('work');
  return useQuery({ queryKey: projectId == null ? QUERY_KEYS.tasks : ['tasks', projectId], queryFn: () => elowenClient.tasks(projectId), enabled: work });
};

export const useSessions = () => {
  const agents = useDomainReachable('agents');
  return useQuery({ queryKey: QUERY_KEYS.sessions, queryFn: elowenClient.sessions, select: (s) => s.map((x) => x.name), enabled: agents });
};

export const useSessionInfos = () => {
  const agents = useDomainReachable('agents');
  return useQuery({ queryKey: QUERY_KEYS.sessions, queryFn: elowenClient.sessions, enabled: agents });
};

export const useAllDeps = () => {
  const work = useDomainReachable('work');
  return useQuery({ queryKey: ['tasks', 'deps'], queryFn: elowenClient.allDeps, enabled: work });
};

export const useMissions = () => {
  const agents = useDomainReachable('agents');
  return useQuery({ queryKey: QUERY_KEYS.missions, queryFn: elowenClient.missions, enabled: agents });
};

export const useConfig = () => useQuery({ queryKey: QUERY_KEYS.config, queryFn: elowenClient.getConfig });

export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: elowenClient.projects });

export const useProjectGit = (id: number | null) =>
  useQuery({ queryKey: ['project-git', id], queryFn: () => elowenClient.projectGit(id as number), enabled: !!id });

export const useActivity = (type?: string, limit?: number) =>
  useQuery({
    queryKey: ['activity', type ?? 'all', limit ?? null],
    queryFn: () => elowenClient.activity({ ...(type ? { type } : {}), ...(limit ? { limit } : {}) }),
  });

export const useTaskConversation = (taskId: string | null) =>
  useQuery({ queryKey: ['task-activity', taskId], queryFn: () => elowenClient.activity({ target: taskId as string }), enabled: !!taskId });

export const useTaskBrainConversation = (taskId: string | null, enabled: boolean) =>
  useQuery({ queryKey: ['task-brain-conversation', taskId], queryFn: () => elowenClient.taskBrainConversation(taskId as string), enabled: !!taskId && enabled });

export const useTaskCommits = (taskId: string | null) =>
  useQuery({ queryKey: ['task-commits', taskId], queryFn: () => elowenClient.taskCommits(taskId as string), enabled: !!taskId });

export const useTaskCommitFileDiff = (taskId: string | null, hash: string | null, path: string | null) =>
  useQuery({ queryKey: ['task-commit-diff', taskId, hash, path], queryFn: () => elowenClient.taskCommitFileDiff(taskId as string, hash as string, path as string), enabled: !!taskId && !!hash && !!path });

export const useMissionNotes = (target: string | null) => {
  const agents = useDomainReachable('agents');
  return useQuery({ queryKey: ['mission-notes', target], queryFn: () => elowenClient.missionNotes(target as string), enabled: !!target && agents });
};

/** Token/cost usage for one task's agent run. Polls while the agent is live. */
export const useTaskUsage = (taskId: string, live = false) =>
  useQuery({
    queryKey: ['task-usage', taskId],
    queryFn: () => elowenClient.taskUsage(taskId),
    enabled: !!taskId,
    refetchInterval: live ? 5000 : false,
    staleTime: live ? 0 : 5 * 60 * 1000,
  });

/** Only FINITE window bounds join the key — an open ±Infinity bound collapses to null so every
 *  rolling preset shares one cache entry. */
export const useModelUsage = (projectId?: number, window?: { fromMs: number; toMs: number }) =>
  useQuery({
    queryKey: [...QUERY_KEYS.usageByModel, projectId ?? null,
      Number.isFinite(window?.fromMs) ? window!.fromMs : null,
      Number.isFinite(window?.toMs) ? window!.toMs : null],
    queryFn: () => elowenClient.usageByModel(projectId, window),
  });

export const useUsageByDay = (projectId?: number, days = 7) =>
  useQuery({ queryKey: [...QUERY_KEYS.usageByDay, projectId ?? null, days], queryFn: () => elowenClient.usageByDay(projectId, days) });

export const useUsageByOrigin = (
  group: 'user' | 'origin' | 'pair' = 'pair',
  window?: { fromMs: number; toMs: number },
  opts?: { enabled?: boolean; limit?: number },
) =>
  useQuery({
    queryKey: [...QUERY_KEYS.usageByOrigin, group,
      Number.isFinite(window?.fromMs) ? window!.fromMs : null,
      Number.isFinite(window?.toMs) ? window!.toMs : null,
      opts?.limit ?? 50],
    queryFn: () => elowenClient.usageByOrigin(group, window, opts?.limit ?? 50),
    enabled: opts?.enabled !== false,
  });

export const usePlanJob = (jobId: string | null) =>
  useQuery({
    queryKey: ['plan-job', jobId],
    queryFn: () => elowenClient.getPlanJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => ((q.state.data as { status?: string } | undefined)?.status === 'planning' ? 1000 : false),
  });

export const useSystemSkills = () => useQuery({ queryKey: QUERY_KEYS.systemSkills, queryFn: elowenClient.systemSkills });

export const usePluginDetail = (name: string | null) =>
  useQuery({ queryKey: ['plugin', name], queryFn: () => elowenClient.pluginDetail(name as string), enabled: !!name });

export const usePendingAsks = () => {
  const agents = useDomainReachable('agents');
  return useQuery({ queryKey: ['pending-asks'], queryFn: () => elowenClient.pendingAsks(), enabled: agents });
};

/** Overseer escalations, derived in the browser from activity + tasks + deps — the same derivation the
 *  bell and the dashboard read, so the count has one source. */
export const useEscalations = () => {
  const reviews = useActivity('review');
  const tasks = useTasks();
  const deps = useAllDeps();
  return useMemo(
    () => pendingEscalations(reviews.data ?? [], (tasks.data ?? []) as Task[], (deps.data ?? []) as DepEdge[]),
    [reviews.data, tasks.data, deps.data],
  );
};

/** Commit history across several projects, merged into one time-sorted stream tagged with projectId. */
export const useProjectsCommits = (projectIds: number[], hours: number, enabled = true) =>
  useQueries({
    queries: projectIds.map((id) => ({
      queryKey: ['project-commits', id],
      queryFn: () => elowenClient.projectCommits(id, 25),
      enabled,
      staleTime: 30000,
    })),
    combine: (results) => {
      const cutoff = Date.now() - hours * 3600_000;
      const commits = results
        .flatMap((r, i) => (r.data?.commits ?? []).map((c) => ({ ...c, projectId: projectIds[i] })))
        .filter((c) => c.timestamp >= cutoff)
        .sort((a, b) => b.timestamp - a.timestamp);
      return { commits, isLoading: results.some((r) => r.isLoading) };
    },
  });

/** Poll a session's tmux pane for the live preview. An empty name disables the query. */
export function useSessionPane(name: string, lines = 8, enabled = true) {
  const q = useQuery({
    queryKey: ['session-pane', name, 'ansi'],
    queryFn: () => elowenClient.sessionPane(name, true),
    enabled: enabled && !!name,
    refetchInterval: 2000,
    refetchOnWindowFocus: false,
  });
  const pane = q.data?.pane ?? '';
  const tail = pane.split('\n').slice(-lines).join('\n');
  return { tail, isLoading: q.isLoading, isError: q.isError };
}

// ---- writes ----

const invalidator = (keys: readonly unknown[][]) => (qc: ReturnType<typeof useQueryClient>) => {
  for (const queryKey of keys) qc.invalidateQueries({ queryKey });
};
const invalidateTasks = invalidator([QUERY_KEYS.tasks]);
const invalidateMissions = invalidator([QUERY_KEYS.missions]);

export function useSpawn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { taskId: string; exec?: string }) => elowenClient.spawn(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: QUERY_KEYS.tasks }); qc.invalidateQueries({ queryKey: QUERY_KEYS.sessions }); },
  });
}
export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: Record<string, unknown>) => elowenClient.createTask(input), onSuccess: () => invalidateTasks(qc) });
}
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; patch: Record<string, unknown> }) => elowenClient.updateTask(v.id, v.patch), onSettled: () => invalidateTasks(qc) });
}
export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => elowenClient.deleteTask(id), onSuccess: () => invalidateTasks(qc) });
}
export function useCloseTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => elowenClient.closeTask(id), onSuccess: () => invalidateTasks(qc) });
}
export function useSetTaskStatus() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; status: string }) => elowenClient.setTaskStatus(v.id, v.status), onSettled: () => invalidateTasks(qc) });
}
export function useSetTaskExec() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; exec: string }) => elowenClient.setTaskExec(v.id, v.exec), onSuccess: () => invalidateTasks(qc) });
}
export function useApproveGate() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => elowenClient.approveGate(id), onSuccess: () => invalidateTasks(qc) });
}
export function useReplyAsk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { taskId: string; askId: string; text: string }) => elowenClient.replyAsk(v.taskId, v.askId, v.text),
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ['pending-asks'] }); qc.invalidateQueries({ queryKey: ['task-activity', v.taskId] }); },
  });
}
export function usePlanTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: Record<string, unknown>) => elowenClient.planTask(input), onSuccess: () => { invalidateTasks(qc); invalidateMissions(qc); } });
}
export function useInsertPhases() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { epicId: string; body: Record<string, unknown> }) => elowenClient.insertPhases(v.epicId, v.body), onSuccess: () => { invalidateTasks(qc); invalidateMissions(qc); } });
}
export function useDeleteMission() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (epicId: string) => elowenClient.deleteMission(epicId), onSuccess: () => { invalidateTasks(qc); invalidateMissions(qc); } });
}
export function useEngage() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: Record<string, unknown>) => elowenClient.engage(input), onSuccess: () => invalidateMissions(qc) });
}
export function usePauseMission() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => elowenClient.pauseMission(id), onSuccess: () => invalidateMissions(qc) });
}
export function useResumeMission() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => elowenClient.resumeMission(id), onSuccess: () => invalidateMissions(qc) });
}
export function useDisengage() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => elowenClient.disengageMission(id), onSuccess: () => invalidateMissions(qc) });
}
export function useOpenMissionPr() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => elowenClient.openMissionPr(id), onSuccess: () => invalidateMissions(qc) });
}
export function useMergeMissionPr() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => elowenClient.mergeMissionPr(id), onSuccess: () => invalidateMissions(qc) });
}
export function useKillSession() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => elowenClient.killSession(name), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.sessions }) });
}
export function useSendInput() {
  return useMutation({ mutationFn: (v: { name: string; keys: string[] }) => elowenClient.sendKeys(v.name, v.keys) });
}
export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (patch: Record<string, unknown>) => elowenClient.updateConfig(patch), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.config }) });
}
export function useInstallSkills() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => elowenClient.installSkills(), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.systemSkills }) });
}
export function useResetUsage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => elowenClient.resetUsage(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.usageByModel });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.usageByDay });
      qc.invalidateQueries({ queryKey: ['task-usage'] });
    },
  });
}
/** PATCH /plugins/:name/config through the host's mutation, so a save invalidates the cached detail
 *  instead of leaving the section reading a copy from before the write. */
export function useSavePluginConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; values: Record<string, unknown> }) => elowenClient.savePluginConfig(v.name, v.values),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: ['plugin', v.name] }); },
  });
}

// ── layout / selection behaviour ─────────────────────────────────────────────────────────────────────

/** A `useState` mirrored into localStorage and rehydrated on mount, validated on read against a fixed
 *  list OR a predicate — so a stale or foreign key can never poison state. */
export function usePersistentState<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[] | ((value: string) => boolean),
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return;
      const ok = typeof allowed === 'function' ? allowed(raw) : (allowed as readonly string[]).includes(raw);
      if (ok) setValue(raw as T);
    } catch { /* private mode — keep the fallback */ }
    // `allowed` is a stable literal/predicate per call site; only the key identifies the slot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback((next: T) => {
    setValue(next);
    try { localStorage.setItem(key, next); } catch { /* quota — ignore */ }
  }, [key]);

  return [value, set];
}

const PROJECT_KEY_OK = (v: string) => v === 'all' || /^\d+$/.test(v);

/** The persisted project filter the built-in workspaces share. Restores the stored project by a static
 *  key check (the async list would reject it on first render), then clamps to 'all' once the list is
 *  known and the project turns out to be gone — a deleted project must not leave an invisible filter. */
export function useProjectFilter(storageKey: string): { selectedProject: number | 'all'; setProject: (value: number | 'all') => void } {
  const projects = useProjects();
  const [projectKey, setProjectKey] = usePersistentState<string>(storageKey, 'all', PROJECT_KEY_OK);
  const asNum: number | 'all' = projectKey === 'all' ? 'all' : Number(projectKey);
  const selectedProject: number | 'all' =
    asNum === 'all' ? 'all'
    : projects.data && !projects.data.some((p) => p.id === asNum) ? 'all'
    : asNum;
  return {
    selectedProject,
    setProject: (value) => setProjectKey(value === 'all' ? 'all' : String(value)),
  };
}

/** The height that makes an element reach the bottom of the window. jsdom reports zero geometry, so
 *  this settles on the floor — enough for the layout to mount, which is all a panel test needs. */
export function useFillHeight(ref: { current: HTMLElement | null }, minPx = 320): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      setHeight(Math.max(minPx, Math.round(window.innerHeight - top)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref, minPx]);
  return height;
}

export type StallState = 'fresh' | 'stalled' | 'stuck';
const STALLED_SEC = 5 * 60;
const STUCK_SEC = 15 * 60;

/** Silence-based staleness of a live agent session, for the status dot. A dead session reads 'fresh'. */
export function useSessionStall(name: string, live: boolean): { state: StallState; silenceSec: number } {
  const { tail } = useSessionPane(name, 8, live);
  const [now, setNow] = useState(() => Date.now());
  const lastChangeRef = useRef<number>(Date.now());

  useEffect(() => { lastChangeRef.current = Date.now(); }, [tail]);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  if (!live) return { state: 'fresh', silenceSec: 0 };
  const silenceSec = Math.max(0, Math.floor((now - lastChangeRef.current) / 1000));
  const state: StallState = silenceSec >= STUCK_SEC ? 'stuck' : silenceSec >= STALLED_SEC ? 'stalled' : 'fresh';
  return { state, silenceSec };
}

/** Shared start/stop/pause controls for one task, so the card and the detail pane behave identically.
 *  Owns its mutations, toasts and live-state lookup. */
export function useTaskControls(task: Task): { session: string | null; running: boolean; start: () => void; stop: () => void; pause: () => void } {
  const spawn = useSpawn();
  const kill = useKillSession();
  const setStatus = useSetTaskStatus();
  const send = useSendInput();
  const sessions = useSessions();
  const { toast } = useToast();
  const { t } = useTranslation();

  const exec = taskExec(task.labels);
  const session = taskSessionName(task);
  const running = task.status === 'in_progress' && !!session && (sessions.data ?? []).includes(session);

  const start = () => spawn.mutate({ taskId: task.id, exec: exec || undefined }, {
    onSuccess: (r) => toast(t.tasks!.launched!.replace('{session}', agentDisplayName(r.session))),
    onError: (e) => toast(apiErrorMessage(e), 'error'),
  });
  const stop = () => {
    if (session) kill.mutate(session);
    setStatus.mutate({ id: task.id, status: 'open' }, {
      onSuccess: () => toast(t.tasks!.stopped!.replace('{id}', task.id)),
      onError: (e) => toast(apiErrorMessage(e), 'error'),
    });
  };
  const pause = () => {
    if (session) send.mutate({ name: session, keys: ['C-c'] }, {
      onSuccess: () => toast(t.sessions!.interrupted!.replace('{name}', agentDisplayName(session))),
      onError: (e) => toast(apiErrorMessage(e), 'error'),
    });
  };

  return { session, running, start, stop, pause };
}

export type { Mission };
