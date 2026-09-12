// The runtime conversion exercised through the whole plugin route: the real Sites store, the real
// recipe/digest/data-sync machinery, real permission scope, real HTTP over the sealed ingress socket and
// the real `SiteEnvironmentControl` SDK seam — `sites-migration.test.mjs` deliberately stands the route
// and the real data movement in for, and the container side belongs to the Sandbox provider, so it is
// consumed exactly as production consumes it instead of being driven by a local Podman client.
//
// Default: the provider is a private stand-in at the SDK seam (see the harness header). With
// SITES_PODMAN_E2E=1 the same suite runs against the REAL provider in a private isolated Podman
// namespace; the assertions below marked "real engine only" re-prove the container-side facts a
// stand-in cannot (nginx's own error log, the container specification carrying no secret). The suite
// never falls back to an account engine or to the retired Sites driver.

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  MigrationRefused, RELEASE_ID, SLOW_MS, httpOverSocket, httpOverSocketWhenUp, podmanHarness, release0, site0,
  stagedWorkspace,
} from './helpers/sitesPodmanHarness.mjs';

// --- static: the whole lifecycle, ending in a site that actually answers ----------------------------

const staticCutover = test('a static site converts end to end and answers over its own sealed ingress socket', { timeout: SLOW_MS }, async () => {
  const h = await podmanHarness();
  const site = site0();
  // Where the row's Project-relative source resolves to in this harness: what the author edits, and what
  // a completed conversion must end up serving.
  const projectSource = h.sourceDir('conv-demo');
  try {
    h.store.insertSite(site);
    h.store.insertRelease(release0(site.id));
    h.seedRelease(site.id, { 'index.html': '<h1>converted-static</h1>', 'assets/app.js': 'console.log(1)' });
    // The Project folder the author actually edits, as it stands when the conversion starts.
    mkdirSync(projectSource, { recursive: true });
    writeFileSync(join(projectSource, 'index.html'), '<h1>converted-static</h1>');
    writeFileSync(join(projectSource, 'NOTES.md'), 'kept only in the Project folder');
    const modeBefore = (path) => (statSync(path).mode & 0o777).toString(8);
    const sharedModesBefore = [join(h.root, 'sites'), h.root].map(modeBefore);
    const releaseModeBefore = modeBefore(h.releaseDir(site.id, RELEASE_ID));

    let res = await h.call(site.id, {
      step: 'register',
      recipe: { kind: 'release-copy', argv: ['/usr/sbin/nginx', '-g', 'daemon off;'], readiness: { path: '/', expectStatus: 200 } },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.registered.image, 'static');

    // PREPARE. The broker directory does not exist for a static site, so the conversion must ask the
    // gateway for one before the runtime creates the container that binds it.
    assert.equal(existsSync(join(h.brokerRoot, site.id)), false);
    res = await h.call(site.id, { step: 'prepare', recipe: 'release-copy' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.conversion.stage, 'prepared');
    assert.equal(h.gatewayCalls.prepare.length, 1, 'the gateway created the broker directory exactly once');
    assert.equal(statSync(join(h.brokerRoot, site.id)).isDirectory(), true);
    assert.equal(h.store.runtimeMigration(site.id).brokerPrepared, true, 'ownership of the directory is durable');

    // PERMISSION SCOPE. Making a static tree servable widens modes, so the widening must stop at this
    // site's own private tree. Nothing above it, and nothing shared, may move.
    const modeOf = (path) => (statSync(path).mode & 0o777).toString(8);
    assert.equal(modeOf(join(h.siteDir(site.id), 'migration', 'workspace')), '755');
    assert.equal(modeOf(join(h.siteDir(site.id), 'migration', 'workspace', 'index.html')), '644');
    for (const ancestor of [h.siteDir(site.id), join(h.siteDir(site.id), 'migration')]) {
      // Traversal only. Group and other may walk through, and may not list what else the site keeps.
      assert.equal(modeOf(ancestor), '711', `${ancestor} is traversable but not listable`);
    }
    // The artefact directory holds the lifted secrets and stays shut, which an execute-only parent makes
    // unreachable rather than merely unreadable.
    assert.equal(modeOf(join(h.siteDir(site.id), 'migration', 'artifacts')), '700');
    // Shared ancestors: the plugin data root, the directory every site sits in, and the harness root.
    assert.deepEqual(sharedModesBefore, [join(h.root, 'sites'), h.root].map(modeOf),
      'no directory shared with other sites or with the plugin data root was touched');
    assert.equal(modeOf(h.releaseDir(site.id, RELEASE_ID)), releaseModeBefore, 'the published release is unchanged');

    // The persistent container exists and is NOT running: the legacy runtime is still the one serving.
    assert.deepEqual(await h.runtimeState(site.id), { state: 'stopped', provisioned: true });

    // FLIP. Real cutover: the container starts, the socket is sealed, the site answers.
    res = await h.call(site.id, { step: 'flip' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.conversion.stage, 'flipped');
    assert.equal(h.store.siteById(site.id).runtime, 'environment');

    // The site serves its own release through the converted runtime, whose workers are unprivileged
    // inside the container. This test changes no mode anywhere: the staged tree must arrive servable.
    const answer = await httpOverSocketWhenUp(h.brokerPath(site.id), '/');
    assert.equal(answer.status, 200, `the converted static site answered ${answer.status}`);
    assert.match(answer.body, /converted-static/);
    if (h.realEngine) {
      const log = await h.control.siteEnvironmentExec({
        siteId: site.id, accountUserId: 7, command: 'tail -20 /var/log/nginx/error.log', timeoutMs: 30_000,
      });
      assert.equal(log.stdout.includes('Permission denied'), false, 'the serving process hit no permission failure');
    }

    // The sealed directory has lost write permission, exactly as the helper leaves it.
    assert.equal((statSync(join(h.brokerRoot, site.id)).mode & 0o777).toString(8), '510');

    // A static conversion must not serve the release's dotfiles through the new runtime either.
    assert.equal((await httpOverSocket(h.brokerPath(site.id), '/.env')).status, 404);

    // COMPLETE. The route queues durable work; the daemon supervisor performs the lifecycle phases.
    res = await h.call(site.id, { step: 'complete' });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(res.body.conversion.stage, 'flipped');
    await h.migration.reconcileCompletions();
    assert.equal(h.store.runtimeMigration(site.id).stage, 'completed', JSON.stringify(h.store.runtimeMigration(site.id)));
    assert.equal(h.store.siteById(site.id).runtime, 'environment');

    // Identity survived the conversion.
    const converted = h.store.siteById(site.id);
    assert.equal(converted.slug, site.slug);
    assert.equal(converted.accessGeneration, site.accessGeneration);
    assert.equal(converted.currentReleaseId, RELEASE_ID);
    assert.equal(h.store.releases(site.id).length, 1);

    // ONE WORKING COPY. The container is bound to the site's own source folder and nothing is staging.
    // The protected conversion directory remains only as completed rollback material.
    const binding = JSON.parse(h.store.runtimeRecord(site.id, 'binding'));
    assert.equal(binding.sourcePath, projectSource);
    assert.equal(binding.staging, false);
    assert.equal(existsSync(join(h.siteDir(site.id), 'migration')), true);
    assert.equal(existsSync(stagedWorkspace({ siteDir: h.siteDir }, site.id)), false);
    assert.equal(readFileSync(join(projectSource, 'NOTES.md'), 'utf8'), 'kept only in the Project folder');
    assert.equal(readFileSync(join(projectSource, 'assets/app.js'), 'utf8'), 'console.log(1)',
      'what only the staged copy held arrived in the Project folder');

    // And the served site now follows the Project folder, which is the whole point of completing.
    assert.match((await httpOverSocketWhenUp(h.brokerPath(site.id), '/')).body, /converted-static/);
    writeFileSync(join(projectSource, 'index.html'), '<h1>edited-in-project</h1>');
    assert.match((await httpOverSocket(h.brokerPath(site.id), '/')).body, /edited-in-project/);
  } finally {
    await h.cleanup(site.id);
  }
});

// --- command: a live legacy socket must survive prepare and a pre-flip rollback ---------------------

const legacySurvives = test('a live legacy broker socket survives prepare and a pre-flip rollback', { timeout: SLOW_MS }, async () => {
  const h = await podmanHarness();
  const site = site0({ runtime: 'command', slug: 'conv-cmd', startCommand: 'node server.mjs' });
  try {
    h.store.insertSite(site);
    h.store.insertRelease(release0(site.id));
    h.seedRelease(site.id, { 'server.mjs': 'export {};\n', '.env': 'CONV_SECRET=seeded\n' });

    // The legacy runtime is up and answering on the broker socket the gateway made for it.
    await h.startLegacy(site.id, (_req, res) => { res.writeHead(200); res.end('legacy-alive'); });
    assert.equal((await httpOverSocket(h.brokerPath(site.id), '/')).body, 'legacy-alive');
    const gatewayPreparesBefore = h.gatewayCalls.prepare.length;
    const legacyInode = statSync(join(h.brokerRoot, site.id)).ino;

    let res = await h.call(site.id, {
      step: 'register',
      recipe: {
        kind: 'node-app',
        argv: ['/usr/local/bin/node', '/workspace/server.mjs'],
        dataIncludes: ['.local/share/conv-app'],
        secretFiles: ['.env'],
        readiness: { path: '/state', expectStatus: 200 },
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    res = await h.call(site.id, { step: 'prepare', recipe: 'node-app' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    // The directory was inherited, not re-made: re-preparing it would rm the socket a live process is
    // answering on.
    assert.equal(h.gatewayCalls.prepare.length, gatewayPreparesBefore, 'the gateway was not asked again');
    assert.equal(h.store.runtimeMigration(site.id).brokerPrepared, false, 'the conversion does not claim it');
    assert.equal(statSync(join(h.brokerRoot, site.id)).ino, legacyInode, 'the directory was never replaced');
    assert.equal((await httpOverSocket(h.brokerPath(site.id), '/')).body, 'legacy-alive', 'the legacy site is still serving');

    // PRE-FLIP ROLLBACK. The container goes; the legacy socket stays, because this conversion never
    // created it.
    res = await h.call(site.id, { step: 'rollback' });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    await h.migration.reconcileRollbacks();
    assert.equal(h.migration.status(site.id).stage, 'none');
    assert.deepEqual(await h.runtimeState(site.id), { state: 'deleted', provisioned: false }, 'the container was discarded');
    assert.equal(statSync(join(h.brokerRoot, site.id)).ino, legacyInode);
    assert.equal((await httpOverSocket(h.brokerPath(site.id), '/')).body, 'legacy-alive',
      'a rolled-back conversion left the live site serving');
    assert.equal(existsSync(stagedWorkspace({ siteDir: h.siteDir }, site.id)), false);
    assert.equal(h.store.siteById(site.id).runtime, 'command');
  } finally {
    await h.cleanup(site.id);
  }
});

// --- command: full cutover with real data, then a rollback that carries writes back -----------------

const statefulRollback = test('a stateful command site converts, serves its carried data, and rolls back with the container writes',
  { timeout: SLOW_MS }, async () => {
    const appDirName = '.local/share/conv-app';
    // The stand-in for the containerized application: the same SQLite behaviour server.mjs has, run
    // against the private directory that stands in for the container's data volume. It boots once per
    // start — deleting the file the app deletes, inserting the boot row — and serves /state.
    const h = await podmanHarness({ convertedApp: {
      open: (home) => {
        const appDir = join(home, appDirName);
        mkdirSync(appDir, { recursive: true });
        rmSync(join(appDir, 'obsolete.txt'), { force: true });
        const db = new DatabaseSync(join(appDir, 'data.db'));
        db.exec("CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO state(value) VALUES ('boot');");
        return {
          handle: (request, response) => {
            if (request.url !== '/state') { response.writeHead(404); response.end('no'); return; }
            db.exec("INSERT INTO state(value) VALUES ('request')");
            const count = db.prepare('SELECT count(*) AS n FROM state').get().n;
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ count }));
          },
          close: () => db.close(),
        };
      },
    } });
    const site = site0({ runtime: 'command', slug: 'conv-state', startCommand: 'node server.mjs' });
    const appDir = join(h.legacyHome, appDirName);
    try {
      h.store.insertSite(site);
      h.store.insertRelease(release0(site.id));
      h.seedRelease(site.id, { 'server.mjs': 'export {};\n', '.env': 'CONV_SECRET=seeded\n' });

      // Real legacy application state, including a file the converted app deletes and a neighbour subtree
      // that must never travel.
      mkdirSync(appDir, { recursive: true });
      mkdirSync(join(h.legacyHome, '.local/share/neighbour'), { recursive: true });
      writeFileSync(join(h.legacyHome, '.local/share/neighbour/private.txt'), 'must-not-travel\n');
      writeFileSync(join(appDir, 'obsolete.txt'), 'stale-must-disappear\n');
      const legacyDb = new DatabaseSync(join(appDir, 'data.db'));
      legacyDb.exec("CREATE TABLE state (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO state(value) VALUES ('legacy'); PRAGMA journal_mode=WAL;");
      legacyDb.close();
      chmodSync(join(appDir, 'data.db'), 0o600);

      await h.startLegacy(site.id, (_req, res) => { res.writeHead(200); res.end('legacy-alive'); });

      let res = await h.call(site.id, {
        step: 'register',
        recipe: {
          kind: 'node-app',
          argv: ['/usr/local/bin/node', '/workspace/server.mjs'],
          dataIncludes: ['.local/share/conv-app'],
          secretFiles: ['.env'],
          readiness: { path: '/state', expectStatus: 200 },
        },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      res = await h.call(site.id, { step: 'prepare', recipe: 'node-app' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      // The secret left the mounted workspace before the container was ever pointed at it.
      assert.equal(existsSync(join(stagedWorkspace({ siteDir: h.siteDir }, site.id), '.env')), false);

      res = await h.call(site.id, { step: 'flip' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(h.store.siteById(site.id).runtime, 'environment');
      assert.equal(h.legacy.running, false, 'the legacy process was stopped before the container took over');

      // REAL CUTOVER on carried data: 'legacy' + 'boot' + this request.
      const first = await httpOverSocketWhenUp(h.brokerPath(site.id), '/state');
      assert.equal(first.status, 200);
      assert.equal(JSON.parse(first.body).count, 3, `carried legacy rows plus boot plus the request (${first.body})`);

      // No secret ever crossed the SDK seam: every request the provider received is free of it. The
      // real-engine mode re-proves the same invariant one level lower, against the container itself.
      assert.equal(JSON.stringify(h.requests).includes('CONV_SECRET'), false,
        'no secret is published through the environment control seam');
      if (h.realEngine) {
        const env = await h.control.siteEnvironmentExec({
          siteId: site.id, accountUserId: 7, command: 'printenv', timeoutMs: 30_000,
        });
        assert.equal(env.stdout.includes('CONV_SECRET'), false, 'the serving process sees no injected secret');
      }

      // The neighbour subtree never entered the volume.
      if (h.realEngine) {
        const listed = await h.control.siteEnvironmentExec({
          siteId: site.id, accountUserId: 7, command: 'ls -A /data/.local/share', timeoutMs: 30_000,
        });
        assert.equal(listed.stdout.includes('neighbour'), false, 'only the declared subtree travelled');
      } else {
        const listed = readdirSync(join(h.volumeDir(site.id), '.local', 'share')).join(',');
        assert.equal(listed.includes('neighbour'), false, 'only the declared subtree travelled');
        assert.match(listed, /conv-app/, 'the declared subtree did travel');
      }

      // ROLLBACK, in one call. It has to name the legacy home from the descriptor the conversion
      // recorded: the site row already says `environment` here, and the resolver answers only for a
      // command site. The restore also has to land before the container is discarded, so a failure
      // would still leave the writes recoverable.
      res = await h.call(site.id, { step: 'rollback', restoreData: true });
      assert.equal(res.status, 202, JSON.stringify(res.body));
      await h.migration.reconcileRollbacks();
      assert.equal(h.migration.status(site.id).stage, 'none');
      assert.equal(h.store.siteById(site.id).runtime, 'command');

      // Container writes travelled back, the deletion stuck, the neighbour was untouched, the database is
      // intact and its mode survived.
      assert.equal(existsSync(join(appDir, 'obsolete.txt')), false, 'a file the converted app deleted stays deleted');
      assert.equal(readFileSync(join(h.legacyHome, '.local/share/neighbour/private.txt'), 'utf8'), 'must-not-travel\n');
      const restored = new DatabaseSync(join(appDir, 'data.db'));
      assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.ok(restored.prepare('SELECT count(*) AS n FROM state').get().n >= 3, 'the container writes came back');
      restored.close();
      assert.equal((statSync(join(appDir, 'data.db')).mode & 0o777).toString(8), '600');
      assert.equal(existsSync(join(h.brokerRoot, site.id)), true, 'the restored legacy socket keeps its broker directory');
      assert.equal(h.store.siteById(site.id).currentReleaseId, RELEASE_ID, 'the release the site serves is unchanged');
    } finally {
      await h.cleanup(site.id);
    }
  });

// --- the route is still the guarded one --------------------------------------------------------------

const adminGuard = test('the conversion route keeps its administrator guard', { timeout: SLOW_MS }, async () => {
  const h = await podmanHarness();
  const site = site0();
  try {
    h.store.insertSite(site);
    h.store.insertRelease(release0(site.id));
    h.seedRelease(site.id, { 'index.html': '<h1>guarded</h1>' });
    assert.equal((await h.call(site.id, undefined, { admin: false })).status, 403);
    assert.equal((await h.call(site.id, { step: 'prepare', recipe: 'release-copy' }, { admin: false })).status, 403);
    await assert.rejects(() => h.migration.prepare(site.id, 'release-copy'), MigrationRefused);
  } finally {
    await h.cleanup(site.id);
  }
});
// Every test has settled by the line above: the real ingress requests leave keep-alive sockets that the
// bare node:http agent abandons mid-shutdown on this Node build, and they would hold the runner's
// process open after an otherwise complete run. The exit code still reports test failures.
await Promise.all([staticCutover, legacySurvives, statefulRollback, adminGuard]);
setTimeout(() => process.exit(process.exitCode ?? 0), 2_000);
