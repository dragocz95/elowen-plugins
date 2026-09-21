import { isWildcardOrigin, normalizeOrigin } from './origin.js';

/** Every payload that crosses a trust boundary — the public hook and the admin API — is validated here,
 *  strictly: unknown keys are REFUSED rather than ignored, so a client that sends a field this version
 *  does not implement learns that instead of believing it took effect. */
export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/** The public request schema version. A request naming another version is refused, never reinterpreted. */
const SCHEMA_VERSION = 1;

/** A visitor message. The hook body is capped at 1 MiB by core; this is the bot-specific bound. */
const MESSAGE_MAX_BYTES = 8 * 1024;

const DISPLAY_NAME_MAX_CHARS = 80;
const PROMPT_MAX_CHARS = 8_000;
const ORIGINS_MAX = 20;

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
  record.schemaVersion === SCHEMA_VERSION
    ? { ok: true, value: true }
    : { ok: false, error: `schemaVersion must be ${SCHEMA_VERSION}` };

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

export interface BotCreatePayload {
  chatbotUserId: number;
  displayName: string;
  prompt: string;
  origins: string[];
}

export function validateBotCreate(body: unknown): Validated<BotCreatePayload> {
  const outer = strictObject(body, ['chatbotUserId', 'displayName', 'prompt', 'origins'], ['chatbotUserId']);
  if (!outer.ok) return outer;
  const userId = outer.value.chatbotUserId;
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) return { ok: false, error: '"chatbotUserId" must be a positive integer' };
  const displayName = readOptionalString(outer.value, 'displayName', DISPLAY_NAME_MAX_CHARS);
  if (!displayName.ok) return displayName;
  const prompt = readOptionalString(outer.value, 'prompt', PROMPT_MAX_CHARS);
  if (!prompt.ok) return prompt;
  const origins = validateOrigins(outer.value.origins ?? []);
  if (!origins.ok) return origins;
  return { ok: true, value: { chatbotUserId: userId, displayName: displayName.value.trim(), prompt: prompt.value, origins: origins.value } };
}

export interface BotPatchPayload {
  chatbotUserId: number;
  expectedUpdatedAt: string;
  displayName: string;
  prompt: string;
  origins: string[];
  action: 'enable' | 'disable' | null;
}

/** The whole editable state is sent on every write. A partial patch would let two administrators each
 *  change one field and lose the other's, and the compare-and-set below could not tell them apart. */
export function validateBotPatch(body: unknown): Validated<BotPatchPayload> {
  const outer = strictObject(body, ['chatbotUserId', 'expectedUpdatedAt', 'displayName', 'prompt', 'origins', 'action'],
    ['chatbotUserId', 'expectedUpdatedAt', 'displayName', 'prompt', 'origins']);
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
      action,
    },
  };
}
