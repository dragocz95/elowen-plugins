import type { PluginDb } from 'elowen/plugin-api';

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
    /** Step 2: the page actions a turn may take on a visitor's page, and the administrator's own rule over
     *  what may be done where. Two tables and no column on an existing one, so nothing already written is
     *  rewritten by this step. */
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

        -- What may be done where, per chatbot. A rule is the allowlist of the paths it names: an action a
        -- matching rule does not list is refused even when the element itself said it could do it. An origin
        -- with no rule at all is governed by the implicit policy its allowlist entry implies (see
        -- actionRules.ts), which is what lets a chatbot act usefully before its first rule is written.
        --
        -- Nothing writes this table yet: the administrator's editor for it is a later phase, and the tool
        -- reads it strictly — a table with no writer is a policy nobody has changed, not a policy that
        -- grants everything.
        CREATE TABLE IF NOT EXISTS p_chatbot_action_rules (
          id TEXT PRIMARY KEY,
          chatbot_user_id INTEGER NOT NULL,
          origin TEXT NOT NULL,
          path_prefix TEXT NOT NULL,
          action TEXT NOT NULL CHECK (
            action IN ('read', 'focus', 'click', 'fill', 'select', 'scroll', 'request_submit')
          ),
          requires_confirmation INTEGER NOT NULL DEFAULT 0
            CHECK (requires_confirmation IN (0, 1)),
          max_per_turn INTEGER NOT NULL CHECK (max_per_turn > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (chatbot_user_id, origin, path_prefix, action)
        );
      `);
    },
  },
  {
    /** Step 3: how the chatbot's panel looks. ONE nullable column, so a chatbot registered before this step
     *  keeps answering with the widget's built-in look until an administrator saves one — nothing already
     *  written is rewritten, and no row needs a backfill to be valid. */
    version: 3,
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
];

export interface BotRow {
  chatbot_user_id: number;
  public_id: string;
  customer_user_id: number | null;
  display_name: string;
  prompt: string;
  status: 'draft' | 'enabled' | 'disabled';
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
  message: string;
  core_session_id: string | null;
  error_code: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
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

/** One administrator rule: this action, on this origin and path prefix, needs this confirmation and may
 *  happen at most this often in a turn. */
export interface ActionRuleRow {
  id: string;
  chatbot_user_id: number;
  origin: string;
  path_prefix: string;
  action: string;
  requires_confirmation: number;
  max_per_turn: number;
  created_at: string;
  updated_at: string;
}

/** Create the plugin's tables. A no-op outside the daemon process (the host's handle reports that itself). */
export function migrate(db: PluginDb): void {
  db.migrate(MIGRATIONS.map((step) => ({ version: step.version, up: (handle) => step.up(handle) })));
}
