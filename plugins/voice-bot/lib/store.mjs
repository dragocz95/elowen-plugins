// Durable record of every call this plugin started. It is deliberately one table serving three jobs:
// the rate-limit window (so a restart does not hand a looping agent its quota back), the audit log of
// who was rung and on whose behalf, and the place a remote call id goes if the service returns one.

/** How long a placed call keeps counting against the hourly limit. */
export const WINDOW_MS = 60 * 60 * 1000;

/** The stored body is the audit record, and for a completed call it carries the TRANSCRIPT — what was
 *  actually said to somebody on our behalf, which is the part worth keeping. Hence the generous cap:
 *  truncating a refusal costs nothing, truncating a conversation loses the evidence. */
const RESPONSE_CAP = 8000;

const MIGRATIONS = [{
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS p_voice_bot_calls (
        id INTEGER PRIMARY KEY,
        created_at INTEGER NOT NULL,
        phone TEXT NOT NULL,
        prompt TEXT NOT NULL,
        init_message TEXT,
        user_id INTEGER,
        session_id TEXT,
        status TEXT NOT NULL,
        http_status INTEGER,
        response TEXT,
        remote_call_id TEXT
      );
      CREATE INDEX IF NOT EXISTS p_voice_bot_calls_created_at
        ON p_voice_bot_calls(created_at);
    `);
  },
}];

export function openStore(db) {
  db.migrate(MIGRATIONS);

  return {
    /** Calls started within the window. Failures count too: an agent failing in a loop is exactly the
     *  thing the limit exists to stop, and a service that rejects every request would otherwise let it
     *  retry without bound. */
    countSince(from) {
      const row = db.prepare('SELECT COUNT(*) AS n FROM p_voice_bot_calls WHERE created_at >= ?').get(from);
      return Number(row?.n ?? 0);
    },

    /** When the window frees up: the oldest call still inside it leaves first. */
    oldestSince(from) {
      const row = db.prepare('SELECT MIN(created_at) AS at FROM p_voice_bot_calls WHERE created_at >= ?').get(from);
      const at = Number(row?.at ?? 0);
      return at > 0 ? at : null;
    },

    /** Written BEFORE the request goes out, so a call that is placed but whose answer is lost still
     *  counts against the limit and still appears in the log. */
    record({ now, phone, prompt, initMessage, userId, sessionId }) {
      const result = db.prepare(`
        INSERT INTO p_voice_bot_calls (created_at, phone, prompt, init_message, user_id, session_id, status)
        VALUES (?, ?, ?, ?, ?, ?, 'requested')
      `).run(now, phone, prompt, initMessage ?? null, userId ?? null, sessionId ?? null);
      return Number(result.lastInsertRowid);
    },

    settle(id, { status, httpStatus, response, remoteCallId }) {
      db.prepare(`
        UPDATE p_voice_bot_calls
        SET status = ?, http_status = ?, response = ?, remote_call_id = ?
        WHERE id = ?
      `).run(
        status,
        httpStatus ?? null,
        typeof response === 'string' ? response.slice(0, RESPONSE_CAP) : null,
        remoteCallId ?? null,
        id,
      );
    },

    get(id) {
      return db.prepare('SELECT * FROM p_voice_bot_calls WHERE id = ?').get(id) ?? null;
    },

    /** A deleted account takes its call history with it. The row names who asked for the call, the
     *  number that was dialled and everything that was said on it — keeping that after the account is
     *  gone would leave personal data with nobody left to own it. The hourly window loses those entries
     *  too, which is harmless: they age out within the hour anyway. */
    removeUser(userId) {
      return db.prepare('DELETE FROM p_voice_bot_calls WHERE user_id = ?').run(userId).changes;
    },
  };
}
