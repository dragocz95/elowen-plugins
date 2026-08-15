// @vitest-environment node
// Adopted from the Elowen package when the agents plugin moved to this registry. Carries, verbatim:
//   tests/plugins/agents/overseer/decision.test.ts
//   tests/plugins/agents/overseer/decisionQueue.test.ts
//   tests/plugins/agents/overseer/stuckDetector.test.ts
//   tests/plugins/agents/overseer/paneActivity.test.ts
//   tests/plugins/agents/overseer/sessionInfo.test.ts
//   tests/plugins/agents/overseer/planJob.test.ts
// The plugin code under test is THIS repo's own build (plugins/agents/dist); the daemon-side collaborators
// come from the published `elowen` package.
import { describe, it, expect, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, setPluginPromptSources } from 'elowen/dist/prompts/index.js';
import { FakeInference } from 'elowen/dist/inference/client.js';
import { FakeTmuxDriver } from 'elowen/dist/tmux/fakeDriver.js';
import { EventBus } from 'elowen/dist/api/sse.js';
import type { ElowenEvent } from 'elowen/dist/api/sse.js';
import { classifySession } from 'elowen/dist/shared/sessionInfo.js';
import { TaskStore } from '../plugins/work/dist/store/taskStore.js';
import {
  decisionPrompt as rawDecisionPrompt, parseDecision, decidePrompt as rawDecidePrompt, gateVerdict,
  minConfidenceFor, noOverseerFallback, decideChoice as rawDecideChoice, choicePrompt as rawChoicePrompt,
  parseChoice, MIN_CONFIDENCE, STRICT_CONFIDENCE,
} from '../plugins/agents/dist/overseer/decision.js';
import { DecisionQueue } from '../plugins/agents/dist/overseer/decisionQueue.js';
import { PaneActivityTracker } from '../plugins/agents/dist/overseer/paneActivity.js';
import { PlanJobStore } from '../plugins/agents/dist/overseer/planJob.js';
import { sweepStuckTasks, deadAgentTasks } from '../plugins/agents/dist/overseer/stuckDetector.js';
import { openWorkDb } from './helpers/pluginTablesDb.js';

/** The decision templates (`decision-prompt.md`, `decision-question.md`, `decision-header.md`) are the
 *  agents plugin's OWN prompts now — they live in this repo, not under elowen/dist/prompts — so the
 *  daemon's file renderer cannot resolve them until the plugin source overlay is installed. The daemon
 *  installs it right after loading plugins (see helpers/domainApp.ts); this suite calls the prompt
 *  builders directly, so it installs the overlay itself. */
const AGENTS_PROMPT_DIR = fileURLToPath(new URL('../plugins/agents/prompts', import.meta.url));
setPluginPromptSources(new Map(readdirSync(AGENTS_PROMPT_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => [f.slice(0, -'.md'.length), join(AGENTS_PROMPT_DIR, f)])));

// ---- from tests/plugins/agents/overseer/decision.test.ts ----

// The plugin functions take the prompt renderer as a REQUIRED seam (ctx.host.prompts in
// production); the core file renderer stands in here, matching the pre-extraction defaults.
const decisionPrompt = (input: Parameters<typeof rawDecisionPrompt>[0]) => rawDecisionPrompt(input, render);
const decidePrompt = (inf: Parameters<typeof rawDecidePrompt>[0], input: Parameters<typeof rawDecidePrompt>[1]) => rawDecidePrompt(inf, input, render);
const choicePrompt = (input: Parameters<typeof rawChoicePrompt>[0]) => rawChoicePrompt(input, render);
const decideChoice = (inf: Parameters<typeof rawDecideChoice>[0], input: Parameters<typeof rawDecideChoice>[1]) => rawDecideChoice(inf, input, render);

describe('decision.gateVerdict', () => {
  const v = (approve: boolean, confidence: number) => ({ approve, confidence });
  it('approves only at/above the confidence threshold', () => {
    expect(gateVerdict(v(true, MIN_CONFIDENCE), {}).approve).toBe(true);
    expect(gateVerdict(v(true, MIN_CONFIDENCE - 0.01), {}).approve).toBe(false);
    expect(gateVerdict(v(false, 1), {}).approve).toBe(false);
  });
  it('honours a custom minConfidence: a mid-confidence verdict clears the default gate but not a stricter one', () => {
    const mid = v(true, 0.7);
    expect(gateVerdict(mid, {}).approve).toBe(true); // default 0.6
    expect(gateVerdict(mid, { minConfidence: STRICT_CONFIDENCE }).approve).toBe(false); // 0.85
  });
});

describe('decision.minConfidenceFor', () => {
  it('L1 (Assist) demands a stricter confidence than L2/L3', () => {
    expect(minConfidenceFor('L1')).toBe(STRICT_CONFIDENCE);
    expect(minConfidenceFor('L1')).toBeGreaterThan(minConfidenceFor('L2'));
    expect(minConfidenceFor('L2')).toBe(MIN_CONFIDENCE);
    expect(minConfidenceFor('L3')).toBe(MIN_CONFIDENCE);
  });
});

describe('decision.noOverseerFallback', () => {
  it('only L3 blanket-approves a prompt when no overseer is configured', () => {
    expect(noOverseerFallback('L3')).toEqual({ approve: true });
    expect(noOverseerFallback('L2')).toEqual({ approve: false }); // escalates, not waved through
    expect(noOverseerFallback('L1')).toEqual({ approve: false });
  });
});

describe('decision.parseDecision', () => {
  it('parses and clamps the decision JSON', () => {
    const d = parseDecision('sure: {"approve": true, "confidence": 1.5, "rationale": "ok"}');
    expect(d.approve).toBe(true);
    expect(d.confidence).toBe(1); // clamped
  });
  it('throws on no JSON', () => {
    expect(() => parseDecision('no json here')).toThrow();
  });
  it('extracts the first balanced object, ignoring a trailing braced note (#46)', () => {
    const d = parseDecision('Verdict: {"approve": true, "confidence": 0.8, "rationale": "ok"}. {extra: noise}');
    expect(d.approve).toBe(true);
    expect(d.confidence).toBe(0.8);
  });
  it('tolerates braces inside string values', () => {
    const d = parseDecision('{"approve": false, "confidence": 0.4, "rationale": "uses } and { chars"}');
    expect(d.rationale).toBe('uses } and { chars');
  });
});

describe('decision.parseChoice', () => {
  it('parses and clamps the choice JSON', () => {
    const v = parseChoice('pick: {"choice": "2", "confidence": 1.4, "rationale": "best fit"}');
    expect(v.choice).toBe('2');
    expect(v.confidence).toBe(1); // clamped to [0,1]
    expect(v.rationale).toBe('best fit');
  });
  it('defaults missing/invalid fields to escalate + zero confidence', () => {
    const v = parseChoice('{"rationale": "unsure"}');
    expect(v.choice).toBe('escalate');
    expect(v.confidence).toBe(0);
  });
  it('throws on no JSON (decideChoice then escalates around it)', () => {
    expect(() => parseChoice('no json here')).toThrow();
  });
});

describe('decision.decidePrompt', () => {
  it('returns the LLM decision verbatim', async () => {
    const inf = new FakeInference('{"approve": true, "confidence": 0.9, "rationale": "safe edit"}');
    const d = await decidePrompt(inf, { question: 'Allow editing the config file?', context: 'config', options: [], autonomy: 'L3' });
    expect(d.approve).toBe(true);
    expect(d.confidence).toBe(0.9);
  });
  it('escalates when inference output is unparseable', async () => {
    const inf = new FakeInference('garbage');
    const d = await decidePrompt(inf, { question: 'Proceed?', context: 'ok', options: [], autonomy: 'L3' });
    expect(d.approve).toBe(false);
  });

  it('decisionPrompt includes the question and options', () => {
    const p = decisionPrompt({ question: 'Run build?', context: 'npm run build', options: [{ id: 'yes', label: 'Yes' }], autonomy: 'L2' });
    expect(p).toContain('Run build?');
    expect(p).toContain('yes: Yes');
  });
});

describe('decision.decideChoice', () => {
  const opts = [{ id: '1', label: ':4500 (uprav package.json)' }, { id: '2', label: ':4500 (uprav README)' }];
  it('returns the picked option id and confidence', async () => {
    const inf = new FakeInference('{"choice": "2", "confidence": 0.9, "rationale": "docs-only, no runtime change"}');
    const v = await decideChoice(inf, { question: 'which port?', context: 'docs', options: opts, autonomy: 'L3' });
    expect(v.choice).toBe('2');
    expect(v.confidence).toBe(0.9);
  });
  it('escalates (choice=escalate, confidence 0) when inference output is unparseable', async () => {
    const inf = new FakeInference('no json');
    const v = await decideChoice(inf, { question: 'which port?', context: 'docs', options: opts, autonomy: 'L3' });
    expect(v.choice).toBe('escalate');
    expect(v.confidence).toBe(0);
  });
  it('choicePrompt lists the option ids/labels and the question', () => {
    const p = choicePrompt({ question: 'which port?', context: 'docs', options: opts, autonomy: 'L2' });
    expect(p).toContain('which port?');
    expect(p).toContain('- 1: :4500 (uprav package.json)');
    expect(p).toContain('- 2: :4500 (uprav README)');
  });
});

// ---- from tests/plugins/agents/overseer/decisionQueue.test.ts ----

describe('DecisionQueue', () => {
  it('next() resolves with an enqueued request, and enqueue() resolves when decided', async () => {
    const q = new DecisionQueue();
    const verdict = q.enqueue('m1', 'task', { title: 'x' });
    const req = await q.next('m1');
    expect(req).not.toBeNull();
    expect(req!.kind).toBe('task');
    expect(req!.context).toEqual({ title: 'x' });
    expect(q.resolve('m1', req!.id, { approve: true, confidence: 0.9, rationale: 'ok' })).toBe(true);
    await expect(verdict).resolves.toMatchObject({ approve: true, confidence: 0.9 });
  });

  it('a waiting next() wakes when a request is enqueued later', async () => {
    const q = new DecisionQueue();
    const waiting = q.next('m2', 1000);
    q.enqueue('m2', 'prompt', { q: '?' });
    const req = await waiting;
    expect(req!.kind).toBe('prompt');
  });

  it('next() returns null (heartbeat) after its timeout with nothing pending', async () => {
    vi.useFakeTimers();
    const q = new DecisionQueue();
    const p = q.next('m3', 25000);
    await vi.advanceTimersByTimeAsync(25000);
    await expect(p).resolves.toBeNull();
    vi.useRealTimers();
  });

  it('enqueue() never self-times-out — a pending decision stays pending until answered or swept', async () => {
    vi.useFakeTimers();
    const q = new DecisionQueue();
    const verdict = q.enqueue('m4', 'task', {});
    let settled = false;
    void verdict.then(() => { settled = true; });
    // A slow-but-alive overseer must not be escalated just for thinking: no timer fires it.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(settled).toBe(false);
    vi.useRealTimers();
  });

  it('pending() lists unanswered decisions; timeout() escalates one to a human (never auto-decides)', async () => {
    const q = new DecisionQueue(() => 1000);
    const verdict = q.enqueue('m4', 'task', {});
    expect(q.pending()).toEqual([{ missionId: 'm4', id: expect.any(String), kind: 'task', enqueuedAt: 1000 }]);
    expect(q.timeout('m4', q.pending()[0]!.id)).toBe(true);
    // `escalated: true` flags "no overseer verdict — hand to a human"; consumers must NOT treat this
    // like a real reject (e.g. an L3 review must not self-heal/re-run on it).
    await expect(verdict).resolves.toEqual({ approve: false, confidence: 0, rationale: 'overseer timeout', escalated: true });
    expect(q.pending()).toEqual([]);
    // Already settled → a second timeout is a no-op (can't double-settle vs resolve/drain).
    expect(q.timeout('m4', 'whatever')).toBe(false);
  });

  it('settles the verdict with exactly what the agent answered', async () => {
    const q = new DecisionQueue();
    const verdict = q.enqueue('m6', 'task', { title: 'x' });
    const req = await q.next('m6');
    q.resolve('m6', req!.id, { approve: true, confidence: 0.9, rationale: 'looks fine' });
    await expect(verdict).resolves.toEqual({ approve: true, confidence: 0.9, rationale: 'looks fine' });
  });

  it('carries the overseer-picked choice through a question verdict', async () => {
    const q = new DecisionQueue();
    const verdict = q.enqueue('mq', 'question', { question: 'which port?', options: [{ id: '1', label: 'a' }, { id: '2', label: 'b' }] });
    const req = await q.next('mq');
    expect(req!.kind).toBe('question');
    q.resolve('mq', req!.id, { approve: false, confidence: 0.9, rationale: 'docs-only', choice: '2' });
    await expect(verdict).resolves.toMatchObject({ choice: '2', confidence: 0.9 });
  });

  it('carries the overseer free-text reply through a message verdict', async () => {
    const q = new DecisionQueue();
    const verdict = q.enqueue('mm', 'message', { question: 'A or B?' });
    const req = await q.next('mm');
    expect(req!.kind).toBe('message');
    q.resolve('mm', req!.id, { approve: false, confidence: 0, rationale: '', message: 'use A' });
    await expect(verdict).resolves.toMatchObject({ message: 'use A' });
  });

  it('a question that times out carries no choice (⇒ the deriver escalates)', async () => {
    const q = new DecisionQueue();
    const verdict = q.enqueue('mqt', 'question', { question: '?' });
    q.timeout('mqt', q.pending()[0]!.id);
    const v = await verdict;
    expect(v.choice).toBeUndefined();
  });

  it('drain() escalates all pending for a mission', async () => {
    const q = new DecisionQueue();
    const a = q.enqueue('m5', 'task', {});
    q.drain('m5');
    await expect(a).resolves.toMatchObject({ approve: false, rationale: 'mission disengaged' });
  });
});

// ---- from tests/plugins/agents/overseer/stuckDetector.test.ts ----

const NOW = Date.parse('2026-06-18T12:00:00.000Z');

function setup() {
  const db = openWorkDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const tasks = new TaskStore(db);
  const tmux = new FakeTmuxDriver();
  const bus = new EventBus();
  const events: ElowenEvent[] = [];
  bus.subscribe((e) => events.push(e));
  // Mark a task running: agent label + precise start time + in_progress (mirrors the launch path).
  const start = (id: string, agent: string, startedMs: number) => {
    tasks.create({ id, project_id: 1, title: id });
    tasks.setAgent(id, agent);
    tasks.markStarted(id, startedMs);
    tasks.setStatus(id, 'in_progress');
  };
  return { tasks, tmux, bus, events, start };
}

describe('sweepStuckTasks', () => {
  it('reverts an in_progress task whose agent session is gone (past grace)', async () => {
    const { tasks, tmux, bus, events, start } = setup();
    start('t1', 'Ghost', NOW - 300_000); // started 5 min ago, no live session
    const r = await sweepStuckTasks({ tmux, tasks, bus, now: NOW, graceMs: 120_000, maxRelaunch: 2 });
    expect(r.reverted).toEqual(['t1']);
    expect(tasks.get('t1')!.status).toBe('open');
    expect(events.some((e) => e.type === 'task' && e.taskId === 't1' && e.status === 'open')).toBe(true);
    expect(tasks.get('t1')!.resume_note).toContain('stalled'); // resume note tells the relaunched agent why
  });

  it('leaves a task whose agent session is still live', async () => {
    const { tasks, tmux, bus, start } = setup();
    start('t1', 'Alive', NOW - 300_000);
    await tmux.spawn('elowen-Alive', { cwd: '/o', command: 'x' });
    const r = await sweepStuckTasks({ tmux, tasks, bus, now: NOW, graceMs: 120_000, maxRelaunch: 2 });
    expect(r.reverted).toEqual([]);
    expect(tasks.get('t1')!.status).toBe('in_progress');
  });

  it('spares a freshly-spawned task within the grace window', async () => {
    const { tasks, tmux, bus, start } = setup();
    start('t1', 'Fresh', NOW - 10_000); // started 10s ago, session not up yet
    const r = await sweepStuckTasks({ tmux, tasks, bus, now: NOW, graceMs: 120_000, maxRelaunch: 2 });
    expect(r.reverted).toEqual([]);
    expect(tasks.get('t1')!.status).toBe('in_progress'); // not reaped mid-launch
  });

  it('escalates to blocked once the relaunch budget is exhausted', async () => {
    const { tasks, tmux, bus, start } = setup();
    start('t1', 'Crasher', NOW - 300_000);
    // maxRelaunch:1 → first death reverts (count 1), second death (count 2 > 1) escalates.
    let r = await sweepStuckTasks({ tmux, tasks, bus, now: NOW, graceMs: 120_000, maxRelaunch: 1 });
    expect(r.reverted).toEqual(['t1']);
    tasks.markStarted('t1', NOW - 300_000); tasks.setStatus('t1', 'in_progress'); // simulate re-spawn + crash
    r = await sweepStuckTasks({ tmux, tasks, bus, now: NOW, graceMs: 120_000, maxRelaunch: 1 });
    expect(r.escalated).toEqual(['t1']);
    expect(tasks.get('t1')!.status).toBe('blocked');
  });

  it('ignores tasks that are not in_progress', async () => {
    const { tasks, tmux, bus, start } = setup();
    start('t1', 'Done', NOW - 300_000); tasks.setStatus('t1', 'closed');
    const r = await sweepStuckTasks({ tmux, tasks, bus, now: NOW, graceMs: 120_000, maxRelaunch: 2 });
    expect(r.reverted).toEqual([]);
    expect(r.escalated).toEqual([]);
  });

  it('never reaps anything when the session lookup itself fails', async () => {
    // A tmux outage must not read as "every agent died": the driver reports a real failure instead of
    // an empty list, the sweep propagates it, and the daemon's tick logs it — no task is touched.
    const { tasks, bus, start } = setup();
    start('t1', 'Alive', NOW - 300_000);
    const tmux = { list: () => Promise.reject(new Error('lost server')) };
    await expect(sweepStuckTasks({ tmux, tasks, bus, now: NOW, graceMs: 120_000, maxRelaunch: 2 })).rejects.toThrow('lost server');
    expect(tasks.get('t1')!.status).toBe('in_progress');
  });

  it('invokes onReap with the dead task before reverting (for resume capture)', async () => {
    const { tasks, tmux, bus, start } = setup();
    start('t1', 'Ghost', NOW - 300_000);
    const reaped: string[] = [];
    const r = await sweepStuckTasks({ tmux, tasks, bus, now: NOW, graceMs: 120_000, maxRelaunch: 2, onReap: (t) => reaped.push(t.id) });
    expect(reaped).toEqual(['t1']);
    expect(r.reverted).toEqual(['t1']);
  });

  it('reaps the task even if onReap throws (resume capture is best-effort)', async () => {
    const { tasks, tmux, bus, start } = setup();
    start('t1', 'Ghost', NOW - 300_000);
    const r = await sweepStuckTasks({ tmux, tasks, bus, now: NOW, graceMs: 120_000, maxRelaunch: 2, onReap: () => { throw new Error('boom'); } });
    expect(r.reverted).toEqual(['t1']); // revert still happened despite the capture error
    expect(tasks.get('t1')!.status).toBe('open');
  });
});

describe('sweepStuckTasks created_at fallback (#54)', () => {
  it('parses an already-ISO created_at (with zone) without producing NaN', async () => {
    const db = openWorkDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const tasks = new TaskStore(db);
    const tmux = new FakeTmuxDriver();
    const bus = new EventBus();
    // No agent/started labels: startedOf falls back to created_at. Force an ISO value carrying 'Z'
    // (what a non-SQLite-default write would store) — the old `+ 'Z'` would make `...ZZ` → NaN, so the
    // grace window couldn't protect a fresh task. With the #54 guard it parses and the grace applies.
    tasks.create({ id: 't1', project_id: 1, title: 'no labels' });
    db.prepare("UPDATE tasks SET created_at = ?, status = 'in_progress' WHERE id = 't1'").run(new Date(NOW - 10_000).toISOString());
    const r = await sweepStuckTasks({ tmux, tasks, bus, now: NOW, graceMs: 120_000, maxRelaunch: 2 });
    expect(r.reverted).toEqual([]); // within grace (10s ago) → not reaped; created_at parsed correctly
    expect(tasks.get('t1')!.status).toBe('in_progress');
  });
});

describe('deadAgentTasks', () => {
  it('flags in_progress tasks with no live session (or no agent label)', () => {
    const db = openWorkDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const tasks = new TaskStore(db);
    tasks.create({ id: 'live', project_id: 1, title: 'l', labels: ['agent:Live'] });
    tasks.create({ id: 'dead', project_id: 1, title: 'd', labels: ['agent:Dead'] });
    tasks.create({ id: 'bare', project_id: 1, title: 'b' }); // no agent label
    const live = new Set(['elowen-Live']);
    const dead = deadAgentTasks(live, [tasks.get('live')!, tasks.get('dead')!, tasks.get('bare')!]);
    expect(dead.map((t) => t.id).sort()).toEqual(['bare', 'dead']);
  });
});

// ---- from tests/plugins/agents/overseer/paneActivity.test.ts ----

describe('PaneActivityTracker', () => {
  it('returns 0 on first sight and on every change, then grows while static', () => {
    const t = new PaneActivityTracker();
    expect(t.seen('s', 'frame-a', 1000)).toBe(0);        // first sight
    expect(t.seen('s', 'frame-a', 1500)).toBe(500);      // unchanged → idle grows
    expect(t.seen('s', 'frame-b', 2000)).toBe(0);        // changed → reset
    expect(t.seen('s', 'frame-b', 9000)).toBe(7000);     // unchanged again
  });

  it('tracks sessions independently', () => {
    const t = new PaneActivityTracker();
    t.seen('a', 'x', 0);
    t.seen('b', 'y', 100);
    expect(t.seen('a', 'x', 1000)).toBe(1000);
    expect(t.seen('b', 'y', 1000)).toBe(900);
  });

  it('treats an empty capture as unknown (null) and does not track it', () => {
    const t = new PaneActivityTracker();
    expect(t.seen('s', '', 1000)).toBeNull();
    // a later non-empty capture is a fresh first-sight, not "idle since 1000"
    expect(t.seen('s', 'now-alive', 5000)).toBe(0);
  });

  it('length is part of the signature, so a different-length screen reads as changed', () => {
    // The length guard makes a hash collision between two DIFFERENT-length captures still read as
    // "changed" rather than a false "idle" (real pane changes almost always change the length too).
    const t = new PaneActivityTracker();
    expect(t.seen('s', 'output line', 0)).toBe(0);
    expect(t.seen('s', 'output line\nmore', 1000)).toBe(0); // longer → reset, not idle 1000
  });

  it('forget() drops the entry so the next sight starts fresh', () => {
    const t = new PaneActivityTracker();
    t.seen('s', 'x', 0);
    t.forget('s');
    expect(t.seen('s', 'x', 5000)).toBe(0); // first sight again, not idle 5000
  });
});

// ---- from tests/plugins/agents/overseer/sessionInfo.test.ts ----

describe('classifySession', () => {
  it('classifies a worker agent', () => {
    expect(classifySession('elowen-Patricita')).toEqual({ name: 'elowen-Patricita', role: 'agent', agent: 'Patricita' });
  });

  it('classifies the pilot/planner', () => {
    expect(classifySession('elowen-pilot-Nova')).toEqual({ name: 'elowen-pilot-Nova', role: 'pilot', agent: 'Nova' });
  });

  it('classifies the overseer and extracts its mission id', () => {
    expect(classifySession('elowen-overseer-m-elowen-240cff5c')).toEqual({
      name: 'elowen-overseer-m-elowen-240cff5c', role: 'overseer', agent: '', missionId: 'm-elowen-240cff5c',
    });
  });

  it('does not mistake an agent named with an overseer-like word for the overseer', () => {
    // Only the exact `pilot-`/`overseer-` prefixes switch role; a normal name is always an agent.
    expect(classifySession('elowen-Overlord').role).toBe('agent');
  });

  it('classifies an advisor session and extracts its user id', () => {
    expect(classifySession('elowen-advisor-7')).toEqual({ name: 'elowen-advisor-7', role: 'advisor', agent: '', userId: 7 });
  });

  it('leaves userId undefined for a malformed advisor name', () => {
    expect(classifySession('elowen-advisor-x').userId).toBeUndefined();
  });
});

// ---- from tests/plugins/agents/overseer/planJob.test.ts ----

describe('PlanJobStore', () => {
  it('creates a planning job and reads it back', () => {
    const s = new PlanJobStore();
    const j = s.create({ goal: 'add export', projectId: 1, epicId: 'elowen-ep', dryRun: false });
    expect(j.status).toBe('planning');
    expect(j.phases).toEqual([]);
    expect(s.get(j.id)).toMatchObject({ goal: 'add export', epicId: 'elowen-ep' });
  });
  it('setPhases marks the job done', () => {
    const s = new PlanJobStore();
    const j = s.create({ goal: 'g', projectId: 1, epicId: null, dryRun: true });
    const done = s.setPhases(j.id, [{ title: 'A', type: 'task' }]);
    expect(done!.status).toBe('done');
    expect(done!.phases).toHaveLength(1);
  });
  it('fail marks the job failed with an error', () => {
    const s = new PlanJobStore();
    const j = s.create({ goal: 'g', projectId: 1, epicId: null, dryRun: false });
    expect(s.fail(j.id, 'timeout')!.status).toBe('failed');
    expect(s.get(j.id)!.error).toBe('timeout');
  });
  it('get returns null for unknown id', () => {
    expect(new PlanJobStore().get('nope')).toBeNull();
  });

  it('setSession records the pilot tmux session so the client can live-preview it', () => {
    const s = new PlanJobStore();
    const j = s.create({ goal: 'g', projectId: 1, epicId: null, dryRun: false });
    expect(s.get(j.id)!.sessionName).toBeUndefined();
    s.setSession(j.id, 'elowen-pilot-Nova');
    expect(s.get(j.id)!.sessionName).toBe('elowen-pilot-Nova');
  });

  it('prunes settled jobs older than the TTL on the next create, but keeps in-flight ones (O27)', () => {
    let now = 0;
    const s = new PlanJobStore(() => now);
    const old = s.create({ goal: 'old', projectId: 1, epicId: null, dryRun: false });
    s.fail(old.id, 'done long ago'); // terminal
    const stillPlanning = s.create({ goal: 'wip', projectId: 1, epicId: null, dryRun: false }); // never settled
    now += 11 * 60_000; // advance past the 10-min TTL
    s.create({ goal: 'fresh', projectId: 1, epicId: null, dryRun: false }); // triggers prune
    expect(s.get(old.id)).toBeNull();              // long-settled job evicted
    expect(s.get(stillPlanning.id)).not.toBeNull(); // in-flight job retained regardless of age
  });

  it('settles an in-flight job whose Pilot never came back, instead of polling "planning" forever', () => {
    // Only the Pilot's `plan submit` settles a job. When its session dies (crash, killed pane) nothing
    // else ever does, so the client polls a job that will never answer and the map keeps it for the
    // daemon's lifetime. Past the planning window it must read as a definite failure.
    let now = 0;
    const s = new PlanJobStore(() => now);
    const j = s.create({ goal: 'g', projectId: 1, epicId: null, dryRun: false });
    now += 59 * 60_000;
    expect(s.get(j.id)!.status).toBe('planning'); // still within the window — a slow plan is untouched
    now += 2 * 60_000;
    expect(s.get(j.id)!.status).toBe('failed');
    expect(s.get(j.id)!.error).toBe('plan_timed_out');
  });

  it('prunes an in-flight job that timed out long ago (the map cannot grow unbounded)', () => {
    let now = 0;
    const s = new PlanJobStore(() => now);
    const abandoned = s.create({ goal: 'g', projectId: 1, epicId: null, dryRun: false });
    now += 61 * 60_000;
    s.create({ goal: 'fresh', projectId: 1, epicId: null, dryRun: false }); // triggers prune
    expect(s.get(abandoned.id)).toBeNull();
  });
});
