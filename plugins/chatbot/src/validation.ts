import { ACTION_PATH_PREFIX_MAX_CHARS, normalizeActionPathPrefix } from './adminContract.js';
import { isWildcardOrigin, normalizeOrigin } from './origin.js';
import { isActionKind } from './actions.js';
import type { ActionRuleInput } from './store.js';
import {
  ACTION_DECISIONS,
  ACTION_OUTCOMES,
  CONFIRMATION_ACTION_KIND,
  MESSAGE_MAX_BYTES,
  PAGE_FAILURE_DETAILS,
  PUBLIC_SCHEMA_VERSION,
  WIDGET_MAX_ACTIONS_PER_TURN,
  requiresVisitorConfirmation,
  type ActionDecision,
  type ActionOutcome,
} from './publicContract.js';

/** Every payload that crosses a trust boundary — the public hook and the admin API — is validated here,
 *  strictly: unknown keys are REFUSED rather than ignored, so a client that sends a field this version
 *  does not implement learns that instead of believing it took effect. */
export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/** A visitor message is bounded by BYTES, not characters: the bound is what the hook will accept, and a
 *  message of multi-byte text is larger than its length. The length comparison inside `readString` is only
 *  a cheap pre-check; the byte comparison in `validateTurnSubmission` is the real one. */
const DISPLAY_NAME_MAX_CHARS = 80;
const PROMPT_MAX_CHARS = 8_000;
const ORIGINS_MAX = 20;

/** How much of a page's own explanation may be kept with an action. A `read` answers with the value it
 *  found, and a failed action with a stable code — both are short, and a page that sends more is not
 *  answering the question it was asked. */
const RESULT_DETAIL_MAX_CHARS = 200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCanonicalUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

const utf8Length = (value: string): number => Buffer.byteLength(value, 'utf8');

/** A plain JSON object with exactly the given keys. Anything else — an array, null, a prototype trick,
 *  an extra field — is a refusal with the offending key named. */
function strictObject(input: unknown, allowed: readonly string[], required: readonly string[] = []): Validated<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, error: 'body must be a JSON object' };
  const record = input as Record<string, unknown>;
  const allow = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allow.has(key)) return { ok: false, error: `unknown field "${key}"` };
  }
  for (const key of required) {
    if (!(key in record)) return { ok: false, error: `missing field "${key}"` };
  }
  return { ok: true, value: record };
}

const readSchemaVersion = (record: Record<string, unknown>): Validated<true> =>
  record.schemaVersion === PUBLIC_SCHEMA_VERSION
    ? { ok: true, value: true }
    : { ok: false, error: `schemaVersion must be ${PUBLIC_SCHEMA_VERSION}` };

const readString = (record: Record<string, unknown>, key: string, maxChars: number): Validated<string> => {
  const value = record[key];
  if (typeof value !== 'string') return { ok: false, error: `"${key}" must be a string` };
  if (value.length > maxChars) return { ok: false, error: `"${key}" is too long` };
  return { ok: true, value };
};

/** An absent field means its empty value on a create, which is how a draft chatbot starts out. */
const readOptionalString = (record: Record<string, unknown>, key: string, maxChars: number): Validated<string> =>
  record[key] === undefined ? { ok: true, value: '' } : readString(record, key, maxChars);

/** A public id is issued by this plugin and only ever compared, never parsed for meaning. The shape check
 *  keeps an unbounded string out of a database lookup. */
const PUBLIC_ID_PATTERN = /^cbt_[0-9a-f]{24}$/;

export function isPublicId(value: string): boolean {
  return PUBLIC_ID_PATTERN.test(value);
}

// ── public hook payloads ─────────────────────────────────────────────────────────────────────────────

/** `POST v1/visitors`: the chatbot is named by its public id, which is public by design. Authority comes
 *  from the allowed `Origin`, the trusted request origin and the chatbot being enabled — never from this
 *  field. */
export function validateTokenIssuance(body: unknown): Validated<{ bot: string }> {
  const outer = strictObject(body, ['schemaVersion', 'bot'], ['schemaVersion', 'bot']);
  if (!outer.ok) return outer;
  const version = readSchemaVersion(outer.value);
  if (!version.ok) return version;
  const bot = readString(outer.value, 'bot', 64);
  if (!bot.ok) return bot;
  if (!isPublicId(bot.value)) return { ok: false, error: '"bot" is not a public id' };
  return { ok: true, value: { bot: bot.value } };
}

/** `POST v1/turns`. The visitor token is the authority and is read from the request headers, never from
 *  the body, so the body cannot claim to be someone else. */
export function validateTurnSubmission(body: unknown): Validated<{ clientTurnId: string; message: string }> {
  const outer = strictObject(body, ['schemaVersion', 'clientTurnId', 'message'], ['schemaVersion', 'clientTurnId', 'message']);
  if (!outer.ok) return outer;
  const version = readSchemaVersion(outer.value);
  if (!version.ok) return version;
  const clientTurnId = readString(outer.value, 'clientTurnId', 36);
  if (!clientTurnId.ok) return clientTurnId;
  if (!isCanonicalUuid(clientTurnId.value)) return { ok: false, error: '"clientTurnId" must be a canonical UUID' };
  const message = readString(outer.value, 'message', MESSAGE_MAX_BYTES);
  if (!message.ok) return message;
  if (message.value.trim() === '') return { ok: false, error: '"message" must not be empty' };
  if (utf8Length(message.value) > MESSAGE_MAX_BYTES) return { ok: false, error: '"message" is too long' };
  return { ok: true, value: { clientTurnId: clientTurnId.value, message: message.value } };
}

// ── page action reports ───────────────────────────────────────────────────────────────────────────────

/** `POST v1/turns/:turnId/actions/:actionId/result`. What the visitor's page did with an action the server
 *  approved.
 *
 *  `detail` means two different things and is validated as two. A page that FAILED or was REFUSED may only
 *  name a code this plugin knows: a reason the model reads is the plugin's own word for what happened, and
 *  an unrecognized string dressed as one would be a page putting words in the plugin's mouth. The value a
 *  `read` found is the page's own text, so it is bounded rather than recognized — and it is handed to the
 *  model as page data, never as a reason. */

export function validateActionResult(body: unknown): Validated<{ outcome: ActionOutcome; detail: string | null }> {
  const outer = strictObject(body, ['schemaVersion', 'outcome', 'detail'], ['schemaVersion', 'outcome']);
  if (!outer.ok) return outer;
  const version = readSchemaVersion(outer.value);
  if (!version.ok) return version;
  const outcome = readString(outer.value, 'outcome', 16);
  if (!outcome.ok) return outcome;
  if (!(ACTION_OUTCOMES as readonly string[]).includes(outcome.value)) {
    return { ok: false, error: 'that is not an outcome this version reports' };
  }
  if (outer.value.detail === undefined) return { ok: true, value: { outcome: outcome.value as ActionOutcome, detail: null } };
  const detail = readString(outer.value, 'detail', RESULT_DETAIL_MAX_CHARS);
  if (!detail.ok) return detail;
  if (outcome.value !== 'done' && !(PAGE_FAILURE_DETAILS as readonly string[]).includes(detail.value)) {
    return { ok: false, error: 'that is not a reason this version reports' };
  }
  return { ok: true, value: { outcome: outcome.value as ActionOutcome, detail: detail.value } };
}

/** `POST v1/turns/:turnId/actions/:actionId/confirmation`. The visitor's own answer, carrying the nonce the
 *  server issued with the action: the nonce is what makes it good for one action and one submission, and a
 *  caller that does not hold it is not the page this action was sent to. */
export function validateActionDecision(body: unknown): Validated<{ decision: ActionDecision; nonce: string }> {
  const outer = strictObject(body, ['schemaVersion', 'decision', 'nonce'], ['schemaVersion', 'decision', 'nonce']);
  if (!outer.ok) return outer;
  const version = readSchemaVersion(outer.value);
  if (!version.ok) return version;
  const decision = readString(outer.value, 'decision', 16);
  if (!decision.ok) return decision;
  if (!(ACTION_DECISIONS as readonly string[]).includes(decision.value)) {
    return { ok: false, error: 'that is not an answer to a confirmation' };
  }
  const nonce = readString(outer.value, 'nonce', 128);
  if (!nonce.ok) return nonce;
  if (nonce.value.length < 8) return { ok: false, error: '"nonce" is too short to be one this server issued' };
  return { ok: true, value: { decision: decision.value as ActionDecision, nonce: nonce.value } };
}

// ── admin payloads ───────────────────────────────────────────────────────────────────────────────────

/** A list of allowed domains, each already reduced to `scheme://host[:port]`. Duplicates collapse; an
 *  entry that cannot be normalised is refused with its reason, because an administrator who typed a path
 *  needs to see why their domain did not take effect. */
export function validateOrigins(input: unknown): Validated<string[]> {
  if (!Array.isArray(input)) return { ok: false, error: '"origins" must be an array' };
  if (input.length > ORIGINS_MAX) return { ok: false, error: `at most ${ORIGINS_MAX} domains` };
  const seen = new Set<string>();
  for (const entry of input) {
    if (typeof entry !== 'string') return { ok: false, error: 'every domain must be a string' };
    let normalized: string;
    try {
      normalized = normalizeOrigin(entry);
    } catch (error) {
      return { ok: false, error: `${entry}: ${error instanceof Error ? error.message : 'invalid domain'}` };
    }
    if (isWildcardOrigin(normalized)) return { ok: false, error: 'a wildcard domain is not allowed' };
    seen.add(normalized);
  }
  return { ok: true, value: [...seen] };
}

/** One administrator rule over what a turn may do on a visitor's page. The shape is the STORE's write
 *  contract rather than a second declaration here: what this function returns is exactly what
 *  `ChatbotStore.replaceActionRules` writes, so the two cannot disagree about a field name. */
export type ActionRulePayload = ActionRuleInput;

/** How many rules one chatbot may carry. A rule is a statement about one origin, one path and one action,
 *  and a list beyond this is a policy nobody can read rather than a policy that is too small. */
const ACTION_RULES_MAX = 100;

/** The chatbot's page-action rules, normalised and checked as a WHOLE list.
 *
 *  Two rules may not describe the same place twice: the table's own UNIQUE constraint would refuse the
 *  second one at write time, and a request carrying a conflict has to be answered with the conflict rather
 *  than with whichever row happened to win. A confirmation is refused for any action that is not the
 *  submitting kind, because the widget's protocol can only carry a confirmation for that one — such a rule
 *  is a policy that can never be satisfied, and it must not be storable while looking like one. */
export function validateActionRules(input: unknown): Validated<ActionRulePayload[]> {
  if (!Array.isArray(input)) return { ok: false, error: '"actionRules" must be an array' };
  if (input.length > ACTION_RULES_MAX) return { ok: false, error: `at most ${ACTION_RULES_MAX} action rules` };
  const seen = new Set<string>();
  const rules: ActionRulePayload[] = [];
  for (const entry of input) {
    const outer = strictObject(entry, ['origin', 'pathPrefix', 'action', 'requiresConfirmation', 'maxPerTurn'],
      ['origin', 'pathPrefix', 'action', 'maxPerTurn']);
    if (!outer.ok) return { ok: false, error: `action rule: ${outer.error}` };
    const origin = readString(outer.value, 'origin', 255);
    if (!origin.ok) return origin;
    let normalized: string;
    try {
      normalized = normalizeOrigin(origin.value);
    } catch (error) {
      return { ok: false, error: `action rule origin "${origin.value}": ${error instanceof Error ? error.message : 'invalid domain'}` };
    }
    if (isWildcardOrigin(normalized)) return { ok: false, error: 'action rule: a wildcard domain is not allowed' };
    const path = readString(outer.value, 'pathPrefix', ACTION_PATH_PREFIX_MAX_CHARS);
    if (!path.ok) return path;
    const pathPrefix = normalizeActionPathPrefix(path.value);
    if (pathPrefix === null) return { ok: false, error: 'action rule: "pathPrefix" must be a path starting with "/"' };
    const action = readString(outer.value, 'action', 32);
    if (!action.ok) return action;
    if (!isActionKind(action.value)) return { ok: false, error: `action rule: "${action.value}" is not an action this version performs` };
    const requiresConfirmation = outer.value.requiresConfirmation ?? false;
    if (typeof requiresConfirmation !== 'boolean') return { ok: false, error: 'action rule: "requiresConfirmation" must be a boolean' };
    if (requiresConfirmation && !requiresVisitorConfirmation(action.value)) {
      return { ok: false, error: `action rule: "${action.value}" cannot require a confirmation; only ${CONFIRMATION_ACTION_KIND} is answered with one` };
    }
    const maxPerTurn = outer.value.maxPerTurn;
    if (typeof maxPerTurn !== 'number' || !Number.isSafeInteger(maxPerTurn) || maxPerTurn < 1) {
      return { ok: false, error: 'action rule: "maxPerTurn" must be a positive integer' };
    }
    // A rule can only lower the per-turn ceiling the plugin itself enforces, so a larger number would be a
    // setting that silently does nothing. Refusing it keeps the editor honest.
    if (maxPerTurn > WIDGET_MAX_ACTIONS_PER_TURN) {
      return { ok: false, error: `action rule: "maxPerTurn" may not exceed ${WIDGET_MAX_ACTIONS_PER_TURN}` };
    }
    const key = `${normalized}\n${pathPrefix}\n${action.value}`;
    if (seen.has(key)) return { ok: false, error: `action rule: ${normalized}${pathPrefix} ${action.value} is listed twice` };
    seen.add(key);
    rules.push({ origin: normalized, pathPrefix, action: action.value, requiresConfirmation, maxPerTurn });
  }
  return { ok: true, value: rules };
}

/** Rules travel with the bot in both directions, so the editor reads back exactly what it wrote rather
 *  than a shape of its own. Present in `BotCreatePayload`/`BotPatchPayload` and validated once here. */
export interface BotCreatePayload {
  chatbotUserId: number;
  displayName: string;
  prompt: string;
  origins: string[];
  actionRules: ActionRulePayload[];
}

export function validateBotCreate(body: unknown): Validated<BotCreatePayload> {
  const outer = strictObject(body, ['chatbotUserId', 'displayName', 'prompt', 'origins', 'actionRules'], ['chatbotUserId']);
  if (!outer.ok) return outer;
  const userId = outer.value.chatbotUserId;
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) return { ok: false, error: '"chatbotUserId" must be a positive integer' };
  const displayName = readOptionalString(outer.value, 'displayName', DISPLAY_NAME_MAX_CHARS);
  if (!displayName.ok) return displayName;
  const prompt = readOptionalString(outer.value, 'prompt', PROMPT_MAX_CHARS);
  if (!prompt.ok) return prompt;
  const origins = validateOrigins(outer.value.origins ?? []);
  if (!origins.ok) return origins;
  const actionRules = validateActionRules(outer.value.actionRules ?? []);
  if (!actionRules.ok) return actionRules;
  return {
    ok: true,
    value: {
      chatbotUserId: userId,
      displayName: displayName.value.trim(),
      prompt: prompt.value,
      origins: origins.value,
      actionRules: actionRules.value,
    },
  };
}

export interface BotPatchPayload {
  chatbotUserId: number;
  expectedUpdatedAt: string;
  displayName: string;
  prompt: string;
  origins: string[];
  actionRules: ActionRulePayload[];
  action: 'enable' | 'disable' | null;
}

/** The whole editable state is sent on every write. A partial patch would let two administrators each
 *  change one field and lose the other's, and the compare-and-set below could not tell them apart. */
export function validateBotPatch(body: unknown): Validated<BotPatchPayload> {
  const outer = strictObject(body, ['chatbotUserId', 'expectedUpdatedAt', 'displayName', 'prompt', 'origins', 'actionRules', 'action'],
    ['chatbotUserId', 'expectedUpdatedAt', 'displayName', 'prompt', 'origins', 'actionRules']);
  if (!outer.ok) return outer;
  const userId = outer.value.chatbotUserId;
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) return { ok: false, error: '"chatbotUserId" must be a positive integer' };
  const expected = readString(outer.value, 'expectedUpdatedAt', 64);
  if (!expected.ok) return expected;
  const displayName = readString(outer.value, 'displayName', DISPLAY_NAME_MAX_CHARS);
  if (!displayName.ok) return displayName;
  const prompt = readString(outer.value, 'prompt', PROMPT_MAX_CHARS);
  if (!prompt.ok) return prompt;
  const origins = validateOrigins(outer.value.origins);
  if (!origins.ok) return origins;
  const actionRules = validateActionRules(outer.value.actionRules);
  if (!actionRules.ok) return actionRules;
  const action = outer.value.action ?? null;
  if (action !== null && action !== 'enable' && action !== 'disable') return { ok: false, error: '"action" must be enable or disable' };
  return {
    ok: true,
    value: {
      chatbotUserId: userId,
      expectedUpdatedAt: expected.value,
      displayName: displayName.value.trim(),
      prompt: prompt.value,
      origins: origins.value,
      actionRules: actionRules.value,
      action,
    },
  };
}
