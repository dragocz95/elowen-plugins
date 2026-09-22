import { WIDGET_MAX_ACTIONS_PER_TURN } from './publicContract.js';
import type { BotLimitColumns, BotRow } from './db.js';

/** The numeric limits a chatbot must carry before it may answer anybody.
 *
 *  Every registered chatbot starts from the defaults declared beside the specs below. A stored NULL remains
 *  a real missing value for legacy or explicit draft data: an enabled bot with a missing mandatory number is
 *  refused rather than served under an invented fallback. This module is the ONE place that says which
 *  numbers exist, their defaults, which are mandatory, and what a stored value has to look like to be believed.
 *
 *  `min`/`max` are validity bounds, not the defaults: they keep a value out of arithmetic it would break.
 *  The owner-approved starting policy is the `default` value beside each bound. */

/** One limit: where it is stored, and the range a value has to fall in to be usable. The name in the admin
 *  payload and the key of the two value shapes below are the same string, so a limit cannot be described here
 *  and read under a different name somewhere else. */
export interface LimitSpec {
  column: keyof BotLimitColumns;
  min: number;
  max: number;
  /** The value a newly registered chatbot starts with and the admin form shows for an unset legacy row. */
  default: number;
  /** What the admin form OFFERS, which is a different question from what the server will believe.
   *
   *  `min`/`max` above are the validity bounds: the widest values the enforcement code can work with, and
   *  what an API payload is judged against. This is the span of the SLIDER that sets the limit, so it stops
   *  where useful settings stop — a retention of ten years is inside the bounds and is not a policy anybody
   *  picks by dragging a bar, and offering it would squeeze every realistic value into a few pixels. A
   *  stored value outside this span is never rewritten: that row's slider widens to reach it. */
  slider: { min: number; max: number; step: number };
}

/** The numbers an enabled chatbot MUST have. A bot missing any of them cannot be enabled, and cannot serve
 *  even if it was enabled before the number went missing. */
export const MANDATORY_LIMITS = {
  // Bounds an address trying to talk to one chatbot. The window is a minute, so even 1000 is far past any
  // real visitor; the ceiling exists so a typo cannot produce a number the counter cannot hold.
  rateIpPerMinute: {
    column: 'rate_ip_per_minute', min: 1, max: 100_000, default: 75, slider: { min: 5, max: 300, step: 5 },
  },
  // Bounds every visitor of one chatbot together, whatever address they come from.
  rateChatbotPerMinute: {
    column: 'rate_chatbot_per_minute', min: 1, max: 100_000, default: 150, slider: { min: 10, max: 600, step: 10 },
  },
  // Bounds one visitor's own conversation. This is the number that stops a single widget from spending a
  // whole day's budget in a minute.
  rateConversationPerMinute: {
    column: 'rate_conversation_per_minute', min: 1, max: 10_000, default: 25, slider: { min: 1, max: 60, step: 1 },
  },
  // Turns this chatbot admits per UTC day, counted by the plugin itself at admission.
  dailyTurnLimit: {
    column: 'daily_turn_limit', min: 1, max: 10_000_000, default: 500, slider: { min: 10, max: 10_000, step: 10 },
  },
  // How many of this chatbot's turns may run at the same time.
  maxConcurrentTurns: {
    column: 'max_concurrent_turns', min: 1, max: 64, default: 5, slider: { min: 1, max: 32, step: 1 },
  },
  // How many may wait for a slot. Depth plus concurrency bounds everything one chatbot can hold.
  maxQueueDepth: {
    column: 'max_queue_depth', min: 1, max: 10_000, default: 10, slider: { min: 1, max: 100, step: 1 },
  },
  // How long a turn may wait for a slot before it is closed with no model call. An hour is the bound; the
  // slider stops at ten minutes, because a visitor who has waited that long has left the page.
  queueTimeoutSeconds: {
    column: 'queue_timeout_seconds', min: 1, max: 3_600, default: 150, slider: { min: 5, max: 600, step: 5 },
  },
  // The per-turn ceiling on page actions, bounded by what the served widget will perform: two numbers for one
  // budget would be one number too many, and the server must never approve an action the widget refuses.
  // Reading the page counts, and a read precedes every click, so a booking form costs well over a dozen.
  maxActionsPerTurn: {
    column: 'max_actions_per_turn', min: 1, max: WIDGET_MAX_ACTIONS_PER_TURN, default: 20,
    slider: { min: 1, max: WIDGET_MAX_ACTIONS_PER_TURN, step: 1 },
  },
  // How long a visitor's conversation is kept before the cleaner deletes it, core transcript included.
  retentionDays: {
    column: 'retention_days', min: 1, max: 3_650, default: 30, slider: { min: 1, max: 365, step: 1 },
  },
} satisfies Record<string, LimitSpec>;

/** The numbers a row may carry as NULL. A legacy row written before this plugin had defaults means "the owner
 *  set no ceiling"; the admin form no longer writes that state, because a public chatbot with no spending
 *  ceiling is not a decision anybody makes deliberately. The cost ceiling is stored in microdollars and read
 *  in dollars, which is why its slider steps by a million. */
export const OPTIONAL_LIMITS = {
  dailyCostMicrousd: {
    column: 'daily_cost_microusd', min: 1, max: Number.MAX_SAFE_INTEGER, default: 10_000_000,
    slider: { min: 1_000_000, max: 100_000_000, step: 1_000_000 },
  },
} satisfies Record<string, LimitSpec>;

export type MandatoryLimitField = keyof typeof MANDATORY_LIMITS;
type OptionalLimitField = keyof typeof OPTIONAL_LIMITS;
export type LimitField = MandatoryLimitField | OptionalLimitField;

const LIMITS: Record<LimitField, LimitSpec> = { ...MANDATORY_LIMITS, ...OPTIONAL_LIMITS };

/** The complete profile used for every newly registered chatbot. Values live beside their bounds above. */
export const DEFAULT_LIMITS = Object.fromEntries(
  Object.entries(LIMITS).map(([field, spec]) => [field, spec.default]),
) as { [K in LimitField]: number };

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
    dailyCostMicrousd: values.dailyCostMicrousd,
    maxConcurrentTurns: values.maxConcurrentTurns!,
    maxQueueDepth: values.maxQueueDepth!,
    queueTimeoutSeconds: values.queueTimeoutSeconds!,
    maxActionsPerTurn: values.maxActionsPerTurn!,
    retentionDays: values.retentionDays!,
  };
}
