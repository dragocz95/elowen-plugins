/** What the widget tells the server about the page the visitor is looking at.
 *
 *  Three rules shape everything here, and they are the reason this is a module of its own rather than a
 *  helper next to the panel:
 *
 *  1. NOTHING IS WATCHED. A description is taken when the visitor sends a message and at no other time:
 *     no observer, no interval, no cache of "the last state". The agent sees the page when and because the
 *     visitor wrote to it.
 *  2. NOTHING SENSITIVE LEAVES. A password, a file picker and anything that looks like a card number or a
 *     birth number are described by their label, type and validity, never by their value, and the agent
 *     may not write into them either.
 *  3. NOTHING UNBOUNDED LEAVES. A description has a byte ceiling and an element ceiling, values and labels
 *     have their own, and hitting either is reported as `truncated` rather than grown past.
 */

import {
  PAGE_FIELD_VALUE_MAX_CHARS,
  PAGE_SNAPSHOT_MAX_ELEMENTS,
  PAGE_SNAPSHOT_MAX_HEADINGS,
  PAGE_STATE_MAX_BYTES,
  PAGE_TEXT_MAX_CHARS,
  type ActionKind,
} from '../src/publicContract.js';
import { newSnapshotId } from './protocol.js';

/** One interactive element the server may be asked to act on, together with the element itself. The handle
 *  never leaves the page: it is how a target id comes back to the DOM once the server approved an action. */
export interface PageTargetHandle {
  id: string;
  caps: ActionKind[];
  element: HTMLElement;
}

export interface PageSnapshot {
  /** The id this description was issued under. Every target id is valid only inside it. */
  snapshotId: string;
  /** The bounded JSON that travels with the visitor's message. Always valid JSON, always within budget. */
  json: string;
  targets: PageTargetHandle[];
  truncated: boolean;
}

export interface SnapshotOptions {
  root?: HTMLElement;
  /** The byte ceiling of the serialized description. The caller passes the message's own budget so a
   *  snapshot that could not fit a message is never produced. */
  maxBytes?: number;
  maxElements?: number;
  viewport?: { width: number; height: number };
}

/** Subtrees that are not part of what a visitor sees and may not be described, whatever they contain. */
const EXCLUDED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META', 'TITLE', 'HEAD', 'BASE',
  'SVG', 'CANVAS', 'MAP', 'AREA', 'OBJECT', 'EMBED', 'AUDIO', 'VIDEO', 'TRACK', 'SOURCE', 'PICTURE',
  'DIALOG', 'DATALIST', 'OPTION', 'OPTGROUP',
]);

/** Types whose value is never described and which the agent may never write into. `file` is here because a
 *  chosen file is the visitor's own business; `hidden` because it is not on the page at all. */
const SENSITIVE_INPUT_TYPES = new Set(['password', 'file', 'hidden']);

/** Structured signals first: a field that declares itself as a card number or a password is treated as one
 *  whatever it is called. The name-based list below only ever REMOVES data, so a false positive costs the
 *  agent a value it did not need and a false negative costs nothing that mattered. */
const SENSITIVE_AUTOCOMPLETE = /^(cc-|current-password$|new-password$|one-time-code$|webauthn)/;

const SENSITIVE_HINTS = /(pass|heslo|hesla|pwd|pin\b|cvv|cvc|csc|card|kart[auy]?|credit|debit|iban|bic|swift|ucet|účet|cislo.?uctu|rodne|rodné|birth|ssn|security.?code|tajny|tajný)/i;

/** Input types the agent may write into. A range, a colour or a file picker is not a text value, and a
 *  synthetic write into one is a guess rather than a fill. */
const FILLABLE_INPUT_TYPES = new Set([
  'text', 'search', 'email', 'tel', 'url', 'number', 'date', 'month', 'week', 'time', 'datetime-local',
]);

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

const ROLE_CAPS: Record<string, ActionKind[]> = {
  button: ['click', 'focus'],
  link: ['click', 'focus'],
  checkbox: ['click', 'focus'],
  radio: ['click', 'focus'],
  switch: ['click', 'focus'],
  tab: ['click', 'focus'],
  menuitem: ['click', 'focus'],
  textbox: ['read', 'fill', 'focus'],
  searchbox: ['read', 'fill', 'focus'],
  combobox: ['read', 'select', 'focus'],
  listbox: ['read', 'select', 'focus'],
  spinbutton: ['read', 'fill', 'focus'],
};

const MAX_FORM_DESCRIPTIONS = 10;
const MAX_IFRAME_DESCRIPTIONS = 10;

interface DraftTarget {
  id: string;
  form: string | null;
  tag: string;
  type?: string;
  name?: string;
  label?: string;
  value?: string;
  checked?: boolean;
  required?: boolean;
  invalid?: boolean;
  caps: ActionKind[];
  handle: PageTargetHandle;
}

/** Describe the page as it is right now.
 *
 *  The walk is a depth-first pass over the elements a visitor could perceive, in document order, pruning
 *  whole subtrees at the first element that must not be described. Interactive elements are numbered in
 *  that order, so a target id means "the n-th thing on this page that could be used", and the numbering is
 *  meaningful only together with the snapshot id that was issued with it. */
export function capturePageSnapshot(options: SnapshotOptions = {}): PageSnapshot {
  const root = options.root ?? document.body ?? document.documentElement;
  const maxBytes = options.maxBytes ?? PAGE_STATE_MAX_BYTES;
  const maxElements = options.maxElements ?? PAGE_SNAPSHOT_MAX_ELEMENTS;
  const view = options.viewport ?? {
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  };

  // The id travels INSIDE the description, because the description is the only thing that reaches the server
  // with the visitor's message: a target id is meaningless without the snapshot that issued it, so a server
  // that stored the description without this would have nothing to check an action against.
  const snapshotId = newSnapshotId();
  const targets: DraftTarget[] = [];
  const headings: { level: number; text: string }[] = [];
  const iframes: { srcOrigin: string; title: string }[] = [];
  const forms = new Map<HTMLFormElement, string>();
  // Set when the element ceiling stops the walk. It is a different fact from a byte-trim later on, and both
  // are reported as `truncated` rather than hidden.
  let hitElementCeiling = false;

  const walk = (element: Element): void => {
    if (isExcluded(element)) return;
    const html = element as HTMLElement;

    if (element.tagName === 'IFRAME') {
      // Metadata only: where it points and what it is called. A cross-origin frame's contents are not
      // readable from here, and a same-origin one is left alone for the same reason — the page the visitor
      // is filling in is this document, not whatever a frame happens to contain.
      if (iframes.length < MAX_IFRAME_DESCRIPTIONS) {
        iframes.push({ srcOrigin: originOf((element as HTMLIFrameElement).src), title: textOf(element.getAttribute('title')) });
      }
      return;
    }

    if (!isVisible(html)) return;

    if (HEADING_TAGS.has(element.tagName) && headings.length < PAGE_SNAPSHOT_MAX_HEADINGS) {
      const text = truncate(textOf(html.textContent), PAGE_TEXT_MAX_CHARS);
      if (text !== '') headings.push({ level: Number(element.tagName.slice(1)), text });
    }

    const caps = capabilitiesOf(html);
    if (caps.length > 0) {
      if (targets.length >= maxElements) {
        // The element ceiling is reached: what follows is reported as omitted instead of walked, and the
        // snapshot says so rather than looking complete.
        hitElementCeiling = true;
        return;
      }
      const form = formOf(html);
      if (form && !forms.has(form) && forms.size < MAX_FORM_DESCRIPTIONS) forms.set(form, `f${forms.size}`);
      targets.push(describe(html, caps, form ? forms.get(form)! : null, `e${targets.length}`));
    }

    for (const child of Array.from(element.children)) walk(child);
  };

  for (const child of Array.from(root.children)) walk(child);

  const draft = {
    snapshotId,
    url: locationOriginAndPath(),
    title: truncate(textOf(document.title), PAGE_TEXT_MAX_CHARS),
    viewport: { width: view.width, height: view.height },
    language: textOf(document.documentElement.getAttribute('lang')).slice(0, 12),
    headings,
    forms: [...forms.entries()].map(([form, id]) => describeForm(form, id)),
    targets: targets.map(publicTarget),
    iframes,
    truncated: hitElementCeiling,
  };

  // Trim from the END, so what a visitor is most likely working with — the top of the page and the form
  // they are looking at — is what survives a byte ceiling.
  let truncated = draft.truncated;
  let json = JSON.stringify(draft);
  while (byteLength(json) > maxBytes && draft.targets.length > 0) {
    draft.targets.pop();
    truncated = true;
    json = JSON.stringify(draft);
  }
  if (truncated) json = JSON.stringify({ ...draft, truncated: true });

  return {
    snapshotId,
    json,
    targets: targets.slice(0, draft.targets.length).map((target) => target.handle),
    truncated,
  };
}

/** Whether this element's value may not leave the page, and whether the agent may write into it.
 *
 *  Exported because it is the whole of rule 2 above: a reviewer should be able to read one predicate and
 *  know what a snapshot can never contain. */
export function isSensitiveField(element: HTMLElement): boolean {
  if (element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA' && element.tagName !== 'SELECT') return false;
  const type = (element.getAttribute('type') ?? '').toLowerCase();
  if (SENSITIVE_INPUT_TYPES.has(type)) return true;
  if (SENSITIVE_AUTOCOMPLETE.test((element.getAttribute('autocomplete') ?? '').toLowerCase())) return true;
  const hints = [
    element.getAttribute('name'),
    element.getAttribute('id'),
    element.getAttribute('placeholder'),
    element.getAttribute('aria-label'),
    element.getAttribute('autocomplete'),
  ].filter((value): value is string => typeof value === 'string');
  return hints.some((hint) => SENSITIVE_HINTS.test(hint));
}

/** Whether clicking this element would send a form. The one property that separates an ordinary click from
 *  an irreversible step, so it is decided in one place and reported to the server as a capability. */
export function wouldSubmit(element: HTMLElement): boolean {
  const tag = element.tagName;
  if (tag !== 'INPUT' && tag !== 'BUTTON') return false;
  const type = (element.getAttribute('type') ?? '').toLowerCase();
  if (tag === 'INPUT') return type === 'submit' || type === 'image';
  if (type === 'submit') return true;
  // A button with no type is a submit button when it belongs to a form, and a plain control when it does
  // not. The form owner is what makes the difference, including a `form` attribute pointing elsewhere.
  if (type !== '') return false;
  return (element as HTMLButtonElement).form !== null;
}

/** What this element may be asked to do. An empty list means it is not interactive at all. */
function capabilitiesOf(element: HTMLElement): ActionKind[] {
  const tag = element.tagName;
  const caps = new Set<ActionKind>();
  const sensitive = isSensitiveField(element);

  if (wouldSubmit(element)) {
    // A submit is its own kind and never a click: the visitor is the one who sends a form, so the only
    // thing an agent may ask for here is the confirmed kind.
    caps.add('request_submit');
    caps.add('focus');
    return [...caps];
  }

  if (tag === 'INPUT') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'button' || type === 'reset') {
      caps.add('click');
      caps.add('focus');
      return [...caps];
    }
    if (type === 'checkbox' || type === 'radio') {
      caps.add('click');
      caps.add('focus');
      if (!sensitive) caps.add('read');
      return [...caps];
    }
    if (SENSITIVE_INPUT_TYPES.has(type)) {
      caps.add('focus');
      return [...caps];
    }
    if (FILLABLE_INPUT_TYPES.has(type)) {
      if (!sensitive) {
        caps.add('read');
        caps.add('fill');
      }
      caps.add('focus');
      return [...caps];
    }
    caps.add('focus');
    return [...caps];
  }

  if (tag === 'TEXTAREA') {
    if (!sensitive) {
      caps.add('read');
      caps.add('fill');
    }
    caps.add('focus');
    return [...caps];
  }

  if (tag === 'SELECT') {
    if (!sensitive) {
      caps.add('read');
      caps.add('select');
    }
    caps.add('focus');
    return [...caps];
  }

  if (tag === 'A' && element.hasAttribute('href')) {
    caps.add('click');
    caps.add('focus');
    return [...caps];
  }

  if (tag === 'BUTTON' || tag === 'SUMMARY') {
    caps.add('click');
    caps.add('focus');
    return [...caps];
  }

  if (element.isContentEditable) {
    caps.add('read');
    caps.add('fill');
    caps.add('focus');
    return [...caps];
  }

  const role = (element.getAttribute('role') ?? '').toLowerCase();
  const roleCaps = ROLE_CAPS[role];
  if (roleCaps) {
    for (const cap of roleCaps) caps.add(cap);
  }
  if (element.hasAttribute('tabindex')) caps.add('focus');
  return [...caps];
}

function describe(element: HTMLElement, caps: ActionKind[], form: string | null, id: string): DraftTarget {
  const sensitive = isSensitiveField(element);
  const draft: DraftTarget = { id, form, tag: element.tagName.toLowerCase(), caps, handle: { id, caps, element } };
  const type = element.getAttribute('type');
  if (type) draft.type = type.toLowerCase();
  const name = element.getAttribute('name');
  if (name) draft.name = textOf(name);
  const label = labelOf(element);
  if (label !== '') draft.label = label;

  if (!sensitive) {
    const value = valueOf(element);
    if (value !== undefined) draft.value = value;
  }
  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    draft.checked = element.checked;
  }
  if (isRequired(element)) draft.required = true;
  if (isInvalid(element)) draft.invalid = true;
  return draft;
}

/** The value a snapshot may carry. Never a sensitive one, never more than its own cap, and a value that was
 *  cut says so rather than pretending to be the whole of it. */
function valueOf(element: HTMLElement): string | undefined {
  if (element instanceof HTMLSelectElement) {
    const selected = element.selectedOptions[0];
    return selected ? textOf(selected.textContent) : '';
  }
  const value = (element as HTMLInputElement | HTMLTextAreaElement).value;
  if (typeof value !== 'string' || value === '') return '';
  return truncate(value, PAGE_FIELD_VALUE_MAX_CHARS);
}

function publicTarget(target: DraftTarget): Record<string, unknown> {
  const out: Record<string, unknown> = { id: target.id, tag: target.tag, caps: target.caps };
  if (target.form) out.form = target.form;
  if (target.type) out.type = target.type;
  if (target.name) out.name = target.name;
  if (target.label) out.label = target.label;
  if (target.value !== undefined) out.value = target.value;
  if (target.checked !== undefined) out.checked = target.checked;
  if (target.required) out.required = true;
  if (target.invalid) out.invalid = true;
  return out;
}

function describeForm(form: HTMLFormElement, id: string): Record<string, unknown> {
  const description: Record<string, unknown> = { id };
  const name = form.getAttribute('name') ?? form.getAttribute('id');
  if (name) description.name = textOf(name);
  const method = (form.getAttribute('method') ?? 'get').toLowerCase();
  if (method === 'post') description.method = 'post';
  // Where the form would go, without the query string: an action URL can carry values of its own, and the
  // agent needs to know the destination, not a parameter it never asked about.
  description.action = originAndPathOf(form.getAttribute('action'));
  return description;
}

/** The form a control belongs to, as the browser sees it. `form` is the owner decided by nesting or by the
 *  `form` attribute, which is the same element the visitor's submit would go through. */
function formOf(element: HTMLElement): HTMLFormElement | null {
  const owner = (element as HTMLInputElement).form;
  if (owner) return owner;
  return element.closest('form');
}

function isRequired(element: HTMLElement): boolean {
  if (element.hasAttribute('required')) return true;
  return element.getAttribute('aria-required') === 'true';
}

function isInvalid(element: HTMLElement): boolean {
  if (element.getAttribute('aria-invalid') === 'true') return true;
  const validity = (element as HTMLInputElement).validity;
  return typeof validity === 'object' && validity !== null && validity.valid === false;
}

/** What a person would read next to this field, in the order a screen reader would announce it. */
function labelOf(element: HTMLElement): string {
  const aria = textOf(element.getAttribute('aria-label'));
  if (aria !== '') return aria;
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
      .map((text) => textOf(text))
      .filter((text) => text !== '');
    if (parts.length > 0) return truncate(parts.join(' '), PAGE_TEXT_MAX_CHARS);
  }
  const labels = (element as HTMLInputElement).labels;
  if (labels && labels.length > 0) {
    const text = textOf(Array.from(labels).map((label) => label.textContent ?? '').join(' '));
    if (text !== '') return truncate(text, PAGE_TEXT_MAX_CHARS);
  }
  const wrapping = element.closest('label');
  if (wrapping) {
    const text = textOf(wrapping.textContent);
    if (text !== '') return truncate(text, PAGE_TEXT_MAX_CHARS);
  }
  for (const attribute of ['placeholder', 'title', 'name']) {
    const text = textOf(element.getAttribute(attribute));
    if (text !== '') return truncate(text, PAGE_TEXT_MAX_CHARS);
  }
  return '';
}

/** A subtree this description must not enter. Everything a visitor cannot see, and everything that is not
 *  content: scripts, styles, templates, media, and the widget's own element, which is not part of the page
 *  the visitor is filling in. */
function isExcluded(element: Element): boolean {
  if (EXCLUDED_TAGS.has(element.tagName)) return true;
  if (element.hasAttribute('data-elowen-chatbot')) return true;
  if (element.hasAttribute('hidden')) return true;
  if (element.getAttribute('aria-hidden') === 'true') return true;
  return false;
}

function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  // `checkVisibility` exists in current browsers and knows about `content-visibility`; where it does not,
  // the checks above plus the excluded attributes are what a page can be judged by.
  const withVisibility = element as HTMLElement & { checkVisibility?: (options?: { checkOpacity?: boolean }) => boolean };
  if (typeof withVisibility.checkVisibility === 'function' && !withVisibility.checkVisibility({ checkOpacity: true })) return false;
  return true;
}

function textOf(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Where the visitor is, without the query string or the fragment: a page's parameters can carry anything,
 *  including values the visitor typed, and the agent needs the page, not its state. */
function locationOriginAndPath(): string {
  if (typeof location === 'undefined') return '';
  return `${location.origin}${location.pathname}`;
}

function originAndPathOf(action: string | null): string {
  if (typeof action !== 'string' || action === '') return locationOriginAndPath();
  try {
    const url = new URL(action, typeof location === 'undefined' ? undefined : location.href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

function originOf(src: string): string {
  if (src === '') return '';
  try {
    return new URL(src, typeof location === 'undefined' ? undefined : location.href).origin;
  } catch {
    return '';
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
