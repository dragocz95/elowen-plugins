import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  mayOpen, mayPublish, normalizeReturnPath, signSession, verifySession, cookieName, readCookies, mintTicket, hashToken,
} from '../plugins/sites/dist/access.js';
import { SitesStore } from '../plugins/sites/dist/store.js';
import { snapshotRelease, resolveWithin, pruneReleases, relativeAssetWarning } from '../plugins/sites/dist/publish.js';
import { createSiteHandler } from '../plugins/sites/dist/serve.js';
import { resolveConfig } from '../plugins/sites/dist/config.js';

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

const makeDb = () => {
  const db = new Database(':memory:');
  let version = 0;
  const handle = { exec: (sql) => db.exec(sql), prepare: (sql) => db.prepare(sql) };
  return {
    ...handle,
    migrate: (steps) => {
      for (const step of steps) if (step.version > version) { step.up(handle); version = step.version; }
    },
    appliedVersion: () => version,
    transaction: (fn) => db.transaction(fn)(),
  };
};

const site = (overrides = {}) => ({
  id: 'site-1',
  slug: 'demo-abc123',
  title: 'Demo',
  summary: '',
  projectId: 7,
  ownerUserId: 1,
  visibility: 'private',
  accessGeneration: 1,
  sourceDir: '/tmp/source',
  spa: false,
  status: 'live',
  currentReleaseId: 'rel-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdModel: 'test/model',
  lastPublishAt: new Date().toISOString(),
  lastPublishModel: 'test/model',
  lastError: null,
  ...overrides,
});

/** Only the store surface an access decision touches. */
const memberStore = (memberIds = []) => ({ isMember: (_siteId, userId) => memberIds.includes(userId) });

const deps = ({ accounts = [1, 2, 3, 9], admins = [9], projects = {} } = {}) => ({
  accountExists: (userId) => accounts.includes(userId),
  isAdmin: (userId) => admins.includes(userId),
  canAccessProject: (userId, projectId) => (projects[userId] ?? []).includes(projectId),
});

const tempDir = (label) => mkdtempSync(join(tmpdir(), `sites-${label}-`));

// ── manifest ─────────────────────────────────────────────────────────────────────────────────────

test('sites manifest and marketplace registry expose the same release', () => {
  const manifest = JSON.parse(readFileSync(new URL('../plugins/sites/elowen-plugin.json', import.meta.url), 'utf8'));
  const registry = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'));
  const catalog = registry.plugins.find((plugin) => plugin.name === 'sites');

  assert.equal(catalog?.version, manifest.version);
  assert.equal(catalog?.requiresCore, manifest.requiresCore);
  assert.equal(catalog?.provides.tools, manifest.provides.tools.length);
  assert.equal(catalog?.provides.apiRoutes, manifest.provides.apiRoutes.length);
  // The mount is namespaced by plugin name, so the declared route is 's' and the public address is
  // /hooks/sites/s/<slug>/. Declaring 'sites' here would serve /hooks/sites/sites/.
  assert.deepEqual(manifest.provides.httpRoutes, ['s']);
  // The host UI contract is 7; a bundle that claims more renders a placeholder instead of the page.
  assert.equal(manifest.web.requiresApiVersion, 7);
  assert.ok(!('userGrantable' in manifest), 'a grant would lock invited guests out of the ticket route');
});

// ── access matrix ────────────────────────────────────────────────────────────────────────────────

test('a public site is open to everyone, including a signed-out visitor', () => {
  const target = site({ visibility: 'public' });
  assert.equal(mayOpen(target, { userId: null, admin: false }, memberStore(), deps()), true);
});

test('a private site admits only its owner and an administrator', () => {
  const target = site({ visibility: 'private', ownerUserId: 1 });
  const store = memberStore();
  const access = deps();
  assert.equal(mayOpen(target, { userId: 1, admin: false }, store, access), true);
  assert.equal(mayOpen(target, { userId: 9, admin: false }, store, access), true, 'admin');
  assert.equal(mayOpen(target, { userId: 2, admin: false }, store, access), false);
  assert.equal(mayOpen(target, { userId: null, admin: false }, store, access), false);
});

test('a project site admits the project members and nobody else', () => {
  const target = site({ visibility: 'project', projectId: 7, ownerUserId: 1 });
  const access = deps({ projects: { 2: [7], 3: [8] } });
  assert.equal(mayOpen(target, { userId: 2, admin: false }, memberStore(), access), true);
  assert.equal(mayOpen(target, { userId: 3, admin: false }, memberStore(), access), false);
});

test('a named guest gets in whatever the visibility says', () => {
  const target = site({ visibility: 'private', ownerUserId: 1 });
  assert.equal(mayOpen(target, { userId: 3, admin: false }, memberStore([3]), deps()), true);
});

test('an account that no longer exists is refused even as a guest', () => {
  const target = site({ visibility: 'authenticated' });
  const access = deps({ accounts: [1, 2] });
  assert.equal(mayOpen(target, { userId: 3, admin: false }, memberStore([3]), access), false);
});

test('publishing can be narrowed to administrators without affecting viewing', () => {
  const access = deps();
  assert.equal(mayPublish(2, access, 'everyone'), true);
  assert.equal(mayPublish(2, access, 'admins'), false);
  assert.equal(mayPublish(9, access, 'admins'), true);
  assert.equal(mayPublish(null, access, 'everyone'), false);
});

// ── session cookie ───────────────────────────────────────────────────────────────────────────────

test('a site session survives a round trip and rejects every tampering', () => {
  const secret = 'unit-test-secret';
  const now = Date.now();
  const value = signSession(secret, { u: 4, g: 2, e: now + 60_000 });

  assert.deepEqual(verifySession(secret, value, now), { u: 4, g: 2, e: now + 60_000 });
  assert.equal(verifySession('another-secret', value, now), null, 'wrong key');
  assert.equal(verifySession(secret, value, now + 120_000), null, 'expired');
  assert.equal(verifySession(secret, `${value}x`, now), null, 'mutated signature');
  assert.equal(verifySession(secret, value.replace(/^./, 'A'), now), null, 'mutated payload');
  assert.equal(verifySession(secret, 'nonsense', now), null);
  assert.equal(verifySession(secret, undefined, now), null);
  // A shorter signature must not pass by comparing only its own length.
  const [body] = value.split('.');
  assert.equal(verifySession(secret, `${body}.AAAA`, now), null);
});

test('a cookie header keeps the most specific value and ignores junk', () => {
  const cookies = readCookies('elowen_session=app; elowen_site_abc=first; elowen_site_abc=second; broken');
  assert.equal(cookies.elowen_site_abc, 'first');
  assert.equal(cookies.elowen_session, 'app');
});

test('cookie names are stable and site-specific', () => {
  assert.notEqual(cookieName('a-b-c'), cookieName('a-b-d'));
  assert.match(cookieName('11111111-2222-3333-4444-555555555555'), /^elowen_site_[a-f0-9]+$/);
});

// ── return path ──────────────────────────────────────────────────────────────────────────────────

test('a return path can never leave the site', () => {
  assert.equal(normalizeReturnPath('reports/q3.html'), 'reports/q3.html');
  assert.equal(normalizeReturnPath('/reports/q3.html'), 'reports/q3.html');
  assert.equal(normalizeReturnPath('a.html?x=1'), 'a.html?x=1');
  for (const hostile of [
    'https://evil.example/', '//evil.example/', 'javascript:alert(1)', '..%2f..%2fetc',
    '../secrets', 'a/../../b', 'a\\b', 'a\0b', '__elowen/session', 'x'.repeat(600),
  ]) {
    assert.equal(normalizeReturnPath(hostile), '', `expected ${hostile} to collapse to the site root`);
  }
});

// ── store ────────────────────────────────────────────────────────────────────────────────────────

test('a ticket can be redeemed exactly once', () => {
  const store = new SitesStore(makeDb());
  const { token, tokenHash } = mintTicket();
  store.putTicket(tokenHash, { siteId: 'site-1', userId: 4, returnPath: 'a.html', expiresAt: Date.now() + 60_000 });

  const first = store.takeTicket(hashToken(token), Date.now());
  assert.equal(first?.userId, 4);
  assert.equal(first?.returnPath, 'a.html');
  assert.equal(store.takeTicket(hashToken(token), Date.now()), null, 'a replayed ticket is refused');
});

test('an expired ticket is refused and consumed', () => {
  const store = new SitesStore(makeDb());
  const { token, tokenHash } = mintTicket();
  store.putTicket(tokenHash, { siteId: 'site-1', userId: 4, returnPath: '', expiresAt: Date.now() - 1 });
  assert.equal(store.takeTicket(hashToken(token), Date.now()), null);
  assert.equal(store.takeTicket(hashToken(token), Date.now()), null);
});

test('changing who may open a site invalidates the sessions already issued', () => {
  const store = new SitesStore(makeDb());
  store.insertSite(site());
  assert.equal(store.siteById('site-1').accessGeneration, 1);
  store.addMember('site-1', 5);
  store.bumpAccessGeneration('site-1');
  assert.equal(store.siteById('site-1').accessGeneration, 2);
  store.removeMember('site-1', 5);
  store.bumpAccessGeneration('site-1');
  assert.equal(store.siteById('site-1').accessGeneration, 3);
});

test('deleting a site removes its guests, releases, tickets and visits', () => {
  const store = new SitesStore(makeDb());
  store.insertSite(site());
  store.addMember('site-1', 2);
  store.insertRelease({ id: 'rel-1', siteId: 'site-1', createdAt: new Date().toISOString(), model: 'm', fileCount: 1, sizeBytes: 1, note: '' });
  store.putTicket('hash', { siteId: 'site-1', userId: 2, returnPath: '', expiresAt: Date.now() + 1000 });
  store.recordHits('site-1', '2026-01-01', 3);

  store.deleteSite('site-1');
  assert.equal(store.siteById('site-1'), null);
  assert.deepEqual(store.memberIds('site-1'), []);
  assert.deepEqual(store.releases('site-1'), []);
  assert.equal(store.takeTicket('hash', Date.now()), null);
  assert.deepEqual(store.hits('site-1', '2000-01-01'), []);
});

test('forgetting a removed account reports every site whose access changed', () => {
  const store = new SitesStore(makeDb());
  store.insertSite(site());
  store.insertSite(site({ id: 'site-2', slug: 'other-def456' }));
  store.addMember('site-1', 5);
  store.addMember('site-2', 5);
  assert.deepEqual(store.forgetMemberEverywhere(5).sort(), ['site-1', 'site-2']);
  assert.deepEqual(store.memberIds('site-1'), []);
});

// ── publishing ───────────────────────────────────────────────────────────────────────────────────

test('a snapshot copies the output and refuses what it must not follow', (t) => {
  const source = tempDir('src');
  const release = tempDir('rel');
  t.after(() => { rmSync(source, { recursive: true, force: true }); rmSync(release, { recursive: true, force: true }); });

  writeFileSync(join(source, 'index.html'), '<!doctype html><title>ok</title>');
  writeFileSync(join(source, 'app.css'), 'body{color:red}');
  mkdirSync(join(source, 'node_modules'));
  writeFileSync(join(source, 'node_modules', 'huge.js'), 'x');
  const secret = join(source, 'secret.txt');
  writeFileSync(secret, 'not for publishing');
  symlinkSync('/etc/passwd', join(source, 'escape.html'));

  const result = snapshotRelease(source, join(release, 'r1'), { maxAssetBytes: 1048576, maxTotalBytes: 10485760 });

  assert.equal(result.fileCount, 3, 'index.html, app.css and secret.txt; node_modules is skipped');
  assert.ok(result.warnings.some((line) => line.includes('symlink')), 'the symlink is reported, not followed');
  assert.throws(() => readFileSync(join(release, 'r1', 'escape.html')), 'the symlink target was not copied');
});

test('a snapshot refuses a file above the configured ceiling', (t) => {
  const source = tempDir('big');
  const release = tempDir('bigrel');
  t.after(() => { rmSync(source, { recursive: true, force: true }); rmSync(release, { recursive: true, force: true }); });
  writeFileSync(join(source, 'index.html'), 'x'.repeat(2048));
  assert.throws(
    () => snapshotRelease(source, join(release, 'r1'), { maxAssetBytes: 1024, maxTotalBytes: 10485760 }),
    /above the per-file limit/,
  );
});

test('relative asset references are reported rather than rewritten', (t) => {
  const release = tempDir('warn');
  t.after(() => rmSync(release, { recursive: true, force: true }));
  const html = '<!doctype html><script src="./assets/app.js"></script>';
  writeFileSync(join(release, 'index.html'), html);
  assert.match(relativeAssetWarning(release, '/hooks/sites/s/demo/'), /base path/);
  assert.equal(readFileSync(join(release, 'index.html'), 'utf8'), html, 'the output is left exactly as built');
});

test('retention never removes the release a site is serving', () => {
  const store = new SitesStore(makeDb());
  const dir = tempDir('prune');
  store.insertSite(site());
  for (const id of ['rel-1', 'rel-2', 'rel-3', 'rel-4']) {
    store.insertRelease({ id, siteId: 'site-1', createdAt: new Date(Date.parse('2026-01-01') + Number(id.slice(4)) * 1000).toISOString(), model: '', fileCount: 1, sizeBytes: 1, note: '' });
  }
  pruneReleases(store, 'site-1', dir, 2, 'rel-1');
  const kept = store.releases('site-1').map((release) => release.id);
  assert.ok(kept.includes('rel-1'), 'the live release survives retention');
  assert.equal(kept.length, 2);
  rmSync(dir, { recursive: true, force: true });
});

test('a request path cannot escape the release directory', (t) => {
  const release = tempDir('within');
  t.after(() => rmSync(release, { recursive: true, force: true }));
  writeFileSync(join(release, 'index.html'), 'ok');
  mkdirSync(join(release, 'sub'));
  symlinkSync('/etc', join(release, 'sub', 'etc'));

  assert.ok(resolveWithin(release, 'index.html'));
  assert.equal(resolveWithin(release, '../../etc/passwd'), null);
  assert.equal(resolveWithin(release, 'sub/etc/passwd'), null, 'a symlink cannot widen the release');
  assert.equal(resolveWithin(release, 'a\0b'), null);
});

// ── serving ──────────────────────────────────────────────────────────────────────────────────────

const serveHarness = (t, overrides = {}) => {
  const release = tempDir('serve');
  t.after(() => rmSync(release, { recursive: true, force: true }));
  writeFileSync(join(release, 'index.html'), '<!doctype html><title>demo</title>');
  writeFileSync(join(release, 'app.css'), 'body{}');

  const store = new SitesStore(makeDb());
  store.insertSite(site(overrides));

  const handler = createSiteHandler({
    store,
    access: deps({ projects: { 2: [7] } }),
    secret: () => 'serve-secret',
    config: () => ({
      siteBaseUrl: 'https://elowen.example',
      appBaseUrl: 'https://elowen.example',
      dedicatedHost: false,
      sessionTtlHours: 12,
    }),
    releaseDir: () => release,
    countHit: () => {},
  });
  return { handler, store, release };
};

const request = (path, extra = {}) => ({
  method: 'GET',
  path,
  query: {},
  headers: { accept: 'text/html' },
  body: async () => Buffer.alloc(0),
  json: async () => ({}),
  ...extra,
});

test('an unknown slug and a slug you may not see answer identically', async (t) => {
  const { handler } = serveHarness(t, { visibility: 'private' });
  const unknown = await handler(request('never-taken-000000/'));
  const forbidden = await handler(request('demo-abc123/', { headers: { accept: 'application/json' } }));
  assert.equal(unknown.status, 404);
  assert.equal(forbidden.status, 404);
  assert.equal(unknown.body, forbidden.body);
});

test('a browser without a session is sent to the app to sign in', async (t) => {
  const { handler } = serveHarness(t, { visibility: 'project' });
  const response = await handler(request('demo-abc123/reports/q3.html'));
  assert.equal(response.status, 302);
  assert.match(response.headers.location, /^https:\/\/elowen\.example\/p\/sites\/enter\?/);
  assert.match(response.headers.location, /site=demo-abc123/);
  assert.match(response.headers.location, /r=reports%2Fq3\.html/);
});

test('a public site is served without any session at all', async (t) => {
  const { handler } = serveHarness(t, { visibility: 'public' });
  const response = await handler(request('demo-abc123/'));
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(response.headers['cache-control'], /public/);
  assert.equal(response.headers['x-robots-tag'], undefined);
});

test('a non-public response is never shared-cacheable and is not indexed', async (t) => {
  const { handler, store } = serveHarness(t, { visibility: 'authenticated' });
  const target = store.siteBySlug('demo-abc123');
  const cookie = `${cookieName(target.id)}=${signSession('serve-secret', { u: 2, g: target.accessGeneration, e: Date.now() + 60_000 })}`;
  const response = await handler(request('demo-abc123/', { headers: { accept: 'text/html', cookie } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.match(response.headers['x-robots-tag'], /noindex/);
});

test('a page on the shared origin may not run scripts', async (t) => {
  const { handler } = serveHarness(t, { visibility: 'public' });
  const response = await handler(request('demo-abc123/'));
  const csp = response.headers['content-security-policy'];
  assert.match(csp, /^sandbox;/, 'an opaque origin keeps the page away from the app session');
  assert.ok(!csp.includes('allow-scripts'));
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});

test('a stale session generation stops working the moment access changes', async (t) => {
  const { handler, store } = serveHarness(t, { visibility: 'authenticated' });
  const target = store.siteBySlug('demo-abc123');
  const cookie = `${cookieName(target.id)}=${signSession('serve-secret', { u: 2, g: target.accessGeneration, e: Date.now() + 60_000 })}`;
  assert.equal((await handler(request('demo-abc123/', { headers: { cookie, accept: 'text/html' } }))).status, 200);

  store.bumpAccessGeneration(target.id);
  const after = await handler(request('demo-abc123/', { headers: { cookie, accept: 'text/html' } }));
  assert.equal(after.status, 302, 'the old cookie no longer proves anything');
});

test('the reserved endpoint prefix cannot be served as site content', async (t) => {
  const { handler } = serveHarness(t, { visibility: 'public' });
  assert.equal((await handler(request('demo-abc123/__elowen/anything'))).status, 404);
  assert.equal((await handler(request('demo-abc123/__elowen/session'))).status, 405, 'the session endpoint is POST only');
});

test('a HEAD answer carries the headers and no body', async (t) => {
  const { handler } = serveHarness(t, { visibility: 'public' });
  const response = await handler(request('demo-abc123/', { method: 'HEAD' }));
  assert.equal(response.status, 200);
  assert.equal(response.body, '');
  assert.match(response.headers['content-type'], /text\/html/);
});

test('redeeming a ticket sets a path-scoped cookie and lands on the requested page', async (t) => {
  const { handler, store } = serveHarness(t, { visibility: 'authenticated' });
  const target = store.siteBySlug('demo-abc123');
  const { token, tokenHash } = mintTicket();
  store.putTicket(tokenHash, { siteId: target.id, userId: 2, returnPath: 'app.css', expiresAt: Date.now() + 60_000 });

  const response = await handler(request('demo-abc123/__elowen/session', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: async () => Buffer.from(`t=${encodeURIComponent(token)}`),
  }));

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, 'https://elowen.example/hooks/sites/s/demo-abc123/app.css');
  const cookie = response.headers['set-cookie'];
  assert.match(cookie, new RegExp(`^${cookieName(target.id)}=`));
  assert.match(cookie, /Path=\/hooks\/sites\/s\/demo-abc123\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
});

test('a ticket for another site cannot be redeemed here', async (t) => {
  const { handler, store } = serveHarness(t, { visibility: 'authenticated' });
  const { token, tokenHash } = mintTicket();
  store.putTicket(tokenHash, { siteId: 'some-other-site', userId: 2, returnPath: '', expiresAt: Date.now() + 60_000 });
  const response = await handler(request('demo-abc123/__elowen/session', {
    method: 'POST',
    body: async () => Buffer.from(`t=${encodeURIComponent(token)}`),
  }));
  assert.equal(response.status, 404);
});

// ── configuration ────────────────────────────────────────────────────────────────────────────────

test('configuration is re-validated, because the settings API validates nothing', () => {
  const config = resolveConfig({
    defaultVisibility: 'public',
    maxAssetMb: 99999,
    maxSiteMb: -3,
    sessionTtlHours: 'nonsense',
    releasesKept: 0,
    publishers: 'whatever',
  }, 'https://elowen.example');

  assert.equal(config.defaultVisibility, 'private', 'public is not an allowed default');
  assert.equal(config.maxAssetBytes, 64 * 1048576, 'clamped to the declared maximum');
  assert.equal(config.maxSiteBytes, 1048576, 'clamped to the declared minimum');
  assert.equal(config.sessionTtlHours, 12);
  assert.equal(config.releasesKept, 1);
  assert.equal(config.publishers, 'everyone');
});

test('a dedicated hostname changes the origin and lets a site run scripts', () => {
  const shared = resolveConfig({}, 'https://elowen.example');
  assert.equal(shared.dedicatedHost, false);
  assert.equal(shared.siteBaseUrl, 'https://elowen.example');

  const dedicated = resolveConfig({ siteHostOverride: 'https://sites.example.com/ignored/path' }, 'https://elowen.example');
  assert.equal(dedicated.dedicatedHost, true);
  assert.equal(dedicated.siteBaseUrl, 'https://sites.example.com');
  assert.equal(dedicated.appBaseUrl, 'https://elowen.example');

  // A hostname that is not an absolute origin cannot be turned into a link and must not silently become one.
  assert.equal(resolveConfig({ siteHostOverride: 'sites.example.com' }, 'https://elowen.example').dedicatedHost, false);
  assert.equal(resolveConfig({ siteHostOverride: 'javascript:alert(1)' }, 'https://elowen.example').dedicatedHost, false);
});
