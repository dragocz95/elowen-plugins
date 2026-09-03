import { registerGitHubApi } from './api.js';
import { registerGitHubTools } from './tools.js';
import { GitHubService } from './service.js';
export function register(ctx, deps = {}) {
    const service = new GitHubService(ctx, deps);
    registerGitHubApi(ctx, service);
    registerGitHubTools(ctx, service);
    // The GitHub identity seam siblings resolve with `ctx.control('github')`. Sandbox uses it to start a
    // confined child already signed in as the person driving the turn; the token stays in this process and
    // in that child's environment, and never reaches disk on either side.
    ctx.registerControl('github', {
        sessionCredential: (input) => service.sessionCredential(input),
    });
    ctx.registerProjectIndicators(({ projects, user }) => (service.projectIndicators(projects, user?.id ?? null)));
    ctx.registerReadinessCheck(async () => {
        const readiness = await service.readiness();
        return { id: 'github-auth', label: 'GitHub authentication', ...readiness };
    });
    const reconcile = () => {
        service.reconcile(new Set(ctx.host.stores().usersRead.list().map((user) => user.id)), new Set(ctx.host.stores().projects.list().map((project) => project.id)));
    };
    ctx.registerBootReconcile(reconcile);
    ctx.registerInterval('prune-device-auth-and-confirmations', () => service.prune(), 60_000);
    ctx.registerService({ name: 'device-auth', start: () => { }, stop: () => service.stop() });
    ctx.registerUserRemoved((userId) => service.deleteAccount(userId));
    ctx.registerProjectRemoved((projectId) => service.store.deleteProject(projectId));
}
