import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { SiteAddressService } from '../plugins/sites/dist/address.js';
import { SiteHostnameCoordinator } from '../plugins/sites/dist/hostnameCoordinator.js';
import { parseSiteHostname } from '../plugins/sites/dist/hostname.js';
import { SitesStore } from '../plugins/sites/dist/store.js';

const BASE = 'sites.example.com';
const START = Date.parse('2026-09-22T06:00:00.000Z');

const makeDb = () => {
  const raw = new Database(':memory:');
  const applied = new Set();
  const handle = { exec: (sql) => raw.exec(sql), prepare: (sql) => raw.prepare(sql) };
  return {
    ...handle,
    migrate(steps) {
      for (const step of [...steps].sort((a, b) => a.version - b.version)) {
        if (applied.has(step.version)) continue;
        raw.transaction(() => { step.up(handle); applied.add(step.version); })();
      }
    },
    appliedVersion: () => Math.max(0, ...applied),
    transaction: (fn) => raw.transaction(fn)(),
  };
};

const site = {
  id: 'site-1',
  slug: 'demo-abc123',
  title: 'Demo',
  summary: '',
  projectId: 7,
  ownerUserId: 1,
  visibility: 'public',
  accessGeneration: 1,
  sourceRel: '',
  spa: false,
  kind: 'proxy',
  target: '3000',
  status: 'live',
  currentReleaseId: null,
  createdAt: new Date(START).toISOString(),
  updatedAt: new Date(START).toISOString(),
  createdModel: 'test/model',
  lastPublishAt: null,
  lastPublishModel: null,
  lastError: null,
  primaryCustomHostnameId: null,
};

const harness = () => {
  let now = START;
  const store = new SitesStore(makeDb(), {
    hostnameBase: BASE,
    now: () => now,
    randomId: () => 'custom-1',
    randomToken: () => 'ownership-token',
  });
  store.insertSite(site);
  const addresses = new SiteAddressService({
    store,
    scheme: () => 'https:',
    hostnameBase: () => BASE,
    previews: () => [],
    previewActive: () => true,
  });
  const order = [];
  let traffic = { state: 'ready', observedTargets: ['192.0.2.10'] };
  let ensureCalls = 0;
  const gateway = {
    verifyHostnameDns: async () => traffic,
    reconcile: async () => { order.push('sync'); return { available: true, active: true, hostnameBase: BASE }; },
    ensureBinding: async (binding) => {
      order.push('ensure');
      ensureCalls += 1;
      return {
        available: true,
        active: true,
        hostnameBase: BASE,
        bindings: [{ hostname: binding.hostname, present: true, notAfter: '2026-12-22T06:00:00.000Z' }],
      };
    },
    hasCertificate: () => true,
    removeBinding: async () => ({ available: true, active: true, hostnameBase: BASE }),
  };
  const ownershipResolver = {
    resolveTxt: async () => [['elowen-site-verification=ownership-token']],
  };
  const coordinator = () => new SiteHostnameCoordinator({
    store,
    gateway,
    addresses,
    ownershipResolver,
    probe: async () => ({ reachable: true, covered: true, detail: 'ready' }),
    now: () => now,
  });
  return {
    store,
    addresses,
    gateway,
    order,
    coordinator,
    setTraffic: (value) => { traffic = value; },
    advance: (ms) => { now += ms; },
    ensureCalls: () => ensureCalls,
  };
};

test('a disconnected custom-domain request is completed from durable state with sync before ensure', async () => {
  const h = harness();
  const claimed = h.store.claimCustomHostname(site.id, parseSiteHostname('www.customer.example'));

  await h.coordinator().checkCustom(claimed);

  const current = h.store.hostnameById(claimed.id);
  assert.notEqual(current.ownershipVerifiedAt, null);
  assert.equal(current.dnsState, 'ready');
  assert.equal(current.certificateState, 'ready');
  assert.deepEqual(h.order, ['sync', 'ensure']);
});

test('DNS backoff remains in the hostname row across coordinator reloads', async () => {
  const h = harness();
  const claimed = h.store.claimCustomHostname(site.id, parseSiteHostname('waiting.customer.example'));
  h.setTraffic({ state: 'missing', observedTargets: [] });

  await h.coordinator().checkCustom(claimed);
  const stored = h.store.hostnameById(claimed.id);
  assert.equal(stored.dnsAttempts, 1);
  assert.equal(Date.parse(stored.dnsNextCheckAt) - START, 60_000);
  assert.deepEqual(h.store.customHostnamesDueForDns(START), []);

  const reloaded = h.coordinator();
  await reloaded.sweep();
  assert.equal(h.store.hostnameById(claimed.id).dnsAttempts, 1, 'reload does not restart or bypass the schedule');

  h.advance(60_000);
  assert.equal(h.store.customHostnamesDueForDns(START + 60_000).length, 1);
});

test('renewal checks DNS first, preserves a valid custom binding, then resumes when DNS returns', async () => {
  const h = harness();
  const claimed = h.store.claimCustomHostname(site.id, parseSiteHostname('renew.customer.example'));
  h.store.verifyHostnameOwnership(claimed.id);
  h.store.recordHostnameDns(claimed.id, 'ready', ['192.0.2.10']);
  h.store.recordHostnameCertificate(claimed.id, {
    state: 'ready',
    notAfter: '2026-12-22T06:00:00.000Z',
  });

  h.setTraffic({ state: 'missing', observedTargets: [] });
  await h.coordinator().checkCustom(h.store.hostnameById(claimed.id), true);
  assert.equal(h.store.hostnameById(claimed.id).certificateState, 'renewal_blocked');
  assert.equal(h.ensureCalls(), 0, 'Certbot seam is not called while renewal DNS is missing');
  assert.equal(h.addresses.effectiveHostname(h.store.siteById(site.id)), 'renew.customer.example');

  h.setTraffic({ state: 'ready', observedTargets: ['192.0.2.10'] });
  await h.coordinator().checkCustom(h.store.hostnameById(claimed.id), true);
  assert.equal(h.ensureCalls(), 1);
  assert.equal(h.store.hostnameById(claimed.id).certificateState, 'ready');
});

test('an expired preferred custom hostname falls back to the generated address', async () => {
  const h = harness();
  const claimed = h.store.claimCustomHostname(site.id, parseSiteHostname('expired.customer.example'));
  h.store.verifyHostnameOwnership(claimed.id);
  h.store.recordHostnameDns(claimed.id, 'ready', ['192.0.2.10']);
  h.store.recordHostnameCertificate(claimed.id, {
    state: 'ready',
    notAfter: '2026-09-21T06:00:00.000Z',
  });

  h.setTraffic({ state: 'missing', observedTargets: [] });
  await h.coordinator().checkCustom(h.store.hostnameById(claimed.id), true);

  assert.equal(h.store.hostnameById(claimed.id).certificateState, 'expired');
  assert.equal(h.addresses.effectiveHostname(h.store.siteById(site.id)), `demo-abc123.${BASE}`);
});
