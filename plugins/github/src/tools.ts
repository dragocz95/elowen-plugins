import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { PluginContext } from 'elowen/plugin-api';
import type { GitHubService } from './service.js';
import type { MutationAction } from './types.js';

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], details: {} });
const failure = (error: unknown) => result(`GitHub: ${error instanceof Error ? error.message : 'The operation failed.'}`);

async function confirmedMutation(ctx: PluginContext, service: GitHubService, action: MutationAction): Promise<ReturnType<typeof result>> {
  if (!ctx.currentSessionId() || !ctx.currentIdentity()) return result('GitHub: mutating tools require an interactive verified conversation. Delegated, scheduled and unattended work may only read GitHub state.');
  try {
    const preview = await service.preview(service.currentUserId(), action, false);
    const answers = await ctx.askUser([{
      header: 'GitHub action', question: `${preview.title}\n\n${preview.description}`, multiSelect: false,
      options: [{ label: 'Confirm', description: 'Perform this external GitHub action once.' }, { label: 'Cancel', description: 'Leave GitHub unchanged.' }],
    }]);
    if (!answers[0]?.selected.includes('Confirm')) return result('GitHub: cancelled.');
    return result(await service.executePreview(service.currentUserId(), preview));
  } catch (error) { return failure(error); }
}

export function registerGitHubTools(ctx: PluginContext, service: GitHubService): void {
  const tools = [
    defineTool({
      name: 'GithubConnectionStatus', label: 'GitHub connection status',
      description: 'Report whether the current Elowen account is connected to GitHub, whether reconnect is required, and how many project mappings it owns. This never returns tokens or secrets.',
      parameters: Type.Object({}), execute: async () => { try { return result(service.connectionStatus()); } catch (error) { return failure(error); } },
    }),
    defineTool({
      name: 'GithubRepositoryStatus', label: 'GitHub repository status',
      description: 'Inspect the current account\'s verified GitHub base/push mapping and repository permissions for one accessible Elowen Project.',
      parameters: Type.Object({ projectId: Type.Number({ description: 'Accessible Elowen Project ID' }) }),
      execute: async (_id: string, input: { projectId: number }) => { try { return result(await service.repositoryStatus(service.currentUserId(), input.projectId)); } catch (error) { return failure(error); } },
    }),
    defineTool({
      name: 'GithubListPullRequests', label: 'List pull requests',
      description: 'List focused pull request summaries for one mapped accessible Elowen Project. No arbitrary owner/repository input is accepted.',
      parameters: Type.Object({ projectId: Type.Number(), state: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('closed'), Type.Literal('all')])) }),
      execute: async (_id: string, input: { projectId: number; state?: 'open' | 'closed' | 'all' }) => { try { return result(await service.listPullRequests(service.currentUserId(), input.projectId, input.state)); } catch (error) { return failure(error); } },
    }),
    defineTool({
      name: 'GithubGetPullRequest', label: 'Get pull request',
      description: 'Read one pull request, its changed files and submitted reviews from the mapped repository of an accessible Elowen Project.',
      parameters: Type.Object({ projectId: Type.Number(), number: Type.Number() }),
      execute: async (_id: string, input: { projectId: number; number: number }) => { try { return result(await service.getPullRequest(service.currentUserId(), input.projectId, input.number)); } catch (error) { return failure(error); } },
    }),
    defineTool({
      name: 'GithubPullRequestChecks', label: 'Pull request checks',
      description: 'Combine GitHub check runs and commit statuses for one pull request into pending, success, failure or action_required while retaining target URLs.',
      parameters: Type.Object({ projectId: Type.Number(), number: Type.Number() }),
      execute: async (_id: string, input: { projectId: number; number: number }) => { try { return result(await service.pullRequestChecks(service.currentUserId(), input.projectId, input.number)); } catch (error) { return failure(error); } },
    }),
    defineTool({
      name: 'GithubPublishBranch', label: 'Publish branch',
      description: 'After interactive confirmation, securely push the current conversation\'s active Sandbox workspace branch to this account\'s mapped GitHub push repository. Never force-pushes.',
      parameters: Type.Object({ projectId: Type.Number() }),
      execute: async (_id: string, input: { projectId: number }) => confirmedMutation(ctx, service, { type: 'publish', projectId: input.projectId, sessionId: ctx.currentSessionId() ?? '' }),
    }),
    defineTool({
      name: 'GithubCreatePullRequest', label: 'Create pull request',
      description: 'After interactive confirmation, publish the active Sandbox branch and create a pull request in the mapped base repository. Returns an existing open PR with the same head/base instead of creating a duplicate.',
      parameters: Type.Object({ projectId: Type.Number(), title: Type.String(), body: Type.Optional(Type.String()), base: Type.Optional(Type.String()) }),
      execute: async (_id: string, input: { projectId: number; title: string; body?: string; base?: string }) => confirmedMutation(ctx, service, { type: 'create_pr', projectId: input.projectId, sessionId: ctx.currentSessionId() ?? '', title: input.title, body: input.body, base: input.base }),
    }),
    defineTool({
      name: 'GithubSubmitReview', label: 'Submit pull request review',
      description: 'After interactive confirmation, submit APPROVE, REQUEST_CHANGES or COMMENT on one pull request in the mapped repository.',
      parameters: Type.Object({ projectId: Type.Number(), number: Type.Number(), event: Type.Union([Type.Literal('APPROVE'), Type.Literal('REQUEST_CHANGES'), Type.Literal('COMMENT')]), body: Type.Optional(Type.String()) }),
      execute: async (_id: string, input: { projectId: number; number: number; event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'; body?: string }) => confirmedMutation(ctx, service, { type: 'review', ...input }),
    }),
    defineTool({
      name: 'GithubMergePullRequest', label: 'Merge pull request',
      description: 'After interactive confirmation, merge one open non-draft pull request only if its head still exactly matches expectedHeadSha, checks are successful, no current review requests changes, and the repository allows the selected method.',
      parameters: Type.Object({ projectId: Type.Number(), number: Type.Number(), expectedHeadSha: Type.String(), method: Type.Optional(Type.Union([Type.Literal('squash'), Type.Literal('merge'), Type.Literal('rebase')])) }),
      execute: async (_id: string, input: { projectId: number; number: number; expectedHeadSha: string; method?: 'squash' | 'merge' | 'rebase' }) => confirmedMutation(ctx, service, { type: 'merge', ...input }),
    }),
  ];
  for (const tool of tools) ctx.registerTool(tool);
}
