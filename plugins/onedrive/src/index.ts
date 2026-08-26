import { existsSync } from 'node:fs';
import type { PluginContext } from 'elowen/plugin-api';
import { asOneDriveContext } from './coreSeams.js';
import { registerApi } from './api.js';
import { OneDriveStore, type MirrorLink } from './store.js';
import { SyncEngine, type SyncSettings } from './sync.js';

const numberSetting = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function register(published: PluginContext): void {
  const ctx = asOneDriveContext(published);
  const store = new OneDriveStore(ctx.db());

  const settings = (): SyncSettings => ({
    rootFolder: typeof ctx.config.rootFolder === 'string' && ctx.config.rootFolder.trim() ? ctx.config.rootFolder.trim() : 'Elowen',
    maxFileMb: numberSetting(ctx.config.maxFileMb, 100),
    extraIgnore: typeof ctx.config.extraIgnore === 'string' ? ctx.config.extraIgnore : '',
    applyRemoteDeletions: ctx.config.applyRemoteDeletions !== false,
  });

  /** Active worktrees of one project for an EXPLICITLY named account. The ambient `workspaceRoots` is
   *  useless here: both the background cycle and an HTTP route run without a turn scope to read. */
  const workspacesOf = (userId: number, projectId: number) =>
    (ctx.control('sandbox')?.workspacesFor({ userId, projectIds: [projectId] }) ?? [])
      .map((workspace) => ({ workspaceId: workspace.workspaceId, label: workspace.label, path: workspace.path }));

  /** The absolute directory a mirror covers, or null when it must stop.
   *
   *  Re-resolved every cycle rather than trusted from the row: a project can be re-pointed, a worktree
   *  removed, and an account's access to a project revoked, and each of those must stop the mirror rather
   *  than leave it writing into a path that no longer means what it meant when it was connected. */
  const rootFor = (link: MirrorLink): string | null => {
    if (!ctx.host.stores().userProjects.canAccess(link.userId, link.projectId)) return null;
    if (link.workspaceId) {
      const workspace = workspacesOf(link.userId, link.projectId).find((entry) => entry.workspaceId === link.workspaceId);
      return workspace && existsSync(workspace.path) ? workspace.path : null;
    }
    const project = ctx.host.stores().projects.get(link.projectId);
    return project && existsSync(project.path) ? project.path : null;
  };

  const engine = new SyncEngine({
    store,
    identity: () => ctx.control('microsoftIdentity'),
    rootFor,
    settings,
    log: ctx.logger,
  });

  registerApi({ ctx, store, engine, settings, rootFor, workspacesOf });

  // Only an account actually bound to a Microsoft identity is offered the tab. Answered from the Teams
  // plugin's local directory read - no network on a page load - and fail-closed, because a panel that
  // cannot possibly work is worse than no panel at all.
  ctx.registerUiVisibility(({ userId }) => {
    if (!userId) return { project: [] };
    return ctx.control('microsoftIdentity')?.identityFor(userId).linked === true ? null : { project: [] };
  });

  ctx.registerProjectIndicators((request) => {
    const userId = request.user?.id;
    if (!userId) return [];
    return request.projects.flatMap((project) => {
      const links = store.linksForProject(userId, project.id).filter((link) => link.enabled);
      if (links.length === 0) return [];
      const conflicts = links.reduce((total, link) => total + link.conflictCount, 0);
      const failing = links.some((link) => link.status === 'error');
      return [{
        projectId: project.id,
        label: 'OneDrive',
        value: conflicts > 0 ? String(conflicts) : undefined,
        icon: 'Cloud',
        tone: failing ? 'danger' : conflicts > 0 ? 'warning' : 'success',
      }];
    });
  });

  // A removed project or account leaves no mirror behind. The remote folder is deliberately untouched:
  // deleting somebody's OneDrive files is not this plugin's decision to make.
  ctx.registerProjectRemoved((projectId) => store.removeProject(projectId));
  ctx.registerUserRemoved?.((userId: number) => store.removeUser(userId));

  ctx.registerBootReconcile(() => {
    // A worker killed mid-cycle leaves its claim behind. The lease would expire on its own, but the
    // daemon has just started, so nothing can still be holding one - waiting minutes for that to become
    // true keeps every mirror idle for no reason. The status is stale for the same reason.
    store.releaseAllClaims();
    for (const link of store.enabledLinks()) {
      if (link.status === 'syncing') store.setStatus(link.id, 'idle');
    }
  });

  ctx.registerInterval('sync', () => engine.tick(), Math.max(10, numberSetting(ctx.config.intervalSeconds, 30)) * 1000);

  ctx.logger.info('onedrive mirror registered');
}
