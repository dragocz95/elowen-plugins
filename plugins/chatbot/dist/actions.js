import { ACTION_KINDS, CONFIRMATION_ACTION_KIND, TARGET_ID_PATTERN, requiresVisitorConfirmation, } from './publicContract.js';
/** How much text a `fill` or `select` may carry into a page. Larger than anything the snapshot reports,
 *  because writing a value is a different act from describing one, and still bounded so one action
 *  cannot paste a document into a field. */
const ACTION_VALUE_MAX_CHARS = 512;
/** Kinds that target one element. `scroll` without a target scrolls the page itself. */
const TARGET_REQUIRED = {
    read: true,
    focus: true,
    click: true,
    fill: true,
    select: true,
    scroll: false,
    request_submit: true,
};
/** Kinds that carry a value, and the ones that must not. */
const VALUE_REQUIRED = {
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
const CAPABILITY_FOR_KIND = {
    read: 'read',
    focus: 'focus',
    click: 'click',
    fill: 'fill',
    select: 'select',
    scroll: null,
    request_submit: CONFIRMATION_ACTION_KIND,
};
const isActionKind = (value) => ACTION_KINDS.includes(value);
/** Whether a name is one of the kinds this version has an action for. Exported because the server checks
 *  it before it looks anything up, and because a second membership test beside that one is how the two
 *  lists drift. */
export { isActionKind };
/** Whether a described target would submit a form. It is the ONE property that separates an ordinary
 *  click from an irreversible step, so it is read in one place only. */
export function targetWouldSubmit(target) {
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
export function decideAction(input) {
    const { request } = input;
    if (!isActionKind(request.kind))
        return { ok: false, reason: 'unknown_action' };
    const kind = request.kind;
    // A target id is only meaningful inside the snapshot that issued it. A frame naming another snapshot
    // than the one this turn recorded is describing a page nobody agreed on.
    if (input.snapshotId !== input.turnSnapshotId)
        return { ok: false, reason: 'stale_snapshot' };
    if (input.performedActions >= input.maxActionsPerTurn)
        return { ok: false, reason: 'action_budget_exhausted' };
    const value = readValue(kind, request.value);
    if (!value.ok)
        return { ok: false, reason: 'invalid_value' };
    const targetResult = readTarget(kind, request.targetId, input.targets);
    if (!targetResult.ok)
        return { ok: false, reason: targetResult.reason };
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
    if (kind === 'click' && targetWouldSubmit(target))
        return { ok: false, reason: 'submit_is_its_own_action' };
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
function readTarget(kind, raw, targets) {
    if (raw === null || raw === '') {
        // A kind that needs no target still refuses a target that is not a target: an id this policy cannot
        // resolve is not something to carry along and hope the page recognises.
        return TARGET_REQUIRED[kind] ? { ok: false, reason: 'unknown_target' } : { ok: true, value: null };
    }
    if (!TARGET_ID_PATTERN.test(raw))
        return { ok: false, reason: 'unknown_target' };
    const found = targets.find((target) => target.id === raw);
    if (!found)
        return { ok: false, reason: 'unknown_target' };
    if (!TARGET_REQUIRED[kind])
        return { ok: false, reason: 'unknown_target' };
    return { ok: true, value: found };
}
function readValue(kind, raw) {
    // `scroll` keeps one word: which way. It is the only kind whose value is a direction rather than text.
    if (kind === 'scroll') {
        return raw === null || raw === 'up' || raw === 'down' ? { ok: true, value: raw } : { ok: false };
    }
    // Every other kind either carries text or nothing at all, and nothing is spelled as an absent value.
    if (!VALUE_REQUIRED[kind])
        return raw === null ? { ok: true, value: null } : { ok: false };
    if (raw === null)
        return { ok: false };
    if (raw.length > ACTION_VALUE_MAX_CHARS)
        return { ok: false };
    // A NUL cannot survive a round trip through a form control, and a value carrying one was written by
    // something that is not a person typing.
    if (raw.includes('\u0000'))
        return { ok: false };
    return { ok: true, value: raw };
}
