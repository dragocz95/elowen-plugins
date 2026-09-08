// @vitest-environment node
/** The project browser against a REAL guest Chromium over the CDP pipe.
 *
 *  Every other browser suite drives a stand-in page object. That proves the tool logic and nothing about
 *  the transport: the browser reaches Chromium through a duplex pipe on the environment's execution
 *  lease, which is precisely where the interesting failures live. Opt-in, and confined to an exclusively
 *  created private Podman store.
 */
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
import { openProjectBrowser } from '../plugins/browser/src/project-browser.js';

const PROJECT_ID = 7;
const ACTOR = 1;

it.runIf(process.env.ELOWEN_TEST_PODMAN === '1')('drives a real guest Chromium through the project browser', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'brw-'));
  const isolation = isolatedPodmanOptions(join(scratch, 'pm'), `brw-${randomBytes(6).toString('hex')}`, { useUserSessionBus: true });
  const paths = isolation.isolation;
  const client = new PodmanClient(isolation);
  const sql = openDb(':memory:');
  let engineVerified = false;
  let stage = 'engine';
  let attachment: any;
  try {
    const info = await client.info();
    assert.equal(info.graphRoot, paths.storage);
    engineVerified = true;

    const db = makePluginDb(sql, 'sandbox', { canMigrate: true });
    const project: any = { id: PROJECT_ID, executionKind: 'managed', lifecycle: 'active' };
    const projectRef = { kind: 'managed' as const, projectId: PROJECT_ID };
    const runtimeCtx: any = { db: () => db, currentAccountUserId: () => ACTOR, currentAccess: () => ({ readOnly: false }), config: {}, host: { stores: () => ({
      usersRead: { list: () => [{ id: ACTOR }], mayUsePlugin: () => true, isAdmin: () => true },
      userProjects: { canAccess: (_u: number, id: number) => id === PROJECT_ID, canManage: (_u: number, id: number) => id === PROJECT_ID },
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
    };
    const logger: any = { info() {}, warn() {}, error() {} };

    stage = 'open the guest browser over the CDP pipe';
    attachment = await openProjectBrowser(ctx, projectRef, ACTOR, logger);
    const page = await attachment.browser.newPage();

    stage = 'navigate and evaluate in the guest page';
    await page.goto('data:text/html,<h1 id=t>guest-browser</h1><button id=b onclick="document.getElementById(\'t\').textContent=\'clicked\'">go</button>');
    expect(await page.evaluate(() => document.getElementById('t')?.textContent)).toBe('guest-browser');

    stage = 'click reaches the guest page';
    await page.click('#b');
    expect(await page.evaluate(() => document.getElementById('t')?.textContent)).toBe('clicked');

    stage = 'screenshot comes back as real image bytes';
    const shot = await page.screenshot({ type: 'png' }) as Buffer | Uint8Array;
    const bytes = Buffer.from(shot);
    expect(bytes.length).toBeGreaterThan(1000);
    // PNG magic: proof this is an encoded image and not an empty or text payload.
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47');

    stage = 'profile persistence lives in the environment, not on the host';
    const profile = await runtime.control.projectFiles({
      project: projectRef, accountUserId: ACTOR, operation: { kind: 'stat', path: '/data/browser/profile' },
    });
    expect(profile.entry?.kind).toBe('directory');

    stage = 'teardown';
    await attachment.close?.();
    attachment = undefined;
    const deleted = await runtime.requestEnvironment({ project: projectRef, accountUserId: ACTOR, action: { kind: 'delete' } });
    await runtime.reconcile();
    assert.equal((await runtime.environmentOperation({ accountUserId: ACTOR, operationId: deleted.id }))?.status, 'succeeded');
    await runtime.dispose();
  } catch (error) {
    console.error(`Managed browser stage failed: ${stage}`);
    throw error;
  } finally {
    try { await attachment?.close?.(); } catch { /* teardown is best effort once the assertion has spoken */ }
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
}, 900_000);
