import {
  ACTION_KINDS,
  CONFIRMATION_ACTION_KIND,
  TARGET_ID_PATTERN,
  requiresVisitorConfirmation,
  type ActionKind,
  type ActionRefusal,
} from './publicContract.js';

/** The page-action policy: the ONE place that answers whether an action may be performed on a page.
 *
 *  It runs on the SERVER, against the immutable snapshot a turn recorded, and that is where its answer is
 *  authoritative. The same function is compiled into the widget as well, for one reason only: a widget
 *  that is handed an action the policy forbids must refuse it rather than act on it and report the
 *  refusal afterwards. Two callers, one rule — never two rules that have to be kept in step by hand.
 *
 *  Nothing here reads a DOM, a clock or a database: it is a decision over values that arrived from an
 *  anonymous page, which is why the reasoning can be read in one sitting and tested exhaustively. */

/** One interactive element, as the visitor's own page described it when the turn was submitted.
 *
 *  `caps` is what the element may be asked to do, in the same vocabulary as the action kinds. It is
 *  produced by the page itself, so it is a CLAIM: the server checks that a claimed capability covers the
 *  requested kind, and the widget checks the same list against the element it holds before touching it. */
export interface ActionTarget {
  id: string;
  caps: readonly string[];
}

/** Why an action was refused. Every reason is a fact about the request, never about the page's contents:
 *  a caller learns that it asked for something disallowed, not what else is on the page.
 *
 *  The vocabulary itself lives in the shared contract, because it is not private to this file: the server
 *  answers the model with these codes and a widget reports them back, so a second list here is how a caller
 *  ends up explaining a refusal that never happened. */
export type { ActionRefusal };

/** One action as it arrived from a model, before anything has been believed about it. */
interface ActionRequest {
  kind: string;
  targetId: string | null;
  value: string | null;
}

export interface ActionPolicyInput {
  request: ActionRequest;
  /** The snapshot the frame names. It is a claim too, checked against the turn's own record. */
  snapshotId: string;
  /** The snapshot this turn actually stored. A target id is only meaningful inside it. */
  turnSnapshotId: string;
  targets: readonly ActionTarget[];
  /** How many actions this turn has already performed, and the ceiling the chatbot's own configuration
   *  allows. The policy never invents a ceiling: an uncapped turn is a turn nobody is watching. */
  performedActions: number;
  maxActionsPerTurn: number;
}

export interface ApprovedAction {
  kind: ActionKind;
  targetId: string | null;
  value: string | null;
  /** True when the action may only be performed after the visitor themselves confirmed it. */
  requiresConfirmation: boolean;
}

export type ActionDecision = { ok: true; action: ApprovedAction } | { ok: false; reason: ActionRefusal };

/** How much text a `fill` or `select` may carry into a page. Larger than anything the snapshot reports,
 *  because writing a value is a different act from describing one, and still bounded so one action
 *  cannot paste a document into a field. */
const ACTION_VALUE_MAX_CHARS = 512;

/** Kinds that target one element. `scroll` without a target scrolls the page itself. */
const TARGET_REQUIRED: Record<ActionKind, boolean> = {
  read: true,
  focus: true,
  click: true,
  fill: true,
  select: true,
  scroll: false,
  request_submit: true,
};

/** Kinds that carry a value, and the ones that must not. */
const VALUE_REQUIRED: Record<ActionKind, boolean> = {
  read: false,
  focus: false,
  click: false,
  fill: true,
  select: true,
  scroll: false,
  request_submit: false,
};

/** The capability an element must claim for a kind to be performed on it. `scroll` needs none: moving a
 *  page is not a privilege the element grants. */
const CAPABILITY_FOR_KIND: Record<ActionKind, string | null> = {
  read: 'read',
  focus: 'focus',
  click: 'click',
  fill: 'fill',
  select: 'select',
  scroll: null,
  request_submit: CONFIRMATION_ACTION_KIND,
};

const isActionKind = (value: string): value is ActionKind => (ACTION_KINDS as readonly string[]).includes(value);

/** Whether a name is one of the kinds this version has an action for. Exported because the server checks
 *  it before it looks anything up, and because a second membership test beside that one is how the two
 *  lists drift. */
export { isActionKind };

/** Whether a described target would submit a form. It is the ONE property that separates an ordinary
 *  click from an irreversible step, so it is read in one place only. */
export function targetWouldSubmit(target: ActionTarget): boolean {
  return target.caps.includes(CONFIRMATION_ACTION_KIND);
}

/**
 * Decide one action against the turn's own snapshot.
 *
 * The order matters: a kind outside the allowlist is refused before any target is looked up, a stale
 * snapshot before any capability is believed, and a click that would submit before it can be performed as
 * an ordinary click. An action never becomes performable by being asked for twice, and nothing in the
 * request is repaired into something valid — a request this policy did not expect is refused as it is.
 */
export function decideAction(input: ActionPolicyInput): ActionDecision {
  const { request } = input;
  if (!isActionKind(request.kind)) return { ok: false, reason: 'unknown_action' };
  const kind = request.kind;

  // A target id is only meaningful inside the snapshot that issued it. A frame naming another snapshot
  // than the one this turn recorded is describing a page nobody agreed on.
  if (input.snapshotId !== input.turnSnapshotId) return { ok: false, reason: 'stale_snapshot' };

  if (input.performedActions >= input.maxActionsPerTurn) return { ok: false, reason: 'action_budget_exhausted' };

  const value = readValue(kind, request.value);
  if (!value.ok) return { ok: false, reason: 'invalid_value' };

  const targetResult = readTarget(kind, request.targetId, input.targets);
  if (!targetResult.ok) return { ok: false, reason: targetResult.reason };
  const target = targetResult.value;

  // A kind that needs no target carries none at all, and the page itself is what it acts on. `readTarget`
  // has already refused a target-less kind that does need one, and the only kind here is `scroll`, whose
  // capability rule is emptiness and which is neither a click nor a submission — so there is nothing left
  // to check it against.
  if (target === null) {
    return {
      ok: true,
      action: { kind, targetId: null, value: value.value, requiresConfirmation: requiresVisitorConfirmation(kind) },
    };
  }

  // The submit rule is decided BEFORE the capability rule, so a click on a submit button is answered with
  // the one thing that may be done instead, rather than with a capability the element never had.
  //
  // A submit-capable element can never be clicked: the click would send the form, which is an irreversible
  // step the visitor alone may take. It has to be asked for as `request_submit`, which carries the
  // confirmation the visitor answers themselves.
  if (kind === 'click' && targetWouldSubmit(target)) return { ok: false, reason: 'submit_is_its_own_action' };
  if (kind === CONFIRMATION_ACTION_KIND && !targetWouldSubmit(target)) {
    return { ok: false, reason: 'not_a_submit_target' };
  }
  const capability = CAPABILITY_FOR_KIND[kind];
  if (capability !== null && !target.caps.includes(capability)) {
    return { ok: false, reason: 'capability_not_granted' };
  }

  return {
    ok: true,
    action: {
      kind,
      targetId: target.id,
      value: value.value,
      requiresConfirmation: requiresVisitorConfirmation(kind),
    },
  };
}

/** The target a request names, resolved against the snapshot's own list of them.
 *
 *  A kind that needs no target answers with `null` rather than with an empty id: an empty id is a target
 *  that resolves to nothing, and a widget that looked it up would report the element as having vanished
 *  from a page nothing had touched. */
function readTarget(
  kind: ActionKind,
  raw: string | null,
  targets: readonly ActionTarget[],
): { ok: true; value: ActionTarget | null } | { ok: false; reason: ActionRefusal } {
  if (raw === null || raw === '') {
    // A kind that needs no target still refuses a target that is not a target: an id this policy cannot
    // resolve is not something to carry along and hope the page recognises.
    return TARGET_REQUIRED[kind] ? { ok: false, reason: 'unknown_target' } : { ok: true, value: null };
  }
  if (!TARGET_ID_PATTERN.test(raw)) return { ok: false, reason: 'unknown_target' };
  const found = targets.find((target) => target.id === raw);
  if (!found) return { ok: false, reason: 'unknown_target' };
  if (!TARGET_REQUIRED[kind]) return { ok: false, reason: 'unknown_target' };
  return { ok: true, value: found };
}

function readValue(kind: ActionKind, raw: string | null): { ok: true; value: string | null } | { ok: false } {
  // `scroll` keeps one word: which way. It is the only kind whose value is a direction rather than text.
  if (kind === 'scroll') {
    return raw === null || raw === 'up' || raw === 'down' ? { ok: true, value: raw } : { ok: false };
  }
  // Every other kind either carries text or nothing at all, and nothing is spelled as an absent value.
  if (!VALUE_REQUIRED[kind]) return raw === null ? { ok: true, value: null } : { ok: false };
  if (raw === null) return { ok: false };
  if (raw.length > ACTION_VALUE_MAX_CHARS) return { ok: false };
  // A NUL cannot survive a round trip through a form control, and a value carrying one was written by
  // something that is not a person typing.
  if (raw.includes('\u0000')) return { ok: false };
  return { ok: true, value: raw };
}
