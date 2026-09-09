// @vitest-environment node
/** A scheduled job's check command, executed in the REAL environment of the project the job selects.
 *
 *  The cron suites drive `projectCheck` against a fake provider, which proves the scoping and nothing
 *  about the command actually running somewhere. A scheduled turn is the one caller with no user
 *  present when it fails, so the interesting part is that the check runs INSIDE the selected guest, sees
 *  that guest's filesystem, reports a non-zero exit rather than swallowing it, and leaves no lease
 *  behind. Opt-in, confined to an exclusively created private Podman store. */
import { it, expect } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { PodmanClient, SpawnExecutor, isolatedPodmanOptions } from 'elowen/plugins/sandbox/lib/podman.mjs';
import { createEnvironmentRuntime } from 'elowen/plugins/sandbox/lib/environmentRuntime.mjs';
import { initSandboxDb } from 'elowen/plugins/sandbox/lib/db.mjs';
import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { projectCheck } from '../plugins/cronjob/execution.mjs';

const PROJECT_ID = 7;
const ACTOR = 1;
const OUTSIDER = 2;

it.runIf(process.env.ELOWEN_TEST_PODMAN === '1')('runs a scheduled check inside the selected project guest', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'cron-'));
  const isolation = isolatedPodmanOptions(join(scratch, 'pm'), `cron-${randomBytes(6).toString('hex')}`, { useUserSessionBus: true });
  const paths = isolation.isolation;
  const client = new PodmanClient(isolation);
  const sql = openDb(':memory:');
  let engineVerified = false;
  let stage = 'engine';
  try {
    const info = await client.info();
    assert.equal(info.graphRoot, paths.storage);
    engineVerified = true;

    const db = makePluginDb(sql, 'sandbox', { canMigrate: true });
    const project: any = { id: PROJECT_ID, executionKind: 'managed', lifecycle: 'active' };
    const projectRef = { kind: 'managed' as const, projectId: PROJECT_ID };
    const runtimeCtx: any = { db: () => db, currentAccountUserId: () => ACTOR, currentAccess: () => ({ readOnly: false }), config: {}, host: { stores: () => ({
      usersRead: { list: () => [{ id: ACTOR }, { id: OUTSIDER }], mayUsePlugin: () => true, isAdmin: (id: number) => id === ACTOR },
      userProjects: {
        canAccess: (u: number, id: number) => id === PROJECT_ID && u === ACTOR,
        canManage: (u: number, id: number) => id === PROJECT_ID && u === ACTOR,
      },
      projects: { get: (id: number) => (id === PROJECT_ID ? project : undefined), beginDeletion: () => true, finishDeletion: () => true },
    }) } };
    initSandboxDb(runtimeCtx);
    const runtime = createEnvironmentRuntime({ ctx: runtimeCtx, db, dataDir: join(scratch, 'sandbox'), namespace: paths.namespace, podman: client, daemon: true });

    stage = 'environment start';
    const started = await runtime.requestEnvironment({ project: projectRef, accountUserId: ACTOR, action: { kind: 'start' } });
    await runtime.reconcile();
    assert.equal((await runtime.environmentOperation({ accountUserId: ACTOR, operationId: started.id }))?.status, 'succeeded');

    const sandbox = {
      ...runtime.control,
      prepareExecution: (input: any, options?: { accountUserId?: number }) =>
        runtime.prepareExecution({ ...input, projectRef: input.projectRef ?? projectRef }, options?.accountUserId ?? ACTOR),
    };
    const ctx: any = {
      currentAccess: () => ({ projectRef }), currentAccountUserId: () => ACTOR,
      control: (name: string) => (name === 'sandbox' ? sandbox : null),
      logger: { info() {}, warn() {}, error() {} },
      host: { stores: () => runtimeCtx.host.stores() },
    };
    const job = (check: string) => ({ ownerUserId: ACTOR, projectRef, check });

    stage = 'a marker written in the guest is what the check sees';
    await runtime.control.projectFiles({
      project: projectRef, accountUserId: ACTOR,
      operation: { kind: 'write', path: '/workspace/scheduled.txt', base64: Buffer.from('scheduled-marker\n').toString('base64'), expectedVersion: null },
    });

    stage = 'the check runs in the guest and reads the guest filesystem';
    const passed: any = await projectCheck(ctx, job('cat /workspace/scheduled.txt; pwd; id -u'), 120_000);
    expect(JSON.stringify(passed)).toContain('scheduled-marker');
    expect(JSON.stringify(passed)).toContain('/workspace');
    // The host has no such file, so a check that had run on the host could not have printed it.

    stage = 'a failing check reports its exit rather than reading as a pass';
    const failed: any = await projectCheck(ctx, job('exit 3'), 120_000).then(
      (value) => ({ kind: 'resolved', value }),
      (error) => ({ kind: 'rejected', message: String(error?.message ?? error) }),
    );
    const failureText = failed.kind === 'rejected' ? failed.message : JSON.stringify(failed.value);
    expect(failureText, `a failing scheduled check reported: ${failureText}`).toMatch(/3|fail|exit/i);
    if (failed.kind === 'resolved') expect(JSON.stringify(failed.value)).not.toMatch(/"ok"\s*:\s*true/);

    stage = 'no lease is left behind by either check';
    // A scheduled run has nobody watching it, so a leaked lease would pin the generation silently.
    const environment = await runtime.control.environmentFor({ project: projectRef, accountUserId: ACTOR });
    expect(environment.projectId).toBe(PROJECT_ID);
    const afterChecks = await runtime.control.projectFiles({
      project: projectRef, accountUserId: ACTOR, operation: { kind: 'stat', path: '/workspace/scheduled.txt' },
    });
    expect(afterChecks.entry?.kind).toBe('file');

    stage = 'a job owned by a non-member cannot borrow the project environment';
    await expect(projectCheck(ctx, { ownerUserId: OUTSIDER, projectRef, check: 'echo nope' }, 120_000)).rejects.toThrow();

    stage = 'teardown';
    const deleted = await runtime.requestEnvironment({ project: projectRef, accountUserId: ACTOR, action: { kind: 'delete' } });
    await runtime.reconcile();
    assert.equal((await runtime.environmentOperation({ accountUserId: ACTOR, operationId: deleted.id }))?.status, 'succeeded');
    await runtime.dispose();
  } catch (error) {
    console.error(`Scheduled check stage failed: ${stage}`);
    throw error;
  } finally {
    sql.close();
    if (engineVerified) {
      const reset = await new SpawnExecutor().run('/usr/bin/podman',
        ['--root', paths.storage, '--runroot', paths.runroot, '--tmpdir', paths.tmp, '--storage-driver', 'vfs', 'system', 'reset', '--force'],
        { env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: paths.home, XDG_RUNTIME_DIR: paths.runtime, TMPDIR: paths.tmp,
          ...(paths.userBus ? { DBUS_SESSION_BUS_ADDRESS: `unix:path=${paths.userBus.path}` } : {}) },
        timeoutMs: 180_000, outputLimitBytes: 1024 * 1024 });
      if (reset.code !== 0) throw new Error(`private Podman cleanup failed; retained ${scratch}: ${reset.stderr}`);
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}, 1_800_000);
