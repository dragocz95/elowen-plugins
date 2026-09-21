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
            this.stmt('DELETE FROM p_chatbot_turn_events WHERE turn_id IN (SELECT turn_id FROM p_chatbot_turns WHERE chatbot_user_id = ?)').run(chatbotUserId);
            this.stmt('DELETE FROM p_chatbot_turns WHERE chatbot_user_id = ?').run(chatbotUserId);
            this.stmt('DELETE FROM p_chatbot_tokens WHERE chatbot_user_id = ?').run(chatbotUserId);
            this.stmt('DELETE FROM p_chatbot_visitors WHERE chatbot_user_id = ?').run(chatbotUserId);
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
    /** Boot reconcile: a turn this process no longer runs cannot be resumed, and reporting it as still
     *  running would leave a visitor waiting forever. Core turn recovery is explicitly not guaranteed. */
    failOrphanedTurns(now, errorCode) {
        const result = this.stmt("UPDATE p_chatbot_turns SET status = 'error', error_code = ?, finished_at = ? WHERE status IN ('queued', 'running')")
            .run(errorCode, now);
        return result.changes;
    }
}
