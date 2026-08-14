import { openDb, type OpenDbOptions, type Db } from 'elowen/dist/store/db.js';
import { AGENTS_MIGRATIONS } from 'elowen/plugins/agents/dist/store/migrations.js';
import { WORK_MIGRATIONS } from 'elowen/plugins/work/dist/store/migrations.js';

/** Open a test database in the shape a STANDARD install has: the daemon's own schema plus the tables of
 *  every bundled domain plugin that ships enabled — agents (missions/mission_pr/agents/notes) and work
 *  (tasks/task_deps/task_usage). Neither set is in the daemon's schema.sql; each plugin applies its own
 *  DDL through ctx.db().migrate(), so a test that wires a whole daemon-shaped app opens its database here
 *  rather than re-deriving which plugin owns what.
 *
 *  Adopted from the Elowen package together with the plugin whose route test needs a real API server. It
 *  reads everything from the published package, so the shape it produces is the shape the released daemon
 *  actually creates. */
export function openPluginTablesDb(path = ':memory:', opts: OpenDbOptions = {}): Db {
  const db = openDb(path, opts);
  for (const step of [...AGENTS_MIGRATIONS, ...WORK_MIGRATIONS]) step.up(db);
  return db;
}
