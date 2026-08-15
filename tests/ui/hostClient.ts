/** The app's one HTTP client, narrowed to the calls the skills panel makes.
 *
 *  Ported from web/lib/elowenClient.ts. The URLs matter: they are the contract the daemon's routes are
 *  tested against on the node side, and the shapes the test's fetch handlers match on. In particular
 *  `owner` travels as a QUERY param selecting the target set and is never part of the written body —
 *  and "mine" travels as the explicit `me`, never as an absent param (the daemon reads an absent one as
 *  the pre-ownership default, instance-wide for an admin, which is not what the UI means by "mine"). */

export const BASE = '/api';

export class ElowenApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'ElowenApiError';
  }
}

/** A presentable message for a caught error: prefer the server-provided error code over the raw
 *  `elowen <status> on <path>` diagnostic, so toasts show "forbidden" rather than the diagnostic. */
export function apiErrorMessage(e: unknown): string {
  if (e instanceof ElowenApiError) return e.code ?? e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, credentials: 'same-origin' });
  if (!res.ok) {
    let body: Record<string, unknown> | undefined;
    try { body = (await res.json()) as Record<string, unknown>; } catch { /* no JSON body */ }
    throw new ElowenApiError(`elowen ${res.status} on ${path}`, res.status, typeof body?.error === 'string' ? body.error : undefined);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export type SkillOwner = number | 'instance' | null;
const ownerQuery = (owner?: SkillOwner): string =>
  (owner === undefined ? '' : `?owner=${encodeURIComponent(owner === null ? 'me' : String(owner))}`);

export interface PluginSkillRow {
  name: string;
  description: string;
  source: 'bundled' | 'user';
  owner: number | null;
  canDelete: boolean;
  disableModelInvocation: boolean;
  version: number | null;
  content?: string;
}

/** Shapes the jobs panel reads. They live in the plugin's own web-src/runtime.ts too — this side only
 *  needs enough of them to type the client, so the fields are deliberately loose. */
export interface CronJobRow { id: string }
export interface DiscordChannelOption { id: string; name: string }
export interface BrainModelOption { id?: string; label?: string; provider?: string; providerLabel?: string; model?: string; source?: 'oauth' | 'api-key' | 'relay' }

export interface PluginUiListing { name: string; url: string; apiVersion: number; strings: Record<string, string> }

// ── work / agents domain shapes ──────────────────────────────────────────────────────────────────────
// Structural mirrors of the daemon's wire types, deliberately loose: the plugins' own web-src/types.ts
// is the typed contract their views compile against, and duplicating it here would be a second copy
// nothing keeps honest. What matters on this side is the URL each call goes to.

export interface Task {
  id: string; title: string; status: string; type?: string; parent_id?: string | null;
  labels?: string[]; project_id?: number; outcome?: string | null; result_summary?: string | null;
  created_at?: string; closed_at?: string | null; scheduled_at?: string | null; [k: string]: unknown;
}
export interface SessionInfo { name: string; role: string; agent: string; missionId?: string; projectId?: number }
export interface Mission { id: string; epic_id: string; state: string; [k: string]: unknown }
export interface ActivityEvent { id: number; ts: string; type: string; target: string; detail: string; label?: string; project_id?: number | null }
export interface Project { id: number; slug: string; path: string; notes: string; icon?: string; pr_enabled: boolean | null }
export interface TokenUsage { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; costUsd: number | null; outputTps?: number | null; measuredOutput?: number; reasoning?: number; costSource?: string }
export interface ModelUsage { exec: string; usage: TokenUsage }
export interface CommitLogEntry { hash: string; subject: string; relative: string; timestamp: number; [k: string]: unknown }
export interface PendingAsk { taskId: string; askId: string; question: string; title?: string; epicId?: string; since?: number }
export interface DepEdge { task_id: string; depends_on_id: string }

/** One entry of a project's flat file listing — the shape the editor panel builds its tree from. */
export interface FileNode { path: string; type: 'file' | 'dir' }

export const elowenClient = {
  me: () => req<{ user: { id: number; username: string; is_admin: boolean } }>('/auth/me'),
  pluginUi: (lang?: string) => req<PluginUiListing[]>(`/plugins/ui${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`),
  pluginSkills: () => req<PluginSkillRow[]>('/plugins/skills/list'),
  createPluginSkill: ({ owner, ...skill }: { name: string; description: string; content: string; disableModelInvocation?: boolean; owner?: SkillOwner }) =>
    req<{ ok: boolean }>(`/plugins/skills${ownerQuery(owner)}`, json(skill)),
  updatePluginSkill: (name: string, patch: { description?: string; content?: string; disableModelInvocation?: boolean }, owner?: SkillOwner) =>
    req<{ ok: boolean }>(`/plugins/skills/${encodeURIComponent(name)}${ownerQuery(owner)}`, json(patch, 'PATCH')),
  deletePluginSkill: (name: string, owner?: SkillOwner) =>
    req<{ ok: boolean }>(`/plugins/skills/${encodeURIComponent(name)}${ownerQuery(owner)}`, { method: 'DELETE' }),
  // The cronjob panel's calls. Same URLs the daemon's routes are tested against on the node side.
  cronJobs: () => req<CronJobRow[]>('/plugins/cronjob/jobs'),
  saveCronJob: (job: CronJobRow) => req<{ ok: boolean }>(`/plugins/cronjob/jobs/${encodeURIComponent(job.id)}`, json(job, 'PUT')),
  deleteCronJob: (id: string) => req<{ ok: boolean }>(`/plugins/cronjob/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  discordChannels: () => req<DiscordChannelOption[]>('/plugins/discord/channels'),
  brainModels: () => req<BrainModelOption[]>('/brain/models'),
  // The editor panel's project-file calls. These are the plugin's OWN grandfathered routes (its manifest
  // lists them under provides.apiRoutes), so the URLs are the contract its node side is tested against.
  projectFiles: (id: number) => req<FileNode[]>(`/projects/${id}/files`),
  projectFile: (id: number, path: string) => req<{ content: string; truncated: boolean }>(`/projects/${id}/file?path=${encodeURIComponent(path)}`),
  writeProjectFile: (id: number, path: string, content: string) => req<{ ok: boolean }>(`/projects/${id}/file`, json({ path, content }, 'PUT')),
  projectFileAtHead: (id: number, path: string) => req<{ content: string }>(`/projects/${id}/head?path=${encodeURIComponent(path)}`),
  projectCommit: (id: number, hash: string) => req<{ diff: string; files: string[] }>(`/projects/${id}/commit/${encodeURIComponent(hash)}`),
  projectCommitFileDiff: (id: number, hash: string, path: string) => req<{ diff: string }>(`/projects/${id}/commit/${encodeURIComponent(hash)}/diff?path=${encodeURIComponent(path)}`),
  projectChanged: (id: number) => req<{ changed: string[] }>(`/projects/${id}/changed`),
  projectChanges: (id: number) => req<{ diff: string }>(`/projects/${id}/changes`),
  newProjectFile: (id: number, path: string) => req<{ ok: boolean }>(`/projects/${id}/new-file`, json({ path })),
  newProjectDir: (id: number, path: string) => req<{ ok: boolean }>(`/projects/${id}/dir`, json({ path })),
  renameProjectEntry: (id: number, from: string, to: string) => req<{ ok: boolean }>(`/projects/${id}/rename`, json({ from, to })),
  copyProjectEntry: (id: number, from: string, to: string) => req<{ ok: boolean }>(`/projects/${id}/copy`, json({ from, to })),
  deleteProjectEntry: (id: number, path: string) => req<{ ok: boolean }>(`/projects/${id}/entry?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),

  // ── the work + agents domains ──────────────────────────────────────────────────────────────────
  // Ported from web/lib/elowenClient.ts URL for URL. These routes belong to the two plugins now, and
  // their node sides are tested against exactly these paths — so the URLs are the contract, and a
  // paraphrase here would let a view drift from the daemon while the UI suite stayed green.
  tasks: (projectId?: number) => req<Task[]>(projectId != null ? `/tasks?project_id=${projectId}` : '/tasks'),
  createTask: (input: Record<string, unknown>) => req<Task>('/tasks', json(input)),
  updateTask: (id: string, patch: Record<string, unknown>) => req<Task>(`/tasks/${encodeURIComponent(id)}`, json(patch, 'PATCH')),
  deleteTask: (id: string) => req<{ ok: boolean }>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  deleteMission: (epicId: string) => req<{ ok: boolean; tasks: number }>(`/tasks/${encodeURIComponent(epicId)}?subtree=1`, { method: 'DELETE' }),
  closeTask: (id: string) => req<Task>(`/tasks/${id}`, json({ status: 'closed' }, 'PATCH')),
  setTaskStatus: (id: string, status: string) => req<Task>(`/tasks/${id}`, json({ status }, 'PATCH')),
  setTaskExec: (id: string, exec: string) => req<Task>(`/tasks/${id}`, json({ exec }, 'PATCH')),
  approveGate: (id: string) => req<{ released: string[] }>(`/tasks/${id}/approve-gate`, { method: 'POST' }),
  taskDeps: (id: string) => req<string[]>(`/tasks/${encodeURIComponent(id)}/deps`),
  taskUsage: (id: string) => req<TokenUsage | null>(`/tasks/${encodeURIComponent(id)}/usage`),
  allDeps: () => req<DepEdge[]>('/tasks/deps'),
  taskCommits: (id: string) => req<{ commits: CommitLogEntry[] }>(`/tasks/${encodeURIComponent(id)}/commits`),
  taskCommitFileDiff: (id: string, hash: string, path: string) => req<{ diff: string }>(`/tasks/${encodeURIComponent(id)}/commit/${encodeURIComponent(hash)}/diff?path=${encodeURIComponent(path)}`),
  taskBrainConversation: (taskId: string) => req<unknown[]>(`/tasks/${encodeURIComponent(taskId)}/conversation`),
  planTask: (input: Record<string, unknown>) => req<{ jobId: string; epicId: string | null }>('/tasks/plan', json(input)),
  getPlanJob: (jobId: string) => req<Record<string, unknown>>(`/plan/${encodeURIComponent(jobId)}`),
  insertPhases: (epicId: string, input: Record<string, unknown>) => req<{ epic: Task; phases: Task[] }>(`/tasks/${encodeURIComponent(epicId)}/phases`, json(input)),

  sessions: () => req<SessionInfo[]>('/sessions'),
  spawn: (input: { taskId: string; exec?: string }) => req<{ session: string }>('/sessions', json(input)),
  sessionPane: (name: string, ansi = false) => req<{ pane: string }>(`/sessions/${encodeURIComponent(name)}/pane${ansi ? '?ansi=1' : ''}`),
  killSession: (name: string) => req<{ ok: boolean }>(`/sessions/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  sendKeys: (name: string, keys: string[]) => req<{ ok: boolean }>(`/sessions/${encodeURIComponent(name)}/keys`, json({ keys })),

  missions: () => req<Mission[]>('/missions'),
  engage: (input: Record<string, unknown>) => req<Mission>('/missions', json(input)),
  pauseMission: (id: string) => req<Mission>(`/missions/${id}`, json({ action: 'pause' }, 'PATCH')),
  resumeMission: (id: string) => req<Mission>(`/missions/${id}`, json({ action: 'resume' }, 'PATCH')),
  disengageMission: (id: string) => req<{ ok: boolean }>(`/missions/${id}`, { method: 'DELETE' }),
  openMissionPr: (id: string) => req<{ url: string; number: number }>(`/missions/${id}/pr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
  mergeMissionPr: (id: string) => req<{ ok: boolean }>(`/missions/${id}/merge-pr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
  missionNotes: (target: string) => req<unknown[]>(`/notes?scope=mission&target=${encodeURIComponent(target)}`),

  pendingAsks: () => req<PendingAsk[]>('/asks/pending'),
  replyAsk: (taskId: string, askId: string, text: string) =>
    req<{ ok: boolean }>(`/tasks/${encodeURIComponent(taskId)}/ask/${encodeURIComponent(askId)}/reply`, json({ text })),

  activity: (opts?: { limit?: number; type?: string; target?: string }) => {
    const qs = new URLSearchParams({ ...(opts?.limit ? { limit: String(opts.limit) } : {}), ...(opts?.type ? { type: opts.type } : {}), ...(opts?.target ? { target: opts.target } : {}) }).toString();
    return req<ActivityEvent[]>(`/activity${qs ? `?${qs}` : ''}`);
  },

  projects: () => req<Project[]>('/projects'),
  projectGit: (id: number) => req<{ isRepo: boolean; status: { dirty: number } | null; commits: CommitLogEntry[] }>(`/projects/${id}/git`),
  projectCommits: (id: number, limit = 30) => req<{ commits: CommitLogEntry[] }>(`/projects/${id}/commits?limit=${limit}`),
  /** Raw file bytes for a project's icon. Same-origin, cookie-authenticated, returned as a Blob the
   *  caller turns into a data URL. */
  projectRawBlob: async (id: number, path: string): Promise<Blob> => {
    const res = await fetch(`${BASE}/projects/${id}/raw?path=${encodeURIComponent(path)}`, { credentials: 'same-origin' });
    if (!res.ok) throw new ElowenApiError(`elowen ${res.status} on raw ${path}`, res.status);
    return res.blob();
  },

  getConfig: () => req<Record<string, unknown>>('/config'),
  updateConfig: (patch: Record<string, unknown>) => req<Record<string, unknown>>('/config', json(patch, 'PUT')),
  usageByModel: (projectId?: number, window?: { fromMs: number; toMs: number }) => {
    const params = new URLSearchParams();
    if (projectId != null) params.set('project_id', String(projectId));
    if (window && Number.isFinite(window.fromMs)) params.set('from', new Date(window.fromMs).toISOString());
    if (window && Number.isFinite(window.toMs)) params.set('to', new Date(window.toMs).toISOString());
    const qs = params.toString();
    return req<ModelUsage[]>(`/usage/by-model${qs ? `?${qs}` : ''}`);
  },
  usageByDay: (projectId?: number, days = 7) => {
    const params = new URLSearchParams();
    if (projectId != null) params.set('project_id', String(projectId));
    params.set('days', String(days));
    return req<unknown[]>(`/usage/by-day?${params.toString()}`);
  },
  resetUsage: () => req<Record<string, unknown>>('/usage/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),

  systemSkills: () => req<{ skills: { provider: string; present: boolean; installed: boolean; upToDate: boolean }[] }>('/system/skills'),
  installSkills: () => req<Record<string, unknown>>('/system/skills/install', json({})),
  pluginDetail: (name: string) => req<{ config?: Record<string, unknown>; configSchema?: unknown[]; secretsSet?: string[] }>(`/plugins/${encodeURIComponent(name)}`),
  savePluginConfig: (name: string, values: Record<string, unknown>) =>
    req<{ ok: boolean }>(`/plugins/${encodeURIComponent(name)}/config`, json({ values }, 'PATCH')),
};

/** Same-origin JSON fetch exposed to a bundle as `runtime.api`. Rejects on non-2xx. */
export async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { ...init, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`api ${res.status} on ${path}`);
  return res.status === 204 ? undefined : res.json();
}
