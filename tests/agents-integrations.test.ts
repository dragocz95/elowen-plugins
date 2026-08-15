// @vitest-environment node
// Re-homed from the Elowen package together with the agents plugin. Carries, verbatim:
//   tests/plugins/agents/integrations/githubAuth.test.ts
//   tests/plugins/agents/integrations/pr.test.ts
//   tests/plugins/agents/integrations/worktree.test.ts
// These shell out to a REAL git and to a fake `gh` placed on PATH, so they run in the node environment.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const spawnSync = vi.hoisted(() => vi.fn());
// githubAuth probes the machine with spawnSync, so that ONE export is stubbed. The pr and worktree
// suites in this same file shell out for real through execFile, so everything else is passed straight
// through from the genuine module — the functions themselves are the original objects, keeping
// execFile's promisify hook intact.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync };
});

import { detectGithubAuth } from '../plugins/agents/dist/integrations/githubAuth.js';
import { createPR, readPRReviews, mergePR } from '../plugins/agents/dist/integrations/pr.js';
import { createMissionWorktree, removeWorktree, commitAll, detectBaseBranch, pushBranch } from '../plugins/agents/dist/integrations/worktree.js';

// ---- from tests/plugins/agents/integrations/githubAuth.test.ts ----

/** Route the two probes (`which gh`, `gh auth status`) to canned results so each posture is isolated.
 *  Anything else (incl. vitest's own worker-pool spawnSync calls, which our module mock also intercepts)
 *  gets a benign non-zero default so it can't leak into the assertions. */
function stub(opts: { ghOnPath: boolean; authStatus?: number; authOutput?: string }) {
  spawnSync.mockImplementation((bin?: string, args?: string[]) => {
    if (bin === 'which') return { status: opts.ghOnPath ? 0 : 1, stdout: '', stderr: '' };
    if (bin === 'gh' && args?.[0] === 'auth') return { status: opts.authStatus ?? 1, stdout: '', stderr: opts.authOutput ?? '' };
    return { status: 1, stdout: '', stderr: '' };
  });
}

describe('detectGithubAuth', () => {
  beforeEach(() => spawnSync.mockReset());

  it('reports none when gh is absent and no token is set', () => {
    stub({ ghOnPath: false });
    expect(detectGithubAuth(false)).toEqual({ ghInstalled: false, ghAuthenticated: false, account: null, tokenSet: false, ready: false, method: 'none' });
  });

  it('reads the gh-authenticated account and prefers the gh method when no token', () => {
    stub({ ghOnPath: true, authStatus: 0, authOutput: '✓ Logged in to github.com account dragocz95 (keyring)\n' });
    const s = detectGithubAuth(false);
    expect(s).toMatchObject({ ghInstalled: true, ghAuthenticated: true, account: 'dragocz95', ready: true, method: 'gh' });
  });

  it('also parses the older "Logged in … as <login>" wording', () => {
    stub({ ghOnPath: true, authStatus: 0, authOutput: '✓ Logged in to github.com as octocat (oauth_token)\n' });
    expect(detectGithubAuth(false).account).toBe('octocat');
  });

  it('is not ready when gh is installed but unauthenticated and no token', () => {
    stub({ ghOnPath: true, authStatus: 1, authOutput: 'You are not logged into any GitHub hosts.\n' });
    expect(detectGithubAuth(false)).toMatchObject({ ghInstalled: true, ghAuthenticated: false, account: null, ready: false, method: 'none' });
  });

  it('a configured token wins: ready via the token method even with no gh login', () => {
    stub({ ghOnPath: false });
    expect(detectGithubAuth(true)).toMatchObject({ tokenSet: true, ready: true, method: 'token' });
  });
});

// ---- from tests/plugins/agents/integrations/pr.test.ts ----

// A fake `gh` on PATH lets us assert createPR's parsing/fallback without touching the network. Each
// test writes a shell stub that mimics the relevant `gh` behaviour.
let binDir: string;
let origPath: string | undefined;

function fakeGh(script: string) {
  const p = join(binDir, 'gh');
  writeFileSync(p, `#!/usr/bin/env bash\n${script}\n`);
  chmodSync(p, 0o755);
}

beforeEach(() => {
  binDir = mkdtempSync(join(tmpdir(), 'elowen-gh-'));
  origPath = process.env.PATH;
  process.env.PATH = `${binDir}:${origPath}`;
});
afterEach(() => {
  process.env.PATH = origPath;
  rmSync(binDir, { recursive: true, force: true });
});

describe('createPR', () => {
  it('parses the PR number + url from the gh create output', async () => {
    fakeGh(`if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "https://github.com/o/r/pull/123"; fi`);
    const ref = await createPR({ dir: binDir, base: 'main', head: 'elowen/x', title: 'T', body: 'B', token: 't' });
    expect(ref).toEqual({ number: 123, url: 'https://github.com/o/r/pull/123' });
  });

  it('falls back to reading the existing PR when create fails (already exists)', async () => {
    fakeGh(`
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "a pull request already exists" >&2; exit 1; fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '{"number":7,"url":"https://github.com/o/r/pull/7"}'; fi`);
    const ref = await createPR({ dir: binDir, base: 'main', head: 'elowen/x', title: 'T', body: 'B', token: 't' });
    expect(ref).toEqual({ number: 7, url: 'https://github.com/o/r/pull/7' });
  });

  it('returns null when gh is unavailable / both calls fail', async () => {
    fakeGh(`exit 1`);
    const ref = await createPR({ dir: binDir, base: 'main', head: 'elowen/x', title: 'T', body: 'B', token: 't' });
    expect(ref).toBeNull();
  });

  it('passes the token to gh via GH_TOKEN', async () => {
    // The stub echoes a URL only when GH_TOKEN is the expected value — proving the env propagated.
    fakeGh(`if [ "$GH_TOKEN" = "secret-tok" ]; then echo "https://github.com/o/r/pull/9"; else exit 1; fi`);
    const ref = await createPR({ dir: binDir, base: 'main', head: 'elowen/x', title: 'T', body: 'B', token: 'secret-tok' });
    expect(ref).toEqual({ number: 9, url: 'https://github.com/o/r/pull/9' });
  });

  it('omits GH_TOKEN entirely when no token is configured (uses gh\'s own login)', async () => {
    // An empty GH_TOKEN would override gh's stored auth — so with no token it must be UNSET, not "".
    fakeGh(`if [ -z "\${GH_TOKEN+x}" ]; then echo "https://github.com/o/r/pull/4"; else exit 1; fi`);
    const ref = await createPR({ dir: binDir, base: 'main', head: 'elowen/x', title: 'T', body: 'B', token: '' });
    expect(ref).toEqual({ number: 4, url: 'https://github.com/o/r/pull/4' });
  });
});

describe('readPRReviews', () => {
  it('reads state, COMMENTED reviews and line comments (the gh api call)', async () => {
    // The stub branches on `gh pr view` (lifecycle + reviews) vs `gh api .../comments` (line comments).
    fakeGh(`
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  echo '{"state":"OPEN","reviews":[{"state":"COMMENTED","body":"Codex review","author":{"login":"codex[bot]"},"submittedAt":"2026-06-24T12:00:00Z"}],"comments":[]}'
elif [ "$1" = "api" ]; then
  echo '[{"body":"cap bug","path":"web/x.tsx","line":298,"user":{"login":"codex[bot]"},"created_at":"2026-06-24T12:00:05Z"}]'
fi`);
    const st = await readPRReviews({ dir: binDir, number: 2, token: 't' });
    expect(st?.state).toBe('OPEN');
    expect(st?.reviews).toEqual([{ state: 'COMMENTED', body: 'Codex review', author: 'codex[bot]', submittedAt: '2026-06-24T12:00:00Z' }]);
    expect(st?.lineComments).toEqual([{ body: 'cap bug', path: 'web/x.tsx', line: 298, author: 'codex[bot]', createdAt: '2026-06-24T12:00:05Z' }]);
  });

  it('degrades to empty line comments when the gh api call fails (still returns reviews)', async () => {
    fakeGh(`
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  echo '{"state":"OPEN","reviews":[],"comments":[]}'
elif [ "$1" = "api" ]; then
  exit 1
fi`);
    const st = await readPRReviews({ dir: binDir, number: 2, token: 't' });
    expect(st?.state).toBe('OPEN');
    expect(st?.lineComments).toEqual([]);
  });

  it('returns null when gh pr view itself fails', async () => {
    fakeGh(`if [ "$1" = "pr" ]; then exit 1; fi`);
    const st = await readPRReviews({ dir: binDir, number: 2, token: 't' });
    expect(st).toBeNull();
  });
});

describe('mergePR', () => {
  it('squash-merges a clean, open PR with green checks', async () => {
    const marker = join(binDir, 'merged.flag');
    fakeGh(`
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '{"state":"OPEN","mergeable":"MERGEABLE","statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS"}]}'; fi
if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then echo "ok" > "${marker}"; fi`);
    const res = await mergePR({ dir: binDir, number: 2, token: 't' });
    expect(res.ok).toBe(true);
    expect(existsSync(marker)).toBe(true); // gh pr merge actually ran
  });

  it('refuses (no merge) while checks are still running', async () => {
    const marker = join(binDir, 'merged.flag');
    fakeGh(`
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '{"state":"OPEN","mergeable":"MERGEABLE","statusCheckRollup":[{"status":"IN_PROGRESS"}]}'; fi
if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then echo "ok" > "${marker}"; fi`);
    const res = await mergePR({ dir: binDir, number: 2, token: 't' });
    expect(res).toEqual({ ok: false, reason: expect.stringContaining('running') });
    expect(existsSync(marker)).toBe(false); // never attempted the merge
  });

  it('refuses when a check is failing', async () => {
    fakeGh(`if [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '{"state":"OPEN","mergeable":"MERGEABLE","statusCheckRollup":[{"status":"COMPLETED","conclusion":"FAILURE"}]}'; fi`);
    const res = await mergePR({ dir: binDir, number: 2, token: 't' });
    expect(res).toEqual({ ok: false, reason: expect.stringContaining('failing') });
  });

  it('refuses when the PR conflicts with the base branch', async () => {
    fakeGh(`if [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '{"state":"OPEN","mergeable":"CONFLICTING","statusCheckRollup":[]}'; fi`);
    const res = await mergePR({ dir: binDir, number: 2, token: 't' });
    expect(res).toEqual({ ok: false, reason: expect.stringContaining('conflict') });
  });

  it('refuses when the PR is not open', async () => {
    fakeGh(`if [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '{"state":"MERGED","mergeable":"UNKNOWN","statusCheckRollup":[]}'; fi`);
    const res = await mergePR({ dir: binDir, number: 2, token: 't' });
    expect(res.ok).toBe(false);
  });

  it('reports failure when gh pr merge itself errors', async () => {
    fakeGh(`
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '{"state":"OPEN","mergeable":"MERGEABLE","statusCheckRollup":[]}'; fi
if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then echo "boom" >&2; exit 1; fi`);
    const res = await mergePR({ dir: binDir, number: 2, token: 't' });
    expect(res.ok).toBe(false);
  });
});

// ---- from tests/plugins/agents/integrations/worktree.test.ts ----

let repo: string;
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'elowen-wt-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@elowen.dev');
  git(repo, 'config', 'user.name', 'Elowen Test');
  writeFileSync(join(repo, 'README.md'), '# repo\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
});
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe('worktree', () => {
  it('creates a worktree on a new branch off the base', async () => {
    const dir = join(repo, '..', `wt-${Date.now()}`);
    await createMissionWorktree(repo, 'elowen/feat-1', 'main', dir);
    expect(existsSync(join(dir, 'README.md'))).toBe(true);          // checked out base content
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('elowen/feat-1');
    rmSync(dir, { recursive: true, force: true });
  });

  it('commitAll commits staged changes and returns true', async () => {
    const dir = join(repo, '..', `wt-${Date.now()}-c`);
    await createMissionWorktree(repo, 'elowen/feat-2', 'main', dir);
    writeFileSync(join(dir, 'new.txt'), 'hello\n');
    const made = await commitAll(dir, 'add new.txt');
    expect(made).toBe(true);
    expect(git(dir, 'log', '-1', '--pretty=%s').trim()).toBe('add new.txt');
    rmSync(dir, { recursive: true, force: true });
  });

  it('commitAll is a no-op (returns false) when nothing changed', async () => {
    const dir = join(repo, '..', `wt-${Date.now()}-e`);
    await createMissionWorktree(repo, 'elowen/feat-3', 'main', dir);
    const made = await commitAll(dir, 'nothing');
    expect(made).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('commitAll also commits new untracked files', async () => {
    const dir = join(repo, '..', `wt-${Date.now()}-u`);
    await createMissionWorktree(repo, 'elowen/feat-4', 'main', dir);
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'a.txt'), 'a\n');
    expect(await commitAll(dir, 'add sub/a.txt')).toBe(true);
    expect(git(dir, 'ls-files').includes('sub/a.txt')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('removeWorktree detaches the worktree but keeps the branch', async () => {
    const dir = join(repo, '..', `wt-${Date.now()}-r`);
    await createMissionWorktree(repo, 'elowen/feat-5', 'main', dir);
    writeFileSync(join(dir, 'x.txt'), 'x\n');
    await commitAll(dir, 'work');
    await removeWorktree(repo, dir);
    expect(existsSync(dir)).toBe(false);                            // worktree gone
    expect(git(repo, 'branch', '--list', 'elowen/feat-5').trim()).toContain('elowen/feat-5'); // branch survives
  });

  it('detectBaseBranch falls back to the current branch without a remote', async () => {
    expect(await detectBaseBranch(repo, '')).toBe('main'); // repo is on `main`
  });

  it('detectBaseBranch returns the actual default branch on a master-named repo (no silent main fallback)', async () => {
    // A local repo whose default is `master` (or anything non-main) must resolve to THAT branch, else
    // `git worktree add ... main` fails and PR-native mode silently degrades to the shared checkout.
    git(repo, 'branch', '-m', 'main', 'master');
    expect(await detectBaseBranch(repo, '')).toBe('master');
  });

  it('detectBaseBranch honours an explicit configured base', async () => {
    expect(await detectBaseBranch(repo, 'develop')).toBe('develop');
  });
});

describe('pushBranch', () => {
  let remote: string;
  beforeEach(() => {
    remote = mkdtempSync(join(tmpdir(), 'elowen-remote-'));
    execFileSync('git', ['init', '-q', '--bare', remote]);
    git(repo, 'remote', 'add', 'origin', remote);
  });
  afterEach(() => { rmSync(remote, { recursive: true, force: true }); });

  it('re-pushes additional commits to an already-pushed branch (lease stays valid)', async () => {
    const dir = join(repo, '..', `wt-${Date.now()}-p`);
    await createMissionWorktree(repo, 'elowen/feat-push', 'main', dir);
    writeFileSync(join(dir, 'a.txt'), 'one\n'); await commitAll(dir, 'first');
    expect(await pushBranch(dir, 'elowen/feat-push', '')).toBe(true);   // initial push
    writeFileSync(join(dir, 'b.txt'), 'two\n'); await commitAll(dir, 'second');
    expect(await pushBranch(dir, 'elowen/feat-push', '')).toBe(true);   // re-push must NOT 'stale info'
    expect(git(remote, 'log', '--oneline', 'elowen/feat-push')).toContain('second');
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns false when the repo has no origin remote', async () => {
    git(repo, 'remote', 'remove', 'origin');
    const dir = join(repo, '..', `wt-${Date.now()}-n`);
    await createMissionWorktree(repo, 'elowen/feat-noremote', 'main', dir);
    writeFileSync(join(dir, 'a.txt'), 'x\n'); await commitAll(dir, 'work');
    expect(await pushBranch(dir, 'elowen/feat-noremote', '')).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('pushes with a configured token without persisting it to the repo config', async () => {
    const dir = join(repo, '..', `wt-${Date.now()}-t`);
    await createMissionWorktree(repo, 'elowen/feat-token', 'main', dir);
    writeFileSync(join(dir, 'a.txt'), 'x\n'); await commitAll(dir, 'work');
    expect(await pushBranch(dir, 'elowen/feat-token', 'ghs_faketoken123')).toBe(true);
    expect(git(remote, 'log', '--oneline', 'elowen/feat-token')).toContain('work');
    // The one-shot `-c http.extraHeader` is command-scoped — the token must never land in config.
    expect(git(dir, 'config', '--local', '--list')).not.toContain('ghs_faketoken123');
    rmSync(dir, { recursive: true, force: true });
  });
});
