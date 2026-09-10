import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SitesStore } from '../plugins/sites/dist/store.js';
import { ProjectPreviewService } from '../plugins/sites/dist/preview.js';
import { createSiteHandler } from '../plugins/sites/dist/serve.js';
import { createApiHandlers } from '../plugins/sites/dist/api.js';
import { cookieName, signSession } from '../plugins/sites/dist/access.js';
import { resolveConfig } from '../plugins/sites/dist/config.js';

function harness(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const handle = { exec: sql => db.exec(sql), prepare: sql => db.prepare(sql) };
  const store = new SitesStore({ ...handle, migrate: steps => steps.forEach(step => step.up(handle)), transaction: fn => db.transaction(fn)() });
  const members = new Set([7]);
  const access = { accountExists: id => [7, 8, 99].includes(id), isAdmin: id => id === 99, canAccessProject: (id, projectId) => projectId === 11 && members.has(id) };
  let available = true, active = true, proxy = async () => ({ status: 200, headers: {}, body: 'project application' });
  const calls = [], removed = [], issued = [];
  let released = 0;
  const control = { projectPreviewBinding: async input => {
    calls.push(input);
    return { projectId: input.project.projectId, generation: 3, port: input.port, socketPath: '/private/project-preview.sock', release: async () => { released++; } };
  } };
  const config = () => ({ ...resolveConfig({}, 'https://app.example', 'sites.example'), gatewayToken: 'gateway-proof' });
  const service = new ProjectPreviewService({ store, access, project: id => id === 11 && active ? { executionKind: 'managed', lifecycle: 'active' } : null,
    control: () => available ? control : undefined, config,
    gateway: { ensureSite: async slug => { issued.push(slug); }, removeSite: async slug => { removed.push(slug); } },
    proxyLimits: () => ({ maxResponseBytes: 1024, requestTimeoutSeconds: 1 }), usernameOf: () => 'member', proxy: (...args) => proxy(...args),
  });
  const handler = createSiteHandler({ store, access, config, previews: service, secret: () => 'session-secret', countHit: () => {},
    releaseDir: () => { throw new Error('preview must not read host releases'); }, endpointFor: () => { throw new Error('preview must acquire the SDK binding'); },
    usernameOf: () => 'member', proxyLimits: () => ({ maxResponseBytes: 1024, requestTimeoutSeconds: 1 }),
  });
  const request = (slug, userId = 7, headers = {}) => {
    const site = service.siteBySlug(slug);
    return handler({ method: 'GET', path: `${slug}/page`, query: {}, headers: { host: `${slug}.sites.example`, 'x-elowen-site-gateway': 'gateway-proof',
      cookie: `${cookieName(site.id)}=${signSession('session-secret', { u: userId, g: site.accessGeneration, e: Date.now() + 60000 })}`, ...headers }, body: new Uint8Array() });
  };
  return { store, members, service, request, calls, removed, issued, config, access, released: () => released,
    unavailable: () => { available = false; }, deactivate: () => { active = false; }, setProxy: fn => { proxy = fn; } };
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
  assert.equal((await h.request(slug)).status, 503);
  await assert.rejects(h.service.request(11, 8080, 7), /unavailable/);
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
  const handlers = createApiHandlers({ store: h.store, access: h.access, config: h.config, previewSite: name => h.service.siteBySlug(name) });
  const req = { method: 'POST', auth: { userId: 7, admin: false, accessibleProjects: [11] }, json: async () => ({ slug, r: '/page' }) };
  assert.equal((await handlers.ticket(req)).status, 200);
  h.members.delete(7);
  assert.equal((await handlers.ticket(req)).status, 403);
});

test('Project cleanup removes only preview addresses and keeps independently published resources', async t => {
  const h = harness(t);
  const { url } = await h.service.request(11, 8080, 7);
  const slug = new URL(url).hostname.split('.')[0];
  h.store.insertSite({ ...h.service.siteBySlug(slug), id: 'published', slug: 'published-site', kind: 'static', target: '', runtime: 'static', ownerUserId: 7, sourceDir: '/published/source' });
  await h.service.removeProject(11);
  assert.equal(h.service.siteBySlug(slug), null);
  assert.ok(h.store.siteById('published'));
  assert.deepEqual(h.removed, [slug]);
});
