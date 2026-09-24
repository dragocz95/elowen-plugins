/** Doing things to the page, on behalf of a server-approved action.
 *
 *  The reading and the acting are deliberately split: a description of the page is ours (see
 *  `pageSnapshot.ts`, where the bounds and the redaction live), while the synthetic events that actually
 *  drive a control come from `page-agent`'s deterministic page-controller half. It dispatches the real
 *  sequence a browser dispatches for a person — pointer, mouse, focus, click — and writes into a field
 *  through the native value setter, so a framework's own listeners run and a field React controls updates.
 *
 *  WHAT IS NOT HERE: no model, no network, no key, no agent loop. Only the package's page-controller is
 *  imported, never `@page-agent/core` or `@page-agent/llms`, so no model client can be reached from this
 *  bundle even by accident. The library's own messages are never forwarded either: they carry emoji and
 *  prose, and the only things that travel from here are the stable codes below and, for a `read`, a value
 *  the page itself already showed the visitor. */

import { clickElement, inputTextElement, scrollIntoViewIfNeeded, scrollVertically, selectOptionElement } from '@page-agent/page-controller';
import type { ApprovedAction } from '../src/actions.js';
import { PAGE_FIELD_VALUE_MAX_CHARS, type PageFailureDetail } from '../src/publicContract.js';
import { isSensitiveField, wouldSubmit, type PageTargetHandle } from './pageSnapshot.js';

/** What a browser applied. `detail` is a stable code the plugin knows, or the value a `read` asked for. */
export interface ActionReport {
  outcome: 'done' | 'error';
  detail?: string;
}

/** Typed as the shared codes rather than as plain strings: the plugin reads a failure code as its own word
 *  for what happened, so a code it does not know is one it must never be sent. */
export const TARGET_GONE: PageFailureDetail = 'target_gone';
export const FORM_INVALID: PageFailureDetail = 'form_invalid';
const NO_FORM: PageFailureDetail = 'no_form';
const ACTION_FAILED: PageFailureDetail = 'action_failed';

/** The kinds this module performs directly. Submitting is not one of them: it is reached only through the
 *  visitor's own confirmation, so it lives in `submitForm` and is never part of a plain action. */
export type PerformableAction = ApprovedAction & { kind: Exclude<ApprovedAction['kind'], 'request_submit'> };

/** How far one `scroll` moves. One comfortable screenful, not a jump to an unknown place. */
const SCROLL_PIXELS = 600;

export async function performAction(action: PerformableAction, targets: readonly PageTargetHandle[]): Promise<ActionReport> {
  if (action.kind === 'scroll' && action.targetId === null) {
    await scrollVertically(action.value === 'up' ? -SCROLL_PIXELS : SCROLL_PIXELS);
    return { outcome: 'done' };
  }

  const handle = action.targetId === null ? null : targets.find((target) => target.id === action.targetId) ?? null;
  // The element is looked up in the handles of the very snapshot the action was approved against. An
  // element that left the page in the meantime is reported as gone rather than replaced by a lookalike.
  if (!handle || !handle.element.isConnected) return { outcome: 'error', detail: TARGET_GONE };
  const element = handle.element;
  // Re-check live controls: a page can change a type, name or form owner since the snapshot.
  if (isSensitiveField(element) && action.kind !== 'focus') return { outcome: 'error', detail: 'capability_not_granted' };
  if (action.kind === 'click' && wouldSubmit(element)) return { outcome: 'error', detail: 'submit_is_its_own_action' };
  if (action.kind === 'click' && element.closest('a[href]')) return { outcome: 'error', detail: 'navigation_not_allowed' };

  try {
    switch (action.kind) {
      case 'read':
        return { outcome: 'done', detail: readValueOf(element) };
      case 'focus':
        await scrollIntoViewIfNeeded(element);
        element.focus({ preventScroll: true });
        return { outcome: 'done' };
      case 'click':
        await clickElement(element);
        return { outcome: 'done' };
      case 'fill':
        await inputTextElement(element, action.value ?? '');
        return { outcome: 'done' };
      case 'select':
        await selectOptionElement(element as HTMLSelectElement, action.value ?? '');
        return { outcome: 'done' };
      case 'scroll':
        await scrollIntoViewIfNeeded(element);
        return { outcome: 'done' };
      default:
        return { outcome: 'error', detail: ACTION_FAILED };
    }
  } catch {
    return { outcome: 'error', detail: ACTION_FAILED };
  }
}

/** The value a page control holds right now, as one short string. A checkbox or a radio answers with its
 *  state, because that is what a reader of the answer needs to learn. */
function readValueOf(element: HTMLElement): string {
  const control = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    return element.checked ? 'true' : 'false';
  }
  if (element instanceof HTMLSelectElement) {
    return (element.selectedOptions[0]?.textContent ?? '').trim().slice(0, PAGE_FIELD_VALUE_MAX_CHARS);
  }
  return typeof control.value === 'string' ? control.value.slice(0, PAGE_FIELD_VALUE_MAX_CHARS) : '';
}

/** Send a form, and only ever after the visitor confirmed it.
 *
 *  `requestSubmit` is what makes this a person's submission rather than a script's: it runs the page's own
 *  submit handling, its validation and its listeners, and it carries the submitter that was clicked, so a
 *  form that branches on which button was pressed behaves as it would for a visitor.
 *
 *  A form that does not validate is NOT submitted and says so: quietly submitting its first invalid field
 *  is not something a page's own validation would ever do, and the agent needs to learn what to fix. */
export async function submitForm(element: HTMLElement): Promise<ActionReport> {
  const form = formOwner(element);
  if (!form) return { outcome: 'error', detail: NO_FORM };
  if (!form.checkValidity()) return { outcome: 'error', detail: FORM_INVALID };
  await scrollIntoViewIfNeeded(element);
  try {
    if (isSubmitter(element) && formOwner(element) === form) form.requestSubmit(element as HTMLElement & { type: string });
    else form.requestSubmit();
    return { outcome: 'done' };
  } catch {
    return { outcome: 'error', detail: ACTION_FAILED };
  }
}

/** The form element a control belongs to: the owner the browser itself would use, including a `form`
 *  attribute that points somewhere else in the document. */
function formOwner(element: HTMLElement): HTMLFormElement | null {
  return (element as HTMLInputElement).form ?? element.closest('form');
}

function isSubmitter(element: HTMLElement): boolean {
  if (element.tagName === 'INPUT') {
    const type = (element.getAttribute('type') ?? '').toLowerCase();
    return type === 'submit' || type === 'image';
  }
  if (element.tagName !== 'BUTTON') return false;
  const type = (element.getAttribute('type') ?? '').toLowerCase();
  return type === 'submit' || type === '';
}
