import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SitesStore } from '../plugins/sites/dist/store.js';
import { ProjectPreviewService } from '../plugins/sites/dist/preview.js';
import { createSiteHandler } from '../plugins/sites/dist/serve.js';
import { createApiHandlers } from '../plugins/sites/dist/api.js';
import { cookieName, signSession } from '../plugins/sites/dist/access.js';
import { resolveConfig } from '../plugins/sites/dist/config.js';
import { SiteAddressService } from '../plugins/sites/dist/address.js';

function harness(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const handle = { exec: sql => db.exec(sql), prepare: sql => db.prepare(sql) };
  const store = new SitesStore(
    {
      ...handle,
      migrate: steps => steps.forEach(step => step.up(handle)),
      appliedVersion: () => 21,
      transaction: fn => db.transaction(fn)(),
    },
    { hostnameBase: 'sites.example' },
  );
  const members = new Set([7]);
  const access = { accountExists: id => [7, 8, 99].includes(id), isAdmin: id => id === 99, canAccessProject: (id, projectId) => projectId === 11 && members.has(id), allowPublicSites: () => true };
  let available = true, active = true, proxy = async () => ({ status: 200, headers: {}, body: 'project application' });
  const calls = [], removed = [], issued = [];
  let released = 0;
  let removeError = null;
  const control = { projectPreviewBinding: async input => {
    calls.push(input);
    return { projectId: input.project.projectId, generation: 3, port: input.port, socketPath: '/private/project-preview.sock', release: async () => { released++; } };
  } };
  const config = () => ({ ...resolveConfig({}, 'https://app.example', 'sites.example'), gatewayToken: 'gateway-proof' });
  const addresses = new SiteAddressService({
    store,
    scheme: () => 'https:',
    hostnameBase: () => 'sites.example',
    previews: () => store.allPreviews(),
    previewActive: id => id === 11 && active,
  });
  const gateway = {
    reconcile: async () => ({ available: true, active: true, hostnameBase: 'sites.example' }),
    ensureBinding: async binding => { issued.push(binding.hostname); },
    removeBinding: async hostname => {
      removed.push(hostname);
      if (removeError) throw removeError;
    },
    hasCertificate: () => false,
  };
  const service = new ProjectPreviewService({ store, access, project: id => id === 11 && active ? { executionKind: 'managed', lifecycle: 'active' } : null,
    control: () => available ? control : undefined, config, addresses, gateway,
    proxyLimits: () => ({ maxResponseBytes: 1024, requestTimeoutSeconds: 1 }), usernameOf: () => 'member', proxy: (...args) => proxy(...args),
  });
  const handler = createSiteHandler({
    store,
    access,
    config: () => ({ appBaseUrl: 'https://app.example', sessionTtlHours: 12, gatewayToken: 'gateway-proof' }),
    addresses,
    previews: service,
    secret: () => 'session-secret',
    countHit: () => {},
    releaseDir: () => { throw new Error('preview must not read host releases'); }, endpointFor: () => { throw new Error('preview must acquire the SDK binding'); },
    usernameOf: () => 'member', proxyLimits: () => ({ maxResponseBytes: 1024, requestTimeoutSeconds: 1 }),
  });
  const request = (slug, userId = 7, headers = {}) => {
    const site = service.siteBySlug(slug);
    return handler({ method: 'GET', path: `${slug}/page`, query: {}, headers: { host: `${slug}.sites.example`, 'x-elowen-site-gateway': 'gateway-proof',
      cookie: `${cookieName(site.id)}=${signSession('session-secret', { u: userId, g: site.accessGeneration, e: Date.now() + 60000 })}`, ...headers }, body: new Uint8Array() });
  };
  return { store, members, service, request, calls, removed, issued, config, addresses, access, released: () => released,
    unavailable: () => { available = false; }, deactivate: () => { active = false; },
    setProxy: fn => { proxy = fn; }, setRemoveError: error => { removeError = error; } };
}

test('preview is a separate origin, shares only current membership and never becomes a published Site', async t => {
  const h = harness(t);
  const link = await h.service.request(11, 8080, 7);
  const slug = new URL(link.url).hostname.split('.')[0];
  assert.equal(new URL(link.url).origin === 'https://app.example', false);
  assert.equal(h.store.allSites().length, 0);
  assert.equal(h.released(), 1);
  assert.equal((await h.request(slug)).status, 200);
  assert.equal((await h.request(slug, 8)).status === 200, false);
  h.members.delete(7);
  assert.equal((await h.request(slug, 7)).status === 200, false, 'the creating account has no ownership bypass');
  assert.equal((await h.request(slug, 99)).status, 200);
  assert.equal(h.released(), h.calls.length);
});

test('application-origin and forged-gateway requests never acquire a preview lease', async t => {
  const h = harness(t);
  const { url } = await h.service.request(11, 8080, 7);
  const slug = new URL(url).hostname.split('.')[0];
  const count = h.calls.length;
  assert.equal((await h.request(slug, 7, { host: 'app.example' })).status === 200, false);
  assert.equal((await h.request(slug, 7, { 'x-elowen-site-gateway': 'forged' })).status === 200, false);
  assert.equal(h.calls.length, count);
});

test('revocation during a buffered response discards it and releases the SDK binding', async t => {
  const h = harness(t);
  const { url } = await h.service.request(11, 8080, 7);
  const slug = new URL(url).hostname.split('.')[0];
  h.setProxy(async () => { h.members.delete(7); return { status: 200, body: 'private result' }; });
  const response = await h.request(slug);
  assert.equal(response.status, 404);
  assert.equal(response.body.includes('private result'), false);
  assert.equal(h.released(), h.calls.length);
});

test('SDK unavailability and application failure are explicit, with no host fallback or leaked lease', async t => {
  const h = harness(t);
  const { url } = await h.service.request(11, 8080, 7);
  const slug = new URL(url).hostname.split('.')[0];
  h.setProxy(async () => { throw new Error('application stopped'); });
  assert.equal((await h.request(slug)).status, 503);
  assert.equal(h.released(), h.calls.length);
  h.unavailable();
  // A visitor's request still answers 503: naming a plugin they cannot switch on would not help them.
  assert.equal((await h.request(slug)).status, 503);
  // Asking for a preview is an operator action, so it gets the shared refusal that names what to switch on.
  await assert.rejects(h.service.request(11, 8080, 7), /Sandbox plugin, which is not enabled/);
});

test('a preview answers through the preview record, never through a publication transport', async t => {
  // The preview view says `kind: 'proxy'` because that is how a preview is served, and this harness's
  // publication lookup THROWS: if the kind were consulted before the preview record, every preview
  // request would fail here instead of reaching the Project application.
  const h = harness(t);
  const { url } = await h.service.request(11, 8080, 7);
  const slug = new URL(url).hostname.split('.')[0];
  assert.equal(h.service.siteBySlug(slug).kind, 'proxy');

  const response = await h.request(slug);
  assert.equal(response.status, 200);
  assert.equal(String(response.body), 'project application');
  assert.equal(h.released(), h.calls.length, 'the preview still releases every binding it takes');
});

test('preview tickets use the existing handshake and recheck current Project access', async t => {
  const h = harness(t);
  const { url } = await h.service.request(11, 8080, 7);
  const slug = new URL(url).hostname.split('.')[0];
  const handlers = createApiHandlers({
    store: h.store,
    access: h.access,
    config: h.config,
    addresses: h.addresses,
    previewSite: name => h.service.siteBySlug(name),
  });
  const binding = h.addresses.bindings().find(entry => entry.slug === slug);
  const req = {
    method: 'POST',
    auth: { userId: 7, admin: false, accessibleProjects: [11] },
    json: async () => ({ binding: binding.id, r: '/page' }),
  };
  assert.equal((await handlers.ticket(req)).status, 200);
  h.members.delete(7);
  assert.equal((await handlers.ticket(req)).status, 403);
});

test('failed preview gateway cleanup keeps the durable preview record for retry', async t => {
  const h = harness(t);
  const { url } = await h.service.request(11, 8080, 7);
  const slug = new URL(url).hostname.split('.')[0];
  h.setRemoveError(new Error('gateway cleanup failed'));

  await assert.rejects(h.service.removeProject(11), /gateway cleanup failed/);
  assert.notEqual(h.service.siteBySlug(slug), null);
});

test('Project cleanup removes only preview addresses and keeps independently published resources', async t => {
  const h = harness(t);
  const { url } = await h.service.request(11, 8080, 7);
  const slug = new URL(url).hostname.split('.')[0];
  h.store.insertSite({ ...h.service.siteBySlug(slug), id: 'published', slug: 'published-site', kind: 'static', target: '', runtime: 'static', ownerUserId: 7, sourceRel: 'sites/published-site' });
  await h.service.removeProject(11);
  assert.equal(h.service.siteBySlug(slug), null);
  assert.ok(h.store.siteById('published'));
  assert.deepEqual(h.removed, [`${slug}.sites.example`]);
});
