import { randomUUID } from 'node:crypto';
import type { PluginDb, PluginDbStatement } from 'elowen/plugin-api';
import type {
  ActionRow,
  BotRow,
  BudgetDayRow,
  ConversationRow,
  RateWindowRow,
  TokenRow,
  TurnEventRow,
  TurnRow,
  VisitorRow,
} from './db.js';
import { CHATBOT_PLATFORM } from './adapter.js';
import { DEFAULT_LIMITS, readBotLimits, type BotLimits, type LimitValues } from './limits.js';
import { NO_USAGE, decideBudget, secondsUntilNextUtcDay, utcDay, type OriginUsage, type DailyBudget } from './budget.js';
import {
  chatbotScopeKey,
  conversationScopeKey,
  ipScopeKey,
  retryAfterSeconds,
  windowAt,
  type RateScope,
} from './rateLimit.js';
import { isActionKind } from './actions.js';
import { ACTION_OUTCOMES, type ActionKind, type ActionOutcome } from './publicContract.js';

/** The origin core attributes one chatbot's spend to, as `usage_by_origin.orgin` stores it: the platform name
 *  this plugin relays under. Read from the name rather than spelled out again, because a second spelling is a
 *  budget that silently counts nothing. */
const USAGE_ORIGIN = `platform:${CHATBOT_PLATFORM}`;

/** A conversation may only be taken apart while nothing is being written into it. Shared by retention and by
 *  an operator's own erase, because "deletable" is one rule and not two. */
const NO_LIVE_TURN = `NOT EXISTS (
  SELECT 1 FROM p_chatbot_turns t
   WHERE t.chatbot_user_id = c.chatbot_user_id AND t.visitor_id = c.visitor_id
     AND t.status IN ('queued', 'running'))`;

/** What admitting one visitor message did. Every refusal here is a fact the public route turns into a stable
 *  code; none of them is ever a model call. */
export type AdmissionOutcome =
  | { ok: true; turn: TurnRow }
  /** The attempt was over a window's ceiling, or the day's budget is spent. Both tell the caller when to
   *  come back. */
  | { ok: false; reason: 'rate_limited' | 'budget_exhausted'; retryAfterSeconds: number }
  /** The day's spend could not be read, the visitor's conversation already has a live turn, the chatbot's
   *  queue is full, or its limits are not configured: refusals with no retry advice, because the honest
   *  answer is "not now" rather than a number. */
  | { ok: false; reason: 'budget_unverifiable' | 'turn_in_progress' | 'chatbot_busy' | 'limits_missing' }
  /** This exact message is already a turn: the caller gets the SAME turn, never a second model call. */
  | { ok: false; reason: 'duplicate'; turn: TurnRow };


/** One visitor's conversation as the admin register lists it. Metadata only: what was said is read one
 *  conversation at a time. */
export interface ConversationSummaryRow {
  visitorId: string;
  turns: number;
  errors: number;
  firstAt: string;
  lastAt: string;
  lastStatus: string;
}

/** One UTC day of a chatbot's own turn counters. */
export interface DailyTurnRow {
  day: string;
  turns: number;
  done: number;
  errors: number;
}

/** Every plugin-owned read and write in one place, so the public path and the admin surface cannot
 *  disagree about what a row means. */
export class ChatbotStore {
  private statements = new Map<string, PluginDbStatement>();

  constructor(private db: PluginDb) {}

  /** Prepared once per statement text. The host's handle is a thin wrapper over better-sqlite3, so
   *  re-preparing on every public request would repeat the parse for no benefit. */
  private stmt(sql: string): PluginDbStatement {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  // ── chatbots ───────────────────────────────────────────────────────────────────────────────────────

  botByUserId(chatbotUserId: number): BotRow | null {
    return (this.stmt('SELECT * FROM p_chatbot_bots WHERE chatbot_user_id = ?').get(chatbotUserId) as BotRow | undefined) ?? null;
  }

  botByPublicId(publicId: string): BotRow | null {
    return (this.stmt('SELECT * FROM p_chatbot_bots WHERE public_id = ?').get(publicId) as BotRow | undefined) ?? null;
  }

  listBots(): BotRow[] {
    return this.stmt('SELECT * FROM p_chatbot_bots ORDER BY display_name COLLATE NOCASE, chatbot_user_id').all() as BotRow[];
  }

  /** Register a bot with the complete default limit profile. A caller may override a value explicitly. */
  createBot(input: {
    chatbotUserId: number;
    publicId: string;
    displayName: string;
    origins: readonly string[];
    limits?: Partial<LimitValues>;
    maySubmitForms?: boolean;
    now: string;
  }): BotRow {
    return this.db.transaction(() => {
      const limits = { ...DEFAULT_LIMITS, ...input.limits };
      this.stmt(`INSERT INTO p_chatbot_bots
                   (chatbot_user_id, public_id, customer_user_id, display_name, status, may_submit_forms,
                    rate_ip_per_minute, rate_chatbot_per_minute, rate_conversation_per_minute,
                    daily_turn_limit, daily_cost_microusd,
                    max_concurrent_turns, max_queue_depth, queue_timeout_seconds,
                    max_actions_per_turn, retention_days, created_at, updated_at)
                 VALUES (?, ?, NULL, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          input.chatbotUserId,
          input.publicId,
          input.displayName,
          input.maySubmitForms === false ? 0 : 1,
          limits.rateIpPerMinute,
          limits.rateChatbotPerMinute,
          limits.rateConversationPerMinute,
          limits.dailyTurnLimit,
          limits.dailyCostMicrousd,
          limits.maxConcurrentTurns,
          limits.maxQueueDepth,
          limits.queueTimeoutSeconds,
          limits.maxActionsPerTurn,
          limits.retentionDays,
          input.now,
          input.now,
        );
      this.replaceOrigins(input.chatbotUserId, input.origins);
      return this.botByUserId(input.chatbotUserId)!;
    });
  }

  /** Compare-and-set on `updated_at`, the plugin's only concurrency token for a bot: two administrators
   *  editing the same row cannot silently overwrite each other, and a stale write reports a conflict.
   *
   *  `limits` is the WHOLE set: the admin surface folds a payload over the stored row before calling this, so
   *  a write here cannot half-apply a spending policy.
   *
   *  `sensitive_mode` is cleared by every accepted write. A write that ASKS for the mode is refused before it
   *  reaches this method, so reaching it at all means the administrator did not ask for one — and a row left
   *  holding a request nothing granted is a row that would keep the chatbot from being enabled for a reason
   *  its own screen no longer shows. */
  updateBot(input: {
    chatbotUserId: number;
    expectedUpdatedAt: string;
    displayName: string;
    origins: readonly string[];
    limits: LimitValues;
    maySubmitForms: boolean;
    now: string;
  }): BotRow | null {
    return this.db.transaction(() => {
      const limits = input.limits;
      const result = this.stmt(`UPDATE p_chatbot_bots SET
                                  display_name = ?, updated_at = ?, sensitive_mode = 0, may_submit_forms = ?,
                                  rate_ip_per_minute = ?, rate_chatbot_per_minute = ?, rate_conversation_per_minute = ?,
                                  daily_turn_limit = ?, daily_cost_microusd = ?,
                                  max_concurrent_turns = ?, max_queue_depth = ?, queue_timeout_seconds = ?,
                                  max_actions_per_turn = ?, retention_days = ?
                                WHERE chatbot_user_id = ? AND updated_at = ?`)
        .run(
          input.displayName,
          input.now,
          input.maySubmitForms ? 1 : 0,
          limits.rateIpPerMinute,
          limits.rateChatbotPerMinute,
          limits.rateConversationPerMinute,
          limits.dailyTurnLimit,
          limits.dailyCostMicrousd,
          limits.maxConcurrentTurns,
          limits.maxQueueDepth,
          limits.queueTimeoutSeconds,
          limits.maxActionsPerTurn,
          limits.retentionDays,
          input.chatbotUserId,
          input.expectedUpdatedAt,
        );
      if (result.changes === 0) return null;
      this.replaceOrigins(input.chatbotUserId, input.origins);
      return this.botByUserId(input.chatbotUserId);
    });
  }

  setBotStatus(input: { chatbotUserId: number; status: BotRow['status']; now: string }): BotRow | null {
    this.stmt('UPDATE p_chatbot_bots SET status = ?, updated_at = ? WHERE chatbot_user_id = ?')
      .run(input.status, input.now, input.chatbotUserId);
    return this.botByUserId(input.chatbotUserId);
  }

  /** Write the look — and the display name, which the panel draws — under the same compare-and-set as every
   *  other edit of a bot: a stale write reports a conflict instead of replacing another administrator's.
   *
   *  It is deliberately its own statement rather than a wider `updateBot`: the appearance editor owns these
   *  two fields and nothing else, so saving a colour cannot touch unrelated bot configuration. */
  updateAppearance(input: {
    chatbotUserId: number;
    expectedUpdatedAt: string;
    displayName: string;
    appearance: string;
    now: string;
  }): BotRow | null {
    const result = this.stmt('UPDATE p_chatbot_bots SET display_name = ?, appearance = ?, updated_at = ? WHERE chatbot_user_id = ? AND updated_at = ?')
      .run(input.displayName, input.appearance, input.now, input.chatbotUserId, input.expectedUpdatedAt);
    if (result.changes === 0) return null;
    return this.botByUserId(input.chatbotUserId);
  }

  deleteBot(chatbotUserId: number): void {
    this.db.transaction(() => {
      this.stmt('DELETE FROM p_chatbot_actions WHERE turn_id IN (SELECT turn_id FROM p_chatbot_turns WHERE chatbot_user_id = ?)').run(chatbotUserId);
      this.stmt('DELETE FROM p_chatbot_turn_events WHERE turn_id IN (SELECT turn_id FROM p_chatbot_turns WHERE chatbot_user_id = ?)').run(chatbotUserId);
      this.stmt('DELETE FROM p_chatbot_turns WHERE chatbot_user_id = ?').run(chatbotUserId);
      this.stmt('DELETE FROM p_chatbot_conversations WHERE chatbot_user_id = ?').run(chatbotUserId);
      this.stmt('DELETE FROM p_chatbot_budget_days WHERE chatbot_user_id = ?').run(chatbotUserId);
      this.stmt('DELETE FROM p_chatbot_tokens WHERE chatbot_user_id = ?').run(chatbotUserId);
      this.stmt('DELETE FROM p_chatbot_visitors WHERE chatbot_user_id = ?').run(chatbotUserId);
      this.stmt('DELETE FROM p_chatbot_origins WHERE chatbot_user_id = ?').run(chatbotUserId);
      this.stmt('DELETE FROM p_chatbot_bots WHERE chatbot_user_id = ?').run(chatbotUserId);
    });
  }

  // ── allowed domains ────────────────────────────────────────────────────────────────────────────────

  originsOf(chatbotUserId: number): string[] {
    const rows = this.stmt('SELECT origin FROM p_chatbot_origins WHERE chatbot_user_id = ? ORDER BY origin')
      .all(chatbotUserId) as { origin: string }[];
    return rows.map((row) => row.origin);
  }

  private replaceOrigins(chatbotUserId: number, origins: readonly string[]): void {
    this.stmt('DELETE FROM p_chatbot_origins WHERE chatbot_user_id = ?').run(chatbotUserId);
    const insert = this.stmt('INSERT OR IGNORE INTO p_chatbot_origins (chatbot_user_id, origin) VALUES (?, ?)');
    for (const origin of origins) insert.run(chatbotUserId, origin);
  }

  // ── visitors and their tokens ──────────────────────────────────────────────────────────────────────

  visitor(visitorId: string): VisitorRow | null {
    return (this.stmt('SELECT * FROM p_chatbot_visitors WHERE visitor_id = ?').get(visitorId) as VisitorRow | undefined) ?? null;
  }

  touchVisitor(visitorId: string, now: string): void {
    this.stmt('UPDATE p_chatbot_visitors SET last_seen_at = ? WHERE visitor_id = ?').run(now, visitorId);
  }

  createVisitor(visitorId: string, chatbotUserId: number, now: string): VisitorRow {
    this.stmt('INSERT INTO p_chatbot_visitors (visitor_id, chatbot_user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
      .run(visitorId, chatbotUserId, now, now);
    return this.visitor(visitorId)!;
  }

  /** Issue one token: the row is written in the same transaction that revokes the visitor's previous
   *  tokens, so a rotated token never coexists with a usable predecessor. */
  issueToken(input: { jti: string; chatbotUserId: number; visitorId: string; tokenHash: string; issuedAt: string; expiresAt: string; rotate: boolean }): void {
    this.db.transaction(() => {
      if (input.rotate) {
        this.stmt('UPDATE p_chatbot_tokens SET revoked_at = ? WHERE visitor_id = ? AND revoked_at IS NULL')
          .run(input.issuedAt, input.visitorId);
      }
      this.stmt(`INSERT INTO p_chatbot_tokens (jti, chatbot_user_id, visitor_id, token_hash, issued_at, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?)`)
        .run(input.jti, input.chatbotUserId, input.visitorId, input.tokenHash, input.issuedAt, input.expiresAt);
    });
  }

  token(jti: string): TokenRow | null {
    return (this.stmt('SELECT * FROM p_chatbot_tokens WHERE jti = ?').get(jti) as TokenRow | undefined) ?? null;
  }

  // ── turns and their public event log ───────────────────────────────────────────────────────────────

  turnByClientId(chatbotUserId: number, visitorId: string, clientTurnId: string): TurnRow | null {
    return (this.stmt('SELECT * FROM p_chatbot_turns WHERE chatbot_user_id = ? AND visitor_id = ? AND client_turn_id = ?')
      .get(chatbotUserId, visitorId, clientTurnId) as TurnRow | undefined) ?? null;
  }

  turn(turnId: string): TurnRow | null {
    return (this.stmt('SELECT * FROM p_chatbot_turns WHERE turn_id = ?').get(turnId) as TurnRow | undefined) ?? null;
  }

  /** Record a submitted turn. UNIQUE (bot, visitor, client turn id) is what makes a retried POST after a
   *  lost 202 return the SAME turn instead of starting a second model turn. Called by `admitTurn` inside its
   *  own transaction: a turn row that exists without the counters that admitted it would be a turn nobody
   *  accounted for. */
  createTurn(input: {
    turnId: string;
    chatbotUserId: number;
    visitorId: string;
    clientTurnId: string;
    message: string;
    now: string;
  }): TurnRow {
    this.stmt(`INSERT INTO p_chatbot_turns (turn_id, chatbot_user_id, visitor_id, client_turn_id, status, message, created_at)
               VALUES (?, ?, ?, ?, 'queued', ?, ?)`)
      .run(input.turnId, input.chatbotUserId, input.visitorId, input.clientTurnId, input.message, input.now);
    return this.turn(input.turnId)!;
  }

  queuedTurns(limit: number): TurnRow[] {
    return this.stmt(`SELECT * FROM p_chatbot_turns WHERE status = 'queued' ORDER BY created_at, turn_id LIMIT ?`)
      .all(limit) as TurnRow[];
  }

  /** The oldest turn of one chatbot that is waiting for a slot: FIFO, and the tie is broken by the turn id so
   *  two turns submitted in the same millisecond still have one order. This is the queue's own read, and it
   *  is what makes the queue a reader of durable state rather than of a list held in a process. */
  nextQueuedTurn(chatbotUserId: number): TurnRow | null {
    return (this.stmt(`SELECT * FROM p_chatbot_turns WHERE chatbot_user_id = ? AND status = 'queued'
                       ORDER BY created_at, turn_id LIMIT 1`)
      .get(chatbotUserId) as TurnRow | undefined) ?? null;
  }

  /** How many of this chatbot's turns are RUNNING right now. Counted from the rows rather than from a number
   *  a process keeps: a restart loses the process and nothing else, and a counter that only ever moves one way
   *  is how a bot ends up unable to run anything.
   *
   *  A claimed turn is marked running BEFORE it is launched, so this read is what the concurrency limit is
   *  checked against, and two simultaneous pumps cannot both see a free slot. */
  runningCount(chatbotUserId: number): number {
    const row = this.stmt("SELECT COUNT(*) AS count FROM p_chatbot_turns WHERE chatbot_user_id = ? AND status = 'running'")
      .get(chatbotUserId) as { count: number };
    return row.count;
  }

  /** How many of this chatbot's turns are waiting for a slot. Depth is measured in WAITING turns: the ones
   *  already running are bounded by the concurrency limit instead. */
  queuedCount(chatbotUserId: number): number {
    const row = this.stmt("SELECT COUNT(*) AS count FROM p_chatbot_turns WHERE chatbot_user_id = ? AND status = 'queued'")
      .get(chatbotUserId) as { count: number };
    return row.count;
  }

  /** The turn this visitor already has open with this chatbot — queued or running. One conversation runs one
   *  turn at a time, so a second message either attaches to that turn (same client turn id) or is refused. */
  activeTurnOf(chatbotUserId: number, visitorId: string): TurnRow | null {
    return (this.stmt(`SELECT * FROM p_chatbot_turns WHERE chatbot_user_id = ? AND visitor_id = ?
                       AND status IN ('queued', 'running') ORDER BY created_at, turn_id LIMIT 1`)
      .get(chatbotUserId, visitorId) as TurnRow | undefined) ?? null;
  }

  /** Claim a queued turn for THIS process. Compare-and-set, so a second process (or a second pump) that
   *  picked the same row loses rather than running one submitted message twice. */
  markTurnRunning(turnId: string, now: string): boolean {
    const changed = this.stmt("UPDATE p_chatbot_turns SET status = 'running', started_at = ? WHERE turn_id = ? AND status = 'queued'")
      .run(now, turnId);
    return changed.changes > 0;
  }

  /** Close one turn, in one transaction: its own row, the day's in-flight count and the conversation's
   *  retention stamp.
   *
   *  The three belong together. A turn that closed without releasing in-flight would hold a slot nobody can
   *  free; a turn that closed without re-stamping its conversation would let a conversation be deleted while
   *  the visitor is still talking (the stamp is what the cleaner reads as "due"); and a turn whose core
   *  session id is known without being recorded would leave the cleaner with nothing to delete in core.
   *
   *  A bot whose retention is unreadable is not stamped: the date the admission wrote stands, which is the
   *  earlier and therefore the safer one. */
  finishTurn(input: {
    turnId: string;
    status: 'done' | 'error';
    coreSessionId: string | null;
    errorCode: string | null;
    now: string;
  }): void {
    this.db.transaction(() => {
      const turn = this.turn(input.turnId);
      if (!turn) return;
      this.stmt('UPDATE p_chatbot_turns SET status = ?, core_session_id = COALESCE(?, core_session_id), error_code = ?, finished_at = ? WHERE turn_id = ?')
        .run(input.status, input.coreSessionId, input.errorCode, input.now, input.turnId);
      const limits = readBotLimits(this.botByUserId(turn.chatbot_user_id));
      if (limits) {
        this.touchConversation({
          chatbotUserId: turn.chatbot_user_id,
          visitorId: turn.visitor_id,
          sessionId: input.coreSessionId,
          retentionDays: limits.retentionDays,
          now: input.now,
        });
      }
      this.releaseInFlight(turn, input.now);
    });
  }

  /** One admitted turn leaves the day's in-flight count. The day is the one the turn was ADMITTED on, which
   *  is where `admitTurn` counted it — a turn that runs past midnight must not decrement tomorrow's number
   *  into the negative. A missing row is not repaired here: the counters are advisory and the boot reconcile
   *  clears them. */
  private releaseInFlight(turn: TurnRow, now: string): void {
    this.stmt(`UPDATE p_chatbot_budget_days SET in_flight = in_flight - 1, updated_at = ?
               WHERE chatbot_user_id = ? AND day = ? AND in_flight > 0`)
      .run(now, turn.chatbot_user_id, utcDay(Date.parse(turn.created_at)));
  }


  /** Append one redacted event and return its sequence number. The row is committed before a caller may
   *  announce it, so a reconnect reads the same history a live subscriber saw. */
  appendEvent(turnId: string, type: string, data: Record<string, unknown>, now: string): number {
    return this.db.transaction(() => {
      const row = this.stmt('SELECT COALESCE(MAX(seq), 0) AS seq FROM p_chatbot_turn_events WHERE turn_id = ?').get(turnId) as { seq: number };
      const seq = row.seq + 1;
      this.stmt('INSERT INTO p_chatbot_turn_events (turn_id, seq, type, data, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(turnId, seq, type, JSON.stringify(data), now);
      return seq;
    });
  }

  events(turnId: string, after = 0): TurnEventRow[] {
    return this.stmt('SELECT * FROM p_chatbot_turn_events WHERE turn_id = ? AND seq > ? ORDER BY seq')
      .all(turnId, after) as TurnEventRow[];
  }

  /** The visitor's own conversation, newest first. A widget that lost its connection rebuilds what it
   *  showed from these rows and the answers below, never by reading a transcript this plugin does not own.
   *  The bound is the caller's: a reconnect is a bounded read, not a history export. */
  recentTurns(input: { chatbotUserId: number; visitorId: string; limit: number }): TurnRow[] {
    return this.stmt(`SELECT * FROM p_chatbot_turns WHERE chatbot_user_id = ? AND visitor_id = ?
                      ORDER BY created_at DESC, turn_id DESC LIMIT ?`)
      .all(input.chatbotUserId, input.visitorId, input.limit) as TurnRow[];
  }

  /** How far each turn's public log has got. A reconnecting reader learns where the log stands and reads
   *  the rows itself; nothing here is a second copy of an event. */
  lastSeqsOf(turnIds: readonly string[]): Map<string, number> {
    const seqs = new Map<string, number>(turnIds.map((turnId) => [turnId, 0]));
    if (turnIds.length === 0) return seqs;
    const rows = this.stmt(`SELECT turn_id, MAX(seq) AS seq FROM p_chatbot_turn_events
                            WHERE turn_id IN (${placeholders(turnIds.length)}) GROUP BY turn_id`)
      .all(...turnIds) as { turn_id: string; seq: number }[];
    for (const row of rows) seqs.set(row.turn_id, row.seq);
    return seqs;
  }

  /** The final answer of each finished turn, keyed by turn id, read from the event log rather than kept a
   *  second time on the turn row: the answer a reconnect renders is exactly the answer the live stream sent. */
  doneRepliesOf(turnIds: readonly string[]): Map<string, string> {
    const replies = new Map<string, string>();
    if (turnIds.length === 0) return replies;
    const rows = this.stmt(`SELECT * FROM p_chatbot_turn_events WHERE turn_id IN (${placeholders(turnIds.length)})
                            AND type = 'done' ORDER BY seq`)
      .all(...turnIds) as TurnEventRow[];
    for (const row of rows) {
      const text = eventPayload(row).text;
      if (typeof text !== 'string') throw new Error(`chatbot: stored done event ${row.turn_id}#${row.seq} carries no text`);
      replies.set(row.turn_id, text);
    }
    return replies;
  }

  /** Boot reconcile: a turn this process no longer runs cannot be resumed, and reporting it as still
   *  running would leave a visitor waiting forever. Each row is closed with the SAME public error event the
   *  running queue would have written, so the durable log a reconnecting widget reads is complete rather
   *  than silent. Core turn recovery is explicitly not guaranteed, and no turn is replayed.
   *
   *  A turn the process no longer runs cannot have a live page action either: the tool that waits for one
   *  died with the turn, so an action still waiting is closed in the same transaction rather than left as a
   *  row something might still answer. A CONFIRMED action is deliberately left alone: the visitor's own
   *  decision happened, and their page may still report what it did with it. */
  closeOrphanedTurns(now: string, errorCode: string): string[] {
    return this.db.transaction(() => {
      const rows = this.stmt("SELECT turn_id FROM p_chatbot_turns WHERE status IN ('queued', 'running') ORDER BY created_at").all() as { turn_id: string }[];
      for (const row of rows) {
        this.appendEvent(row.turn_id, 'error', { code: errorCode }, now);
        this.stmt("UPDATE p_chatbot_actions SET status = 'expired', completed_at = ? WHERE turn_id = ? AND status IN ('pending', 'confirmation_required')")
          .run(now, row.turn_id);
        this.stmt("UPDATE p_chatbot_turns SET status = 'error', error_code = ?, finished_at = ? WHERE turn_id = ? AND status IN ('queued', 'running')")
          .run(errorCode, now, row.turn_id);
      }
      return rows.map((row) => row.turn_id);
    });
  }

  // ── admission: rate windows, budget, capacity ───────────────────────────────────────────────────────

  /** Admit one visitor message, or say why not. This is the ONE place a turn starts existing.
   *
   *  Two transactions, in this order and for this reason:
   *
   *  1. the rate windows, which count ATTEMPTS and therefore must commit even when they refuse — a refused
   *     request is exactly what a rate limit is for;
   *  2. everything that only counts ADMISSIONS: the budget read and the counters, the per-conversation
   *     check, the queue depth and the turn row itself. A refusal here writes nothing at all, so there is no
   *     half-admitted turn to clean up and no counter to give back.
   *
   *  Both run inside the host's write lock, so two simultaneous submissions cannot both see a free slot: the
   *  read and the write that decides it are one atomic step, which is the property the DB counter has to have
   *  for a ceiling to mean anything. */
  admitTurn(input: {
    turnId: string;
    bot: BotRow;
    visitorId: string;
    clientTurnId: string;
    message: string;
    /** The address the HOST resolved for this request; the IP window's second half. */
    originValue: string;
    now: string;
    nowMs: number;
  }): AdmissionOutcome {
    const limits = readBotLimits(input.bot);
    // Belt and braces: the public route refuses an incompletely configured bot before it gets here. If a row
    // lost a number in between, there is no set of limits to serve under and nothing may be guessed.
    if (!limits) return { ok: false, reason: 'limits_missing' };
    const chatbotUserId = input.bot.chatbot_user_id;

    const limited = this.db.transaction(() => {
      const scopes: { scope: RateScope; key: string; limit: number }[] = [
        { scope: 'ip', key: ipScopeKey(chatbotUserId, input.originValue), limit: limits.rateIpPerMinute },
        { scope: 'chatbot', key: chatbotScopeKey(chatbotUserId), limit: limits.rateChatbotPerMinute },
        { scope: 'conversation', key: conversationScopeKey(chatbotUserId, input.visitorId), limit: limits.rateConversationPerMinute },
      ];
      const exceeded: string[] = [];
      for (const scope of scopes) {
        const row = this.countRateWindow(scope.scope, scope.key, input.nowMs);
        if (row.count > scope.limit) exceeded.push(row.expires_at);
      }
      // Every exceeded window has to clear, so the wait is the longest of them rather than the first found.
      return exceeded.length === 0
        ? null
        : { ok: false as const, reason: 'rate_limited' as const, retryAfterSeconds: Math.max(...exceeded.map((iso) => retryAfterSeconds(iso, input.nowMs))) };
    });
    if (limited) return limited;

    try {
      return this.db.transaction(() => this.admitWithinBudget({ ...input, chatbotUserId, limits }));
    } catch (error) {
      // The one failure this transaction can hit that is not a bug: two submissions of the SAME client turn id
      // arrived together and the UNIQUE constraint refused the second insert. That is the same answer the fast
      // path gives, so it is reported as one — and the rollback is what keeps the duplicate from costing a
      // turn of the budget or a rate window's worth of nothing.
      const existing = this.turnByClientId(chatbotUserId, input.visitorId, input.clientTurnId);
      if (!existing) throw error;
      return { ok: false, reason: 'duplicate', turn: existing };
    }
  }

  /** Everything inside the admission transaction that happens once the attempt is allowed at all. */
  private admitWithinBudget(input: {
    turnId: string;
    bot: BotRow;
    chatbotUserId: number;
    visitorId: string;
    clientTurnId: string;
    message: string;
    now: string;
    nowMs: number;
    limits: BotLimits;
  }): AdmissionOutcome {
    // Re-read under the write lock: the caller's earlier read was a fast path, and the row that decides
    // idempotence has to be the row the insert is about to be judged against.
    const existing = this.turnByClientId(input.chatbotUserId, input.visitorId, input.clientTurnId);
    if (existing) return { ok: false, reason: 'duplicate', turn: existing };

    const day = utcDay(input.nowMs);
    const { verdict } = this.dailyBudget(input.chatbotUserId, input.limits, day);
    if (!verdict.ok) {
      return verdict.reason === 'budget_exhausted'
        ? { ok: false, reason: 'budget_exhausted', retryAfterSeconds: secondsUntilNextUtcDay(input.nowMs) }
        : { ok: false, reason: verdict.reason };
    }
    // One conversation, one turn: a second message while the first is still queued or running is refused
    // rather than queued behind it, because its answer would arrive after the visitor had been told something
    // else, and because a conversation with two live turns has no order a widget could render.
    if (this.activeTurnOf(input.chatbotUserId, input.visitorId)) return { ok: false, reason: 'turn_in_progress' };
    if (this.queuedCount(input.chatbotUserId) >= input.limits.maxQueueDepth) return { ok: false, reason: 'chatbot_busy' };

    this.bumpBudgetDay(input.chatbotUserId, day, input.now);
    // The conversation gets its due date at ADMISSION, not only at settle: a turn that never settles is
    // exactly the case where a conversation would otherwise never expire.
    this.touchConversation({
      chatbotUserId: input.chatbotUserId,
      visitorId: input.visitorId,
      sessionId: null,
      retentionDays: input.limits.retentionDays,
      now: input.now,
    });
    return { ok: true, turn: this.createTurn(input) };
  }

  /** Increment one (scope, key, minute) window and return it. The upsert is the atomic step: `count` is the
   *  number of attempts in THIS window, whoever made them. */
  private countRateWindow(scope: RateScope, key: string, nowMs: number): RateWindowRow {
    const window = windowAt(scope, key, nowMs);
    this.stmt(`INSERT INTO p_chatbot_rate_windows (scope, scope_key, window_started_at, count, expires_at)
               VALUES (?, ?, ?, 1, ?)
               ON CONFLICT (scope, scope_key, window_started_at) DO UPDATE SET count = count + 1`)
      .run(window.scope, window.key, window.startedAt, window.expiresAt);
    return this.stmt('SELECT * FROM p_chatbot_rate_windows WHERE scope = ? AND scope_key = ? AND window_started_at = ?')
      .get(window.scope, window.key, window.startedAt) as RateWindowRow;
  }

  /** The admin display and admission share the same counters and refusal rule. */
  dailyBudget(chatbotUserId: number, limits: BotLimits | null, day: string): DailyBudget {
    const usage = this.usageFor(chatbotUserId, day);
    const admittedTurns = this.budgetDay(chatbotUserId, day).admitted_turns;
    return { day, admittedTurns, usage, verdict: decideBudget({ limits, admittedTurns, usage }) };
  }

  /** Today's spend for one chatbot, from CORE's own rollup: the only place origin-attributed spend exists in
   *  this codebase. Nothing here reads `brain_messages`, and no second ledger is kept.
   *
   *  `null` means the row exists but is not a usage row this plugin can read — a broken deployment, reported
   *  as such to the caller rather than flattened into zeros. A missing row is different: it is the ordinary
   *  state of a chatbot that has not spent anything yet. */
  usageFor(chatbotUserId: number, day: string): OriginUsage | null {
    const row = this.stmt(`SELECT turns, total, cost, costed_turns FROM usage_by_origin
                           WHERE day = ? AND user_id = ? AND origin = ?`)
      .get(day, chatbotUserId, USAGE_ORIGIN) as { turns: unknown; total: unknown; cost: unknown; costed_turns: unknown } | undefined;
    if (!row) return NO_USAGE;
    const turns = countOf(row.turns);
    const tokens = countOf(row.total);
    const costedTurns = countOf(row.costed_turns);
    if (turns === null || costedTurns === null) return null;
    // Core leaves `cost` NULL for a bucket whose turns reported no price at all, and keeps it NULL on purpose.
    // Anything that is neither a finite number nor NULL is a value this plugin will not spend against.
    if (row.cost !== null && (typeof row.cost !== 'number' || !Number.isFinite(row.cost) || row.cost < 0)) return null;
    return { turns, tokens, costUsd: row.cost === null ? null : row.cost, costedTurns };
  }

  /** The plugin's own half of the budget for one day. Absent means nothing was admitted yet, which is a fact
   *  about this plugin rather than a guess about money. */
  budgetDay(chatbotUserId: number, day: string): BudgetDayRow {
    return (this.stmt('SELECT * FROM p_chatbot_budget_days WHERE chatbot_user_id = ? AND day = ?')
      .get(chatbotUserId, day) as BudgetDayRow | undefined)
      ?? { chatbot_user_id: chatbotUserId, day, admitted_turns: 0, in_flight: 0, updated_at: '' };
  }

  private bumpBudgetDay(chatbotUserId: number, day: string, now: string): void {
    this.stmt(`INSERT INTO p_chatbot_budget_days (chatbot_user_id, day, admitted_turns, in_flight, updated_at)
               VALUES (?, ?, 1, 1, ?)
               ON CONFLICT (chatbot_user_id, day) DO UPDATE SET
                 admitted_turns = admitted_turns + 1,
                 in_flight = in_flight + 1,
                 updated_at = excluded.updated_at`)
      .run(chatbotUserId, day, now);
  }

  // ── conversations and retention ─────────────────────────────────────────────────────────────────────

  conversationOf(chatbotUserId: number, visitorId: string): ConversationRow | null {
    return (this.stmt('SELECT * FROM p_chatbot_conversations WHERE chatbot_user_id = ? AND visitor_id = ?')
      .get(chatbotUserId, visitorId) as ConversationRow | undefined) ?? null;
  }

  /** Move one conversation's clock: its last activity, its due date, and the core session it lives in.
   *
   *  A null `sessionId` never erases one already recorded — the id is only known once a turn's relay has
   *  reported it, and the first writes of a conversation happen before anything has run. */
  touchConversation(input: {
    chatbotUserId: number;
    visitorId: string;
    sessionId: string | null;
    retentionDays: number;
    now: string;
  }): void {
    this.stmt(`INSERT INTO p_chatbot_conversations (id, chatbot_user_id, visitor_id, session_id, created_at, last_activity_at, delete_after)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (chatbot_user_id, visitor_id) DO UPDATE SET
                 session_id = COALESCE(excluded.session_id, session_id),
                 last_activity_at = excluded.last_activity_at,
                 delete_after = excluded.delete_after`)
      .run(
        randomUUID(),
        input.chatbotUserId,
        input.visitorId,
        input.sessionId,
        input.now,
        input.now,
        dueAt(input.now, input.retentionDays),
      );
  }

  /** The next conversations a cleaner pass may delete: due, and with no turn waiting or running.
   *
   *  Oldest due date first, so a backlog is worked off in the order it accrued; bounded by the caller, because
   *  a pass that walked every due conversation would hold the write lock for as long as the backlog is long. */
  retentionCandidates(input: { now: string; limit: number }): ConversationRow[] {
    return this.stmt(`SELECT c.* FROM p_chatbot_conversations c
                       WHERE c.delete_after <= ?
                         AND ${NO_LIVE_TURN}
                       ORDER BY c.delete_after, c.id
                       LIMIT ?`)
      .all(input.now, input.limit) as ConversationRow[];
  }

  /** The next conversations of ONE chatbot an operator asked to erase, whatever their due date.
   *
   *  The same "no turn waiting or running" rule as retention: a conversation whose answer is still being
   *  written is not one this plugin can take apart underneath it. Bounded like a retention pass, and for the
   *  same reason. */
  erasableConversations(input: { chatbotUserId: number; limit: number }): ConversationRow[] {
    return this.stmt(`SELECT c.* FROM p_chatbot_conversations c
                       WHERE c.chatbot_user_id = ?
                         AND ${NO_LIVE_TURN}
                       ORDER BY c.id
                       LIMIT ?`)
      .all(input.chatbotUserId, input.limit) as ConversationRow[];
  }

  /** Delete one conversation and everything the plugin holds about it, in ONE transaction.
   *
   *  Turns, their event log and their actions are reachable only through the (chatbot, visitor) pair the
   *  conversation is defined by, which is also the pair the core session key is built from. The caller has
   *  already deleted the core transcript; this removes the plugin's own copy, and it is one transaction so a
   *  crash cannot leave a conversation without its turns or turns without their conversation. */
  deleteConversation(conversation: ConversationRow): void {
    this.db.transaction(() => {
      this.stmt(`DELETE FROM p_chatbot_actions WHERE turn_id IN (
                   SELECT turn_id FROM p_chatbot_turns WHERE chatbot_user_id = ? AND visitor_id = ?)`)
        .run(conversation.chatbot_user_id, conversation.visitor_id);
      this.stmt(`DELETE FROM p_chatbot_turn_events WHERE turn_id IN (
                   SELECT turn_id FROM p_chatbot_turns WHERE chatbot_user_id = ? AND visitor_id = ?)`)
        .run(conversation.chatbot_user_id, conversation.visitor_id);
      this.stmt('DELETE FROM p_chatbot_turns WHERE chatbot_user_id = ? AND visitor_id = ?')
        .run(conversation.chatbot_user_id, conversation.visitor_id);
      this.stmt('DELETE FROM p_chatbot_conversations WHERE id = ?').run(conversation.id);
    });
  }

  /** Tokens whose lifetime is over. Only the row is deleted: the token itself was never stored, and its
   *  signature stops working the moment its `exp` passes whether this ran or not. */
  purgeExpiredTokens(input: { now: string; limit: number }): number {
    return this.db.transaction(() => {
      const rows = this.stmt('SELECT jti FROM p_chatbot_tokens WHERE expires_at <= ? ORDER BY expires_at LIMIT ?')
        .all(input.now, input.limit) as { jti: string }[];
      for (const row of rows) this.stmt('DELETE FROM p_chatbot_tokens WHERE jti = ?').run(row.jti);
      return rows.length;
    });
  }

  /** Visitors who can no longer be reached and have nothing left to come back to: no live token, no
   *  conversation. Their row is the last thing the plugin holds about them, and once it is gone the plugin
   *  holds nothing about that visitor at all. */
  purgeOrphanVisitors(input: { now: string; limit: number }): number {
    return this.db.transaction(() => {
      const rows = this.stmt(`SELECT v.visitor_id FROM p_chatbot_visitors v
                               WHERE NOT EXISTS (SELECT 1 FROM p_chatbot_conversations c WHERE c.visitor_id = v.visitor_id)
                                 AND NOT EXISTS (SELECT 1 FROM p_chatbot_tokens t
                                                  WHERE t.visitor_id = v.visitor_id AND t.revoked_at IS NULL AND t.expires_at > ?)
                               ORDER BY v.last_seen_at, v.visitor_id
                               LIMIT ?`)
        .all(input.now, input.limit) as { visitor_id: string }[];
      for (const row of rows) this.stmt('DELETE FROM p_chatbot_visitors WHERE visitor_id = ?').run(row.visitor_id);
      return rows.length;
    });
  }

  /** Rate windows whose minute is over. Nothing reads them again, and they are the one table an attacker can
   *  add rows to at will, so they are swept on every retention pass rather than left to grow. */
  purgeExpiredRateWindows(input: { now: string; limit: number }): number {
    return this.db.transaction(() => {
      const changed = this.stmt(`DELETE FROM p_chatbot_rate_windows WHERE rowid IN (
                                   SELECT rowid FROM p_chatbot_rate_windows WHERE expires_at <= ?
                                    ORDER BY expires_at LIMIT ?)`)
        .run(input.now, input.limit);
      return changed.changes;
    });
  }

  /** Clear every day's in-flight count. Called by the boot reconcile only: this process runs no turn yet, so
   *  the number is stale by definition, and a counter whose only writer is a `finally` would stay inflated
   *  forever once a process died mid-turn. */
  resetInFlight(now: string): number {
    return this.stmt('UPDATE p_chatbot_budget_days SET in_flight = 0, updated_at = ? WHERE in_flight > 0').run(now).changes;
  }

  // ── page actions ───────────────────────────────────────────────────────────────────────────────────

  /** The turn a visitor's action request belongs to: the one this visitor has RUNNING. A turn that is
   *  queued, done or failed is not it, and two running turns for one visitor cannot exist — the tool that
   *  asks for an action is running inside exactly one of them. */
  runningTurnOf(chatbotUserId: number, visitorId: string): TurnRow | null {
    return (this.stmt("SELECT * FROM p_chatbot_turns WHERE chatbot_user_id = ? AND visitor_id = ? AND status = 'running' ORDER BY started_at DESC, turn_id DESC LIMIT 1")
      .get(chatbotUserId, visitorId) as TurnRow | undefined) ?? null;
  }

  /** How many actions this turn has already spent. Every row counts, whatever became of it: an action that
   *  was approved has been asked of a page, and a page that refuses them all must not be asked forever. */
  actionCountOfTurn(turnId: string): number {
    const row = this.stmt('SELECT COUNT(*) AS count FROM p_chatbot_actions WHERE turn_id = ?').get(turnId) as { count: number };
    return row.count;
  }

  /** Record one approved action AND the event that asks the page for it, in ONE transaction. The order is
   *  the whole point: an announcement of an action nobody recorded, and an action nobody was told about,
   *  are both states this plugin would have to guess its way out of. */
  createAction(input: {
    actionId: string;
    turnId: string;
    snapshotId: string;
    kind: string;
    targetId: string | null;
    value: string | null;
    requiresConfirmation: boolean;
    nonceHash: string;
    expiresAt: string;
    frame: Record<string, unknown>;
    now: string;
  }): ActionRow {
    return this.db.transaction(() => {
      this.stmt(`INSERT INTO p_chatbot_actions
                   (id, turn_id, snapshot_id, action, target_id, request_json, status, requires_confirmation, confirmation_nonce_hash, created_at, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          input.actionId,
          input.turnId,
          input.snapshotId,
          input.kind,
          input.targetId,
          JSON.stringify({ schemaVersion: 1, kind: input.kind, targetId: input.targetId, value: input.value }),
          input.requiresConfirmation ? 'confirmation_required' : 'pending',
          input.requiresConfirmation ? 1 : 0,
          input.nonceHash,
          input.now,
          input.expiresAt,
        );
      this.appendEvent(input.turnId, 'action', input.frame, input.now);
      return this.action(input.actionId)!;
    });
  }

  latestPageAction(turnId: string): ActionRow | null {
    return (this.stmt("SELECT * FROM p_chatbot_actions WHERE turn_id = ? AND action IN ('snapshot', 'navigate') ORDER BY rowid DESC LIMIT 1").get(turnId) as ActionRow | undefined) ?? null;
  }

  pendingActions(turnId: string): ActionRow[] {
    return this.stmt("SELECT * FROM p_chatbot_actions WHERE turn_id = ? AND status IN ('pending', 'confirmation_required', 'confirmed') ORDER BY rowid").all(turnId) as ActionRow[];
  }

  createHandoff(input: { hash: string; actionId: string; origin: string; expiresAt: string; now: string }): void {
    this.db.transaction(() => {
      this.stmt('DELETE FROM p_chatbot_handoffs WHERE expires_at <= ? OR action_id = ?').run(input.now, input.actionId);
      this.stmt('INSERT INTO p_chatbot_handoffs (code_hash, action_id, origin, expires_at) VALUES (?, ?, ?, ?)').run(input.hash, input.actionId, input.origin, input.expiresAt);
    });
  }

  consumeHandoff(hash: string, origin: string, now: string, chatbotUserId: number): string | null {
    const row = this.stmt(`DELETE FROM p_chatbot_handoffs WHERE code_hash = ? AND origin = ? AND expires_at > ?
      AND action_id IN (SELECT a.id FROM p_chatbot_actions a JOIN p_chatbot_turns t ON t.turn_id = a.turn_id
        JOIN p_chatbot_visitors v ON v.visitor_id = t.visitor_id
        WHERE t.chatbot_user_id = ? AND v.revoked_at IS NULL AND a.status = 'pending' AND a.expires_at > ?)
      RETURNING action_id`).get(hash, origin, now, chatbotUserId, now) as { action_id: string } | undefined;
    return row?.action_id ?? null;
  }

  action(actionId: string): ActionRow | null {
    return (this.stmt('SELECT * FROM p_chatbot_actions WHERE id = ?').get(actionId) as ActionRow | undefined) ?? null;
  }

  /** Write down what the page did. Accepted from the two states a report can belong to: an action still
   *  waiting for it, and one the visitor confirmed and their browser is carrying out. Anything else — a
   *  decision nobody gave, an action already reported, one that expired — is refused rather than
   *  overwritten, so the row always describes one thing that really happened. */
  settleActionResult(input: { actionId: string; status: 'done' | 'error'; result: string; now: string }): ActionRow | null {
    const changed = this.stmt("UPDATE p_chatbot_actions SET status = ?, result_json = ?, completed_at = ? WHERE id = ? AND (status IN ('pending', 'confirmed') OR (status = 'confirmation_required' AND ? = 'error'))")
      .run(input.status, input.result, input.now, input.actionId, input.status);
    return changed.changes > 0 ? this.action(input.actionId) : null;
  }

  /** Record the visitor's own answer to a confirmation, or refuse because it was already answered. It is the
   *  one statement that consumes the nonce: a confirmation is good for exactly one form, so the hash is
   *  cleared as it is accepted and a replay finds nothing left to match. */
  decideAction(input: { actionId: string; confirmed: boolean; now: string }): ActionRow | null {
    const changed = this.stmt(`UPDATE p_chatbot_actions
                                  SET status = ?, completed_at = ?, confirmation_nonce_hash = CASE WHEN ? = 1 THEN NULL ELSE confirmation_nonce_hash END
                                WHERE id = ? AND status = 'confirmation_required'`)
      .run(input.confirmed ? 'confirmed' : 'cancelled', input.confirmed ? null : input.now, input.confirmed ? 1 : 0, input.actionId);
    return changed.changes > 0 ? this.action(input.actionId) : null;
  }

  /** Close an action the page never answered. Only the states that are still WAITING for an answer can
   *  expire: a confirmed action belongs to the visitor and their browser, and closing it would erase a
   *  decision they really made. */
  expireAction(actionId: string, now: string): ActionRow | null {
    const changed = this.stmt("UPDATE p_chatbot_actions SET status = 'expired', completed_at = ? WHERE id = ? AND status IN ('pending', 'confirmation_required', 'confirmed')")
      .run(now, actionId);
    return changed.changes > 0 ? this.action(actionId) : null;
  }

  // ── what an administrator reads: conversations, their transcript, and the counters ────────────────

  /** This chatbot's conversations, newest activity first. A conversation is the plugin's own
   *  (chatbot, visitor) pair — the same pair a session key is built from — so this register can never show
   *  one chatbot's visitor under another chatbot's row. */
  conversations(input: { chatbotUserId: number; limit: number; offset: number }): ConversationSummaryRow[] {
    const rows = this.stmt(`SELECT visitor_id,
                                   COUNT(*) AS turns,
                                   SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
                                   MIN(created_at) AS first_at,
                                   MAX(created_at) AS last_at,
                                   (SELECT last_turn.status FROM p_chatbot_turns AS last_turn
                                     WHERE last_turn.chatbot_user_id = turns.chatbot_user_id
                                       AND last_turn.visitor_id = turns.visitor_id
                                     ORDER BY last_turn.created_at DESC, last_turn.turn_id DESC LIMIT 1) AS last_status
                              FROM p_chatbot_turns AS turns
                             WHERE chatbot_user_id = ?
                          GROUP BY visitor_id
                          ORDER BY last_at DESC, visitor_id
                             LIMIT ? OFFSET ?`)
      .all(input.chatbotUserId, input.limit, input.offset) as {
        visitor_id: string; turns: number; errors: number; first_at: string; last_at: string; last_status: string;
      }[];
    return rows.map((row) => ({
      visitorId: row.visitor_id,
      turns: row.turns,
      errors: row.errors,
      firstAt: row.first_at,
      lastAt: row.last_at,
      lastStatus: row.last_status,
    }));
  }

  /** How many conversations this chatbot has, so a pager never offers a page the server answers empty. */
  conversationCount(chatbotUserId: number): number {
    const row = this.stmt('SELECT COUNT(DISTINCT visitor_id) AS count FROM p_chatbot_turns WHERE chatbot_user_id = ?')
      .get(chatbotUserId) as { count: number };
    return row.count;
  }

  /** One conversation's turns, oldest first. `visitorId` is matched TOGETHER with the chatbot, so a
   *  visitor id that belongs to another chatbot reads as an empty conversation rather than as that
   *  chatbot's history. */
  conversationTurns(input: { chatbotUserId: number; visitorId: string; limit: number }): TurnRow[] {
    return this.stmt(`SELECT * FROM p_chatbot_turns
                       WHERE chatbot_user_id = ? AND visitor_id = ?
                    ORDER BY created_at, turn_id
                       LIMIT ?`)
      .all(input.chatbotUserId, input.visitorId, input.limit) as TurnRow[];
  }

  /** This chatbot's own admission counters per UTC day, over an inclusive range of days. Read from the
   *  plugin's own turns rather than from core: what an administrator checks here is what THIS plugin
   *  admitted, and core's spend rollup is a separate counter that answers a different question. */
  dailyTurns(input: { chatbotUserId: number; fromDay: string; toDay: string }): DailyTurnRow[] {
    const rows = this.stmt(`SELECT date(created_at) AS day,
                                   COUNT(*) AS turns,
                                   SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
                                   SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
                              FROM p_chatbot_turns
                             WHERE chatbot_user_id = ? AND date(created_at) BETWEEN ? AND ?
                          GROUP BY day
                          ORDER BY day`)
      .all(input.chatbotUserId, input.fromDay, input.toDay) as { day: string; turns: number; done: number; errors: number }[];
    return rows;
  }

  /** This chatbot's turns by state over the same window, plus what is waiting right now. The two live
   *  states are read without a day filter on purpose: a turn admitted before midnight and still queued is
   *  what an administrator has to see now, not on the day it was admitted. */
  turnTotals(input: { chatbotUserId: number; fromDay: string; toDay: string }): {
    turns: number; done: number; errors: number; queued: number; running: number;
  } {
    const window = this.stmt(`SELECT COUNT(*) AS turns,
                                     SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
                                     SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
                                FROM p_chatbot_turns
                               WHERE chatbot_user_id = ? AND date(created_at) BETWEEN ? AND ?`)
      .get(input.chatbotUserId, input.fromDay, input.toDay) as { turns: number; done: number | null; errors: number | null };
    const live = this.stmt(`SELECT SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
                                   SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
                              FROM p_chatbot_turns WHERE chatbot_user_id = ?`)
      .get(input.chatbotUserId) as { queued: number | null; running: number | null };
    return {
      turns: window.turns,
      done: window.done ?? 0,
      errors: window.errors ?? 0,
      queued: live.queued ?? 0,
      running: live.running ?? 0,
    };
  }

  /** How long each started turn waited between being admitted and starting, in milliseconds, over the
   *  window. Aggregated by the caller: the percentile of a handful of numbers belongs in code a test can
   *  read, not in a SQL expression nobody can check. */
  queueWaitsMs(input: { chatbotUserId: number; fromDay: string; toDay: string }): number[] {
    const rows = this.stmt(`SELECT created_at, started_at FROM p_chatbot_turns
                             WHERE chatbot_user_id = ? AND started_at IS NOT NULL
                               AND date(created_at) BETWEEN ? AND ?`)
      .all(input.chatbotUserId, input.fromDay, input.toDay) as { created_at: string; started_at: string }[];
    return rows.flatMap((row) => {
      const queued = Date.parse(row.created_at);
      const started = Date.parse(row.started_at);
      return Number.isFinite(queued) && Number.isFinite(started) && started >= queued ? [started - queued] : [];
    });
  }
}

/** `?, ?, ?` for an IN list. The list length is bounded by the caller's own window, and each length is
 *  prepared once. */
function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

/** A count out of a core column, or nothing. `usage_by_origin` is a CORE table read through this plugin's own
 *  handle, so its values are validated rather than believed: a column that is not a non-negative integer is a
 *  number this plugin must not spend against. */
function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** The instant a conversation becomes due, `retentionDays` after its last activity. */
function dueAt(nowIso: string, retentionDays: number): string {
  return new Date(Date.parse(nowIso) + retentionDays * 86_400_000).toISOString();
}

/** Decode one stored event payload. Only this plugin writes these rows, so a value that is not a JSON
 *  object is CORRUPT rather than hostile — and it is reported as a failure of the log instead of being
 *  rendered to a visitor as an empty or invented answer. */
export function eventPayload(row: TurnEventRow): Record<string, unknown> {
  const parsed: unknown = JSON.parse(row.data);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`chatbot: stored event ${row.turn_id}#${row.seq} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** The action one row was written for. Read back rather than remembered, so what a caller is told about an
 *  action is what the plugin RECORDED, never what the caller itself passed in. A row that does not carry
 *  what the policy approved is corrupt, and saying so beats reading it as some other action. */
export interface ActionRequestPayload {
  kind: ActionKind;
  targetId: string | null;
  value: string | null;
}

export function actionRequestPayload(row: ActionRow): ActionRequestPayload {
  const parsed = jsonColumnOf(row.request_json, `action ${row.id}`);
  if (parsed.schemaVersion !== 1) throw new Error(`chatbot: action ${row.id} carries an unknown request schemaVersion`);
  const { kind, targetId, value } = parsed;
  if (typeof kind !== 'string' || !isActionKind(kind)) {
    throw new Error(`chatbot: action ${row.id} carries an action this plugin never approves: ${String(kind)}`);
  }
  if ((targetId !== null && typeof targetId !== 'string') || (value !== null && typeof value !== 'string')) {
    throw new Error(`chatbot: action ${row.id} carries a request that is not one`);
  }
  return { kind, targetId: (targetId as string | null) ?? null, value: (value as string | null) ?? null };
}

/** What the page reported. `outcome` is the widget's own word for it (`denied` is a page refusing what the
 *  server approved), and `detail` is a stable code or the short value a `read` returned. */
export interface ActionResultPayload {
  outcome: ActionOutcome;
  detail: string | null;
}

export function actionResultPayload(row: ActionRow): ActionResultPayload {
  if (row.result_json === null) throw new Error(`chatbot: action ${row.id} is ${row.status} without a result`);
  const parsed = jsonColumnOf(row.result_json, `action ${row.id}`);
  if (parsed.schemaVersion !== 1) throw new Error(`chatbot: action ${row.id} carries an unknown result schemaVersion`);
  const { outcome, detail } = parsed;
  if (typeof outcome !== 'string' || !(ACTION_OUTCOMES as readonly string[]).includes(outcome)) {
    throw new Error(`chatbot: action ${row.id} carries an outcome this plugin never writes: ${String(outcome)}`);
  }
  if (detail !== undefined && detail !== null && typeof detail !== 'string') {
    throw new Error(`chatbot: action ${row.id} carries a result detail that is not text`);
  }
  return { outcome: outcome as ActionOutcome, detail: typeof detail === 'string' ? detail : null };
}

function jsonColumnOf(raw: string, what: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`chatbot: ${what} stores a JSON column that is not an object`);
  }
  return parsed as Record<string, unknown>;
}