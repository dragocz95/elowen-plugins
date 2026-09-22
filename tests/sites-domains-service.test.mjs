import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { SiteAddressService } from '../plugins/sites/dist/address.js';
import { SiteDomainError, SiteDomainService } from '../plugins/sites/dist/domains.js';
import { SitesStore } from '../plugins/sites/dist/store.js';

const BASE = 'sites.example.com';
const NOW = Date.parse('2026-09-22T06:00:00.000Z');

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
  visibility: 'private',
  accessGeneration: 1,
  sourceRel: '',
  spa: false,
  kind: 'proxy',
  target: '3000',
  status: 'live',
  currentReleaseId: null,
  createdAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
  createdModel: 'test/model',
  lastPublishAt: null,
  lastPublishModel: null,
  lastError: null,
  primaryCustomHostnameId: null,
};

const harness = (coordinatorOverrides = {}) => {
  let n = 0;
  const store = new SitesStore(makeDb(), {
    hostnameBase: BASE,
    now: () => NOW,
    randomId: () => 'domain-' + (++n),
    randomToken: () => 'secret-token-' + n,
  });
  store.insertSite(site);
  const addresses = new SiteAddressService({
    store,
    scheme: () => 'https:',
    hostnameBase: () => BASE,
    previews: () => [],
    previewActive: () => true,
  });
  const gateway = {
    hostnameBase: () => BASE,
    reservedHostnames: () => ['reserved.example'],
    recordPlan: async (hostname) => ({
      state: 'ready',
      hostname: hostname.ascii,
      kind: hostname.kind,
      delegatedRootWarning: hostname.delegatedRootWarning,
      preferred: hostname.kind === 'root'
        ? [{ type: 'ALIAS/ANAME', name: hostname.ascii, value: 'edge.example.' }]
        : [{ type: 'CNAME', name: hostname.ascii, value: 'edge.example.' }],
      fallback: [{ type: 'A', name: hostname.ascii, value: '192.0.2.44' }],
    }),
  };
  const coordinator = {
    checkCustom: async () => {},
    cleanupRemoved: async () => {},
    ...coordinatorOverrides,
  };
  const service = new SiteDomainService({
    store,
    addresses,
    gateway,
    coordinator,
    appHostname: () => 'elowen.example',
    gatewayHostname: () => 'edge.example',
  });
  return { store, service };
};

test('the server returns canonical names and exact root/subdomain record plans without browser derivation', async () => {
  const h = harness();
  const root = await h.service.add(site, 'Customer.Example.');
  const subdomain = await h.service.add(site, 'www.customer.example');

  assert.deepEqual(root.ownership.record, {
    type: 'TXT',
    name: '_elowen-site.customer.example',
    value: 'elowen-site-verification=secret-token-1',
  });
  assert.equal(root.hostname, 'customer.example');
  assert.equal(root.kind, 'root');
  assert.equal(root.routing.hint, 'routingHintRoot');
  assert.deepEqual(root.routing.recommended, [
    { type: 'ALIAS/ANAME', name: 'customer.example', value: 'edge.example.' },
  ]);
  assert.deepEqual(root.routing.alternatives, [
    { type: 'A', name: 'customer.example', value: '192.0.2.44' },
  ]);

  assert.equal(subdomain.kind, 'subdomain');
  assert.equal(subdomain.routing.hint, 'routingHintSubdomain');
  assert.deepEqual(subdomain.routing.recommended, [
    { type: 'CNAME', name: 'www.customer.example', value: 'edge.example.' },
  ]);
});

test('domain projection covers every setup, certificate and removal state', async () => {
  const scenarios = [
    ['awaiting_ownership', (store, row) => store.recordHostnameOwnership(row.id, 'missing', [])],
    ['awaiting_routing', (store, row) => {
      store.verifyHostnameOwnership(row.id);
      store.recordHostnameDns(row.id, 'missing', []);
    }],
    ['misdirected', (store, row) => {
      store.verifyHostnameOwnership(row.id);
      store.recordHostnameDns(row.id, 'misdirected', ['203.0.113.9']);
    }],
    ['issuing', (store, row) => {
      store.verifyHostnameOwnership(row.id);
      store.recordHostnameDns(row.id, 'ready', ['192.0.2.44']);
      store.recordHostnameCertificate(row.id, { state: 'issuing' });
    }],
    ['ready', (store, row) => {
      store.verifyHostnameOwnership(row.id);
      store.recordHostnameDns(row.id, 'ready', ['192.0.2.44']);
      store.recordHostnameCertificate(row.id, { state: 'ready', notAfter: '2026-12-22T06:00:00.000Z' });
    }],
    ['authority_refused', (store, row) => {
      store.verifyHostnameOwnership(row.id);
      store.recordHostnameDns(row.id, 'ready', ['192.0.2.44']);
      store.recordHostnameCertificate(row.id, { state: 'authority_refused', errorCode: 'authority_refused', errorDetail: 'CAA refused issuance' });
    }],
    ['rate_limited', (store, row) => {
      store.verifyHostnameOwnership(row.id);
      store.recordHostnameDns(row.id, 'ready', ['192.0.2.44']);
      store.recordHostnameCertificate(row.id, { state: 'rate_limited', errorCode: 'rate_limited', retryAt: '2026-09-22T07:00:00.000Z' });
    }],
    ['renewal_blocked', (store, row) => {
      store.verifyHostnameOwnership(row.id);
      store.recordHostnameDns(row.id, 'misdirected', ['203.0.113.9']);
      store.recordHostnameCertificate(row.id, {
        state: 'renewal_blocked',
        errorCode: 'renewal_dns_misdirected',
        notAfter: '2026-10-22T06:00:00.000Z',
      });
    }],
    ['expired', (store, row) => {
      store.verifyHostnameOwnership(row.id);
      store.recordHostnameDns(row.id, 'missing', []);
      store.recordHostnameCertificate(row.id, {
        state: 'expired',
        errorCode: 'certificate_expired',
        notAfter: '2026-09-21T06:00:00.000Z',
      });
    }],
    ['removing', (store, row) => store.requestHostnameRemoval(row.id)],
  ];

  for (const [expected, arrange] of scenarios) {
    const h = harness();
    const row = h.store.claimCustomHostname(site.id, {
      ascii: 'state.customer.example',
      unicode: 'state.customer.example',
      kind: 'subdomain',
      delegatedRootWarning: true,
    });
    arrange(h.store, row);
    const view = await h.service.list(h.store.siteById(site.id));
    assert.equal(view.domains[0].status, expected);
  }
});

test('first ready domain becomes primary while later ready domains remain secondary and generated stays visible', async () => {
  const h = harness();
  const first = h.store.claimCustomHostname(site.id, {
    ascii: 'first.customer.example', unicode: 'first.customer.example', kind: 'subdomain', delegatedRootWarning: true,
  });
  const second = h.store.claimCustomHostname(site.id, {
    ascii: 'second.customer.example', unicode: 'second.customer.example', kind: 'subdomain', delegatedRootWarning: true,
  });
  for (const row of [first, second]) {
    h.store.verifyHostnameOwnership(row.id);
    h.store.recordHostnameDns(row.id, 'ready', ['192.0.2.44']);
    h.store.recordHostnameCertificate(row.id, { state: 'ready', notAfter: '2026-12-22T06:00:00.000Z' });
  }

  const view = await h.service.list(h.store.siteById(site.id));
  assert.equal(view.generated.hostname, 'demo-abc123.sites.example.com');
  assert.equal(view.primaryHostnameId, first.id);
  assert.equal(view.domains.find((domain) => domain.id === first.id).isPrimary, true);
  assert.equal(view.domains.find((domain) => domain.id === second.id).isPrimary, false);
});

test('remove keeps the durable cleanup request and surfaces gateway cleanup failures', async () => {
  const failure = new Error('gateway cleanup failed');
  const h = harness({ cleanupRemoved: async () => { throw failure; } });
  const claimed = h.store.claimCustomHostname(site.id, {
    ascii: 'remove.customer.example', unicode: 'remove.customer.example', kind: 'subdomain', delegatedRootWarning: true,
  });

  await assert.rejects(() => h.service.remove(site, claimed.id), failure);
  assert.notEqual(h.store.hostnameById(claimed.id).removalRequestedAt, null);
});

test('claim failures expose only stable codes and bounded parameters', async () => {
  const h = harness();
  await assert.rejects(() => h.service.add(site, 'https://bad.example/path'),
    (error) => error instanceof SiteDomainError && error.code === 'invalid_hostname');
  await assert.rejects(() => h.service.add(site, 'reserved.example'),
    (error) => error instanceof SiteDomainError && error.code === 'reserved_hostname');

  await h.service.add(site, 'taken.customer.example');
  const second = harness();
  second.store.claimCustomHostname(site.id, {
    ascii: 'taken.customer.example', unicode: 'taken.customer.example', kind: 'subdomain', delegatedRootWarning: true,
  });
  await assert.rejects(() => second.service.add(site, 'taken.customer.example'),
    (error) => error instanceof SiteDomainError && error.code === 'domain_claimed' && !JSON.stringify(error).includes('site-1'));
});
