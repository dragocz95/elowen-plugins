// @vitest-environment node
/** Adopted from the Elowen package: the migration half of tests/store/agentsTablesTolerance.test.ts.
 *
 *  The daemon keeps the tolerance matrix — that its own destructive paths work with these tables present
 *  or absent. What lives here is this plugin's own migration ladder, which is the only thing that can
 *  say whether an ancient install upgrades in place. */
import { describe, it, expect } from 'vitest';
import { openDb } from 'elowen/dist/store/db.js';
import { AGENTS_MIGRATIONS } from '../plugins/agents/dist/store/migrations.js';

describe('agents plugin migration v2 (ancient DB safety net)', () => {
  it('adds the once-core columns to a pre-column era table shape', () => {
    const db = openDb(':memory:');
    // An ancient install: tables created by an old core WITHOUT the later column additions.
    db.exec(`
      CREATE TABLE missions (id TEXT PRIMARY KEY, epic_id TEXT NOT NULL, autonomy TEXT NOT NULL,
        max_sessions INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'active',
        started_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE mission_pr (mission_id TEXT PRIMARY KEY, branch TEXT NOT NULL, worktree TEXT NOT NULL,
        pr_number INTEGER, pr_url TEXT, pr_state TEXT, last_review_ts TEXT);
    `);
    // Applying the plugin migrations over it (v1 no-ops on the existing tables, v2 adds the columns).
    for (const step of AGENTS_MIGRATIONS) step.up(db);
    const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols('missions')).toEqual(expect.arrayContaining(['created_by', 'pilot_exec', 'overseer_exec']));
    expect(cols('mission_pr')).toEqual(expect.arrayContaining(['fix_rounds', 'last_feedback']));
  });
});
