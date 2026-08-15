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
export interface BrainModelOption { id: string; label?: string }

export interface PluginUiListing { name: string; url: string; apiVersion: number; strings: Record<string, string> }

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
};

/** Same-origin JSON fetch exposed to a bundle as `runtime.api`. Rejects on non-2xx. */
export async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { ...init, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`api ${res.status} on ${path}`);
  return res.status === 204 ? undefined : res.json();
}
