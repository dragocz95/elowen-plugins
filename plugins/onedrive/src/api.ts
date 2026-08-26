import type { PluginApiRequest, PluginHttpResponse } from 'elowen/plugin-api';
import type { OneDriveContext } from './coreSeams.js';
import { Drive } from './drive.js';
import { hashFile } from './scan.js';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import type { MirrorLink, OneDriveStore } from './store.js';
import { remoteRootFor, type SyncEngine, type SyncSettings } from './sync.js';

type Gate<T> = { ok: true; value: T } | { ok: false; response: PluginHttpResponse };

export interface ApiDeps {
  ctx: OneDriveContext;
  store: OneDriveStore;
  engine: SyncEngine;
  settings: () => SyncSettings;
  rootFor: (link: MirrorLink) => string | null;
  /** Active sandbox worktrees of a project for an explicitly named account. */
  workspacesOf: (userId: number, projectId: number) => { workspaceId: string; label: string }[];
}

const json = (body: unknown, status = 200): PluginHttpResponse => ({ status, body: body as Record<string, unknown> });
const bad = (error: string, status = 400): PluginHttpResponse => ({ status, body: { error } });

function bodyOf(req: PluginApiRequest): Record<string, unknown> {
  const raw = (req as { body?: unknown }).body;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

const projectIdOf = (value: unknown): number => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
};

export function registerApi(deps: ApiDeps): void {
  const { ctx, store } = deps;

  /** Every route re-checks BOTH halves of the question: the caller is who the session says, and that
   *  account may see this project. A hidden panel is presentation only — the routes are still reachable
   *  directly, so tenancy has to be decided here and not inferred from the UI having been rendered. */
  const guard = (req: PluginApiRequest, projectId: number): Gate<number> => {
    const userId = req.auth.userId;
    if (!userId) return { ok: false, response: bad('sign-in required', 401) };
    if (!projectId) return { ok: false, response: bad('projectId is required') };
    const allowed = req.auth.accessibleProjects;
    const mayAccess = req.auth.admin || allowed === null || allowed === undefined || allowed.includes(projectId);
    // A project the caller cannot see reads as absent, not as forbidden: confirming that an id exists is
    // itself a disclosure when project ids are sequential.
    if (!mayAccess) return { ok: false, response: bad('not found', 404) };
    return { ok: true, value: userId };
  };

  const identityFor = (userId: number) => ctx.control('microsoftIdentity')?.identityFor(userId) ?? { linked: false };

  ctx.registerApiRoute({
    path: 'overview', method: 'GET', access: 'user',
    handler: async (req) => {
      const projectId = projectIdOf(req.query?.projectId);
      const gate = guard(req, projectId);
      if (!gate.ok) return gate.response;
      const links = store.linksForProject(gate.value, projectId);
      return json({
        identity: identityFor(gate.value),
        rootFolder: deps.settings().rootFolder,
        workspaces: deps.workspacesOf(gate.value, projectId).map((workspace) => ({
          ...workspace,
          connected: links.some((link) => link.workspaceId === workspace.workspaceId),
        })),
        links: links.map((link) => ({
          id: link.id,
          workspaceId: link.workspaceId,
          workspaceLabel: link.workspaceLabel,
          remotePath: link.remotePath,
          webUrl: link.webUrl,
          enabled: link.enabled,
          status: link.status,
          error: link.error,
          lastSyncAt: link.lastSyncAt,
          fileCount: link.fileCount,
          byteCount: link.byteCount,
          conflictCount: link.conflictCount,
        })),
      });
    },
  });

  ctx.registerApiRoute({
    path: 'connect', method: 'POST', access: 'user',
    handler: async (req) => {
      const body = bodyOf(req);
      const projectId = projectIdOf(body.projectId);
      const gate = guard(req, projectId);
      if (!gate.ok) return gate.response;

      const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId ? body.workspaceId : null;
      const workspaces = deps.workspacesOf(gate.value, projectId);
      const workspace = workspaceId ? workspaces.find((entry) => entry.workspaceId === workspaceId) : null;
      if (workspaceId && !workspace) return bad('that workspace is not yours or is no longer active', 404);

      const identity = ctx.control('microsoftIdentity');
      const graph = identity ? await identity.driveGraphFor(gate.value) : null;
      if (!graph) return bad('Your account is not connected to Microsoft.', 409);

      const project = ctx.host.stores().projects.get(projectId);
      if (!project) return bad('not found', 404);

      const draft = {
        userId: gate.value, projectId, workspaceId,
        workspaceLabel: workspace?.label ?? null,
        remoteDriveId: '', remoteItemId: '', remotePath: '', webUrl: null as string | null,
      };
      const remotePath = remoteRootFor(deps.settings().rootFolder, project.slug, draft as unknown as MirrorLink);

      const drive = await Drive.open(graph);
      const folder = await drive.ensureFolder(remotePath);
      const link = store.createLink({
        ...draft, remoteDriveId: drive.driveId, remoteItemId: folder.id, remotePath, webUrl: folder.webUrl,
      });
      // A fresh mirror should not wait for the next tick to show signs of life.
      void deps.engine.syncUser(gate.value).catch(() => undefined);
      return json({ id: link.id, remotePath: link.remotePath, webUrl: link.webUrl });
    },
  });

  const ownedLink = (req: PluginApiRequest): Gate<MirrorLink> => {
    const body = bodyOf(req);
    const id = Number(body.id ?? req.query?.id);
    const link = Number.isSafeInteger(id) ? store.linkById(id) : null;
    if (!link) return { ok: false, response: bad('not found', 404) };
    const gate = guard(req, link.projectId);
    if (!gate.ok) return gate;
    // Ownership is a SEPARATE question from project access: two people can share a project, and neither
    // may touch the other's mirror, which points into their personal OneDrive.
    if (link.userId !== gate.value) return { ok: false, response: bad('not found', 404) };
    return { ok: true, value: link };
  };

  ctx.registerApiRoute({
    path: 'disconnect', method: 'POST', access: 'user',
    handler: async (req) => {
      const found = ownedLink(req);
      if (!found.ok) return found.response;
      store.removeLink(found.value.id);
      return json({ ok: true });
    },
  });

  ctx.registerApiRoute({
    path: 'pause', method: 'POST', access: 'user',
    handler: async (req) => {
      const found = ownedLink(req);
      if (!found.ok) return found.response;
      store.setEnabled(found.value.id, bodyOf(req).enabled === true);
      return json({ ok: true });
    },
  });

  ctx.registerApiRoute({
    path: 'sync-now', method: 'POST', access: 'user',
    handler: async (req) => {
      const found = ownedLink(req);
      if (!found.ok) return found.response;
      await deps.engine.syncUser(found.value.userId);
      return json({ ok: true });
    },
  });

  ctx.registerApiRoute({
    path: 'conflicts', method: 'GET', access: 'user',
    handler: async (req) => {
      const found = ownedLink(req);
      if (!found.ok) return found.response;
      return json({
        conflicts: store.conflicts(found.value.id).map((item) => ({
          rel: item.rel, conflictCopy: item.conflictCopy, updatedAt: item.updatedAt,
        })),
      });
    },
  });

  ctx.registerApiRoute({
    path: 'conflicts/resolve', method: 'POST', access: 'user',
    handler: async (req) => {
      const found = ownedLink(req);
      if (!found.ok) return found.response;
      const body = bodyOf(req);
      const rel = typeof body.rel === 'string' ? body.rel : '';
      const keep = body.keep === 'remote' ? 'remote' : 'local';
      const item = store.conflicts(found.value.id).find((entry) => entry.rel === rel);
      if (!item) return bad('not found', 404);

      const root = deps.rootFor(found.value);
      if (!root) return bad('the mirrored folder is no longer available', 409);
      const identity = ctx.control('microsoftIdentity');
      const graph = identity ? await identity.driveGraphFor(found.value.userId) : null;
      if (!graph) return bad('Your account is not connected to Microsoft.', 409);
      const drive = await Drive.open(graph);

      if (keep === 'remote') {
        // The copy kept beside the original IS the remote version, already on disk and already verified.
        // Promoting it is a local move plus one upload, not a second download that could differ again.
        await drive.download(item.remoteItemId, join(root, rel));
      }
      const absolute = join(root, rel);
      const uploaded = await drive.upload(`${found.value.remotePath}/${rel}`, absolute);
      const stats = await stat(absolute);
      store.putItem({
        linkId: found.value.id, rel, localSize: stats.size, localMtimeMs: stats.mtimeMs,
        localSha256: await hashFile(absolute), remoteItemId: uploaded.id || item.remoteItemId,
        remoteEtag: uploaded.etag, state: 'synced', conflictCopy: null,
      });
      return json({ ok: true, kept: keep });
    },
  });
}
