import { WIDGET_MAX_ACTIONS_PER_TURN } from './publicContract.js';
import type { BotLimitColumns, BotRow } from './db.js';

/** The numeric limits a chatbot must carry before it may answer anybody.
 *
 *  There is no default anywhere: not in the plugin, not in the database, not in the admin form. A limit the
 *  owner has not decided is NULL in the row, the bot stays a draft, and a request that somehow reaches an
 *  enabled bot with a missing number is refused rather than served under a number this plugin invented. That
 *  is the whole point of this module — the ONE place that says which numbers exist, which of them are
 *  mandatory, and what a stored value has to look like to be believed.
 *
 *  `min`/`max` are bounds, not policy: they keep a value out of the arithmetic that would break it (a window
 *  in the year 3000, a token budget beyond a safe integer). The real ceilings belong to the owner, and a
 *  release gate requires an owner-approved profile plus a load test against it. */

/** One limit: where it is stored, and the range a value has to fall in to be usable. The name in the admin
 *  payload and the key of the two value shapes below are the same string, so a limit cannot be described here
 *  and read under a different name somewhere else. */
export interface LimitSpec {
  column: keyof BotLimitColumns;
  min: number;
  max: number;
}

/** The numbers an enabled chatbot MUST have. A bot missing any of them cannot be enabled, and cannot serve
 *  even if it was enabled before the number went missing. */
export const MANDATORY_LIMITS = {
  // Bounds an address trying to talk to one chatbot. The window is a minute, so even 1000 is far past any
  // real visitor; the ceiling exists so a typo cannot produce a number the counter cannot hold.
  rateIpPerMinute: { column: 'rate_ip_per_minute', min: 1, max: 100_000 },
  // Bounds every visitor of one chatbot together, whatever address they come from.
  rateChatbotPerMinute: { column: 'rate_chatbot_per_minute', min: 1, max: 100_000 },
  // Bounds one visitor's own conversation. This is the number that stops a single widget from spending a
  // whole day's budget in a minute.
  rateConversationPerMinute: { column: 'rate_conversation_per_minute', min: 1, max: 10_000 },
  // Turns this chatbot admits per UTC day, counted by the plugin itself at admission.
  dailyTurnLimit: { column: 'daily_turn_limit', min: 1, max: 10_000_000 },
  // How many of this chatbot's turns may run at the same time.
  maxConcurrentTurns: { column: 'max_concurrent_turns', min: 1, max: 64 },
  // How many may wait for a slot. Depth plus concurrency bounds everything one chatbot can hold.
  maxQueueDepth: { column: 'max_queue_depth', min: 1, max: 10_000 },
  // How long a turn may wait for a slot before it is closed with no model call. An hour is the bound: a
  // visitor who has waited that long has left the page.
  queueTimeoutSeconds: { column: 'queue_timeout_seconds', min: 1, max: 3_600 },
  // The per-turn ceiling on page actions, bounded by what the served widget will perform: two numbers for one
  // budget would be one number too many, and the server must never approve an action the widget refuses.
  maxActionsPerTurn: { column: 'max_actions_per_turn', min: 1, max: WIDGET_MAX_ACTIONS_PER_TURN },
  // How long a visitor's conversation is kept before the cleaner deletes it, core transcript included.
  retentionDays: { column: 'retention_days', min: 1, max: 3_650 },
} satisfies Record<string, LimitSpec>;

/** The numbers that may be left unset. An absent cost ceiling means "the owner has set no spending ceiling",
 *  which is a decision rather than a missing value; a token ceiling behaves the same way. */
export const OPTIONAL_LIMITS = {
  dailyTokenLimit: { column: 'daily_token_limit', min: 1, max: Number.MAX_SAFE_INTEGER },
  dailyCostMicrousd: { column: 'daily_cost_microusd', min: 1, max: Number.MAX_SAFE_INTEGER },
} satisfies Record<string, LimitSpec>;

export type MandatoryLimitField = keyof typeof MANDATORY_LIMITS;
type OptionalLimitField = keyof typeof OPTIONAL_LIMITS;
export type LimitField = MandatoryLimitField | OptionalLimitField;

const LIMITS: Record<LimitField, LimitSpec> = { ...MANDATORY_LIMITS, ...OPTIONAL_LIMITS };

/** Every limit as a value that may be unset. This is what a row holds, what an admin payload carries and what
 *  a draft is: NULL is a real state, never a placeholder for a number somebody will fill in later. */
export type LimitValues = { [K in LimitField]: number | null };

/** The limits of a bot that may SERVE: every mandatory number is present, and the type says so. The only way
 *  to hold one is to have gone through `readBotLimits`, which is why the enforcement code cannot be handed a
 *  half-configured bot by mistake. */
export type BotLimits = { [K in MandatoryLimitField]: number } & { [K in OptionalLimitField]: number | null };

export const LIMIT_FIELDS = Object.keys(LIMITS) as LimitField[];
const MANDATORY_FIELDS = Object.keys(MANDATORY_LIMITS) as MandatoryLimitField[];

/** Whether a value is one this plugin will believe for a given limit. Exported so the admin payload is
 *  validated by the SAME rule the stored row is read by: a value the API accepts and the reader refuses would
 *  be an administrator setting a number that silently disables their chatbot. */
export function isUsableLimit(value: unknown, spec: LimitSpec): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= spec.min && value <= spec.max;
}

export function specOf(field: LimitField): LimitSpec {
  return LIMITS[field];
}

/** Every limit a row carries, with an unusable value reported as unset rather than as itself, so a hand-edited
 *  row cannot hand the enforcement code a number the admin API would have refused. */
export function storedLimits(row: BotLimitColumns): LimitValues {
  const read = (field: LimitField): number | null => {
    const value = row[LIMITS[field].column];
    return isUsableLimit(value, LIMITS[field]) ? value : null;
  };
  return {
    rateIpPerMinute: read('rateIpPerMinute'),
    rateChatbotPerMinute: read('rateChatbotPerMinute'),
    rateConversationPerMinute: read('rateConversationPerMinute'),
    dailyTurnLimit: read('dailyTurnLimit'),
    dailyTokenLimit: read('dailyTokenLimit'),
    dailyCostMicrousd: read('dailyCostMicrousd'),
    maxConcurrentTurns: read('maxConcurrentTurns'),
    maxQueueDepth: read('maxQueueDepth'),
    queueTimeoutSeconds: read('queueTimeoutSeconds'),
    maxActionsPerTurn: read('maxActionsPerTurn'),
    retentionDays: read('retentionDays'),
  };
}

/** Which mandatory numbers a set of values has not decided yet. The ONE completeness rule: a stored row, a
 *  payload and a folded write are all judged by it, so an administrator cannot be told one thing by the form
 *  and another by the server. */
export function incompleteValues(values: LimitValues): MandatoryLimitField[] {
  return MANDATORY_FIELDS.filter((field) => values[field] === null);
}

/** The same list for a stored row, as the admin surface reports it. An unusable stored value reads as unset
 *  (see `storedLimits`), so a hand-edited row is reported as missing rather than as usable. */
export function missingLimits(row: BotLimitColumns): MandatoryLimitField[] {
  return incompleteValues(storedLimits(row));
}

/** The bot's limits, or nothing.
 *
 *  `null` is the refusal: some mandatory number is absent or unusable, so there is no set of limits to serve
 *  under and a caller must refuse rather than pick one. Every consumer that decides whether a request is
 *  served, or what it may spend, goes through here — it is the only way to obtain the `BotLimits` type. */
export function readBotLimits(row: BotRow | BotLimitColumns | null): BotLimits | null {
  if (!row) return null;
  const values = storedLimits(row);
  // An optional value that is present but unusable is not "no ceiling": it is a number this plugin cannot
  // read, and no spending decision may be made from one. A row carrying one is refused whole.
  for (const field of Object.keys(OPTIONAL_LIMITS) as OptionalLimitField[]) {
    const stored = row[OPTIONAL_LIMITS[field].column];
    if (stored === null || stored === undefined) continue;
    if (!isUsableLimit(stored, OPTIONAL_LIMITS[field])) return null;
  }
  if (incompleteValues(values).length > 0) return null;
  return {
    rateIpPerMinute: values.rateIpPerMinute!,
    rateChatbotPerMinute: values.rateChatbotPerMinute!,
    rateConversationPerMinute: values.rateConversationPerMinute!,
    dailyTurnLimit: values.dailyTurnLimit!,
    dailyTokenLimit: values.dailyTokenLimit,
    dailyCostMicrousd: values.dailyCostMicrousd,
    maxConcurrentTurns: values.maxConcurrentTurns!,
    maxQueueDepth: values.maxQueueDepth!,
    queueTimeoutSeconds: values.queueTimeoutSeconds!,
    maxActionsPerTurn: values.maxActionsPerTurn!,
    retentionDays: values.retentionDays!,
  };
}
