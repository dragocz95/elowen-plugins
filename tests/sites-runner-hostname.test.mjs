import assert from 'node:assert/strict';
import test from 'node:test';

import { SiteGatewayManager } from '../plugins/sites/dist/gateway.js';
import { SiteAddressService } from '../plugins/sites/dist/address.js';

// Every tool call arrives in a FORKED RUNNER. Core builds that process with `migrate: false`, and on that
// branch it constructs no privileged published-sites gateway at all — so `ctx.control('publishedSitesGateway')`
// answers `undefined` there while answering an object in the daemon. The app URL is the same fact in both.
const APP_URL = 'https://agent.example.invalid';
const HOSTNAME_BASE = 'sites.agent.example.invalid';

const secretBag = () => {
  const values = new Map();
  return {
    get: (key) => (values.has(key) ? { value: values.get(key), version: 1 } : null),
    has: (key) => values.has(key),
    set: (key, value) => { values.set(key, value); return 1; },
    delete: (key) => values.delete(key),
  };
};

/** A runner-shaped harness: no control of any kind, and a record of every control the manager asks for.
 *
 *  `control` returns `undefined` for everything on purpose. It is also the proof that the derivation calls
 *  no privileged METHOD: a call on `undefined` raises a TypeError rather than answering, so any assertion
 *  below that gets a real value got it without touching the broker. */
const runnerHarness = ({ publicWebUrl = APP_URL, broker = null, contactEmail = 'ops@example.com' } = {}) => {
  const controlLookups = [];
  const warnings = [];
  const bag = secretBag();
  const ctx = {
    config: { contactEmail },
    instanceSecrets: () => bag,
    publicWebUrl: () => publicWebUrl,
    logger: { warn: (message) => warnings.push(message), info: () => {} },
    control: (name) => {
      controlLookups.push(name);
      return name === 'publishedSitesGateway' ? broker ?? undefined : undefined;
    },
  };
  return {
    manager: new SiteGatewayManager(ctx, {
      resolver: {
        resolveCname: async () => { throw new Error('a runner must not reconcile DNS'); },
        resolve4: async () => { throw new Error('a runner must not reconcile DNS'); },
        resolve6: async () => { throw new Error('a runner must not reconcile DNS'); },
      },
      randomLabel: () => 'elowen-probe',
    }),
    controlLookups,
    warnings,
  };
};

test('a runner with no gateway broker still knows where its sites live', () => {
  // The bug this pins: the hostname was read only through the privileged control, so the SAME instance
  // reported an address from the daemon and "this instance has no HTTPS domain" from every tool call.
  const harness = runnerHarness();

  assert.equal(harness.manager.hasBroker(), false, 'a runner holds no broker');
  assert.equal(harness.manager.hostnameBase(), HOSTNAME_BASE);
  assert.ok(harness.controlLookups.includes('publishedSitesGateway'),
    'the broker is still asked first — it is the authority wherever it exists');
});

test('a runner builds the same site address the daemon would print for the same site', () => {
  // The whole chain, because the hostname base alone is not what an agent reads: SiteCreate and SitePublish
  // refuse outright when `siteHostBase` is null, which is exactly what this produced in a runner.
  const harness = runnerHarness();
  const addresses = new SiteAddressService({
    store: {
      allSites: () => [],
      generatedHostname: () => ({
        id: 'site-1:generated',
        siteId: 'site-1',
        kind: 'generated',
        hostname: `demo-abc123.${HOSTNAME_BASE}`,
        removalRequestedAt: null,
      }),
      customHostnames: () => [],
      hostnameById: () => null,
      siteById: () => null,
    },
    scheme: () => 'https:',
    hostnameBase: () => harness.manager.hostnameBase(),
    previews: () => [],
    previewActive: () => true,
  });

  assert.equal(
    addresses.urlForSite({ id: 'site-1', primaryCustomHostnameId: null }),
    `https://demo-abc123.${HOSTNAME_BASE}/`,
  );
});

test('the broker stays the authority for the hostname wherever it exists', () => {
  // The fallback is for the process that has no broker, never a second opinion over one that does: a daemon
  // whose install metadata says something else must keep saying it.
  const harness = runnerHarness({ broker: { hostnameBase: () => 'sites.installed.example.invalid' } });

  assert.equal(harness.manager.hasBroker(), true);
  assert.equal(harness.manager.hostnameBase(), 'sites.installed.example.invalid');
});

test('an instance with no HTTPS app URL has no site hostname in a runner either', () => {
  for (const url of [null, 'http://agent.example.invalid', 'https://localhost', 'https://dotless']) {
    assert.equal(runnerHarness({ publicWebUrl: url }).manager.hostnameBase(), null, String(url));
  }
});

test('knowing the hostname buys a runner no certificate, and reaches no privileged path', async () => {
  // The address is public information; issuance drives certbot and rewrites this machine's nginx. The first
  // is now derivable in a runner and the second must stay exactly as unreachable as it was.
  const harness = runnerHarness();

  assert.equal(harness.manager.hostnameBase(), HOSTNAME_BASE, 'the address is known');
  await assert.rejects(
    harness.manager.ensureBinding(
      { hostname: `demo-abc123.${HOSTNAME_BASE}`, slug: 'demo-abc123', class: 'generated' },
      [],
    ),
    /No published-sites gateway broker/,
    'issuance refuses in a runner rather than falling back to anything',
  );
  // Removal must also refuse. Treating an absent control as success would let durable deletion discard its
  // retry owner while privileged gateway resources may still exist.
  await assert.rejects(
    harness.manager.removeBinding(`demo-abc123.${HOSTNAME_BASE}`, 'demo-abc123', []),
    /No published-sites gateway broker/,
  );
  assert.deepEqual(harness.warnings, []);
});
