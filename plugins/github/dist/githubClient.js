import { GitHubPluginError } from './errors.js';
export class GitHubHttpError extends GitHubPluginError {
    responseStatus;
    responseBody;
    constructor(responseStatus, message, responseBody) {
        super(responseStatus === 401 ? 'github_unauthorized' : responseStatus === 403 ? 'github_forbidden' : 'github_request_failed', responseStatus, message);
        this.responseStatus = responseStatus;
        this.responseBody = responseBody;
    }
}
export class GitHubClient {
    options;
    apiBase;
    oauthBase;
    constructor(options) {
        this.options = options;
        this.apiBase = (options.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
        this.oauthBase = (options.oauthBase ?? 'https://github.com').replace(/\/$/, '');
    }
    authorizationUrl(input) {
        const url = new URL(`${this.oauthBase}/login/oauth/authorize`);
        url.searchParams.set('client_id', input.clientId);
        url.searchParams.set('redirect_uri', input.redirectUri);
        url.searchParams.set('state', input.state);
        url.searchParams.set('code_challenge', input.challenge);
        url.searchParams.set('code_challenge_method', 'S256');
        return url.toString();
    }
    async exchangeCode(input, now) {
        return this.tokenExchange({
            client_id: input.clientId, client_secret: input.clientSecret, code: input.code,
            redirect_uri: input.redirectUri, code_verifier: input.verifier,
        }, now);
    }
    async refreshToken(input, now) {
        return this.tokenExchange({
            client_id: input.clientId, client_secret: input.clientSecret,
            grant_type: 'refresh_token', refresh_token: input.refreshToken,
        }, now);
    }
    async tokenExchange(body, now) {
        const response = await this.options.fetch(`${this.oauthBase}/login/oauth/access_token`, {
            method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
        });
        const value = await response.json().catch(() => ({}));
        if (!response.ok || typeof value.access_token !== 'string') {
            throw new GitHubPluginError('oauth_exchange_failed', 502, 'GitHub rejected the OAuth token exchange.');
        }
        const expiresIn = Number(value.expires_in);
        const refreshExpiresIn = Number(value.refresh_token_expires_in);
        if (!Number.isFinite(expiresIn) || expiresIn <= 0 || typeof value.refresh_token !== 'string' || !Number.isFinite(refreshExpiresIn) || refreshExpiresIn <= 0) {
            throw new GitHubPluginError('expiring_tokens_required', 503, 'The GitHub App must enable expiring user-to-server tokens.');
        }
        return {
            accessToken: value.access_token, refreshToken: value.refresh_token, tokenType: typeof value.token_type === 'string' ? value.token_type : 'bearer',
            accessExpiresAt: now + expiresIn * 1_000, refreshExpiresAt: now + refreshExpiresIn * 1_000,
        };
    }
    async request(token, path, init = {}) {
        const response = await this.options.fetch(`${this.apiBase}${path}`, {
            ...init,
            signal: init.signal ?? AbortSignal.timeout(30_000),
            headers: {
                accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28',
                ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}),
            },
        });
        const value = response.status === 204 ? null : await response.json().catch(() => null);
        if (!response.ok) {
            const message = value && typeof value === 'object' && typeof value.message === 'string'
                ? value.message : `GitHub request failed with HTTP ${response.status}.`;
            throw new GitHubHttpError(response.status, message, value);
        }
        return value;
    }
    user(token) { return this.request(token, '/user'); }
    rateLimit(token) { return this.request(token, '/rate_limit'); }
    async repository(token, owner, name) {
        const repo = await this.request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
        return {
            id: repo.id, owner: repo.owner.login, name: repo.name, fullName: repo.full_name, htmlUrl: repo.html_url,
            defaultBranch: repo.default_branch, private: repo.private,
            permissions: { pull: !!repo.permissions?.pull, push: !!repo.permissions?.push, maintain: !!repo.permissions?.maintain, admin: !!repo.permissions?.admin },
            allowMergeCommit: repo.allow_merge_commit !== false, allowSquashMerge: repo.allow_squash_merge !== false, allowRebaseMerge: repo.allow_rebase_merge !== false,
        };
    }
    async listPullRequests(token, owner, name, state = 'open') {
        const pulls = [];
        for (let page = 1; page <= 10; page += 1) {
            const batch = await this.request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?state=${state}&per_page=100&page=${page}`);
            pulls.push(...batch);
            if (batch.length < 100)
                break;
        }
        return pulls.map((pull) => this.pullSummary(pull));
    }
    async findOpenPullRequest(token, owner, name, headOwner, head, base) {
        const query = new URLSearchParams({ state: 'open', head: `${headOwner}:${head}`, base, per_page: '10' });
        const pulls = await this.request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?${query}`);
        return pulls[0] ? this.pullSummary(pulls[0]) : null;
    }
    async pullRequest(token, owner, name, number) {
        const pull = await this.request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}`);
        const [files, reviews] = await Promise.all([
            this.request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/files?per_page=100`),
            this.request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/reviews?per_page=100`),
        ]);
        return {
            ...this.pullSummary(pull), body: pull.body ?? '', additions: pull.additions ?? 0, deletions: pull.deletions ?? 0,
            changedFiles: pull.changed_files ?? files.length, merged: !!pull.merged,
            files: files.map((file) => ({ path: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, patch: file.patch ?? null })),
            reviews: reviews.map((review) => ({ id: review.id, user: review.user.login, state: review.state, body: review.body ?? '', submittedAt: review.submitted_at ?? null })),
        };
    }
    async createPullRequest(token, owner, name, input) {
        const pull = await this.request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`, { method: 'POST', body: JSON.stringify(input) });
        return this.pullSummary(pull);
    }
    async reviews(token, owner, name, number) {
        const reviews = await this.request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/reviews?per_page=100`);
        return reviews.map((review) => ({ id: review.id, user: review.user.login, state: review.state, body: review.body ?? '', submittedAt: review.submitted_at ?? null }));
    }
    async submitReview(token, owner, name, number, input) {
        return this.request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/reviews`, { method: 'POST', body: JSON.stringify(input) });
    }
    async mergePullRequest(token, owner, name, number, input) {
        return this.request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/merge`, { method: 'PUT', body: JSON.stringify(input) });
    }
    async checks(token, owner, name, sha) {
        const [runs, statuses] = await Promise.all([
            this.request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${sha}/check-runs?per_page=100`),
            this.request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${sha}/status?per_page=100`),
        ]);
        const items = [
            ...runs.check_runs.map((run) => ({
                name: run.name, state: run.status !== 'completed' ? 'pending' : checkConclusion(run.conclusion), description: run.conclusion,
                targetUrl: run.details_url ?? run.html_url ?? null,
            })),
            ...statuses.statuses.map((status) => ({
                name: status.context, state: status.state === 'success' ? 'success' : status.state === 'pending' ? 'pending' : status.state === 'error' ? 'action_required' : 'failure',
                description: status.description ?? null, targetUrl: status.target_url ?? null,
            })),
        ];
        const state = items.some((item) => item.state === 'failure') ? 'failure'
            : items.some((item) => item.state === 'action_required') ? 'action_required'
                : items.some((item) => item.state === 'pending') || items.length === 0 ? 'pending' : 'success';
        return { state, items };
    }
    pullSummary(pull) {
        return {
            number: pull.number, title: pull.title, state: pull.state, draft: !!pull.draft, htmlUrl: pull.html_url,
            author: pull.user.login, headRef: pull.head.ref, headSha: pull.head.sha, headOwner: pull.head.repo?.owner?.login ?? '',
            baseRef: pull.base.ref, updatedAt: pull.updated_at, mergeable: pull.mergeable ?? null, mergeableState: pull.mergeable_state ?? null,
            reviewDecision: null,
        };
    }
}
function checkConclusion(value) {
    if (value === 'success' || value === 'neutral' || value === 'skipped')
        return 'success';
    if (value === 'action_required' || value === 'stale')
        return 'action_required';
    if (value === null)
        return 'pending';
    return 'failure';
}
