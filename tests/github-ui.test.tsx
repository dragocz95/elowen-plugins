import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse, listen, use, setDefaults, resetHandlers, close } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { ToastProvider, createWrapper } from './ui/hostHooks';
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

const disconnected = { setup: { configured: true, clientIdSet: true, appSlug: 'app', clientSecretSet: true, callbackUrl: 'https://elowen.example/api/plugins/github/api/auth/callback' }, connected: false, reconnectRequired: false, account: null, mappings: 0 };
const connected = { ...disconnected, connected: true, account: { userId: 1, githubUserId: 42, login: 'octocat', name: 'Octo Cat', avatarUrl: null, tokenExpiresAt: Date.now() + 100_000, refreshExpiresAt: Date.now() + 200_000, status: 'connected', lastError: null } };

describe('GitHub plugin UI', () => {
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
