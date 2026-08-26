import type { PluginContext } from 'elowen/plugin-api';
import { registerGitHubApi } from './api.js';
import { registerGitHubTools } from './tools.js';
import { GitHubService, type GitHubServiceDeps } from './service.js';

export interface GitHubRegisterDeps extends GitHubServiceDeps {}

export function register(ctx: PluginContext, deps: GitHubRegisterDeps = {}): void {
  const service = new GitHubService(ctx, deps);
  registerGitHubApi(ctx, service);
  registerGitHubTools(ctx, service);

  ctx.registerReadinessCheck(() => {
    const setup = service.setupStatus();
    return {
      id: 'github-app', label: 'GitHub App', ok: setup.configured,
      detail: setup.configured ? `Configured for ${setup.appSlug}.` : 'GitHub App setup is incomplete.',
      hint: setup.callbackUrl ? `Callback URL: ${setup.callbackUrl}` : 'Configure a canonical public web URL before OAuth setup.',
    };
  });

  const reconcile = (): void => {
    service.reconcile(
      new Set(ctx.host.stores().usersRead.list().map((user) => user.id)),
      new Set(ctx.host.stores().projects.list().map((project) => project.id)),
    );
  };
  ctx.registerBootReconcile(reconcile);
  ctx.registerInterval('prune-oauth-and-confirmations', () => service.prune(), 60_000);
  ctx.registerUserRemoved((userId) => service.deleteAccount(userId));
  ctx.registerProjectRemoved((projectId) => service.store.deleteProject(projectId));
}
