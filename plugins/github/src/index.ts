import type { PluginContext } from 'elowen/plugin-api';
import { registerGitHubApi } from './api.js';
import { registerGitHubTools } from './tools.js';
import { GitHubService, type GitHubServiceDeps } from './service.js';

export interface GitHubRegisterDeps extends GitHubServiceDeps {}

export function register(ctx: PluginContext, deps: GitHubRegisterDeps = {}): void {
  const service = new GitHubService(ctx, deps);
  registerGitHubApi(ctx, service);
  registerGitHubTools(ctx, service);

  ctx.registerReadinessCheck(() => ({
    id: 'github-auth', label: 'GitHub authentication', ok: true,
    detail: 'Device authentication is available when GitHub CLI is installed.',
  }));

  const reconcile = (): void => {
    service.reconcile(
      new Set(ctx.host.stores().usersRead.list().map((user) => user.id)),
      new Set(ctx.host.stores().projects.list().map((project) => project.id)),
    );
  };
  ctx.registerBootReconcile(reconcile);
  ctx.registerInterval('prune-device-auth-and-confirmations', () => service.prune(), 60_000);
  ctx.registerService({ name: 'device-auth', start: () => {}, stop: () => service.stop() });
  ctx.registerUserRemoved((userId) => service.deleteAccount(userId));
  ctx.registerProjectRemoved((projectId) => service.store.deleteProject(projectId));
}
