/** Plugin-owned tables, all namespaced `p_chatbot_` so nothing here can collide with a core table. */
const SCHEMA_VERSION = 1;
/** Ordered, additive migrations. A step runs at most once per database (the host's `migrate` keeps the
 *  bookkeeping row), so adding a column later means a new step, never an edit to this one. */
const MIGRATIONS = [
    {
        version: SCHEMA_VERSION,
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS p_chatbot_bots (
          chatbot_user_id INTEGER PRIMARY KEY,
          public_id TEXT NOT NULL UNIQUE,
          customer_user_id INTEGER,
          display_name TEXT NOT NULL DEFAULT '',
          prompt TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'enabled', 'disabled')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS p_chatbot_origins (
          chatbot_user_id INTEGER NOT NULL,
          origin TEXT NOT NULL,
          PRIMARY KEY (chatbot_user_id, origin)
        );

        -- One row per visitor, globally unique: a visitor id the server generated is bound to exactly one
        -- chatbot, and a token naming it for another chatbot is refused rather than creating a second
        -- conversation with another bot's privileges.
        CREATE TABLE IF NOT EXISTS p_chatbot_visitors (
          visitor_id TEXT PRIMARY KEY,
          chatbot_user_id INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          last_seen_at TEXT,
          revoked_at TEXT
        );

        -- Only the HASH of an issued token is stored. A database read therefore yields no usable credential,
        -- and revocation is a row update rather than a signature check.
        CREATE TABLE IF NOT EXISTS p_chatbot_tokens (
          jti TEXT PRIMARY KEY,
          chatbot_user_id INTEGER NOT NULL,
          visitor_id TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS p_chatbot_tokens_visitor ON p_chatbot_tokens (visitor_id, revoked_at);

        CREATE TABLE IF NOT EXISTS p_chatbot_turns (
          turn_id TEXT PRIMARY KEY,
          chatbot_user_id INTEGER NOT NULL,
          visitor_id TEXT NOT NULL,
          client_turn_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'error')),
          message TEXT NOT NULL,
          core_session_id TEXT,
          error_code TEXT,
          created_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          UNIQUE (chatbot_user_id, visitor_id, client_turn_id)
        );
        CREATE INDEX IF NOT EXISTS p_chatbot_turns_open ON p_chatbot_turns (status, created_at);

        -- Invariant: an event is written here BEFORE any subscriber is told about it, so a reconnect never
        -- depends on what a process still holds in memory. Only the redacted public shape is stored.
        CREATE TABLE IF NOT EXISTS p_chatbot_turn_events (
          turn_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          type TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (turn_id, seq)
        );
      `);
        },
    },
];
/** Create the plugin's tables. A no-op outside the daemon process (the host's handle reports that itself). */
export function migrate(db) {
    db.migrate(MIGRATIONS.map((step) => ({ version: step.version, up: (handle) => step.up(handle) })));
}
