// @vitest-environment node
/** Adopted from the Elowen package: tests/plugins/work/stores.test.ts, tests/plugins/work/planJobStore.test.ts,
 *  tests/plugins/work/taskSnapshot.test.ts. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { openDb } from 'elowen/dist/store/db.js';
import type { Db } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { projectHead, projectRangeDiff } from 'elowen/dist/integrations/projectFiles.js';
import { WORK_MIGRATIONS } from '../plugins/work/dist/store/migrations.js';
import { TaskStore } from '../plugins/work/dist/store/taskStore.js';
import { Readiness } from '../plugins/work/dist/store/readiness.js';
import { TaskUsageStore } from '../plugins/work/dist/store/taskUsageStore.js';
import type { WorkDb } from '../plugins/work/dist/store/db.js';
import { PlanJobStore } from '../plugins/work/dist/api/planJobStore.js';
import { snapshotTaskChanges } from '../plugins/work/dist/api/taskSnapshot.js';
import type { SnapshotDeps } from '../plugins/work/dist/api/taskSnapshot.js';
import { openWorkDb } from './helpers/pluginTablesDb.js';

// ---- from tests/plugins/work/stores.test.ts ----

/** A database as the work plugin sees it: the shared main database through ctx.db(). Core's schema no
 *  longer carries the task tables, so a handle is BARE until the plugin migrates it — pass `migrated`
 *  for the shape a loaded plugin works on. */
function pluginDb(migrated = false) {
  const pdb = makePluginDb(openDb(':memory:'), 'work', { canMigrate: true });
  if (migrated) pdb.migrate(WORK_MIGRATIONS);
  return pdb;
}

/** The same adaptation the plugin entry makes (plugin handle → the stores' better-sqlite3 idiom). */
const storeDb = (pdb: ReturnType<typeof pluginDb>): WorkDb =>
  ({ prepare: (sql) => pdb.prepare(sql), transaction: <T>(fn: () => T) => () => pdb.transaction(fn) });

describe('work plugin store layer (task domain extraction)', () => {
  // Ownership is only real if the plugin PRODUCES its tables — which it now must, core having stopped
  // shipping the DDL. (That the produced shape matches core's to the column is tests/store/taskSchemaParity.)
  it('migration v1 is self-sufficient: it creates the grandfathered tables core no longer ships', () => {
    const pdb = pluginDb();
    pdb.migrate(WORK_MIGRATIONS);
    expect(pdb.appliedVersion()).toBe(2);
    const names = pdb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tasks','task_deps','task_usage') ORDER BY name").all() as { name: string }[];
    expect(names.map((r) => r.name)).toEqual(['task_deps', 'task_usage', 'tasks']);
    const indexes = pdb.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_task%' ORDER BY name").all() as { name: string }[];
    expect(indexes.map((r) => r.name)).toEqual(['idx_task_usage_project', 'idx_tasks_parent', 'idx_tasks_project_status']);
  });

  // The columns that never existed in core's CREATE (only as additive migrations). A fresh install must
  // get the FULL shape from v1 — otherwise the first task snapshot writes into a column that isn't there.
  it('the created table carries every column the domain writes, not just schema.sql\'s', () => {
    const pdb = pluginDb();
    pdb.migrate(WORK_MIGRATIONS);
    const cols = (pdb.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((c) => c.name);
    for (const c of ['description', 'scheduled_at', 'autostart', 'result_summary', 'outcome', 'closed_at', 'created_by', 'changed_files', 'base_sha', 'head_sha', 'resume_note']) {
      expect(cols).toContain(c);
    }
    const usage = (pdb.prepare('PRAGMA table_info(task_usage)').all() as { name: string }[]).map((c) => c.name);
    for (const c of ['reasoning', 'cost_source', 'currency', 'raw_usage_metadata']) expect(usage).toContain(c);
    // …and the store really writes them, on the tables the migration made.
    const store = new TaskStore(storeDb(pdb));
    const t = store.create({ id: 'w-1', project_id: 1, title: 'Task', description: 'body' });
    store.saveChangedFiles(t.id, [{ path: 'a.ts', added: 2, deleted: 1 }], 'abc123', 'def456');
    store.setResumeNote(t.id, 'pick it back up');
    const back = store.get('w-1')!;
    expect(back.changed_files).toEqual([{ path: 'a.ts', added: 2, deleted: 1 }]);
    expect(back.resume_note).toBe('pick it back up');
  });

  // The upgrade path of a real production database: the tables are already there, full of live rows.
  // Adoption must not move, rename or copy a single one. (The other half of that promise — that the
  // tables an OLDER core created are adopted unchanged, shape included — is tests/store/taskSchemaParity.)
  it('adopting an existing install is a no-op: not one row moves, is duplicated or is lost', () => {
    const pdb = pluginDb(true);
    const store = new TaskStore(storeDb(pdb));
    const epic = store.create({ id: 'w-ep', project_id: 1, title: 'Epic', type: 'epic' });
    const phase = store.create({ id: 'w-ph', project_id: 1, title: 'Phase', parent_id: epic.id });
    store.addDep(phase.id, epic.id);
    new TaskUsageStore(storeDb(pdb)).record(phase.id, 1, 'claude', { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3, costUsd: null, currency: null, costSource: 'unavailable' });
    const counts = () => ['tasks', 'task_deps', 'task_usage'].map((t) => (pdb.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c);
    const before = counts();

    pdb.migrate(WORK_MIGRATIONS);
    expect(pdb.appliedVersion()).toBe(2);

    expect(counts()).toEqual(before);
    expect(store.get('w-ep')?.title).toBe('Epic');
    expect(store.depsFor('w-ph')).toEqual(['w-ep']);
    // Re-running (a restart, a disable→re-enable) applies nothing a second time.
    pdb.migrate(WORK_MIGRATIONS);
    expect(pdb.appliedVersion()).toBe(2);
    expect(counts()).toEqual(before);
  });

  // The stores run on the plugin's own database handle in production — a transaction there must really
  // be a transaction, or a half-written plan survives the failure that should have rolled it back.
  it('runs the domain over the plugin database handle, transactions included', () => {
    const pdb = pluginDb(true);
    const store = new TaskStore(storeDb(pdb));
    store.create({ id: 'w-a', project_id: 1, title: 'A' });
    expect(() => store.transaction(() => {
      store.create({ id: 'w-b', project_id: 1, title: 'B' });
      throw new Error('boom');
    })).toThrow('boom');
    expect(store.get('w-b')).toBeNull();
    expect(store.list()).toHaveLength(1);
    const readiness = new Readiness(storeDb(pdb));
    expect(readiness.ready(1).map((t) => t.id)).toEqual(['w-a']);
  });
});

// ---- from tests/plugins/work/planJobStore.test.ts ----

describe('PlanJobStore pruning (bounded memory)', () => {
  it('drops finished (done/failed) jobs older than the TTL, keeps in-flight ones', () => {
    let now = 0;
    const store = new PlanJobStore(() => now);

    // An old finished job.
    const a = store.create({ goal: 'a', projectId: 1, epicId: null, dryRun: false });
    store.setPhases(a.id, [{ title: 'P', type: 'task' }]); // → status 'done'

    // An old job still planning — must survive the prune.
    const b = store.create({ goal: 'b', projectId: 1, epicId: null, dryRun: false });

    // Advance past the TTL and create a new job to trigger prune().
    now = 11 * 60_000;
    const c = store.create({ goal: 'c', projectId: 1, epicId: null, dryRun: false });

    expect(store.get(a.id)).toBeNull();      // finished + expired → pruned
    expect(store.get(b.id)).not.toBeNull();  // still planning → kept
    expect(store.get(c.id)).not.toBeNull();  // fresh → kept
  });

  it('does not prune a recently-finished job', () => {
    let now = 0;
    const store = new PlanJobStore(() => now);
    const a = store.create({ goal: 'a', projectId: 1, epicId: null, dryRun: false });
    store.fail(a.id, 'boom');
    now = 60_000; // 1 min — under the 10 min TTL
    store.create({ goal: 'b', projectId: 1, epicId: null, dryRun: false });
    expect(store.get(a.id)).not.toBeNull();
  });
});

// ---- from tests/plugins/work/taskSnapshot.test.ts ----

describe('snapshotTaskChanges', () => {
  let db: Db;
  let tasks: TaskStore;
  let root: string;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=Test', ...args], { stdio: 'pipe' });
  const w = (rel: string, body: string) => { const p = join(root, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body); };
  const head = () => execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  // What the host injects at runtime: the daemon's own git reader plus the plugin logger. Real git, so
  // the snapshot is still proven end to end.
  const deps: SnapshotDeps = {
    git: { projectHead, projectRangeDiff },
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };

  beforeEach(() => {
    db = openWorkDb(':memory:');
    tasks = new TaskStore(db);
    root = mkdtempSync(join(tmpdir(), 'elowen-snap-'));
    git('init', '-q');
    w('a.md', 'one\n');
    git('add', '-A'); git('commit', '-q', '-m', 'init');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('freezes the files committed between baseline and HEAD', async () => {
    tasks.create({ id: 't1', project_id: 1, title: 'Phase' });
    tasks.markBase('t1', head());
    w('a.md', 'two\n'); w('b.ts', 'export const x = 1;\n');
    git('add', '-A'); git('commit', '-q', '-m', 'work');

    await snapshotTaskChanges(deps, tasks, 't1', root);

    const t = tasks.get('t1')!;
    const byPath = Object.fromEntries(t.changed_files.map((f) => [f.path, f]));
    expect(byPath['a.md']).toEqual({ path: 'a.md', added: 1, deleted: 1 });
    expect(byPath['b.ts']).toEqual({ path: 'b.ts', added: 1, deleted: 0 });
    expect(t.base_sha).toBeTruthy();
    expect(t.head_sha).toBe(head());
  });

  it('stores an empty list when the task committed nothing since baseline', async () => {
    tasks.create({ id: 't2', project_id: 1, title: 'Phase' });
    tasks.markBase('t2', head());
    await snapshotTaskChanges(deps, tasks, 't2', root);
    expect(tasks.get('t2')!.changed_files).toEqual([]);
  });

  it('no-ops (no snapshot) when the task has no baseline label', async () => {
    tasks.create({ id: 't3', project_id: 1, title: 'Manual' });
    w('a.md', 'changed\n'); git('add', '-A'); git('commit', '-q', '-m', 'x');
    await snapshotTaskChanges(deps, tasks, 't3', root);
    const t = tasks.get('t3')!;
    expect(t.changed_files).toEqual([]);
    expect(t.base_sha).toBeNull();
  });
});
