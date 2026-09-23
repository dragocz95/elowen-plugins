import type { PluginDb, PluginDbHandle } from 'elowen/plugin-api';

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
    up(db: { exec(sql: string): void }): void {
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
    up(db: { exec(sql: string): void }): void {
      db.exec(`
        -- One row per action the SERVER approved for a turn. It is written BEFORE the page is told about
        -- it: an action a page performed is then always an action this plugin can explain, and a page that
        -- never answered is a row that expired rather than a gap.
        --
        -- No FOREIGN KEY is declared, here or above: the plugin deletes its own rows explicitly (see
        -- deleteBot) and the host's handle does not turn foreign-key enforcement on, so a declaration would
        -- be a comment pretending to be a constraint.
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
    up(db: { exec(sql: string): void }): void {
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
    up(db: { exec(sql: string): void }): void {
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
    up(db: { exec(sql: string): void }): void {
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
    up(db: { exec(sql: string): void }): void {
      db.exec('ALTER TABLE p_chatbot_bots DROP COLUMN daily_token_limit;');
    },
  },
  {
    version: 7,
    up(db: { exec(sql: string): void }): void {
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
    up(db: PluginDbHandle): void {
      db.exec(`
        ALTER TABLE p_chatbot_turns ADD COLUMN page_url TEXT;
        ALTER TABLE p_chatbot_turns ADD COLUMN page_title TEXT;
      `);
      const update = db.prepare('UPDATE p_chatbot_turns SET message = ?, page_url = ?, page_title = ? WHERE turn_id = ?');
      const rows = db.prepare('SELECT turn_id, message FROM p_chatbot_turns').all() as { turn_id: string; message: string }[];
      for (const row of rows) {
        const split = splitComposedMessage(row.message);
        if (split.message === row.message && split.page === null) continue;
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
    up(db: PluginDbHandle): void {
      db.exec('ALTER TABLE p_chatbot_conversations ADD COLUMN last_ip TEXT;');
    },
  },
  {
    /** Step 10: one visitor rating for each finished answer, removed with its turn. */
    version: 10,
    up(db: { exec(sql: string): void }): void {
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
];

/** The message as the widget composed it before step 8: an optional label, the visitor's words, and a
 *  labelled JSON object with the page's address and title after the LAST marker (JSON text carries no raw
 *  newline, so a marker the visitor typed can only come before it). A tail that is not such an object was
 *  not written by the widget, and the text is then kept whole rather than guessed at. */
function splitComposedMessage(composed: string): { message: string; page: { url: string; title: string } | null } {
  const label = 'Visitor message:\n';
  const marker = '\n\nUntrusted page address and title:\n';
  const text = composed.startsWith(label) ? composed.slice(label.length) : composed;
  const at = text.lastIndexOf(marker);
  if (at === -1) return { message: text, page: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(at + marker.length));
  } catch {
    return { message: text, page: null };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { message: text, page: null };
  const { url, title } = parsed as Record<string, unknown>;
  return {
    message: text.slice(0, at),
    page: typeof url === 'string' ? { url, title: typeof title === 'string' ? title : '' } : null,
  };
}

/** The numeric limits a chatbot carries. New rows receive the profile from `limits.ts`; nullable columns
 *  remain part of the schema for legacy and explicit draft states. `readBotLimits` in `./limits.js` turns a
 *  row into a usable set, or into nothing when a mandatory value is missing or invalid. */
export interface BotLimitColumns {
  sensitive_mode: number;
  rate_ip_per_minute: number | null;
  rate_chatbot_per_minute: number | null;
  rate_conversation_per_minute: number | null;
  daily_turn_limit: number | null;
  daily_cost_microusd: number | null;
  max_concurrent_turns: number | null;
  max_queue_depth: number | null;
  queue_timeout_seconds: number | null;
  max_actions_per_turn: number | null;
  retention_days: number | null;
}

export interface BotRow extends BotLimitColumns {
  chatbot_user_id: number;
  public_id: string;
  customer_user_id: number | null;
  display_name: string;
  status: 'draft' | 'enabled' | 'disabled';
  may_submit_forms: number;
  /** The stored appearance as JSON, or NULL for a chatbot nobody has configured yet. Parsed by
   *  `parseStoredAppearance`, never read as text by a caller: the shape and its bounds live in
   *  appearanceContract.ts and nowhere else. */
  appearance: string | null;
  created_at: string;
  updated_at: string;
}

export interface VisitorRow {
  visitor_id: string;
  chatbot_user_id: number;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export interface TokenRow {
  jti: string;
  chatbot_user_id: number;
  visitor_id: string;
  token_hash: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface TurnRow {
  turn_id: string;
  chatbot_user_id: number;
  visitor_id: string;
  client_turn_id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  /** Only what the visitor wrote. */
  message: string;
  /** The page the message was written on, as the widget reported it: `origin + pathname` and the title.
   *  Both NULL for a turn stored without one, and never one without the other. */
  page_url: string | null;
  page_title: string | null;
  core_session_id: string | null;
  error_code: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface FeedbackRow {
  turn_id: string;
  chatbot_user_id: number;
  visitor_id: string;
  rating: 'up' | 'down';
  comment: string | null;
  updated_at: string;
}

export interface TurnEventRow {
  turn_id: string;
  seq: number;
  type: string;
  data: string;
  created_at: string;
}

/** Where one approved action has got to. `pending` and `confirmation_required` are the two live states: the
 *  page has been asked and has not answered. `confirmed` is the visitor's own decision, recorded before their
 *  browser submits anything. The rest are terminal. The same list is the table's CHECK constraint, which is
 *  what actually refuses a value this plugin never writes. */
type ActionStatus = 'pending' | 'confirmation_required' | 'confirmed' | 'done' | 'error' | 'cancelled' | 'expired';

export interface ActionRow {
  id: string;
  turn_id: string;
  snapshot_id: string;
  action: string;
  target_id: string | null;
  request_json: string;
  status: ActionStatus;
  requires_confirmation: number;
  confirmation_nonce_hash: string | null;
  result_json: string | null;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
}

/** One fixed rate window, as the plugin reads it back. `scope_key` is what the window counts: an address
 *  (with the chatbot), the chatbot itself, or one conversation. */
export interface RateWindowRow {
  scope: string;
  scope_key: string;
  window_started_at: string;
  count: number;
  expires_at: string;
}

/** One bot's budget day. Money and tokens are deliberately absent: those are read from core. */
export interface BudgetDayRow {
  chatbot_user_id: number;
  day: string;
  admitted_turns: number;
  in_flight: number;
  updated_at: string;
}

/** One conversation: the visitor's own thread with one chatbot, and the due date its data is deleted at. */
export interface ConversationRow {
  id: string;
  chatbot_user_id: number;
  visitor_id: string;
  session_id: string | null;
  /** The address the host vouched for when this visitor's last message was admitted, or NULL for a
   *  conversation from before addresses were kept. */
  last_ip: string | null;
  created_at: string;
  last_activity_at: string;
  delete_after: string;
}


/** Create the plugin's tables. A no-op outside the daemon process (the host's handle reports that itself). */
export function migrate(db: PluginDb): void {
  db.migrate(MIGRATIONS.map((step) => ({ version: step.version, up: (handle) => step.up(handle) })));
}