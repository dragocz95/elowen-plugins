import { randomUUID } from 'node:crypto';
import type { PluginDb, PluginDbStatement } from 'elowen/plugin-api';
import type {
  ActionRow,
  BotRow,
  BudgetDayRow,
  ConversationRow,
  FeedbackRow,
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
import { ACTION_OUTCOMES, type ActionKind, type ActionOutcome, type FeedbackRating, type StoredFrameType } from './publicContract.js';
import type { TurnPage } from './validation.js';
import { DAY_MS } from './adminContract.js';

/** The origin core attributes one chatbot's spend to, as `usage_by_origin.origin` stores it: the platform name
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
  /** The visitor's last address the host vouched for, or null for a conversation from before addresses
   *  were kept. */
  ip: string | null;
  sessionId: string | null;
  turns: number;
  errors: number;
  firstAt: string;
  lastAt: string;
  lastStatus: string;
}

/** One visitor of a chatbot, as the register's visitor picker offers them. */
export interface VisitorSummaryRow {
  visitorId: string;
  ip: string | null;
  lastAt: string;
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
                   (chatbot_user_id, public_id, display_name, status, may_submit_forms,
                    rate_ip_per_minute, rate_chatbot_per_minute, rate_conversation_per_minute,
                    daily_turn_limit, daily_cost_microusd,
                    max_concurrent_turns, max_queue_depth, queue_timeout_seconds,
                    max_actions_per_turn, retention_days, created_at, updated_at)
                 VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
      this.deleteConversationData(chatbotUserId, null);
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
    page: TurnPage;
    now: string;
  }): TurnRow {
    this.stmt(`INSERT INTO p_chatbot_turns (turn_id, chatbot_user_id, visitor_id, client_turn_id, status, message, page_url, page_title, created_at)
               VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`)
      .run(input.turnId, input.chatbotUserId, input.visitorId, input.clientTurnId, input.message, input.page.url, input.page.title, input.now);
    return this.turn(input.turnId)!;
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

  /** Close one turn, in one transaction: its own row and the conversation's retention stamp.
   *
   *  A turn that closed without re-stamping its conversation would let a conversation be deleted while
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
          ip: null,
          retentionDays: limits.retentionDays,
          now: input.now,
        });
      }
    });
  }


  /** Append one redacted event and return its sequence number. The row is committed before a caller may
   *  announce it, so a reconnect reads the same history a live subscriber saw. */
  appendEvent(turnId: string, type: StoredFrameType, data: Record<string, unknown>, now: string): number {
    return this.db.transaction(() => {
      const row = this.stmt('SELECT COALESCE(MAX(seq), 0) AS seq FROM p_chatbot_turn_events WHERE turn_id = ?').get(turnId) as { seq: number };
      const seq = row.seq + 1;
      this.stmt('INSERT INTO p_chatbot_turn_events (turn_id, seq, type, data, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(turnId, seq, type, JSON.stringify(data), now);
      return seq;
    });
  }

  /** Every call emits a fresh frame so a live cursor sees a replacement; restore reads only the latest. */
  replaceOffer(turnId: string, offer: import('./offerContract.js').Offer, now: string): number {
    return this.appendEvent(turnId, 'offer', { ...offer }, now);
  }

  offersOf(turnIds: readonly string[]): Map<string, Record<string, unknown>> {
    const offers = new Map<string, Record<string, unknown>>();
    if (turnIds.length === 0) return offers;
    const rows = this.stmt(`SELECT * FROM p_chatbot_turn_events WHERE turn_id IN (${placeholders(turnIds.length)})
                            AND type = 'offer' ORDER BY seq`).all(...turnIds) as TurnEventRow[];
    for (const row of rows) offers.set(row.turn_id, eventPayload(row));
    return offers;
  }

  events(turnId: string, after = 0): TurnEventRow[] {
    return this.stmt('SELECT * FROM p_chatbot_turn_events WHERE turn_id = ? AND seq > ? ORDER BY seq')
      .all(turnId, after) as TurnEventRow[];
  }

  /** The ownership and terminal state are rechecked under the write lock before replacing a rating. */
  saveFeedback(input: { turnId: string; chatbotUserId: number; visitorId: string; rating: FeedbackRating; comment: string | null; now: string }): FeedbackRow | null {
    return this.db.transaction(() => {
      const turn = this.stmt('SELECT status FROM p_chatbot_turns WHERE turn_id = ? AND chatbot_user_id = ? AND visitor_id = ?')
        .get(input.turnId, input.chatbotUserId, input.visitorId) as { status: string } | undefined;
      if (turn?.status !== 'done') return null;
      this.stmt(`INSERT INTO p_chatbot_feedback (turn_id, chatbot_user_id, visitor_id, rating, comment, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT (turn_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, updated_at = excluded.updated_at`)
        .run(input.turnId, input.chatbotUserId, input.visitorId, input.rating, input.comment, input.now);
      return this.stmt('SELECT * FROM p_chatbot_feedback WHERE turn_id = ?').get(input.turnId) as FeedbackRow;
    });
  }

  feedbackOf(turnIds: readonly string[]): Map<string, FeedbackRow> {
    if (turnIds.length === 0) return new Map();
    const rows = this.stmt(`SELECT * FROM p_chatbot_feedback WHERE turn_id IN (${placeholders(turnIds.length)})`)
      .all(...turnIds) as FeedbackRow[];
    return new Map(rows.map((row) => [row.turn_id, row]));
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
    page: TurnPage;
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

    const limited = this.consumeVisitorRate({ bot: input.bot, visitorId: input.visitorId, originValue: input.originValue, nowMs: input.nowMs });
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
    page: TurnPage;
    originValue: string;
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
      // The address the host vouched for is the visitor's LAST one: it replaces the previous value rather
      // than adding to it, so the plugin keeps one address per conversation and no history of them.
      ip: input.originValue,
      retentionDays: input.limits.retentionDays,
      now: input.now,
    });
    return { ok: true, turn: this.createTurn(input) };
  }

  /** One shared rate gate for visitor turns and feedback writes. Refused attempts count too. */
  consumeVisitorRate(input: { bot: BotRow; visitorId: string; originValue: string; nowMs: number }):
    { ok: false; reason: 'rate_limited'; retryAfterSeconds: number } | { ok: false; reason: 'limits_missing' } | null {
    const limits = readBotLimits(input.bot);
    if (!limits) return { ok: false, reason: 'limits_missing' };
    const chatbotUserId = input.bot.chatbot_user_id;
    return this.db.transaction(() => {
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
      return exceeded.length === 0
        ? null
        : { ok: false as const, reason: 'rate_limited' as const, retryAfterSeconds: Math.max(...exceeded.map((iso) => retryAfterSeconds(iso, input.nowMs))) };
    });
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
      ?? { chatbot_user_id: chatbotUserId, day, admitted_turns: 0, updated_at: '' };
  }

  private bumpBudgetDay(chatbotUserId: number, day: string, now: string): void {
    this.stmt(`INSERT INTO p_chatbot_budget_days (chatbot_user_id, day, admitted_turns, updated_at)
               VALUES (?, ?, 1, ?)
               ON CONFLICT (chatbot_user_id, day) DO UPDATE SET
                 admitted_turns = admitted_turns + 1,
                 updated_at = excluded.updated_at`)
      .run(chatbotUserId, day, now);
  }

  // ── conversations and retention ─────────────────────────────────────────────────────────────────────

  /** Move one conversation's clock: its last activity, its due date, the core session it lives in and the
   *  visitor's last address.
   *
   *  A null `sessionId` never erases one already recorded — the id is only known once a turn's relay has
   *  reported it, and the first writes of a conversation happen before anything has run. A null `ip` never
   *  erases one either: only an admitted message knows the address, and a turn finishing does not. */
  touchConversation(input: {
    chatbotUserId: number;
    visitorId: string;
    sessionId: string | null;
    ip: string | null;
    retentionDays: number;
    now: string;
  }): void {
    this.stmt(`INSERT INTO p_chatbot_conversations (id, chatbot_user_id, visitor_id, session_id, last_ip, created_at, last_activity_at, delete_after)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (chatbot_user_id, visitor_id) DO UPDATE SET
                 session_id = COALESCE(excluded.session_id, session_id),
                 last_ip = COALESCE(excluded.last_ip, last_ip),
                 last_activity_at = excluded.last_activity_at,
                 delete_after = excluded.delete_after`)
      .run(
        randomUUID(),
        input.chatbotUserId,
        input.visitorId,
        input.sessionId,
        input.ip,
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
      this.deleteConversationData(conversation.chatbot_user_id, conversation.visitor_id);
      this.stmt('DELETE FROM p_chatbot_conversations WHERE id = ?').run(conversation.id);
    });
  }

  /** Both bot deletion and conversation deletion remove the same turn-owned records. */
  private deleteConversationData(chatbotUserId: number, visitorId: string | null): void {
    const args = [chatbotUserId, visitorId, visitorId];
    const turns = `SELECT turn_id FROM p_chatbot_turns WHERE chatbot_user_id = ? AND (? IS NULL OR visitor_id = ?)`;
    this.stmt('DELETE FROM p_chatbot_feedback WHERE chatbot_user_id = ? AND (? IS NULL OR visitor_id = ?)').run(...args);
    this.stmt(`DELETE FROM p_chatbot_handoffs WHERE action_id IN (SELECT id FROM p_chatbot_actions WHERE turn_id IN (${turns}))`).run(...args);
    this.stmt(`DELETE FROM p_chatbot_actions WHERE turn_id IN (${turns})`).run(...args);
    this.stmt(`DELETE FROM p_chatbot_turn_events WHERE turn_id IN (${turns})`).run(...args);
    this.stmt('DELETE FROM p_chatbot_turns WHERE chatbot_user_id = ? AND (? IS NULL OR visitor_id = ?)').run(...args);
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
                   (id, turn_id, action, request_json, status, requires_confirmation, confirmation_nonce_hash, created_at, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          input.actionId,
          input.turnId,
          input.kind,
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

  /** Filtered feedback and totals read from the same owned rows. Text comes from the public turn projection. */
  feedbackList(input: { chatbotUserId: number | null; rating: FeedbackRating | null; limit: number; offset: number }): {
    rows: { turnId: string; chatbotUserId: number; chatbotName: string; visitorId: string; sessionId: string | null;
      rating: FeedbackRating; comment: string | null; updatedAt: string; message: string; reply: string }[];
    totals: { up: number; down: number; total: number };
  } {
    const where = 'WHERE (? IS NULL OR f.chatbot_user_id = ?) AND (? IS NULL OR f.rating = ?)';
    const args = [input.chatbotUserId, input.chatbotUserId, input.rating, input.rating];
    const counts = this.stmt(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN f.rating = 'up' THEN 1 ELSE 0 END), 0) AS up,
      COALESCE(SUM(CASE WHEN f.rating = 'down' THEN 1 ELSE 0 END), 0) AS down
      FROM p_chatbot_feedback f ${where}`).get(...args) as { total: number; up: number; down: number };
    const rows = this.stmt(`SELECT f.turn_id AS turnId, f.chatbot_user_id AS chatbotUserId,
      b.display_name AS chatbotName, f.visitor_id AS visitorId, c.session_id AS sessionId,
      f.rating, f.comment, f.updated_at AS updatedAt, t.message
      FROM p_chatbot_feedback f JOIN p_chatbot_turns t ON t.turn_id = f.turn_id
      JOIN p_chatbot_bots b ON b.chatbot_user_id = f.chatbot_user_id
      LEFT JOIN p_chatbot_conversations c ON c.chatbot_user_id = f.chatbot_user_id AND c.visitor_id = f.visitor_id
      ${where} ORDER BY f.updated_at DESC, f.turn_id DESC LIMIT ? OFFSET ?`)
      .all(...args, input.limit, input.offset) as {
        turnId: string; chatbotUserId: number; chatbotName: string; visitorId: string; sessionId: string | null;
        rating: FeedbackRating; comment: string | null; updatedAt: string; message: string;
      }[];
    const replies = this.doneRepliesOf(rows.map((row) => row.turnId));
    return {
      rows: rows.map((row) => {
        const reply = replies.get(row.turnId);
        if (reply === undefined) throw new Error(`chatbot: feedback turn ${row.turnId} has no completed answer`);
        return { ...row, reply };
      }),
      totals: counts,
    };
  }

  /** Every conversation of this chatbot, or of the one visitor picked. A conversation is the plugin's own
   *  (chatbot, visitor) pair — the same pair a session key is built from — so this register can never show
   *  one chatbot's visitor under another chatbot's row. Unpaged: the register is ordered by columns core
   *  owns (the title), so the caller orders the whole of it and cuts the page itself. */
  conversations(input: { chatbotUserId: number; visitorId: string | null }): ConversationSummaryRow[] {
    const rows = this.stmt(`SELECT turns.visitor_id,
                                   conversations.last_ip,
                                   conversations.session_id,
                                   COUNT(*) AS turns,
                                   SUM(CASE WHEN turns.status = 'error' THEN 1 ELSE 0 END) AS errors,
                                   MIN(turns.created_at) AS first_at,
                                   MAX(turns.created_at) AS last_at,
                                   (SELECT last_turn.status FROM p_chatbot_turns AS last_turn
                                     WHERE last_turn.chatbot_user_id = turns.chatbot_user_id
                                       AND last_turn.visitor_id = turns.visitor_id
                                     ORDER BY last_turn.created_at DESC, last_turn.turn_id DESC LIMIT 1) AS last_status
                              FROM p_chatbot_turns AS turns
                         LEFT JOIN p_chatbot_conversations AS conversations
                                ON conversations.chatbot_user_id = turns.chatbot_user_id
                               AND conversations.visitor_id = turns.visitor_id
                             WHERE turns.chatbot_user_id = ?
                               AND (? IS NULL OR turns.visitor_id = ?)
                          GROUP BY turns.visitor_id, conversations.session_id, conversations.last_ip`)
      .all(input.chatbotUserId, input.visitorId, input.visitorId) as {
        visitor_id: string; last_ip: string | null; session_id: string | null; turns: number; errors: number; first_at: string; last_at: string; last_status: string;
      }[];
    return rows.map((row) => ({
      visitorId: row.visitor_id,
      ip: row.last_ip,
      sessionId: row.session_id,
      turns: row.turns,
      errors: row.errors,
      firstAt: row.first_at,
      lastAt: row.last_at,
      lastStatus: row.last_status,
    }));
  }

  /** How many conversations this chatbot has, or whether the one picked visitor has one. */
  conversationCount(input: { chatbotUserId: number; visitorId: string | null }): number {
    const row = this.stmt(`SELECT COUNT(DISTINCT visitor_id) AS count FROM p_chatbot_turns
                            WHERE chatbot_user_id = ? AND (? IS NULL OR visitor_id = ?)`)
      .get(input.chatbotUserId, input.visitorId, input.visitorId) as { count: number };
    return row.count;
  }

  /** The visitors the register can be narrowed to: every visitor with a turn of this chatbot, most
   *  recently active first, each with the last address the host vouched for. Built from the same turns the
   *  register counts, so the picker never offers a visitor the register would answer empty. */
  visitors(input: { chatbotUserId: number; limit: number }): VisitorSummaryRow[] {
    const rows = this.stmt(`SELECT turns.visitor_id, conversations.last_ip, MAX(turns.created_at) AS last_at
                              FROM p_chatbot_turns AS turns
                         LEFT JOIN p_chatbot_conversations AS conversations
                                ON conversations.chatbot_user_id = turns.chatbot_user_id
                               AND conversations.visitor_id = turns.visitor_id
                             WHERE turns.chatbot_user_id = ?
                          GROUP BY turns.visitor_id, conversations.last_ip
                          ORDER BY last_at DESC, turns.visitor_id
                             LIMIT ?`)
      .all(input.chatbotUserId, input.limit) as { visitor_id: string; last_ip: string | null; last_at: string }[];
    return rows.map((row) => ({ visitorId: row.visitor_id, ip: row.last_ip, lastAt: row.last_at }));
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
  return new Date(Date.parse(nowIso) + retentionDays * DAY_MS).toISOString();
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