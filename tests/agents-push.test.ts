// @vitest-environment node
// Re-homed from the Elowen package with the agents plugin: tests/plugins/agents/push/messages.test.ts,
// tests/plugins/agents/push/pushDispatcher.test.ts, tests/plugins/agents/push/recipients.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from 'elowen/dist/store/db.js';
import { UserStore } from 'elowen/dist/store/userStore.js';
import { EventBus } from 'elowen/dist/api/sse.js';
import type { PushSender } from 'elowen/dist/push/pushSender.js';
import type { PushPayload } from 'elowen/dist/push/messages.js';
import { MissionStore } from '../plugins/agents/dist/store/missionStore.js';
import { TaskStore } from '../plugins/work/dist/store/taskStore.js';
import { buildReview, buildNeedsInput, buildStalled, buildBlocked, buildDone } from '../plugins/agents/dist/push/messages.js';
import { PushDispatcher, type PrInfoReader } from '../plugins/agents/dist/push/pushDispatcher.js';
import { recipientsForMission } from '../plugins/agents/dist/push/recipients.js';
import { openPluginTablesDb, openAgentsDb } from './helpers/pluginTablesDb.js';

// ---- from tests/plugins/agents/push/messages.test.ts ----

describe('push message builders', () => {
  it('review carries approve/rerun actions and points at escalations', () => {
    const p = buildReview({ missionId: 'm-e1', taskId: 't1', phaseTitle: 'Build', rationale: 'missing test' });
    expect(p.kind).toBe('review');
    expect(p.actions.map((a) => a.action)).toEqual(['approve', 'rerun']);
    expect(p.url).toBe('/p/agents/escalations');
    expect(p.body).toContain('missing test');
  });

  it('needs_input gives allow/reject for a permission prompt (no options)', () => {
    const p = buildNeedsInput({ session: 'elowen-a', question: 'Run rm?', hasOptions: false });
    expect(p.actions.map((a) => a.action)).toEqual(['allow', 'reject']);
    expect(p.session).toBe('elowen-a');
  });

  it('needs_input is tap-to-open for a multiple-choice question (has options)', () => {
    const p = buildNeedsInput({ session: 'elowen-a', question: 'Pick one', hasOptions: true });
    expect(p.actions).toEqual([]);
  });

  it('stalled and blocked offer an open action', () => {
    expect(buildStalled({ missionId: 'm-e1', epicTitle: 'E' }).actions.map((a) => a.action)).toEqual(['open']);
    expect(buildBlocked({ taskId: 't1', taskTitle: 'T' }).actions.map((a) => a.action)).toEqual(['open']);
  });

  it('done has no actions and appends the PR phrase only when a url is present', () => {
    const plain = buildDone({ missionId: 'm-e1', epicTitle: 'E' });
    expect(plain.actions).toEqual([]);
    expect(plain.title).toBe('Mise dokončena');
    expect(plain.url).toBe('/dash');

    const withPr = buildDone({ missionId: 'm-e1', epicTitle: 'E', prUrl: 'https://gh/pr/1' });
    expect(withPr.title).toContain('PR');
    expect(withPr.url).toBe('https://gh/pr/1');
    expect(withPr.prUrl).toBe('https://gh/pr/1');
  });
});

// ---- from tests/plugins/agents/push/pushDispatcher.test.ts ----

interface Captured { userIds: number[]; payload: PushPayload }

function harness(prInfo?: PrInfoReader) {
  const db: Db = openPluginTablesDb(':memory:');
  const missions = new MissionStore(db);
  const tasks = new TaskStore(db);
  const users = new UserStore(db);
  const adminId = users.create('admin', 'pw').id;
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const sent: Captured[] = [];
  const sender = { sendToUsers: async (userIds: number[], payload: PushPayload) => { sent.push({ userIds, payload }); } } as unknown as PushSender;
  const dispatcher = new PushDispatcher({ missions, tasks, users, sender, missionGit: prInfo });
  const bus = new EventBus();
  dispatcher.subscribe(bus);
  return { db, missions, tasks, users, adminId, sent, bus };
}

describe('PushDispatcher', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });

  it('pushes a review payload on a rejection to the mission recipients', () => {
    h.tasks.create({ id: 'e1', project_id: 1, title: 'Epic', type: 'epic' });
    h.tasks.create({ id: 't1', project_id: 1, title: 'Build', parent_id: 'e1' });
    h.missions.create({ id: 'm-e1', epic_id: 'e1', autonomy: 'L3', max_sessions: 1 });
    h.bus.publish({ type: 'review', missionId: 'm-e1', taskId: 't1', approve: false, rationale: 'nope' });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.payload.kind).toBe('review');
    expect(h.sent[0]!.userIds).toEqual([h.adminId]);
  });

  it('sends nothing when a review is approved', () => {
    h.tasks.create({ id: 'e1', project_id: 1, title: 'Epic', type: 'epic' });
    h.missions.create({ id: 'm-e1', epic_id: 'e1', autonomy: 'L3', max_sessions: 1 });
    h.bus.publish({ type: 'review', missionId: 'm-e1', taskId: 't1', approve: true, rationale: 'ok' });
    expect(h.sent).toHaveLength(0);
  });

  it('maps a needs_input signal via the agent label to its mission', () => {
    h.tasks.create({ id: 'e1', project_id: 1, title: 'Epic', type: 'epic' });
    h.tasks.create({ id: 't1', project_id: 1, title: 'Phase', parent_id: 'e1', labels: ['agent:zoe'] });
    h.missions.create({ id: 'm-e1', epic_id: 'e1', autonomy: 'L3', max_sessions: 1 });
    h.bus.publish({ type: 'signal', session: 'elowen-zoe', signal: { type: 'needs_input', question: 'Run?', options: [], context: '' } });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.payload.kind).toBe('needs_input');
    expect(h.sent[0]!.payload.session).toBe('elowen-zoe');
  });

  it('notifies admins for a standalone (mission-less) task needs_input instead of dropping it', () => {
    // A task with no parent epic has no mission, so the payload carries missionId: undefined. Previously
    // the dispatcher resolved [] recipients and silently dropped the "needs input" push; it must fall
    // back to admins (mirroring recipientsForMission's owner-less fallback).
    h.tasks.create({ id: 't1', project_id: 1, title: 'Solo', labels: ['agent:solo'] });
    h.bus.publish({ type: 'signal', session: 'elowen-solo', signal: { type: 'needs_input', question: 'Run?', options: [], context: '' } });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.payload.kind).toBe('needs_input');
    expect(h.sent[0]!.payload.missionId).toBeUndefined();
    expect(h.sent[0]!.userIds).toEqual([h.adminId]);
  });

  it('pushes a done payload with the PR url when a mission completes naturally (epic closed)', () => {
    const withPr = harness({ prInfo: () => ({ prUrl: 'https://gh/pr/9' }) });
    withPr.tasks.create({ id: 'e1', project_id: 1, title: 'Epic', type: 'epic' });
    withPr.tasks.close('e1', { summary: 'done', outcome: 'ok' }); // natural completion closes the epic
    withPr.missions.create({ id: 'm-e1', epic_id: 'e1', autonomy: 'L3', max_sessions: 1 });
    withPr.bus.publish({ type: 'mission', missionId: 'm-e1', state: 'disengaged' });
    expect(withPr.sent).toHaveLength(1);
    expect(withPr.sent[0]!.payload.kind).toBe('done');
    expect(withPr.sent[0]!.payload.prUrl).toBe('https://gh/pr/9');
  });

  it('sends nothing on a manual disengage (epic still open — not a completion)', () => {
    h.tasks.create({ id: 'e1', project_id: 1, title: 'Epic', type: 'epic' }); // open, not closed
    h.missions.create({ id: 'm-e1', epic_id: 'e1', autonomy: 'L3', max_sessions: 1 });
    h.bus.publish({ type: 'mission', missionId: 'm-e1', state: 'disengaged' });
    expect(h.sent).toHaveLength(0);
  });

  it('swallows a lookup that throws (never aborts the bus)', () => {
    // A review event whose task is missing must not throw; the bus stays alive.
    h.missions.create({ id: 'm-e1', epic_id: 'e1', autonomy: 'L3', max_sessions: 1 });
    expect(() => h.bus.publish({ type: 'review', missionId: 'm-e1', taskId: 'gone', approve: false, rationale: 'x' })).not.toThrow();
    // Unknown task title falls back to 'Fáze'; still a valid push to the admin.
    expect(h.sent).toHaveLength(1);
  });
});

// ---- from tests/plugins/agents/push/recipients.test.ts ----

let db: Db; let missions: MissionStore; let users: UserStore;
let adminId: number; let ownerId: number;
beforeEach(() => {
  db = openAgentsDb(':memory:');
  missions = new MissionStore(db);
  users = new UserStore(db);
  adminId = users.create('admin', 'pw').id; // first user → admin
  ownerId = users.create('owner', 'pw').id;
});

describe('recipientsForMission', () => {
  it('notifies the owner plus every admin', () => {
    missions.create({ id: 'm-e1', epic_id: 'e1', autonomy: 'L3', max_sessions: 1, created_by: ownerId });
    expect(recipientsForMission('m-e1', { missions, users }).sort()).toEqual([adminId, ownerId].sort());
  });

  it('falls back to admins only when the mission has no owner', () => {
    missions.create({ id: 'm-e2', epic_id: 'e2', autonomy: 'L3', max_sessions: 1 });
    expect(recipientsForMission('m-e2', { missions, users })).toEqual([adminId]);
  });

  it('returns admins (and no throw) for an unknown mission', () => {
    expect(recipientsForMission('m-nope', { missions, users })).toEqual([adminId]);
  });
});
