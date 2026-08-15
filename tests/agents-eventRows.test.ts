// @vitest-environment node
/** Golden pin of the activity rows this plugin persists (`agentsEventRow`).
 *
 *  These `type` strings and detail payloads are a STORAGE format, not an internal detail: rows written
 *  by older builds are read back by the same names, and the task timeline parses `decision` and
 *  `message` details as JSON. A rename or a reshaped payload silently breaks every row already on disk,
 *  so it has to fail here and be a deliberate decision.
 *
 *  The daemon's EventStore mechanics around a resolver — first claim wins, a throwing resolver is
 *  skipped, the project stamp and label snapshot, the tenancy filter — stay in the Elowen package
 *  (tests/store/eventStore.test.ts there) over a reference resolver it owns. This file is the other
 *  half of that split: what the real mapping actually emits. */
import { describe, it, expect } from 'vitest';
import { agentsEventRow } from '../plugins/agents/dist/events/rows.js';

describe('agentsEventRow — persisted activity row format', () => {
  it('maps a mission event and names the epic inside the mission id', () => {
    expect(agentsEventRow({ type: 'mission', missionId: 'm-e1', state: 'active' } as never))
      .toEqual({ type: 'mission', target: 'm-e1', detail: 'active', labelTitleId: 'e1' });
    // A mission id that is not `m-<epicId>` has no epic to label with — null, never a wrong guess.
    expect(agentsEventRow({ type: 'mission', missionId: 'legacy', state: 'paused' } as never))
      .toEqual({ type: 'mission', target: 'legacy', detail: 'paused', labelTitleId: null });
  });

  it('maps a review verdict to its approved/escalated prose', () => {
    expect(agentsEventRow({ type: 'review', missionId: 'm-e1', taskId: 't1', approve: true, rationale: 'looks right' } as never))
      .toEqual({ type: 'review', target: 't1', detail: 'approved: looks right', labelTitleId: 't1' });
    expect(agentsEventRow({ type: 'review', missionId: 'm-e1', taskId: 't1', approve: false, rationale: 'redo' } as never))
      .toEqual({ type: 'review', target: 't1', detail: 'escalated: redo', labelTitleId: 't1' });
  });

  it('serialises a decision as the exact JSON the task detail reads back', () => {
    const row = agentsEventRow({
      type: 'decision', taskId: 't1', kind: 'prompt', question: 'run it?',
      outcome: 'approved', rationale: 'safe', confidence: 0.9, optionLabel: 'Yes',
    } as never);
    expect(row).toMatchObject({ type: 'decision', target: 't1', labelTitleId: 't1' });
    expect(JSON.parse(row!.detail)).toEqual({
      kind: 'prompt', question: 'run it?', outcome: 'approved', rationale: 'safe', confidence: 0.9, optionLabel: 'Yes',
    });
  });

  it('serialises a conversation turn as role + text', () => {
    const row = agentsEventRow({ type: 'message', taskId: 't1', role: 'worker', text: 'on it' } as never);
    expect(row).toMatchObject({ type: 'message', target: 't1', labelTitleId: 't1' });
    expect(JSON.parse(row!.detail)).toEqual({ role: 'worker', text: 'on it' });
  });

  it('maps a session signal to its type, with no task to label', () => {
    expect(agentsEventRow({ type: 'signal', session: 's1', signal: { type: 'working' } } as never))
      .toEqual({ type: 'signal', target: 's1', detail: 'working' });
  });

  it('claims nothing outside the subsystem — core keeps persisting its own events', () => {
    for (const type of ['task', 'usage', 'project', 'chat']) {
      expect(agentsEventRow({ type, taskId: 't1' } as never), type).toBeUndefined();
    }
  });
});
