import { generateAriaTree, renderAriaTree, type AriaNode } from 'ivya/aria';
import { PAGE_FIELD_VALUE_MAX_CHARS, PAGE_SNAPSHOT_MAX_ELEMENTS, PAGE_STATE_MAX_BYTES, PAGE_TEXT_MAX_CHARS, type ActionKind } from '../src/publicContract.js';
import { newSnapshotId } from './protocol.js';

export interface PageTargetHandle {
  id: string;
  caps: ActionKind[];
  element: HTMLElement;
}
export interface PageSnapshot {
  snapshotId: string;
  json: string;
  targets: PageTargetHandle[];
  truncated: boolean;
}
export interface SnapshotOptions {
  root?: HTMLElement;
  maxBytes?: number;
  maxElements?: number;
}

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


/** Clone only inert markup. No scripts, resources, event handlers, custom element constructors or
 * sensitive control values can reach the aria generator. The live page is never edited.
 * Computed visibility is resolved on originals, before cloning; the offscreen shadow has no site CSS. */
const EXCLUDED = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'META', 'LINK', 'BASE', 'IFRAME', 'OBJECT', 'EMBED']);
const ATTRIBUTES = new Set(['id', 'role', 'for', 'name', 'type', 'href', 'title', 'alt', 'placeholder', 'required', 'disabled', 'checked', 'selected', 'open', 'multiple', 'tabindex']);
const MAX_NODES = 8000;

export function pageMetadata(): { url: string; title: string } {
  return { url: location.origin + location.pathname, title: document.title.slice(0, PAGE_TEXT_MAX_CHARS) };
}

export function capturePageSnapshot(options: SnapshotOptions = {}): PageSnapshot {
  const root = options.root ?? document.body;
  const maxBytes = options.maxBytes ?? PAGE_STATE_MAX_BYTES;
  const maxElements = options.maxElements ?? PAGE_SNAPSHOT_MAX_ELEMENTS;
  const snapshotId = newSnapshotId();
  const targets: PageTargetHandle[] = [];
  const pairs: { original: HTMLElement; clone: HTMLElement; caps: ActionKind[] }[] = [];
  let count = 0;
  let truncated = false;
  const host = document.createElement('div');
  host.setAttribute('data-elowen-chatbot', 'snapshot');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:1000px;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const copy = (node: Node): Node | null => {
    if (++count > MAX_NODES) { truncated = true; return null; }
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue ?? '');
    if (!(node instanceof HTMLElement) || EXCLUDED.has(node.tagName) || node.hasAttribute('data-elowen-chatbot')) return null;
    const style = getComputedStyle(node);
    if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.contentVisibility === 'hidden') return null;
    const clone = document.createElement(node.localName.includes('-') ? 'div' : node.localName);
    const sensitive = isSensitiveField(node);
    for (const attribute of Array.from(node.attributes)) {
      if (ATTRIBUTES.has(attribute.name) || attribute.name.startsWith('aria-')) {
        if (sensitive && ['aria-valuenow', 'aria-valuetext'].includes(attribute.name)) continue;
        if (attribute.name === 'href') {
          try {
            const url = new URL(attribute.value, location.href);
            if (['https:', 'http:'].includes(url.protocol)) clone.setAttribute('href', url.origin + url.pathname);
          } catch { /* An invalid destination is not described as a usable link. */ }
        } else clone.setAttribute(attribute.name, attribute.value);
      }
    }
    clone.removeAttribute('aria-owns');
    clone.style.display = style.display;
    clone.style.visibility = 'visible';
    if (node instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
      if (!sensitive && node.type !== 'file') clone.value = node.value.slice(0, PAGE_FIELD_VALUE_MAX_CHARS);
      clone.checked = node.checked;
    }
    if (node instanceof HTMLTextAreaElement && clone instanceof HTMLTextAreaElement && !sensitive) clone.value = node.value.slice(0, PAGE_FIELD_VALUE_MAX_CHARS);
    if (node.isContentEditable && !sensitive) clone.setAttribute('role', node.getAttribute('role') ?? 'textbox');
    if (node instanceof HTMLOptionElement && clone instanceof HTMLOptionElement) clone.selected = node.selected;
    const caps = capabilitiesOf(node);
    if (caps.length > 0) {
      if (pairs.length < maxElements) pairs.push({ original: node, clone, caps });
      else truncated = true;
    }
    if (!(node instanceof HTMLTextAreaElement) && !sensitive) {
      const children = node instanceof HTMLSlotElement ? node.assignedNodes({ flatten: true }) : node.shadowRoot ? Array.from(node.shadowRoot.childNodes) : Array.from(node.childNodes);
      for (const child of children) { const copied = copy(child); if (copied) clone.append(copied); }
    }
    return clone;
  };
  const cloned = copy(root);
  if (cloned) shadow.append(cloned);
  document.body.append(host);
  try {
    // Resolve names with ivya, then annotate the inert copy, not the page. The final aria tree and all
    // actionable handles are produced synchronously from this one frozen copy, never by matching names.
    for (const { original, clone, caps } of pairs) {
      const tree = generateAriaTree(clone);
      const first = tree.children.find((child): child is AriaNode => typeof child !== 'string');
      const id = 'e' + targets.length;
      const name = first?.name ?? '';
      clone.removeAttribute('aria-labelledby');
      clone.setAttribute('aria-label', (name ? name + ' ' : '') + '[' + id + ']');
      if (!first) clone.setAttribute('role', 'generic');
      targets.push({ id, caps, element: original });
    }
    const tree = cloned instanceof Element ? generateAriaTree(cloned) : null;
    const draft = {
      snapshotId, ...pageMetadata(),
      aria: tree ? renderAriaTree(tree) : '',
      targets: targets.map(({ id, caps }) => ({ id, caps })),
      truncated,
    };
    // Bound the entire tool result, including handles. Trim complete aria lines, never malformed JSON.
    while (new TextEncoder().encode(JSON.stringify(draft)).length > maxBytes && draft.aria !== '') {
      const cut = draft.aria.lastIndexOf('\n');
      draft.aria = cut < 0 ? '' : draft.aria.slice(0, cut);
      draft.truncated = true;
    }
    // A handle absent from the text the model saw must not remain actionable.
    const retained = targets.filter(target => draft.aria.includes('[' + target.id + ']'));
    draft.targets = retained.map(({ id, caps }) => ({ id, caps }));
    const json = JSON.stringify(draft);
    if (new TextEncoder().encode(json).length > maxBytes) throw new Error('Snapshot metadata exceeds its byte bound');
    return { snapshotId, json, targets: retained, truncated: draft.truncated };
  } finally { host.remove(); }
}

export function isSensitiveField(element: HTMLElement): boolean {
  if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) && !element.isContentEditable
    && !['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(element.getAttribute('role') ?? '')) return false;
  const type = (element.getAttribute('type') ?? '').toLowerCase();
  if (SENSITIVE_INPUT_TYPES.has(type)) return true;
  if ((element.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/).some(token => SENSITIVE_AUTOCOMPLETE.test(token))) return true;
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
  if (sensitive) return ['focus'];

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
