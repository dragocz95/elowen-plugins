// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decideAction, targetWouldSubmit, type ActionTarget } from '../plugins/chatbot/src/actions.js';
import { ACTION_KINDS } from '../plugins/chatbot/src/publicContract.js';

/** The server's own answer to "may this be done to that page".
 *
 *  This is where the allowlist lives: the widget mirrors these rules so it refuses to act on a frame the
 *  server should never have sent, but the decision that counts is taken here, against the immutable
 *  description the turn recorded. Everything below is about a value that arrived from an anonymous page. */

const SNAPSHOT = 's0123456789abcdef';

/** A plain text field, a submit button, a checkbox and a placeholder that claims nothing. */
const INPUT: ActionTarget = { id: 'e0', caps: ['read', 'fill', 'focus'] };
const SUBMIT: ActionTarget = { id: 'e1', caps: ['focus', 'request_submit'] };
const CHECKBOX: ActionTarget = { id: 'e2', caps: ['read', 'click', 'focus'] };
const PASSWORD: ActionTarget = { id: 'e3', caps: ['focus'] };
const TARGETS = [INPUT, SUBMIT, CHECKBOX, PASSWORD];

function decide(request: { kind: string; targetId?: string | null; value?: string | null }, overrides: {
  snapshotId?: string;
  turnSnapshotId?: string;
  performedActions?: number;
  maxActionsPerTurn?: number;
  targets?: ActionTarget[];
} = {}) {
  return decideAction({
    request: { kind: request.kind, targetId: request.targetId ?? null, value: request.value ?? null },
    snapshotId: overrides.snapshotId ?? SNAPSHOT,
    turnSnapshotId: overrides.turnSnapshotId ?? SNAPSHOT,
    targets: overrides.targets ?? TARGETS,
    performedActions: overrides.performedActions ?? 0,
    maxActionsPerTurn: overrides.maxActionsPerTurn ?? 10,
  });
}

describe('the actions a turn may take', () => {
  it('approves the kinds a page description supports', () => {
    expect(decide({ kind: 'read', targetId: 'e0' })).toEqual({
      ok: true,
      action: { kind: 'read', targetId: 'e0', value: null, requiresConfirmation: false },
    });
    expect(decide({ kind: 'fill', targetId: 'e0', value: 'Jan' })).toMatchObject({ ok: true, action: { value: 'Jan' } });
    // An empty value is how a field is cleared, and it is a real thing to ask for.
    expect(decide({ kind: 'fill', targetId: 'e0', value: '' })).toMatchObject({ ok: true });
    expect(decide({ kind: 'click', targetId: 'e2' })).toMatchObject({ ok: true });
    expect(decide({ kind: 'focus', targetId: 'e0' })).toMatchObject({ ok: true });
    // Scrolling needs no target and no capability: it is the page moving, not a privilege of an element.
    expect(decide({ kind: 'scroll' })).toEqual({
      ok: true,
      action: { kind: 'scroll', targetId: '', value: null, requiresConfirmation: false },
    });
    expect(decide({ kind: 'scroll', value: 'down' })).toMatchObject({ ok: true, action: { value: 'down' } });
    // A submit-capable element is the only thing that may be asked to submit, and it needs the visitor.
    expect(decide({ kind: 'request_submit', targetId: 'e1' })).toEqual({
      ok: true,
      action: { kind: 'request_submit', targetId: 'e1', value: null, requiresConfirmation: true },
    });
  });

  it('refuses a kind that is not on the allowlist at all', () => {
    for (const kind of ['run_javascript', 'navigate', 'set_value', 'submit', '']) {
      expect(decide({ kind, targetId: 'e0' })).toEqual({ ok: false, reason: 'unknown_action' });
    }
    // The allowlist is the contract's, and every member of it is decidable.
    expect([...ACTION_KINDS]).toEqual(['read', 'focus', 'click', 'fill', 'select', 'scroll', 'request_submit']);
  });

  it('never lets a click send a form', () => {
    expect(decide({ kind: 'click', targetId: 'e1' })).toEqual({ ok: false, reason: 'submit_is_its_own_action' });
    expect(targetWouldSubmit(SUBMIT)).toBe(true);
    expect(targetWouldSubmit(INPUT)).toBe(false);
    // …and the confirmed kind cannot be asked of something that would not submit anything.
    expect(decide({ kind: 'request_submit', targetId: 'e0' })).toEqual({ ok: false, reason: 'not_a_submit_target' });
    expect(decide({ kind: 'request_submit', targetId: 'e2' })).toEqual({ ok: false, reason: 'not_a_submit_target' });
    // A submit with no target submits nothing, and is answered as a target that was never described.
    expect(decide({ kind: 'request_submit' })).toEqual({ ok: false, reason: 'unknown_target' });
  });

  it('refuses a target the turn never described, and a selector dressed up as one', () => {
    expect(decide({ kind: 'fill', targetId: 'e9', value: 'Jan' })).toEqual({ ok: false, reason: 'unknown_target' });
    expect(decide({ kind: 'fill', targetId: 'e999', value: 'Jan' })).toEqual({ ok: false, reason: 'unknown_target' });
    // Nothing shaped like a selector, an XPath or a script is ever a target id.
    for (const targetId of ['#jmeno', 'input[name=jmeno]', '//input[1]', 'document.querySelector("input")', 'e0; alert(1)', ' e0']) {
      expect(decide({ kind: 'fill', targetId, value: 'Jan' })).toEqual({ ok: false, reason: 'unknown_target' });
    }
    expect(decide({ kind: 'fill', targetId: null, value: 'Jan' })).toEqual({ ok: false, reason: 'unknown_target' });
    expect(decide({ kind: 'fill', targetId: 'e0', value: 'Jan' }, { targets: [] })).toEqual({ ok: false, reason: 'unknown_target' });
  });

  it('refuses anything asked of a snapshot this turn did not record', () => {
    expect(decide({ kind: 'fill', targetId: 'e0', value: 'Jan' }, { snapshotId: 'sffffffffffffffff' }))
      .toEqual({ ok: false, reason: 'stale_snapshot' });
    expect(decide({ kind: 'fill', targetId: 'e0', value: 'Jan' }, { turnSnapshotId: 'sffffffffffffffff' }))
      .toEqual({ ok: false, reason: 'stale_snapshot' });
  });

  it('holds a target to the capabilities the page itself reported', () => {
    // A password field may be pointed at and nothing else, and neither may a card number.
    expect(decide({ kind: 'fill', targetId: 'e3', value: 'tajne' })).toEqual({ ok: false, reason: 'capability_not_granted' });
    expect(decide({ kind: 'read', targetId: 'e3' })).toEqual({ ok: false, reason: 'capability_not_granted' });
    // A page that never claimed it could be written into is not written into.
    expect(decide({ kind: 'select', targetId: 'e0', value: 'Praha' })).toEqual({ ok: false, reason: 'capability_not_granted' });
    expect(decide({ kind: 'click', targetId: 'e0' })).toEqual({ ok: false, reason: 'capability_not_granted' });
    expect(decide({ kind: 'focus', targetId: { id: 'e9', caps: [] } as unknown as string })).toEqual({ ok: false, reason: 'unknown_target' });
  });

  it('refuses an action once the turn has spent what it was allowed', () => {
    expect(decide({ kind: 'read', targetId: 'e0' }, { performedActions: 3, maxActionsPerTurn: 3 }))
      .toEqual({ ok: false, reason: 'action_budget_exhausted' });
    expect(decide({ kind: 'read', targetId: 'e0' }, { performedActions: 2, maxActionsPerTurn: 3 })).toMatchObject({ ok: true });
    // An uncapped turn is a turn nobody is watching, and it is refused as such rather than allowed.
    expect(decide({ kind: 'read', targetId: 'e0' }, { performedActions: 0, maxActionsPerTurn: 0 }))
      .toEqual({ ok: false, reason: 'action_budget_exhausted' });
  });

  it('carries a value only where a value is what the kind is for', () => {
    expect(decide({ kind: 'fill', targetId: 'e0' })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(decide({ kind: 'select', targetId: 'e0' })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(decide({ kind: 'click', targetId: 'e2', value: 'true' })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(decide({ kind: 'read', targetId: 'e0', value: 'čti' })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(decide({ kind: 'scroll', value: 'sideways' })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(decide({ kind: 'fill', targetId: 'e0', value: `a\u0000b` })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(decide({ kind: 'fill', targetId: 'e0', value: 'x'.repeat(513) })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(decide({ kind: 'fill', targetId: 'e0', value: 'x'.repeat(512) })).toMatchObject({ ok: true });
  });
});
