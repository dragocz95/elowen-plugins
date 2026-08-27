import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse, listen, use, setDefaults, resetHandlers, close } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { ToastProvider, createWrapper } from './ui/hostHooks';
import { GitHubAccountPanel } from '../plugins/github/web-src/GitHubAccountPanel';
import { GitHubProjectPanel } from '../plugins/github/web-src/GitHubProjectPanel';
import manifest from '../plugins/github/elowen-plugin.json' with { type: 'json' };

ensurePluginUiRuntime();
const strings = manifest.web.strings;
setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'github', url: '/plugins/github/web/index.js', apiVersion: 4, nav: [], account: manifest.web.account, project: manifest.web.project, settings: [], strings }])),
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'user', is_admin: false } })),
);
beforeAll(() => listen()); afterEach(() => { cleanup(); resetHandlers(); }); afterAll(() => close());

const project = { id: 1, slug: 'project', path: '/srv/project' };
function mountProject() {
  const { wrapper: Wrapper } = createWrapper();
  return render(<Wrapper><ToastProvider><GitHubProjectPanel project={project} /></ToastProvider></Wrapper>);
}
function mountAccount() {
  const { wrapper: Wrapper } = createWrapper();
  return render(<Wrapper><ToastProvider><GitHubAccountPanel plugin="github" params={{ id: 'connection' }} rest={[]} surface="deck" /></ToastProvider></Wrapper>);
}

const disconnected = { connected: false, reconnectRequired: false, account: null, mappings: 0 };
const connected = { ...disconnected, connected: true, account: { userId: 1, githubUserId: 42, login: 'octocat', name: 'Octo Cat', avatarUrl: null, status: 'connected', lastError: null } };
const mappedRepository = {
  project: { id: 1, slug: 'project' },
  mapping: { projectId: 1, baseOwner: 'base', baseName: 'repo', pushOwner: 'fork', pushName: 'repo', verifiedAt: 1, active: true },
  remotes: [], detected: { ambiguous: false, base: null, push: null },
};

describe('GitHub plugin UI', () => {
  it('offers personal device auth without requesting removed App setup APIs', async () => {
    let setupRequests = 0;
    use(
      http.get('/api/plugins/github/api/status', () => HttpResponse.json(disconnected)),
      http.get('/api/plugins/github/api/setup', () => { setupRequests += 1; return HttpResponse.json({}); }),
      http.post('/api/plugins/github/api/setup/secret', () => { setupRequests += 1; return HttpResponse.json({}); }),
    );
    mountAccount();
    // GitHub is one row of the Linked accounts drawer now, so an unlinked account reads like an unfilled
    // Discord id: the platform's name, the reason to fill it, and the action. Its own empty state is
    // gone — a panel-sized "Not connected" card was exactly what made this the odd row out, and a row
    // holding nothing but a Connect action already says as much.
    expect(await screen.findByText(strings.title)).toBeInTheDocument();
    expect(screen.getByText(strings.intro)).toBeInTheDocument();
    expect(screen.queryByText(strings.accountTitle)).toBeNull();
    expect(screen.getByRole('button', { name: strings.connect })).toBeEnabled();
    expect(setupRequests).toBe(0);
  });

  it('starts, polls and completes the GitHub device flow', async () => {
    let polls = 0;
    use(
      http.get('/api/plugins/github/api/status', () => HttpResponse.json(disconnected)),
      http.post('/api/plugins/github/api/auth/start', () => HttpResponse.json({ flowId: 'gh-test', verificationUrl: 'https://github.com/login/device', userCode: 'ABCD-EFGH', expiresAt: Date.now() + 60_000 })),
      http.get('/api/plugins/github/api/auth/status', () => { polls += 1; return HttpResponse.json({ flowId: 'gh-test', status: polls > 1 ? 'connected' : 'pending' }); }),
    );
    mountAccount();
    fireEvent.click(await screen.findByRole('button', { name: strings.connect }));
    expect(await screen.findByText('ABCD-EFGH')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: strings.verifyOnGitHub })).toHaveAttribute('href', 'https://github.com/login/device');
    await waitFor(() => expect(polls).toBeGreaterThan(1), { timeout: 5_000 });
    await waitFor(() => expect(screen.queryByText('ABCD-EFGH')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: strings.connect })).toBeEnabled();
  });

  it('clears expired replacement flows and returns to the connected account state', async () => {
    let statusCalls = 0;
    use(
      http.get('/api/plugins/github/api/status', () => {
        statusCalls += 1;
        return HttpResponse.json({ ...connected, flow: statusCalls === 1 ? { flowId: 'gh-replace', userId: 1, verificationUrl: 'https://github.com/login/device', userCode: 'WXYZ-1234', replaceIdentity: true, expiresAt: Date.now() + 60_000, status: 'pending', error: null, createdAt: 1, updatedAt: 1 } : null });
      }),
      http.get('/api/plugins/github/api/auth/status', () => HttpResponse.json({ flowId: 'gh-replace', status: 'expired' })),
    );
    mountAccount();
    expect(await screen.findByText('WXYZ-1234')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('WXYZ-1234')).not.toBeInTheDocument(), { timeout: 5_000 });
    expect(await screen.findByText('@octocat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.replaceIdentity })).toBeEnabled();
  });

  it('clears a pruned flow when polling returns an error', async () => {
    let statusCalls = 0;
    use(
      http.get('/api/plugins/github/api/status', () => {
        statusCalls += 1;
        return HttpResponse.json({ ...disconnected, flow: statusCalls === 1 ? { flowId: 'gh-pruned', userId: 1, verificationUrl: 'https://github.com/login/device', userCode: 'PRUN-ED12', replaceIdentity: false, expiresAt: Date.now() + 60_000, status: 'pending', error: null, createdAt: 1, updatedAt: 1 } : null });
      }),
      http.get('/api/plugins/github/api/auth/status', () => HttpResponse.json({ error: 'flow_not_found' }, { status: 404 })),
    );
    mountAccount();
    expect(await screen.findByText('PRUN-ED12')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('PRUN-ED12')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: strings.connect })).toBeEnabled();
  });

  it('keeps the device challenge visible across transient polling failures', async () => {
    let polls = 0;
    use(
      http.get('/api/plugins/github/api/status', () => HttpResponse.json({ ...disconnected, flow: { flowId: 'gh-transient', userId: 1, verificationUrl: 'https://github.com/login/device', userCode: 'KEEP-ME12', replaceIdentity: false, expiresAt: Date.now() + 60_000, status: 'pending', error: null, createdAt: 1, updatedAt: 1 } })),
      http.get('/api/plugins/github/api/auth/status', () => { polls += 1; return HttpResponse.json({ error: 'github_unavailable' }, { status: 502 }); }),
    );
    mountAccount();
    expect(await screen.findByText('KEEP-ME12')).toBeInTheDocument();
    await waitFor(() => expect(polls).toBeGreaterThan(0));
    expect(screen.getByText('KEEP-ME12')).toBeInTheDocument();
  });

  it('keeps repository and session requests off while disconnected', async () => {
    let forbiddenFetches = 0;
    use(
      http.get('/api/plugins/github/api/status', () => HttpResponse.json(disconnected)),
      http.get('/api/plugins/github', () => { forbiddenFetches += 1; return HttpResponse.json({}); }),
      http.get('/api/plugins/github/api/repositories', () => { forbiddenFetches += 1; return HttpResponse.json({ repositories: [] }); }),
      http.get('/api/brain/sessions', () => { forbiddenFetches += 1; return HttpResponse.json([]); }),
    );
    mountProject();
    expect(await screen.findByText(strings.disconnected)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.manageInAccount })).toBeEnabled();
    expect(forbiddenFetches).toBe(0);
  });

  it('renders the status error branch and retries', async () => {
    let calls = 0;
    use(http.get('/api/plugins/github/api/status', () => { calls += 1; return calls === 1 ? HttpResponse.json({ error: 'down' }, { status: 500 }) : HttpResponse.json(disconnected); }));
    mountProject();
    expect(await screen.findByText(strings.loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText(strings.disconnected)).toBeInTheDocument();
  });

  it('closes a consumed confirmation and refreshes PR state after a stale 409', async () => {
    let detailCalls = 0;
    let checksCalls = 0;
    const pull = {
      number: 7, title: 'Feature', state: 'open', draft: false, htmlUrl: 'https://github.com/base/repo/pull/7',
      author: 'octocat', headRef: 'feature', headSha: 'a'.repeat(40), baseRef: 'main', updatedAt: new Date().toISOString(),
      mergeable: true, mergeableState: 'clean', body: 'Body', files: [], reviews: [],
    };
    use(
      http.get('/api/plugins/github/api/status', () => HttpResponse.json(connected)),
      http.get('/api/plugins/github/api/repositories', () => HttpResponse.json({ repositories: [mappedRepository] })),
      http.get('/api/brain/sessions', () => HttpResponse.json([{ id: 'brain-1', title: 'Feature', updated_at: new Date().toISOString() }])),
      http.get('/api/plugins/github/api/pull-requests', () => HttpResponse.json({ pullRequests: [pull] })),
      http.get('/api/plugins/github/api/pull-request', () => { detailCalls += 1; return HttpResponse.json(pull); }),
      http.get('/api/plugins/github/api/checks', () => { checksCalls += 1; return HttpResponse.json({ state: 'success', items: [] }); }),
      http.post('/api/plugins/github/api/actions/preview', () => HttpResponse.json({ action: { type: 'merge' }, title: 'Merge pull request', description: 'Merge now.', confirmationToken: 'once', expiresAt: Date.now() + 60_000 })),
      http.post('/api/plugins/github/api/actions/confirm', () => HttpResponse.json({ error: 'head_changed' }, { status: 409 })),
    );
    mountProject();
    // A register row opens through the host's stretched open button, not through its text: one tab
    // stop with a short accessible name, instead of the whole row's content being read out.
    fireEvent.click(await screen.findByRole('button', { name: `${strings.openPullRequest} #7` }));
    await screen.findByText('Body');
    await waitFor(() => expect(screen.getByRole('button', { name: strings.merge })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: strings.merge }));
    await screen.findByRole('heading', { name: 'Merge pull request' });
    fireEvent.click(screen.getByRole('button', { name: strings.confirm }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Merge pull request' })).not.toBeInTheDocument());
    await waitFor(() => { expect(detailCalls).toBeGreaterThan(1); expect(checksCalls).toBeGreaterThan(1); });
  });

  it('opens repository mapping in the selected Project', async () => {
    use(
      http.get('/api/plugins/github/api/status', () => HttpResponse.json(connected)),
      http.get('/api/plugins/github/api/repositories', () => HttpResponse.json({ repositories: [{ project: { id: 1, slug: 'project' }, mapping: null, remotes: [{ name: 'origin', fetchUrl: 'git@github.com:base/repo.git', pushUrl: 'https://github.com/fork/repo.git' }], detected: { ambiguous: false, base: { owner: 'base', name: 'repo', remote: 'origin' }, push: { owner: 'fork', name: 'repo', remote: 'origin' } } }] })),
      http.get('/api/brain/sessions', () => HttpResponse.json([])),
    );
    mountProject();
    fireEvent.click((await screen.findAllByRole('button', { name: strings.map }))[0]);
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(strings.map));
    expect(screen.getByDisplayValue('base')).toBeInTheDocument();
    expect(screen.getByDisplayValue('fork')).toBeInTheDocument();
  });
});
