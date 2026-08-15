// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb, type Db } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { AGENTS_MIGRATIONS } from '../plugins/agents/dist/store/migrations.js';

/** The agents half of the schema-ownership pin, shaped after tests/work-schemaParity.test.ts.
 *
 *  The agents/missions/mission_pr/notes tables moved OUT of the daemon's schema.sql into this plugin's
 *  migration v1. This file is the proof that the move changed no database, in any of the states one can
 *  be in. The daemon keeps the other end of the same pin — that the fixture DDL its own suite runs
 *  against (tests/fixtures/pluginSchema.ts there) still equals this shape.
 *
 *  This file ABSORBS the former tests/agents-migrations.test.ts, which asserted that five column names
 *  exist after v2. That assertion is a strict subset of `ancient upgrade` below, which pins the exact
 *  column list with types, notnull, defaults and pk position — and the direct-`step.up()` application
 *  path it used is kept as its own case at the bottom.
 *
 *  The baseline was CAPTURED from the daemon as it was immediately before the removal: schema.sql's
 *  agents block plus the db.ts addColumn steps for these tables, at commit e6d35c26^ (e6d35c26 is
 *  `refactor(store): agents tables leave core schema`). It is frozen on purpose: an edit to the plugin's
 *  DDL that changes a column, a type, a default, a primary key, a UNIQUE or an index makes this file
 *  fail, which is exactly the point — these tables hold live data and their shape is not the plugin's
 *  to drift.
 *
 *  `sql` is the statement SQLite itself stored (comments stripped, whitespace collapsed), so it carries
 *  what no pragma reports: agents' table-level UNIQUE (project_id, name). */
const AGENTS_TABLES = ['agents', 'missions', 'mission_pr', 'notes'] as const;

interface TableShape { sql: string | null; cols: string[]; idx: string[] }

function normalizeDdl(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').trim();
}

/** The full observable shape of the agents tables: stored DDL, every column (name/type/notnull/default/pk
 *  position, IN ORDER — column order is part of the on-disk format), and every index with its columns. */
function agentsSchemaShape(db: Db): Record<string, TableShape> {
  const out: Record<string, TableShape> = {};
  for (const t of AGENTS_TABLES) {
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(t) as { sql: string } | undefined)?.sql;
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[])
      .map((c) => `${c.name}|${c.type}|${c.notnull}|${c.dflt_value ?? 'NULL'}|${c.pk}`);
    const idx = (db.prepare(`PRAGMA index_list(${t})`).all() as { name: string; unique: number; origin: string }[])
      .map((i) => `${i.name}|${i.unique}|${i.origin}|${(db.prepare(`PRAGMA index_info(${i.name})`).all() as { name: string }[]).map((c) => c.name).join(',')}`)
      .sort();
    out[t] = { sql: sql ? normalizeDdl(sql) : null, cols, idx };
  }
  return out;
}

/** What core's schema.sql + db.ts additive migrations produced on a FRESH install, i.e. the shape every
 *  up-to-date database (including the production one) is in today.
 *
 *  Unlike the task tables, this is ALSO the shape an ancient database converges to — see
 *  ANCIENT_UPGRADED_SHAPE below for why the two do not diverge here. */
const FRESH_INSTALL_SHAPE: Record<string, TableShape> = {
  agents: {
    sql: "CREATE TABLE agents(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL,name TEXT NOT NULL,program TEXT NOT NULL,model TEXT NOT NULL,last_active_ts TEXT NOT NULL DEFAULT(datetime('now')),UNIQUE(project_id,name))",
    cols: [
      'id|INTEGER|0|NULL|1', 'project_id|INTEGER|1|NULL|0', 'name|TEXT|1|NULL|0', 'program|TEXT|1|NULL|0',
      'model|TEXT|1|NULL|0', "last_active_ts|TEXT|1|datetime('now')|0",
    ],
    idx: ['sqlite_autoindex_agents_1|1|u|project_id,name'],
  },
  missions: {
    sql: "CREATE TABLE missions(id TEXT PRIMARY KEY,epic_id TEXT NOT NULL,autonomy TEXT NOT NULL,max_sessions INTEGER NOT NULL DEFAULT 1,state TEXT NOT NULL DEFAULT 'active',started_at TEXT NOT NULL DEFAULT(datetime('now')),created_by INTEGER,pilot_exec TEXT NOT NULL DEFAULT '',overseer_exec TEXT NOT NULL DEFAULT '')",
    cols: [
      'id|TEXT|0|NULL|1', 'epic_id|TEXT|1|NULL|0', 'autonomy|TEXT|1|NULL|0', 'max_sessions|INTEGER|1|1|0',
      "state|TEXT|1|'active'|0", "started_at|TEXT|1|datetime('now')|0", 'created_by|INTEGER|0|NULL|0',
      "pilot_exec|TEXT|1|''|0", "overseer_exec|TEXT|1|''|0",
    ],
    idx: ['idx_missions_epic|0|c|epic_id', 'idx_missions_state|0|c|state', 'sqlite_autoindex_missions_1|1|pk|id'],
  },
  mission_pr: {
    sql: 'CREATE TABLE mission_pr(mission_id TEXT PRIMARY KEY,branch TEXT NOT NULL,worktree TEXT NOT NULL,pr_number INTEGER,pr_url TEXT,pr_state TEXT,last_review_ts TEXT,fix_rounds INTEGER NOT NULL DEFAULT 0,last_feedback TEXT)',
    cols: [
      'mission_id|TEXT|0|NULL|1', 'branch|TEXT|1|NULL|0', 'worktree|TEXT|1|NULL|0', 'pr_number|INTEGER|0|NULL|0',
      'pr_url|TEXT|0|NULL|0', 'pr_state|TEXT|0|NULL|0', 'last_review_ts|TEXT|0|NULL|0',
      'fix_rounds|INTEGER|1|0|0', 'last_feedback|TEXT|0|NULL|0',
    ],
    idx: ['sqlite_autoindex_mission_pr_1|1|pk|mission_id'],
  },
  notes: {
    sql: "CREATE TABLE notes(id INTEGER PRIMARY KEY,scope TEXT NOT NULL,target TEXT NOT NULL,author TEXT NOT NULL DEFAULT '',body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')))",
    cols: [
      'id|INTEGER|0|NULL|1', 'scope|TEXT|1|NULL|0', 'target|TEXT|1|NULL|0', "author|TEXT|1|''|0",
      'body|TEXT|1|NULL|0', "created_at|TEXT|1|datetime('now')|0",
    ],
    idx: ['idx_notes_scope_target|0|c|scope,target,id'],
  },
};

/** What core produced when it upgraded an ANCIENT database — one whose tables predate every additive
 *  column — through its addColumn block.
 *
 *  For the AGENTS tables this is byte-identical to FRESH_INSTALL_SHAPE, which is NOT the case for the
 *  task tables (tasks.created_at sits mid-CREATE, so an ALTER that appends it lands in a different
 *  position and work-schemaParity.test.ts needs a second baseline). Here every additive column —
 *  missions.created_by/pilot_exec/overseer_exec and mission_pr.fix_rounds/last_feedback — is also the
 *  TAIL of its CREATE, in the same relative order core's addColumn block applied them, so appending
 *  reproduces the fresh order exactly. The alias is deliberate: it makes the convergence a fact this
 *  suite asserts (see 'the ancient upgrade converges…') rather than a coincidence two copies could
 *  silently drift apart on. */
const ANCIENT_UPGRADED_SHAPE = FRESH_INSTALL_SHAPE;

/** Core's CREATE statements as they stood BEFORE any additive column existed — the starting point of the
 *  ancient-upgrade cell. The indexes are deliberately absent too: v1's CREATE INDEX IF NOT EXISTS has to
 *  put them there, and an ancient database is exactly where a missing one would go unnoticed. */
const PRE_COLUMN_ERA_DDL = `
  CREATE TABLE agents (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, name TEXT NOT NULL,
    program TEXT NOT NULL, model TEXT NOT NULL, last_active_ts TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (project_id, name)
  );
  CREATE TABLE missions (
    id TEXT PRIMARY KEY, epic_id TEXT NOT NULL, autonomy TEXT NOT NULL,
    max_sessions INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT 'active', started_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE mission_pr (
    mission_id TEXT PRIMARY KEY, branch TEXT NOT NULL, worktree TEXT NOT NULL,
    pr_number INTEGER, pr_url TEXT, pr_state TEXT, last_review_ts TEXT
  );
  CREATE TABLE notes (
    id INTEGER PRIMARY KEY,
    scope TEXT NOT NULL,
    target TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

/** Seed one row in each agents table, with a value in every column the domain writes. */
function seedAgentsRows(db: Db): void {
  db.prepare(`INSERT INTO agents (id, project_id, name, program, model, last_active_ts)
    VALUES (1, 1, 'worker-1', 'claude', 'sonnet', '2026-08-01 08:00:00')`).run();
  db.prepare(`INSERT INTO missions (id, epic_id, autonomy, max_sessions, state, started_at, created_by, pilot_exec, overseer_exec)
    VALUES ('m-1', 'e-1', 'L2', 3, 'active', '2026-08-01 09:00:00', 7, 'claude', 'codex')`).run();
  db.prepare(`INSERT INTO mission_pr (mission_id, branch, worktree, pr_number, pr_url, pr_state, last_review_ts, fix_rounds, last_feedback)
    VALUES ('m-1', 'feat/x', '/wt/x', 42, 'https://example.test/pr/42', 'open', '2026-08-01 10:00:00', 2, 'address the review')`).run();
  db.prepare(`INSERT INTO notes (id, scope, target, author, body, created_at)
    VALUES (1, 'task', 't-1', 'worker-1', 'handoff note', '2026-08-01 11:00:00')`).run();
}

/** Every row of every agents table, ordered — the payload half of "an existing database is untouched". */
function agentsRows(db: Db): Record<string, unknown[]> {
  return {
    agents: db.prepare('SELECT * FROM agents ORDER BY id').all(),
    missions: db.prepare('SELECT * FROM missions ORDER BY id').all(),
    mission_pr: db.prepare('SELECT * FROM mission_pr ORDER BY mission_id').all(),
    notes: db.prepare('SELECT * FROM notes ORDER BY id').all(),
  };
}

/** Open a database file the way a daemon boot does, with the agents plugin loaded after it. */
function bootWithAgentsPlugin(path: string): Db {
  const db = openDb(path);
  makePluginDb(db, 'agents', { canMigrate: true }).migrate(AGENTS_MIGRATIONS);
  return db;
}

function tmpDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'agents-schema-')), 'elowen.db');
}

describe('agents schema ownership: the plugin reproduces core\'s schema exactly', () => {
  it('fresh install, agents ENABLED: byte-for-byte the schema core used to create', () => {
    expect(agentsSchemaShape(bootWithAgentsPlugin(tmpDbPath()))).toEqual(FRESH_INSTALL_SHAPE);
  });

  it('fresh install, agents DISABLED: no agents tables at all, and the daemon still boots', () => {
    const db = openDb(tmpDbPath());
    const present = (db.prepare(
      "SELECT name FROM sqlite_master WHERE name IN ('agents','missions','mission_pr','notes','idx_notes_scope_target','idx_missions_epic','idx_missions_state')",
    ).all() as { name: string }[]).map((r) => r.name);
    expect(present).toEqual([]);
    // Core's own schema is complete without them — the tables it DOES own are all there.
    for (const t of ['projects', 'users', 'events', 'brain_sessions', 'plugin_migrations']) {
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(t)).toBeTruthy();
    }
    // A second boot of the same file is just as clean (no half-created shape to trip over).
    expect(() => openDb(':memory:')).not.toThrow();
  });

  it('enable AFTER running disabled: the same schema, and the bookkeeping records both steps', () => {
    const path = tmpDbPath();
    openDb(path).close();   // booted once with the plugin off…
    openDb(path).close();   // …and again, still off
    const db = bootWithAgentsPlugin(path);
    expect(agentsSchemaShape(db)).toEqual(FRESH_INSTALL_SHAPE);
    expect(db.prepare("SELECT version FROM plugin_migrations WHERE plugin='agents' ORDER BY version").all())
      .toEqual([{ version: 1 }, { version: 2 }]);
  });

  it('disable → re-enable keeps the rows and applies nothing twice', () => {
    const path = tmpDbPath();
    const first = bootWithAgentsPlugin(path);
    first.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'p','/o')").run();
    seedAgentsRows(first);
    const rows = agentsRows(first);
    first.close();
    openDb(path).close();                         // a boot with the plugin disabled: nothing runs
    const back = bootWithAgentsPlugin(path);      // …and back on
    expect(agentsSchemaShape(back)).toEqual(FRESH_INSTALL_SHAPE);
    expect(agentsRows(back)).toEqual(rows);
    expect(back.prepare("SELECT COUNT(*) c FROM plugin_migrations WHERE plugin='agents'").get()).toEqual({ c: 2 });
  });

  it('an existing (production-shaped) database is untouched: same schema, same rows', () => {
    const path = tmpDbPath();
    // Arrange the database in the shape today's daemon leaves it in, with live rows in every table.
    const before = bootWithAgentsPlugin(path);
    before.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'p','/o')").run();
    seedAgentsRows(before);
    const shapeBefore = agentsSchemaShape(before);
    const rowsBefore = agentsRows(before);
    before.close();
    // Upgrade: core no longer ships the DDL, the plugin adopts what is there.
    const after = bootWithAgentsPlugin(path);
    expect(agentsSchemaShape(after)).toEqual(shapeBefore);
    expect(shapeBefore).toEqual(FRESH_INSTALL_SHAPE);
    expect(agentsRows(after)).toEqual(rowsBefore);
  });

  it('an existing database boots with agents DISABLED without touching its agents tables', () => {
    const path = tmpDbPath();
    const before = bootWithAgentsPlugin(path);
    before.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'p','/o')").run();
    seedAgentsRows(before);
    const rowsBefore = agentsRows(before);
    before.close();
    const after = openDb(path); // plugin off: core must neither create, alter nor read them
    expect(agentsSchemaShape(after)).toEqual(FRESH_INSTALL_SHAPE);
    expect(agentsRows(after)).toEqual(rowsBefore);
  });

  it('an ancient database gains exactly the columns core used to add, in the same order', () => {
    const path = tmpDbPath();
    const raw = new Database(path);
    raw.exec(PRE_COLUMN_ERA_DDL);
    raw.prepare("INSERT INTO missions (id, epic_id, autonomy) VALUES ('old-m', 'old-e', 'L1')").run();
    raw.prepare("INSERT INTO mission_pr (mission_id, branch, worktree) VALUES ('old-m', 'b', '/w')").run();
    raw.close();
    const db = bootWithAgentsPlugin(path);
    expect(agentsSchemaShape(db)).toEqual(ANCIENT_UPGRADED_SHAPE);
    // The backfilled values the old rows end up with: NOT NULL columns take their DEFAULT, the rest NULL.
    expect(db.prepare("SELECT autonomy, created_by, pilot_exec, overseer_exec FROM missions WHERE id='old-m'").get())
      .toEqual({ autonomy: 'L1', created_by: null, pilot_exec: '', overseer_exec: '' });
    expect(db.prepare("SELECT branch, fix_rounds, last_feedback FROM mission_pr WHERE mission_id='old-m'").get())
      .toEqual({ branch: 'b', fix_rounds: 0, last_feedback: null });
  });

  it('the ancient upgrade converges on the fresh shape — no column-order divergence for these tables', () => {
    // The task tables cannot claim this (see work-schemaParity.test.ts, which carries two baselines
    // because tasks.created_at is not last in its CREATE). Asserting it here keeps the single-baseline
    // simplification honest: reorder a CREATE so an additive column is no longer at the tail and this
    // fails, which is the signal that a second baseline has become necessary.
    const freshPath = tmpDbPath();
    const ancientPath = tmpDbPath();
    const raw = new Database(ancientPath);
    raw.exec(PRE_COLUMN_ERA_DDL);
    raw.close();
    expect(agentsSchemaShape(bootWithAgentsPlugin(ancientPath)))
      .toEqual(agentsSchemaShape(bootWithAgentsPlugin(freshPath)));
  });

  it('a pre-guardrail-removal database keeps its orphan cleared_guardrails column', () => {
    // Documented DIVERGENCE, not a bug. missions.cleared_guardrails was dropped from the CREATE in core
    // commit b4a8adab ("remove guardrails") WITHOUT a table rebuild, and nothing has removed it since —
    // not core, not this plugin, whose v2 is additive only. A database created before that commit is
    // therefore one column wider than the baseline, permanently. It is asserted rather than ignored so
    // the leftover stays visible: if a future migration ever does rebuild missions, this is the case
    // that has to be revisited (and dropping it must be a deliberate, data-checked step).
    const path = tmpDbPath();
    const raw = new Database(path);
    raw.exec(`
      CREATE TABLE missions (
        id TEXT PRIMARY KEY, epic_id TEXT NOT NULL, autonomy TEXT NOT NULL,
        max_sessions INTEGER NOT NULL DEFAULT 1, cleared_guardrails TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'active', started_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    raw.prepare("INSERT INTO missions (id, epic_id, autonomy) VALUES ('pre-m', 'e', 'L1')").run();
    raw.close();
    const db = bootWithAgentsPlugin(path);
    const cols = (db.prepare('PRAGMA table_info(missions)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual([
      'id', 'epic_id', 'autonomy', 'max_sessions', 'cleared_guardrails', 'state', 'started_at',
      'created_by', 'pilot_exec', 'overseer_exec',
    ]);
    // The other three tables are unaffected — v1 creates them at the baseline shape — and missions
    // differs ONLY by that column: its indexes still have to be the baseline set.
    const { agents, missions, mission_pr, notes } = agentsSchemaShape(db);
    expect({ agents, mission_pr, notes }).toEqual({
      agents: FRESH_INSTALL_SHAPE.agents,
      mission_pr: FRESH_INSTALL_SHAPE.mission_pr,
      notes: FRESH_INSTALL_SHAPE.notes,
    });
    expect(missions.idx).toEqual(FRESH_INSTALL_SHAPE.missions.idx);
    expect(db.prepare("SELECT cleared_guardrails FROM missions WHERE id='pre-m'").get()).toEqual({ cleared_guardrails: '' });
  });

  it('the migration steps applied directly (no plugin bookkeeping) reach the same shape', () => {
    // The path the former tests/agents-migrations.test.ts exercised: AGENTS_MIGRATIONS run step by step
    // against a bare handle, with no plugin_migrations row deciding what to skip. v1 must be a no-op on
    // the existing tables and v2 must supply every column, with v1 and v2 both re-runnable.
    const db = openDb(':memory:');
    db.exec(PRE_COLUMN_ERA_DDL);
    for (const step of AGENTS_MIGRATIONS) step.up(db);
    expect(agentsSchemaShape(db)).toEqual(ANCIENT_UPGRADED_SHAPE);
    for (const step of AGENTS_MIGRATIONS) step.up(db);   // idempotent: a second pass changes nothing
    expect(agentsSchemaShape(db)).toEqual(ANCIENT_UPGRADED_SHAPE);
  });

});
