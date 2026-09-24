/** Plugin-owned tables, all namespaced `p_chatbot_` so nothing here can collide with a core table. */
const SCHEMA_VERSION = 1;
/** Ordered, additive migrations. A step runs at most once per database (the host's `migrate` keeps the
 *  bookkeeping row), so adding a column later means a new step, never an edit to this one.
 *
 *  All times are ISO strings, as in every other table here. Timestamps are compared only inside this plugin
 *  and always by the same code that wrote them, so the format is an internal decision — what matters is
 *  that there is ONE of it. */
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
    {
        /** Step 2: durable page actions approved for a visitor turn. */
        version: 2,
        up(db) {
            db.exec(`
        -- One row per action the SERVER approved for a turn. It is written BEFORE the page is told about
        -- it: an action a page performed is then always an action this plugin can explain, and a page that
        -- never answered is a row that expired rather than a gap.
        --
        -- No FOREIGN KEY is declared here: turn ownership is deleted explicitly by the plugin.
        -- The handoff table added later references these action rows; both deletion paths explicitly
        -- remove handoffs before actions.
        CREATE TABLE IF NOT EXISTS p_chatbot_actions (
          id TEXT PRIMARY KEY,
          turn_id TEXT NOT NULL,
          snapshot_id TEXT NOT NULL,
          action TEXT NOT NULL,
          target_id TEXT,
          request_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (
            status IN ('pending', 'confirmation_required', 'confirmed', 'done', 'error', 'cancelled', 'expired')
          ),
          requires_confirmation INTEGER NOT NULL CHECK (requires_confirmation IN (0, 1)),
          confirmation_nonce_hash TEXT,
          result_json TEXT,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS p_chatbot_actions_pending ON p_chatbot_actions (turn_id, status, expires_at);

      `);
        },
    },
    {
        /** Step 3: the abuse, capacity, budget and retention layer. Additive in both directions: eleven nullable
         *  columns on the bot row (a draft that never had a limit filled in is refused, never defaulted) and four
         *  tables, none of which rewrites a row that already exists.
         *
         *  Every time in this step is an ISO string like the rest of the plugin's tables. The rate window is the
         *  one place where that costs a little arithmetic (the minute bucket is computed as a number and then
         *  written as the string it names), and that is deliberate: a second time format is a second thing every
         *  reader would have to know. */
        version: 3,
        up(db) {
            db.exec(`
        -- NULL means "the owner has not decided this number yet". There is no default and no implicit
        -- unlimited: the enable gate refuses a bot that is missing any of them (see limits.ts).
        ALTER TABLE p_chatbot_bots ADD COLUMN sensitive_mode INTEGER NOT NULL DEFAULT 0
          CHECK (sensitive_mode IN (0, 1));
        ALTER TABLE p_chatbot_bots ADD COLUMN rate_ip_per_minute INTEGER
          CHECK (rate_ip_per_minute IS NULL OR rate_ip_per_minute > 0);
        ALTER TABLE p_chatbot_bots ADD COLUMN rate_chatbot_per_minute INTEGER
          CHECK (rate_chatbot_per_minute IS NULL OR rate_chatbot_per_minute > 0);
        ALTER TABLE p_chatbot_bots ADD COLUMN rate_conversation_per_minute INTEGER
          CHECK (rate_conversation_per_minute IS NULL OR rate_conversation_per_minute > 0);
        ALTER TABLE p_chatbot_bots ADD COLUMN daily_turn_limit INTEGER
          CHECK (daily_turn_limit IS NULL OR daily_turn_limit > 0);
        ALTER TABLE p_chatbot_bots ADD COLUMN daily_token_limit INTEGER
          CHECK (daily_token_limit IS NULL OR daily_token_limit > 0);
        ALTER TABLE p_chatbot_bots ADD COLUMN daily_cost_microusd INTEGER
          CHECK (daily_cost_microusd IS NULL OR daily_cost_microusd > 0);
        ALTER TABLE p_chatbot_bots ADD COLUMN max_concurrent_turns INTEGER
          CHECK (max_concurrent_turns IS NULL OR max_concurrent_turns > 0);
        ALTER TABLE p_chatbot_bots ADD COLUMN max_queue_depth INTEGER
          CHECK (max_queue_depth IS NULL OR max_queue_depth > 0);
        ALTER TABLE p_chatbot_bots ADD COLUMN queue_timeout_seconds INTEGER
          CHECK (queue_timeout_seconds IS NULL OR queue_timeout_seconds > 0);
        ALTER TABLE p_chatbot_bots ADD COLUMN max_actions_per_turn INTEGER
          CHECK (max_actions_per_turn IS NULL OR max_actions_per_turn > 0);
        ALTER TABLE p_chatbot_bots ADD COLUMN retention_days INTEGER
          CHECK (retention_days IS NULL OR retention_days > 0);

        -- One fixed window per (scope, key, minute). The row is the counter: admission increments it and reads
        -- it back in one transaction, so two simultaneous requests cannot both pass a limit of one. A refused
        -- request still counts -- the window bounds ATTEMPTS, which is what makes it a rate limit rather than a
        -- success counter -- and the row is deleted by the cleaner once its window is over.
        CREATE TABLE IF NOT EXISTS p_chatbot_rate_windows (
          scope TEXT NOT NULL CHECK (scope IN ('ip', 'chatbot', 'conversation')),
          scope_key TEXT NOT NULL,
          window_started_at TEXT NOT NULL,
          count INTEGER NOT NULL CHECK (count > 0),
          expires_at TEXT NOT NULL,
          PRIMARY KEY (scope, scope_key, window_started_at)
        );
        CREATE INDEX IF NOT EXISTS p_chatbot_rate_expiry ON p_chatbot_rate_windows (expires_at);

        -- The plugin's half of the daily budget: how many turns this bot ADMITTED today, and how many of them
        -- are still running. The money and the tokens are NOT duplicated here -- they are read from core's
        -- usage_by_origin, the one place origin-attributed spend exists. A row is created by the first
        -- admission of the day and removed with the bot.
        CREATE TABLE IF NOT EXISTS p_chatbot_budget_days (
          chatbot_user_id INTEGER NOT NULL,
          day TEXT NOT NULL,
          admitted_turns INTEGER NOT NULL DEFAULT 0,
          in_flight INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (chatbot_user_id, day)
        );

        -- One conversation per (chatbot, visitor), which is also the key of the core channel session. It
        -- exists for two reasons: retention needs a due date per conversation rather than per turn, and the
        -- cleaner needs the core session id to delete.
        --
        -- 'session_id' is NULL until a turn's relay has reported one. The plugin never derives or guesses the
        -- id: a conversation nothing has run in has no core transcript to delete, and inventing an id would
        -- mean deleting a session this plugin never saw.
        CREATE TABLE IF NOT EXISTS p_chatbot_conversations (
          id TEXT PRIMARY KEY,
          chatbot_user_id INTEGER NOT NULL,
          visitor_id TEXT NOT NULL,
          session_id TEXT,
          created_at TEXT NOT NULL,
          last_activity_at TEXT NOT NULL,
          delete_after TEXT NOT NULL,
          UNIQUE (chatbot_user_id, visitor_id)
        );
        CREATE INDEX IF NOT EXISTS p_chatbot_conversation_retention
          ON p_chatbot_conversations (delete_after, chatbot_user_id);

        -- The cleaner's other two due columns, each indexed by the column it is due on.
        CREATE INDEX IF NOT EXISTS p_chatbot_tokens_expiry ON p_chatbot_tokens (expires_at);
        CREATE INDEX IF NOT EXISTS p_chatbot_visitors_seen ON p_chatbot_visitors (last_seen_at);
      `);
        },
    },
    {
        /** Step 4: how the chatbot's panel looks. ONE nullable column, so a chatbot registered before this step
         *  keeps answering with the widget's built-in look until an administrator saves one — nothing already
         *  written is rewritten, and no row needs a backfill to be valid. */
        version: 4,
        up(db) {
            db.exec(`
        -- The appearance as JSON: the four colours, the corner radius, the panel size, the position, the
        -- greeting, the avatar and the quick buttons. Stored as one document rather than as eleven columns
        -- because it is read and written as a whole and never queried by field, and because the shape is
        -- validated at the boundary (parseAppearance) rather than by a CHECK constraint that would have to
        -- be rewritten for every added control.
        ALTER TABLE p_chatbot_bots ADD COLUMN appearance TEXT;
      `);
        },
    },
    {
        /** Step 5 removes both retired configuration paths and adds the one remaining page-action decision.
         *  Existing prompt text and per-path action rules are deliberately discarded. */
        version: 5,
        up(db) {
            db.exec(`
        DROP TABLE IF EXISTS p_chatbot_action_rules;
        ALTER TABLE p_chatbot_bots DROP COLUMN prompt;
        ALTER TABLE p_chatbot_bots ADD COLUMN may_submit_forms INTEGER NOT NULL DEFAULT 1
          CHECK (may_submit_forms IN (0, 1));
      `);
        },
    },
    {
        /** Step 6: tokens are informational, never an admission ceiling. Discard the retired setting. */
        version: 6,
        up(db) {
            db.exec('ALTER TABLE p_chatbot_bots DROP COLUMN daily_token_limit;');
        },
    },
    {
        version: 7,
        up(db) {
            db.exec(`CREATE TABLE p_chatbot_handoffs (
        code_hash TEXT PRIMARY KEY,
        action_id TEXT NOT NULL UNIQUE REFERENCES p_chatbot_actions(id) ON DELETE CASCADE,
        origin TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );`);
        },
    },
    {
        /** Step 8: the page a message was written on gets its own columns, and the message keeps only what the
         *  visitor wrote. Until now the widget composed both into one text, which every reader had to take apart
         *  again; this step takes the stored rows apart once, so nothing after it knows the old shape. A row
         *  that carried no page keeps both columns NULL, which is a turn that has no page to act on. */
        version: 8,
        up(db) {
            db.exec(`
        ALTER TABLE p_chatbot_turns ADD COLUMN page_url TEXT;
        ALTER TABLE p_chatbot_turns ADD COLUMN page_title TEXT;
      `);
            const update = db.prepare('UPDATE p_chatbot_turns SET message = ?, page_url = ?, page_title = ? WHERE turn_id = ?');
            const rows = db.prepare('SELECT turn_id, message FROM p_chatbot_turns').all();
            for (const row of rows) {
                const split = splitComposedMessage(row.message);
                if (split.message === row.message && split.page === null)
                    continue;
                update.run(split.message, split.page?.url ?? null, split.page?.title ?? null, row.turn_id);
            }
        },
    },
    {
        /** Step 9: the visitor's last network address, kept where the conversation lives so it is deleted by
         *  exactly the paths that delete the conversation (retention, an operator's erase, the account going
         *  away). One value per conversation, overwritten on each admitted message, never a history. A
         *  conversation written before this step has no address, and none is invented for it. */
        version: 9,
        up(db) {
            db.exec('ALTER TABLE p_chatbot_conversations ADD COLUMN last_ip TEXT;');
        },
    },
    {
        /** Step 10: one visitor rating for each finished answer, removed with its turn. */
        version: 10,
        up(db) {
            db.exec(`CREATE TABLE p_chatbot_feedback (
        turn_id TEXT PRIMARY KEY,
        chatbot_user_id INTEGER NOT NULL,
        visitor_id TEXT NOT NULL,
        rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
        comment TEXT CHECK (comment IS NULL OR length(comment) <= 500),
        updated_at TEXT NOT NULL
      );
      CREATE INDEX p_chatbot_feedback_register ON p_chatbot_feedback (chatbot_user_id, rating, updated_at DESC);`);
        },
    },
    {
        /** Step 11: remove unused and duplicated columns without disturbing live rows. */
        version: 11,
        up(db) {
            db.exec(`
        ALTER TABLE p_chatbot_actions DROP COLUMN snapshot_id;
        ALTER TABLE p_chatbot_actions DROP COLUMN target_id;
        ALTER TABLE p_chatbot_bots DROP COLUMN customer_user_id;
        ALTER TABLE p_chatbot_budget_days DROP COLUMN in_flight;
      `);
        },
    },
    {
        version: 12,
        up(db) {
            db.exec(`CREATE TABLE p_chatbot_upload_receipts (
        id TEXT PRIMARY KEY,
        chatbot_user_id INTEGER NOT NULL,
        visitor_id TEXT NOT NULL,
        client_turn_id TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        turn_id TEXT UNIQUE,
        UNIQUE (chatbot_user_id, visitor_id, client_turn_id)
      );
      CREATE INDEX p_chatbot_upload_pending ON p_chatbot_upload_receipts (expires_at) WHERE turn_id IS NULL;`);
        },
    },
    {
        /** Step 13 permits a reserved row before the Project write; every pre-existing row has a receipt. */
        version: 13,
        up(db) {
            db.exec(`CREATE TABLE p_chatbot_upload_receipts_new (
        id TEXT PRIMARY KEY,
        chatbot_user_id INTEGER NOT NULL,
        visitor_id TEXT NOT NULL,
        client_turn_id TEXT NOT NULL,
        receipt_json TEXT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        turn_id TEXT UNIQUE,
        UNIQUE (chatbot_user_id, visitor_id, client_turn_id),
        CHECK (turn_id IS NULL OR receipt_json IS NOT NULL)
      );
      INSERT INTO p_chatbot_upload_receipts_new
        (id, chatbot_user_id, visitor_id, client_turn_id, receipt_json, name, created_at, expires_at, turn_id)
        SELECT id, chatbot_user_id, visitor_id, client_turn_id, receipt_json, name, created_at, expires_at, turn_id
        FROM p_chatbot_upload_receipts;
      DROP TABLE p_chatbot_upload_receipts;
      ALTER TABLE p_chatbot_upload_receipts_new RENAME TO p_chatbot_upload_receipts;
      CREATE INDEX p_chatbot_upload_pending ON p_chatbot_upload_receipts (expires_at) WHERE turn_id IS NULL;`);
        },
    },
];
/** The message as the widget composed it before step 8: an optional label, the visitor's words, and a
 *  labelled JSON object with the page's address and title after the LAST marker (JSON text carries no raw
 *  newline, so a marker the visitor typed can only come before it). A tail that is not such an object was
 *  not written by the widget, and the text is then kept whole rather than guessed at. */
function splitComposedMessage(composed) {
    const label = 'Visitor message:\n';
    const marker = '\n\nUntrusted page address and title:\n';
    const text = composed.startsWith(label) ? composed.slice(label.length) : composed;
    const at = text.lastIndexOf(marker);
    if (at === -1)
        return { message: text, page: null };
    let parsed;
    try {
        parsed = JSON.parse(text.slice(at + marker.length));
    }
    catch {
        return { message: text, page: null };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return { message: text, page: null };
    const { url, title } = parsed;
    return {
        message: text.slice(0, at),
        page: typeof url === 'string' ? { url, title: typeof title === 'string' ? title : '' } : null,
    };
}
/** Create the plugin's tables. A no-op outside the daemon process (the host's handle reports that itself). */
export function migrate(db) {
    db.migrate(MIGRATIONS.map((step) => ({ version: step.version, up: (handle) => step.up(handle) })));
}
