import assert from 'node:assert/strict';
import test from 'node:test';

import { SiteAddressService } from '../plugins/sites/dist/address.js';

const site = {
  id: 'site-a',
  slug: 'alpha-abc123',
  status: 'live',
  primaryCustomHostnameId: 'custom-ready',
};

const generated = {
  id: 'site-a:generated',
  siteId: site.id,
  kind: 'generated',
  hostname: 'alpha-abc123.sites.example.com',
  ownershipVerifiedAt: null,
  dnsState: 'unchecked',
  certificateState: 'ready',
  certificateNotAfter: null,
  removalRequestedAt: null,
};

const custom = (overrides) => ({
  id: 'custom-ready',
  siteId: site.id,
  kind: 'custom',
  hostname: 'www.customer.example',
  ownershipVerifiedAt: '2026-09-22T06:00:00.000Z',
  dnsState: 'ready',
  certificateState: 'ready',
  certificateNotAfter: null,
  removalRequestedAt: null,
  ...overrides,
});

const harness = (customRows = [custom({})], siteOverrides = {}) => {
  const sites = [{ ...site, ...siteOverrides }, {
    ...site,
    id: 'site-b',
    slug: 'bravo-def456',
    primaryCustomHostnameId: null,
  }];
  const generatedRows = new Map([
    [site.id, generated],
    ['site-b', { ...generated, id: 'site-b:generated', siteId: 'site-b', hostname: 'bravo-def456.sites.example.com' }],
  ]);
  const store = {
    allSites: () => sites,
    generatedHostname: (siteId) => generatedRows.get(siteId) ?? null,
    customHostnames: (siteId) => siteId === site.id ? customRows : [],
    hostnameById: (id) => [...generatedRows.values(), ...customRows].find((row) => row.id === id) ?? null,
    siteById: (id) => sites.find((entry) => entry.id === id) ?? null,
  };
  return new SiteAddressService({
    store,
    scheme: () => 'https:',
    hostnameBase: () => 'sites.example.com',
    previews: () => [],
    previewActive: () => true,
  });
};

test('binding snapshots contain only live Sites and ready custom routing candidates', () => {
  const addresses = harness([
    custom({ id: 'ownership-pending', ownershipVerifiedAt: null, dnsState: 'ready' }),
    custom({ id: 'dns-pending', hostname: 'dns.customer.example', dnsState: 'missing', certificateState: 'none' }),
    custom({ id: 'ready', hostname: 'ready.customer.example' }),
  ]);

  assert.deepEqual(addresses.bindings().map((binding) => binding.hostname).sort(), [
    'alpha-abc123.sites.example.com',
    'bravo-def456.sites.example.com',
    'ready.customer.example',
  ]);
  assert.deepEqual(harness([], { status: 'draft' }).bindings().map((binding) => binding.siteId), ['site-b']);
});

test('renewal-blocked custom bindings remain served while valid and expired primary addresses fall back', () => {
  const blocked = custom({ certificateState: 'renewal_blocked', dnsState: 'missing' });
  const addresses = harness([blocked]);
  assert.equal(addresses.effectiveHostname(site), blocked.hostname);
  assert.ok(addresses.bindings().some((binding) => binding.hostname === blocked.hostname));

  const expired = harness([custom({ certificateState: 'expired', dnsState: 'missing' })]);
  assert.equal(expired.effectiveHostname(site), generated.hostname);
  assert.ok(!expired.bindings().some((binding) => binding.hostname === 'www.customer.example'));

  const staleReady = harness([custom({ certificateNotAfter: '2020-01-01T00:00:00.000Z' })]);
  assert.equal(staleReady.effectiveHostname(site), generated.hostname);
});

test('request binding requires the exact active Host and internal slug to identify the same Site', () => {
  const addresses = harness();
  assert.equal(addresses.bindingForRequest(site.slug, 'www.customer.example')?.siteId, site.id);
  assert.equal(addresses.bindingForRequest(site.slug, 'WWW.CUSTOMER.EXAMPLE:443')?.siteId, site.id);
  assert.equal(addresses.bindingForRequest('bravo-def456', 'www.customer.example'), null,
    'a hostname for Site A cannot authorize Site B by changing the internal route');
  assert.equal(addresses.bindingForRequest(site.slug, 'www.customer.example:443:junk'), null);
  assert.equal(addresses.bindingForRequest(site.slug, 'www.customer.example.'), null);

  const withoutGeneratedBinding = harness();
  withoutGeneratedBinding.deps.store.generatedHostname = () => null;
  assert.equal(withoutGeneratedBinding.bindingForRequest(site.slug, generated.hostname), null,
    'a generated-looking Host without a durable active binding stays concealed');
});
