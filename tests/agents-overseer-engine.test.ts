// @vitest-environment node
// Adopted from the Elowen package when the agents plugin moved to this registry. Carries, verbatim:
//   tests/plugins/agents/overseer/missionEngine.test.ts
//   tests/plugins/agents/overseer/missionGitFinish.test.ts
//   tests/plugins/agents/overseer/missionGitWiring.test.ts
//   tests/plugins/agents/overseer/checkout.test.ts
//   tests/plugins/agents/overseer/janitor.test.ts
//   tests/plugins/agents/overseer/scheduler.test.ts
//   tests/plugins/agents/overseer/livenessSweep.test.ts
//   tests/plugins/agents/overseer/routing.test.ts
// The plugin code under test is THIS repo's own build (plugins/agents/dist); the daemon-side collaborators
// come from the published `elowen` package. Section-local helpers that collided across the merged files
// carry a section prefix, and each git-repo fixture's beforeEach/afterEach is scoped to its own describe
// so an unrelated test never pays for a temp checkout it does not use.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { projectHead, projectRangeDiff } from 'elowen/dist/integrations/projectFiles.js';
import { render, setPluginPromptSources } from 'elowen/dist/prompts/index.js';
import { TaskRefs } from 'elowen/dist/store/taskRefs.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { FakeTmuxDriver } from 'elowen/dist/tmux/fakeDriver.js';
import { EventBus } from 'elowen/dist/api/sse.js';
import type { ElowenEvent } from 'elowen/dist/api/sse.js';
import { SystemClock, FakeClock } from 'elowen/dist/shared/clock.js';
import { resolveExecutor } from 'elowen/dist/shared/execRouting.js';
import { BARE_WITH_SLASH_PROGRAM, BARE_PLAIN_PROGRAM, PROGRAM_PREFIXES } from 'elowen/dist/shared/execs.js';
import { TaskStore } from '../plugins/work/dist/store/taskStore.js';
import { Readiness } from '../plugins/work/dist/store/readiness.js';
import { agentsPluginConfig } from '../plugins/agents/dist/config.js';
import { AgentStore } from '../plugins/agents/dist/store/agentStore.js';
import { MissionStore } from '../plugins/agents/dist/store/missionStore.js';
import { MissionPrStore } from '../plugins/agents/dist/store/missionPrStore.js';
import { SpawnService } from '../plugins/agents/dist/spawn/spawn.js';
import { MissionEngine } from '../plugins/agents/dist/overseer/missionEngine.js';
import type { MissionEngineDeps } from '../plugins/agents/dist/overseer/missionEngine.js';
import { MissionGit } from '../plugins/agents/dist/overseer/missionGit.js';
import { Scheduler } from '../plugins/agents/dist/overseer/scheduler.js';
import { checkoutOf, busySharedCheckouts } from '../plugins/agents/dist/overseer/checkout.js';
import { sweepFinishedSessions } from '../plugins/agents/dist/overseer/janitor.js';
import { DecisionQueue } from '../plugins/agents/dist/overseer/decisionQueue.js';
import { PaneActivityTracker } from '../plugins/agents/dist/overseer/paneActivity.js';
import { sweepAgentLiveness, checkAction, type AgentLivenessDeps } from '../plugins/agents/dist/overseer/livenessSweep.js';
import { openPluginTablesDb } from './helpers/pluginTablesDb.js';

// The plugin engine/scheduler take read-only git helpers as a host seam; the core functions
// stand in (the same ones the pre-extraction core imported directly).
const gitSeam = { projectHead, projectRangeDiff };

/** `worker.md` / `worker-phase.md` are the agents plugin's OWN templates now — they live in this repo,
 *  not under elowen/dist/prompts — so the daemon's file renderer cannot resolve them until the plugin
 *  source overlay is installed. The daemon installs it right after loading plugins (see
 *  helpers/domainApp.ts); these suites construct the engine directly, so they install it themselves.
 *  Without it every spawn fails with ENOENT and the tests pass vacuously on the rollback path. */
const AGENTS_PROMPT_DIR = fileURLToPath(new URL('../plugins/agents/prompts', import.meta.url));
setPluginPromptSources(new Map(readdirSync(AGENTS_PROMPT_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => [f.slice(0, -'.md'.length), join(AGENTS_PROMPT_DIR, f)])));

const promptSeam = { render: (n: string, v?: Record<string, string>) => render(n, v), rawTemplate: () => '' };

/** `git -C <cwd> …`, shared by the two sections that drive a real repo (identical in both originals). */
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

// ---- from tests/plugins/agents/overseer/missionEngine.test.ts ----

function engineSetup(opts?: { summarize?: MissionEngineDeps['summarize'] }) {
  const db = openPluginTablesDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const tasks = new TaskStore(db);
  tasks.create({ id: 'epic', project_id: 1, title: 'E', type: 'epic' });
  tasks.create({ id: 't1', project_id: 1, title: 'one', parent_id: 'epic', labels: ['exec:opencode:ollama-cloud/deepseek-v4-flash'] });
  tasks.create({ id: 't2', project_id: 1, title: 'two', parent_id: 'epic', labels: ['exec:opencode:ollama-cloud/deepseek-v4-flash'] });
  tasks.addDep('t2', 't1');
  const tmux = new FakeTmuxDriver();
  const bus = new EventBus();
  const missions = new MissionStore(db);
  const engine = new MissionEngine({ git: gitSeam,
    tasks, taskRefs: new TaskRefs(db), readiness: new Readiness(db), missions,
    spawn: new SpawnService({ prompts: promptSeam, tmux, agents: new AgentStore(db) }), tmux, bus,
    projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' },
    nameAgent: () => 'AgentX', clock: new SystemClock(), summarize: opts?.summarize,
  });
  return { tasks, tmux, engine, bus, missions };
}

describe('MissionEngine', () => {
  it('reverts a task to open (and publishes it) when spawn.launch throws', async () => {
    const db = openPluginTablesDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const tasks = new TaskStore(db);
    tasks.create({ id: 'epic', project_id: 1, title: 'E', type: 'epic' });
    tasks.create({ id: 't1', project_id: 1, title: 'one', parent_id: 'epic' });
    const bus = new EventBus();
    const events: ElowenEvent[] = []; bus.subscribe((e) => events.push(e));
    const engine = new MissionEngine({ git: gitSeam,
      tasks, taskRefs: new TaskRefs(db), readiness: new Readiness(db), missions: new MissionStore(db),
      spawn: { launch: vi.fn().mockRejectedValue(new Error('tmux down')) } as unknown as SpawnService,
      tmux: new FakeTmuxDriver(), bus, projects: new ProjectStore(db),
      fallback: { program: 'claude-code', model: 'sonnet' }, nameAgent: () => 'AgentX', clock: new SystemClock(),
    });
    await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    expect(tasks.get('t1')!.status).toBe('open'); // rolled back — not left in_progress burning relaunch budget
    expect(events.some((e) => e.type === 'task' && e.taskId === 't1' && e.status === 'open')).toBe(true);
  });

  it('engage clears a stale reviewfix budget so a re-engaged mission gets a fresh self-heal allowance', async () => {
    const { tasks, engine } = engineSetup();
    tasks.addLabel('t1', 'reviewfix:2'); // left over from a prior aborted/buggy run
    await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    expect(tasks.get('t1')!.labels.some((l) => l.startsWith('reviewfix:'))).toBe(false); // reset → full budget again
  });

  it('publishes an in_progress task event after a successful spawn so the UI sees it running', async () => {
    const { tasks, engine, bus } = engineSetup();
    const events: ElowenEvent[] = []; bus.subscribe((e) => events.push(e));
    await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    expect(tasks.get('t1')!.status).toBe('in_progress'); // t1 (no deps) was dispatched
    // Without the publish the DB flips to in_progress but the web cache never invalidates, so the task
    // stays hidden as "not running" until some unrelated event refreshes it.
    expect(events.some((e) => e.type === 'task' && e.taskId === 't1' && e.status === 'in_progress')).toBe(true);
  });

  it('serializes ready phases that share a non-PR checkout, even with max_sessions > 1 (C1)', async () => {
    const db = openPluginTablesDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const tasks = new TaskStore(db);
    tasks.create({ id: 'epic', project_id: 1, title: 'E', type: 'epic' });
    // Two independent (no dep) phases → both dependency-cleared and ready at once.
    tasks.create({ id: 'a', project_id: 1, title: 'A', parent_id: 'epic', labels: ['exec:opencode:ollama-cloud/deepseek-v4-flash'] });
    tasks.create({ id: 'b', project_id: 1, title: 'B', parent_id: 'epic', labels: ['exec:opencode:ollama-cloud/deepseek-v4-flash'] });
    let n = 0;
    const engine = new MissionEngine({ git: gitSeam,
      tasks, taskRefs: new TaskRefs(db), readiness: new Readiness(db), missions: new MissionStore(db),
      spawn: new SpawnService({ prompts: promptSeam, tmux: new FakeTmuxDriver(), agents: new AgentStore(db) }), tmux: new FakeTmuxDriver(),
      bus: new EventBus(), projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' },
      nameAgent: () => `A${n++}`, clock: new SystemClock(),
    });
    await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 2 }); // budget would allow 2 in parallel
    const live = ['a', 'b'].filter((id) => tasks.get(id)?.status === 'in_progress');
    expect(live).toHaveLength(1); // non-PR phases share project.path → serialized to one, despite max_sessions: 2
  });

  it('coalesces a tick requested while one is already in flight into exactly one extra pass (M1)', async () => {
    const db = openPluginTablesDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const tasks = new TaskStore(db);
    tasks.create({ id: 'epic', project_id: 1, title: 'E', type: 'epic' });
    tasks.create({ id: 't1', project_id: 1, title: 'one', parent_id: 'epic' });
    let ensureCalls = 0; // overseer.ensure runs once per tickOnce → a proxy for how many passes ran
    const overseer = { start: async () => {}, ensure: async () => { ensureCalls++; }, stop: async () => {} };
    const engine = new MissionEngine({ git: gitSeam,
      tasks, taskRefs: new TaskRefs(db), readiness: new Readiness(db), missions: new MissionStore(db),
      spawn: new SpawnService({ prompts: promptSeam, tmux: new FakeTmuxDriver(), agents: new AgentStore(db) }), tmux: new FakeTmuxDriver(),
      bus: new EventBus(), projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' },
      nameAgent: () => 'A0', clock: new SystemClock(), overseer,
    });
    await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    ensureCalls = 0; // ignore the engage tick
    // Two ticks fired together: the 2nd lands while the 1st is in flight. It must not be dropped (which
    // would delay freed work up to 90s) — it coalesces into one extra pass after the 1st completes.
    await Promise.all([engine.tick('m-epic'), engine.tick('m-epic')]);
    expect(ensureCalls).toBe(2);
  });

  it('keeps review self-heal budgets on a PR-feedback re-engage but resets them on a fresh engage (M3)', async () => {
    const db = openPluginTablesDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const tasks = new TaskStore(db);
    tasks.create({ id: 'epic', project_id: 1, title: 'E', type: 'epic' });
    tasks.create({ id: 'a', project_id: 1, title: 'A', parent_id: 'epic', status: 'closed' }); // a finished phase…
    tasks.bumpReviewFix('a'); tasks.bumpReviewFix('a');                                          // …that burned 2 retries
    const hasBudget = () => tasks.get('a')!.labels.some((l) => l.startsWith('reviewfix:'));
    const engine = new MissionEngine({ git: gitSeam,
      tasks, taskRefs: new TaskRefs(db), readiness: new Readiness(db), missions: new MissionStore(db),
      spawn: new SpawnService({ prompts: promptSeam, tmux: new FakeTmuxDriver(), agents: new AgentStore(db) }), tmux: new FakeTmuxDriver(),
      bus: new EventBus(), projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' },
      nameAgent: () => 'A0', clock: new SystemClock(),
    });
    await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1, preserveReviewBudget: true });
    expect(hasBudget()).toBe(true);  // PR-feedback continuation must NOT hand the burned phase a fresh budget
    await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    expect(hasBudget()).toBe(false); // a fresh engage clears stale reviewfix labels as before
  });

  it('stopTask kills the worker session of a single task so a re-open re-spawns cleanly', async () => {
    const { tasks, tmux, engine } = engineSetup();
    tasks.setAgent('t1', 'Worker1');
    await tmux.spawn('elowen-Worker1', { command: 'sleep', cwd: '/o' });
    expect(await tmux.list()).toContain('elowen-Worker1');
    await engine.stopTask('t1'); // a worker that outlived its task close must be reaped before re-spawn
    expect(await tmux.list()).not.toContain('elowen-Worker1');
  });

  it('stopTask is a no-op for a task with no agent label or no live session', async () => {
    const { engine, tmux } = engineSetup();
    await engine.stopTask('t2');                      // t2 has no agent label
    await engine.stopTask('missing');                 // task does not exist
    expect(await tmux.list()).toEqual([]);            // nothing killed, nothing thrown
  });

  it('a stalled (escalated) mission is frozen — a tick spawns nothing and leaves it stalled', async () => {
    const { engine, tmux, missions } = engineSetup();
    missions.create({ id: 'm-epic', epic_id: 'epic', autonomy: 'L3', max_sessions: 1 });
    missions.setState('m-epic', 'stalled'); // escalated → waiting on a human
    await engine.tick('m-epic');
    expect(await tmux.list()).toEqual([]);                  // frozen: the ready head (t1) is NOT spawned
    expect(missions.get('m-epic')!.state).toBe('stalled');  // still frozen, no churn
  });

  it('resumeStalled un-freezes a stalled mission and ticks so the freed head spawns', async () => {
    const { engine, tmux, missions, bus } = engineSetup();
    const events: ElowenEvent[] = []; bus.subscribe((e) => events.push(e));
    missions.create({ id: 'm-epic', epic_id: 'epic', autonomy: 'L3', max_sessions: 1 });
    missions.setState('m-epic', 'stalled');
    await engine.resumeStalled('m-epic');
    expect(missions.get('m-epic')!.state).toBe('active');                                  // un-frozen
    expect(events.some((e) => e.type === 'mission' && e.state === 'active')).toBe(true);   // announced
    expect(await tmux.list()).toContain('elowen-AgentX');                                    // ready head spawned
  });

  it('resumeStalled never resurrects a disengaged mission', async () => {
    const { engine, tmux, missions } = engineSetup();
    missions.create({ id: 'm-epic', epic_id: 'epic', autonomy: 'L3', max_sessions: 1 });
    missions.setState('m-epic', 'disengaged');
    await engine.resumeStalled('m-epic');
    expect(missions.get('m-epic')!.state).toBe('disengaged'); // not flipped to active
    expect(await tmux.list()).toEqual([]);                    // and nothing spawned
  });

  it('L1 (Assist) auto-spawns the ready head', async () => {
    const { tmux, engine } = engineSetup();
    await engine.engage({ epicId: 'epic', autonomy: 'L1', maxSessions: 1 });
    expect(await tmux.list()).toContain('elowen-AgentX'); // L1 dispatches work; the overseer gates its prompts later
  });

  it('picks a worker name clear of a lingering session (no duplicate-session crash)', async () => {
    const { tmux, engine } = engineSetup();
    await tmux.spawn('elowen-AgentX', { cwd: '/o', command: 'zombie' }); // a stale worker session lingers
    await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    const live = await tmux.list();
    // The new worker avoids the live name entirely — its session is a distinct, non-colliding handle…
    const fresh = live.filter((s) => s !== 'elowen-AgentX' && s.startsWith('elowen-AgentX'));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).not.toBe('elowen-AgentX'); // …so `tmux new-session` can never see a duplicate
  });

  it('L0 (Recommend) spawns nothing — the plan only gets proposed', async () => {
    const { tasks, tmux, engine } = engineSetup();
    await engine.engage({ epicId: 'epic', autonomy: 'L0', maxSessions: 1 });
    expect(await tmux.list()).not.toContain('elowen-AgentX');
    expect(tasks.get('t1')!.status).toBe('open'); // untouched
  });

  it('engages, spawns the ready head, advances on completion, auto-disengages', async () => {
    const { tasks, tmux, engine } = engineSetup();
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    expect(await tmux.list()).toContain('elowen-AgentX'); // t1 spawned
    // simulate t1 done
    tasks.setStatus('t1', 'closed'); await tmux.kill('elowen-AgentX');
    await engine.tick(m.id);
    expect(await tmux.list()).toContain('elowen-AgentX'); // t2 spawned
    tasks.setStatus('t2', 'closed'); await tmux.kill('elowen-AgentX');
    await engine.tick(m.id);
    expect(engine.isActive(m.id)).toBe(false); // auto-disengaged
  });

  it('on completion writes the overseer mission summary onto the epic before disengaging', async () => {
    const summarize = vi.fn().mockResolvedValue('Mise proběhla hladce, obě fáze hotové.');
    const { tasks, tmux, engine } = engineSetup({ summarize });
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    tasks.close('t1', { summary: 'first done', outcome: 'ok' }); await tmux.kill('elowen-AgentX');
    await engine.tick(m.id); // spawns t2
    tasks.close('t2', { summary: 'second done', outcome: 'ok' }); await tmux.kill('elowen-AgentX');
    await engine.tick(m.id); // completion → summarize + close epic + disengage
    // The overseer model is handed the goal + each phase's outcome/summary, and its prose is stamped on the epic.
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({
      goal: 'E',
      phases: expect.arrayContaining([expect.objectContaining({ title: 'one', summary: 'first done' })]),
    }));
    const epic = tasks.get('epic')!;
    expect(epic.status).toBe('closed');
    expect(epic.result_summary).toBe('Mise proběhla hladce, obě fáze hotové.');
    expect(engine.isActive(m.id)).toBe(false);
  });

  it('falls back to a deterministic phase digest on completion when no summarizer is wired', async () => {
    const { tasks, tmux, engine } = engineSetup(); // no summarize dep → engine synthesises the digest itself
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    tasks.close('t1', { summary: 'wrote the parser', outcome: 'ok' }); await tmux.kill('elowen-AgentX');
    await engine.tick(m.id);
    tasks.close('t2', { summary: 'added tests', outcome: 'ok' }); await tmux.kill('elowen-AgentX');
    await engine.tick(m.id);
    const epic = tasks.get('epic')!;
    expect(epic.status).toBe('closed');
    expect(epic.result_summary).toContain('one'); // both phase titles surface in the digest
    expect(epic.result_summary).toContain('two');
  });

  it('does not count unrelated global elowen- sessions against max_sessions', async () => {
    const { tmux, engine } = engineSetup();
    await tmux.spawn('elowen-OtherProject', { cwd: '/x', command: 'sleep 1' }); // foreign session
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    expect(engine.isActive(m.id)).toBe(true);
    expect(await tmux.list()).toContain('elowen-AgentX'); // head still spawned despite the foreign session
  });

  it('engage() publishes mission active event', async () => {
    const { engine, bus } = engineSetup();
    const events: ElowenEvent[] = [];
    bus.subscribe(e => events.push(e));
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    const missionEvents = events.filter(e => e.type === 'mission');
    expect(missionEvents[0]).toMatchObject({ type: 'mission', missionId: m.id, state: 'active' });
  });

  it('auto-disengage publishes mission disengaged event', async () => {
    const { tasks, tmux, engine, bus } = engineSetup();
    const events: ElowenEvent[] = [];
    bus.subscribe(e => events.push(e));
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    // close all tasks and tick to trigger auto-disengage
    tasks.setStatus('t1', 'closed'); await tmux.kill('elowen-AgentX');
    await engine.tick(m.id);
    tasks.setStatus('t2', 'closed'); await tmux.kill('elowen-AgentX');
    await engine.tick(m.id);
    const disengaged = events.filter(e => e.type === 'mission' && e.state === 'disengaged');
    expect(disengaged.length).toBeGreaterThanOrEqual(1);
    expect(disengaged[0]).toMatchObject({ type: 'mission', missionId: m.id, state: 'disengaged' });
  });

  it('disengage kills the running agent and reverts its task to open', async () => {
    const { tasks, tmux, engine } = engineSetup();
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    expect(await tmux.list()).toContain('elowen-AgentX');
    expect(tasks.get('t1')!.status).toBe('in_progress');
    await engine.disengage(m.id);
    expect(await tmux.list()).not.toContain('elowen-AgentX'); // session killed, not left running
    expect(tasks.get('t1')!.status).toBe('open');           // reverted so the UI no longer reads "running"
    expect(engine.isActive(m.id)).toBe(false);
  });

  it('pause stops the running agent and reverts its task (resume re-spawns it)', async () => {
    const { tasks, tmux, engine } = engineSetup();
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    await engine.pause(m.id);
    expect(await tmux.list()).not.toContain('elowen-AgentX');
    expect(tasks.get('t1')!.status).toBe('open');
    expect(engine.isActive(m.id)).toBe(false); // paused, not active
  });

  /** Two parallel in_progress children whose sessions are live; `kill` misbehaves for `elowen-a` per
   *  the injected `killA` (which may or may not actually end the session). */
  async function stopRunningSetup(killA: (base: FakeTmuxDriver) => void | Promise<void>) {
    const db = openPluginTablesDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const tasks = new TaskStore(db);
    tasks.create({ id: 'epic', project_id: 1, title: 'E', type: 'epic' });
    tasks.create({ id: 'a', project_id: 1, title: 'a', parent_id: 'epic' });
    tasks.create({ id: 'b', project_id: 1, title: 'b', parent_id: 'epic' });
    for (const id of ['a', 'b']) { tasks.setAgent(id, id); tasks.setStatus(id, 'in_progress'); }
    const base = new FakeTmuxDriver();
    await base.spawn('elowen-a', { cwd: '/o', command: 'x' });
    await base.spawn('elowen-b', { cwd: '/o', command: 'x' });
    const tmux = {
      list: () => base.list(),
      kill: async (s: string) => { if (s === 'elowen-a') return killA(base); return base.kill(s); },
    } as never;
    const engine = new MissionEngine({ git: gitSeam,
      tasks, taskRefs: new TaskRefs(db), readiness: new Readiness(db), missions: new MissionStore(db),
      spawn: new SpawnService({ prompts: promptSeam, tmux, agents: new AgentStore(db) }), tmux, bus: new EventBus(),
      projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' },
      nameAgent: () => 'AgentX', clock: new SystemClock(),
    });
    return { tasks, base, engine };
  }

  it('stopRunning reverts a child whose session really did exit, even if its kill threw (O3)', async () => {
    // The session exited between list() and kill, so the driver rejects — the agent is genuinely gone.
    const { tasks, engine } = await stopRunningSetup(async (base) => {
      await base.kill('elowen-a');
      throw new Error('already gone');
    });
    const stopped = await engine.stopRunning('epic');
    expect(stopped).toBe(2);
    expect(tasks.get('a')!.status).toBe('open'); // a throwing kill did NOT strand the rest in_progress
    expect(tasks.get('b')!.status).toBe('open');
  });

  it('stopRunning leaves a child in_progress when its session survived the kill', async () => {
    // The kill failed for real (tmux unreachable): the agent is STILL writing in the checkout, so
    // advertising the task as 'open' would let a resume put a second agent on the same files.
    const { tasks, base, engine } = await stopRunningSetup(() => { throw new Error('tmux unreachable'); });
    const stopped = await engine.stopRunning('epic');
    expect(stopped).toBe(1);
    expect(await base.list()).toContain('elowen-a');
    expect(tasks.get('a')!.status).toBe('in_progress'); // not reverted while its agent is alive
    expect(tasks.get('b')!.status).toBe('open');        // the healthy sibling is still stopped
  });

  it('disengage and pause are idempotent — a repeat call emits no second event (O6)', async () => {
    const { engine, bus } = engineSetup();
    const events: ElowenEvent[] = [];
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    bus.subscribe((e) => events.push(e));
    await engine.disengage(m.id);
    await engine.disengage(m.id); // no-op: already disengaged
    expect(events.filter((e) => e.type === 'mission' && e.state === 'disengaged')).toHaveLength(1);
  });

  it('pause is idempotent — a repeat call emits no second paused event (O6)', async () => {
    const { engine, bus } = engineSetup();
    const events: ElowenEvent[] = [];
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    bus.subscribe((e) => events.push(e));
    await engine.pause(m.id);
    await engine.pause(m.id); // no-op: already paused
    expect(events.filter((e) => e.type === 'mission' && e.state === 'paused')).toHaveLength(1);
  });
});

describe('MissionEngine overseer lifecycle', () => {
  function setup(overseer?: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; ensure?: ReturnType<typeof vi.fn> }) {
    const db = openPluginTablesDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const tasks = new TaskStore(db);
    tasks.create({ id: 'epic', project_id: 1, title: 'E', type: 'epic' });
    tasks.create({ id: 'g1', project_id: 1, title: 'Add auth login flow', parent_id: 'epic' });
    const tmux = new FakeTmuxDriver();
    const missions = new MissionStore(db);
    const engine = new MissionEngine({ git: gitSeam,
      tasks, taskRefs: new TaskRefs(db), readiness: new Readiness(db), missions,
      spawn: new SpawnService({ prompts: promptSeam, tmux, agents: new AgentStore(db) }), tmux, bus: new EventBus(),
      projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' },
      nameAgent: () => 'AgentX', clock: new SystemClock(),
      // Default a no-op ensure so partial {start,stop} mocks still satisfy the tick watchdog.
      overseer: overseer ? ({ ensure: vi.fn().mockResolvedValue(undefined), ...overseer } as never) : undefined,
    });
    return { tasks, tmux, engine, missions };
  }

  it('starts the overseer on engage', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue(undefined);
    const { engine } = setup({ start, stop });
    await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    expect(start).toHaveBeenCalledWith('m-epic', 1, '/o');
  });

  it('stops the overseer on disengage', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const { engine } = setup({ start: vi.fn().mockResolvedValue(undefined), stop });
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    await engine.disengage(m.id);
    expect(stop).toHaveBeenCalledWith(m.id);
  });

  it('stops the overseer when a mission completes on its own (no leak)', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const { tasks, engine } = setup({ start: vi.fn().mockResolvedValue(undefined), stop });
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    tasks.setStatus('g1', 'closed'); // the only child closes → next tick self-disengages
    await engine.tick(m.id);
    expect(engine.isActive(m.id)).toBe(false);
    expect(stop).toHaveBeenCalledWith(m.id);
  });

  it('re-parks the overseer on every tick (watchdog) so a died overseer is restored mid-mission', async () => {
    // The parked overseer can exit on its own (full context / clean exit per its prompt). Nothing else
    // re-parks it mid-mission, so its post-phase reviews would silently stop. The tick must keep it alive.
    const ensure = vi.fn().mockResolvedValue(undefined);
    const { engine } = setup({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined), ensure });
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    ensure.mockClear();
    await engine.tick(m.id);
    expect(ensure).toHaveBeenCalledWith(m.id, 1, '/o');
  });

  it('does not re-park the overseer for a mission that completes on this tick (it is being stopped)', async () => {
    const ensure = vi.fn().mockResolvedValue(undefined);
    const { tasks, engine } = setup({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined), ensure });
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    tasks.setStatus('g1', 'closed'); // all kids closed → this tick self-disengages
    ensure.mockClear();
    await engine.tick(m.id);
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe('MissionEngine multi-project', () => {
  it('drives a mission in a non-home project and spawns in that project\'s path', async () => {
    const db = openPluginTablesDb(':memory:');
    db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    db.prepare("INSERT INTO projects (id,slug,path) VALUES (2,'other','/p2')").run();
    const tasks = new TaskStore(db);
    tasks.create({ id: 'epic2', project_id: 2, title: 'E2', type: 'epic' });
    tasks.create({ id: 'x1', project_id: 2, title: 'work', parent_id: 'epic2', labels: ['exec:opencode:ollama-cloud/deepseek-v4-flash'] });
    const tmux = new FakeTmuxDriver();
    const engine = new MissionEngine({ git: gitSeam,
      tasks, taskRefs: new TaskRefs(db), readiness: new Readiness(db), missions: new MissionStore(db),
      spawn: new SpawnService({ prompts: promptSeam, tmux, agents: new AgentStore(db) }), tmux, bus: new EventBus(),
      projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' },
      nameAgent: () => 'AgentX', clock: new SystemClock(),
    });
    await engine.engage({ epicId: 'epic2', autonomy: 'L3', maxSessions: 1 });
    expect(await tmux.list()).toContain('elowen-AgentX');
    expect(tmux.commandFor('elowen-AgentX')).toContain('/p2'); // launched in project 2, not the home '/o'
    expect(tasks.get('x1')!.status).toBe('in_progress');
  });
});

// ---- from tests/plugins/agents/overseer/missionGitFinish.test.ts ----

let finBase: string, finRepo: string, finRemote: string, finBinDir: string, finOrigPath: string | undefined;

function fakeGh(script: string) {
  const p = join(finBinDir, 'gh');
  writeFileSync(p, `#!/usr/bin/env bash\n${script}\n`); chmodSync(p, 0o755);
}

function build(opts: { prAutoOpen: boolean; verify: string }) {
  const db = openPluginTablesDb(':memory:');
  const projects = new ProjectStore(db);
  const project = projects.create({ slug: 'demo', path: finRepo });
  const tasks = new TaskStore(db);
  tasks.create({ id: 'epic', project_id: project.id, title: 'Build the thing', type: 'epic' });
  const config = new ConfigStore(db);
  config.update({ autopilot: { prEnabled: true, prAutoOpen: opts.prAutoOpen, prVerifyCommand: opts.verify, ghToken: 'tok' } });
  const prs = new MissionPrStore(db);
  const missionGit = new MissionGit({ prs, pluginConfig: () => agentsPluginConfig({}, config as never), projects, tasks });
  return { missionGit, prs, tasks, projects, project };
}

/** The original file's top-level beforeEach/afterEach. Scoped to this section's two describes in the
 *  merged suite so an unrelated test never provisions (or pays for) a real git repo + fake `gh`. */
function finBeforeEach() {
  finBase = mkdtempSync(join(tmpdir(), 'elowen-fin-'));
  finRepo = join(finBase, 'project'); mkdirSync(finRepo);
  finRemote = join(finBase, 'remote.git');
  finBinDir = join(finBase, 'bin'); mkdirSync(finBinDir);
  finOrigPath = process.env.PATH; process.env.PATH = `${finBinDir}:${finOrigPath}`;
  git(finRepo, 'init', '-q', '-b', 'main');
  git(finRepo, 'config', 'user.email', 'test@elowen.dev'); git(finRepo, 'config', 'user.name', 'Elowen Test');
  writeFileSync(join(finRepo, 'README.md'), '# repo\n'); git(finRepo, 'add', '-A'); git(finRepo, 'commit', '-q', '-m', 'init');
  execFileSync('git', ['init', '-q', '--bare', finRemote]);
  git(finRepo, 'remote', 'add', 'origin', finRemote);
  git(finRepo, 'push', '-q', 'origin', 'main');
}
function finAfterEach() { process.env.PATH = finOrigPath; rmSync(finBase, { recursive: true, force: true }); }

describe('MissionGit.finishMission (Stage 4)', () => {
  beforeEach(finBeforeEach);
  afterEach(finAfterEach);

  it('verifies, pushes and opens a PR on the happy path (auto)', async () => {
    fakeGh(`if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "https://github.com/o/r/pull/55"; fi`);
    const { missionGit, prs } = build({ prAutoOpen: true, verify: 'true' });
    await missionGit.onEngage('m-epic', 'epic');
    writeFileSync(join(prs.get('m-epic')!.worktree, 'a.txt'), 'work\n');
    await missionGit.commitPhase('m-epic', 'phase one');

    const res = await missionGit.finishMission('m-epic');
    expect(res).toEqual({ state: 'opened', url: 'https://github.com/o/r/pull/55', number: 55 });
    const rec = prs.get('m-epic')!;
    expect(rec.pr_number).toBe(55);
    expect(rec.pr_state).toBe('open');
    // The branch reached the remote.
    expect(git(finRemote, 'branch', '--list', 'elowen/demo-epic').trim()).toContain('elowen/demo-epic');
  });

  it('holds the mission (no PR) when the verify gate fails', async () => {
    fakeGh(`echo "should-not-run" ; exit 3`);
    const { missionGit, prs } = build({ prAutoOpen: true, verify: 'exit 1' });
    await missionGit.onEngage('m-epic', 'epic');
    writeFileSync(join(prs.get('m-epic')!.worktree, 'a.txt'), 'work\n');
    await missionGit.commitPhase('m-epic', 'phase one');

    const res = await missionGit.finishMission('m-epic');
    expect(res.state).toBe('verify-failed');
    expect(prs.get('m-epic')!.pr_state).toBe('verify_failed');
    expect(missionGit.prState('m-epic')).toBe('verify_failed');
    // No branch pushed to the remote.
    expect(git(finRemote, 'branch', '--list', 'elowen/demo-epic').trim()).toBe('');
  });

  it('returns ready (no PR) in manual mode, then opens it on openPr', async () => {
    fakeGh(`if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "https://github.com/o/r/pull/8"; fi`);
    const { missionGit, prs } = build({ prAutoOpen: false, verify: '' });
    await missionGit.onEngage('m-epic', 'epic');
    writeFileSync(join(prs.get('m-epic')!.worktree, 'a.txt'), 'work\n');
    await missionGit.commitPhase('m-epic', 'phase one');

    expect((await missionGit.finishMission('m-epic')).state).toBe('ready'); // auto-open off → waits
    expect(prs.get('m-epic')!.pr_state).toBe('ready'); // persisted so the "Open PR" affordance is gated on completion

    const res = await missionGit.openPr('m-epic'); // manual trigger
    expect(res).toEqual({ state: 'opened', url: 'https://github.com/o/r/pull/8', number: 8 });
    expect(prs.get('m-epic')!.pr_state).toBe('open');
  });

  it('refuses a manual openPr while the mission is mid-flight (not yet ready)', async () => {
    // The regression: the "Open PR" affordance opened a partial PR after only the first phase. The
    // manual open must refuse until finishMission has marked the mission 'ready' (all phases done +
    // verified) — pr_state is still null here (just engaged, work in progress).
    fakeGh(`echo "should-not-create" ; exit 9`);
    const { missionGit, prs } = build({ prAutoOpen: false, verify: '' });
    await missionGit.onEngage('m-epic', 'epic');
    writeFileSync(join(prs.get('m-epic')!.worktree, 'a.txt'), 'phase one work\n');
    await missionGit.commitPhase('m-epic', 'phase one');

    const res = await missionGit.openPr('m-epic'); // user clicks "Open PR" before the mission finished
    expect(res.state).toBe('incomplete');
    expect(prs.get('m-epic')!.pr_state).toBeNull(); // unchanged — no PR opened
    expect(git(finRemote, 'branch', '--list', 'elowen/demo-epic').trim()).toBe(''); // nothing pushed
  });

  it('a project pr_enabled=false suppresses the PR worktree even when the global default is on', async () => {
    const { missionGit, prs, projects, project } = build({ prAutoOpen: true, verify: '' });
    projects.update(project.id, { pr_enabled: false }); // per-project override wins over the global default
    await missionGit.onEngage('m-epic', 'epic');
    expect(prs.get('m-epic')).toBeNull(); // PR mode off for this project → no worktree provisioned
  });

  it('an epic pr:off label suppresses the worktree even when project + global are on', async () => {
    const { missionGit, prs, projects, project, tasks } = build({ prAutoOpen: true, verify: '' });
    projects.update(project.id, { pr_enabled: true }); // project on, global on…
    tasks.addLabel('epic', 'pr:off'); // …but this task opted out
    await missionGit.onEngage('m-epic', 'epic');
    expect(prs.get('m-epic')).toBeNull(); // per-task override wins → no PR worktree
  });

  it('an epic pr:on label forces the worktree even when the project override is off', async () => {
    const { missionGit, prs, projects, project, tasks } = build({ prAutoOpen: false, verify: '' });
    projects.update(project.id, { pr_enabled: false }); // project override would suppress it…
    tasks.addLabel('epic', 'pr:on'); // …but this task opted in — the most-specific override wins
    await missionGit.onEngage('m-epic', 'epic');
    expect(prs.get('m-epic')).not.toBeNull(); // per-task override wins → PR worktree provisioned
  });

  it('mergePr squash-merges an open PR and records it merged + clears the budget', async () => {
    fakeGh(`
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '{"state":"OPEN","mergeable":"MERGEABLE","statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS"}]}'; fi
if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then exit 0; fi`);
    const { missionGit, prs } = build({ prAutoOpen: false, verify: '' });
    await missionGit.onEngage('m-epic', 'epic');
    prs.setPr('m-epic', { number: 8, url: 'https://github.com/o/r/pull/8', state: 'open' });
    prs.bumpFixRounds('m-epic'); // simulate a prior fix round

    const res = await missionGit.mergePr('m-epic');
    expect(res.ok).toBe(true);
    expect(prs.get('m-epic')!.pr_state).toBe('merged');
    expect(prs.get('m-epic')!.fix_rounds).toBe(0);
  });

  it('mergePr succeeds even when the post-merge branch delete fails (no false refusal)', async () => {
    // The regression: `gh pr merge --squash --delete-branch` exited non-zero because the branch delete
    // failed, AFTER the squash-merge had already landed — so the merge was reported as refused. Merge
    // and delete are now separate; a failing delete must not undo a successful merge.
    fakeGh(`
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '{"state":"OPEN","mergeable":"MERGEABLE","statusCheckRollup":[],"headRefName":"elowen/demo-epic"}'; fi
if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then exit 0; fi
if [ "$1" = "api" ]; then exit 1; fi`); // the branch delete fails
    const { missionGit, prs } = build({ prAutoOpen: false, verify: '' });
    await missionGit.onEngage('m-epic', 'epic');
    prs.setPr('m-epic', { number: 8, url: 'https://github.com/o/r/pull/8', state: 'open' });

    const res = await missionGit.mergePr('m-epic');
    expect(res.ok).toBe(true); // merge landed; the failed branch delete is best-effort
    expect(prs.get('m-epic')!.pr_state).toBe('merged');
  });

  it('mergePr refuses (no state change) when the PR has no open record', async () => {
    fakeGh(`exit 0`);
    const { missionGit, prs } = build({ prAutoOpen: false, verify: '' });
    await missionGit.onEngage('m-epic', 'epic'); // worktree exists, but no PR opened
    const res = await missionGit.mergePr('m-epic');
    expect(res.ok).toBe(false);
    expect(prs.get('m-epic')!.pr_state).toBeNull();
  });

  it('auto-pushes a fix round onto an already-open PR even in manual mode', async () => {
    // gh create fails ("already exists") → falls back to gh pr view → the existing PR is re-read; the
    // point is finishMission must PUSH (not return ready) once a PR is open, so the fix reaches the PR.
    fakeGh(`
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "already exists" >&2; exit 1; fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '{"number":8,"url":"https://github.com/o/r/pull/8"}'; fi`);
    const { missionGit, prs } = build({ prAutoOpen: false, verify: '' });
    await missionGit.onEngage('m-epic', 'epic');
    const wt = prs.get('m-epic')!.worktree;
    writeFileSync(join(wt, 'a.txt'), 'work\n'); await missionGit.commitPhase('m-epic', 'phase one');
    prs.setPr('m-epic', { number: 8, url: 'https://github.com/o/r/pull/8', state: 'open' }); // PR already open

    writeFileSync(join(wt, 'fix.txt'), 'the fix\n'); await missionGit.commitPhase('m-epic', 'fix round');
    const res = await missionGit.finishMission('m-epic'); // manual mode, but PR is open → must push
    expect(res.state).toBe('opened'); // NOT 'ready'
    // The fix commit reached the remote branch.
    expect(git(finRemote, 'log', '--oneline', 'elowen/demo-epic').trim()).toContain('fix round');
  });
});

describe('MissionGit worktree placement', () => {
  beforeEach(finBeforeEach);
  afterEach(finAfterEach);

  // The mission id is `m-${epicId}` and an epic id can be client-supplied, so it reaches this path as
  // untrusted input. Unsanitized it escapes the worktree root — and since cleanup runs
  // `git worktree remove --force` on whatever it finds there, an escape is a delete primitive, not just
  // a stray directory. The API schema rejects such an id too; this covers the inner layer, which has to
  // hold for any id that reaches the engine by another route.
  it('keeps a traversal-shaped epic id inside the worktree root', async () => {
    const { missionGit, prs, tasks, project } = build({ prAutoOpen: false, verify: 'true' });
    const evilId = '../../../../tmp/elowen-escape-probe';
    tasks.create({ id: evilId, project_id: project.id, title: 'Traversal probe', type: 'epic' });

    await missionGit.onEngage(`m-${evilId}`, evilId);

    const rec = prs.get(`m-${evilId}`);
    expect(rec, 'the mission should still be provisioned, just somewhere safe').toBeTruthy();
    const root = resolve(join(finBase, '.elowen-worktrees'));
    expect(resolve(rec!.worktree).startsWith(`${root}/`)).toBe(true);
    expect(rec!.worktree).not.toContain('..');
  });
});

// ---- from tests/plugins/agents/overseer/missionGitWiring.test.ts ----

let wiringBase: string;   // unique parent so the sibling `.elowen-worktrees/` dir is isolated + cleaned
let wiringRepo: string;

function wiringSetup(prEnabled: boolean) {
  const db = openPluginTablesDb(':memory:');
  const projects = new ProjectStore(db);
  const project = projects.create({ slug: 'demo', path: wiringRepo });
  const tasks = new TaskStore(db);
  tasks.create({ id: 'epic', project_id: project.id, title: 'E', type: 'epic' });
  tasks.create({ id: 't1', project_id: project.id, title: 'first phase', parent_id: 'epic' });
  const config = new ConfigStore(db);
  config.update({ autopilot: { prEnabled } });
  const prs = new MissionPrStore(db);
  const missionGit = new MissionGit({ prs, pluginConfig: () => agentsPluginConfig({}, config as never), projects, tasks });
  const tmux = new FakeTmuxDriver();
  const launch = vi.fn().mockResolvedValue({ session: 'elowen-AgentX' });
  const engine = new MissionEngine({ git: gitSeam,
    tasks, taskRefs: new TaskRefs(db), readiness: new Readiness(db), missions: new MissionStore(db),
    spawn: { launch } as unknown as SpawnService, tmux, bus: new EventBus(),
    projects, fallback: { program: 'claude-code', model: 'sonnet' },
    nameAgent: () => 'AgentX', clock: new SystemClock(), missionGit,
  });
  return { engine, prs, launch, missionGit };
}

describe('MissionEngine × MissionGit (PR-native)', () => {
  beforeEach(() => {
    wiringBase = mkdtempSync(join(tmpdir(), 'elowen-eng-'));
    wiringRepo = join(wiringBase, 'project');
    mkdirSync(wiringRepo);
    git(wiringRepo, 'init', '-q', '-b', 'main');
    git(wiringRepo, 'config', 'user.email', 'test@elowen.dev');
    git(wiringRepo, 'config', 'user.name', 'Elowen Test');
    writeFileSync(join(wiringRepo, 'README.md'), '# repo\n');
    git(wiringRepo, 'add', '-A'); git(wiringRepo, 'commit', '-q', '-m', 'init');
  });
  afterEach(() => { rmSync(wiringBase, { recursive: true, force: true }); });

  it('engage spawns the agent inside the mission worktree when PR mode is on', async () => {
    const { engine, prs, launch } = wiringSetup(true);
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    const rec = prs.get(m.id);
    expect(rec).not.toBeNull();
    expect(rec!.branch).toBe('elowen/demo-epic');
    expect(existsSync(rec!.worktree)).toBe(true);
    // The first phase agent launches with the worktree as its cwd, not the main checkout.
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ projectPath: rec!.worktree }));
  });

  it('spawns in the main checkout (no worktree) when PR mode is off', async () => {
    const { engine, prs, launch } = wiringSetup(false);
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    expect(prs.get(m.id)).toBeNull();
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ projectPath: wiringRepo }));
  });

  it('disengage removes the worktree but keeps the branch', async () => {
    const { engine, prs } = wiringSetup(true);
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    const dir = prs.get(m.id)!.worktree;
    await engine.disengage(m.id);
    expect(existsSync(dir)).toBe(false);
    expect(prs.get(m.id)).toBeNull();
    expect(git(wiringRepo, 'branch', '--list', 'elowen/demo-epic').trim()).toContain('elowen/demo-epic');
  });

  it('pause keeps the worktree with the running phase\'s uncommitted work, and resume reuses it', async () => {
    const { engine, prs } = wiringSetup(true);
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    const dir = prs.get(m.id)!.worktree;
    // What the stopped phase's agent had produced but not yet closed — Elowen only commits at close.
    writeFileSync(join(dir, 'wip.txt'), 'work in progress\n');

    await engine.pause(m.id);
    expect(existsSync(join(dir, 'wip.txt'))).toBe(true); // pause must not destroy uncommitted work
    expect(prs.get(m.id)!.worktree).toBe(dir);

    await engine.resume(m.id);
    expect(prs.get(m.id)!.worktree).toBe(dir);          // same worktree, not a fresh one off the branch
    expect(existsSync(join(dir, 'wip.txt'))).toBe(true);
  });

  it('commitPhase records the phase work as a commit on the branch', async () => {
    const { engine, prs, missionGit } = wiringSetup(true);
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    const dir = prs.get(m.id)!.worktree;
    writeFileSync(join(dir, 'feature.txt'), 'work\n');
    expect(await missionGit.commitPhase(m.id, 'first phase')).toBe(true);
    expect(git(dir, 'log', '-1', '--pretty=%s').trim()).toBe('first phase');
  });

  it('commitPhase rejects on a git failure instead of reporting a clean tree', async () => {
    const { engine, prs, missionGit } = wiringSetup(true);
    const m = await engine.engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    const dir = prs.get(m.id)!.worktree;
    expect(await missionGit.commitPhase(m.id, 'nothing to do')).toBe(false); // clean tree → false

    writeFileSync(join(dir, 'feature.txt'), 'work\n');
    rmSync(join(dir, '.git')); // break the worktree link → every git call in it fails
    // The phase's work is still on disk and uncommitted, so this must NOT look like "clean tree".
    await expect(missionGit.commitPhase(m.id, 'first phase')).rejects.toThrow();
  });
});

// ---- from tests/plugins/agents/overseer/checkout.test.ts ----

const projectPath = (id: number) => (id === 1 ? '/o' : '/p2');

describe('checkoutOf', () => {
  it('maps a standalone task to its shared project path', () => {
    expect(checkoutOf({ projectPath }, { project_id: 1, parent_id: null })).toBe('/o');
  });

  it('maps a PR-mission phase to its isolated worktree, else the shared path', () => {
    const worktreeFor = (mid: string) => (mid === 'm-epicA' ? '/wt/A' : null);
    expect(checkoutOf({ projectPath, worktreeFor }, { project_id: 1, parent_id: 'epicA' })).toBe('/wt/A');
    expect(checkoutOf({ projectPath, worktreeFor }, { project_id: 1, parent_id: 'epicB' })).toBe('/o'); // no worktree → shared
  });
});

describe('busySharedCheckouts', () => {
  it('lists shared checkouts occupied by in-progress tasks, excluding isolated worktrees', () => {
    const worktreeFor = (mid: string) => (mid === 'm-iso' ? '/wt/iso' : null);
    const busy = busySharedCheckouts({ projectPath, worktreeFor }, [
      { project_id: 1, parent_id: null },   // standalone in /o → shared
      { project_id: 2, parent_id: null },   // standalone in /p2 → shared
      { project_id: 1, parent_id: 'iso' },  // PR phase in its own worktree → NOT shared
    ]);
    expect([...busy].sort()).toEqual(['/o', '/p2']);
    expect(busy.has('/wt/iso')).toBe(false); // isolated worktree never marked busy
  });

  it('is empty when nothing is in progress', () => {
    expect(busySharedCheckouts({ projectPath }, []).size).toBe(0);
  });
});

// ---- from tests/plugins/agents/overseer/janitor.test.ts ----

describe('sweepFinishedSessions', () => {
  it('kills elowen- sessions whose task is closed/cancelled, keeps the rest', async () => {
    const tmux = new FakeTmuxDriver();
    await tmux.spawn('elowen-Done', { cwd: '/o', command: 'x' });
    await tmux.spawn('elowen-Running', { cwd: '/o', command: 'x' });
    await tmux.spawn('elowen-Unknown', { cwd: '/o', command: 'x' });
    await tmux.spawn('jat-Other', { cwd: '/o', command: 'x' }); // foreign — never touched
    const statuses: Record<string, string> = { 'elowen-Done': 'closed', 'elowen-Running': 'in_progress' };
    const reaped = await sweepFinishedSessions({
      tmux,
      taskForSession: (s) => { const name = s.replace(/^elowen-/, ''); const st = statuses[`elowen-${name}`]; return st ? { status: st as never } : null; },
    });
    expect(reaped).toEqual(['elowen-Done']);
    const live = await tmux.list();
    expect(live).toContain('elowen-Running'); // in-progress kept
    expect(live).toContain('elowen-Unknown'); // no task → kept (don't reap unknown)
    expect(live).toContain('jat-Other');    // foreign kept
    expect(live).not.toContain('elowen-Done');
  });
});

// ---- from tests/plugins/agents/overseer/scheduler.test.ts ----

function schedulerSetup(now: number) {
  const db = openPluginTablesDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const tasks = new TaskStore(db);
  const tmux = new FakeTmuxDriver();
  const spawn = new SpawnService({ prompts: promptSeam, tmux, agents: new AgentStore(db) });
  const scheduler = new Scheduler({ git: gitSeam, tasks, spawn, bus: new EventBus(), projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' }, nameAgent: () => 'Nova', clock: new FakeClock(now) });
  return { tasks, tmux, scheduler };
}

describe('Scheduler', () => {
  it('launches a due autostart task once its scheduled_at has passed and clears the schedule', async () => {
    const t0 = Date.parse('2026-06-17T12:00:00.000Z');
    const { tasks, tmux, scheduler } = schedulerSetup(t0 + 60_000); // now is one minute after the schedule
    tasks.create({ id: 'a', project_id: 1, title: 'Scheduled', scheduled_at: '2026-06-17T12:00:00.000Z', autostart: 1 });
    await scheduler.tick();
    expect(tasks.get('a')?.status).toBe('in_progress');
    expect(tasks.get('a')?.scheduled_at).toBeNull(); // consumed
    expect(await tmux.list()).toContain('elowen-Nova');
  });


  it('does not launch a due task without autostart (due-date marker only)', async () => {
    const t0 = Date.parse('2026-06-17T12:00:00.000Z');
    const { tasks, tmux, scheduler } = schedulerSetup(t0 + 60_000); // past the schedule
    tasks.create({ id: 'd', project_id: 1, title: 'Due but manual', scheduled_at: '2026-06-17T12:00:00.000Z' });
    await scheduler.tick();
    expect(tasks.get('d')?.status).toBe('open');
    expect(tasks.get('d')?.scheduled_at).toBe('2026-06-17T12:00:00.000Z'); // kept as a due date
    expect(await tmux.list()).toHaveLength(0);
  });

  it('does not launch a task scheduled in the future', async () => {
    const t0 = Date.parse('2026-06-17T12:00:00.000Z');
    const { tasks, tmux, scheduler } = schedulerSetup(t0); // now is before the schedule
    tasks.create({ id: 'b', project_id: 1, title: 'Later', scheduled_at: '2026-06-17T18:00:00.000Z' });
    await scheduler.tick();
    expect(tasks.get('b')?.status).toBe('open');
    expect(await tmux.list()).toHaveLength(0);
  });

  it('ignores tasks without a schedule', async () => {
    const { tasks, scheduler } = schedulerSetup(Date.parse('2026-06-17T12:00:00.000Z'));
    tasks.create({ id: 'c', project_id: 1, title: 'Unscheduled' });
    await scheduler.tick();
    expect(tasks.get('c')?.status).toBe('open');
  });

  it('fires a task scheduled with a non-UTC zone for the same instant (#39)', async () => {
    // 10:00+02:00 === 08:00Z. Lexically '2026-06-17T10:00:00+02:00' > the UTC `now` string, so the old
    // string compare would wrongly judge it not-due. Epoch compare gets the instant right.
    const now = Date.parse('2026-06-17T08:00:30.000Z'); // 30s after the scheduled instant
    const { tasks, scheduler } = schedulerSetup(now);
    tasks.create({ id: 'tz', project_id: 1, title: 'Zoned', scheduled_at: '2026-06-17T10:00:00+02:00', autostart: 1 });
    await scheduler.tick();
    expect(tasks.get('tz')?.status).toBe('in_progress'); // due by absolute time despite the zone
    expect(tasks.get('tz')?.scheduled_at).toBeNull();
  });

  it('serializes due tasks that share a non-PR checkout — one agent at a time (C1)', async () => {
    // 5 due tasks in one project share its working tree. A shared checkout is single-writer (parallel
    // agents would clobber each other's edits and muddle per-task change attribution), so each tick
    // launches at most one; the rest stay open and fire on later ticks once the checkout frees.
    const t0 = Date.parse('2026-06-17T12:00:00.000Z');
    const db = openPluginTablesDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const tasks = new TaskStore(db);
    const tmux = new FakeTmuxDriver();
    let n = 0;
    const scheduler = new Scheduler({ git: gitSeam, tasks, spawn: new SpawnService({ prompts: promptSeam, tmux, agents: new AgentStore(db) }), bus: new EventBus(), projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' }, nameAgent: () => `N${n++}`, clock: new FakeClock(t0 + 60_000) });
    for (let i = 0; i < 5; i++) tasks.create({ id: `s${i}`, project_id: 1, title: `S${i}`, scheduled_at: '2026-06-17T12:00:00.000Z', autostart: 1 });
    await scheduler.tick();
    const live = () => ['s0', 's1', 's2', 's3', 's4'].filter((id) => tasks.get(id)?.status === 'in_progress');
    expect(live()).toHaveLength(1);              // only one agent in the shared checkout
    expect((await tmux.list()).length).toBe(1);
    await scheduler.tick();
    expect(live()).toHaveLength(1);              // still occupied — the next task waits
    tasks.setStatus(live()[0], 'closed');        // first agent finishes → checkout frees
    await scheduler.tick();
    expect(live()).toHaveLength(1);              // the next one fires now
  });

  it('flips a task to in_progress BEFORE the baseline await, so a concurrent tick sees the checkout busy', async () => {
    // Cross-tick gate correctness: the scheduler yields at the gitLock await while stamping the baseline.
    // If the task were still 'open' at that point, a concurrent mission/scheduler tick computing `busy`
    // from the in_progress list would miss it and launch a second agent into the same shared checkout.
    const t0 = Date.parse('2026-06-17T12:00:00.000Z');
    const db = openPluginTablesDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const tasks = new TaskStore(db);
    const tmux = new FakeTmuxDriver();
    let statusAtAwait: string | undefined; // the task's status at the moment the lock body (first await) runs
    const gitLock = { run: async (_key: string, fn: () => Promise<unknown>) => { statusAtAwait = tasks.get('a')?.status; return fn(); } };
    const scheduler = new Scheduler({ git: gitSeam, tasks, spawn: new SpawnService({ prompts: promptSeam, tmux, agents: new AgentStore(db) }), bus: new EventBus(), projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' }, nameAgent: () => 'Nova', clock: new FakeClock(t0 + 60_000), gitLock: gitLock as never });
    tasks.create({ id: 'a', project_id: 1, title: 'A', scheduled_at: '2026-06-17T12:00:00.000Z', autostart: 1 });
    await scheduler.tick();
    expect(statusAtAwait).toBe('in_progress'); // flipped before we yielded — the gate can't be raced across ticks
  });

  it('re-reads the busy set FRESH per task, so a checkout occupied mid-tick by another writer blocks a later task (C1 cross-tick)', async () => {
    // The scheduler and the mission engine tick concurrently. This reproduces the cross-tick race with a
    // single deterministic tick: while the scheduler is awaiting project 1's baseline (gitLock), another
    // writer claims project 2's checkout (flips x2 in_progress). A stale tick-start snapshot would miss
    // that and still launch project 2's due task; the fresh per-task read must hold it instead.
    const t0 = Date.parse('2026-06-17T12:00:00.000Z');
    const db = openPluginTablesDb(':memory:');
    db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    db.prepare("INSERT INTO projects (id,slug,path) VALUES (2,'other','/p2')").run();
    const tasks = new TaskStore(db);
    const tmux = new FakeTmuxDriver();
    tasks.create({ id: 'x2', project_id: 2, title: 'X2' }); // not due — just the checkout another writer claims
    tasks.create({ id: 'q', project_id: 1, title: 'Q', scheduled_at: '2026-06-17T12:00:00.000Z', autostart: 1 });
    tasks.create({ id: 'p', project_id: 2, title: 'P', scheduled_at: '2026-06-17T12:00:00.000Z', autostart: 1 });
    let flipped = false;
    const gitLock = { run: async (_key: string, fn: () => Promise<unknown>) => {
      if (!flipped) { flipped = true; tasks.setStatus('x2', 'in_progress'); } // /p2 claimed mid-tick, after the snapshot
      return fn();
    } };
    let n = 0;
    const scheduler = new Scheduler({ git: gitSeam, tasks, spawn: new SpawnService({ prompts: promptSeam, tmux, agents: new AgentStore(db) }), bus: new EventBus(), projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' }, nameAgent: () => `N${n++}`, clock: new FakeClock(t0 + 60_000), gitLock: gitLock as never });
    await scheduler.tick();
    expect(tasks.get('q')?.status).toBe('in_progress'); // project 1 launched normally
    expect(tasks.get('p')?.status).toBe('open');        // project 2 was claimed mid-tick → fresh read holds it
  });

  it('launches tasks in DIFFERENT projects concurrently — separate checkouts never block each other', async () => {
    const t0 = Date.parse('2026-06-17T12:00:00.000Z');
    const db = openPluginTablesDb(':memory:');
    db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    db.prepare("INSERT INTO projects (id,slug,path) VALUES (2,'other','/p2')").run();
    const tasks = new TaskStore(db);
    const tmux = new FakeTmuxDriver();
    let n = 0;
    const scheduler = new Scheduler({ git: gitSeam, tasks, spawn: new SpawnService({ prompts: promptSeam, tmux, agents: new AgentStore(db) }), bus: new EventBus(), projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' }, nameAgent: () => `N${n++}`, clock: new FakeClock(t0 + 60_000) });
    tasks.create({ id: 'a', project_id: 1, title: 'A', scheduled_at: '2026-06-17T12:00:00.000Z', autostart: 1 });
    tasks.create({ id: 'b', project_id: 2, title: 'B', scheduled_at: '2026-06-17T12:00:00.000Z', autostart: 1 });
    await scheduler.tick();
    expect(['a', 'b'].filter((id) => tasks.get(id)?.status === 'in_progress')).toHaveLength(2); // both fired — different checkouts
  });

  it('restores the schedule (and status open) when the spawn fails (O9)', async () => {
    const t0 = Date.parse('2026-06-17T12:00:00.000Z');
    const db = openPluginTablesDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const tasks = new TaskStore(db);
    const failingSpawn = { launch: async () => { throw new Error('tmux down'); } };
    const scheduler = new Scheduler({ git: gitSeam, tasks, spawn: failingSpawn as never, bus: new EventBus(), projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' }, nameAgent: () => 'Nova', clock: new FakeClock(t0 + 60_000) });
    tasks.create({ id: 'f', project_id: 1, title: 'Will fail', scheduled_at: '2026-06-17T12:00:00.000Z', autostart: 1 });
    await scheduler.tick();
    expect(tasks.get('f')?.status).toBe('open');                          // rolled back, not stuck in_progress
    expect(tasks.get('f')?.scheduled_at).toBe('2026-06-17T12:00:00.000Z'); // schedule restored → retries next tick
  });

  it('does NOT republish change for a running task with no base label (no live-history thrash)', async () => {
    // Regression: a task in_progress without a `base:` label makes snapshotTaskChanges a no-op, so
    // head_sha stays null. The raw HEAD-vs-null compare would publish `change` every tick forever; the
    // re-read of the actually-stamped head_sha must keep it silent.
    const repo = mkdtempSync(join(tmpdir(), 'elowen-sched-'));
    const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
    git('init', '-q'); git('config', 'user.email', 't@t.io'); git('config', 'user.name', 'T');
    writeFileSync(join(repo, 'f.txt'), 'v0'); git('add', '-A'); git('commit', '-q', '-m', 'c0');
    try {
      const db = openPluginTablesDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'r',?)").run(repo);
      const tasks = new TaskStore(db);
      const bus = new EventBus(); const changes: string[] = [];
      bus.subscribe((e) => { if (e.type === 'change') changes.push(e.taskId); });
      const scheduler = new Scheduler({ git: gitSeam, tasks, spawn: new SpawnService({ prompts: promptSeam, tmux: new FakeTmuxDriver(), agents: new AgentStore(db) }), bus, projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' }, nameAgent: () => 'N', clock: new FakeClock(0) });
      tasks.create({ id: 'nb', project_id: 1, title: 'No base' }); tasks.setStatus('nb', 'in_progress');
      await scheduler.tick();
      await scheduler.tick();
      expect(changes).toEqual([]); // never thrashes
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  it('publishes a single change and refreshes the snapshot when a running task lands a new commit', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'elowen-sched-'));
    const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
    git('init', '-q'); git('config', 'user.email', 't@t.io'); git('config', 'user.name', 'T');
    writeFileSync(join(repo, 'f.txt'), 'v0'); git('add', '-A'); git('commit', '-q', '-m', 'c0');
    const base = git('rev-parse', 'HEAD').toString().trim();
    try {
      const db = openPluginTablesDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'r',?)").run(repo);
      const tasks = new TaskStore(db);
      const bus = new EventBus(); const changes: string[] = [];
      bus.subscribe((e) => { if (e.type === 'change') changes.push(e.taskId); });
      const scheduler = new Scheduler({ git: gitSeam, tasks, spawn: new SpawnService({ prompts: promptSeam, tmux: new FakeTmuxDriver(), agents: new AgentStore(db) }), bus, projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' }, nameAgent: () => 'N', clock: new FakeClock(0) });
      tasks.create({ id: 'wb', project_id: 1, title: 'With base' }); tasks.setStatus('wb', 'in_progress');
      tasks.markBase('wb', base);            // baseline stamped at spawn
      writeFileSync(join(repo, 'f.txt'), 'v1\nv2'); git('add', '-A'); git('commit', '-q', '-m', 'task commit');
      await scheduler.tick();
      expect(changes).toEqual(['wb']);                          // exactly one change
      expect(tasks.get('wb')?.changed_files.length).toBeGreaterThan(0); // snapshot refreshed mid-run
      await scheduler.tick();
      expect(changes).toEqual(['wb']);                          // HEAD unchanged → no republish
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  it('launches due autostart tasks across every project', async () => {
    const t0 = Date.parse('2026-06-17T12:00:00.000Z');
    const db = openPluginTablesDb(':memory:');
    db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    db.prepare("INSERT INTO projects (id,slug,path) VALUES (2,'other','/p2')").run();
    const tasks = new TaskStore(db);
    const tmux = new FakeTmuxDriver();
    let n = 0;
    const scheduler = new Scheduler({ git: gitSeam, tasks, spawn: new SpawnService({ prompts: promptSeam, tmux, agents: new AgentStore(db) }), bus: new EventBus(), projects: new ProjectStore(db), fallback: { program: 'claude-code', model: 'sonnet' }, nameAgent: () => `N${n++}`, clock: new FakeClock(t0 + 60_000) });
    tasks.create({ id: 'p1t', project_id: 1, title: 'P1', scheduled_at: '2026-06-17T12:00:00.000Z', autostart: 1 });
    tasks.create({ id: 'p2t', project_id: 2, title: 'P2', scheduled_at: '2026-06-17T12:00:00.000Z', autostart: 1 });
    await scheduler.tick();
    expect(tasks.get('p1t')?.status).toBe('in_progress');
    expect(tasks.get('p2t')?.status).toBe('in_progress'); // a different project's task also fired
    expect(tmux.commandFor('elowen-N1')).toContain('/p2'); // project 2 launched in its own path
  });
});

// ---- from tests/plugins/agents/overseer/livenessSweep.test.ts ----

const WORKER_IDLE = 300_000, OVERSEER_IDLE = 600_000, GRACE = 90_000, HARD = 1_800_000;

type RunOpts = {
  sessions: string[];
  now: number;
  tracker: PaneActivityTracker;
  pane?: (s: string) => string;
  deadSince?: Map<string, number>;
  inflight?: Set<string>;
  lastProgressAt?: Map<string, number>;
  progressReviewMs?: number;
  sessionTaskId?: AgentLivenessDeps['sessionTaskId'];
  programFor?: AgentLivenessDeps['programFor'];
  hasPrompt?: AgentLivenessDeps['hasPrompt'];
  checkWorker?: AgentLivenessDeps['checkWorker'];
};
const run = (q: DecisionQueue, o: RunOpts) =>
  sweepAgentLiveness({
    tmux: { list: async () => o.sessions, capturePane: async (s) => (o.pane ? o.pane(s) : 'static') },
    queue: q, tracker: o.tracker, now: o.now,
    deadSince: o.deadSince ?? new Map(), inflightChecks: o.inflight ?? new Set(),
    lastProgressAt: o.lastProgressAt ?? new Map(),
    sessionTaskId: o.sessionTaskId ?? (() => null),
    programFor: o.programFor ?? (() => 'claude-code'),
    hasPrompt: o.hasPrompt ?? (() => false),
    checkWorker: o.checkWorker ?? (async () => {}),
    workerIdleMs: WORKER_IDLE, overseerIdleMs: OVERSEER_IDLE, graceMs: GRACE, hardMs: HARD,
    progressReviewMs: o.progressReviewMs ?? 0, // disabled by default — most tests exercise the idle/wedge path
  });

describe('sweepAgentLiveness — overseer side', () => {
  it('NEVER escalates a live overseer whose pane keeps changing (the core fix: thinking ≠ stuck)', async () => {
    const q = new DecisionQueue(() => 0);
    const v = q.enqueue('m1', 'review', {});
    let settled = false; void v.then(() => { settled = true; });
    const tracker = new PaneActivityTracker(); const deadSince = new Map<string, number>();
    let frame = 0; const pane = () => `frame${frame}`;
    await run(q, { sessions: ['elowen-overseer-m1'], pane, now: 0, tracker, deadSince });
    frame = 1; await run(q, { sessions: ['elowen-overseer-m1'], pane, now: OVERSEER_IDLE, tracker, deadSince });
    frame = 2; const r = await run(q, { sessions: ['elowen-overseer-m1'], pane, now: 2 * OVERSEER_IDLE, tracker, deadSince });
    expect(r.escalated).toEqual([]);
    expect(settled).toBe(false);
  });

  it('escalates a live overseer whose own pane has been static past the idle bar (wedged)', async () => {
    const q = new DecisionQueue(() => 0);
    const v = q.enqueue('m1', 'review', {});
    const id = q.pending()[0]!.id;
    const tracker = new PaneActivityTracker();
    await run(q, { sessions: ['elowen-overseer-m1'], pane: () => 'frozen', now: 0, tracker });
    const r = await run(q, { sessions: ['elowen-overseer-m1'], pane: () => 'frozen', now: OVERSEER_IDLE, tracker });
    expect(r.escalated).toEqual([id]);
    await expect(v).resolves.toMatchObject({ escalated: true, rationale: 'overseer timeout' });
  });

  it('does not escalate a live static overseer still under the idle bar', async () => {
    const q = new DecisionQueue(() => 0);
    q.enqueue('m1', 'review', {});
    const tracker = new PaneActivityTracker();
    await run(q, { sessions: ['elowen-overseer-m1'], pane: () => 'frozen', now: 0, tracker });
    const r = await run(q, { sessions: ['elowen-overseer-m1'], pane: () => 'frozen', now: OVERSEER_IDLE - 1, tracker });
    expect(r.escalated).toEqual([]);
  });

  it('the high absolute backstop escalates even a changing-pane overseer (animating-but-not-polling)', async () => {
    const q = new DecisionQueue(() => 0);
    void q.enqueue('m1', 'review', {});
    const id = q.pending()[0]!.id;
    const tracker = new PaneActivityTracker();
    let frame = 0; const pane = () => `frame${frame}`;
    await run(q, { sessions: ['elowen-overseer-m1'], pane, now: 0, tracker });
    frame = 1; const r = await run(q, { sessions: ['elowen-overseer-m1'], pane, now: HARD, tracker });
    expect(r.escalated).toEqual([id]); // pane idle is 0 (changed), but enqueuedAt is HARD ago
  });

  it('does not escalate a dead overseer within the grace window', async () => {
    const q = new DecisionQueue(() => 0);
    q.enqueue('m1', 'review', {});
    const tracker = new PaneActivityTracker(); const deadSince = new Map<string, number>();
    expect((await run(q, { sessions: [], now: 1000, tracker, deadSince })).escalated).toEqual([]);
    expect((await run(q, { sessions: [], now: 1000 + GRACE - 1, tracker, deadSince })).escalated).toEqual([]);
    expect(deadSince.get('m1')).toBe(1000);
  });

  it('escalates ALL pending for an overseer dead past the grace window', async () => {
    const q = new DecisionQueue(() => 0);
    const a = q.enqueue('m1', 'review', {});
    const b = q.enqueue('m1', 'prompt', {});
    const ids = q.pending().map((e) => e.id);
    const tracker = new PaneActivityTracker(); const deadSince = new Map<string, number>();
    await run(q, { sessions: [], now: 0, tracker, deadSince });
    const r = await run(q, { sessions: [], now: GRACE, tracker, deadSince });
    expect(r.escalated.sort()).toEqual([...ids].sort());
    await expect(a).resolves.toMatchObject({ escalated: true });
    await expect(b).resolves.toMatchObject({ escalated: true });
    expect(deadSince.has('m1')).toBe(false);
  });

  it('does not escalate when a dead overseer re-parks before grace elapses', async () => {
    const q = new DecisionQueue(() => 0);
    const v = q.enqueue('m1', 'review', {});
    let settled = false; void v.then(() => { settled = true; });
    const tracker = new PaneActivityTracker(); const deadSince = new Map<string, number>();
    await run(q, { sessions: [], now: 0, tracker, deadSince });
    const r = await run(q, { sessions: ['elowen-overseer-m1'], pane: () => 'x', now: 60_000, tracker, deadSince });
    expect(r.escalated).toEqual([]);
    expect(settled).toBe(false);
    expect(deadSince.has('m1')).toBe(false);
  });

  it('prunes deadSince for missions answered since the last sweep', async () => {
    const q = new DecisionQueue(() => 0);
    q.enqueue('m1', 'review', {});
    const tracker = new PaneActivityTracker(); const deadSince = new Map<string, number>();
    await run(q, { sessions: [], now: 0, tracker, deadSince });
    expect(deadSince.has('m1')).toBe(true);
    q.resolve('m1', q.pending()[0]!.id, { approve: true, confidence: 1, rationale: 'ok' });
    await run(q, { sessions: [], now: 1000, tracker, deadSince });
    expect(deadSince.has('m1')).toBe(false);
  });
});

describe('sweepAgentLiveness — worker side', () => {
  const workerBase = (checkWorker: AgentLivenessDeps['checkWorker'], tracker: PaneActivityTracker, inflight: Set<string>, over: Partial<RunOpts> = {}): RunOpts => ({
    sessions: ['elowen-patricia'], pane: () => 'wedged', tracker, inflight, now: 0,
    sessionTaskId: () => 't1', programFor: () => 'claude-code', hasPrompt: () => false, checkWorker, ...over,
  });

  it('wakes the overseer (checkWorker) for a worker idle past the bar with no prompt on screen', async () => {
    const q = new DecisionQueue(() => 0);
    const tracker = new PaneActivityTracker(); const inflight = new Set<string>();
    const checkWorker = vi.fn(() => new Promise<void>(() => { /* stays in-flight */ }));
    await run(q, workerBase(checkWorker, tracker, inflight, { now: 0 }));            // idle 0
    const r = await run(q, workerBase(checkWorker, tracker, inflight, { now: WORKER_IDLE })); // idle = bar
    expect(checkWorker).toHaveBeenCalledTimes(1);
    expect(checkWorker).toHaveBeenCalledWith('elowen-patricia', 't1', 'wedged', 5, 'idle');
    expect(inflight.has('elowen-patricia')).toBe(true);
    expect(r.checked).toEqual(['elowen-patricia']);
  });

  it('does not check a worker that is sitting on a structured prompt (the deriver owns needs_input)', async () => {
    const q = new DecisionQueue(() => 0);
    const tracker = new PaneActivityTracker(); const inflight = new Set<string>();
    const checkWorker = vi.fn(async () => {});
    await run(q, workerBase(checkWorker, tracker, inflight, { now: 0, hasPrompt: () => true }));
    await run(q, workerBase(checkWorker, tracker, inflight, { now: WORKER_IDLE, hasPrompt: () => true }));
    expect(checkWorker).not.toHaveBeenCalled();
  });

  it('does not act on an empty capture (vanished session — stuck-detector domain)', async () => {
    const q = new DecisionQueue(() => 0);
    const tracker = new PaneActivityTracker(); const inflight = new Set<string>();
    const checkWorker = vi.fn(async () => {});
    await run(q, workerBase(checkWorker, tracker, inflight, { now: 0, pane: () => '' }));
    await run(q, workerBase(checkWorker, tracker, inflight, { now: WORKER_IDLE, pane: () => '' }));
    expect(checkWorker).not.toHaveBeenCalled();
  });

  it('in-flight guard: a static worker is checked once, not every tick', async () => {
    const q = new DecisionQueue(() => 0);
    const tracker = new PaneActivityTracker(); const inflight = new Set<string>();
    const checkWorker = vi.fn(() => new Promise<void>(() => { /* stays in-flight */ }));
    await run(q, workerBase(checkWorker, tracker, inflight, { now: 0 }));
    await run(q, workerBase(checkWorker, tracker, inflight, { now: WORKER_IDLE }));        // check #1
    await run(q, workerBase(checkWorker, tracker, inflight, { now: WORKER_IDLE + 30_000 })); // still in-flight → skip
    expect(checkWorker).toHaveBeenCalledTimes(1);
  });

  it('skips a worker session with no task row', async () => {
    const q = new DecisionQueue(() => 0);
    const tracker = new PaneActivityTracker(); const inflight = new Set<string>();
    const checkWorker = vi.fn(async () => {});
    await run(q, workerBase(checkWorker, tracker, inflight, { now: 0, sessionTaskId: () => null }));
    await run(q, workerBase(checkWorker, tracker, inflight, { now: WORKER_IDLE, sessionTaskId: () => null }));
    expect(checkWorker).not.toHaveBeenCalled();
  });

  it('skips pilot and advisor sessions entirely', async () => {
    const q = new DecisionQueue(() => 0);
    const tracker = new PaneActivityTracker(); const inflight = new Set<string>();
    const checkWorker = vi.fn(async () => {});
    const base = (now: number): RunOpts => ({ sessions: ['elowen-pilot-planner', 'elowen-advisor-7'], pane: () => 'frozen', tracker, inflight, now, sessionTaskId: () => 't1', checkWorker });
    await run(q, base(0));
    await run(q, base(WORKER_IDLE));
    expect(checkWorker).not.toHaveBeenCalled();
  });
});

describe('sweepAgentLiveness — progress check (routine glance at a WORKING worker)', () => {
  const PROGRESS = 600_000;
  // An actively-working worker: its pane changes every tick, so its idle stays at 0 (never wedged).
  const active = (checkWorker: AgentLivenessDeps['checkWorker'], tracker: PaneActivityTracker, inflight: Set<string>, lastProgressAt: Map<string, number>, frame: () => number, over: Partial<RunOpts> = {}): RunOpts => ({
    sessions: ['elowen-iris'], pane: () => `frame${frame()}`, tracker, inflight, lastProgressAt, progressReviewMs: PROGRESS,
    now: 0, sessionTaskId: () => 't1', programFor: () => 'claude-code', hasPrompt: () => false, checkWorker, ...over,
  });

  it('first sight seeds the clock and does not fire; fires reason "progress" only once the interval elapses', async () => {
    const q = new DecisionQueue(() => 0);
    const tracker = new PaneActivityTracker(); const inflight = new Set<string>(); const lastProgressAt = new Map<string, number>();
    const checkWorker = vi.fn(async () => {});
    let f = 0; const frame = () => f;
    f = 0; await run(q, active(checkWorker, tracker, inflight, lastProgressAt, frame, { now: 0 }));        // first sight → seed
    expect(checkWorker).not.toHaveBeenCalled();
    expect(lastProgressAt.get('elowen-iris')).toBe(0);
    f = 1; await run(q, active(checkWorker, tracker, inflight, lastProgressAt, frame, { now: PROGRESS - 1 })); // not due yet
    expect(checkWorker).not.toHaveBeenCalled();
    f = 2; const r = await run(q, active(checkWorker, tracker, inflight, lastProgressAt, frame, { now: PROGRESS })); // due
    expect(checkWorker).toHaveBeenCalledTimes(1);
    expect(checkWorker).toHaveBeenCalledWith('elowen-iris', 't1', 'frame2', 0, 'progress');
    expect(r.checked).toEqual(['elowen-iris']);
  });

  it('never fires when progress review is disabled (progressReviewMs = 0)', async () => {
    const q = new DecisionQueue(() => 0);
    const tracker = new PaneActivityTracker(); const inflight = new Set<string>(); const lastProgressAt = new Map<string, number>();
    const checkWorker = vi.fn(async () => {});
    let f = 0; const frame = () => f;
    f = 0; await run(q, active(checkWorker, tracker, inflight, lastProgressAt, frame, { now: 0, progressReviewMs: 0 }));
    f = 1; await run(q, active(checkWorker, tracker, inflight, lastProgressAt, frame, { now: 10 * PROGRESS, progressReviewMs: 0 }));
    expect(checkWorker).not.toHaveBeenCalled();
  });

  it('does not progress-check a worker sitting on a structured prompt', async () => {
    const q = new DecisionQueue(() => 0);
    const tracker = new PaneActivityTracker(); const inflight = new Set<string>(); const lastProgressAt = new Map<string, number>();
    const checkWorker = vi.fn(async () => {});
    let f = 0; const frame = () => f;
    f = 0; await run(q, active(checkWorker, tracker, inflight, lastProgressAt, frame, { now: 0, hasPrompt: () => true }));
    f = 1; await run(q, active(checkWorker, tracker, inflight, lastProgressAt, frame, { now: PROGRESS, hasPrompt: () => true }));
    expect(checkWorker).not.toHaveBeenCalled();
  });

  it('an idle-past-the-bar worker takes the wedge path even when a progress check would be due', async () => {
    const q = new DecisionQueue(() => 0);
    const tracker = new PaneActivityTracker(); const inflight = new Set<string>(); const lastProgressAt = new Map<string, number>();
    const checkWorker = vi.fn(async () => {});
    // Static pane → idle grows to the bar. progressReviewMs small so progress would also be "due".
    const base = (now: number): RunOpts => ({ sessions: ['elowen-iris'], pane: () => 'wedged', tracker, inflight, lastProgressAt, progressReviewMs: 100_000, now, sessionTaskId: () => 't1', programFor: () => 'claude-code', hasPrompt: () => false, checkWorker });
    await run(q, base(0));
    await run(q, base(WORKER_IDLE));
    expect(checkWorker).toHaveBeenCalledTimes(1);
    expect(checkWorker).toHaveBeenCalledWith('elowen-iris', 't1', 'wedged', 5, 'idle');
  });

  it('the shared in-flight guard blocks a progress check while any check is awaiting the overseer', async () => {
    const q = new DecisionQueue(() => 0);
    const tracker = new PaneActivityTracker(); const inflight = new Set<string>(['elowen-iris']); const lastProgressAt = new Map<string, number>([['elowen-iris', 0]]);
    const checkWorker = vi.fn(async () => {});
    let f = 0; const frame = () => f;
    f = 1; await run(q, active(checkWorker, tracker, inflight, lastProgressAt, frame, { now: PROGRESS + 1 }));
    expect(checkWorker).not.toHaveBeenCalled();
  });

  it('after a wedge check fires, a resumed worker is not immediately progress-checked (cadence reset on both arms)', async () => {
    const q = new DecisionQueue(() => 0);
    const tracker = new PaneActivityTracker(); const inflight = new Set<string>(); const lastProgressAt = new Map<string, number>();
    const checkWorker = vi.fn(async () => {});
    const wedged = (now: number): RunOpts => ({ sessions: ['elowen-iris'], pane: () => 'wedged', tracker, inflight, lastProgressAt, progressReviewMs: PROGRESS, now, sessionTaskId: () => 't1', programFor: () => 'claude-code', hasPrompt: () => false, checkWorker });
    await run(q, wedged(0));                 // first sight (seeds lastProgressAt)
    await run(q, wedged(WORKER_IDLE));        // wedge check fires (reason 'idle'), stamps lastProgressAt = WORKER_IDLE
    expect(checkWorker).toHaveBeenCalledTimes(1);
    expect(lastProgressAt.get('elowen-iris')).toBe(WORKER_IDLE);
    // Worker resumes (pane changes → idle 0) shortly after; progress must NOT fire on the stale stamp.
    await run(q, { sessions: ['elowen-iris'], pane: () => 'resumed-output', tracker, inflight, lastProgressAt, progressReviewMs: PROGRESS, now: WORKER_IDLE + 30_000, sessionTaskId: () => 't1', programFor: () => 'claude-code', hasPrompt: () => false, checkWorker });
    expect(checkWorker).toHaveBeenCalledTimes(1);
  });
});

describe('checkAction — reason "idle" (wedge)', () => {
  const v = (p: Partial<{ approve: boolean; message: string; restart: boolean; rationale: string; escalated: boolean }>) =>
    ({ approve: false, confidence: 0, rationale: '', ...p });
  const idle = { reason: 'idle' as const, missionLive: true, nudges: 0, nudgeMax: 2 };

  it('no-ops when the mission is gone (drain race), regardless of verdict', () => {
    expect(checkAction(v({ message: 'hi' }), { ...idle, missionLive: false })).toEqual({ type: 'noop' });
    expect(checkAction(v({ rationale: 'mission disengaged' }), idle)).toEqual({ type: 'noop' });
  });

  it('approve → no-op (false alarm, still working)', () => {
    expect(checkAction(v({ approve: true }), idle)).toEqual({ type: 'noop' });
  });

  it('message → nudge until the budget is spent, then escalate', () => {
    expect(checkAction(v({ message: 'try X' }), { ...idle, nudges: 0 })).toEqual({ type: 'nudge', text: 'try X' });
    expect(checkAction(v({ message: 'try X' }), { ...idle, nudges: 1 })).toEqual({ type: 'nudge', text: 'try X' });
    expect(checkAction(v({ message: 'try X' }), { ...idle, nudges: 2 })).toEqual({ type: 'escalate' });
  });

  it('restart → restart; bare escalate → escalate', () => {
    expect(checkAction(v({ restart: true }), idle)).toEqual({ type: 'restart' });
    expect(checkAction(v({}), idle)).toEqual({ type: 'escalate' });
  });
});

describe('checkAction — reason "progress" (routine glance at a working agent)', () => {
  const v = (p: Partial<{ approve: boolean; message: string; restart: boolean; rationale: string; escalated: boolean }>) =>
    ({ approve: false, confidence: 0, rationale: '', ...p });
  const prog = { reason: 'progress' as const, missionLive: true, nudges: 0, nudgeMax: 2 };

  it('approve → no-op (on track, sends nothing)', () => {
    expect(checkAction(v({ approve: true }), prog)).toEqual({ type: 'noop' });
  });

  it('message → steer (delivered, NOT a budget-counted nudge) regardless of prior nudges', () => {
    expect(checkAction(v({ message: 'use B' }), prog)).toEqual({ type: 'steer', text: 'use B' });
    expect(checkAction(v({ message: 'use B' }), { ...prog, nudges: 5 })).toEqual({ type: 'steer', text: 'use B' });
  });

  it('restart → restart (truly hung)', () => {
    expect(checkAction(v({ restart: true }), prog)).toEqual({ type: 'restart' });
  });

  it('NEVER escalates a working agent: bare reject / timeout / fumbled flags → no-op', () => {
    expect(checkAction(v({}), prog)).toEqual({ type: 'noop' });                                   // bare reject
    expect(checkAction(v({ escalated: true, rationale: 'overseer timeout' }), prog)).toEqual({ type: 'noop' }); // timeout
  });

  it('still no-ops when the mission is gone', () => {
    expect(checkAction(v({ message: 'use B' }), { ...prog, missionLive: false })).toEqual({ type: 'noop' });
  });
});

// ---- from tests/plugins/agents/overseer/routing.test.ts ----

const FB = { program: 'claude-code', model: 'sonnet' };
describe('resolveExecutor', () => {
  it('routes explicit exec:opencode:<provider/model> to opencode', () => {
    expect(resolveExecutor(['exec:opencode:ollama-cloud/deepseek-v4-flash'], FB)).toEqual({ program: 'opencode', model: 'ollama-cloud/deepseek-v4-flash' });
  });
  it('routes bare exec:sonnet to claude', () => {
    expect(resolveExecutor(['exec:sonnet'], FB)).toEqual({ program: 'claude-code', model: 'sonnet' });
  });
  it('routes explicit exec:codex:<model> to codex', () => {
    expect(resolveExecutor(['exec:codex:gpt-5.4'], FB)).toEqual({ program: 'codex', model: 'gpt-5.4' });
  });
  it('falls back when no exec label', () => {
    expect(resolveExecutor(['type:bug'], FB)).toEqual(FB);
  });
  it('resolves every shared prefix to its mapped program', () => {
    for (const [prefix, program] of Object.entries(PROGRAM_PREFIXES)) {
      expect(resolveExecutor([`exec:${prefix}m`], FB)).toEqual({ program, model: 'm' });
    }
  });
  it('bare-spec fallbacks match the shared constants (single source of truth)', () => {
    expect(resolveExecutor(['exec:a/b'], FB).program).toBe(BARE_WITH_SLASH_PROGRAM);
    expect(resolveExecutor(['exec:plain'], FB).program).toBe(BARE_PLAIN_PROGRAM);
  });
});
