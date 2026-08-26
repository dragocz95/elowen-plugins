import type { PluginApiRequest, PluginContext, PluginHttpResponse } from 'elowen/plugin-api';
import { errorBody, GitHubPluginError } from './errors.js';
import type { MutationAction } from './types.js';
import type { GitHubService } from './service.js';

async function objectBody(req: PluginApiRequest): Promise<Record<string, unknown>> {
  const value = await req.json<unknown>().catch(() => null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GitHubPluginError('invalid_request', 400, 'A JSON object is required.');
  return value as Record<string, unknown>;
}
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const integer = (value: unknown): number => Number.isSafeInteger(Number(value)) ? Number(value) : 0;
const userId = (req: PluginApiRequest): number => {
  if (!req.auth.userId) throw new GitHubPluginError('account_required', 401, 'A linked Elowen account is required.');
  return req.auth.userId;
};
const projectId = (req: PluginApiRequest, value: unknown): number => {
  const id = requiredProject(value);
  if (req.auth.accessibleProjects === null ? !req.auth.admin : !req.auth.accessibleProjects.includes(id)) throw new GitHubPluginError('project_forbidden', 403, 'This project is not accessible.');
  return id;
};
const route = (ctx: PluginContext, path: string, method: string, access: 'user' | 'admin', handler: (req: PluginApiRequest) => Promise<PluginHttpResponse> | PluginHttpResponse): void => {
  ctx.registerApiRoute({ path, method, access, handler: async (req) => {
    try { return await handler(req); } catch (error) { return errorBody(error); }
  } });
};

export function registerGitHubApi(ctx: PluginContext, service: GitHubService): void {
  route(ctx, 'setup', 'GET', 'admin', () => ({ body: service.setupStatus() }));
  route(ctx, 'setup/secret', 'POST', 'admin', async (req) => {
    const input = await objectBody(req);
    return { body: service.saveClientSecret(text(input.clientSecret), input.expectedVersion === undefined ? undefined : integer(input.expectedVersion)) };
  });
  route(ctx, 'status', 'GET', 'user', (req) => ({ body: { setup: service.setupStatus(), ...service.connectionStatus(userId(req)) } }));
  route(ctx, 'auth/start', 'POST', 'user', async (req) => {
    const input = await objectBody(req);
    return { body: await service.startOAuth(userId(req), { replaceIdentity: input.replaceIdentity === true, reconnect: input.reconnect === true, confirmationToken: text(input.confirmationToken) || undefined }) };
  });
  route(ctx, 'auth/callback', 'GET', 'user', async (req) => {
    const destination = new URL('/p/github', service.ctx.publicWebUrl() ?? 'http://localhost');
    if (req.query.error) {
      destination.searchParams.set('github', 'denied');
      destination.searchParams.set('reason', req.query.error);
      return { status: 302, headers: { location: `${destination.pathname}${destination.search}` } };
    }
    try {
      await service.finishOAuth(userId(req), { state: text(req.query.state), code: text(req.query.code) });
      destination.searchParams.set('github', 'connected');
    } catch (error) {
      const response = errorBody(error);
      destination.searchParams.set('github', 'error');
      destination.searchParams.set('reason', String((response.body as { error?: string }).error ?? 'oauth_failed'));
    }
    return { status: 302, headers: { location: `${destination.pathname}${destination.search}` } };
  });
  route(ctx, 'test', 'POST', 'user', async (req) => ({ body: await service.testConnection(userId(req)) }));
  route(ctx, 'repositories', 'GET', 'user', async (req) => ({ body: { repositories: await service.repositories(userId(req), req.auth.accessibleProjects, req.auth.admin) } }));
  route(ctx, 'repositories/detect', 'POST', 'user', async (req) => {
    const input = await objectBody(req);
    return { body: await service.detectMapping(userId(req), integer(input.projectId), req.auth.accessibleProjects, req.auth.admin) as object };
  });
  route(ctx, 'repositories/map', 'POST', 'user', async (req) => {
    const input = await objectBody(req);
    return { body: await service.saveMapping(userId(req), {
      projectId: integer(input.projectId), baseOwner: text(input.baseOwner), baseName: text(input.baseName),
      pushOwner: text(input.pushOwner) || undefined, pushName: text(input.pushName) || undefined,
      baseRemote: text(input.baseRemote) || undefined, pushRemote: text(input.pushRemote) || undefined,
    }, req.auth.accessibleProjects, req.auth.admin) };
  });
  route(ctx, 'pull-requests', 'GET', 'user', async (req) => {
    const state = req.query.state === 'closed' || req.query.state === 'all' ? req.query.state : 'open';
    return { body: { pullRequests: await service.listPullRequests(userId(req), projectId(req, req.query.projectId), state) } };
  });
  route(ctx, 'pull-request', 'GET', 'user', async (req) => ({ body: await service.getPullRequest(userId(req), projectId(req, req.query.projectId), integer(req.query.number)) }));
  route(ctx, 'checks', 'GET', 'user', async (req) => ({ body: await service.pullRequestChecks(userId(req), projectId(req, req.query.projectId), integer(req.query.number)) }));
  route(ctx, 'actions/preview', 'POST', 'user', async (req) => {
    const input = await objectBody(req);
    return { body: await service.preview(userId(req), authorizedAction(req, input), true) };
  });
  route(ctx, 'actions/confirm', 'POST', 'user', async (req) => {
    const input = await objectBody(req);
    return { body: await service.confirm(userId(req), authorizedAction(req, input), text(input.confirmationToken)) as object };
  });
}

function authorizedAction(req: PluginApiRequest, input: Record<string, unknown>): MutationAction {
  const action = mutationAction(input);
  if ('projectId' in action) projectId(req, action.projectId);
  return action;
}

export function mutationAction(input: Record<string, unknown>): MutationAction {
  const type = text(input.type);
  if (type === 'disconnect' || type === 'replace_identity') return { type };
  if (type === 'remove_mapping') return { type, projectId: requiredProject(input.projectId) };
  if (type === 'publish') return { type, projectId: requiredProject(input.projectId), sessionId: requiredText(input.sessionId, 'sessionId') };
  if (type === 'create_pr') return {
    type, projectId: requiredProject(input.projectId), sessionId: requiredText(input.sessionId, 'sessionId'),
    title: requiredText(input.title, 'title'), body: text(input.body) || undefined, base: text(input.base) || undefined,
  };
  if (type === 'review') {
    const event = input.event;
    if (event !== 'APPROVE' && event !== 'REQUEST_CHANGES' && event !== 'COMMENT') throw new GitHubPluginError('invalid_review', 400, 'Review event must be APPROVE, REQUEST_CHANGES or COMMENT.');
    return { type, projectId: requiredProject(input.projectId), number: requiredNumber(input.number, 'number'), event, body: text(input.body) || undefined };
  }
  if (type === 'merge') {
    const method = input.method;
    if (method !== undefined && method !== 'squash' && method !== 'merge' && method !== 'rebase') throw new GitHubPluginError('invalid_merge_method', 400, 'Merge method must be squash, merge or rebase.');
    return { type, projectId: requiredProject(input.projectId), number: requiredNumber(input.number, 'number'), expectedHeadSha: requiredText(input.expectedHeadSha, 'expectedHeadSha'), method };
  }
  throw new GitHubPluginError('invalid_action', 400, 'Unknown GitHub action.');
}

function requiredProject(value: unknown): number { return requiredNumber(value, 'projectId'); }
function requiredNumber(value: unknown, name: string): number {
  const parsed = integer(value);
  if (parsed <= 0) throw new GitHubPluginError('invalid_request', 400, `${name} must be a positive integer.`);
  return parsed;
}
function requiredText(value: unknown, name: string): string {
  const parsed = text(value);
  if (!parsed) throw new GitHubPluginError('invalid_request', 400, `${name} is required.`);
  return parsed;
}
