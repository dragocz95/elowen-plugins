// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { spawn as nodeSpawn } from 'node:child_process';
import { DEVICE_LOGIN_ARGS, TOKEN_ARGS, GitHubAuthAdapter, createGitHubAuthEnv, parseDevicePrompt, validateDeviceToken } from '../plugins/github/src/githubAuth.js';
import type { PluginContext, PluginDb, PluginSecretBag, SandboxPreparedExecution } from 'elowen/plugin-api';
import { GitHubService } from '../plugins/github/src/service.js';
import { GitHubStore } from '../plugins/github/src/store.js';
import { parseGitHubRemote, suggestedRepositories } from '../plugins/github/src/remotes.js';
import { publishBranch, spawnPrepared, unsafeConfig, type SpawnPrepared } from '../plugins/github/src/execution.js';
import { registerGitHubApi } from '../plugins/github/src/api.js';
import { registerGitHubTools } from '../plugins/github/src/tools.js';
import manifest from '../plugins/github/elowen-plugin.json' with { type: 'json' };

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

class SecretBag implements PluginSecretBag {
  values = new Map<string, { value: string; version: number }>();
  get(key: string) { return this.values.get(key) ?? null; }
  has(key: string) { return this.values.has(key); }
  set(key: string, value: string, expectedVersion?: number) {
    const current = this.values.get(key);
    if (expectedVersion !== undefined && current?.version !== expectedVersion) throw new Error('secret CAS failed');
    const version = (current?.version ?? 0) + 1;
    this.values.set(key, { value, version });
    return version;
  }
  delete(key: string) { return this.values.delete(key); }
}

function pluginDb(): PluginDb & { raw: Database.Database } {
  const raw = new Database(':memory:');
  raw.exec('CREATE TABLE plugin_migrations(version INTEGER PRIMARY KEY)');
  const handle = {
    raw,
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => {
      const statement = raw.prepare(sql);
      return { run: (...params: unknown[]) => statement.run(...params), get: (...params: unknown[]) => statement.get(...params), all: (...params: unknown[]) => statement.all(...params) };
    },
    migrate: (steps: { version: number; up(db: PluginDb): void }[]) => {
      for (const step of steps) if (!raw.prepare('SELECT 1 FROM plugin_migrations WHERE version=?').get(step.version)) raw.transaction(() => { step.up(handle as PluginDb); raw.prepare('INSERT INTO plugin_migrations(version) VALUES (?)').run(step.version); })();
    },
    appliedVersion: () => Number((raw.prepare('SELECT max(version) version FROM plugin_migrations').get() as { version: number | null }).version ?? 0),
    transaction: <T>(fn: () => T) => raw.transaction(fn)(),
  };
  return handle as PluginDb & { raw: Database.Database };
}

interface FakeState {
  profileId: number; login: string; accessToken: string;
  pulls: any[]; headSha: string; mergeCalls: number; createCalls: number; rejectAccessOnce: boolean;
}

async function fakeGitHub(): Promise<{ server: Server; base: string; state: FakeState }> {
  const state: FakeState = { profileId: 42, login: 'octocat', accessToken: 'access-1', pulls: [], headSha: 'a'.repeat(40), mergeCalls: 0, createCalls: 0, rejectAccessOnce: false };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = body ? JSON.parse(body) as Record<string, unknown> : {};
    const send = (status: number, value: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
    const auth = req.headers.authorization;
    if (state.rejectAccessOnce && auth === `Bearer ${state.accessToken}`) { state.rejectAccessOnce = false; return send(401, { message: 'Bad credentials' }); }
    if (auth !== `Bearer ${state.accessToken}`) return send(401, { message: 'Bad credentials' });
    if (url.pathname === '/user') return send(200, { id: state.profileId, login: state.login, name: 'Octo Cat', avatar_url: 'https://avatars.example/octo' });
    if (url.pathname === '/rate_limit') return send(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 123 } } });
    if (/^\/repos\/[^/]+\/[^/]+$/.test(url.pathname)) {
      const [, , owner, name] = url.pathname.split('/');
      return send(200, { id: `${owner}/${name}`.toLowerCase().includes('fork') ? 2 : 1, name, full_name: `${owner}/${name}`, html_url: `https://github.com/${owner}/${name}`, default_branch: 'main', private: false, owner: { login: owner }, permissions: { pull: true, push: true, maintain: true, admin: false }, allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true });
    }
    const pullList = /^\/repos\/([^/]+)\/([^/]+)\/pulls$/.exec(url.pathname);
    if (pullList && req.method === 'GET') {
      const head = url.searchParams.get('head'); const base = url.searchParams.get('base');
      const pulls = state.pulls.filter((pull) => (!head || `${pull.head.repo.owner.login}:${pull.head.ref}` === head) && (!base || pull.base.ref === base));
      return send(200, pulls);
    }
    if (pullList && req.method === 'POST') {
      state.createCalls += 1;
      const pull = rawPull(7, String(json.title), String(json.head).split(':')[1]!, String(json.base), state.headSha);
      state.pulls.push(pull); return send(201, pull);
    }
    const pullDetail = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/.exec(url.pathname);
    if (pullDetail) {
      const pull = state.pulls.find((value) => value.number === Number(pullDetail[3]));
      if (!pull) return send(404, { message: 'Not Found' });
      pull.head.sha = state.headSha;
      return send(200, { ...pull, additions: 3, deletions: 1, changed_files: 1, merged: false, mergeable: true, mergeable_state: 'clean' });
    }
    if (/\/pulls\/\d+\/files$/.test(url.pathname)) return send(200, [{ filename: 'src/a.ts', status: 'modified', additions: 3, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' }]);
    if (/\/pulls\/\d+\/reviews$/.test(url.pathname) && req.method === 'GET') return send(200, [{ id: 1, user: { login: 'reviewer' }, state: 'APPROVED', body: 'Looks good', submitted_at: '2026-08-26T06:00:00Z' }]);
    if (/\/pulls\/\d+\/reviews$/.test(url.pathname) && req.method === 'POST') return send(200, { id: 2, state: json.event });
    if (/\/commits\/[a-f0-9]+\/check-runs$/.test(url.pathname)) return send(200, { check_runs: [{ name: 'CI', status: 'completed', conclusion: 'success', details_url: 'https://ci.example/run' }] });
    if (/\/commits\/[a-f0-9]+\/status$/.test(url.pathname)) return send(200, { statuses: [{ context: 'policy', state: 'success', description: 'Ready', target_url: 'https://ci.example/policy' }] });
    if (/\/pulls\/\d+\/merge$/.test(url.pathname) && req.method === 'PUT') {
      if (json.sha !== state.headSha) return send(409, { message: 'Head branch was modified' });
      state.mergeCalls += 1; return send(200, { merged: true, message: 'Merged', sha: 'b'.repeat(40) });
    }
    return send(404, { message: `Unhandled ${req.method} ${url.pathname}` });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address missing');
  return { server, base: `http://127.0.0.1:${address.port}`, state };
}

function rawPull(number: number, title: string, head: string, base: string, sha: string) {
  return { number, title, state: 'open', draft: false, html_url: `https://github.com/base/repo/pull/${number}`, body: 'Body', user: { login: 'octocat' }, head: { ref: head, sha, repo: { owner: { login: 'fork' } } }, base: { ref: base }, updated_at: '2026-08-26T06:00:00Z', mergeable: true, mergeable_state: 'clean' };
}

function harness(root: string, fake: { base: string }, nowRef = { value: Date.now() }) {
  const db = pluginDb();
  mkdirSync(join(root, 'auth-tmp'));
  const instance = new SecretBag(); instance.set('client-secret', 'client-secret-value-1234567890');
  const users = new Map<number, SecretBag>();
  let currentUser = 1;
  const project = { id: 1, slug: 'project', path: root, notes: '', icon: '' };
  const workspace = { workspaceId: 'ws-1', projectId: 1, path: root, label: 'Feature', branch: 'elowen/u1/feature-a1b2', baseRef: 'origin/main' };
  const sandbox = {
    workspaceRoots: () => [], activeWorkspace: ({ sessionId, projectId }: { sessionId: string; projectId: number }) => currentUser > 0 && sessionId === 'brain-1' && projectId === 1 ? workspace : null,
    prepareExecution: async ({ command, cwd }: any) => prepared(command, cwd, join(root, 'home')),
  };
  const routes: any[] = [];
  const ctx = {
    config: { clientId: 'client-id', appSlug: 'app-slug' }, instanceSecrets: () => instance,
    userSecrets: () => { if (!users.has(currentUser)) users.set(currentUser, new SecretBag()); return users.get(currentUser)!; },
    publicWebUrl: () => 'https://elowen.example', db: () => db,
    currentContributionUserId: () => currentUser, currentIdentity: () => ({ elowenUserId: currentUser, owner: false }), currentAccess: () => ({ projectIds: [1], admin: false, owner: false, permissionBoundary: null, contributionUserId: currentUser }), currentSessionId: () => 'brain-1',
    userConfig: () => ({ mergeMethod: 'squash' }), control: (name: string) => name === 'sandbox' ? sandbox : undefined,
    host: { stores: () => ({ projects: { get: (id: number) => id === 1 ? project : null, list: () => [project] }, usersRead: { list: () => [{ id: 1 }, { id: 2 }], isAdmin: () => false, allowedExecs: () => [], mayUsePlugin: () => true }, homeProject: () => project }), git: () => ({ projectSnapshot: async () => ({ isRepo: true, status: { branch: workspace.branch, head: 'a'.repeat(40), upstream: null, ahead: 0, behind: 0, dirty: 0, untracked: 0, clean: true }, remotes: [{ name: 'origin', fetchUrl: 'git@github.com:base/repo.git', pushUrl: 'https://github.com/fork/repo.git' }] }), projectHead: async () => 'a'.repeat(40) }) },
    registerApiRoute: (route: unknown) => routes.push(route), registerTool: () => {}, registerReadinessCheck: () => {}, registerBootReconcile: () => {}, registerInterval: () => {}, registerUserRemoved: () => {}, registerProjectRemoved: () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as PluginContext;
  const pushCalls: SandboxPreparedExecution[] = [];
  const runner: SpawnPrepared = async (launch) => {
    const args = launch.launch.type === 'argv' ? launch.launch.args : [];
    if (args.includes('--git-common-dir')) return { stdout: '.git\n.git\n', stderr: '' };
    if (args.includes('HEAD')) return { stdout: `${'a'.repeat(40)}\n`, stderr: '' };
    if (args.includes('push')) {
      pushCalls.push(launch);
      if (!args.some((value) => value.startsWith('core.hooksPath='))) writeFileSync(join(root, 'hook-ran'), 'unsafe');
      const helper = args.find((value) => value.startsWith('credential.helper=!')) ?? '';
      const socket = /--socket '([^']+)'/.exec(helper)?.[1]; const nonce = /--nonce '([^']+)'/.exec(helper)?.[1];
      if (!socket || !nonce) throw new Error(`broker arguments missing: ${helper}`);
      const credentials = await new Promise<any>((resolve, reject) => { const client = connect(socket); let response = ''; client.setEncoding('utf8'); client.on('connect', () => client.end(JSON.stringify({ nonce, protocol: 'https', host: 'github.com', path: 'fork/repo.git' }))); client.on('data', (chunk) => response += chunk); client.on('end', () => resolve(JSON.parse(response))); client.on('error', reject); });
      if (credentials.password !== 'access-1' && !String(credentials.password).startsWith('access-')) throw new Error('wrong broker credential');
      return { stdout: 'ok\n', stderr: '' };
    }
    return { stdout: 'git version 2.45\n', stderr: '' };
  };
  const auth = new GitHubAuthAdapter({
    now: () => nowRef.value,
    tempRoot: join(root, 'auth-tmp'),
    spawn: ((file, args, options) => {
      const script = args[1] === 'login'
        ? "process.stdout.write('https://github.com/login/device\\r\\nABCD-EFGH\\r\\n'); setTimeout(() => process.exit(0), 10)"
        : "process.stdout.write('access-1\\n'); process.exit(0)";
      return nodeSpawn(process.execPath, ['-e', script], options);
    }) as any,
  });
  const service = new GitHubService(ctx, { fetch, apiBase: fake.base, now: () => nowRef.value, spawnPrepared: runner, auth });
  return { ctx, db, service, runner, setUser: (id: number) => { currentUser = id; }, users, instance, routes, pushCalls, workspace, nowRef };
}

async function waitForFlow(service: GitHubService, flowId: string): Promise<any> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const flow = service.deviceAuthStatus(service.currentUserId(), flowId);
    if (['connected', 'failed', 'cancelled', 'expired', 'interrupted'].includes(flow.status)) return flow;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('device flow did not finish');
}

async function waitForConnected(service: GitHubService, flowId: string): Promise<void> {
  const flow = await waitForFlow(service, flowId);
  expect(flow.status).toBe('connected');
}

function prepared(command: any, cwd: string, home: string): SandboxPreparedExecution {
  mkdirSync(home, { recursive: true });
  return { mode: 'confined', cwd, home, roots: [cwd, home], launch: command.type === 'argv' ? { type: 'argv', file: command.file, args: command.args, env: { HOME: home, GIT_CONFIG_GLOBAL: '/host/config', HTTPS_PROXY: 'http://proxy' } } : { type: 'shell', command: command.command, env: { HOME: home } }, workspace: null, lease: { id: 'lease', accountUserId: 1, workspaceId: 'ws-1', homeGeneration: 1, heartbeat: () => {}, release: () => {} } };
}

describe('GitHub plugin', () => {
  it('parses only the GitHub device URL and code and sanitizes inherited credentials', () => {
    expect(parseDevicePrompt('noise\r\nhttps://github.com/login/device\r\nABCD-EFGH\r\n')).toEqual({ verificationUrl: 'https://github.com/login/device', userCode: 'ABCD-EFGH' });
    expect(parseDevicePrompt('https://github.com.evil/login/device ABCD-EFGH')).toBeNull();
    expect(() => validateDeviceToken('token\nleak')).toThrow();
    const env = createGitHubAuthEnv('/tmp/isolated', { PATH: '/bin', GH_TOKEN: 'secret', GITHUB_TOKEN: 'secret', XDG_CONFIG_HOME: '/bad', HTTPS_PROXY: 'http://proxy', SSH_AUTH_SOCK: '/sock' });
    expect(env.env).toMatchObject({ HOME: '/tmp/isolated', GH_CONFIG_DIR: '/tmp/isolated', GH_BROWSER: 'echo', NO_COLOR: '1', PATH: '/bin' });
    expect(env.env).not.toHaveProperty('GH_TOKEN');
    expect(env.env).not.toHaveProperty('GITHUB_TOKEN');
    expect(env.env).not.toHaveProperty('XDG_CONFIG_HOME');
    expect(env.env).not.toHaveProperty('HTTPS_PROXY');
    expect(DEVICE_LOGIN_ARGS).toEqual(['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key', '--insecure-storage']);
    expect(TOKEN_ARGS).toEqual(['auth', 'token', '--hostname', 'github.com']);
  });

  it('declares device auth without App setup or callback routes', () => {
    expect(manifest.userGrantable).not.toBe(true);
    expect(manifest.version).toBe('0.1.3');
    expect(manifest.web.requiresApiVersion).toBe(4);
    expect(manifest.web.nav).toBeUndefined();
    expect(manifest.web.account).toEqual([{ id: 'connection', label: 'GitHub', icon: 'Github' }]);
    expect(manifest.web.project).toEqual([{ id: 'repository', label: 'GitHub', icon: 'Github' }]);
    expect(manifest.configSchema).toBeUndefined();
    expect(manifest.provides.apiRoutes).not.toContain('setup');
    expect(manifest.provides.apiRoutes).not.toContain('auth/callback');
  });

  it('marks legacy GitHub accounts reconnect_required during migration', () => {
    const db = pluginDb();
    db.raw.exec(`CREATE TABLE p_github_accounts (user_id INTEGER PRIMARY KEY, github_user_id INTEGER NOT NULL UNIQUE, login TEXT NOT NULL, name TEXT, avatar_url TEXT, token_expires_at INTEGER NOT NULL, refresh_expires_at INTEGER NOT NULL, status TEXT NOT NULL, last_error TEXT, verified_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); INSERT INTO p_github_accounts VALUES (1, 42, 'octocat', NULL, NULL, 1, 1, 'connected', NULL, 1, 1); INSERT INTO plugin_migrations(version) VALUES (1),(2),(3);`);
    const store = new GitHubStore(db);
    expect(store.account(1)).toMatchObject({ status: 'reconnect_required', lastError: 'legacy_oauth_requires_device_login' });
  });

  it('parses HTTPS, SCP and ssh GitHub remotes without accepting other hosts', () => {
    expect(parseGitHubRemote('https://user:secret@github.com/Owner/Repo.git')).toEqual({ owner: 'Owner', name: 'Repo' });
    expect(parseGitHubRemote('git@github.com:Owner/Repo.git')).toEqual({ owner: 'Owner', name: 'Repo' });
    expect(parseGitHubRemote('ssh://git@github.com/Owner/Repo.git')).toEqual({ owner: 'Owner', name: 'Repo' });
    expect(parseGitHubRemote('https://example.com/Owner/Repo.git')).toBeNull();
    expect(suggestedRepositories([
      { name: 'one', fetchUrl: 'https://github.com/a/one.git', pushUrl: 'https://github.com/a/one.git' },
      { name: 'two', fetchUrl: 'https://github.com/b/two.git', pushUrl: 'https://github.com/b/two.git' },
    ]).ambiguous).toBe(true);
  });

  it('starts a bounded device flow with isolated gh argv/env and stores the verified token', async () => {
    const root = mkdtempSync(join(tmpdir(), 'github-plugin-')); roots.push(root); mkdirSync(join(root, '.git'));
    const h = harness(root, await fakeGitHub());
    const started = await h.service.startDeviceAuth(1);
    expect(started).toMatchObject({ verificationUrl: 'https://github.com/login/device', userCode: 'ABCD-EFGH' });
    expect(started.flowId).toMatch(/^gh-/);
    const status = h.service.deviceAuthStatus(1, started.flowId);
    expect(status.directory).toBeUndefined();
    await waitForConnected(h.service, started.flowId);
    expect(h.service.connectionStatus(1).connected).toBe(true);
    expect(h.users.get(1)?.get('oauth-token')?.value).toBe('access-1');
  });

  it('marks the account reconnect_required after a GitHub 401 without refresh rotation', async () => {
    const fake = await fakeGitHub();
    try {
      const root = mkdtempSync(join(tmpdir(), 'github-plugin-')); roots.push(root); mkdirSync(join(root, '.git'));
      const h = harness(root, fake);
      const started = await h.service.startDeviceAuth(1); await waitForConnected(h.service, started.flowId);
      fake.state.rejectAccessOnce = true;
      await expect(h.service.testConnection(1)).rejects.toMatchObject({ code: 'reconnect_required' });
      expect(h.service.connectionStatus(1).reconnectRequired).toBe(true);
    } finally { fake.server.close(); }
  });

  it('allows only one active flow, supports cancellation and marks restart interruptions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'github-plugin-')); roots.push(root); mkdirSync(join(root, '.git'));
    const h = harness(root, await fakeGitHub());
    const started = await h.service.startDeviceAuth(1);
    await expect(h.service.startDeviceAuth(1)).rejects.toMatchObject({ code: 'auth_in_progress' });
    h.service.cancelDeviceAuth(1, started.flowId);
    expect(h.service.deviceAuthStatus(1, started.flowId).status).toBe('cancelled');
    const next = await h.service.startDeviceAuth(1);
    h.service.reconcile(new Set([1]), new Set([1]));
    expect(h.service.deviceAuthStatus(1, next.flowId).status).toBe('interrupted');
  });

  it('enforces unique GitHub identity and explicit replacement while preserving mappings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'github-plugin-')); roots.push(root); mkdirSync(join(root, '.git'));
    const h = harness(root, await fakeGitHub());
    const first = await h.service.startDeviceAuth(1); await waitForConnected(h.service, first.flowId);
    h.setUser(2);
    const second = await h.service.startDeviceAuth(2);
    const secondStatus = await waitForFlow(h.service, second.flowId);
    expect(secondStatus.status).toBe('failed');
    h.setUser(1);
    await h.service.saveMapping(1, { projectId: 1, baseOwner: 'base', baseName: 'repo', pushOwner: 'fork', pushName: 'repo' });
    const replacement = await h.service.preview(1, { type: 'replace_identity' });
    const replaced = await h.service.startDeviceAuth(1, { replaceIdentity: true, confirmationToken: replacement.confirmationToken });
    await waitForConnected(h.service, replaced.flowId);
    expect(h.service.store.mapping(1, 1)).not.toBeNull();
  });

  it('redacts an exact credential substring from Git stderr details', async () => {
    const root = mkdtempSync(join(tmpdir(), 'github-plugin-')); roots.push(root);
    const token = 'github-token-raw-secret';
    const launch = prepared({ type: 'argv', file: process.execPath, args: ['-e', `process.stderr.write(${JSON.stringify(`failure ${token} exposed`)});process.exit(1)`] }, root, join(root, 'home'));
    let failure: any;
    try { await spawnPrepared(launch, 5_000, [token]); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'git_command_failed' });
    expect(JSON.stringify(failure.details)).not.toContain(token);
    expect(JSON.stringify(failure.details)).toContain('[redacted]');
  });

  it('refuses unsafe local Git config and brokers a push credential without token argv/env/config leakage', async () => {
    const fake = await fakeGitHub();
    try {
      const root = mkdtempSync(join(tmpdir(), 'github-plugin-')); roots.push(root); mkdirSync(join(root, '.git')); mkdirSync(join(root, '.git', 'hooks')); mkdirSync(join(root, 'home'));
      writeFileSync(join(root, '.git', 'hooks', 'pre-push'), '#!/bin/sh\necho unsafe > ../hook-ran\n');
      writeFileSync(join(root, '.git', 'config'), '[include]\npath=/tmp/evil\n[http]\nproxy=http://evil\n');
      expect(unsafeConfig(readFileSync(join(root, '.git', 'config'), 'utf8'))).toBe(true);
      const h = harness(root, fake);
      await expect(publishBranch({ ctx: h.ctx, cwd: root, branch: h.workspace.branch, token: 'super-secret-token', repository: { owner: 'fork', name: 'repo' }, runner: h.runner })).rejects.toMatchObject({ code: 'unsafe_git_config' });
      expect(h.pushCalls).toHaveLength(0);
      writeFileSync(join(root, '.git', 'config'), '[core]\nrepositoryformatversion=0\n');
      await publishBranch({ ctx: h.ctx, cwd: root, branch: h.workspace.branch, token: 'access-1', repository: { owner: 'fork', name: 'repo' }, runner: h.runner });
      expect(h.pushCalls).toHaveLength(1);
      const serialized = JSON.stringify(h.pushCalls[0]);
      expect(serialized).not.toContain('access-1');
      expect(serialized).not.toContain('super-secret-token');
      expect(serialized).not.toContain('/host/config');
      expect(serialized).not.toContain('http://proxy');
      expect(serialized).toContain('core.hooksPath=');
      expect(serialized).not.toContain('--force');
      expect(() => readFileSync(join(root, 'hook-ran'), 'utf8')).toThrow();
    } finally { fake.server.close(); }
  });

  it('creates one PR idempotently and rejects a changed-head merge before accepting the expected head', async () => {
    const fake = await fakeGitHub();
    try {
      const root = mkdtempSync(join(tmpdir(), 'github-plugin-')); roots.push(root); mkdirSync(join(root, '.git')); writeFileSync(join(root, '.git', 'config'), '[core]\nrepositoryformatversion=0\n');
      const h = harness(root, fake);
      const start = await h.service.startDeviceAuth(1); await waitForConnected(h.service, start.flowId);
      await h.service.saveMapping(1, { projectId: 1, baseOwner: 'base', baseName: 'repo', pushOwner: 'fork', pushName: 'repo' });
      const action = { type: 'create_pr' as const, projectId: 1, sessionId: 'brain-1', title: 'Feature', body: 'Body', base: 'main' };
      const [first, second] = await Promise.all([h.service.preview(1, action), h.service.preview(1, action)]);
      const results = await Promise.all([
        h.service.confirm(1, action, first.confirmationToken!) as Promise<any>,
        h.service.confirm(1, action, second.confirmationToken!) as Promise<any>,
      ]);
      expect(results.map((result) => result.created).sort()).toEqual([false, true]);
      expect(fake.state.createCalls).toBe(1); expect(h.pushCalls).toHaveLength(1);
      const existing = await h.service.confirm(1, action, (await h.service.preview(1, action)).confirmationToken!) as any;
      expect(existing.created).toBe(false); expect(fake.state.createCalls).toBe(1); expect(h.pushCalls).toHaveLength(1);

      const mergeAction = { type: 'merge' as const, projectId: 1, number: 7, expectedHeadSha: fake.state.headSha, method: 'squash' as const };
      const mergePreview = await h.service.preview(1, mergeAction);
      fake.state.headSha = 'c'.repeat(40);
      await expect(h.service.confirm(1, mergeAction, mergePreview.confirmationToken!)).rejects.toMatchObject({ code: 'state_changed' });
      const currentAction = { ...mergeAction, expectedHeadSha: fake.state.headSha };
      const currentPreview = await h.service.preview(1, currentAction);
      await expect(h.service.confirm(1, { ...currentAction, method: 'merge' }, currentPreview.confirmationToken!)).rejects.toMatchObject({ code: 'confirmation_mismatch' });
      const merged = await h.service.confirm(1, currentAction, (await h.service.preview(1, currentAction)).confirmationToken!) as any;
      expect(merged.merged).toBe(true); expect(fake.state.mergeCalls).toBe(1);
    } finally { fake.server.close(); }
  });

  it('expires device flows and cleans mappings and account ownership', async () => {
    const fake = await fakeGitHub();
    try {
      const root = mkdtempSync(join(tmpdir(), 'github-plugin-')); roots.push(root); mkdirSync(join(root, '.git'));
      const nowRef = { value: Date.now() };
      const h = harness(root, fake, nowRef);
      const started = await h.service.startDeviceAuth(1);
      nowRef.value += 11 * 60_000;
      expect(h.service.deviceAuthStatus(1, started.flowId).status).toBe('expired');
      const fresh = await h.service.startDeviceAuth(1);
      await waitForConnected(h.service, fresh.flowId);
      await h.service.saveMapping(1, { projectId: 1, baseOwner: 'base', baseName: 'repo', pushOwner: 'fork', pushName: 'repo' });
      const foreign = await h.service.preview(1, { type: 'remove_mapping', projectId: 1 });
      h.setUser(2);
      await expect(h.service.confirm(2, { type: 'remove_mapping', projectId: 1 }, foreign.confirmationToken!)).rejects.toMatchObject({ code: 'confirmation_invalid' });
      h.setUser(1);
      await expect(h.service.confirm(1, { type: 'remove_mapping', projectId: 1 }, foreign.confirmationToken!)).resolves.toMatchObject({ removed: true });
      await h.service.saveMapping(1, { projectId: 1, baseOwner: 'base', baseName: 'repo', pushOwner: 'fork', pushName: 'repo' });
      h.service.store.deleteAccount(1);
      expect(h.service.store.account(1)).toBeNull();
      expect(h.service.store.mapping(1, 1)).toBeNull();
    } finally { fake.server.close(); }
  });

  it('allows reads but refuses unattended tool mutations before any GitHub write', async () => {
    const fake = await fakeGitHub();
    try {
      const root = mkdtempSync(join(tmpdir(), 'github-plugin-')); roots.push(root); mkdirSync(join(root, '.git'));
      const h = harness(root, fake);
      const registered: any[] = [];
      const unattended = { ...h.ctx, currentIdentity: () => null, currentSessionId: () => undefined, registerTool: (tool: unknown) => registered.push(tool) } as unknown as PluginContext;
      registerGitHubTools(unattended, h.service);
      const publish = registered.find((tool) => tool.name === 'GithubPublishBranch');
      const status = registered.find((tool) => tool.name === 'GithubConnectionStatus');
      expect((await publish.execute('call', { projectId: 1 })).content[0].text).toContain('unattended work may only read');
      expect((await status.execute('call', {})).content[0].text).toContain('connected');
      expect(fake.state.createCalls).toBe(0);
    } finally { fake.server.close(); }
  });

  it('fails API project access closed before repository lookup', async () => {
    const fake = await fakeGitHub();
    try {
      const root = mkdtempSync(join(tmpdir(), 'github-plugin-')); roots.push(root); mkdirSync(join(root, '.git'));
      const h = harness(root, fake); registerGitHubApi(h.ctx, h.service);
      const route = h.routes.find((value) => value.path === 'pull-requests');
      const response = await route.handler({ auth: { userId: 1, admin: false, accessibleProjects: [] }, query: { projectId: '1', state: 'open' }, params: {}, path: '', headers: {}, json: async () => ({}) });
      expect(response).toMatchObject({ status: 403, body: { error: 'project_forbidden' } });
    } finally { fake.server.close(); }
  });
});
