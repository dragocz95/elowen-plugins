import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiHandlers } from '../plugins/sites/dist/api.js';
import { SiteDomainError } from '../plugins/sites/dist/domains.js';

const target = {
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
  createdAt: '2026-09-22T06:00:00.000Z',
  updatedAt: '2026-09-22T06:00:00.000Z',
  createdModel: 'test/model',
  lastPublishAt: null,
  lastPublishModel: null,
  lastError: null,
  primaryCustomHostnameId: null,
};

const generated = {
  id: 'site-1:generated',
  hostname: 'demo-abc123.sites.example.com',
  displayHostname: 'demo-abc123.sites.example.com',
  url: 'https://demo-abc123.sites.example.com/',
  effective: true,
};

const custom = {
  id: 'domain-1',
  hostname: 'www.customer.example',
  displayHostname: 'www.customer.example',
  url: 'https://www.customer.example/',
  kind: 'subdomain',
  delegatedRootWarning: true,
  status: 'awaiting_ownership',
  statusCode: 'ownership_missing',
  isPrimary: false,
  canOpen: false,
  removalState: 'active',
  ownership: {
    state: 'missing',
    code: 'ownership_missing',
    record: { type: 'TXT', name: '_elowen-site.www.customer.example', value: 'elowen-site-verification=secret' },
    checkedAt: null,
    expiresAt: '2026-09-23T06:00:00.000Z',
  },
  routing: {
    state: 'unchecked',
    code: 'dns_missing',
    hint: 'routingHintSubdomain',
    recommended: [{ type: 'CNAME', name: 'www.customer.example', value: 'elowen.example.' }],
    alternatives: [{ type: 'A', name: 'www.customer.example', value: '192.0.2.10' }],
    observed: [],
    checkedAt: null,
    nextCheckAt: null,
  },
  certificate: {
    state: 'none',
    code: 'certificate_waiting',
    requestedAt: null,
    retryAt: null,
    notAfter: null,
  },
};

const response = { siteId: target.id, effectiveUrl: generated.url, generated, primaryHostnameId: null, domains: [custom] };

const harness = (domainOverrides = {}) => {
  const calls = [];
  const domains = {
    list: async (site) => { calls.push(['list', site.id]); return response; },
    add: async (site, hostname) => { calls.push(['add', site.id, hostname]); return custom; },
    check: async (site, id) => { calls.push(['check', site.id, id]); return custom; },
    makePrimary: async (site, id) => { calls.push(['primary', site.id, id]); return custom; },
    remove: async (site, id) => { calls.push(['remove', site.id, id]); return { removed: true }; },
    ...domainOverrides,
  };
  const handlers = createApiHandlers({
    store: {
      siteById: (id) => id === target.id ? target : null,
      siteBySlug: () => null,
      sitesOwnedBy: () => [],
      sitesSharedWith: () => [],
      sitesInProjects: () => [],
      memberIds: () => [],
      releases: () => [],
      hits: () => [],
    },
    access: {
      accountExists: () => true,
      isAdmin: () => false,
      canAccessProject: () => false,
      allowPublicSites: () => true,
    },
    config: () => ({ allowPublicSites: true }),
    addresses: { urlForSite: () => generated.url },
    domains,
    people: () => new Map(),
    projectSlug: () => 'demo',
    deleteSite: async () => {},
    activateRelease: () => {},
    gatewayReadiness: async () => ({ ok: true, status: 'ready', detail: 'ready' }),
    gatewayRecord: () => null,
  });
  const request = (method, path, body = {}, userId = 1) => ({
    method,
    path,
    auth: { userId, admin: false, accessibleProjects: [] },
    query: {},
    headers: {},
    body: async () => Buffer.alloc(0),
    json: async () => body,
  });
  return { handlers, request, calls };
};

test('manager domain routes expose server-decided views and pass only declared inputs', async () => {
  const h = harness();

  const listed = await h.handlers.site(h.request('GET', 'site-1/domains'));
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body, response);

  const added = await h.handlers.site(h.request('POST', 'site-1/domains', {
    hostname: 'Example.COM.',
    recordType: 'A',
    ownershipToken: 'forged',
  }));
  assert.equal(added.status, 201);
  assert.deepEqual(added.body, { domain: custom });

  assert.equal((await h.handlers.site(h.request('POST', 'site-1/domains/domain-1/check'))).status, 200);
  assert.equal((await h.handlers.site(h.request('POST', 'site-1/domains/domain-1/primary'))).status, 200);
  assert.equal((await h.handlers.site(h.request('DELETE', 'site-1/domains/domain-1'))).status, 200);
  assert.deepEqual(h.calls, [
    ['list', 'site-1'],
    ['add', 'site-1', 'Example.COM.'],
    ['check', 'site-1', 'domain-1'],
    ['primary', 'site-1', 'domain-1'],
    ['remove', 'site-1', 'domain-1'],
  ]);
});

test('domain routes disclose nothing to a viewer who may open but not manage the Site', async () => {
  const h = harness();
  for (const [method, path] of [
    ['GET', 'site-1/domains'],
    ['POST', 'site-1/domains'],
    ['POST', 'site-1/domains/domain-1/check'],
    ['POST', 'site-1/domains/domain-1/primary'],
    ['DELETE', 'site-1/domains/domain-1'],
  ]) {
    const result = await h.handlers.site(h.request(method, path, { hostname: 'customer.example' }, 2));
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { error: 'forbidden' });
  }
  assert.deepEqual(h.calls, []);
});

test('making a not-ready domain primary answers a coded 409 instead of a 500', async () => {
  const h = harness({
    makePrimary: async () => { throw new SiteDomainError(409, 'domain_not_ready'); },
  });
  const result = await h.handlers.site(h.request('POST', 'site-1/domains/domain-1/primary'));
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { error: { code: 'domain_not_ready', params: {} } });
});
