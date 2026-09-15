// @vitest-environment node
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { PluginDb } from 'elowen/dist/plugins/api.js';
import { openRunJournal } from '../plugins/cronjob/lib/runJournal.mjs';

function dbFixture(): { db: PluginDb; raw: Database.Database } {
  const raw = new Database(':memory:');
  raw.exec('CREATE TABLE plugin_migrations(version INTEGER PRIMARY KEY)');
  const handle = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => {
      const statement = raw.prepare(sql);
      return {
        run: (...params: unknown[]) => statement.run(...params),
        get: (...params: unknown[]) => statement.get(...params),
        all: (...params: unknown[]) => statement.all(...params),
      };
    },
    migrate: (steps: { version: number; up(db: PluginDb): void }[]) => {
      for (const step of steps) {
        if (raw.prepare('SELECT 1 FROM plugin_migrations WHERE version=?').get(step.version)) continue;
        raw.transaction(() => {
          step.up(handle as PluginDb);
          raw.prepare('INSERT INTO plugin_migrations(version) VALUES (?)').run(step.version);
        })();
      }
    },
    appliedVersion: () => 0,
    transaction: <T>(fn: () => T) => raw.transaction(fn)(),
  };
  return { db: handle as PluginDb, raw };
}

const BASE = Date.parse('2026-09-15T08:00:00Z');
const input = (patch: Record<string, unknown> = {}) => ({
  claimKey: 'job-1:2026-09-15T10:00',
  jobId: 'job-1',
  jobName: 'Morning report',
  ownerUserId: 7,
  lifecycle: 'recurring',
  schedule: 'daily 10:00',
  trigger: 'schedule',
  slotMs: BASE,
  localDate: '2026-09-15',
  localTime: '10:00',
  timezone: 'Europe/Prague',
  startedMs: BASE,
  ...patch,
});

describe('cron run journal', () => {
  it('claims once and transitions idempotently through waiting, running and success with the exact message reference', () => {
    const { db } = dbFixture();
    const journal = openRunJournal(db, { now: () => BASE });

    const first = journal.claim(input());
    const duplicate = journal.claim(input());
    expect(duplicate).toEqual({ ...first, created: false });
    expect(journal.get({ userId: 7, admin: false }, first.id)?.outcome).toBe('waiting');

    expect(journal.start(first.id, BASE + 1_000)).toBe(true);
    journal.note(first.id, {
      sessionId: 'brain-7-job-job-1',
      messageId: 'assistant-row-exact',
      model: 'openai/gpt-5',
      tokensTotal: 42,
      costUsd: 0.01,
      delivered: true,
    });
    expect(journal.close(first.id, {
      outcome: 'ok',
      preview: 'Complete result',
      finishedMs: BASE + 5_000,
    })).toBe(true);
    expect(journal.close(first.id, {
      outcome: 'error',
      errorMessage: 'duplicate terminal write',
      finishedMs: BASE + 6_000,
    })).toBe(false);

    expect(journal.get({ userId: 7, admin: false }, first.id)).toMatchObject({
      outcome: 'ok',
      durationMs: 4_000,
      preview: 'Complete result',
      sessionId: 'brain-7-job-job-1',
      messageId: 'assistant-row-exact',
      model: 'openai/gpt-5',
      tokensTotal: 42,
      delivered: true,
    });
  });

  it('records skipped and failed terminal rows without inventing a session', () => {
    const { db } = dbFixture();
    const journal = openRunJournal(db, { now: () => BASE });
    const skipped = journal.claim(input({ claimKey: 'skip', jobId: 'skip' }));
    journal.close(skipped.id, { outcome: 'skipped', skipReason: 'check_empty', finishedMs: BASE + 20 });
    const failed = journal.claim(input({ claimKey: 'failed', jobId: 'failed' }));
    journal.start(failed.id, BASE + 10);
    journal.close(failed.id, { outcome: 'error', errorMessage: 'relay unavailable', finishedMs: BASE + 30 });

    const skippedRow = journal.get({ userId: 7, admin: false }, skipped.id)!;
    expect(skippedRow).toMatchObject({ outcome: 'skipped', skipReason: 'check_empty' });
    expect(skippedRow).not.toHaveProperty('sessionId');
    expect(skippedRow).not.toHaveProperty('messageId');
    expect(journal.get({ userId: 7, admin: false }, failed.id)).toMatchObject({
      outcome: 'error', errorMessage: 'relay unavailable',
    });
  });

  it('reconciles only stranded non-terminal rows and never duplicates a terminal receipt', () => {
    const { db } = dbFixture();
    let now = BASE;
    const journal = openRunJournal(db, { now: () => now });
    const old = journal.claim(input({ claimKey: 'old', jobId: 'old' }));
    journal.start(old.id, BASE);
    now += 30_001;
    const fresh = journal.claim(input({ claimKey: 'fresh', jobId: 'fresh', startedMs: now }));
    journal.start(fresh.id, now);

    expect(journal.reconcile({ nowMs: now, tickMs: 30_000 })).toBe(1);
    expect(journal.get({ userId: 7, admin: false }, old.id)).toMatchObject({
      outcome: 'error', errorMessage: 'the daemon stopped before the run finished',
    });
    expect(journal.get({ userId: 7, admin: false }, fresh.id)?.outcome).toBe('running');
    expect(journal.claim(input({ claimKey: 'old', jobId: 'old' }))).toEqual({ id: old.id, created: false });
  });

  it('aggregates terminal detail transactionally before seven-day pruning and retains only ninety days of daily counts', () => {
    const { db, raw } = dbFixture();
    const journal = openRunJournal(db, { now: () => BASE });
    const oldMs = BASE - 8 * 86_400_000;
    for (const [suffix, outcome] of [['a', 'ok'], ['b', 'error'], ['c', 'skipped']] as const) {
      const row = journal.claim(input({
        claimKey: suffix,
        startedMs: oldMs,
        localDate: '2026-09-07',
        localTime: '10:00',
      }));
      journal.start(row.id, oldMs);
      journal.close(row.id, { outcome, finishedMs: oldMs + 500 });
    }

    journal.prune(BASE);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM p_cronjob_runs').get()).toEqual({ n: 0 });
    expect(raw.prepare('SELECT ok_count,error_count,skipped_count,total_count FROM p_cronjob_run_daily').get())
      .toEqual({ ok_count: 1, error_count: 1, skipped_count: 1, total_count: 3 });

    raw.prepare(`UPDATE p_cronjob_run_daily SET local_date='2026-06-01',last_started_ms=?`).run(BASE - 91 * 86_400_000);
    journal.prune(BASE);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM p_cronjob_run_daily').get()).toEqual({ n: 0 });
  });

  it('reapplies ACL in SQL, preserves deleted-job snapshots and paginates a two-minute load within fixed bounds', () => {
    const { db } = dbFixture();
    const journal = openRunJournal(db, { now: () => BASE });
    for (let i = 0; i < 720; i += 1) {
      const at = BASE + i * 120_000;
      const row = journal.claim(input({
        claimKey: `poll:${i}`,
        jobId: 'deleted-poll',
        jobName: 'Deleted poll snapshot',
        startedMs: at,
        localDate: '2026-09-15',
        localTime: `${String(Math.floor(i / 30)).padStart(2, '0')}:${String((i * 2) % 60).padStart(2, '0')}`,
      }));
      journal.start(row.id, at);
      journal.close(row.id, { outcome: 'ok', preview: `receipt ${i}`, finishedMs: at + 10 });
    }
    const foreign = journal.claim(input({
      claimKey: 'foreign',
      jobId: 'foreign',
      ownerUserId: 8,
    }));
    journal.close(foreign.id, { outcome: 'ok', finishedMs: BASE + 5 });

    const first = journal.list({ userId: 7, admin: true }, { date: '2026-09-15', limit: 50 });
    expect(first.runs).toHaveLength(50);
    expect(first.total).toBe(720);
    expect(first.nextCursor).toBeTruthy();
    expect(first.runs.every((row) => row.jobName === 'Deleted poll snapshot')).toBe(true);
    const second = journal.list({ userId: 7, admin: true }, {
      date: '2026-09-15', limit: 50, cursor: first.nextCursor,
    });
    expect(new Set([...first.runs, ...second.runs].map((row) => row.id)).size).toBe(100);
    expect(journal.get({ userId: 7, admin: true }, foreign.id)).toBeNull();
  });

  it('lets an admin see instance rows but never another account personal history, and removes account-owned lifecycle data', () => {
    const { db, raw } = dbFixture();
    const journal = openRunJournal(db, { now: () => BASE });
    for (const [claimKey, ownerUserId] of [['mine', 7], ['foreign', 8], ['instance', null]] as const) {
      const row = journal.claim(input({ claimKey, jobId: claimKey, ownerUserId }));
      journal.close(row.id, { outcome: 'ok', finishedMs: BASE + 1 });
    }
    expect(journal.list({ userId: 7, admin: true }, { limit: 100 }).runs.map((row) => row.jobId).sort())
      .toEqual(['instance', 'mine']);
    expect(journal.removeUser(7)).toBeGreaterThan(0);
    expect(raw.prepare('SELECT job_id FROM p_cronjob_runs ORDER BY job_id').all())
      .toEqual([{ job_id: 'foreign' }, { job_id: 'instance' }]);
  });
});
