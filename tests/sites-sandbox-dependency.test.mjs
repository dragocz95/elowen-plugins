import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';
import { SANDBOX_REQUIRED, SandboxRequiredError, requireSandbox } from '../plugins/sites/dist/sandboxControl.js';
import { SiteRuntimeSupervisor } from '../plugins/sites/dist/runtime.js';
import { EnvironmentSupervisor } from '../plugins/sites/dist/environment.js';
import { ProjectPreviewService } from '../plugins/sites/dist/preview.js';
import { ProjectPublicationService } from '../plugins/sites/dist/publication.js';
import { executePhp } from '../plugins/sites/dist/php.js';
import { SitesStore } from '../plugins/sites/dist/store.js';
import { resolveConfig } from '../plugins/sites/dist/config.js';

// Sites declares `requiresControls: ['sandbox']`, so the daemon refuses to enable it without a provider
// and refuses to switch the provider off underneath it. What is left for this plugin to say is the
// reload window between those two, and every one of those paths has to say the SAME thing: the message
// names the plugin to switch on, instead of an "environment runtime" the reader cannot find a switch for.

const SITE_ID = '123e4567-e89b-12d3-a456-426614174000';

const site = (overrides = {}) => ({
  id: SITE_ID,
  slug: 'sandbox-demo',
  title: 'Sandbox demo',
  summary: '',
  projectId: 11,
  ownerUserId: 7,
  visibility: 'private',
  accessGeneration: 1,
  sourceRel: 'sites/sandbox-demo',
  spa: false,
  kind: 'static',
  target: '',
  runtime: 'command',
  startCommand: 'node server.mjs',
  bind: 'port',
  port: 41000,
  status: 'live',
  currentReleaseId: 'release-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdModel: '',
  lastPublishAt: null,
  lastPublishModel: null,
  lastError: null,
  ...overrides,
});

const temp = (t, tag) => {
  const dir = mkdtempSync(join(tmpdir(), `sites-${tag}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** Every required path must fail with the SAME sentence. Asserting the message rather than the class is
 *  the point: a caller that swapped in its own wording would still be an instance of the error. */
const refusesByName = async (run) => {
  await assert.rejects(run, (error) => {
    assert.ok(error instanceof SandboxRequiredError, `expected the shared refusal, got ${error?.name}: ${error?.message}`);
    assert.equal(error.message, SANDBOX_REQUIRED);
    return true;
  });
};

test('the accessor answers with the control, or with one refusal that names the plugin to switch on', () => {
  const control = { prepareExecution: async () => ({}) };
  assert.equal(requireSandbox(control), control);

  assert.throws(() => requireSandbox(undefined), SandboxRequiredError);
  // Actionable means it names the plugin AND where the switch is. "The environment runtime is
  // unavailable" was true and sent every reader looking for a broken container instead.
  assert.match(SANDBOX_REQUIRED, /Sandbox/);
  assert.match(SANDBOX_REQUIRED, /Plugins/);
});

test('a confined site runtime refuses by name instead of failing further down', async (t) => {
  const root = temp(t, 'runtime-nosandbox');
  const release = join(root, 'release');
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, 'server.mjs'), 'export {};');

  let prepared = 0;
  const supervisor = new SiteRuntimeSupervisor({
    ctx: {
      // The Sandbox is gone; the socket broker is not. Without the accessor this start reached the port
      // validation and the broker first, and reported whatever THOSE had to say about a cause that was
      // never theirs.
      control: (name) => (name === 'publishedSitesGateway'
        ? { prepareRuntimeSocket: async () => { prepared += 1; return { path: join(root, 'app.sock') }; } }
        : undefined),
      logger: { info() {}, warn() {}, error() {} },
    },
    store: { liveCommandSites: () => [], siteById: () => site(), conversionSuspends: () => null, conversionSuspensions: () => new Map() },
    config: () => ({ startTimeoutSeconds: 5, runtimeNetwork: 'isolated', allowLoopbackPorts: true, loopbackPortMin: 41000, loopbackPortMax: 41999 }),
    siteDir: () => root,
    releaseDir: () => release,
  });

  await refusesByName(() => supervisor.start(site(), { authorized: true }));
  assert.equal(supervisor.isRunning(SITE_ID), false);
  assert.equal(prepared, 0, 'nothing may be reserved for a runtime that cannot be confined');
});

test('PHP execution refuses by name, and reserves no session directory first', async (t) => {
  const root = temp(t, 'php-nosandbox');
  const release = join(root, 'release');
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, 'index.php'), '<?php');

  await refusesByName(() => executePhp(
    { ctx: { control: () => undefined, logger: { info() {}, warn() {}, error() {} } }, siteDir: () => root, network: () => 'isolated' },
    { id: SITE_ID, ownerUserId: 7 },
    release,
    { method: 'GET', path: '', query: {}, headers: {}, body: async () => Buffer.alloc(0) },
    '',
    { userId: 7, name: 'member' },
    { maxResponseBytes: 1024, requestTimeoutSeconds: 1 },
    '/s/sandbox-demo',
  ));
  assert.deepEqual(readdirSync(root), ['release'], 'a refused request must not leave a runtime directory behind');
});

test('an environment operation refuses by name rather than reporting an absent container', async (t) => {
  const root = temp(t, 'environment-nosandbox');
  const db = new Database(':memory:');
  t.after(() => db.close());
  const handle = { exec: (sql) => db.exec(sql), prepare: (sql) => db.prepare(sql) };
  const store = new SitesStore({ ...handle, migrate: (steps) => steps.forEach((step) => step.up(handle)), transaction: (fn) => db.transaction(fn)() });
  store.insertSite(site({ runtime: 'environment' }));

  const supervisor = new EnvironmentSupervisor({
    control: () => undefined,
    dataDir: root,
    access: { accountExists: () => true, isAdmin: () => false, canAccessProject: () => true },
    store,
    gateway: {
      prepareRuntimeSocket: async () => ({ path: join(root, 'app.sock') }),
      sealRuntimeSocket: async () => {},
      removeRuntimeSocket: async () => {},
    },
    config: () => ({ startTimeoutSeconds: 5, environmentNetwork: 'isolated', environmentCpus: 1, environmentMemoryMb: 1024, environmentPidsLimit: 512, releasesKept: 3 }),
    siteDir: () => root,
    logger: { warn() {} },
    buildSeedArchive: async () => join(root, 'seed.tar'),
  });

  // Registration is the ONE place absence is tolerated: a plugin that refused to load could not surface
  // the refusal anywhere. Every operation after it must still answer for itself.
  assert.doesNotThrow(() => supervisor.connect());
  await refusesByName(() => supervisor.state(site({ runtime: 'environment' })));
  await refusesByName(() => supervisor.logs(site({ runtime: 'environment' })));
});

test('a Project preview refuses by name once access has been proved', async (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const handle = { exec: (sql) => db.exec(sql), prepare: (sql) => db.prepare(sql) };
  const store = new SitesStore({ ...handle, migrate: (steps) => steps.forEach((step) => step.up(handle)), transaction: (fn) => db.transaction(fn)() });

  const service = new ProjectPreviewService({
    store,
    access: { accountExists: () => true, isAdmin: () => false, canAccessProject: () => true },
    project: () => ({ executionKind: 'managed', lifecycle: 'active' }),
    control: () => undefined,
    config: () => resolveConfig({}, 'https://app.example', 'sites.example'),
    gateway: { ensureSite: async () => {}, removeSite: async () => {} },
    proxyLimits: () => ({ maxResponseBytes: 1024, requestTimeoutSeconds: 1 }),
    usernameOf: () => 'member',
  });

  await refusesByName(() => service.request(11, 8080, 7));
  assert.equal(store.allSites().length, 0, 'a refused preview must not mint a record');
});

test('a proxy publication separates "no Sandbox" from "a Sandbox without this transport"', async (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const handle = { exec: (sql) => db.exec(sql), prepare: (sql) => db.prepare(sql) };
  const store = new SitesStore({ ...handle, migrate: (steps) => steps.forEach((step) => step.up(handle)), transaction: (fn) => db.transaction(fn)() });
  const managed = site({ kind: 'proxy', runtime: 'static', target: '3000', bind: 'socket', port: null });

  let control;
  const service = new ProjectPublicationService({
    store,
    control: () => control,
    project: () => ({ executionKind: 'managed', slug: 'demo' }),
    logger: { warn() {} },
  });

  control = undefined;
  await refusesByName(() => service.establish(managed, 7));

  // A daemon too old to carry publications is a DIFFERENT fact, and telling an operator to switch on a
  // plugin that is already on would send them round in circles.
  control = { projectPublicationRelease: async () => {} };
  await assert.rejects(() => service.establish(managed, 7), /publication transport is unavailable on this instance/);

  // Teardown stays best-effort: with no Sandbox there is no container, so no forwarder is left answering
  // and there is nothing for a deletion to fail over.
  control = undefined;
  await assert.doesNotReject(() => service.release(managed));
});

test('every Sandbox resolution in the Sites source is either routed through the accessor or marked optional', () => {
  // The guard that keeps this true as the plugin grows. A new `ctx.control('sandbox')` added without a
  // decision is the exact defect this change fixed: the caller degrades into a failure further down that
  // never names the cause. Either route it through `requireSandbox`, or say in a comment why absence is
  // a legitimate answer here.
  const src = join(import.meta.dirname, '..', 'plugins', 'sites', 'src');
  // `provisioning.ts` holds a `control()` of its own, but it is the published-sites gateway rather than
  // the Sandbox, so its resolutions are not this rule's business. Asserted from the wiring rather than
  // assumed, so the exemption cannot quietly outlive the reason for it.
  assert.match(readFileSync(join(src, 'index.ts'), 'utf8'),
    /new EnvironmentProvisioningService\(\{\s*\n\s*control: \(\) => ctx\.control\('publishedSitesGateway'\)/);

  const undecided = [];
  for (const name of readdirSync(src).filter((file) => file.endsWith('.ts') && file !== 'provisioning.ts')) {
    const lines = readFileSync(join(src, name), 'utf8').split('\n');
    lines.forEach((line, index) => {
      const resolves = line.includes("control('sandbox')") || /\bthis\.deps\.control\(\)|\bdeps\.control\(\)/.test(line);
      if (!resolves || line.includes('requireSandbox')) return;
      // A supplier handed to a service resolves nothing itself; the service it is given to does.
      if (/control:\s*\(\)\s*=>/.test(line)) return;
      const preceding = lines.slice(Math.max(0, index - 4), index).join('\n');
      if (preceding.includes('Deliberately NOT `requireSandbox`')) return;
      undecided.push(`${name}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(undecided, [], 'each of these resolves a control without routing through requireSandbox or stating why not');
});
