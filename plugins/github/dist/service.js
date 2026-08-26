import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { callbackUrl, pluginConfig, requireAppSetup } from './config.js';
import { GitHubClient, GitHubHttpError } from './githubClient.js';
import { GitHubPluginError } from './errors.js';
import { publishBranch } from './execution.js';
import { suggestedRepositories } from './remotes.js';
import { GitHubStore, hashValue } from './store.js';
const TOKEN_KEY = 'oauth-token';
const FLOW_TTL = 10 * 60_000;
const CONFIRM_TTL = 5 * 60_000;
const REFRESH_SKEW = 60_000;
const PR_LEASE_TTL = 60_000;
const PR_LEASE_WAIT = 30_000;
const mutexes = new Map();
export class GitHubService {
    ctx;
    store;
    client;
    now;
    spawnPrepared;
    constructor(ctx, deps = {}) {
        this.ctx = ctx;
        this.store = new GitHubStore(ctx.db());
        this.client = new GitHubClient({ fetch: deps.fetch ?? globalThis.fetch, apiBase: deps.apiBase, oauthBase: deps.oauthBase });
        this.now = deps.now ?? Date.now;
        this.spawnPrepared = deps.spawnPrepared;
    }
    currentUserId() {
        const id = this.ctx.currentContributionUserId() ?? this.ctx.currentIdentity()?.elowenUserId ?? null;
        if (!id)
            throw new GitHubPluginError('account_required', 401, 'A linked Elowen account is required.');
        return id;
    }
    secrets(userId) {
        if (this.currentUserId() !== userId)
            throw new GitHubPluginError('account_mismatch', 403, 'The GitHub account does not belong to the current Elowen account.');
        const bag = this.ctx.userSecrets();
        if (!bag)
            throw new GitHubPluginError('account_required', 401, 'A linked Elowen account is required.');
        return bag;
    }
    project(userId, projectId, accessible, admin = false) {
        if (!Number.isSafeInteger(projectId) || projectId <= 0)
            throw new GitHubPluginError('project_not_found', 404, 'Project not found.');
        if (accessible !== undefined) {
            if (accessible === null ? !admin : !accessible.includes(projectId))
                throw new GitHubPluginError('project_forbidden', 403, 'This project is not accessible.');
        }
        else {
            const access = this.ctx.currentAccess();
            if (!access.admin && !access.projectIds.includes(projectId))
                throw new GitHubPluginError('project_forbidden', 403, 'This project is not accessible.');
        }
        if (this.currentUserId() !== userId)
            throw new GitHubPluginError('account_mismatch', 403, 'The GitHub account does not belong to the current Elowen account.');
        const project = this.ctx.host.stores().projects.get(projectId);
        if (!project)
            throw new GitHubPluginError('project_not_found', 404, 'Project not found.');
        return project;
    }
    setupStatus() {
        const config = pluginConfig(this.ctx);
        let redirect = null;
        try {
            redirect = callbackUrl(this.ctx);
        }
        catch { /* readiness exposes the missing URL */ }
        return {
            configured: !!config.clientId && !!config.appSlug && this.ctx.instanceSecrets().has('client-secret') && !!redirect,
            clientIdSet: !!config.clientId, appSlug: config.appSlug, clientSecretSet: this.ctx.instanceSecrets().has('client-secret'), callbackUrl: redirect,
        };
    }
    saveClientSecret(secret, expectedVersion) {
        const value = secret.trim();
        if (value.length < 20)
            throw new GitHubPluginError('client_secret_invalid', 400, 'Enter the complete GitHub App client secret.');
        return { version: this.ctx.instanceSecrets().set('client-secret', value, expectedVersion) };
    }
    connectionStatus(userId = this.currentUserId()) {
        const account = this.store.account(userId);
        return { connected: !!account && account.status === 'connected', reconnectRequired: account?.status === 'reconnect_required', account, mappings: this.store.mappings(userId).length };
    }
    async startOAuth(userId, input = {}) {
        const setup = requireAppSetup(this.ctx);
        const existing = this.store.account(userId);
        if (existing && !input.replaceIdentity && !input.reconnect)
            throw new GitHubPluginError('already_connected', 409, 'This Elowen account is already connected to GitHub.');
        if (existing && input.replaceIdentity) {
            if (!input.confirmationToken)
                throw new GitHubPluginError('confirmation_required', 409, 'Replacing the connected GitHub identity requires confirmation.');
            const confirmation = this.store.consumeConfirmation(input.confirmationToken, userId, 'replace_identity', this.now());
            if (confirmation.expected.githubUserId !== existing.githubUserId || confirmation.expected.updatedAt !== existing.updatedAt)
                throw stale();
        }
        const state = randomBytes(32).toString('base64url');
        const verifier = randomBytes(64).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const stateHash = hashValue(state);
        const secretKey = `oauth-flow:${stateHash}`;
        const expiresAt = this.now() + FLOW_TTL;
        const flowSecrets = this.ctx.instanceSecrets();
        flowSecrets.set(secretKey, verifier);
        try {
            this.store.saveFlow({ stateHash, userId, secretKey, redirectUri: setup.redirectUri, replaceIdentity: !!input.replaceIdentity, expiresAt });
        }
        catch (error) {
            flowSecrets.delete(secretKey);
            throw error;
        }
        return { authorizeUrl: this.client.authorizationUrl({ clientId: setup.clientId, redirectUri: setup.redirectUri, state, challenge }), expiresAt };
    }
    async finishOAuth(userId, input) {
        const setup = requireAppSetup(this.ctx);
        const stateHash = hashValue(input.state);
        const flow = this.store.flow(stateHash);
        if (!flow)
            throw new GitHubPluginError('oauth_state_invalid', 400, 'The GitHub connection request is invalid or has already been used.');
        if (flow.userId !== userId)
            throw new GitHubPluginError('oauth_account_mismatch', 403, 'The GitHub connection request belongs to another Elowen account.');
        if (flow.expiresAt <= this.now()) {
            this.discardFlow(flow);
            throw new GitHubPluginError('oauth_state_expired', 409, 'The GitHub connection request has expired.');
        }
        const bag = this.secrets(userId);
        const verifier = this.ctx.instanceSecrets().get(flow.secretKey)?.value;
        if (!verifier) {
            this.store.deleteFlow(stateHash);
            throw new GitHubPluginError('oauth_state_invalid', 400, 'The GitHub connection request is incomplete.');
        }
        this.discardFlow(flow);
        const token = await this.client.exchangeCode({
            clientId: setup.clientId, clientSecret: setup.clientSecret, code: input.code,
            redirectUri: flow.redirectUri, verifier,
        }, this.now());
        const profile = await this.client.user(token.accessToken);
        const owner = this.store.accountOwner(profile.id);
        if (owner !== null && owner !== userId)
            throw new GitHubPluginError('github_identity_in_use', 409, 'This GitHub identity is already connected to another Elowen account.');
        const existing = this.store.account(userId);
        if (existing && existing.githubUserId !== profile.id && !flow.replaceIdentity) {
            throw new GitHubPluginError('identity_replacement_required', 409, 'Replacing the connected GitHub identity requires explicit confirmation.');
        }
        const previous = bag.get(TOKEN_KEY);
        bag.set(TOKEN_KEY, JSON.stringify(token), previous?.version);
        await this.revalidateMappings(userId, token.accessToken);
        const now = this.now();
        const account = {
            userId, githubUserId: profile.id, login: profile.login, name: profile.name, avatarUrl: profile.avatar_url,
            tokenExpiresAt: token.accessExpiresAt, refreshExpiresAt: token.refreshExpiresAt,
            status: 'connected', lastError: null, verifiedAt: now, updatedAt: now,
        };
        this.store.saveAccount(account);
        return account;
    }
    cancelOAuth(userId, state) {
        const flow = this.store.flow(hashValue(state));
        if (!flow)
            return;
        if (flow.userId !== userId)
            throw new GitHubPluginError('oauth_account_mismatch', 403, 'The GitHub connection request belongs to another Elowen account.');
        this.discardFlow(flow);
    }
    prune(now = this.now()) {
        for (const flow of this.store.flows({ expiredAt: now }))
            this.discardFlow(flow);
        this.store.prune(now);
    }
    deleteAccount(userId) {
        for (const flow of this.store.flows({ userId }))
            this.discardFlow(flow);
        this.store.deleteAccount(userId);
    }
    reconcile(validUsers, validProjects) {
        this.prune();
        for (const flow of this.store.flows())
            if (!validUsers.has(flow.userId))
                this.discardFlow(flow);
        this.store.reconcile(validUsers, validProjects);
    }
    discardFlow(flow) {
        this.ctx.instanceSecrets().delete(flow.secretKey);
        this.store.deleteFlow(flow.stateHash);
    }
    async testConnection(userId = this.currentUserId()) {
        return this.withToken(userId, async (token) => {
            const [profile, limits] = await Promise.all([this.client.user(token), this.client.rateLimit(token)]);
            const core = limits.resources?.core;
            return { profile: { id: profile.id, login: profile.login, name: profile.name, avatarUrl: profile.avatar_url }, rateLimit: core ?? null };
        });
    }
    disconnect(userId = this.currentUserId()) {
        this.secrets(userId).delete(TOKEN_KEY);
        for (const flow of this.store.flows({ userId }))
            this.discardFlow(flow);
        this.store.deactivateMappings(userId);
        this.store.disconnectAccount(userId);
    }
    async repositories(userId, accessible, admin) {
        const projects = this.ctx.host.stores().projects.list().filter((project) => accessible === null ? admin : accessible.includes(project.id));
        return Promise.all(projects.map(async (project) => {
            const mapping = this.store.mapping(userId, project.id);
            const snapshot = await this.ctx.host.git().projectSnapshot(project.path);
            return { project: { id: project.id, slug: project.slug }, mapping, remotes: snapshot.remotes, detected: suggestedRepositories(snapshot.remotes) };
        }));
    }
    async detectMapping(userId, projectId, accessible, admin = false) {
        const project = this.project(userId, projectId, accessible, admin);
        const snapshot = await this.ctx.host.git().projectSnapshot(project.path);
        const suggested = suggestedRepositories(snapshot.remotes);
        const verified = {};
        await this.withToken(userId, async (token) => {
            for (const candidate of suggested.candidates) {
                const key = `${candidate.owner.toLowerCase()}/${candidate.name.toLowerCase()}`;
                if (!verified[key])
                    verified[key] = await this.client.repository(token, candidate.owner, candidate.name);
            }
        });
        return { project: { id: project.id, slug: project.slug }, remotes: snapshot.remotes, suggested, verified };
    }
    async saveMapping(userId, input, accessible, admin = false) {
        this.project(userId, input.projectId, accessible, admin);
        const base = await this.withToken(userId, (token) => this.client.repository(token, input.baseOwner, input.baseName));
        const push = input.pushOwner && input.pushName
            ? await this.withToken(userId, (token) => this.client.repository(token, input.pushOwner, input.pushName)) : base;
        if (!base.permissions.pull)
            throw new GitHubPluginError('base_repository_unreadable', 403, 'The connected GitHub account cannot read the base repository.');
        if (!push.permissions.push)
            throw new GitHubPluginError('push_repository_unwritable', 403, 'The connected GitHub account cannot push to the selected repository.');
        const mapping = {
            userId, projectId: input.projectId, baseRepoId: base.id, baseOwner: base.owner, baseName: base.name,
            pushRepoId: push.id, pushOwner: push.owner, pushName: push.name,
            baseRemote: input.baseRemote?.trim() || null, pushRemote: input.pushRemote?.trim() || null, verifiedAt: this.now(), active: true,
        };
        this.store.saveMapping(mapping);
        return mapping;
    }
    repositoryStatus(userId, projectId) {
        const project = this.project(userId, projectId);
        const mapping = this.requireMapping(userId, projectId);
        return this.withToken(userId, async (token) => {
            const [base, push, snapshot] = await Promise.all([
                this.client.repository(token, mapping.baseOwner, mapping.baseName),
                mapping.pushRepoId === mapping.baseRepoId ? null : this.client.repository(token, mapping.pushOwner, mapping.pushName),
                this.ctx.host.git().projectSnapshot(project.path),
            ]);
            return { project: { id: project.id, slug: project.slug }, mapping, base, push: push ?? base, snapshot };
        });
    }
    async listPullRequests(userId, projectId, state = 'open') {
        this.project(userId, projectId);
        const mapping = this.requireMapping(userId, projectId);
        return this.withToken(userId, async (token) => {
            const pulls = await this.client.listPullRequests(token, mapping.baseOwner, mapping.baseName, state);
            return Promise.all(pulls.map(async (pull) => ({ ...pull, reviewDecision: latestReviewDecision(await this.client.reviews(token, mapping.baseOwner, mapping.baseName, pull.number)) })));
        });
    }
    async getPullRequest(userId, projectId, number) {
        this.project(userId, projectId);
        const mapping = this.requireMapping(userId, projectId);
        return this.withToken(userId, (token) => this.client.pullRequest(token, mapping.baseOwner, mapping.baseName, number));
    }
    async pullRequestChecks(userId, projectId, number) {
        const pull = await this.getPullRequest(userId, projectId, number);
        const mapping = this.requireMapping(userId, projectId);
        return this.withToken(userId, (token) => this.client.checks(token, mapping.baseOwner, mapping.baseName, pull.headSha));
    }
    async preview(userId, action, persist = true) {
        const preview = await this.buildPreview(userId, action);
        if (!persist)
            return preview;
        const expiresAt = this.now() + CONFIRM_TTL;
        const confirmation = this.store.createConfirmation({
            userId, action: action.type, projectId: 'projectId' in action ? action.projectId : null,
            target: preview.target, expected: preview.expected, expiresAt,
        });
        return { ...preview, confirmationToken: confirmation.token, expiresAt: confirmation.expiresAt };
    }
    async confirm(userId, action, confirmationToken) {
        const record = this.store.consumeConfirmation(confirmationToken, userId, action.type, this.now());
        assertActionBound(action, record.target);
        return this.execute(userId, action, record.target, record.expected);
    }
    async executePreview(userId, preview) {
        return this.execute(userId, preview.action, preview.target, preview.expected);
    }
    async buildPreview(userId, action) {
        if (action.type === 'disconnect') {
            const account = this.store.account(userId);
            if (!account)
                throw new GitHubPluginError('not_connected', 409, 'GitHub is not connected.');
            return { action, title: 'Disconnect GitHub', description: `Disconnect @${account.login} from this Elowen account. GitHub-side authorization is not revoked automatically.`, target: { githubUserId: account.githubUserId, login: account.login }, expected: { githubUserId: account.githubUserId, updatedAt: account.updatedAt } };
        }
        if (action.type === 'replace_identity') {
            const account = this.store.account(userId);
            if (!account)
                throw new GitHubPluginError('not_connected', 409, 'GitHub is not connected.');
            return { action, title: 'Replace GitHub identity', description: `Replace @${account.login} with another GitHub identity. Existing repository mappings will be revalidated.`, target: { githubUserId: account.githubUserId, login: account.login }, expected: { githubUserId: account.githubUserId, updatedAt: account.updatedAt } };
        }
        if (action.type === 'remove_mapping') {
            const mapping = this.store.mapping(userId, action.projectId);
            if (!mapping)
                throw new GitHubPluginError('mapping_required', 409, 'Map this Elowen project to a GitHub repository first.');
            return { action, title: 'Remove repository mapping', description: `Remove the mapping to ${mapping.baseOwner}/${mapping.baseName}.`, target: { projectId: action.projectId, repository: `${mapping.baseOwner}/${mapping.baseName}` }, expected: { verifiedAt: mapping.verifiedAt, baseRepoId: mapping.baseRepoId, pushRepoId: mapping.pushRepoId } };
        }
        if (action.type === 'publish' || action.type === 'create_pr') {
            const state = await this.publishState(userId, action.projectId, action.sessionId);
            const base = action.type === 'create_pr' ? normalizeBase(action.base ?? state.workspace.baseRef, state.mapping, state.base.defaultBranch) : state.base.defaultBranch;
            const existing = action.type === 'create_pr'
                ? await this.withToken(userId, (token) => this.client.findOpenPullRequest(token, state.mapping.baseOwner, state.mapping.baseName, state.mapping.pushOwner, state.workspace.branch, base)) : null;
            const title = action.type === 'publish' ? 'Publish branch' : existing ? 'Open existing pull request' : 'Create pull request';
            const description = action.type === 'publish'
                ? `Push ${state.workspace.branch} to ${state.mapping.pushOwner}/${state.mapping.pushName} without force.`
                : existing ? `Pull request #${existing.number} already matches ${state.workspace.branch} → ${base}; it will be returned without creating a duplicate.`
                    : `Create a pull request in ${state.mapping.baseOwner}/${state.mapping.baseName}: ${state.workspace.branch} → ${base}.`;
            return {
                action, title, description,
                target: { projectId: action.projectId, sessionId: action.sessionId, repository: `${state.mapping.baseOwner}/${state.mapping.baseName}`, branch: state.workspace.branch, base, existingNumber: existing?.number ?? null, ...(action.type === 'create_pr' ? { title: action.title, body: action.body ?? '', requestedBase: action.base?.trim() ?? '' } : {}) },
                expected: { workspaceId: state.workspace.workspaceId, head: state.head, branch: state.workspace.branch, mappingVerifiedAt: state.mapping.verifiedAt, existingNumber: existing?.number ?? null },
            };
        }
        const mapping = this.requireMapping(userId, action.projectId);
        const pull = await this.getPullRequest(userId, action.projectId, action.number);
        if (action.type === 'review') {
            return { action, title: 'Submit pull request review', description: `${action.event.replace('_', ' ')} on ${mapping.baseOwner}/${mapping.baseName}#${action.number}.`, target: { projectId: action.projectId, number: action.number, event: action.event, body: action.body ?? '', repository: `${mapping.baseOwner}/${mapping.baseName}` }, expected: { headSha: pull.headSha, state: pull.state, draft: pull.draft } };
        }
        const checks = await this.pullRequestChecks(userId, action.projectId, action.number);
        return { action, title: 'Merge pull request', description: `Merge ${mapping.baseOwner}/${mapping.baseName}#${action.number} at ${pull.headSha.slice(0, 12)} using ${action.method ?? this.mergePreference()}.`, target: { projectId: action.projectId, number: action.number, repository: `${mapping.baseOwner}/${mapping.baseName}`, method: action.method ?? this.mergePreference(), expectedHeadSha: action.expectedHeadSha }, expected: { headSha: pull.headSha, requestedHeadSha: action.expectedHeadSha, state: pull.state, draft: pull.draft, checks: checks.state } };
    }
    async execute(userId, action, target, expected) {
        if (action.type === 'disconnect') {
            const account = this.store.account(userId);
            if (!account || account.githubUserId !== expected.githubUserId || account.updatedAt !== expected.updatedAt)
                throw stale();
            this.disconnect(userId);
            return { disconnected: true, revokeUrl: 'https://github.com/settings/applications' };
        }
        if (action.type === 'replace_identity') {
            const account = this.store.account(userId);
            if (!account || account.githubUserId !== expected.githubUserId || account.updatedAt !== expected.updatedAt)
                throw stale();
            return { confirmed: true };
        }
        if (action.type === 'remove_mapping') {
            const mapping = this.store.mapping(userId, action.projectId);
            if (!mapping)
                throw new GitHubPluginError('mapping_required', 409, 'Map this Elowen project to a GitHub repository first.');
            if (mapping.verifiedAt !== expected.verifiedAt || mapping.baseRepoId !== expected.baseRepoId || mapping.pushRepoId !== expected.pushRepoId)
                throw stale();
            this.store.deleteMapping(userId, action.projectId);
            return { removed: true };
        }
        if (action.type === 'publish' || action.type === 'create_pr') {
            const state = await this.publishState(userId, action.projectId, action.sessionId);
            if (state.workspace.workspaceId !== expected.workspaceId || state.head !== expected.head || state.workspace.branch !== expected.branch || state.mapping.verifiedAt !== expected.mappingVerifiedAt)
                throw stale();
            const base = String(target.base);
            const perform = async () => {
                if (action.type === 'create_pr') {
                    const existing = await this.withToken(userId, (token) => this.client.findOpenPullRequest(token, state.mapping.baseOwner, state.mapping.baseName, state.mapping.pushOwner, state.workspace.branch, base));
                    if (existing)
                        return { pullRequest: existing, created: false };
                }
                const published = await this.withToken(userId, (token) => publishBranch({ ctx: this.ctx, cwd: state.workspace.path, branch: state.workspace.branch, token, repository: { owner: state.mapping.pushOwner, name: state.mapping.pushName }, runner: this.spawnPrepared }));
                if (action.type === 'publish')
                    return { ...published, branch: state.workspace.branch, repository: `${state.mapping.pushOwner}/${state.mapping.pushName}` };
                return this.withToken(userId, async (token) => {
                    const existing = await this.client.findOpenPullRequest(token, state.mapping.baseOwner, state.mapping.baseName, state.mapping.pushOwner, state.workspace.branch, base);
                    if (existing)
                        return { pullRequest: existing, created: false };
                    try {
                        const created = await this.client.createPullRequest(token, state.mapping.baseOwner, state.mapping.baseName, { title: action.title.trim(), body: action.body?.trim() ?? '', head: `${state.mapping.pushOwner}:${state.workspace.branch}`, base });
                        return { pullRequest: created, created: true };
                    }
                    catch (error) {
                        if (!(error instanceof GitHubHttpError) || error.responseStatus !== 422)
                            throw error;
                        const duplicate = await this.client.findOpenPullRequest(token, state.mapping.baseOwner, state.mapping.baseName, state.mapping.pushOwner, state.workspace.branch, base);
                        if (!duplicate)
                            throw error;
                        return { pullRequest: duplicate, created: false };
                    }
                });
            };
            if (action.type === 'publish')
                return perform();
            const leaseKey = hashValue(JSON.stringify([state.mapping.baseRepoId, state.mapping.pushRepoId, state.mapping.pushOwner, state.workspace.branch, base]));
            return this.withPullRequestLease(leaseKey, perform);
        }
        const mapping = this.requireMapping(userId, action.projectId);
        const pull = await this.getPullRequest(userId, action.projectId, action.number);
        if (pull.headSha !== expected.headSha || pull.state !== expected.state || pull.draft !== expected.draft)
            throw stale();
        if (action.type === 'review') {
            if (pull.state !== 'open')
                throw new GitHubPluginError('pull_request_closed', 409, 'The pull request is no longer open.');
            return this.withToken(userId, (token) => this.client.submitReview(token, mapping.baseOwner, mapping.baseName, action.number, { event: action.event, body: action.body?.trim() ?? '' }));
        }
        if (action.expectedHeadSha !== pull.headSha || expected.requestedHeadSha !== pull.headSha)
            throw new GitHubPluginError('head_changed', 409, `The pull request head changed to ${pull.headSha}. Preview the merge again.`);
        if (pull.state !== 'open' || pull.draft)
            throw new GitHubPluginError('pull_request_blocked', 409, pull.draft ? 'Draft pull requests cannot be merged.' : 'The pull request is no longer open.');
        const checks = await this.pullRequestChecks(userId, action.projectId, action.number);
        if (checks.state !== 'success')
            throw new GitHubPluginError('checks_not_successful', 409, `Pull request checks are ${checks.state}.`);
        if (latestReviewDecision(pull.reviews) === 'changes_requested')
            throw new GitHubPluginError('changes_requested', 409, 'A current review requests changes.');
        const repository = await this.withToken(userId, (token) => this.client.repository(token, mapping.baseOwner, mapping.baseName));
        const method = action.method ?? this.mergePreference();
        if ((method === 'squash' && !repository.allowSquashMerge) || (method === 'merge' && !repository.allowMergeCommit) || (method === 'rebase' && !repository.allowRebaseMerge)) {
            throw new GitHubPluginError('merge_method_disabled', 409, `The repository does not allow ${method} merges.`);
        }
        const result = await this.withToken(userId, (token) => this.client.mergePullRequest(token, mapping.baseOwner, mapping.baseName, action.number, { sha: pull.headSha, merge_method: method }));
        if (!result.merged)
            throw new GitHubPluginError('merge_rejected', 409, result.message || 'GitHub rejected the merge.');
        return result;
    }
    async withPullRequestLease(leaseKey, operation) {
        const owner = `${process.pid}:${randomUUID()}`;
        const deadline = this.now() + PR_LEASE_WAIT;
        while (!this.store.acquirePullRequestLease(leaseKey, owner, this.now(), PR_LEASE_TTL)) {
            if (this.now() >= deadline)
                throw new GitHubPluginError('pull_request_busy', 409, 'Another process is creating this pull request. Refresh shortly.');
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        }
        const heartbeat = setInterval(() => this.store.renewPullRequestLease(leaseKey, owner, this.now(), PR_LEASE_TTL), 5_000);
        heartbeat.unref?.();
        try {
            return await operation();
        }
        finally {
            clearInterval(heartbeat);
            this.store.releasePullRequestLease(leaseKey, owner);
        }
    }
    async publishState(userId, projectId, sessionId) {
        this.project(userId, projectId);
        if (!sessionId)
            throw new GitHubPluginError('session_required', 400, 'Select the conversation whose active workspace should be published.');
        const sandbox = this.ctx.control('sandbox');
        if (!sandbox)
            throw new GitHubPluginError('sandbox_unavailable', 503, 'Sandbox is required to publish a branch.');
        const workspace = sandbox.activeWorkspace({ sessionId, projectId });
        if (!workspace)
            throw new GitHubPluginError('active_workspace_required', 409, 'Select an active Sandbox workspace for this conversation and project.');
        const mapping = this.requireMapping(userId, projectId);
        const [head, base] = await Promise.all([
            this.ctx.host.git().projectHead(workspace.path),
            this.withToken(userId, (token) => this.client.repository(token, mapping.baseOwner, mapping.baseName)),
        ]);
        if (!head)
            throw new GitHubPluginError('publish_requires_commit', 409, 'Commit at least one change before publishing the branch.');
        return { workspace, mapping, base, head };
    }
    async revalidateMappings(userId, token) {
        for (const mapping of this.store.mappings(userId)) {
            try {
                const base = await this.client.repository(token, mapping.baseOwner, mapping.baseName);
                const push = mapping.pushRepoId === mapping.baseRepoId ? base : await this.client.repository(token, mapping.pushOwner, mapping.pushName);
                const active = base.id === mapping.baseRepoId && push.id === mapping.pushRepoId && base.permissions.pull && push.permissions.push;
                this.store.saveMapping({ ...mapping, baseOwner: base.owner, baseName: base.name, pushOwner: push.owner, pushName: push.name, active, verifiedAt: active ? this.now() : 0 });
            }
            catch {
                this.store.saveMapping({ ...mapping, active: false, verifiedAt: 0 });
            }
        }
    }
    requireMapping(userId, projectId) {
        const mapping = this.store.mapping(userId, projectId);
        if (!mapping || !mapping.active)
            throw new GitHubPluginError('mapping_required', 409, 'Map and verify this Elowen project with the connected GitHub identity first.');
        return mapping;
    }
    mergePreference() {
        const value = this.ctx.userConfig()?.mergeMethod;
        return value === 'merge' || value === 'rebase' ? value : 'squash';
    }
    parseToken(value) {
        try {
            const parsed = JSON.parse(value);
            if (typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string'
                && typeof parsed.accessExpiresAt === 'number' && typeof parsed.refreshExpiresAt === 'number' && typeof parsed.tokenType === 'string')
                return parsed;
        }
        catch { /* reconnect below */ }
        throw new GitHubPluginError('token_corrupt', 409, 'The encrypted GitHub connection is invalid. Reconnect GitHub.');
    }
    async withToken(userId, operation) {
        const bag = this.secrets(userId);
        const account = this.store.account(userId);
        if (!account)
            throw new GitHubPluginError('not_connected', 409, 'Connect GitHub first.');
        if (account.status === 'reconnect_required')
            throw new GitHubPluginError('reconnect_required', 409, 'Reconnect GitHub before continuing.');
        const secret = bag.get(TOKEN_KEY);
        if (!secret) {
            this.store.markReconnect(userId, 'token_missing', this.now());
            throw new GitHubPluginError('reconnect_required', 409, 'Reconnect GitHub before continuing.');
        }
        let token = this.parseToken(secret.value);
        if (token.refreshExpiresAt <= this.now()) {
            this.store.markReconnect(userId, 'refresh_expired', this.now());
            throw new GitHubPluginError('reconnect_required', 409, 'The GitHub refresh token expired. Reconnect GitHub.');
        }
        if (token.accessExpiresAt <= this.now() + REFRESH_SKEW)
            token = await this.refresh(userId);
        try {
            return await operation(token.accessToken);
        }
        catch (error) {
            if (!(error instanceof GitHubHttpError) || error.responseStatus !== 401)
                throw error;
            const refreshed = await this.refresh(userId, true);
            return operation(refreshed.accessToken);
        }
    }
    async refresh(userId, force = false) {
        const previous = mutexes.get(userId) ?? Promise.resolve();
        let unlock;
        const current = new Promise((resolvePromise) => { unlock = resolvePromise; });
        const queued = previous.then(() => current);
        mutexes.set(userId, queued);
        await previous;
        try {
            const bag = this.secrets(userId);
            const currentSecret = bag.get(TOKEN_KEY);
            if (!currentSecret)
                throw new GitHubPluginError('reconnect_required', 409, 'Reconnect GitHub before continuing.');
            const currentToken = this.parseToken(currentSecret.value);
            if (!force && currentToken.accessExpiresAt > this.now() + REFRESH_SKEW)
                return currentToken;
            const owner = `${process.pid}:${randomUUID()}`;
            let acquired = this.store.acquireRefreshLease(userId, owner, this.now(), 15_000);
            for (let attempt = 0; !acquired && attempt < 150; attempt += 1) {
                await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
                const latest = bag.get(TOKEN_KEY);
                if (latest && latest.version !== currentSecret.version)
                    return this.parseToken(latest.value);
                acquired = this.store.acquireRefreshLease(userId, owner, this.now(), 15_000);
            }
            if (!acquired)
                throw new GitHubPluginError('refresh_busy', 503, 'Another process is refreshing GitHub credentials. Retry shortly.');
            try {
                const latest = bag.get(TOKEN_KEY);
                if (!latest)
                    throw new GitHubPluginError('reconnect_required', 409, 'Reconnect GitHub before continuing.');
                const token = this.parseToken(latest.value);
                if (!force && token.accessExpiresAt > this.now() + REFRESH_SKEW)
                    return token;
                const setup = requireAppSetup(this.ctx);
                let refreshed;
                try {
                    refreshed = await this.client.refreshToken({ clientId: setup.clientId, clientSecret: setup.clientSecret, refreshToken: token.refreshToken }, this.now());
                }
                catch (error) {
                    this.store.markReconnect(userId, 'refresh_failed', this.now());
                    throw new GitHubPluginError('reconnect_required', 409, 'GitHub credentials could not be refreshed. Reconnect GitHub.');
                }
                bag.set(TOKEN_KEY, JSON.stringify(refreshed), latest.version);
                const account = this.store.account(userId);
                if (account)
                    this.store.saveAccount({ ...account, tokenExpiresAt: refreshed.accessExpiresAt, refreshExpiresAt: refreshed.refreshExpiresAt, status: 'connected', lastError: null, updatedAt: this.now() });
                return refreshed;
            }
            finally {
                this.store.releaseRefreshLease(userId, owner);
            }
        }
        finally {
            unlock();
            if (mutexes.get(userId) === queued)
                mutexes.delete(userId);
        }
    }
}
function normalizeBase(base, mapping, fallback) {
    const value = base.trim();
    if (!value)
        return fallback;
    for (const prefix of [mapping.baseRemote, mapping.pushRemote, 'origin', 'upstream']) {
        if (prefix && value.startsWith(`${prefix}/`))
            return value.slice(prefix.length + 1);
    }
    return value.replace(/^refs\/heads\//, '');
}
function latestReviewDecision(reviews) {
    const latest = new Map();
    for (const review of reviews)
        latest.set(review.user, review.state.toUpperCase());
    if ([...latest.values()].includes('CHANGES_REQUESTED'))
        return 'changes_requested';
    if ([...latest.values()].includes('APPROVED'))
        return 'approved';
    return 'review_required';
}
function assertActionBound(action, target) {
    const mismatch = () => { throw new GitHubPluginError('confirmation_mismatch', 403, 'The confirmed action does not match its server preview.'); };
    if ('projectId' in action && action.projectId !== target.projectId)
        mismatch();
    if (action.type === 'publish' && action.sessionId !== target.sessionId)
        mismatch();
    if (action.type === 'create_pr' && (action.sessionId !== target.sessionId || action.title !== target.title || (action.body ?? '') !== target.body || normalizeBaseInput(action.base) !== target.requestedBase))
        mismatch();
    if (action.type === 'review' && (action.number !== target.number || action.event !== target.event || (action.body ?? '') !== target.body))
        mismatch();
    if (action.type === 'merge' && (action.number !== target.number || action.expectedHeadSha !== target.expectedHeadSha || (action.method ?? target.method) !== target.method))
        mismatch();
}
function normalizeBaseInput(value) { return typeof value === 'string' ? value.trim() : ''; }
function stale() { return new GitHubPluginError('state_changed', 409, 'The repository or pull request changed. Preview the action again.'); }
