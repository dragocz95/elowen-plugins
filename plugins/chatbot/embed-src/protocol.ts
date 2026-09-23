/** The v1 wire protocol, as the widget speaks it.
 *
 *  Every constant comes from `../src/publicContract.js` — the same module the daemon-side public route is
 *  compiled from — so a frame type, a path or a bound cannot be spelled differently on the two sides of
 *  the boundary. This module adds what only the client needs: composing a message, parsing a frame, and
 *  building a request body. */

import {
  ACTION_DECISIONS,
  ACTION_KINDS,
  ACTION_OUTCOMES,
  MESSAGE_MAX_BYTES,
  PAGE_CONTEXT_LABEL,
  PUBLIC_FRAME_TYPES,
  PUBLIC_SCHEMA_VERSION,
  SNAPSHOT_ID_PATTERN,
  VISITOR_MESSAGE_LABEL,
  requiresVisitorConfirmation,
  type ActionDecision,
  type ActionKind,
  type ActionOutcome,
  type PublicFrameType,
} from '../src/publicContract.js';

/** A frame as it arrived. `data` is what the caller validates per type; nothing here has been believed
 *  beyond "this is a frame of this version and this type". */
export interface TurnFrame {
  type: PublicFrameType;
  turnId: string | null;
  seq: number;
  data: Record<string, unknown>;
}

/** One line of the NDJSON stream, or null for a line this client will not act on.
 *
 *  A line that is not JSON, carries another schema version, or names a type this version does not know is
 *  ignored rather than guessed at: the stream is the only place a browser learns anything from the server,
 *  so what it does not recognise must be nothing at all. */
export function parseFrame(line: string): TurnFrame | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== PUBLIC_SCHEMA_VERSION) return null;
  if (typeof record.type !== 'string' || !(PUBLIC_FRAME_TYPES as readonly string[]).includes(record.type)) return null;
  const data = typeof record.data === 'object' && record.data !== null && !Array.isArray(record.data)
    ? (record.data as Record<string, unknown>)
    : {};
  return {
    type: record.type as PublicFrameType,
    turnId: typeof record.turnId === 'string' && record.turnId !== '' ? record.turnId : null,
    seq: typeof record.seq === 'number' && Number.isSafeInteger(record.seq) && record.seq >= 0 ? record.seq : 0,
    data,
  };
}

/** Split a stream chunk buffer into complete lines, keeping the remainder for the next chunk. A frame is
 *  a line; a JSON object split across two reads must never be parsed as two broken halves. */
export function readLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  return { lines: parts, rest };
}

// ── the composed model input ─────────────────────────────────────────────────────────────────────────

/** What the visitor wrote, and the page state that goes with it, as one message.
 *
 *  The page state is composed into the message TEXT because that is the only place the public hook takes
 *  it: the turn body is validated strictly and has no field for a snapshot, and a second endpoint carrying
 *  page contents would be one more surface to bound. The block is labelled for what it is — data from an
 *  unauthenticated page — so the model reads it as evidence about a page rather than as instructions. */
export function composeMessage(visitorText: string, pageStateJson: string): { message: string; pageStateIncluded: boolean } {
  const composed = `${VISITOR_MESSAGE_LABEL}\n${visitorText}\n\n${PAGE_CONTEXT_LABEL}\n${pageStateJson}`;
  if (byteLength(composed) <= MESSAGE_MAX_BYTES) return { message: composed, pageStateIncluded: true };
  // Both halves respect their own caps before they get here, so this is a belt rather than a path: rather
  // than cut JSON in half and hand the model something unparsable, the page state is dropped and the
  // visitor's own words still arrive.
  return { message: `${VISITOR_MESSAGE_LABEL}\n${visitorText}`, pageStateIncluded: false };
}

/** The visitor's own words out of a composed message. A restored transcript shows what the visitor wrote,
 *  never the page state that travelled with it. */
export function readVisitorText(composed: string): string {
  const withoutLabel = composed.startsWith(`${VISITOR_MESSAGE_LABEL}\n`)
    ? composed.slice(VISITOR_MESSAGE_LABEL.length + 1)
    : composed;
  const marker = `\n\n${PAGE_CONTEXT_LABEL}\n`;
  const cut = withoutLabel.indexOf(marker);
  return cut === -1 ? withoutLabel : withoutLabel.slice(0, cut);
}

// ── request bodies ───────────────────────────────────────────────────────────────────────────────────

export function publicBotRequestBody(publicId: string): Record<string, unknown> {
  return { schemaVersion: PUBLIC_SCHEMA_VERSION, bot: publicId };
}

/** A request that carries nothing but the version: a token rotation, which speaks through the credential it
 *  presents rather than through its body. */
export function schemaVersionBody(): Record<string, unknown> {
  return { schemaVersion: PUBLIC_SCHEMA_VERSION };
}

export function turnRequestBody(clientTurnId: string, message: string): Record<string, unknown> {
  return { schemaVersion: PUBLIC_SCHEMA_VERSION, clientTurnId, message };
}

/** The outcome of one performed action, as the server records it. */
export function actionResultBody(outcome: ActionOutcome, detail?: string): Record<string, unknown> {
  if (!(ACTION_OUTCOMES as readonly string[]).includes(outcome)) throw new Error(`unknown action outcome ${outcome}`);
  return detail === undefined
    ? { schemaVersion: PUBLIC_SCHEMA_VERSION, outcome }
    : { schemaVersion: PUBLIC_SCHEMA_VERSION, outcome, detail };
}

/** The visitor's answer to a confirmation, carrying the nonce the server issued with the action. The nonce
 *  is what makes a confirmation usable once: a replayed decision is refused rather than a second submit. */
export function actionDecisionBody(decision: ActionDecision, nonce: string): Record<string, unknown> {
  if (!(ACTION_DECISIONS as readonly string[]).includes(decision)) throw new Error(`unknown action decision ${decision}`);
  return { schemaVersion: PUBLIC_SCHEMA_VERSION, decision, nonce };
}

// ── action frames ────────────────────────────────────────────────────────────────────────────────────

/** One action the server approved for this turn, as the frame describes it.
 *
 *  `requiresConfirmation` is not taken on trust: a frame that says an irreversible kind needs no
 *  confirmation contradicts the contract and is dropped. */
export interface ActionFrame {
  actionId: string;
  kind: ActionKind;
  targetId: string | null;
  value: string | null;
  snapshotId: string;
  requiresConfirmation: boolean;
  /** Always present: every action carries a nonce, and a frame whose nonce is missing or malformed is one
   *  this reader drops rather than hands on. The type says what the reader guarantees, so no consumer has to
   *  invent a fallback for a frame that could not have reached it. */
  confirmationNonce: string;
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function readActionFrame(data: Record<string, unknown>): ActionFrame | null {
  const { actionId, kind, targetId, value, snapshotId, confirmationNonce } = data;
  if (typeof actionId !== 'string' || !CANONICAL_UUID.test(actionId)) return null;
  if (typeof kind !== 'string' || !(ACTION_KINDS as readonly string[]).includes(kind)) return null;
  if (typeof snapshotId !== 'string' || (kind !== 'snapshot' && !SNAPSHOT_ID_PATTERN.test(snapshotId))) return null;
  if (typeof confirmationNonce !== 'string' || confirmationNonce.length < 8 || confirmationNonce.length > 128) return null;
  if (typeof data.requiresConfirmation !== 'boolean') return null;
  const requiresConfirmation = requiresVisitorConfirmation(kind as ActionKind);
  if (data.requiresConfirmation !== requiresConfirmation) return null;
  const target = readOptionalText(targetId);
  const text = readOptionalText(value);
  return {
    actionId,
    kind: kind as ActionKind,
    targetId: target,
    value: text,
    snapshotId,
    requiresConfirmation,
    confirmationNonce,
  };
}

function readOptionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  return value.length > 4096 ? null : value;
}

// ── ids ──────────────────────────────────────────────────────────────────────────────────────────────

const HEX = '0123456789abcdef';

function randomHex(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += HEX[byte >> 4]! + HEX[byte & 15]!;
  return out;
}

/** A turn id this client chose. The server treats it as an idempotency key: a widget that lost the `202`
 *  retries with the same one and receives the same turn instead of a second model turn. */
export function newClientTurnId(): string {
  const hex = randomHex(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The id of the page description that travels with one message. A target id is only ever meaningful
 *  inside the snapshot that issued it, and this is what the server checks it against. */
export function newSnapshotId(): string {
  return `s${randomHex(8)}`;
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}