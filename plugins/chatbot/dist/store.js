import { randomUUID } from 'node:crypto';
import { isActionKind } from './actions.js';
import { ACTION_OUTCOMES } from './publicContract.js';
/** Every plugin-owned read and write in one place, so the public path and the admin surface cannot
 *  disagree about what a row means. */
export class ChatbotStore {
    db;
    statements = new Map();
    constructor(db) {
        this.db = db;
    }
    /** Prepared once per statement text. The host's handle is a thin wrapper over better-sqlite3, so
     *  re-preparing on every public request would repeat the parse for no benefit. */
    stmt(sql) {
        let statement = this.statements.get(sql);
        if (!statement) {
            statement = this.db.prepare(sql);
            this.statements.set(sql, statement);
        }
        return statement;
    }
    // ── chatbots ───────────────────────────────────────────────────────────────────────────────────────
    botByUserId(chatbotUserId) {
        return this.stmt('SELECT * FROM p_chatbot_bots WHERE chatbot_user_id = ?').get(chatbotUserId) ?? null;
    }
    botByPublicId(publicId) {
        return this.stmt('SELECT * FROM p_chatbot_bots WHERE public_id = ?').get(publicId) ?? null;
    }
    listBots() {
        return this.stmt('SELECT * FROM p_chatbot_bots ORDER BY display_name COLLATE NOCASE, chatbot_user_id').all();
    }
    createBot(input) {
        return this.db.transaction(() => {
            this.stmt(`INSERT INTO p_chatbot_bots (chatbot_user_id, public_id, customer_user_id, display_name, prompt, status, created_at, updated_at)
                 VALUES (?, ?, NULL, ?, ?, 'draft', ?, ?)`)
                .run(input.chatbotUserId, input.publicId, input.displayName, input.prompt, input.now, input.now);
            this.replaceOrigins(input.chatbotUserId, input.origins);
            this.replaceActionRules(input.chatbotUserId, input.actionRules, input.now);
            return this.botByUserId(input.chatbotUserId);
        });
    }
    /** Compare-and-set on `updated_at`, the plugin's only concurrency token for a bot: two administrators
     *  editing the same row cannot silently overwrite each other, and a stale write reports a conflict. */
    updateBot(input) {
        return this.db.transaction(() => {
            const result = this.stmt('UPDATE p_chatbot_bots SET display_name = ?, prompt = ?, updated_at = ? WHERE chatbot_user_id = ? AND updated_at = ?')
                .run(input.displayName, input.prompt, input.now, input.chatbotUserId, input.expectedUpdatedAt);
            if (result.changes === 0)
                return null;
            this.replaceOrigins(input.chatbotUserId, input.origins);
            this.replaceActionRules(input.chatbotUserId, input.actionRules, input.now);
            return this.botByUserId(input.chatbotUserId);
        });
    }
    setBotStatus(input) {
        this.stmt('UPDATE p_chatbot_bots SET status = ?, updated_at = ? WHERE chatbot_user_id = ?')
            .run(input.status, input.now, input.chatbotUserId);
        return this.botByUserId(input.chatbotUserId);
    }
    deleteBot(chatbotUserId) {
        this.db.transaction(() => {
            this.stmt('DELETE FROM p_chatbot_actions WHERE turn_id IN (SELECT turn_id FROM p_chatbot_turns WHERE chatbot_user_id = ?)').run(chatbotUserId);
            this.stmt('DELETE FROM p_chatbot_turn_events WHERE turn_id IN (SELECT turn_id FROM p_chatbot_turns WHERE chatbot_user_id = ?)').run(chatbotUserId);
            this.stmt('DELETE FROM p_chatbot_turns WHERE chatbot_user_id = ?').run(chatbotUserId);
            this.stmt('DELETE FROM p_chatbot_tokens WHERE chatbot_user_id = ?').run(chatbotUserId);
            this.stmt('DELETE FROM p_chatbot_visitors WHERE chatbot_user_id = ?').run(chatbotUserId);
            this.stmt('DELETE FROM p_chatbot_action_rules WHERE chatbot_user_id = ?').run(chatbotUserId);
            this.stmt('DELETE FROM p_chatbot_origins WHERE chatbot_user_id = ?').run(chatbotUserId);
            this.stmt('DELETE FROM p_chatbot_bots WHERE chatbot_user_id = ?').run(chatbotUserId);
        });
    }
    // ── allowed domains ────────────────────────────────────────────────────────────────────────────────
    originsOf(chatbotUserId) {
        const rows = this.stmt('SELECT origin FROM p_chatbot_origins WHERE chatbot_user_id = ? ORDER BY origin')
            .all(chatbotUserId);
        return rows.map((row) => row.origin);
    }
    replaceOrigins(chatbotUserId, origins) {
        this.stmt('DELETE FROM p_chatbot_origins WHERE chatbot_user_id = ?').run(chatbotUserId);
        const insert = this.stmt('INSERT OR IGNORE INTO p_chatbot_origins (chatbot_user_id, origin) VALUES (?, ?)');
        for (const origin of origins)
            insert.run(chatbotUserId, origin);
    }
    // ── visitors and their tokens ──────────────────────────────────────────────────────────────────────
    visitor(visitorId) {
        return this.stmt('SELECT * FROM p_chatbot_visitors WHERE visitor_id = ?').get(visitorId) ?? null;
    }
    touchVisitor(visitorId, now) {
        this.stmt('UPDATE p_chatbot_visitors SET last_seen_at = ? WHERE visitor_id = ?').run(now, visitorId);
    }
    createVisitor(visitorId, chatbotUserId, now) {
        this.stmt('INSERT INTO p_chatbot_visitors (visitor_id, chatbot_user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
            .run(visitorId, chatbotUserId, now, now);
        return this.visitor(visitorId);
    }
    /** Issue one token: the row is written in the same transaction that revokes the visitor's previous
     *  tokens, so a rotated token never coexists with a usable predecessor. */
    issueToken(input) {
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
    token(jti) {
        return this.stmt('SELECT * FROM p_chatbot_tokens WHERE jti = ?').get(jti) ?? null;
    }
    // ── turns and their public event log ───────────────────────────────────────────────────────────────
    turnByClientId(chatbotUserId, visitorId, clientTurnId) {
        return this.stmt('SELECT * FROM p_chatbot_turns WHERE chatbot_user_id = ? AND visitor_id = ? AND client_turn_id = ?')
            .get(chatbotUserId, visitorId, clientTurnId) ?? null;
    }
    turn(turnId) {
        return this.stmt('SELECT * FROM p_chatbot_turns WHERE turn_id = ?').get(turnId) ?? null;
    }
    /** Record a submitted turn. UNIQUE (bot, visitor, client turn id) is what makes a retried POST after a
     *  lost 202 return the SAME turn instead of starting a second model turn. */
    createTurn(input) {
        this.stmt(`INSERT INTO p_chatbot_turns (turn_id, chatbot_user_id, visitor_id, client_turn_id, status, message, created_at)
               VALUES (?, ?, ?, ?, 'queued', ?, ?)`)
            .run(input.turnId, input.chatbotUserId, input.visitorId, input.clientTurnId, input.message, input.now);
        return this.turn(input.turnId);
    }
    queuedTurns(limit) {
        return this.stmt(`SELECT * FROM p_chatbot_turns WHERE status = 'queued' ORDER BY created_at, turn_id LIMIT ?`)
            .all(limit);
    }
    markTurnRunning(turnId, now) {
        this.stmt("UPDATE p_chatbot_turns SET status = 'running', started_at = ? WHERE turn_id = ? AND status = 'queued'").run(now, turnId);
    }
    finishTurn(input) {
        this.stmt('UPDATE p_chatbot_turns SET status = ?, core_session_id = COALESCE(?, core_session_id), error_code = ?, finished_at = ? WHERE turn_id = ?')
            .run(input.status, input.coreSessionId, input.errorCode, input.now, input.turnId);
    }
    /** Append one redacted event and return its sequence number. The row is committed before a caller may
     *  announce it, so a reconnect reads the same history a live subscriber saw. */
    appendEvent(turnId, type, data, now) {
        return this.db.transaction(() => {
            const row = this.stmt('SELECT COALESCE(MAX(seq), 0) AS seq FROM p_chatbot_turn_events WHERE turn_id = ?').get(turnId);
            const seq = row.seq + 1;
            this.stmt('INSERT INTO p_chatbot_turn_events (turn_id, seq, type, data, created_at) VALUES (?, ?, ?, ?, ?)')
                .run(turnId, seq, type, JSON.stringify(data), now);
            return seq;
        });
    }
    events(turnId, after = 0) {
        return this.stmt('SELECT * FROM p_chatbot_turn_events WHERE turn_id = ? AND seq > ? ORDER BY seq')
            .all(turnId, after);
    }
    /** The visitor's own conversation, newest first. A widget that lost its connection rebuilds what it
     *  showed from these rows and the answers below, never by reading a transcript this plugin does not own.
     *  The bound is the caller's: a reconnect is a bounded read, not a history export. */
    recentTurns(input) {
        return this.stmt(`SELECT * FROM p_chatbot_turns WHERE chatbot_user_id = ? AND visitor_id = ?
                      ORDER BY created_at DESC, turn_id DESC LIMIT ?`)
            .all(input.chatbotUserId, input.visitorId, input.limit);
    }
    /** How far each turn's public log has got. A reconnecting reader learns where the log stands and reads
     *  the rows itself; nothing here is a second copy of an event. */
    lastSeqsOf(turnIds) {
        const seqs = new Map(turnIds.map((turnId) => [turnId, 0]));
        if (turnIds.length === 0)
            return seqs;
        const rows = this.stmt(`SELECT turn_id, MAX(seq) AS seq FROM p_chatbot_turn_events
                            WHERE turn_id IN (${placeholders(turnIds.length)}) GROUP BY turn_id`)
            .all(...turnIds);
        for (const row of rows)
            seqs.set(row.turn_id, row.seq);
        return seqs;
    }
    /** The final answer of each finished turn, keyed by turn id, read from the event log rather than kept a
     *  second time on the turn row: the answer a reconnect renders is exactly the answer the live stream sent. */
    doneRepliesOf(turnIds) {
        const replies = new Map();
        if (turnIds.length === 0)
            return replies;
        const rows = this.stmt(`SELECT * FROM p_chatbot_turn_events WHERE turn_id IN (${placeholders(turnIds.length)})
                            AND type = 'done' ORDER BY seq`)
            .all(...turnIds);
        for (const row of rows) {
            const text = eventPayload(row).text;
            if (typeof text !== 'string')
                throw new Error(`chatbot: stored done event ${row.turn_id}#${row.seq} carries no text`);
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
    closeOrphanedTurns(now, errorCode) {
        return this.db.transaction(() => {
            const rows = this.stmt("SELECT turn_id FROM p_chatbot_turns WHERE status IN ('queued', 'running') ORDER BY created_at").all();
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
    // ── page actions and the rules over them ───────────────────────────────────────────────────────────
    /** The turn a visitor's action request belongs to: the one this visitor has RUNNING. A turn that is
     *  queued, done or failed is not it, and two running turns for one visitor cannot exist — the tool that
     *  asks for an action is running inside exactly one of them. */
    runningTurnOf(chatbotUserId, visitorId) {
        return this.stmt("SELECT * FROM p_chatbot_turns WHERE chatbot_user_id = ? AND visitor_id = ? AND status = 'running' ORDER BY started_at DESC, turn_id DESC LIMIT 1")
            .get(chatbotUserId, visitorId) ?? null;
    }
    /** How many actions this turn has already spent. Every row counts, whatever became of it: an action that
     *  was approved has been asked of a page, and a page that refuses them all must not be asked forever. */
    actionCountOfTurn(turnId) {
        const row = this.stmt('SELECT COUNT(*) AS count FROM p_chatbot_actions WHERE turn_id = ?').get(turnId);
        return row.count;
    }
    /** Record one approved action AND the event that asks the page for it, in ONE transaction. The order is
     *  the whole point: an announcement of an action nobody recorded, and an action nobody was told about,
     *  are both states this plugin would have to guess its way out of. */
    createAction(input) {
        return this.db.transaction(() => {
            this.stmt(`INSERT INTO p_chatbot_actions
                   (id, turn_id, snapshot_id, action, target_id, request_json, status, requires_confirmation, confirmation_nonce_hash, created_at, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(input.actionId, input.turnId, input.snapshotId, input.kind, input.targetId, JSON.stringify({ schemaVersion: 1, kind: input.kind, targetId: input.targetId, value: input.value }), input.requiresConfirmation ? 'confirmation_required' : 'pending', input.requiresConfirmation ? 1 : 0, input.nonceHash, input.now, input.expiresAt);
            this.appendEvent(input.turnId, 'action', input.frame, input.now);
            return this.action(input.actionId);
        });
    }
    action(actionId) {
        return this.stmt('SELECT * FROM p_chatbot_actions WHERE id = ?').get(actionId) ?? null;
    }
    /** Write down what the page did. Accepted from the two states a report can belong to: an action still
     *  waiting for it, and one the visitor confirmed and their browser is carrying out. Anything else — a
     *  decision nobody gave, an action already reported, one that expired — is refused rather than
     *  overwritten, so the row always describes one thing that really happened. */
    settleActionResult(input) {
        const changed = this.stmt("UPDATE p_chatbot_actions SET status = ?, result_json = ?, completed_at = ? WHERE id = ? AND status IN ('pending', 'confirmed')")
            .run(input.status, input.result, input.now, input.actionId);
        return changed.changes > 0 ? this.action(input.actionId) : null;
    }
    /** Record the visitor's own answer to a confirmation, or refuse because it was already answered. It is the
     *  one statement that consumes the nonce: a confirmation is good for exactly one form, so the hash is
     *  cleared as it is accepted and a replay finds nothing left to match. */
    decideAction(input) {
        const changed = this.stmt(`UPDATE p_chatbot_actions
                                  SET status = ?, completed_at = ?, confirmation_nonce_hash = CASE WHEN ? = 1 THEN NULL ELSE confirmation_nonce_hash END
                                WHERE id = ? AND status = 'confirmation_required'`)
            .run(input.confirmed ? 'confirmed' : 'cancelled', input.confirmed ? null : input.now, input.confirmed ? 1 : 0, input.actionId);
        return changed.changes > 0 ? this.action(input.actionId) : null;
    }
    /** Close an action the page never answered. Only the states that are still WAITING for an answer can
     *  expire: a confirmed action belongs to the visitor and their browser, and closing it would erase a
     *  decision they really made. */
    expireAction(actionId, now) {
        const changed = this.stmt("UPDATE p_chatbot_actions SET status = 'expired', completed_at = ? WHERE id = ? AND status IN ('pending', 'confirmation_required')")
            .run(now, actionId);
        return changed.changes > 0 ? this.action(actionId) : null;
    }
    /** Every rule this chatbot has. Read in one query and resolved in memory, because the resolution is a
     *  decision about a path and belongs in code that can be read and tested, not in SQL. */
    actionRulesOf(chatbotUserId) {
        return this.stmt('SELECT * FROM p_chatbot_action_rules WHERE chatbot_user_id = ? ORDER BY path_prefix DESC')
            .all(chatbotUserId);
    }
    /** Write this chatbot's rules as a WHOLE list, in the same transaction as the rest of a bot write: the
     *  administrator's editor hands over a complete policy, and two partial writes would leave a rule behind
     *  that nobody can see in the editor that is supposed to control it. */
    replaceActionRules(chatbotUserId, rules, now) {
        this.stmt('DELETE FROM p_chatbot_action_rules WHERE chatbot_user_id = ?').run(chatbotUserId);
        const insert = this.stmt(`INSERT INTO p_chatbot_action_rules
                                (id, chatbot_user_id, origin, path_prefix, action, requires_confirmation, max_per_turn, created_at, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const rule of rules) {
            insert.run(randomUUID(), chatbotUserId, rule.origin, rule.pathPrefix, rule.action, rule.requiresConfirmation ? 1 : 0, rule.maxPerTurn, now, now);
        }
    }
    // ── what an administrator reads: conversations, their transcript, and the counters ────────────────
    /** This chatbot's conversations, newest activity first. A conversation is the plugin's own
     *  (chatbot, visitor) pair — the same pair a session key is built from — so this register can never show
     *  one chatbot's visitor under another chatbot's row. */
    conversations(input) {
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
            .all(input.chatbotUserId, input.limit, input.offset);
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
    conversationCount(chatbotUserId) {
        const row = this.stmt('SELECT COUNT(DISTINCT visitor_id) AS count FROM p_chatbot_turns WHERE chatbot_user_id = ?')
            .get(chatbotUserId);
        return row.count;
    }
    /** One conversation's turns, oldest first. `visitorId` is matched TOGETHER with the chatbot, so a
     *  visitor id that belongs to another chatbot reads as an empty conversation rather than as that
     *  chatbot's history. */
    conversationTurns(input) {
        return this.stmt(`SELECT * FROM p_chatbot_turns
                       WHERE chatbot_user_id = ? AND visitor_id = ?
                    ORDER BY created_at, turn_id
                       LIMIT ?`)
            .all(input.chatbotUserId, input.visitorId, input.limit);
    }
    /** This chatbot's own admission counters per UTC day, over an inclusive range of days. Read from the
     *  plugin's own turns rather than from core: what an administrator checks here is what THIS plugin
     *  admitted, and core's spend rollup is a separate counter that answers a different question. */
    dailyTurns(input) {
        const rows = this.stmt(`SELECT date(created_at) AS day,
                                   COUNT(*) AS turns,
                                   SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
                                   SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
                              FROM p_chatbot_turns
                             WHERE chatbot_user_id = ? AND date(created_at) BETWEEN ? AND ?
                          GROUP BY day
                          ORDER BY day`)
            .all(input.chatbotUserId, input.fromDay, input.toDay);
        return rows;
    }
    /** This chatbot's turns by state over the same window, plus what is waiting right now. The two live
     *  states are read without a day filter on purpose: a turn admitted before midnight and still queued is
     *  what an administrator has to see now, not on the day it was admitted. */
    turnTotals(input) {
        const window = this.stmt(`SELECT COUNT(*) AS turns,
                                     SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
                                     SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
                                FROM p_chatbot_turns
                               WHERE chatbot_user_id = ? AND date(created_at) BETWEEN ? AND ?`)
            .get(input.chatbotUserId, input.fromDay, input.toDay);
        const live = this.stmt(`SELECT SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
                                   SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
                              FROM p_chatbot_turns WHERE chatbot_user_id = ?`)
            .get(input.chatbotUserId);
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
    queueWaitsMs(input) {
        const rows = this.stmt(`SELECT created_at, started_at FROM p_chatbot_turns
                             WHERE chatbot_user_id = ? AND started_at IS NOT NULL
                               AND date(created_at) BETWEEN ? AND ?`)
            .all(input.chatbotUserId, input.fromDay, input.toDay);
        return rows.flatMap((row) => {
            const queued = Date.parse(row.created_at);
            const started = Date.parse(row.started_at);
            return Number.isFinite(queued) && Number.isFinite(started) && started >= queued ? [started - queued] : [];
        });
    }
}
/** `?, ?, ?` for an IN list. The list length is bounded by the caller's own window, and each length is
 *  prepared once. */
function placeholders(count) {
    return new Array(count).fill('?').join(', ');
}
/** Decode one stored event payload. Only this plugin writes these rows, so a value that is not a JSON
 *  object is CORRUPT rather than hostile — and it is reported as a failure of the log instead of being
 *  rendered to a visitor as an empty or invented answer. */
export function eventPayload(row) {
    const parsed = JSON.parse(row.data);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`chatbot: stored event ${row.turn_id}#${row.seq} is not a JSON object`);
    }
    return parsed;
}
export function actionRequestPayload(row) {
    const parsed = jsonColumnOf(row.request_json, `action ${row.id}`);
    if (parsed.schemaVersion !== 1)
        throw new Error(`chatbot: action ${row.id} carries an unknown request schemaVersion`);
    const { kind, targetId, value } = parsed;
    if (typeof kind !== 'string' || !isActionKind(kind)) {
        throw new Error(`chatbot: action ${row.id} carries an action this plugin never approves: ${String(kind)}`);
    }
    if ((targetId !== null && typeof targetId !== 'string') || (value !== null && typeof value !== 'string')) {
        throw new Error(`chatbot: action ${row.id} carries a request that is not one`);
    }
    return { kind, targetId: targetId ?? null, value: value ?? null };
}
export function actionResultPayload(row) {
    if (row.result_json === null)
        throw new Error(`chatbot: action ${row.id} is ${row.status} without a result`);
    const parsed = jsonColumnOf(row.result_json, `action ${row.id}`);
    if (parsed.schemaVersion !== 1)
        throw new Error(`chatbot: action ${row.id} carries an unknown result schemaVersion`);
    const { outcome, detail } = parsed;
    if (typeof outcome !== 'string' || !ACTION_OUTCOMES.includes(outcome)) {
        throw new Error(`chatbot: action ${row.id} carries an outcome this plugin never writes: ${String(outcome)}`);
    }
    if (detail !== undefined && detail !== null && typeof detail !== 'string') {
        throw new Error(`chatbot: action ${row.id} carries a result detail that is not text`);
    }
    return { outcome: outcome, detail: typeof detail === 'string' ? detail : null };
}
function jsonColumnOf(raw, what) {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`chatbot: ${what} stores a JSON column that is not an object`);
    }
    return parsed;
}
