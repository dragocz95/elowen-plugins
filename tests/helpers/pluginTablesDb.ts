import { openDb, type OpenDbOptions, type Db } from 'elowen/dist/store/db.js';
import { AGENTS_MIGRATIONS } from '../../plugins/agents/dist/store/migrations.js';
import { WORK_MIGRATIONS } from '../../plugins/work/dist/store/migrations.js';

/** Open a test database in the shape a STANDARD install has: the daemon's own schema plus the tables of
 *  every bundled domain plugin that ships enabled — agents (missions/mission_pr/agents/notes) and work
 *  (tasks/task_deps/task_usage). Neither set is in the daemon's schema.sql; each plugin applies its own
 *  DDL through ctx.db().migrate(), so a test that wires a whole daemon-shaped app opens its database here
 *  rather than re-deriving which plugin owns what.
 *
 *  Adopted from the Elowen package together with the plugin whose route test needs a real API server. The
 *  core schema comes from the published daemon, but the plugin DDL is read from THIS repo's own agents and
 *  work builds — they are the copy the marketplace installs, and the daemon package stops shipping them
 *  the moment it releases without them.
 *
 *  A test that specifically exercises ONE plugin's shape — or the absence of the other's — opens the
 *  narrower {@link openAgentsDb} / {@link openWorkDb} instead, or plain openDb for neither. */
export function openPluginTablesDb(path = ':memory:', opts: OpenDbOptions = {}): Db {
  const db = openDb(path, opts);
  for (const step of [...AGENTS_MIGRATIONS, ...WORK_MIGRATIONS]) step.up(db);
  return db;
}

/** Open a test database WITH the agents plugin's tables only. The daemon's schema.sql does not carry the
 *  missions/mission_pr/agents/notes DDL — it is plugin-owned, applied via ctx.db().migrate() — so a test
 *  that constructs the plugin's stores directly, or arranges rows in those tables, opens its db here.
 *  Tests exercising the plugin-DISABLED shape use plain openDb. */
export function openAgentsDb(path = ':memory:', opts: OpenDbOptions = {}): Db {
  const db = openDb(path, opts);
  for (const step of AGENTS_MIGRATIONS) step.up(db);
  return db;
}

/** Apply the work plugin's migrations to an already-open database — for a test that needs BOTH another
 *  plugin's tables and the task domain's (open through that plugin's helper, then pass the db here). */
export function applyWorkMigrations<T extends Db>(db: T): T {
  for (const step of WORK_MIGRATIONS) step.up(db);
  return db;
}

/** Open a test database WITH the work plugin's tables only — the tasks/task_deps/task_usage DDL the
 *  daemon's schema.sql likewise no longer carries. */
export function openWorkDb(path = ':memory:', opts: OpenDbOptions = {}): Db {
  return applyWorkMigrations(openDb(path, opts));
}
