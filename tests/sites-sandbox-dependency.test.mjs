import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { SANDBOX_REQUIRED, SandboxRequiredError, requireSandbox } from '../plugins/sites/dist/sandboxControl.js';
import { ProjectPreviewService } from '../plugins/sites/dist/preview.js';
import { ProjectPublicationService } from '../plugins/sites/dist/publication.js';
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
  const managed = site({ kind: 'proxy', target: '3000' });

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

  // A missing control during teardown is not proof that the durable forwarder is gone. The Site deletion
  // row remains queued until the Sandbox seam can confirm the release.
  control = undefined;
  await assert.rejects(() => service.release(managed), /publication transport is unavailable/);
});

test('every Sandbox resolution in the Sites source is either routed through the accessor or marked optional', () => {
  // The guard that keeps this true as the plugin grows. A new `ctx.control('sandbox')` added without a
  // decision is the exact defect this change fixed: the caller degrades into a failure further down that
  // never names the cause. Either route it through `requireSandbox`, or say in a comment why absence is
  // a legitimate answer here.
  const src = join(import.meta.dirname, '..', 'plugins', 'sites', 'src');
  const undecided = [];
  for (const name of readdirSync(src).filter((file) => file.endsWith('.ts'))) {
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
