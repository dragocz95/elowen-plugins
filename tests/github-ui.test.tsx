import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse, listen, use, setDefaults, resetHandlers, close } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { ToastProvider, createWrapper } from './ui/hostHooks';
import { GitHubAccountPanel } from '../plugins/github/web-src/GitHubAccountPanel';
import { GitHubPage } from '../plugins/github/web-src/GitHubPage';
import manifest from '../plugins/github/elowen-plugin.json' with { type: 'json' };

ensurePluginUiRuntime();
const strings = manifest.web.strings;
setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'github', url: '/plugins/github/web/index.js', apiVersion: 3, nav: [], settings: [], strings }])),
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'user', is_admin: false } })),
);
beforeAll(() => listen()); afterEach(() => { cleanup(); resetHandlers(); }); afterAll(() => close());

function mount() {
  const { wrapper: Wrapper } = createWrapper();
  return render(<Wrapper><ToastProvider><GitHubPage /></ToastProvider></Wrapper>);
}

function mountAccount() {
  const { wrapper: Wrapper } = createWrapper();
  return render(<Wrapper><ToastProvider><GitHubAccountPanel plugin="github" params={{ id: 'connection' }} rest={[]} surface="deck" /></ToastProvider></Wrapper>);
}

const disconnected = { setup: { configured: true, clientIdSet: true, appSlug: 'app', clientSecretSet: true, callbackUrl: 'https://elowen.example/api/plugins/github/api/auth/callback' }, connected: false, reconnectRequired: false, account: null, mappings: 0 };
const connected = { ...disconnected, connected: true, account: { userId: 1, githubUserId: 42, login: 'octocat', name: 'Octo Cat', avatarUrl: null, tokenExpiresAt: Date.now() + 100_000, refreshExpiresAt: Date.now() + 200_000, status: 'connected', lastError: null } };

describe('GitHub plugin UI', () => {
  it('offers the same personal OAuth connection from Account with GitHub branding', async () => {
    use(http.get('/api/plugins/github/api/status', () => HttpResponse.json(disconnected)));
    mountAccount();

    expect(await screen.findByText(strings.accountTitle)).toBeInTheDocument();
    expect(screen.getByText(strings.accountHint)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.connect })).toBeEnabled();
  });

  it('does not request repositories, pull requests or sessions while disconnected', async () => {
    let forbiddenFetches = 0;
    use(
      http.get('/api/plugins/github/api/status', () => HttpResponse.json(disconnected)),
      http.get('/api/plugins/github/api/repositories', () => { forbiddenFetches += 1; return HttpResponse.json({ repositories: [] }); }),
      http.get('/api/plugins/github/api/pull-requests', () => { forbiddenFetches += 1; return HttpResponse.json({ pullRequests: [] }); }),
      http.get('/api/brain/sessions', () => { forbiddenFetches += 1; return HttpResponse.json([]); }),
    );
    mount();
    expect(await screen.findByText(strings.disconnected)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: strings.tabRepositories }));
    expect(await screen.findByText(strings.disconnected)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: strings.tabPullRequests }));
    expect(await screen.findByText(strings.disconnected)).toBeInTheDocument();
    expect(forbiddenFetches).toBe(0);
  });

  it('renders the error branch instead of a loading skeleton and retries', async () => {
    let calls = 0;
    use(http.get('/api/plugins/github/api/status', () => { calls += 1; return calls === 1 ? HttpResponse.json({ error: 'down' }, { status: 500 }) : HttpResponse.json(disconnected); }));
    mount();
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
      http.get('/api/plugins/github/api/repositories', () => HttpResponse.json({ repositories: [{
        project: { id: 1, slug: 'project' },
        mapping: { projectId: 1, baseOwner: 'base', baseName: 'repo', pushOwner: 'fork', pushName: 'repo', verifiedAt: 1, active: true },
        remotes: [], detected: { ambiguous: false, base: null, push: null },
      }] })),
      http.get('/api/brain/sessions', () => HttpResponse.json([{ id: 'brain-1', title: 'Feature', updated_at: new Date().toISOString() }])),
      http.get('/api/plugins/github/api/pull-requests', () => HttpResponse.json({ pullRequests: [pull] })),
      http.get('/api/plugins/github/api/pull-request', () => { detailCalls += 1; return HttpResponse.json(pull); }),
      http.get('/api/plugins/github/api/checks', () => { checksCalls += 1; return HttpResponse.json({ state: 'success', items: [] }); }),
      http.post('/api/plugins/github/api/actions/preview', () => HttpResponse.json({
        action: { type: 'merge' }, title: 'Merge pull request', description: 'Merge now.', confirmationToken: 'once', expiresAt: Date.now() + 60_000,
      })),
      http.post('/api/plugins/github/api/actions/confirm', () => HttpResponse.json({ error: 'head_changed' }, { status: 409 })),
    );
    mount();
    fireEvent.click(await screen.findByRole('radio', { name: strings.tabPullRequests }));
    fireEvent.click(await screen.findByText('#7 Feature'));
    await screen.findByText('Body');
    await waitFor(() => expect(screen.getByRole('button', { name: strings.merge })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: strings.merge }));
    await screen.findByRole('heading', { name: 'Merge pull request' });
    fireEvent.click(screen.getByRole('button', { name: strings.confirm }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Merge pull request' })).not.toBeInTheDocument());
    await waitFor(() => { expect(detailCalls).toBeGreaterThan(1); expect(checksCalls).toBeGreaterThan(1); });
  });

  it('opens repository mapping from the keyboard register', async () => {
    use(
      http.get('/api/plugins/github/api/status', () => HttpResponse.json(connected)),
      http.get('/api/plugins/github/api/repositories', () => HttpResponse.json({ repositories: [{ project: { id: 1, slug: 'project' }, mapping: null, remotes: [{ name: 'origin', fetchUrl: 'git@github.com:base/repo.git', pushUrl: 'https://github.com/fork/repo.git' }], detected: { ambiguous: false, base: { owner: 'base', name: 'repo', remote: 'origin' }, push: { owner: 'fork', name: 'repo', remote: 'origin' } } }] })),
      http.get('/api/brain/sessions', () => HttpResponse.json([])),
    );
    mount();
    fireEvent.click(await screen.findByRole('radio', { name: strings.tabRepositories }));
    const row = await screen.findByText('project');
    fireEvent.keyDown(row.closest('[tabindex="0"]')!, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(strings.map));
    expect(screen.getByDisplayValue('base')).toBeInTheDocument();
    expect(screen.getByDisplayValue('fork')).toBeInTheDocument();
  });
});
