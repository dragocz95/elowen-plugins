// The runtime conversion WITH the daemon's periodic reconciliation running, which is the condition the
// production cutover actually ran under and the unit suites cannot reproduce.
//
// The reconcilers tick against the same rows the conversion is moving. For the whole quiesced window the
// row still says `environment` and `live` while the container is deliberately down, so an unguarded sweep
// that restarts containers would fight the conversion — on top of the volume being exported. This drives
// both sweeps deliberately, far faster than production does: the SITES readiness/ownership sweep
// (`EnvironmentSupervisor.reconcile`) and the provider's own durable-operation sweep, which are separate
// code paths with separate owners now.
//
// The provider is behind the same `SiteEnvironmentControl` seam the conversion suite uses — a private
// stand-in by default, the real isolated-Podman provider with SITES_PODMAN_E2E=1. No privileged gateway
// call, no /var/lib/elowen access, and no fallback to an account engine.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  site0, release0, podmanHarness, httpOverSocketWhenUp,
} from './helpers/sitesPodmanHarness.mjs';

/** The daemon's `registerInterval('reconcile-site-runtimes', …)`, at a cadence the conversion's awaits
 *  cannot outrun. Both sweeps run, because they are separate code paths with separate owners now: the
 *  Sites supervisor walks its own rows for readiness and recovery, and the provider reconciles its
 *  durable operations — only ever performing what the conversion itself queued, never resurrecting. With
 *  the stand-in provider the whole conversion is milliseconds, so the reconciler starts BEFORE the
 *  conversion is even registered and ticks far faster than production does. */
const runReconciler = (h, everyMs = 25) => {
  const ticks = { environment: 0, provider: 0, errors: [] };
  let stopped = false;
  let inFlight = false;
  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    void (async () => {
      try {
        await h.environment.reconcile();
        ticks.environment += 1;
        await h.providerReconcile();
        ticks.provider += 1;
      } catch (error) {
        ticks.errors.push(error instanceof Error ? error.message : String(error));
      } finally {
        inFlight = false;
      }
    })();
  }, everyMs);
  return {
    ticks,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      // Let whatever tick is mid-flight settle, so cleanup does not race a sweep.
      await new Promise((resolve) => { setTimeout(resolve, everyMs * 2); });
    },
  };
};

const carriedRollback = test('a rollback carrying container writes survives the periodic ENVIRONMENT reconciler running throughout',
  { timeout: 300_000 }, async () => {
    const h = await podmanHarness({ convertedApp: {
      open: (home) => {
        const appDir = join(home, '.local/share/conv-race-app');
        mkdirSync(appDir, { recursive: true });
        const db = new DatabaseSync(join(appDir, 'data.db'));
        db.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, value TEXT)');
        return {
          handle: (request, response) => {
            if (request.url !== '/state') { response.writeHead(404); response.end('no'); return; }
            db.exec("INSERT INTO state(value) VALUES ('written-while-converted')");
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ count: db.prepare('SELECT count(*) AS n FROM state').get().n }));
          },
          close: () => db.close(),
        };
      },
    } });
    const site = site0({ runtime: 'command', slug: 'conv-race', startCommand: 'node server.mjs' });
    const appDir = join(h.legacyHome, '.local/share/conv-race-app');
    let reconciler = null;
    try {
      h.store.insertSite(site);
      h.store.insertRelease(release0(site.id));
      h.seedRelease(site.id, { 'server.mjs': 'export {};\n', '.env': 'CONV_SECRET=seeded\n' });

      mkdirSync(appDir, { recursive: true });
      const legacyDb = new DatabaseSync(join(appDir, 'data.db'));
      legacyDb.exec("CREATE TABLE state (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO state(value) VALUES ('legacy')");
      legacyDb.close();

      await h.startLegacy(site.id, (_req, res) => { res.writeHead(200); res.end('legacy-alive'); });

      // The reconciler starts BEFORE the conversion does, exactly as it is already running in a live
      // daemon, and it keeps ticking across register, prepare, flip and rollback.
      reconciler = runReconciler(h);

      let res = await h.call(site.id, {
        step: 'register',
        recipe: {
          kind: 'node-app',
          argv: ['/usr/local/bin/node', '/workspace/server.mjs'],
          dataIncludes: ['.local/share/conv-race-app'],
          readiness: { path: '/state', expectStatus: 200 },
        },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      res = await h.call(site.id, { step: 'prepare', recipe: 'node-app' });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      res = await h.call(site.id, { step: 'flip' });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      // A converted site is genuinely meant to be running, so the Sites sweep must keep serving it
      // rather than stand back. This is the half a blanket "leave conversions alone" rule would get
      // wrong — and it holds only outside the quiesced window.
      assert.equal(h.store.conversionSuspends(site.id), null);
      assert.equal(h.store.siteById(site.id).runtime, 'environment');

      // The converted container has to be ASKED to write before a rollback can be shown to carry a
      // container write back. Without this request the volume still holds only the captured legacy row
      // and the assertion at the end of this test proves nothing.
      const served = await httpOverSocketWhenUp(h.brokerPath(site.id), '/state');
      assert.equal(served.status, 200, served.body);

      // The rollback quiesces the container and exports its volume. Every tick in that window reads a
      // container that is down and a row that says it should be up.
      res = await h.call(site.id, { step: 'rollback', restoreData: true });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      assert.ok(reconciler.ticks.environment > 0, 'the Sites reconciler really ran');
      assert.ok(reconciler.ticks.provider > 0, 'and the provider sweep ran beside it');
      assert.deepEqual(reconciler.ticks.errors, [], 'and neither sweep failed over a converting site');

      // The rollback finished on its own terms rather than fighting a resurrected container.
      assert.equal(h.store.runtimeMigration(site.id), null, 'the slot was released');
      const settled = h.store.siteById(site.id);
      assert.equal(settled.runtime, 'command');
      assert.equal(settled.status, 'live', 'published as serving only after the legacy start answered');
      assert.equal(settled.lastError, null, 'and no stale verdict from a sweep was left behind');
      assert.equal(h.store.liveCommandSites().some((s) => s.id === site.id), true);

      // The container is gone for good: a sweep that resurrected it mid-rollback would leave one behind.
      assert.deepEqual(await h.runtimeState(site.id), { state: 'deleted', provisioned: false });

      // The writes the container made came back, which is only true if the export ran against a volume
      // nothing was writing to.
      const restored = new DatabaseSync(join(appDir, 'data.db'));
      const values = restored.prepare('SELECT value FROM state ORDER BY id').all().map((row) => row.value);
      restored.close();
      assert.ok(values.includes('written-while-converted'), `container writes were carried back: ${values.join(',')}`);
    } finally {
      if (reconciler) await reconciler.stop();
      await h.cleanup(site.id);
    }
  });

// NOTE ON SCOPE. The provider reconciles only durable pending operations and never restarts a stopped
// container on its own; the quiesced window is safe against it by construction. What this proves is that
// the Sites sweep leaves a flip alone while that flip holds the legacy runtime down and builds the
// container around the same broker directory, and that neither sweep disturbs a live converted site.
const heldFlip = test('the environment reconciler does not disturb a flip that is holding the legacy runtime down',
  { timeout: 300_000 }, async () => {
    const h = await podmanHarness({ convertedApp: {
      open: () => ({
        handle: (_request, response) => { response.writeHead(200); response.end('ok'); },
        close: () => {},
      }),
    } });
    const site = site0({ runtime: 'command', slug: 'conv-race-legacy', startCommand: 'node server.mjs' });
    const appDir = join(h.legacyHome, '.local/share/conv-race-legacy-app');
    let reconciler = null;
    try {
      h.store.insertSite(site);
      h.store.insertRelease(release0(site.id));
      h.seedRelease(site.id, { 'server.mjs': 'export {};\n' });
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, 'state.txt'), 'legacy\n');

      await h.startLegacy(site.id, (_req, res) => { res.writeHead(200); res.end('legacy-alive'); });

      reconciler = runReconciler(h);

      let res = await h.call(site.id, {
        step: 'register',
        recipe: {
          kind: 'node-app',
          argv: ['/usr/local/bin/node', '/workspace/server.mjs'],
          dataIncludes: ['.local/share/conv-race-legacy-app'],
          readiness: { path: '/', expectStatus: 200 },
        },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      res = await h.call(site.id, { step: 'prepare', recipe: 'node-app' });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      reconciler = runReconciler(h);
      res = await h.call(site.id, { step: 'flip' });

      // The flip stops the legacy process, captures its data and builds the container around the SAME
      // broker directory. A sweep that respawned the legacy runtime in that window would take the broker
      // directory back and leave the runtime unable to stat the bind source it was given.
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(reconciler.ticks.errors, []);
      assert.equal(h.store.siteById(site.id).runtime, 'environment');
      assert.equal(h.store.siteById(site.id).lastError, null);
      assert.deepEqual(await h.runtimeState(site.id), { state: 'running', provisioned: true });
    } finally {
      if (reconciler) await reconciler.stop();
      await h.cleanup(site.id);
    }
  });
// Every test has settled by the line above, so this is bookkeeping, not the run itself: the real ingress
// requests leave keep-alive sockets that the bare node:http agent abandons mid-shutdown on this Node
// build, and they would hold the runner's process open for good after an otherwise complete run. The
// exit code still reports test failures.
await Promise.all([carriedRollback, heldFlip]);
setTimeout(() => process.exit(process.exitCode ?? 0), 2_000);
