// @vitest-environment node
/**
 * WHO may settle a run row. `p_cronjob_runs` lives in the daemon's database, and the plugin is loaded by
 * every process that boots the core — including a forked sub-agent runner, which shares that database and
 * those rows. Registering there used to reconcile immediately, so a runner declared every in-flight run
 * interrupted: a job that was running normally was recorded as `error`, "the daemon stopped before the run
 * finished", while the daemon was still writing its turns. Nothing in the history distinguishes that from a
 * real failure, which is the whole cost.
 *
 * Both directions are pinned here, because a gate that simply stopped reconciling would make the reported
 * failure permanent instead: a runner registration leaves the row alone, and an authoritative one still
 * closes an interrupted run exactly as it did before.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from '../plugins/cronjob/index.mjs';
import { openRunJournal } from '../plugins/cronjob/lib/runJournal.mjs';
import { pluginDbFor } from './helpers/pluginDb.js';

const log = { info() {}, warn() {}, error() {} };

/** A run claimed ten minutes ago and never finished: what the daemon has on disk while a job is running,
 *  and only the pre-cutoff age matters to a reconcile that uses a 30 s tick. */
const STARTED = Date.now() - 10 * 60_000;
const seedRunningRun = (db: ReturnType<ReturnType<typeof pluginDbFor>>) => {
  const journal = openRunJournal(db, { now: () => STARTED });
  const run = journal.claim({
    claimKey: 'job-1:2026-09-22T22:36',
    jobId: 'job-1',
    jobName: 'Nightly digest',
    ownerUserId: 1,
    lifecycle: 'recurring',
    schedule: 'daily 22:36',
    trigger: 'schedule',
    slotMs: STARTED,
    localDate: '2026-09-22',
    localTime: '22:36',
    timezone: 'Europe/Prague',
    startedMs: STARTED,
  });
  journal.start(run.id, STARTED + 1_000);
  return { journal, id: run.id };
};

/** The host surface `register()` needs, as the sibling suites build it, plus the ONE flag under test: the
 *  same plugin code is registered by the daemon and by a forked runner, so the flag is what distinguishes
 *  them here exactly as `ctx.authoritativeProcess` does in production. */
function registerCronjob(dataRoot: string, db: unknown, authoritativeProcess: boolean) {
  mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
  const session = { identity: null, sessionId: undefined, deliveryTarget: undefined, admin: false };
  register({
    authoritativeProcess,
    db: () => db,
    logger: log,
    config: {},
    dataDir: () => join(dataRoot, 'cronjob'),
    notify: async () => {},
    timezone: () => 'Europe/Prague',
    currentIdentity: () => session.identity,
    currentSessionId: () => session.sessionId,
    currentAccess: () => ({ projectIds: [], admin: session.admin, owner: false, permissionBoundary: null }),
    currentDeliveryTarget: () => session.deliveryTarget,
    isAdminSession: () => session.admin,
    host: { stores: () => ({
      usersRead: { isAdmin: () => true, mayUsePlugin: () => true, list: () => [{ id: 1 }] },
      conversationsRead: {
        list: () => [],
        resolve: ({ sessionId }: { sessionId: string }) => ({
          id: sessionId, key: `ns-${sessionId}`, title: 'Chat', ownerUserId: 1,
          platform: null, direct: false, updatedAt: '2026-07-01T00:00:00.000Z',
        }),
        resolveKey: (key: string) => ({
          id: key.replace(/^ns-/, ''), key, title: 'Chat', ownerUserId: 1,
          platform: null, direct: false, updatedAt: '2026-07-01T00:00:00.000Z',
        }),
      },
    }) },
    registerTool() {},
    registerPlatform() {},
    registerApiRoute() {},
    registerUserRemoved() {},
    registerBootReconcile() {},
    registerControl() {},
    registerSkill() {},
  } as never);
}

const withDataRoot = <T>(key: string, fn: (dataRoot: string) => T): T => {
  const dataRoot = mkdtempSync(join(tmpdir(), `elowen-${key}-`));
  try { return fn(dataRoot); } finally { rmSync(dataRoot, { recursive: true, force: true }); }
};

describe('a forked runner must not settle the daemon’s run rows', () => {
  it('leaves an in-flight run exactly as the daemon left it', () => {
    withDataRoot('cron-run-runner', (dataRoot) => {
      const db = pluginDbFor('cron-run-runner')('cronjob');
      const { journal, id } = seedRunningRun(db);
      registerCronjob(dataRoot, db, false);

      const row = journal.get({ userId: 1, admin: true }, id);
      expect(row?.outcome).toBe('running');
      expect(row?.finishedMs ?? null).toBeNull();
      // The lie, stated as an absence: nothing wrote the interruption message into a live run.
      expect(row?.errorMessage ?? null).toBeNull();
    });
  });

  it('still closes an interrupted run when the daemon itself boots', () => {
    withDataRoot('cron-run-daemon', (dataRoot) => {
      const db = pluginDbFor('cron-run-daemon')('cronjob');
      const { journal, id } = seedRunningRun(db);
      registerCronjob(dataRoot, db, true);

      expect(journal.get({ userId: 1, admin: true }, id)).toMatchObject({
        outcome: 'error',
        errorMessage: 'the daemon stopped before the run finished',
      });
    });
  });
});
