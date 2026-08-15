// @vitest-environment node
// Adopted from the Elowen package when the agents plugin moved to this registry. Carries, verbatim:
//   tests/plugins/agents/overseer/reviewContext.test.ts
//   tests/plugins/agents/overseer/reviewDiff.test.ts
//   tests/plugins/agents/overseer/prFeedback.test.ts
//   tests/plugins/agents/overseer/prMode.test.ts
//   tests/plugins/agents/overseer/overseerAgent.test.ts
//   tests/plugins/agents/overseer/pilotAgent.test.ts
// The plugin code under test is THIS repo's own build (plugins/agents/dist); the daemon-side collaborators
// come from the published `elowen` package. Section-local helpers that collided across the merged files
// carry a section prefix, and each git-repo fixture's beforeEach/afterEach is scoped to its own describe
// so an unrelated test never pays for a temp checkout it does not use.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { render, setPluginPromptSources } from 'elowen/dist/prompts/index.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { TaskStore } from '../plugins/work/dist/store/taskStore.js';
import { agentsPluginConfig } from '../plugins/agents/dist/config.js';
import { MissionStore } from '../plugins/agents/dist/store/missionStore.js';
import { MissionPrStore } from '../plugins/agents/dist/store/missionPrStore.js';
import { MissionGit } from '../plugins/agents/dist/overseer/missionGit.js';
import { sweepPrFeedback } from '../plugins/agents/dist/overseer/prFeedback.js';
import { buildReviewContext, REVIEW_DIFF_LIMIT } from '../plugins/agents/dist/overseer/reviewContext.js';
import { projectReviewDiff } from '../plugins/agents/dist/overseer/reviewDiff.js';
import { resolvePrEnabled } from '../plugins/agents/dist/overseer/prMode.js';
import { DecisionQueue } from '../plugins/agents/dist/overseer/decisionQueue.js';
import {
  overseerPrompt as rawOverseerPrompt, makeOverseer as rawMakeOverseer,
  type RenderPrompt as OverseerRenderPrompt,
} from '../plugins/agents/dist/overseer/overseerAgent.js';
import { pilotPrompt as rawPilotPrompt, makePilot as rawMakePilot } from '../plugins/agents/dist/overseer/pilotAgent.js';
import type { RenderPrompt as PilotRenderPrompt } from '../plugins/agents/dist/spawn/commandBuilder.js';
import { openPluginTablesDb } from './helpers/pluginTablesDb.js';

/** `overseer.md`, `code-review.md` and `pilot.md` are the agents plugin's OWN templates now — they live
 *  in this repo, not under elowen/dist/prompts — so the daemon's file renderer cannot resolve them until
 *  the plugin source overlay is installed. The daemon installs it right after loading plugins (see
 *  helpers/domainApp.ts); this suite calls the prompt builders directly, so it installs the overlay
 *  itself. Without it every prompt assertion below would fail on an ENOENT. */
const AGENTS_PROMPT_DIR = fileURLToPath(new URL('../plugins/agents/prompts', import.meta.url));
setPluginPromptSources(new Map(readdirSync(AGENTS_PROMPT_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => [f.slice(0, -'.md'.length), join(AGENTS_PROMPT_DIR, f)])));

// The plugin functions take the prompt renderer as a REQUIRED seam (ctx.host.prompts in
// production); the core file renderer stands in here, matching the pre-extraction defaults.
// Shared verbatim by the overseerAgent and pilotAgent sections (identical in both originals).
const prompts = { render: (n: string, v?: Record<string, string>) => render(n, v), rawTemplate: () => '' };

// ---- from tests/plugins/agents/overseer/reviewContext.test.ts ----

describe('buildReviewContext', () => {
  it('carries the agent self-report and the real evidence (changed files + diff)', () => {
    const ctx = buildReviewContext({
      title: 'Add CSV export', outcome: 'ok', summary: 'done it',
      changedFiles: ['src/a.ts', 'src/b.ts'], diff: 'diff --git a/src/a.ts ...',
    });
    expect(ctx).toMatchObject({
      title: 'Add CSV export', outcome: 'ok', summary: 'done it',
      changedFiles: ['src/a.ts', 'src/b.ts'], diff: 'diff --git a/src/a.ts ...',
      diffTruncated: false,
    });
  });

  it('keeps a diff under the limit intact', () => {
    const diff = 'x'.repeat(REVIEW_DIFF_LIMIT);
    const ctx = buildReviewContext({ title: 't', outcome: 'ok', summary: 's', changedFiles: [], diff });
    expect(ctx.diff).toBe(diff);
    expect(ctx.diffTruncated).toBe(false);
  });

  it('truncates an oversized diff and flags it so the overseer knows to pull the rest via git', () => {
    const diff = 'x'.repeat(REVIEW_DIFF_LIMIT + 5000);
    const ctx = buildReviewContext({ title: 't', outcome: 'ok', summary: 's', changedFiles: [], diff });
    expect((ctx.diff as string).length).toBe(REVIEW_DIFF_LIMIT);
    expect(ctx.diffTruncated).toBe(true);
  });

  it('reports an empty diff plainly (no changes detected in the working tree)', () => {
    const ctx = buildReviewContext({ title: 't', outcome: 'ok', summary: 's', changedFiles: [], diff: '' });
    expect(ctx.diff).toBe('');
    expect(ctx.diffTruncated).toBe(false);
    expect(ctx.changedFiles).toEqual([]);
  });
});

// ---- from tests/plugins/agents/overseer/reviewDiff.test.ts ----

let root: string;
const gitAt = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
const w = (rel: string, body: string) => { const p = join(root, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body); };

describe('projectReviewDiff', () => {
  // The original file's top-level beforeEach/afterEach; scoped to this describe in the merged suite.
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'elowen-reviewdiff-'));
    gitAt('init', '-q');
    gitAt('config', 'user.email', 't@t');
    gitAt('config', 'user.name', 'Test');
    w('tracked.md', 'original line\n');
    gitAt('add', '-A');
    gitAt('-c', 'user.email=t@t', '-c', 'user.name=Test', 'commit', '-q', '-m', 'init');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('includes a tracked modification in the diff', async () => {
    w('tracked.md', 'changed line\n');
    const { changedFiles, diff } = await projectReviewDiff(root);
    expect(changedFiles).toContain('tracked.md');
    expect(diff).toContain('-original line');
    expect(diff).toContain('+changed line');
  });

  it('includes a brand-new UNTRACKED file as a new-file addition (git diff HEAD alone misses it)', async () => {
    w('sandbox/new.md', '# Fresh\nhello from the agent\n');
    const { changedFiles, diff } = await projectReviewDiff(root);
    // The individual untracked file is listed (not just its parent dir)…
    expect(changedFiles).toContain(join('sandbox', 'new.md'));
    // …and its actual added content appears in the diff so the overseer can review it.
    expect(diff).toContain('+# Fresh');
    expect(diff).toContain('+hello from the agent');
  });

  it('covers a tracked change AND an untracked file together', async () => {
    w('tracked.md', 'edited\n');
    w('brand_new.txt', 'created content\n');
    const { diff } = await projectReviewDiff(root);
    expect(diff).toContain('+edited');
    expect(diff).toContain('+created content');
  });

  it('returns empty evidence for a non-git directory (no throw)', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'elowen-plain-'));
    try {
      const { changedFiles, diff } = await projectReviewDiff(plain);
      expect(changedFiles).toEqual([]);
      expect(diff).toBe('');
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

// ---- from tests/plugins/agents/overseer/prFeedback.test.ts ----

let fbBase: string, fbRepo: string, fbBinDir: string, fbOrigPath: string | undefined;
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
const fakeGh = (script: string) => { const p = join(fbBinDir, 'gh'); writeFileSync(p, `#!/usr/bin/env bash\n${script}\n`); chmodSync(p, 0o755); };

// gh stub: `pr view` returns lifecycle+reviews+conversation, `api` returns line comments. Each helper
// fills the bits a test cares about; the `api` branch defaults to an empty array unless overridden.
const ghReview = (viewJson: string, apiJson = '[]') => fakeGh(`
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  echo '${viewJson}'
elif [ "$1" = "api" ]; then
  echo '${apiJson}'
fi`);
const ghChangesRequested = (ts: string) =>
  ghReview(`{"state":"OPEN","reviews":[{"state":"CHANGES_REQUESTED","body":"please rename the function","submittedAt":"${ts}","author":{"login":"alice"}}],"comments":[]}`);

async function build(opts: { exec?: string } = {}) {
  const db = openPluginTablesDb(':memory:');
  const projects = new ProjectStore(db);
  const project = projects.create({ slug: 'demo', path: fbRepo });
  const tasks = new TaskStore(db);
  tasks.create({ id: 'epic', project_id: project.id, title: 'E', type: 'epic' });
  tasks.create({ id: 'p1', project_id: project.id, title: 'first phase', parent_id: 'epic' });
  if (opts.exec) tasks.setExec('p1', opts.exec);
  const config = new ConfigStore(db);
  config.update({ autopilot: { prEnabled: true, ghToken: 'tok' } });
  const prs = new MissionPrStore(db);
  const missions = new MissionStore(db);
  missions.create({ id: 'm-epic', epic_id: 'epic', autonomy: 'L3', max_sessions: 1 });
  const missionGit = new MissionGit({ prs, pluginConfig: () => agentsPluginConfig({}, config as never), projects, tasks });
  await missionGit.onEngage('m-epic', 'epic');
  prs.setPr('m-epic', { number: 12, url: 'https://github.com/o/r/pull/12', state: 'open' }); // simulate an opened PR
  return { missionGit, prs, tasks, missions, projects };
}

/** The original file's top-level beforeEach/afterEach. Scoped to this section's two describes in the
 *  merged suite so an unrelated test never provisions (or pays for) a real git repo + fake `gh`. */
function fbBeforeEach() {
  fbBase = mkdtempSync(join(tmpdir(), 'elowen-fb-'));
  fbRepo = join(fbBase, 'project'); mkdirSync(fbRepo);
  fbBinDir = join(fbBase, 'bin'); mkdirSync(fbBinDir);
  fbOrigPath = process.env.PATH; process.env.PATH = `${fbBinDir}:${fbOrigPath}`;
  git(fbRepo, 'init', '-q', '-b', 'main');
  git(fbRepo, 'config', 'user.email', 'test@elowen.dev'); git(fbRepo, 'config', 'user.name', 'Elowen Test');
  writeFileSync(join(fbRepo, 'README.md'), '# repo\n'); git(fbRepo, 'add', '-A'); git(fbRepo, 'commit', '-q', '-m', 'init');
}
function fbAfterEach() { process.env.PATH = fbOrigPath; rmSync(fbBase, { recursive: true, force: true }); }

describe('MissionGit.ingestReviews (detector)', () => {
  beforeEach(fbBeforeEach);
  afterEach(fbAfterEach);

  it('returns aggregated feedback for a changes-requested review', async () => {
    ghChangesRequested('2026-06-24T10:00:00Z');
    const { missionGit } = await build();
    const res = await missionGit.ingestReviews('m-epic');
    expect(res.action).toBe('feedback');
    expect((res as { feedback: string }).feedback).toContain('please rename the function');
  });

  it('triggers on a COMMENTED review that carries a line comment (Codex bot case)', async () => {
    ghReview(
      `{"state":"OPEN","reviews":[{"state":"COMMENTED","body":"Codex review","submittedAt":"2026-06-24T10:00:00Z","author":{"login":"codex[bot]"}}],"comments":[]}`,
      `[{"body":"windowHours cap bug","path":"web/x.tsx","line":298,"user":{"login":"codex[bot]"},"created_at":"2026-06-24T10:00:05Z"}]`,
    );
    const { missionGit } = await build();
    const res = await missionGit.ingestReviews('m-epic');
    expect(res.action).toBe('feedback');
    expect((res as { feedback: string }).feedback).toContain('web/x.tsx:298');
    expect((res as { feedback: string }).feedback).toContain('windowHours cap bug');
  });

  it('ignores a bare COMMENTED review with no body and no line comments', async () => {
    ghReview(`{"state":"OPEN","reviews":[{"state":"COMMENTED","body":"","submittedAt":"2026-06-24T10:00:00Z","author":{"login":"codex[bot]"}}],"comments":[]}`);
    const { missionGit } = await build();
    expect((await missionGit.ingestReviews('m-epic')).action).toBe('none');
  });

  it('inherits the original mission exec from the epic phases', async () => {
    ghChangesRequested('2026-06-24T10:00:00Z');
    const { missionGit } = await build({ exec: 'codex:gpt-5.5' });
    const res = await missionGit.ingestReviews('m-epic');
    expect((res as { exec?: string }).exec).toBe('codex:gpt-5.5');
  });

  it('dedups the same review batch via last_review_ts', async () => {
    ghChangesRequested('2026-06-24T10:00:00Z');
    const { missionGit } = await build();
    expect((await missionGit.ingestReviews('m-epic')).action).toBe('feedback');
    expect((await missionGit.ingestReviews('m-epic')).action).toBe('none'); // same timestamp → already ingested
  });

  it('stops watching and clears the budget when the PR is merged', async () => {
    ghReview(`{"state":"MERGED","reviews":[],"comments":[]}`);
    const { missionGit, prs } = await build();
    prs.bumpFixRounds('m-epic');
    const res = await missionGit.ingestReviews('m-epic');
    expect(res.action).toBe('closed');
    expect(prs.get('m-epic')!.pr_state).toBe('merged');
    expect(prs.get('m-epic')!.fix_rounds).toBe(0);
    expect(prs.withOpenPr()).toHaveLength(0);
  });
});

describe('sweepPrFeedback (budget + replan)', () => {
  beforeEach(fbBeforeEach);
  afterEach(fbAfterEach);

  const deps = (over: Record<string, unknown>) => ({
    replan: vi.fn().mockResolvedValue(true),
    bus: { publish: vi.fn() },
    ...over,
  });

  it('replans on fresh feedback (passing the inherited exec) and spends a budget round', async () => {
    ghChangesRequested('2026-06-24T10:00:00Z');
    const { missionGit, prs, missions, projects } = await build({ exec: 'codex:gpt-5.5' });
    const d = deps({ prs, missions, missionGit, projects });
    const ids = await sweepPrFeedback(d as never);
    expect(ids).toEqual(['m-epic']);
    expect(d.replan).toHaveBeenCalledWith(expect.objectContaining({ epicId: 'epic', exec: 'codex:gpt-5.5' }));
    expect(prs.get('m-epic')!.fix_rounds).toBe(1); // replan owns re-engage (via the plan job's engage flag)
  });

  it('does not spend a budget round when replan fails to start (e.g. no pilot)', async () => {
    ghChangesRequested('2026-06-24T10:00:00Z');
    const { missionGit, prs, missions, projects } = await build();
    const d = deps({ prs, missions, missionGit, projects, replan: vi.fn().mockResolvedValue(false) });
    expect(await sweepPrFeedback(d as never)).toEqual([]);
    expect(prs.get('m-epic')!.fix_rounds).toBe(0);
  });

  it('escalates to stalled (no replan) once the fix budget is exhausted', async () => {
    ghChangesRequested('2026-06-24T10:00:00Z');
    const { missionGit, prs, missions, projects } = await build();
    prs.bumpFixRounds('m-epic'); prs.bumpFixRounds('m-epic'); // already at the budget of 2
    const d = deps({ prs, missions, missionGit, projects });
    const ids = await sweepPrFeedback(d as never);
    expect(ids).toEqual([]);
    expect(d.replan).not.toHaveBeenCalled();
    expect(missions.get('m-epic')!.state).toBe('stalled');
    expect(d.bus.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'mission', missionId: 'm-epic', state: 'stalled' }));
  });

  it('does nothing when there is no fresh feedback', async () => {
    ghReview(`{"state":"OPEN","reviews":[],"comments":[]}`);
    const { missionGit, prs, missions, projects } = await build();
    const d = deps({ prs, missions, missionGit, projects });
    expect(await sweepPrFeedback(d as never)).toEqual([]);
    expect(d.replan).not.toHaveBeenCalled();
  });
});

// ---- from tests/plugins/agents/overseer/prMode.test.ts ----

describe('prMode.resolvePrEnabled', () => {
  it('an explicit override wins over everything', () => {
    expect(resolvePrEnabled(true, false, false)).toBe(true);
    expect(resolvePrEnabled(false, true, true)).toBe(false);
  });
  it('falls through to the project override when there is no per-task override', () => {
    expect(resolvePrEnabled(null, true, false)).toBe(true);
    expect(resolvePrEnabled(null, false, true)).toBe(false);
  });
  it('falls through to the global default when neither override is set', () => {
    expect(resolvePrEnabled(null, null, true)).toBe(true);
    expect(resolvePrEnabled(null, undefined, false)).toBe(false);
  });
});

// ---- from tests/plugins/agents/overseer/overseerAgent.test.ts ----

const overseerPrompt = (missionId: string, cli?: string, rp: OverseerRenderPrompt = render) => rawOverseerPrompt(missionId, rp, cli);
const makeOverseer = (deps: Omit<Parameters<typeof rawMakeOverseer>[0], 'prompts'> & { prompts?: Parameters<typeof rawMakeOverseer>[0]['prompts'] }) => rawMakeOverseer({ prompts, ...deps });

describe('overseerPrompt', () => {
  it('tells the agent to loop poll → decide', () => {
    const p = overseerPrompt('m1');
    expect(p).toContain('elowen overseer poll');
    expect(p).toContain('elowen overseer decide');
  });
  it('uses the provided cli invocation verbatim (e.g. node <path> in a checkout)', () => {
    const p = overseerPrompt('m1', 'node /d/cli/index.js');
    expect(p).toContain('node /d/cli/index.js overseer poll');
    expect(p).toContain('node /d/cli/index.js overseer decide');
    expect(p).not.toMatch(/`elowen overseer poll`/); // not the bare default when an explicit cli is given
  });
  it('explains each decision kind so the overseer judges them differently (O19)', () => {
    const p = overseerPrompt('m1');
    expect(p).toContain('"task"');
    expect(p).toContain('"prompt"');
    expect(p).toContain('"review"');
    expect(p.toLowerCase()).toContain('blocks its dependents'); // review semantics spelled out
  });
  it('explains the "message" kind and its free-text answer command (elowen ask)', () => {
    const p = overseerPrompt('m1');
    expect(p).toContain('"message"'); // the free-text agent question kind
    expect(p).toContain('overseer decide --id <id> --message'); // how to answer it
  });
  it('tells the agent it may exit cleanly so a crash/full-context overseer is restartable (O20)', () => {
    expect(overseerPrompt('m1').toLowerCase()).toContain('exit cleanly');
  });
  it('injects the code-review criteria template into the review handling', () => {
    const p = overseerPrompt('m1');
    expect(p).not.toContain('{{codeReview}}'); // placeholder was substituted, not left raw
    expect(p.toLowerCase()).toContain('code-review criteria'); // the injected section is present
    expect(p.toLowerCase()).toContain('scope'); // a distinctive focus area from code-review.md
  });
  it('renders the code-review template via the same per-user renderer it is given', () => {
    // overseerPrompt asks its renderer for BOTH 'overseer' and 'code-review' — a custom renderer
    // (the per-user override path) must be consulted for the criteria too, not just the loop prompt.
    const renderPrompt = vi.fn((name: string, vars: Record<string, string>) => name === 'code-review' ? 'CR-CRITERIA' : `loop: ${vars.codeReview}`);
    const p = overseerPrompt('m1', 'elowen', renderPrompt);
    expect(renderPrompt).toHaveBeenCalledWith('code-review', {});
    expect(p).toContain('CR-CRITERIA');
  });
});

describe('makeOverseer', () => {
  const cfg = (overseerExec: string) => ({ get: () => ({ autopilot: { overseerExec } }) }) as never;

  it('uses the mission overseer override instead of the global overseer', async () => {
    const launch = vi.fn().mockResolvedValue({ session: 'elowen-overseer-m1' });
    const ctl = makeOverseer({
      spawn: { launch } as never,
      tmux: { kill: vi.fn(), list: vi.fn().mockResolvedValue([]) } as never,
      config: cfg('claude:sonnet'), queue: new DecisionQueue(),
      missions: { get: () => ({ created_by: 1, overseer_exec: 'codex:gpt-5.4' }) },
    });
    await ctl.start('m1', 1, '/repo');
    expect(launch.mock.calls[0]![0].spec).toEqual({ program: 'codex', model: 'gpt-5.4' });
  });

  it('start() spawns a parked agent named overseer-<id> with ELOWEN_MISSION', async () => {
    const launch = vi.fn().mockResolvedValue({ session: 'elowen-overseer-m1' });
    const ctl = makeOverseer({ spawn: { launch } as never, tmux: { kill: vi.fn(), list: vi.fn().mockResolvedValue([]) } as never, config: cfg('opencode:deepseek/deepseek-v4-flash'), queue: new DecisionQueue(), cli: 'node /d/cli/index.js' });
    await ctl.start('m1', 1, '/repo');
    const arg = launch.mock.calls[0]![0];
    expect(arg.agentName).toBe('overseer-m1');
    expect(arg.extraEnv).toEqual({ ELOWEN_MISSION: 'm1' });
    expect(arg.spec).toEqual({ program: 'opencode', model: 'deepseek/deepseek-v4-flash' });
    expect(arg.rawPrompt).toContain('node /d/cli/index.js overseer poll'); // daemon CLI by absolute path
  });

  it('start() is idempotent — never double-spawns when the overseer is already parked', async () => {
    // engage and resume both call start() unconditionally, and the overseer can already be parked from
    // a prior engage. Without the in-park guard, `tmux new-session` throws "duplicate session" and
    // crashes the caller (the route handler), which is exactly what livelocked the mission.
    const launch = vi.fn().mockResolvedValue({ session: 'elowen-overseer-m1' });
    const list = vi.fn().mockResolvedValue(['elowen-overseer-m1']); // already parked
    const ctl = makeOverseer({ spawn: { launch } as never, tmux: { kill: vi.fn(), list } as never, config: cfg('opencode:deepseek/deepseek-v4-flash'), queue: new DecisionQueue() });
    await ctl.start('m1', 1, '/repo');
    expect(launch).not.toHaveBeenCalled();
  });

  it('start() and ensure() racing each other still park exactly one overseer', async () => {
    // engage, the mission tick's ensure and the watchdog all call park concurrently. The guard is a
    // check-then-act across an await, so without serialization both callers see the session missing and
    // launch — and the second `tmux new-session` throws "duplicate session", crashing its caller.
    const live: string[] = [];
    const launch = vi.fn(async (arg: { agentName: string }) => {
      live.push(`elowen-${arg.agentName}`);
      return { session: `elowen-${arg.agentName}` };
    });
    const list = vi.fn(async () => [...live]);
    const ctl = makeOverseer({ spawn: { launch } as never, tmux: { kill: vi.fn(), list } as never, config: cfg('claude:opus'), queue: new DecisionQueue() });
    await Promise.all([ctl.start('m1', 1, '/repo'), ctl.ensure('m1', 1, '/repo'), ctl.ensure('m1', 1, '/repo')]);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('a failed park does not poison the next one', async () => {
    const launch = vi.fn()
      .mockRejectedValueOnce(new Error('spawn failed'))
      .mockResolvedValueOnce({ session: 'elowen-overseer-m1' });
    const ctl = makeOverseer({ spawn: { launch } as never, tmux: { kill: vi.fn(), list: vi.fn().mockResolvedValue([]) } as never, config: cfg('claude:opus'), queue: new DecisionQueue() });
    await expect(ctl.start('m1', 1, '/repo')).rejects.toThrow('spawn failed');
    await ctl.ensure('m1', 1, '/repo');
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('start() is a no-op when overseerExec is empty (relay fallback)', async () => {
    const launch = vi.fn();
    const ctl = makeOverseer({ spawn: { launch } as never, tmux: { kill: vi.fn(), list: vi.fn().mockResolvedValue([]) } as never, config: cfg(''), queue: new DecisionQueue() });
    await ctl.start('m2', 1, '/repo');
    expect(launch).not.toHaveBeenCalled();
  });

  it('ensure() re-parks the agent when its session has died', async () => {
    const launch = vi.fn().mockResolvedValue({ session: 'elowen-overseer-m1' });
    const list = vi.fn().mockResolvedValue([]); // session gone
    const ctl = makeOverseer({ spawn: { launch } as never, tmux: { kill: vi.fn(), list } as never, config: cfg('opencode:deepseek/deepseek-v4-flash'), queue: new DecisionQueue(), cli: 'node /d/cli/index.js' });
    await ctl.ensure('m1', 1, '/repo');
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0]![0].agentName).toBe('overseer-m1');
  });

  it('ensure() does not double-spawn when the overseer is already parked', async () => {
    const launch = vi.fn().mockResolvedValue({ session: 'elowen-overseer-m1' });
    const list = vi.fn().mockResolvedValue(['elowen-overseer-m1', 'elowen-AgentX']); // still alive
    const ctl = makeOverseer({ spawn: { launch } as never, tmux: { kill: vi.fn(), list } as never, config: cfg('opencode:deepseek/deepseek-v4-flash'), queue: new DecisionQueue() });
    await ctl.ensure('m1', 1, '/repo');
    expect(launch).not.toHaveBeenCalled();
  });

  it('ensure() is inert when overseerExec is empty (relay fallback)', async () => {
    const launch = vi.fn();
    const ctl = makeOverseer({ spawn: { launch } as never, tmux: { kill: vi.fn(), list: vi.fn().mockResolvedValue([]) } as never, config: cfg(''), queue: new DecisionQueue() });
    await ctl.ensure('m4', 1, '/repo');
    expect(launch).not.toHaveBeenCalled();
  });

  it('start() parks the overseer INSIDE the mission worktree so its read-only git sees the agent diff', async () => {
    // The overseer judges a phase by running `git diff HEAD` itself. In PR-native mode the agent's work
    // lives in the mission's worktree, not the main checkout — park it there or every phase false-rejects
    // as "fabricated" (the main checkout shows zero changes) and the mission loops forever.
    const launch = vi.fn().mockResolvedValue({ session: 'elowen-overseer-m1' });
    const missionGit = { worktreeFor: vi.fn().mockReturnValue('/wt/m1') };
    const ctl = makeOverseer({ spawn: { launch } as never, tmux: { kill: vi.fn(), list: vi.fn().mockResolvedValue([]) } as never, config: cfg('opencode:deepseek/deepseek-v4-flash'), queue: new DecisionQueue(), missionGit });
    await ctl.start('m1', 1, '/repo');
    expect(missionGit.worktreeFor).toHaveBeenCalledWith('m1');
    expect(launch.mock.calls[0]![0].projectPath).toBe('/wt/m1');
  });

  it('start() falls back to the project checkout when the mission has no worktree (non-PR mission)', async () => {
    const launch = vi.fn().mockResolvedValue({ session: 'x' });
    const missionGit = { worktreeFor: vi.fn().mockReturnValue(null) };
    const ctl = makeOverseer({ spawn: { launch } as never, tmux: { kill: vi.fn(), list: vi.fn().mockResolvedValue([]) } as never, config: cfg('claude:opus'), queue: new DecisionQueue(), missionGit });
    await ctl.start('m1', 1, '/repo');
    expect(launch.mock.calls[0]![0].projectPath).toBe('/repo');
  });

  it('start() uses the project checkout when no missionGit is wired at all', async () => {
    const launch = vi.fn().mockResolvedValue({ session: 'x' });
    const ctl = makeOverseer({ spawn: { launch } as never, tmux: { kill: vi.fn(), list: vi.fn().mockResolvedValue([]) } as never, config: cfg('claude:opus'), queue: new DecisionQueue() });
    await ctl.start('m1', 1, '/repo');
    expect(launch.mock.calls[0]![0].projectPath).toBe('/repo');
  });

  it('ensure() re-parks into the worktree too (not just the first start)', async () => {
    const launch = vi.fn().mockResolvedValue({ session: 'x' });
    const missionGit = { worktreeFor: vi.fn().mockReturnValue('/wt/m1') };
    const ctl = makeOverseer({ spawn: { launch } as never, tmux: { kill: vi.fn(), list: vi.fn().mockResolvedValue([]) } as never, config: cfg('opencode:deepseek/deepseek-v4-flash'), queue: new DecisionQueue(), missionGit });
    await ctl.ensure('m1', 1, '/repo');
    expect(launch.mock.calls[0]![0].projectPath).toBe('/wt/m1');
  });

  it('stop() kills the session and drains the queue', async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    const queue = new DecisionQueue();
    const drain = vi.spyOn(queue, 'drain');
    const ctl = makeOverseer({ spawn: { launch: vi.fn().mockResolvedValue({ session: 'x' }) } as never, tmux: { kill, list: vi.fn().mockResolvedValue([]) } as never, config: cfg('claude:opus'), queue });
    await ctl.start('m3', 1, '/repo');
    await ctl.stop('m3');
    expect(kill).toHaveBeenCalledWith('elowen-overseer-m3');
    expect(drain).toHaveBeenCalledWith('m3');
  });
});

// ---- from tests/plugins/agents/overseer/pilotAgent.test.ts ----

const pilotPrompt = (goal: string, jobId: string, notes?: string, cli?: string, models?: string, parallelism?: string, rp: PilotRenderPrompt = render) => rawPilotPrompt(goal, jobId, rp, notes, cli, models, parallelism);
const makePilot = (deps: Omit<Parameters<typeof rawMakePilot>[0], 'prompts'> & { prompts?: Parameters<typeof rawMakePilot>[0]['prompts'] }) => rawMakePilot({ prompts, ...deps });

describe('pilotPrompt', () => {
  it('instructs submit via elowen plan submit and forbids implementing', () => {
    const p = pilotPrompt('add CSV export', 'pj-9', 'use the Tasks table');
    expect(p).toContain('elowen plan submit');
    expect(p).toContain('add CSV export');
    expect(p).toContain('use the Tasks table');
    expect(p.toLowerCase()).toContain('do not write any code');
  });
  it('never leaks an unsubstituted relay placeholder into the agent prompt', () => {
    // The agent prompt is self-contained; the relay template ({{goal}}/{{project}}) must not bleed in.
    const p = pilotPrompt('add CSV export', 'pj-9', 'use the Tasks table');
    expect(p).not.toContain('{{');
  });
  it('uses the provided cli invocation verbatim (e.g. node <path> in a checkout)', () => {
    const p = pilotPrompt('g', 'pj-9', undefined, 'node /var/www/elowen/dist/cli/index.js');
    expect(p).toContain('node /var/www/elowen/dist/cli/index.js plan submit');
    expect(p).not.toMatch(/(^|\n)\s*elowen plan submit/); // not the bare default when an explicit cli is given
  });
  it('passes the phases JSON via a quoted heredoc so apostrophes cannot break the shell (O24)', () => {
    const p = pilotPrompt('g', 'pj-9');
    expect(p).toContain("<<'ELOWEN_PHASES'"); // single-quoted heredoc delimiter — no expansion, no quote-breakage
    expect(p).toContain('ELOWEN_PHASES');
    expect(p).not.toContain("--phases '["); // not the fragile inline single-quoted form
  });
  it('tells the Pilot to keep agent names to tmux-safe characters (O26)', () => {
    expect(pilotPrompt('g', 'pj-9').toLowerCase()).toContain('no spaces');
  });
  it('instructs the Pilot to express phase dependencies as a DAG (id + dependsOn)', () => {
    const p = pilotPrompt('g', 'pj-9');
    expect(p).toContain('dependsOn');
    expect(p.toLowerCase()).toContain('dag');
  });
  it('injects the provided parallelism block verbatim', () => {
    const p = pilotPrompt('g', 'pj-9', undefined, 'elowen', undefined, 'PLAN WIDE PLEASE');
    expect(p).toContain('PLAN WIDE PLEASE');
  });
});

describe('makePilot', () => {
  it('uses the plan job planner override instead of the global planner', async () => {
    const launch = vi.fn().mockResolvedValue({ session: 'elowen-pilotX' });
    const pilot = makePilot({
      spawn: { launch } as never,
      config: { get: () => ({ autopilot: { pilotExec: 'claude:sonnet' } }) } as never,
      projects: { get: () => ({ id: 1, path: '/repo' }) } as never,
      planJobs: { setSession: vi.fn() } as never,
      tmux: { list: async () => [] } as never,
      nameAgent: () => 'pilotX',
    });
    await pilot({ id: 'pj-9', goal: 'g', projectId: 1, epicId: null, dryRun: false, status: 'planning', phases: [], pilotExec: 'codex:gpt-5.4' }, '/repo');
    expect(launch.mock.calls[0]![0].spec).toEqual({ program: 'codex', model: 'gpt-5.4' });
  });

  it('spawns an agent in plan mode with ELOWEN_PLAN_JOB in env and the plan prompt as rawPrompt', async () => {
    const launch = vi.fn().mockResolvedValue({ session: 'elowen-pilotX' });
    const pilot = makePilot({
      spawn: { launch } as never,
      config: { get: () => ({ autopilot: { pilotExec: 'claude:opus', prompt: 'TPL {{goal}}', notes: '' } }), apiKey: () => null } as never,
      projects: { get: () => ({ id: 1, path: '/repo', notes: 'N' }) } as never,
      planJobs: { setSession: vi.fn() } as never,
      tmux: { list: async () => [] } as never,
      nameAgent: () => 'pilotX',
      cli: 'node /d/cli/index.js',
    });
    await pilot({ id: 'pj-9', goal: 'g', projectId: 1, epicId: null, dryRun: false, status: 'planning', phases: [] }, '/repo');
    expect(launch).toHaveBeenCalledTimes(1);
    const arg = launch.mock.calls[0]![0];
    expect(arg.spec).toEqual({ program: 'claude-code', model: 'opus' });
    expect(arg.extraEnv).toEqual({ ELOWEN_PLAN_JOB: 'pj-9' });
    expect(arg.projectPath).toBe('/repo');
    expect(arg.rawPrompt).toContain('node /d/cli/index.js plan submit'); // daemon CLI by absolute path
  });

  it('records the spawned tmux session on the plan job so the UI can live-preview the planner', async () => {
    const launch = vi.fn().mockResolvedValue({ session: 'elowen-pilotX' });
    const setSession = vi.fn();
    const pilot = makePilot({
      spawn: { launch } as never,
      config: { get: () => ({ autopilot: { pilotExec: 'claude:opus' } }) } as never,
      projects: { get: () => ({ id: 1, path: '/repo' }) } as never,
      tmux: { list: async () => [] } as never,
      nameAgent: () => 'pilotX',
      planJobs: { setSession } as never,
    });
    await pilot({ id: 'pj-9', goal: 'g', projectId: 1, epicId: null, dryRun: false, status: 'planning', phases: [] }, '/repo');
    expect(setSession).toHaveBeenCalledWith('pj-9', 'elowen-pilotX');
  });

  it('picks a pilot name whose session is not already live (no duplicate-session crash)', async () => {
    const launch = vi.fn().mockResolvedValue({ session: 'elowen-pilot-Atlas' });
    const queue = ['Nova', 'Atlas'];
    const pilot = makePilot({
      spawn: { launch } as never,
      config: { get: () => ({ autopilot: { pilotExec: 'claude:opus' } }) } as never,
      projects: { get: () => ({ id: 1, path: '/repo' }) } as never,
      planJobs: { setSession: vi.fn() } as never,
      tmux: { list: async () => ['elowen-pilot-Nova'] } as never, // a stale pilot session lingers
      nameAgent: () => queue.shift()!,
    });
    await pilot({ id: 'pj-9', goal: 'g', projectId: 1, epicId: null, dryRun: false, status: 'planning', phases: [] }, '/repo');
    expect(launch.mock.calls[0]![0].agentName).toBe('pilot-Atlas'); // skipped the live pilot-Nova
  });
});
