import { GitHubPluginError } from './errors.js';
import type { CombinedChecks, GitHubRepository, PullRequestDetails, PullRequestSummary } from './types.js';

export interface GitHubClientOptions {
  fetch: typeof globalThis.fetch;
  apiBase?: string;
}

interface GitHubResponseError { message?: string; documentation_url?: string }
interface RawRepository {
  id: number; name: string; full_name: string; html_url: string; default_branch: string; private: boolean;
  owner: { login: string }; permissions?: { pull?: boolean; push?: boolean; maintain?: boolean; admin?: boolean };
  allow_merge_commit?: boolean; allow_squash_merge?: boolean; allow_rebase_merge?: boolean;
}
interface RawPull {
  number: number; title: string; state: 'open' | 'closed'; draft?: boolean; html_url: string; body?: string | null;
  user: { login: string }; head: { ref: string; sha: string; repo?: { owner?: { login?: string } } | null };
  base: { ref: string }; updated_at: string; mergeable?: boolean | null; mergeable_state?: string;
  additions?: number; deletions?: number; changed_files?: number; merged?: boolean;
}

export class GitHubHttpError extends GitHubPluginError {
  constructor(readonly responseStatus: number, message: string, readonly responseBody?: unknown) {
    super(responseStatus === 401 ? 'github_unauthorized' : responseStatus === 403 ? 'github_forbidden' : 'github_request_failed', responseStatus, message);
  }
}

export class GitHubClient {
  private readonly apiBase: string;
  constructor(private readonly options: GitHubClientOptions) {
    this.apiBase = (options.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
  }

  async request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
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
      const message = value && typeof value === 'object' && typeof (value as GitHubResponseError).message === 'string'
        ? (value as GitHubResponseError).message! : `GitHub request failed with HTTP ${response.status}.`;
      throw new GitHubHttpError(response.status, message, value);
    }
    return value as T;
  }

  user(token: string): Promise<{ id: number; login: string; name: string | null; avatar_url: string | null }> { return this.request(token, '/user'); }
  rateLimit(token: string): Promise<{ resources?: { core?: { limit: number; remaining: number; reset: number } } }> { return this.request(token, '/rate_limit'); }

  async repository(token: string, owner: string, name: string): Promise<GitHubRepository> {
    const repo = await this.request<RawRepository>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
    return {
      id: repo.id, owner: repo.owner.login, name: repo.name, fullName: repo.full_name, htmlUrl: repo.html_url,
      defaultBranch: repo.default_branch, private: repo.private,
      permissions: { pull: !!repo.permissions?.pull, push: !!repo.permissions?.push, maintain: !!repo.permissions?.maintain, admin: !!repo.permissions?.admin },
      allowMergeCommit: repo.allow_merge_commit !== false, allowSquashMerge: repo.allow_squash_merge !== false, allowRebaseMerge: repo.allow_rebase_merge !== false,
    };
  }

  async listPullRequests(token: string, owner: string, name: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<PullRequestSummary[]> {
    const pulls: RawPull[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const batch = await this.request<RawPull[]>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?state=${state}&per_page=100&page=${page}`);
      pulls.push(...batch);
      if (batch.length < 100) break;
    }
    return pulls.map((pull) => this.pullSummary(pull));
  }

  async findOpenPullRequest(token: string, owner: string, name: string, headOwner: string, head: string, base: string): Promise<PullRequestSummary | null> {
    const query = new URLSearchParams({ state: 'open', head: `${headOwner}:${head}`, base, per_page: '10' });
    const pulls = await this.request<RawPull[]>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?${query}`);
    return pulls[0] ? this.pullSummary(pulls[0]) : null;
  }

  async pullRequest(token: string, owner: string, name: string, number: number): Promise<PullRequestDetails> {
    const pull = await this.request<RawPull>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}`);
    const [files, reviews] = await Promise.all([
      this.request<{ filename: string; status: string; additions: number; deletions: number; patch?: string }[]>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/files?per_page=100`),
      this.request<{ id: number; user: { login: string }; state: string; body?: string; submitted_at?: string }[]>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/reviews?per_page=100`),
    ]);
    return {
      ...this.pullSummary(pull), body: pull.body ?? '', additions: pull.additions ?? 0, deletions: pull.deletions ?? 0,
      changedFiles: pull.changed_files ?? files.length, merged: !!pull.merged,
      files: files.map((file) => ({ path: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, patch: file.patch ?? null })),
      reviews: reviews.map((review) => ({ id: review.id, user: review.user.login, state: review.state, body: review.body ?? '', submittedAt: review.submitted_at ?? null })),
    };
  }

  async createPullRequest(token: string, owner: string, name: string, input: { title: string; body: string; head: string; base: string }): Promise<PullRequestSummary> {
    const pull = await this.request<RawPull>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`, { method: 'POST', body: JSON.stringify(input) });
    return this.pullSummary(pull);
  }

  async reviews(token: string, owner: string, name: string, number: number): Promise<{ id: number; user: string; state: string; body: string; submittedAt: string | null }[]> {
    const reviews = await this.request<{ id: number; user: { login: string }; state: string; body?: string; submitted_at?: string }[]>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/reviews?per_page=100`);
    return reviews.map((review) => ({ id: review.id, user: review.user.login, state: review.state, body: review.body ?? '', submittedAt: review.submitted_at ?? null }));
  }

  async submitReview(token: string, owner: string, name: string, number: number, input: { event: string; body: string }): Promise<{ id: number; state: string }> {
    return this.request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/reviews`, { method: 'POST', body: JSON.stringify(input) });
  }

  async mergePullRequest(token: string, owner: string, name: string, number: number, input: { sha: string; merge_method: string }): Promise<{ merged: boolean; message: string; sha?: string }> {
    return this.request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/merge`, { method: 'PUT', body: JSON.stringify(input) });
  }

  async checks(token: string, owner: string, name: string, sha: string): Promise<CombinedChecks> {
    const [runs, statuses] = await Promise.all([
      this.request<{ check_runs: { name: string; status: string; conclusion: string | null; details_url?: string; html_url?: string }[] }>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${sha}/check-runs?per_page=100`),
      this.request<{ statuses: { context: string; state: string; description?: string; target_url?: string }[] }>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${sha}/status?per_page=100`),
    ]);
    const items: CombinedChecks['items'] = [
      ...runs.check_runs.map((run) => ({
        name: run.name, state: run.status !== 'completed' ? 'pending' as const : checkConclusion(run.conclusion), description: run.conclusion,
        targetUrl: run.details_url ?? run.html_url ?? null,
      })),
      ...statuses.statuses.map((status) => ({
        name: status.context, state: status.state === 'success' ? 'success' as const : status.state === 'pending' ? 'pending' as const : status.state === 'error' ? 'action_required' as const : 'failure' as const,
        description: status.description ?? null, targetUrl: status.target_url ?? null,
      })),
    ];
    const state = items.some((item) => item.state === 'failure') ? 'failure'
      : items.some((item) => item.state === 'action_required') ? 'action_required'
        : items.some((item) => item.state === 'pending') || items.length === 0 ? 'pending' : 'success';
    return { state, items };
  }

  private pullSummary(pull: RawPull): PullRequestSummary {
    return {
      number: pull.number, title: pull.title, state: pull.state, draft: !!pull.draft, htmlUrl: pull.html_url,
      author: pull.user.login, headRef: pull.head.ref, headSha: pull.head.sha, headOwner: pull.head.repo?.owner?.login ?? '',
      baseRef: pull.base.ref, updatedAt: pull.updated_at, mergeable: pull.mergeable ?? null, mergeableState: pull.mergeable_state ?? null,
      reviewDecision: null,
    };
  }
}

function checkConclusion(value: string | null): CombinedChecks['state'] {
  if (value === 'success' || value === 'neutral' || value === 'skipped') return 'success';
  if (value === 'action_required' || value === 'stale') return 'action_required';
  if (value === null) return 'pending';
  return 'failure';
}
