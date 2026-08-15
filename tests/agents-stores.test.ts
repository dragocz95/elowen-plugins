// @vitest-environment node
// Adopted from the Elowen package when the agents plugin moved into this registry. Carries, verbatim:
//   tests/plugins/agents/store/agentStore.test.ts
//   tests/plugins/agents/store/missionPrStore.test.ts
//   tests/plugins/agents/store/missionStore.test.ts
//   tests/plugins/agents/store/noteStore.test.ts
//   tests/plugins/agents/stores.test.ts
// The stores come from THIS repo's agents build (plugins/agents/dist), the db seam from the published
// daemon. Each merged section's root-level fixtures moved inside its own describe so the sections do not
// share setup — every test still gets the same fresh store it had in its original file.
import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { AGENTS_MIGRATIONS } from '../plugins/agents/dist/store/migrations.js';
import { AgentStore } from '../plugins/agents/dist/store/agentStore.js';
import { MissionStore } from '../plugins/agents/dist/store/missionStore.js';
import { MissionPrStore } from '../plugins/agents/dist/store/missionPrStore.js';
import { NoteStore } from '../plugins/agents/dist/store/noteStore.js';
import { openAgentsDb } from './helpers/pluginTablesDb.js';

// ---- from tests/plugins/agents/store/agentStore.test.ts ----

describe('AgentStore.upsert', () => {
  it('updates the program (not just the model) when a recycled name runs a different CLI', () => {
    const db = openAgentsDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db);
    agents.upsert({ project_id: 1, name: 'Nova', program: 'opencode', model: 'ollama-cloud/qwen3.5' });
    expect(agents.programFor('Nova')).toBe('opencode');
    // The same name is later reused by a Claude agent — the stored program MUST follow, or the deriver
    // would run the wrong provider's prompt detector and the agent would hang on an undetected prompt.
    const a = agents.upsert({ project_id: 1, name: 'Nova', program: 'claude-code', model: 'sonnet' });
    expect(a.program).toBe('claude-code');
    expect(a.model).toBe('sonnet');
    expect(agents.programFor('Nova')).toBe('claude-code');
  });
});

// ---- from tests/plugins/agents/store/missionPrStore.test.ts ----

describe('MissionPrStore', () => {
  let db: Db;
  let store: MissionPrStore;
  beforeEach(() => { db = openAgentsDb(':memory:'); store = new MissionPrStore(db); });

  it('returns null for a mission with no PR record', () => {
    expect(store.get('m-x')).toBeNull();
  });

  it('creates a record with branch + worktree and reads it back', () => {
    const rec = store.create({ mission_id: 'm-1', branch: 'elowen/feat-1', worktree: '/tmp/.elowen-worktrees/feat-1' });
    expect(rec).toMatchObject({ mission_id: 'm-1', branch: 'elowen/feat-1', worktree: '/tmp/.elowen-worktrees/feat-1' });
    expect(rec.pr_number).toBeNull();
    expect(rec.pr_url).toBeNull();
    expect(rec.pr_state).toBeNull();
    expect(rec.last_review_ts).toBeNull();
    expect(store.get('m-1')).toEqual(rec);
  });

  it('is idempotent on create — re-engaging an epic keeps the branch/worktree', () => {
    store.create({ mission_id: 'm-1', branch: 'elowen/feat-1', worktree: '/wt/a' });
    const again = store.create({ mission_id: 'm-1', branch: 'elowen/feat-2', worktree: '/wt/b' });
    // The original branch/worktree win — a live worktree must not be silently rebound.
    expect(again.branch).toBe('elowen/feat-1');
    expect(again.worktree).toBe('/wt/a');
  });

  it('records the opened PR (number, url, state)', () => {
    store.create({ mission_id: 'm-1', branch: 'elowen/feat-1', worktree: '/wt/a' });
    const rec = store.setPr('m-1', { number: 42, url: 'https://github.com/o/r/pull/42', state: 'open' });
    expect(rec?.pr_number).toBe(42);
    expect(rec?.pr_url).toBe('https://github.com/o/r/pull/42');
    expect(rec?.pr_state).toBe('open');
  });

  it('updates the PR state without touching the number/url', () => {
    store.create({ mission_id: 'm-1', branch: 'elowen/feat-1', worktree: '/wt/a' });
    store.setPr('m-1', { number: 7, url: 'https://github.com/o/r/pull/7', state: 'open' });
    const rec = store.setPrState('m-1', 'merged');
    expect(rec?.pr_state).toBe('merged');
    expect(rec?.pr_number).toBe(7);
    expect(rec?.pr_url).toBe('https://github.com/o/r/pull/7');
  });

  it('stamps the last-review timestamp for feedback dedup', () => {
    store.create({ mission_id: 'm-1', branch: 'elowen/feat-1', worktree: '/wt/a' });
    const rec = store.setLastReviewTs('m-1', '2026-06-24T10:00:00Z');
    expect(rec?.last_review_ts).toBe('2026-06-24T10:00:00Z');
  });

  it('starts fix_rounds at 0, bumps it (returns the new count) and resets it', () => {
    store.create({ mission_id: 'm-1', branch: 'elowen/feat-1', worktree: '/wt/a' });
    expect(store.get('m-1')?.fix_rounds).toBe(0);
    expect(store.bumpFixRounds('m-1')).toBe(1);
    expect(store.bumpFixRounds('m-1')).toBe(2);
    expect(store.get('m-1')?.fix_rounds).toBe(2);
    store.resetFixRounds('m-1');
    expect(store.get('m-1')?.fix_rounds).toBe(0);
  });

  it('records the PR-review feedback and clears it on reset', () => {
    store.create({ mission_id: 'm-1', branch: 'elowen/feat-1', worktree: '/wt/a' });
    expect(store.get('m-1')?.last_feedback).toBeNull();
    store.setLastFeedback('m-1', '- codex: fix the cap bug');
    expect(store.get('m-1')?.last_feedback).toBe('- codex: fix the cap bug');
    store.resetFixRounds('m-1'); // merge/close clears the fix context too
    expect(store.get('m-1')?.last_feedback).toBeNull();
  });

  it('removes a record on cleanup', () => {
    store.create({ mission_id: 'm-1', branch: 'elowen/feat-1', worktree: '/wt/a' });
    store.remove('m-1');
    expect(store.get('m-1')).toBeNull();
  });

  it('lists records that have an open PR (for the feedback poller)', () => {
    store.create({ mission_id: 'm-1', branch: 'b1', worktree: '/wt/1' });
    store.create({ mission_id: 'm-2', branch: 'b2', worktree: '/wt/2' });
    store.create({ mission_id: 'm-3', branch: 'b3', worktree: '/wt/3' });
    store.setPr('m-1', { number: 1, url: 'u1', state: 'open' });
    store.setPr('m-2', { number: 2, url: 'u2', state: 'merged' });
    const open = store.withOpenPr().map((r) => r.mission_id).sort();
    expect(open).toEqual(['m-1']);
  });
});

// ---- from tests/plugins/agents/store/missionStore.test.ts ----

describe('MissionStore', () => {
  let m: MissionStore;
  beforeEach(() => { m = new MissionStore(openAgentsDb(':memory:')); });

  it('persists a mission and lists it active; setState hides it', () => {
    m.create({ id: 'm1', epic_id: 'e1', autonomy: 'L3', max_sessions: 1 });
    expect(m.active().map(x => x.id)).toEqual(['m1']);
    expect(m.get('m1')).toMatchObject({ id: 'm1', epic_id: 'e1', autonomy: 'L3', max_sessions: 1, state: 'active' });
    m.setState('m1', 'disengaged');
    expect(m.active()).toEqual([]);
  });
  it('re-creating an existing mission id re-activates it instead of throwing (re-engage)', () => {
    m.create({ id: 'm1', epic_id: 'e1', autonomy: 'L3', max_sessions: 1 });
    m.setState('m1', 'disengaged'); // mission ran and was disengaged — the row stays behind
    // Re-engaging the same epic must not blow up on the UNIQUE id; it resets the row to active and
    // applies the new autonomy / max_sessions.
    const again = m.create({ id: 'm1', epic_id: 'e1', autonomy: 'L2', max_sessions: 3 });
    expect(again).toMatchObject({ id: 'm1', epic_id: 'e1', autonomy: 'L2', max_sessions: 3, state: 'active' });
    expect(m.active().map(x => x.id)).toEqual(['m1']); // active again, exactly one row
  });
  it('records the owner and defaults to null when omitted', () => {
    m.create({ id: 'owned', epic_id: 'e1', autonomy: 'L3', max_sessions: 1, created_by: 5 });
    m.create({ id: 'legacy', epic_id: 'e2', autonomy: 'L3', max_sessions: 1 });
    expect(m.get('owned')!.created_by).toBe(5);
    expect(m.get('legacy')!.created_by).toBeNull();
  });
  it('persists per-mission planner and overseer executor overrides', () => {
    m.create({
      id: 'custom', epic_id: 'e1', autonomy: 'L3', max_sessions: 1,
      pilot_exec: 'codex:gpt-5.4', overseer_exec: 'claude:opus',
    });
    expect(m.get('custom')).toMatchObject({
      pilot_exec: 'codex:gpt-5.4', overseer_exec: 'claude:opus',
    });
  });
  it('live includes active and stalled missions', () => {
    m.create({ id: 'a', epic_id: 'e1', autonomy: 'L3', max_sessions: 1 });
    m.create({ id: 'b', epic_id: 'e2', autonomy: 'L3', max_sessions: 1 });
    m.create({ id: 'c', epic_id: 'e3', autonomy: 'L3', max_sessions: 1 });
    m.setState('b', 'stalled');
    m.setState('c', 'paused');
    expect(m.live().map(x => x.id).sort()).toEqual(['a', 'b']); // paused excluded
  });
});

// ---- from tests/plugins/agents/store/noteStore.test.ts ----

describe('NoteStore', () => {
  let db: Db;
  let notes: NoteStore;
  beforeEach(() => { db = openAgentsDb(':memory:'); notes = new NoteStore(db); });

  it('adds a note and lists it back for its scope/target', () => {
    const n = notes.add({ scope: 'mission', target: 'elowen-1', author: 'Iris', body: 'set up X' });
    expect(n.id).toBeGreaterThan(0);
    expect(notes.list('mission', 'elowen-1')).toMatchObject([{ target: 'elowen-1', author: 'Iris', body: 'set up X' }]);
  });

  it('lists notes oldest-first (chronological handoff log)', () => {
    notes.add({ scope: 'mission', target: 'e', body: 'first' });
    notes.add({ scope: 'mission', target: 'e', body: 'second' });
    expect(notes.list('mission', 'e').map((n) => n.body)).toEqual(['first', 'second']);
  });

  it('isolates by scope+target', () => {
    notes.add({ scope: 'mission', target: 'a', body: 'for-a' });
    notes.add({ scope: 'mission', target: 'b', body: 'for-b' });
    expect(notes.list('mission', 'a').map((n) => n.body)).toEqual(['for-a']);
    expect(notes.list('project', 'a')).toEqual([]);
  });

  it('deleteForTarget removes only that target', () => {
    notes.add({ scope: 'mission', target: 'a', body: 'x' });
    notes.add({ scope: 'mission', target: 'b', body: 'y' });
    notes.deleteForTarget('mission', 'a');
    expect(notes.list('mission', 'a')).toEqual([]);
    expect(notes.list('mission', 'b').map((n) => n.body)).toEqual(['y']);
  });

  it('count reports how many notes a scope/target holds', () => {
    notes.add({ scope: 'mission', target: 'a', body: '1' });
    notes.add({ scope: 'mission', target: 'a', body: '2' });
    expect(notes.count('mission', 'a')).toBe(2);
    expect(notes.count('mission', 'b')).toBe(0);
  });

  it('deleteAllForTarget purges every scope for a target', () => {
    notes.add({ scope: 'mission', target: 'a', body: 'm' });
    notes.add({ scope: 'custom', target: 'a', body: 'c' });
    notes.add({ scope: 'mission', target: 'b', body: 'keep' });
    notes.deleteAllForTarget('a');
    expect(notes.list('mission', 'a')).toEqual([]);
    expect(notes.list('custom', 'a')).toEqual([]); // not just the default scope
    expect(notes.list('mission', 'b').map((n) => n.body)).toEqual(['keep']); // other targets untouched
  });
});

// ---- from tests/plugins/agents/stores.test.ts ----

/** A DB as the agents plugin sees it: the shared main database through ctx.db(). */
function pluginDb() {
  const db = openAgentsDb(':memory:');
  return makePluginDb(db, 'agents', { canMigrate: true });
}

describe('agents plugin store layer (extraction step 3)', () => {
  it('migration v1 is self-sufficient: recreates the grandfathered tables when core no longer ships them', () => {
    const pdb = pluginDb();
    // Simulate the post-extraction world (step 8): core schema no longer carries these tables.
    for (const t of ['agents', 'missions', 'mission_pr', 'notes']) pdb.exec(`DROP TABLE ${t}`);
    pdb.migrate(AGENTS_MIGRATIONS);
    expect(pdb.appliedVersion()).toBe(2);
    const names = pdb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agents','missions','mission_pr','notes') ORDER BY name").all() as { name: string }[];
    expect(names.map((r) => r.name)).toEqual(['agents', 'mission_pr', 'missions', 'notes']);
    // …and against a live pre-extraction DB (tables already exist) it must be a harmless no-op.
    const fresh = pluginDb();
    fresh.migrate(AGENTS_MIGRATIONS);
    expect(fresh.appliedVersion()).toBe(2);
  });

  it('AgentStore: upsert recycles a name onto a new program/model and resolves latest program/project', () => {
    const s = new AgentStore(pluginDb());
    s.upsert({ project_id: 1, name: 'Nova', program: 'opencode', model: 'gpt' });
    const recycled = s.upsert({ project_id: 1, name: 'Nova', program: 'claude', model: 'opus' });
    expect(recycled).toMatchObject({ project_id: 1, name: 'Nova', program: 'claude', model: 'opus' });
    expect(s.programFor('nova')).toBe('claude'); // COLLATE NOCASE
    expect(s.projectFor('Nova')).toBe(1);
    expect(s.programFor('ghost')).toBeNull();
  });

  it('MissionStore: engage is idempotent and re-engage reactivates without stealing ownership', () => {
    const s = new MissionStore(pluginDb());
    const m = s.create({ id: 'm-e1', epic_id: 'e1', autonomy: 'auto', max_sessions: 2, created_by: 7 });
    expect(m.state).toBe('active');
    s.setState('m-e1', 'disengaged');
    const re = s.create({ id: 'm-e1', epic_id: 'e1', autonomy: 'guarded', max_sessions: 3, created_by: 9 });
    expect(re.state).toBe('active');
    expect(re.autonomy).toBe('guarded');
    expect(re.created_by).toBe(7); // original engager stays the owner
    expect(s.activeForEpic('e1')?.id).toBe('m-e1');
    s.setState('m-e1', 'stalled');
    expect(s.active()).toHaveLength(0);
    expect(s.live().map((x) => x.id)).toEqual(['m-e1']); // stalled stays in the tick loop
  });

  it('MissionPrStore: create never rebinds a live worktree; fix rounds bump and reset', () => {
    const s = new MissionPrStore(pluginDb());
    s.create({ mission_id: 'm-e1', branch: 'b1', worktree: '/wt1' });
    const kept = s.create({ mission_id: 'm-e1', branch: 'b2', worktree: '/wt2' });
    expect(kept).toMatchObject({ branch: 'b1', worktree: '/wt1' }); // idempotent, original kept
    s.setPr('m-e1', { number: 5, url: 'u', state: 'open' });
    expect(s.withOpenPr()).toHaveLength(1);
    expect(s.bumpFixRounds('m-e1')).toBe(1);
    s.setLastFeedback('m-e1', 'fix the tests');
    s.resetFixRounds('m-e1');
    expect(s.get('m-e1')).toMatchObject({ fix_rounds: 0, last_feedback: null });
    s.setPrState('m-e1', 'merged');
    expect(s.pending()).toHaveLength(0);
  });

  it('NoteStore: chronological handoff log with scoped and global purges', () => {
    const s = new NoteStore(pluginDb());
    s.add({ scope: 'mission', target: 'e1', body: 'first' });
    s.add({ scope: 'mission', target: 'e1', author: 'nova', body: 'second' });
    s.add({ scope: 'other', target: 'e1', body: 'elsewhere' });
    expect(s.list('mission', 'e1').map((n) => n.body)).toEqual(['first', 'second']);
    expect(s.count('mission', 'e1')).toBe(2);
    s.deleteForTarget('mission', 'e1');
    expect(s.count('mission', 'e1')).toBe(0);
    expect(s.count('other', 'e1')).toBe(1);
    s.add({ scope: 'mission', target: 'e1', body: 'again' });
    s.deleteAllForTarget('e1'); // epic delete: no orphan notes under ANY scope
    expect(s.count('other', 'e1')).toBe(0);
    expect(s.count('mission', 'e1')).toBe(0);
  });
});
