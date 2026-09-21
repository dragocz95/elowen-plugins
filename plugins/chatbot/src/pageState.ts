import {
  ACTION_KINDS,
  MESSAGE_MAX_BYTES,
  PAGE_SNAPSHOT_MAX_ELEMENTS,
  PAGE_STATE_LABEL,
  PAGE_STATE_MAX_BYTES,
  SNAPSHOT_ID_PATTERN,
  TARGET_ID_PATTERN,
} from './publicContract.js';
import type { ActionTarget } from './actions.js';
import type { Validated } from './validation.js';

/** The page state a turn RECORDED, as the server reads it back.
 *
 *  A visitor's message and the description of the page they are looking at travel as ONE text: the public
 *  hook has a single field for a message and one body to bound, so the widget composes the description into
 *  it (see `composeMessage` in the widget's protocol module). This is the server's half of that decision —
 *  the block is found again, and ONLY the four facts an action has to be decided against are read out of
 *  it: which snapshot the ids belong to, where the page is, and what each target may be asked to do.
 *  Everything else in the description is context for the MODEL and evidence for nobody.
 *
 *  Nothing here is believed. The block arrives from an anonymous page, and the visitor's own words are
 *  composed into the same text, so:
 *
 *  - the marker is searched for from the END of the message. The widget always appends the real description
 *    last, so a visitor who types the marker into their own message cannot put a description of their own in
 *    front of it and have the server act on that instead;
 *  - the block cannot contain the marker itself: it is compact JSON (no raw newlines) whose every string was
 *    collapsed by the widget, so a page's own text cannot end the block early;
 *  - every field is validated structurally — shapes, patterns, allowlisted capability names — and a value
 *    this module does not recognise is a refusal, never a guess. */

export interface RecordedPageState {
  /** The snapshot the target ids below are meaningful inside, exactly as the widget issued it. */
  snapshotId: string;
  /** The page's own origin, `scheme://host[:port]`, and its path without query or fragment. This is what
   *  the action rule is resolved against. */
  origin: string;
  path: string;
  targets: ActionTarget[];
}

const MARKER = `\n\n${PAGE_STATE_LABEL}\n`;
const MAX_TARGETS = PAGE_SNAPSHOT_MAX_ELEMENTS;

const refuse = (error: string): Validated<RecordedPageState> => ({ ok: false, error });

export function readRecordedPageState(message: string): Validated<RecordedPageState> {
  if (Buffer.byteLength(message, 'utf8') > MESSAGE_MAX_BYTES) return refuse('the message is larger than the hook accepts');
  const marker = message.lastIndexOf(MARKER);
  if (marker === -1) return refuse('this turn recorded no page state');
  const json = message.slice(marker + MARKER.length);
  if (Buffer.byteLength(json, 'utf8') > PAGE_STATE_MAX_BYTES) return refuse('the page state is larger than a snapshot may be');

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return refuse('the page state is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return refuse('the page state is not a JSON object');
  const state = parsed as Record<string, unknown>;

  const snapshotId = state.snapshotId;
  if (typeof snapshotId !== 'string' || !SNAPSHOT_ID_PATTERN.test(snapshotId)) return refuse('the page state carries no usable snapshot id');

  const url = readUrl(state.url);
  if (!url.ok) return url;

  const targets = readTargets(state.targets);
  if (!targets.ok) return targets;

  return { ok: true, value: { snapshotId, origin: url.value.origin, path: url.value.path, targets: targets.value } };
}

/** Where the description says the page is. The widget sends `origin + pathname` and nothing else, so a
 *  value carrying a query, a fragment or another scheme is not one this widget produced: it is refused
 *  rather than normalised, because the action rule is decided against exactly what arrives. */
function readUrl(raw: unknown): Validated<{ origin: string; path: string }> {
  if (typeof raw !== 'string' || raw === '') return { ok: false, error: 'the page state carries no URL' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'the page state carries an unparsable URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'the page is not an http(s) page' };
  if (url.origin === 'null' || url.host === '') return { ok: false, error: 'the page state carries no origin' };
  if (url.search !== '' || url.hash !== '') return { ok: false, error: 'the page state carries a query or a fragment' };
  return { ok: true, value: { origin: url.origin, path: url.pathname } };
}

/** The targets the description lists, reduced to the two things a decision needs: an id, and what the page
 *  itself claims may be done with it. A duplicate id is refused outright — an action naming it could mean
 *  either element, and the plugin has no way to say which one it approved. */
function readTargets(raw: unknown): Validated<ActionTarget[]> {
  if (!Array.isArray(raw)) return { ok: false, error: 'the page state lists no targets' };
  if (raw.length > MAX_TARGETS) return { ok: false, error: 'the page state lists more targets than a snapshot may' };
  const targets: ActionTarget[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return { ok: false, error: 'a target is not a JSON object' };
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== 'string' || !TARGET_ID_PATTERN.test(id)) return { ok: false, error: 'a target carries no usable id' };
    if (seen.has(id)) return { ok: false, error: `the page state lists the target ${id} twice` };
    seen.add(id);
    const caps = record.caps;
    if (!Array.isArray(caps)) return { ok: false, error: `the target ${id} claims no capabilities` };
    for (const cap of caps) {
      if (typeof cap !== 'string' || !(ACTION_KINDS as readonly string[]).includes(cap)) {
        return { ok: false, error: `the target ${id} claims a capability this version has no action for` };
      }
    }
    targets.push({ id, caps: caps as string[] });
  }
  return { ok: true, value: targets };
}
