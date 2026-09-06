// The runtime conversion against REAL rootless Podman WITH the daemon's periodic reconciliation running,
// which is the condition the production cutover actually ran under and the unit suites cannot reproduce.
//
// The two reconcilers tick every five seconds against the same rows the conversion is moving. For the
// whole quiesced window the row still says `environment` and `live` while the container is deliberately
// down, so an unguarded sweep reads a container it believes should be up and starts it again — on top of
// the volume being exported. This drives that sweep deliberately, far faster than production does.
//
// Opt-in exactly like the suite it sits beside, and it reuses that harness UNCHANGED: no new host helper,
// no privileged gateway call, no /var/lib/elowen access.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  skip, SLOW_MS, site0, release0, podmanHarness, httpOverSocketWhenUp,
} from './helpers/sitesPodmanHarness.mjs';

/** The daemon's `registerInterval('reconcile-site-runtimes', …)`, at a cadence chosen to land inside the
 *  conversion's awaits rather than after them. Both sweeps run, because they are separate code paths:
 *  `reconcile` walks the database and `backstop` asks Podman for the whole fleet. */
const runReconciler = (environment, everyMs = 150) => {
  const ticks = { reconcile: 0, backstop: 0, errors: [] };
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    void (async () => {
      try {
        await environment.reconcile();
        ticks.reconcile += 1;
        await environment.backstop();
        ticks.backstop += 1;
      } catch (error) {
        ticks.errors.push(error instanceof Error ? error.message : String(error));
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

test('a rollback carrying container writes survives the periodic ENVIRONMENT reconciler running throughout',
  { skip, timeout: SLOW_MS }, async () => {
    const h = podmanHarness();
    const site = site0({ runtime: 'command', slug: 'conv-race', startCommand: 'node server.mjs' });
    const appDir = join(h.legacyHome, '.local/share/conv-race-app');
    let reconciler = null;
    try {
      h.store.insertSite(site);
      h.store.insertRelease(release0(site.id));
      h.seedRelease(site.id, {
        'server.mjs': `import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import fs from 'node:fs';
const dir = \`\${process.env.HOME}/.local/share/conv-race-app\`;
fs.mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(\`\${dir}/data.db\`);
db.exec("CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, value TEXT)");
http.createServer((request, response) => {
  if (request.url !== '/state') { response.writeHead(404); response.end('no'); return; }
  db.exec("INSERT INTO state(value) VALUES ('written-while-converted')");
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ count: db.prepare('SELECT count(*) AS n FROM state').get().n }));
}).listen(80, '127.0.0.1');
`,
      });

      mkdirSync(appDir, { recursive: true });
      const legacyDb = new DatabaseSync(join(appDir, 'data.db'));
      legacyDb.exec("CREATE TABLE state (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO state(value) VALUES ('legacy')");
      legacyDb.close();

      await h.startLegacy(site.id, (_req, res) => { res.writeHead(200); res.end('legacy-alive'); });

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

      // The reconciler starts BEFORE the conversion does, exactly as it is already running in a live
      // daemon, and it keeps ticking across prepare, flip and rollback.
      reconciler = runReconciler(h.environment);

      res = await h.call(site.id, { step: 'prepare', recipe: 'node-app' });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      res = await h.call(site.id, { step: 'flip' });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      // A converted site is genuinely meant to be running, so the sweep must keep it up rather than
      // stand back. This is the half a blanket "leave conversions alone" rule would get wrong.
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

      assert.ok(reconciler.ticks.reconcile > 0, 'the reconciler really ran');
      assert.deepEqual(reconciler.ticks.errors, [], 'and never failed a sweep over a converting site');

      // The rollback finished on its own terms rather than fighting a resurrected container.
      assert.equal(h.store.runtimeMigration(site.id), null, 'the slot was released');
      const settled = h.store.siteById(site.id);
      assert.equal(settled.runtime, 'command');
      assert.equal(settled.status, 'live', 'published as serving only after the legacy start answered');
      assert.equal(settled.lastError, null, 'and no stale verdict from a sweep was left behind');
      assert.equal(h.store.liveCommandSites().some((s) => s.id === site.id), true);

      // The container is gone for good: a sweep that resurrected it mid-rollback would leave one behind.
      assert.equal(await h.podman.inspectStatus(`elowen-site-${site.id}`), null);

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

// NOTE ON SCOPE. This harness drives the ENVIRONMENT reconciler only; it has no live
// `SiteRuntimeSupervisor`, so the legacy sweep's own guard is covered by tests/sites-runtime.test.mjs
// rather than here. What this proves is that the environment sweep leaves a flip alone while that flip
// holds the legacy runtime down and builds the container around the same broker directory.
test('the environment reconciler does not disturb a flip that is holding the legacy runtime down',
  { skip, timeout: SLOW_MS }, async () => {
    const h = podmanHarness();
    const site = site0({ runtime: 'command', slug: 'conv-race-legacy', startCommand: 'node server.mjs' });
    const appDir = join(h.legacyHome, '.local/share/conv-race-legacy-app');
    let reconciler = null;
    try {
      h.store.insertSite(site);
      h.store.insertRelease(release0(site.id));
      h.seedRelease(site.id, {
        'server.mjs': `import http from 'node:http';
http.createServer((_request, response) => { response.writeHead(200); response.end('ok'); }).listen(80, '127.0.0.1');
`,
      });
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, 'state.txt'), 'legacy\n');

      await h.startLegacy(site.id, (_req, res) => { res.writeHead(200); res.end('legacy-alive'); });

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

      reconciler = runReconciler(h.environment);
      res = await h.call(site.id, { step: 'flip' });

      // The flip stops the legacy process, captures its data and builds the container around the SAME
      // broker directory. A sweep that respawned the legacy runtime in that window would take the broker
      // directory back and leave Podman unable to stat the bind source it was given.
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(reconciler.ticks.errors, []);
      assert.equal(h.store.siteById(site.id).runtime, 'environment');
      assert.equal(h.store.siteById(site.id).lastError, null);
      assert.equal(await h.podman.inspectStatus(`elowen-site-${site.id}`), 'running');
    } finally {
      if (reconciler) await reconciler.stop();
      await h.cleanup(site.id);
    }
  });
