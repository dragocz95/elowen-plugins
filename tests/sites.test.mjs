import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

import {
  mayOpen, mayPublish, normalizeReturnPath, signSession, verifySession, cookieName, readCookies, mintTicket, hashToken,
} from '../plugins/sites/dist/access.js';
import { SitesStore } from '../plugins/sites/dist/store.js';
import { snapshotRelease, resolveWithin, pruneReleases, relativeAssetWarning } from '../plugins/sites/dist/publish.js';
import { createSiteHandler } from '../plugins/sites/dist/serve.js';
import { resolveConfig, resolveGatewayDnsTarget, siteUrl, requestOnSiteHost, SITE_BASE_PATH } from '../plugins/sites/dist/config.js';
import { proxyToEnvironment, proxyToRuntime, ProxyError } from '../plugins/sites/dist/proxy.js';
import { registerTools } from '../plugins/sites/dist/tools.js';
import { createApiHandlers } from '../plugins/sites/dist/api.js';
import { ProjectPublicationService } from '../plugins/sites/dist/publication.js';

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
  kind: 'static',
  target: '',
  runtime: 'static',
  startCommand: '',
  bind: 'socket',
  port: null,
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
  // The "environment support is unavailable" copy names that same floor to the administrator reading it.
  // It drifted once already, telling operators to reach a core release the plugin no longer accepts.
  const provisioning = readFileSync(new URL('../plugins/sites/src/provisioning.ts', import.meta.url), 'utf8');
  assert.ok(
    provisioning.includes(`Sites requires core ${manifest.requiresCore} and`),
    `the unavailable copy must name core ${manifest.requiresCore}, the manifest's own floor`,
  );
  assert.equal(catalog?.provides.tools, manifest.provides.tools.length);
  assert.equal(catalog?.provides.apiRoutes, manifest.provides.apiRoutes.length);
  // The mount is namespaced by plugin name, so the declared route is 's' and the public address is
  // /hooks/sites/s/<slug>/. Declaring 'sites' here would serve /hooks/sites/sites/.
  assert.deepEqual(manifest.provides.httpRoutes, ['s']);
  // The host UI contract is 12; a bundle that claims more renders a placeholder instead of the page.
  assert.equal(manifest.web.requiresApiVersion, 12);
  assert.ok(!('userGrantable' in manifest), 'a grant would lock invited guests out of the ticket route');
  const indexSource = readFileSync(new URL('../plugins/sites/src/index.ts', import.meta.url), 'utf8');
  assert.match(indexSource, /siteImageStatus\(\{ imageKind: 'base' \}\)/,
    'base-image readiness must use the Sandbox control exposed by the required core');
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

test('replacing site members is atomic and bumps access generation once', () => {
  const store = new SitesStore(makeDb());
  store.insertSite(site());
  store.addMember('site-1', 2);
  store.replaceMembers('site-1', [3, 3]);
  assert.deepEqual(store.memberIds('site-1'), [3]);
  assert.equal(store.siteById('site-1').accessGeneration, 2);
});

test('deletion is durable, immediately invisible and safe to finish after a crash', () => {
  const store = new SitesStore(makeDb());
  store.insertSite(site());
  store.addMember('site-1', 2);
  store.insertRelease({ id: 'rel-1', siteId: 'site-1', createdAt: new Date().toISOString(), model: 'm', fileCount: 1, sizeBytes: 1, note: '' });
  store.putTicket('hash', { siteId: 'site-1', userId: 2, returnPath: '', expiresAt: Date.now() + 1000 });
  store.recordHits('site-1', '2026-01-01', 3);

  store.beginDelete('site-1');
  assert.equal(store.siteById('site-1').status, 'deleting');
  assert.deepEqual(store.sitesOwnedBy(1), [], 'the owner list loses it before filesystem cleanup');
  assert.deepEqual(store.deletingSites().map((entry) => entry.id), ['site-1']);
  assert.deepEqual(store.memberIds('site-1'), []);
  assert.equal(store.takeTicket('hash', Date.now()), null);
  assert.deepEqual(store.hits('site-1', '2000-01-01'), []);
  assert.equal(store.slugTaken('demo-abc123'), true, 'a retry cannot reuse the hostname while cleanup is pending');
  assert.equal(store.releases('site-1').length, 1, 'release metadata stays until its files were removed');

  // What boot reconciliation does after a crash between the marker and filesystem cleanup.
  store.deleteSite('site-1');
  assert.equal(store.siteById('site-1'), null);
  assert.deepEqual(store.releases('site-1'), []);
  assert.equal(store.slugTaken('demo-abc123'), false);

  // Create → delete → create may reuse the friendly stem safely because the old row is truly gone.
  store.insertSite(site({ id: 'site-2', slug: 'demo-abc123' }));
  assert.equal(store.siteBySlug('demo-abc123').id, 'site-2');
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

test('a release file larger than the copy buffer is copied whole', (t) => {
  // The copier used to allocate one buffer the size of the file, which is the other half of the memory
  // ceiling: a release may now hold an asset far larger than the daemon's heap.
  const source = tempDir('big-src');
  const release = tempDir('big-rel');
  t.after(() => { rmSync(source, { recursive: true, force: true }); rmSync(release, { recursive: true, force: true }); });

  const bytes = Buffer.alloc(9 * 1048576);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251; // not uniform: a short copy would show
  // Exactly two whole chunks: the loop has to stop on the size it was given rather than on a short read.
  const aligned = Buffer.alloc(8 * 1048576, 0x41);
  writeFileSync(join(source, 'index.html'), '<!doctype html><title>ok</title>');
  writeFileSync(join(source, 'movie.mp4'), bytes);
  writeFileSync(join(source, 'aligned.mp4'), aligned);
  writeFileSync(join(source, 'empty.css'), '');

  const target = join(release, 'r1');
  const result = snapshotRelease(source, target, { maxAssetBytes: 64 * 1048576, maxTotalBytes: 128 * 1048576 });
  assert.equal(result.fileCount, 4);
  assert.deepEqual(readFileSync(join(target, 'movie.mp4')), bytes);
  assert.deepEqual(readFileSync(join(target, 'aligned.mp4')), aligned);
  assert.equal(readFileSync(join(target, 'empty.css')).length, 0, 'an empty file survives the chunked copy');
  assert.equal(result.sizeBytes, bytes.length + aligned.length + 32);
});

test('a command snapshot preserves executable files and contained relative symlinks', (t) => {
  const source = tempDir('command-src');
  const release = tempDir('command-rel');
  t.after(() => { rmSync(source, { recursive: true, force: true }); rmSync(release, { recursive: true, force: true }); });

  mkdirSync(join(source, 'bin'), { recursive: true });
  writeFileSync(join(source, 'bin', 'server.js'), 'console.log("ok")');
  chmodSync(join(source, 'bin', 'server.js'), 0o755);
  symlinkSync('server.js', join(source, 'bin', 'start.js'));
  symlinkSync('../../outside', join(source, 'bin', 'escape.js'));

  const target = join(release, 'r1');
  const result = snapshotRelease(source, target, {
    maxAssetBytes: 1048576,
    maxTotalBytes: 10485760,
    mode: 'command',
  });

  assert.equal(result.fileCount, 2, 'the file and safe symlink count as release entries');
  assert.equal(lstatSync(join(target, 'bin', 'server.js')).mode & 0o111, 0o111, 'executable bits survive publish');
  assert.equal(lstatSync(join(target, 'bin', 'start.js')).isSymbolicLink(), true);
  assert.equal(readlinkSync(join(target, 'bin', 'start.js')), 'server.js');
  assert.ok(result.warnings.some((line) => line.includes('escape.js')));
  assert.equal(lstatSync(join(target, 'bin', 'escape.js'), { throwIfNoEntry: false }), undefined);
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
  // A site owns the root of its own hostname, so the base path handed to a build is always '/'. The
  // warning still matters: a relative reference resolves against the address the visitor opened, so it
  // survives the root and 404s on every deeper route.
  assert.match(relativeAssetWarning(release, SITE_BASE_PATH), /base path \//);
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

const GATEWAY_TOKEN = 'g'.repeat(43);

const serveHarness = (t, overrides = {}, handlerDeps = {}) => {
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
      siteHostBase: overrides.siteHostBase ?? 'sites.example.com',
      siteScheme: 'https:',
      appBaseUrl: 'https://elowen.example',
      sessionTtlHours: 12,
      gatewayToken: GATEWAY_TOKEN,
    }),
    releaseDir: () => release,
    countHit: () => {},
    endpointFor: () => null,
    proxyLimits: () => ({ maxResponseBytes: 1048576, requestTimeoutSeconds: 5 }),
    usernameOf: () => 'amy',
    ...handlerDeps,
  });
  return { handler, store, release };
};

/** A request as the site gateway delivers it: on the site's OWN hostname and carrying the marker nginx
 *  overwrites. Both are required to be served at all, so they are the default here and a test that cares
 *  about one of them overrides it explicitly. */
const request = (path, extra = {}) => {
  const slug = path.replace(/^\/+/, '').split('/')[0];
  return {
    method: 'GET',
    path,
    query: {},
    body: async () => Buffer.alloc(0),
    json: async () => ({}),
    // What every daemon carrying the streaming seam reports. A test about an OLDER daemon overrides it
    // with undefined, which is exactly what such a daemon passes.
    acceptsStreamBody: true,
    ...extra,
    headers: {
      accept: 'text/html',
      host: `${slug}.sites.example.com`,
      'x-elowen-site-gateway': GATEWAY_TOKEN,
      ...extra.headers,
    },
  };
};

test('an unknown slug and a slug you may not see answer identically', async (t) => {
  // Same method, same headers: anything that differs here is a directory of what exists on the
  // instance, which is exactly what a private site must not publish.
  const { handler } = serveHarness(t, { visibility: 'private' });
  const unknown = await handler(request('never-taken-000000/'));
  const forbidden = await handler(request('demo-abc123/'));
  assert.equal(unknown.status, forbidden.status);
  assert.equal(unknown.headers.location, forbidden.headers.location?.replace('demo-abc123', 'never-taken-000000'));

  const unknownFetch = await handler(request('never-taken-000000/', { headers: { accept: 'application/json' } }));
  const forbiddenFetch = await handler(request('demo-abc123/', { headers: { accept: 'application/json' } }));
  assert.equal(unknownFetch.status, 404);
  assert.equal(forbiddenFetch.status, 404);
  assert.equal(unknownFetch.body, forbiddenFetch.body);
});

test('a site marked for deletion is a flat tombstone, not a sign-in bounce', async (t) => {
  const { handler, store } = serveHarness(t, { visibility: 'project' });
  store.beginDelete('site-1');
  const response = await handler(request('demo-abc123/', { headers: { accept: 'text/html' } }));
  assert.equal(response.status, 404);
  assert.equal(response.headers.location, undefined);
});

test('the app hostname does not serve published pages at all', async (t) => {
  // The decision follows the REQUEST, and there is no second serving mode to fall into. `/hooks/` is
  // proxied to the daemon on the app hostname too, so answering there would put an agent-authored page
  // same-origin with the app session cookie.
  const { handler } = serveHarness(t, { visibility: 'public' });

  const viaApp = await handler(request('demo-abc123/', { headers: { host: 'elowen.example' } }));
  assert.equal(viaApp.status, 421);
  assert.ok(!viaApp.headers['content-security-policy'].includes('allow-same-origin'));

  // A neighbouring site's hostname is not this site's origin either.
  const viaNeighbour = await handler(request('demo-abc123/', { headers: { host: 'other.sites.example.com' } }));
  assert.equal(viaNeighbour.status, 421);

  // The Host header alone proves nothing: it is the caller who writes it. Without the marker nginx
  // overwrites, a loopback request claiming the site hostname gets the same answer as a free slug.
  const directBypass = await handler(request('demo-abc123/', { headers: { 'x-elowen-site-gateway': undefined } }));
  assert.equal(directBypass.status, 404, 'the site host answers only behind the root-owned nginx marker');

  const wrongMarker = await handler(request('demo-abc123/', { headers: { 'x-elowen-site-gateway': 'x'.repeat(43) } }));
  assert.equal(wrongMarker.status, 404);
});

test('an application refuses to answer on the app hostname rather than render broken', async (t) => {
  const { handler } = serveHarness(t, {
    visibility: 'public', runtime: 'command', startCommand: 'node server.js', siteHostBase: 'sites.example.com',
  });
  const response = await handler(request('demo-abc123/', { headers: { accept: 'text/html', host: 'elowen.example' } }));
  assert.equal(response.status, 421);
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

test('a site is a real origin: scripts run, and nothing outside the site is reachable', async (t) => {
  const { handler } = serveHarness(t, { visibility: 'public' });
  const response = await handler(request('demo-abc123/'));
  const csp = response.headers['content-security-policy'];

  assert.ok(!csp.startsWith('sandbox'), 'the hostname IS the isolation; sandboxing it again would break its own storage');
  assert.match(csp, /script-src 'self' 'unsafe-inline'/);
  assert.match(csp, /connect-src 'self' https: wss:/, 'browser applications may call public APIs and secure sockets');
  assert.match(csp, /img-src 'self' data: blob: https:/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-robots-tag'], undefined, 'a public site may be indexed');

  const missing = await handler(request('demo-abc123/missing.html'));
  assert.equal(missing.status, 404);
  assert.match(missing.headers['content-security-policy'], /default-src 'self'/);
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
  // Answered from the directory entry: the length is stated without the file ever being opened.
  assert.equal(response.headers['content-length'], '34');
});

// ── streaming a published file ───────────────────────────────────────────────────────────────────

/** Whatever shape the body came back in, as text. */
const bodyText = async (body) => {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

test('a published file is streamed off the disk instead of read into the daemon', async (t) => {
  const { handler, release } = serveHarness(t, { visibility: 'public' });
  writeFileSync(join(release, 'movie.mp4'), 'x'.repeat(4096));
  const response = await handler(request('demo-abc123/movie.mp4'));
  assert.equal(response.status, 200);
  assert.ok(response.body instanceof ReadableStream, 'the body is a stream, not a copy of the file');
  assert.equal(response.headers['content-type'], 'video/mp4');
  assert.equal(response.headers['content-length'], '4096');
  assert.equal(response.headers['accept-ranges'], 'bytes');
  assert.equal((await bodyText(response.body)).length, 4096);
});

test('the SPA fallback document is streamed the same way', async (t) => {
  const { handler } = serveHarness(t, { visibility: 'public', spa: true });
  const response = await handler(request('demo-abc123/deep/route'));
  assert.equal(response.status, 200);
  assert.ok(response.body instanceof ReadableStream);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(await bodyText(response.body), /demo/);
});

test('a range request is answered with just that slice', async (t) => {
  const { handler, release } = serveHarness(t, { visibility: 'public' });
  writeFileSync(join(release, 'movie.mp4'), 'abcdefghij');
  const response = await handler(request('demo-abc123/movie.mp4', { headers: { range: 'bytes=2-5' } }));
  assert.equal(response.status, 206);
  assert.equal(response.headers['content-range'], 'bytes 2-5/10');
  assert.equal(response.headers['content-length'], '4');
  assert.equal(await bodyText(response.body), 'cdef');

  const suffix = await handler(request('demo-abc123/movie.mp4', { headers: { range: 'bytes=-3' } }));
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers['content-range'], 'bytes 7-9/10');
  assert.equal(await bodyText(suffix.body), 'hij');

  // A range nobody can satisfy is refused with the file's size, not with a wrong slice.
  const beyond = await handler(request('demo-abc123/movie.mp4', { headers: { range: 'bytes=99-' } }));
  assert.equal(beyond.status, 416);
  assert.equal(beyond.headers['content-range'], 'bytes */10');

  // Anything this handler does not parse — a multi-range ask — falls back to the whole file, which is
  // a legal answer to any range request.
  const multi = await handler(request('demo-abc123/movie.mp4', { headers: { range: 'bytes=0-1,4-5' } }));
  assert.equal(multi.status, 200);
  assert.equal(await bodyText(multi.body), 'abcdefghij');

  // A range answer is still a published response: it carries the same security headers as the page.
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.ok(response.headers['content-security-policy']);
  assert.equal(beyond.headers['x-content-type-options'], 'nosniff');
});

test('a range over an empty file is refused instead of crashing the handler', async (t) => {
  // A build that emits a zero-byte .css and a client asking for its last byte: the slice arithmetic
  // used to hand createReadStream an end before its start, which throws out of the whole handler.
  const { handler, release } = serveHarness(t, { visibility: 'public' });
  writeFileSync(join(release, 'empty.css'), '');
  const suffix = await handler(request('demo-abc123/empty.css', { headers: { range: 'bytes=-1' } }));
  assert.equal(suffix.status, 416);
  assert.equal(suffix.headers['content-range'], 'bytes */0');
  assert.equal((await handler(request('demo-abc123/empty.css', { headers: { range: 'bytes=0-' } }))).status, 416);

  // Without a range the empty file is served as an empty body, not refused.
  const whole = await handler(request('demo-abc123/empty.css'));
  assert.equal(whole.status, 200);
  assert.equal(whole.headers['content-length'], '0');
  assert.equal(await bodyText(whole.body), '');
});

// The plugin ships separately from the daemon: one build has to behave on an instance that predates the
// streaming seam, where a stream body would be JSON-serialized into '{}'.
test('an older daemon still gets a buffered body below the old ceiling', async (t) => {
  const { handler, release } = serveHarness(t, { visibility: 'public' });
  writeFileSync(join(release, 'small.css'), 'body{color:red}');
  const response = await handler(request('demo-abc123/small.css', { acceptsStreamBody: undefined }));
  assert.equal(response.status, 200);
  assert.ok(response.body instanceof Uint8Array, 'no stream is handed to a daemon that cannot send one');
  assert.equal(await bodyText(response.body), 'body{color:red}');
  assert.equal(response.headers['accept-ranges'], undefined, 'ranges are not advertised without streaming');
});

test('an older daemon refuses a file above the old ceiling rather than buffering it', async (t) => {
  const { handler, release } = serveHarness(t, { visibility: 'public' });
  const huge = join(release, 'huge.mp4');
  writeFileSync(huge, '');
  truncateSync(huge, 64 * 1048576 + 1); // sparse: the size is what the decision reads
  const response = await handler(request('demo-abc123/huge.mp4', { acceptsStreamBody: undefined }));
  assert.equal(response.status, 503);
  assert.match(String(response.body), /too large/i);

  // The same file on a daemon that streams is served without ever being held in memory.
  const streamed = await handler(request('demo-abc123/huge.mp4'));
  assert.equal(streamed.status, 200);
  assert.equal(streamed.headers['content-length'], String(64 * 1048576 + 1));
  streamed.body.cancel();
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
  assert.equal(response.headers.location, 'https://demo-abc123.sites.example.com/app.css');
  const cookie = response.headers['set-cookie'];
  assert.match(cookie, new RegExp(`^${cookieName(target.id)}=`));
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /SameSite=Lax/);
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

// ── runtime proxy ────────────────────────────────────────────────────────────────────────────────

/** A real HTTP server on a unix socket, so the proxy is exercised over the transport it actually uses. */
const runtimeServer = async (t, handler) => {
  const dir = tempDir('sock');
  const path = join(dir, 'app.sock');
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(path, resolve));
  t.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });
  return { kind: 'socket', path };
};

const portRuntimeServer = async (t, handler) => {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  t.after(() => server.close());
  return { kind: 'port', port: address.port };
};

const proxyLimits = { maxResponseBytes: 1048576, requestTimeoutSeconds: 5 };
const SITE_ROOT = 'https://demo.sites.example.com/';

test('a dedicated runtime receives its own application auth but not forged gateway identity', async (t) => {
  let seen = null;
  const endpoint = await runtimeServer(t, (req, res) => { seen = req.headers; res.end('ok'); });

  await proxyToRuntime(endpoint, request('', {
    headers: {
      accept: 'text/html',
      cookie: 'site_session=abc',
      authorization: 'Bearer site-api-token',
      'x-elowen-user-id': '999',
      'x-forwarded-for': '10.0.0.1',
    },
  }), 'page', { userId: 4, name: 'amy' }, proxyLimits, SITE_ROOT);

  assert.equal(seen.cookie, 'site_session=abc');
  assert.equal(seen.authorization, 'Bearer site-api-token');
  assert.equal(seen['x-forwarded-for'], undefined);
  assert.equal(seen['x-elowen-user-id'], '4', 'the spoofed value was replaced by the verified one');
  assert.equal(seen['x-elowen-user-name'], 'amy');
});

test('a Project application receives its own cookies but not the Sites access cookie', async (t) => {
  let seen = null;
  const endpoint = await runtimeServer(t, (req, res) => { seen = req.headers; res.end('ok'); });
  const accessCookie = cookieName('site-1');

  await proxyToEnvironment(endpoint, request('', {
    headers: { cookie: `app_session=abc; ${accessCookie}=signed-access; preference=compact` },
  }), '', { userId: 4, name: 'amy' }, proxyLimits, SITE_ROOT, accessCookie);

  assert.equal(seen.cookie, 'app_session=abc; preference=compact');
});

test('the runtime proxy reaches an explicitly allocated loopback port', async (t) => {
  const endpoint = await portRuntimeServer(t, (_req, res) => res.end('port-ok'));
  const response = await proxyToRuntime(endpoint, request(''), '', { userId: null, name: null }, proxyLimits, SITE_ROOT);
  assert.equal(Buffer.from(response.body).toString(), 'port-ok');
});

test('a runtime owns cookies and CORS on its isolated origin', async (t) => {
  const endpoint = await runtimeServer(t, (_req, res) => {
    res.setHeader('set-cookie', [
      'site_session=xyz; Domain=.sites.example.com; Path=/; HttpOnly',
      'second_cookie=ignored; Path=/',
    ]);
    res.setHeader('access-control-allow-origin', 'https://client.example');
    res.setHeader('content-type', 'text/plain');
    res.end('body');
  });

  const response = await proxyToRuntime(endpoint, request(''), '', { userId: null, name: null }, proxyLimits, SITE_ROOT);
  assert.deepEqual(response.headers['set-cookie'], [
    'site_session=xyz; Path=/; HttpOnly',
    'second_cookie=ignored; Path=/',
  ]);
  assert.equal(response.headers['set-cookie'][0].includes('Domain='), false, 'one site cannot plant a parent-domain cookie for its neighbours');
  assert.equal(response.headers['access-control-allow-origin'], 'https://client.example');
  assert.equal(response.headers['content-type'], 'text/plain');
  assert.equal(Buffer.from(response.body).toString(), 'body');
});

test('an anonymous visitor is forwarded as anonymous', async (t) => {
  let seen = null;
  const endpoint = await runtimeServer(t, (req, res) => { seen = req.headers; res.end('ok'); });
  await proxyToRuntime(endpoint, request(''), '', { userId: null, name: null }, proxyLimits, SITE_ROOT);
  assert.equal(seen['x-elowen-user-id'], undefined);
});

test('a runtime cannot bounce a visitor off its origin', async (t) => {
  const redirectTo = async (location) => {
    const endpoint = await runtimeServer(t, (_req, res) => { res.statusCode = 302; res.setHeader('location', location); res.end(); });
    const response = await proxyToRuntime(endpoint, request(''), '', { userId: null, name: null }, proxyLimits, SITE_ROOT);
    return response.headers.location;
  };
  assert.equal(await redirectTo('page.html'), 'page.html', 'a relative target stays as written');
  assert.equal(await redirectTo(`${SITE_ROOT}deep/page.html`), `${SITE_ROOT}deep/page.html`);
  assert.equal(await redirectTo('https://evil.example/'), SITE_ROOT);
  assert.equal(await redirectTo('//evil.example/'), SITE_ROOT);
  assert.equal(await redirectTo('/etc/passwd'), `${SITE_ROOT}etc/passwd`, 'an absolute path stays on this site origin');
});

test('the body length sent on is the body actually sent', async (t) => {
  let seen = null;
  const endpoint = await runtimeServer(t, (req, res) => {
    seen = { length: req.headers['content-length'], encoding: req.headers['accept-encoding'] };
    res.end('ok');
  });
  await proxyToRuntime(endpoint, request('', {
    method: 'POST',
    headers: { 'content-length': '9999', 'accept-encoding': 'gzip' },
    body: async () => Buffer.from('hello'),
  }), '', { userId: null, name: null }, proxyLimits, SITE_ROOT);
  assert.equal(seen.length, '5', 'the client-declared length was replaced by the real one');
  assert.equal(seen.encoding, 'identity', 'a compressed answer would arrive without the header explaining it');
});

test('a runtime answering with more than the limit is refused, not truncated', async (t) => {
  const endpoint = await runtimeServer(t, (_req, res) => { res.end('x'.repeat(4096)); });
  await assert.rejects(
    () => proxyToRuntime(endpoint, request(''), '', { userId: null, name: null }, { maxResponseBytes: 1024, requestTimeoutSeconds: 5 }, SITE_ROOT),
    ProxyError,
  );
});

test('a command site that is not running says so instead of serving its files', async (t) => {
  const { handler } = serveHarness(t, {
    visibility: 'public', runtime: 'command', startCommand: 'node server.js', siteHostBase: 'sites.example.com',
  });
  const response = await handler(request('demo-abc123/', {
    headers: { accept: 'text/html', host: 'demo-abc123.sites.example.com', 'x-elowen-site-gateway': GATEWAY_TOKEN },
  }));
  assert.equal(response.status, 503);
  assert.match(String(response.body), /not running/i);
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
    runtimeNetwork: 'shared',
    allowLoopbackPorts: true,
    loopbackPortMin: 43010,
    loopbackPortMax: 43000,
  }, 'https://elowen.example');

  assert.equal(config.defaultVisibility, 'private', 'public is not an allowed default');
  assert.equal(config.maxAssetBytes, 99999 * 1048576, 'inside the declared maximum, which is now the disk');
  assert.equal(config.maxSiteBytes, 1048576, 'clamped to the declared minimum');
  assert.equal(config.sessionTtlHours, 12);
  assert.equal(config.releasesKept, 1);
  assert.equal(config.publishers, 'everyone');
  assert.equal(config.runtimeNetwork, 'shared');
  assert.equal(config.allowLoopbackPorts, true);
  assert.deepEqual([config.loopbackPortMin, config.loopbackPortMax], [41000, 41999], 'an inverted range falls back as one unit');
});

test('the largest-file ceiling and the settings field agree, and both are disk-sized', () => {
  const manifest = JSON.parse(readFileSync(new URL('../plugins/sites/elowen-plugin.json', import.meta.url), 'utf8'));
  const field = manifest.configSchema.find((entry) => entry.key === 'maxAssetMb');
  // A field the form allows but the plugin clamps away is a setting that silently does nothing, so the
  // two ceilings are asserted against each other rather than each against a literal.
  assert.equal(field.max, 1048576);
  assert.equal(resolveConfig({ maxAssetMb: field.max }, 'https://elowen.example').maxAssetBytes, field.max * 1048576);
  assert.equal(resolveConfig({ maxAssetMb: field.max + 1 }, 'https://elowen.example').maxAssetBytes, field.max * 1048576);
  // Nothing buffers a published file any more, so the per-file ceiling is no smaller than the per-site one.
  assert.ok(field.max >= manifest.configSchema.find((entry) => entry.key === 'maxSiteMb').max);
});

test('every site gets the root of the gateway hostname derived by core', () => {
  // No broker hostname is not a second addressing mode: there is simply no address, and every caller
  // has to say so rather than invent one on the app's own origin.
  const unprovisioned = resolveConfig({}, 'https://elowen.example');
  assert.equal(unprovisioned.siteHostBase, null);
  assert.equal(siteUrl(unprovisioned, 'demo'), null);
  assert.equal(requestOnSiteHost(unprovisioned, 'demo', 'demo.sites.elowen.example'), false);

  const dedicated = resolveConfig({}, 'https://elowen.example', 'sites.elowen.example');
  assert.equal(dedicated.siteHostBase, 'sites.elowen.example');
  assert.equal('gatewayDnsTarget' in dedicated, false, 'the DNS destination is resolved once, where the gateway uses it');
  assert.equal(siteUrl(dedicated, 'demo'), 'https://demo.sites.elowen.example/');
  assert.equal(requestOnSiteHost(dedicated, 'demo', 'demo.sites.elowen.example:443'), true);
  assert.equal(requestOnSiteHost(dedicated, 'demo', 'elowen.example'), false);
  assert.equal(requestOnSiteHost(dedicated, 'demo', 'other.sites.elowen.example'), false);

  // A Host is one hostname and at most one numeric port. Reading only up to the first colon would call
  // each of these the site's own address, which is an identity decision made on an unvalidated string.
  assert.equal(requestOnSiteHost(dedicated, 'demo', 'demo.sites.elowen.example:not-a-port'), false);
  assert.equal(requestOnSiteHost(dedicated, 'demo', 'demo.sites.elowen.example:443:junk'), false);
  assert.equal(requestOnSiteHost(dedicated, 'demo', 'demo.sites.elowen.example.'), false, 'a trailing dot is a different name');
  assert.equal(requestOnSiteHost(dedicated, 'demo', 'DEMO.Sites.Elowen.Example:8443'), true, 'a hostname is case-insensitive');

  // A broker hostname is only accepted beside the trusted HTTPS app deployment.
  assert.equal(resolveConfig({}, 'http://elowen.example', 'sites.elowen.example').siteHostBase, null);
  assert.equal(resolveConfig({}, 'https://elowen.example', 'javascript:alert(1)').siteHostBase, null);
  assert.equal(resolveConfig({}, 'https://elowen.example', 'localhost').siteHostBase, null);
});

test('the Sites DNS destination is parsed once, strictly, for both readiness and the record', () => {
  // One exported contract, used by the gateway for the DNS check AND for the record the settings screen
  // shows. Everything that is not exactly a hostname or an address is refused rather than guessed at.
  assert.deepEqual(resolveGatewayDnsTarget(undefined, 'elowen.example'), {
    target: { kind: 'hostname', value: 'elowen.example' }, error: null,
  });
  assert.deepEqual(resolveGatewayDnsTarget('203.0.113.40', 'elowen.example').target, { kind: 'ipv4', value: '203.0.113.40' });
  assert.deepEqual(resolveGatewayDnsTarget('Origin.Example.COM.', null).target, { kind: 'hostname', value: 'origin.example.com' });

  // A trailing dot is a fully qualified value, not a hostname whose last label happens to be numeric.
  assert.deepEqual(resolveGatewayDnsTarget('188.130.140.170.', null).target, { kind: 'ipv4', value: '188.130.140.170' });

  // IPv6 is canonicalised, so a stored value and a resolver answer are the same string.
  assert.deepEqual(resolveGatewayDnsTarget('2001:0DB8:0000:0000:0000:0000:0000:0020', null).target, {
    kind: 'ipv6', value: '2001:db8::20',
  });

  // `domainToASCII` drops a prefix and a trailing dot silently, so these must be refused before it runs.
  for (const rejected of [
    '188.130.140.170/32', 'https://bad.example/path', 'bad.example/path', '*.example.com',
    'origin.example.com:443', 'localhost', '999.1.1.1', '188.130.140.170..',
    '2001:db8::1%eth0', 'origin example.com', 'user@origin.example.com',
  ]) {
    const resolved = resolveGatewayDnsTarget(rejected, 'elowen.example');
    assert.equal(resolved.target, null, rejected);
    assert.match(resolved.error, /DNS destination/, rejected);
  }

  // An unusable fallback is not an operator mistake: there is simply nothing to point at yet.
  assert.deepEqual(resolveGatewayDnsTarget(undefined, null), { target: null, error: null });
});

test('authenticated site API updates command and bind settings under the instance gate', async () => {
  const store = new SitesStore(makeDb());
  store.insertSite(site({ id: 'api-site', runtime: 'command', startCommand: 'node old.js', currentReleaseId: null }));
  const handlers = createApiHandlers({
    store,
    access: deps(),
    config: () => resolveConfig({ allowCommandRuntime: true, allowLoopbackPorts: true, runtimeNetwork: 'shared' }, 'https://elowen.example', 'sites.elowen.example'),
    people: () => new Map([[1, { id: 1, username: 'filip', name: 'Filip', avatar: '' }]]),
    projectSlug: () => 'demo',
    deleteSite: async () => {},
    activateRelease: () => {},
    runtimeState: () => ({ running: false, logTail: '' }),
    allocatePort: async () => 43000,
    restartRuntime: async () => {},
  });
  const response = await handlers.site({
    method: 'PATCH',
    path: 'api-site',
    query: {},
    headers: {},
    auth: { userId: 1, admin: false, tokenScope: 'user', accessibleProjects: [2] },
    params: {},
    body: async () => Buffer.from(''),
    json: async () => ({ startCommand: 'node new.js', bind: 'port' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    { startCommand: store.siteById('api-site').startCommand, bind: store.siteById('api-site').bind, port: store.siteById('api-site').port },
    { startCommand: 'node new.js', bind: 'port', port: 43000 },
  );
});

test('site API exposes an unhealthy live publication and its concrete error without demoting it', async () => {
  const store = new SitesStore(makeDb());
  store.insertSite(site({
    id: 'api-proxy', ownerUserId: 1, kind: 'proxy', target: '3000', runtime: 'static', status: 'live',
    currentReleaseId: null, lastError: 'The validated container is not running',
  }));
  const handlers = createApiHandlers({
    store,
    access: deps(),
    config: () => resolveConfig({}, 'https://elowen.example', 'sites.elowen.example'),
    people: () => new Map([[1, { id: 1, username: 'filip', name: 'Filip', avatar: '' }]]),
    projectSlug: () => 'demo',
    environmentState: async () => { throw new Error('a proxy publication has no Site environment'); },
    environmentAction: async () => null,
    projectEnvironment: async () => ({ state: 'running', lastError: null }),
    runtimeState: () => ({ running: false, logTail: '' }),
  });
  const request = {
    method: 'GET', query: {}, headers: {}, params: {}, body: async () => Buffer.from(''), json: async () => ({}),
    auth: { userId: 1, admin: false, tokenScope: 'user', accessibleProjects: [2] },
  };

  const response = await handlers.list({ ...request, path: '' });
  assert.equal(response.body.mine[0].status, 'live');
  assert.equal(response.body.mine[0].degraded, true);

  const detail = await handlers.site({ ...request, path: 'api-proxy' });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.lastError, 'The validated container is not running');
});

// ── the tool surface ─────────────────────────────────────────────────────────────────────────────
//
// This layer had NO coverage, which is why 42 green tests coexisted with a feature that could not be
// driven at all: SiteCreate never disclosed the id SitePublish demanded, and a refusal came back as a
// successful result, so the agent read "no" as an answer and kept guessing.

const toolHarness = (t, { projects, people: roster, configRaw = {}, gatewayHost = 'sites.elowen.example', runtimeAvailable = false, admin = false, projectRef, workDir, projectFiles, publications, projectEnvironment } = {}) => {
  const db = makeDb();
  const store = new SitesStore(db);
  const registered = new Map();
  const dir = mkdtempSync(join(tmpdir(), 'sites-tools-'));
  // Three levels down from the Project root on purpose: an agent is almost never standing exactly on it.
  mkdirSync(join(dir, 'project', 'deep', 'nested'), { recursive: true });
  const roots = projects ?? [{ id: 7, slug: 'demo', path: join(dir, 'project') }];
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const accounts = roster ?? [
    { id: 1, username: 'filip', name: 'Filip Džudža', avatar: '1.png' },
    { id: 3, username: 'josef.kvitek', name: 'Josef Kvítek', avatar: '' },
  ];
  const ctx = {
    registerTool: (tool) => registered.set(tool.name, tool),
    currentModel: () => ({ provider: 'anthropic', model: 'claude' }),
    currentContributionUserId: () => 1,
    currentIdentity: () => ({ elowenUserId: 1 }),
    currentSessionId: () => 'session-1',
    workDir: () => workDir ?? join(dir, 'project', 'deep', 'nested'),
    assertPathAllowed: (path) => path,
    currentAccess: () => ({ projectIds: [7], admin: false, owner: false, accountUserId: 1, projectRef }),
    control: () => (runtimeAvailable || projectFiles
      ? { activeWorkspace: () => null, ...(projectFiles ? { projectFiles } : {}) }
      : undefined),
    host: { stores: () => ({ projects: { list: () => roots, get: id => roots.find(project => project.id === id) } }) },
  };
  registerTools({
    ctx,
    store,
    access: { isAdmin: () => admin, canAccessProject: () => true, accountExists: () => true },
    config: () => resolveConfig(configRaw, 'https://elowen.example', gatewayHost),
    people: () => new Map(accounts.map((person) => [person.id, person])),
    siteDir: (id) => join(dir, 'sites', id),
    releaseDir: (id, releaseId) => join(dir, 'sites', id, releaseId),
    deleteSite: async (id) => { store.beginDelete(id); store.deleteSite(id); },
    runtime: { allocatePort: () => 43000, stop: async () => {}, start: async () => {}, logTail: () => '', isRunning: () => false },
    environment: {
      state: async (target) => ({
        state: 'running',
        desiredState: target.environmentDesiredState ?? 'running',
        limits: { cpus: 1, memoryMb: 1024, pidsLimit: 512 },
      }),
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      logs: async () => ({ lifecycle: '', journal: '' }),
      // Nothing is scheduled in these cases, so the durable action slot reads empty.
      pendingAction: async () => null,
    },
    // A test that does not stub the publication transport must FAIL loudly if it reaches for one: the
    // default refuses, so a static path that suddenly asked for a transport would not pass quietly.
    publications: publications ?? {
      establish: async () => { throw new Error('the publication transport is not stubbed in this harness'); },
      probe: async () => ({ answered: false, status: null, detail: 'not stubbed' }),
      adopt: () => {},
    },
    projectEnvironment: projectEnvironment ?? (async () => null),
  });
  return { store, dir, registered, call: (name, input) => registered.get(name).execute('call-1', input ?? {}) };
};

test('SiteCreate no longer offers a per-site persistent environment runtime', (t) => {
  const harness = toolHarness(t);
  const runtimeSchema = harness.registered.get('SiteCreate').parameters.properties.runtime;
  assert.deepEqual(runtimeSchema.anyOf.map((entry) => entry.const), ['static', 'command', 'php']);
});

test('a created site tells the agent the identifier the other tools demand', async (t) => {
  // The whole failure in one assertion: an agent can only publish what SiteCreate named.
  const harness = toolHarness(t);
  const created = await harness.call('SiteCreate', { title: 'Provozní přehled' });
  const body = created.content[0].text;
  assert.ok(created.details.siteId, 'the id must be a structured field, not something to parse out of prose');
  assert.match(body, new RegExp(created.details.siteId), 'and it must be visible in the text too');
  assert.equal(created.details.slug, created.details.slug.toLowerCase());
});

test('SiteCreate refuses a file-published site with no address before creating anything', async (t) => {
  // The refusal used to fire while building the SUCCESS text, after the row and folder existed: the
  // agent read a failure while every retry leaked another site towards the per-account limit.
  const harness = toolHarness(t, { gatewayHost: null });
  await assert.rejects(() => harness.call('SiteCreate', { title: 'No address here' }), /HTTPS domain/);
  assert.deepEqual(harness.store.allSites(), [], 'a refused create must not persist a site row');
  assert.equal(existsSync(join(harness.dir, 'project', 'sites')), false, 'not even the source folder may appear');
});

test('SiteCreate builds a managed Project site folder under the guest root the Project is mounted at', async (t) => {
  // A managed Project is mounted at its own name (`/<slug>`), never at `/workspace`: that name is
  // reserved and no such directory exists in the Project container, so a folder built under it landed
  // outside the Project the agent was told to write into, and the publish export looked in the Project
  // root for a tree that was never there. The turn's working directory IS the Project guest root (core's
  // `managedGuestRoot` in src/shared/projectExecution.ts, resolved by `effectiveTurnWorkDir`).
  const created = [];
  const harness = toolHarness(t, {
    projects: [{ id: 7, slug: 'Kolin', path: '/host/kolin', executionKind: 'managed', lifecycle: 'active' }],
    projectRef: { kind: 'managed', projectId: 7 },
    workDir: '/kolin',
    projectFiles: async ({ operation }) => {
      created.push(operation.path);
      return { kind: 'mkdir', entry: { path: operation.path, kind: 'directory', sizeBytes: 0, modifiedAt: '2026-09-10T00:00:00.000Z' } };
    },
  });

  const result = await harness.call('SiteCreate', { title: 'Kontrolní panel' });
  const expected = `/kolin/sites/${result.details.slug}`;
  assert.deepEqual(created, [expected], 'the source folder is created inside the Project root');
  assert.equal(harness.store.siteById(result.details.siteId).sourceDir, expected);
  assert.match(result.content[0].text, new RegExp(expected), 'and the agent is told to write there');
});

test('SitePublish refuses a removed Project without interpreting its guest source as a host path', async (t) => {
  const harness = toolHarness(t, { projects: [] });
  harness.store.insertSite(site({ sourceDir: '/workspace/sites/deleted-project' }));
  await assert.rejects(harness.call('SitePublish', { site: 'site-1' }), /source Project no longer exists/);
  assert.equal(harness.store.releases('site-1').length, 0);
});

test('SitePublish cannot cross the selected managed Project through another owned Site', async (t) => {
  const harness = toolHarness(t, { projectRef: { kind: 'managed', projectId: 99 } });
  harness.store.insertSite(site({ sourceDir: '/workspace/sites/other-project' }));
  await assert.rejects(harness.call('SitePublish', { site: 'site-1' }), /outside the selected managed Project/);
  assert.equal(harness.store.releases('site-1').length, 0);
});

test('an environment reports its newest snapshot, never a publish it cannot have', async (t) => {
  // SitePublish refuses an environment, so lastPublishAt stays null there for good. Reading the summary
  // line from that field told an agent "snapshot never" seconds after SiteSnapshot had succeeded, which
  // reads as a failed snapshot and invites a pointless second one.
  const { store, call } = toolHarness(t, { configRaw: { allowEnvironments: true } });
  store.insertSite(site({
    id: 'env-1', slug: 'env-a1b2c3', ownerUserId: 1, runtime: 'environment',
    status: 'live', currentReleaseId: null, environmentDesiredState: 'running',
  }));

  const before = await call('SiteGet', { site: 'env-a1b2c3' });
  assert.match(before.content[0].text, /snapshot {3}never/, 'an environment with no snapshot still says so');
  assert.doesNotMatch(before.content[0].text, /published/, 'and never borrows the publish wording');

  const snapshot = (id, createdAt) => ({
    id, siteId: 'env-1', createdAt, model: 'test/model', fileCount: 0, sizeBytes: 0, note: '',
    kind: 'environment-snapshot', imageRef: `localhost/elowen-site/env-1:${id}`, dataArchive: null,
  });
  store.insertRelease(snapshot('snap-old', '2026-09-01T10:00:00.000Z'));
  store.insertRelease(snapshot('snap-new', '2026-09-04T21:30:00.000Z'));

  const after = await call('SiteGet', { site: 'env-a1b2c3' });
  assert.match(after.content[0].text, /snapshot {3}2026-09-04T21:30:00\.000Z/, 'the NEWEST snapshot, not the first');

  const listed = await call('SiteList', {});
  assert.match(listed.content[0].text, /snapshot {3}2026-09-04T21:30:00\.000Z/, 'SiteList reports it too');
});

test('a site answers to its slug as readily as to its id', async (t) => {
  const { store, call } = toolHarness(t);
  store.insertSite(site({ id: 'id-1', slug: 'report-a1b2c3', ownerUserId: 1, status: 'live' }));

  for (const reference of ['id-1', 'report-a1b2c3']) {
    const seen = await call('SiteGet', { site: reference });
    assert.equal(seen.details.siteId, 'id-1', `${reference} should resolve`);
  }
});

test('naming a site that does not exist FAILS, and says what would work', async (t) => {
  // Returned as text this read as a successful call, so the model treated the refusal as information
  // and guessed again — five times, in the conversation that prompted this.
  const { store, call } = toolHarness(t);
  store.insertSite(site({ id: 'id-1', slug: 'report-a1b2c3', ownerUserId: 1 }));

  await assert.rejects(() => call('SiteGet', { site: 'report' }), (error) => {
    assert.match(error.message, /report-a1b2c3/, 'the message must name the identifiers that do work');
    assert.match(error.message, /id-1/);
    return true;
  });
});

test('an agent can share a site with a person by name, and take it back', async (t) => {
  const { store, call } = toolHarness(t);
  store.insertSite(site({ id: 'id-1', slug: 'report-a1b2c3', ownerUserId: 1, status: 'live' }));

  const shared = await call('SiteShare', { site: 'report-a1b2c3', person: 'josef.kvitek' });
  assert.equal(shared.details.changed, true);
  assert.deepEqual(store.memberIds('id-1'), [3]);

  const again = await call('SiteShare', { site: 'report-a1b2c3', person: 'Josef Kvítek' });
  assert.equal(again.details.changed, false, 'sharing twice is not an error, it is already true');

  const before = store.siteById('id-1').accessGeneration;
  await call('SiteUnshare', { site: 'report-a1b2c3', person: '3' });
  assert.deepEqual(store.memberIds('id-1'), []);
  // Without the bump the guest's existing cookie keeps matching until it expires, so revocation would
  // be a promise rather than an effect.
  assert.ok(store.siteById('id-1').accessGeneration > before, 'revoking must invalidate sessions minted before it');
});

test('sharing with somebody who does not exist fails with the roster', async (t) => {
  const { store, call } = toolHarness(t);
  store.insertSite(site({ id: 'id-1', slug: 'report-a1b2c3', ownerUserId: 1 }));
  await assert.rejects(() => call('SiteShare', { site: 'report-a1b2c3', person: 'nobody' }), /josef\.kvitek/);
});

test('loopback binding is explicit and refused unless the instance enables it', async (t) => {
  const disabled = toolHarness(t, { configRaw: { allowCommandRuntime: true } });
  await assert.rejects(
    () => disabled.call('SiteCreate', { title: 'API', runtime: 'command', startCommand: 'node server.js', bind: 'port' }),
    /loopback ports are turned off/i,
  );

  const enabled = toolHarness(t, { configRaw: { allowCommandRuntime: true, allowLoopbackPorts: true } });
  const created = await enabled.call('SiteCreate', { title: 'API', runtime: 'command', startCommand: 'node server.js', bind: 'port' });
  const stored = enabled.store.siteById(created.details.siteId);
  assert.equal(stored.bind, 'port');
  assert.equal(stored.port, 43000);
});

test('a model that echoes every optional property with its default still creates and updates a static site', async (t) => {
  // Recorded from gpt-5.6-terra on Azure, asked to call SiteCreate with a title and nothing else: it
  // filled every optional property anyway. Presence of `bind`/`startCommand` used to be read as an
  // instruction and refused with "Only a command site has a runtime bind mode.", which made static
  // sites impossible to create from that model at all.
  const { store, call } = toolHarness(t);
  const created = await call('SiteCreate', {
    _reason: '', title: 'Provozní přehled', summary: '', visibility: 'private', spa: false,
    runtime: 'static', startCommand: '', bind: 'socket',
  });
  const stored = store.siteById(created.details.siteId);
  assert.equal(stored.runtime, 'static');
  assert.equal(stored.bind, 'socket');
  assert.equal(stored.startCommand, '');

  await call('SiteUpdate', { site: created.details.siteId, title: 'Nový název', summary: '', startCommand: '', bind: 'socket' });
  assert.equal(store.siteById(created.details.siteId).title, 'Nový název');

  // A value that really contradicts the runtime is still a mistake, on both tools.
  await assert.rejects(() => call('SiteCreate', { title: 'Port', bind: 'port' }), /Only a command site has a runtime bind mode/);
  await assert.rejects(() => call('SiteUpdate', { site: created.details.siteId, bind: 'port' }), /Only a command site has runtime settings/);
  await assert.rejects(() => call('SiteUpdate', { site: created.details.siteId, startCommand: 'node app.js' }), /Only a command site has runtime settings/);
});

test('SiteUpdate changes command runtime settings without republishing', async (t) => {
  const { store, call } = toolHarness(t, { configRaw: { allowCommandRuntime: true, allowLoopbackPorts: true } });
  store.insertSite(site({ id: 'id-1', slug: 'report-a1b2c3', ownerUserId: 1, runtime: 'command', startCommand: 'node old.js' }));

  await call('SiteUpdate', { site: 'id-1', startCommand: 'node new.js', bind: 'port' });
  const updated = store.siteById('id-1');
  assert.equal(updated.startCommand, 'node new.js');
  assert.equal(updated.bind, 'port');
  assert.equal(updated.port, 43000);
});

test('SiteDelete uses the shared cascading cleanup and leaves the Project source alone', async (t) => {
  const { store, dir, call } = toolHarness(t);
  const sourceDir = join(dir, 'project', 'report-source');
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, 'source.txt'), 'keep me');
  store.insertSite(site({ id: 'id-1', slug: 'report-a1b2c3', ownerUserId: 1, sourceDir }));
  store.addMember('id-1', 3);
  store.insertRelease({ id: 'rel-1', siteId: 'id-1', createdAt: new Date().toISOString(), model: 'm', fileCount: 1, sizeBytes: 1, note: '' });

  await call('SiteDelete', { site: 'report-a1b2c3' });
  assert.equal(store.siteById('id-1'), null);
  assert.equal(readFileSync(join(sourceDir, 'source.txt'), 'utf8'), 'keep me');
});

// ── proxy publications ───────────────────────────────────────────────────────────────────────────
//
// A proxy publication has no release and no container of its own: an application runs on a loopback
// port inside the managed Project's environment, and Sandbox keeps a forwarder for it. These tests hold
// the three things that are only visible here: the additive columns, the publish that verifies through
// the transport instead of copying files, and the serving path that must reach the same socket a
// visitor's request would.

test('a row written before the publication model is a static publication', () => {
  const db = makeDb();
  const store = new SitesStore(db);
  assert.equal(db.appliedVersion(), 14, 'the additive migration is the last one applied');

  // As an older release left it: no kind and no target columns at all in the INSERT.
  db.exec(`INSERT INTO p_sites_sites
    (id, slug, title, summary, project_id, owner_user_id, visibility, access_generation, source_dir, spa, status, created_at, updated_at)
    VALUES ('old-1', 'old-a1b2c3', 'Old', '', 7, 1, 'private', 1, '/tmp/old', 0, 'live', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);

  const row = store.siteById('old-1');
  assert.equal(row.kind, 'static');
  assert.equal(row.target, '');
  assert.deepEqual(store.proxySitesForReconcile(), [], 'an old row is never reconciled as a proxy publication');
});

test('a proxy publication round trips its kind and port, and only live or failed rows are reconciled', () => {
  const store = new SitesStore(makeDb());
  store.insertSite(site({ id: 'proxy-1', slug: 'app-a1b2c3', kind: 'proxy', target: '3000', runtime: 'static', currentReleaseId: null }));

  const row = store.siteById('proxy-1');
  assert.equal(row.kind, 'proxy');
  assert.equal(row.target, '3000');
  assert.deepEqual(store.proxySitesForReconcile().map((entry) => entry.id), ['proxy-1']);
  assert.deepEqual(store.liveEnvironmentSites(), [], 'a proxy publication is not an environment of its own');

  store.updateSite('proxy-1', { status: 'draft' });
  assert.deepEqual(store.proxySitesForReconcile().map((entry) => entry.id), [], 'a draft holds no transport');
  store.updateSite('proxy-1', { status: 'failed' });
  assert.deepEqual(store.proxySitesForReconcile().map((entry) => entry.id), ['proxy-1'], 'a failed publish recovers');
});

test('a model that echoes every optional property still creates a proxy publication', async (t) => {
  // Same recorded behaviour as the static case: gpt-5.6-terra fills every optional property, so a proxy
  // create arrives with `runtime: 'static'`, `startCommand: ''`, `bind: 'socket'` and `spa: false` set.
  const harness = toolHarness(t, {
    projects: [{ id: 7, slug: 'kolin', path: '/host/kolin', executionKind: 'managed', lifecycle: 'active' }],
    projectRef: { kind: 'managed', projectId: 7 },
    runtimeAvailable: true,
  });
  const created = await harness.call('SiteCreate', {
    _reason: '', title: 'Provozní aplikace', summary: '', visibility: 'private', spa: false,
    runtime: 'static', startCommand: '', bind: 'socket', kind: 'proxy', target: '3000',
  });

  const stored = harness.store.siteById(created.details.siteId);
  assert.equal(stored.kind, 'proxy');
  assert.equal(stored.target, '3000');
  assert.equal(stored.status, 'draft', 'nothing is served until the application is verified');
  assert.equal(stored.sourceDir, '', 'a proxy publication owns no folder');
  assert.equal(created.details.target, '3000');
  assert.match(created.content[0].text, /127\.0\.0\.1:3000/);
  assert.match(created.content[0].text, /kolin/);
});

test('a proxy publication is refused without a usable port, a managed Project, or against a legacy runtime', async (t) => {
  const managed = {
    projects: [{ id: 7, slug: 'kolin', path: '/host/kolin', executionKind: 'managed', lifecycle: 'active' }],
    projectRef: { kind: 'managed', projectId: 7 },
    runtimeAvailable: true,
  };
  const harness = toolHarness(t, managed);
  await assert.rejects(() => harness.call('SiteCreate', { title: 'No port', kind: 'proxy' }), /needs target/);
  await assert.rejects(() => harness.call('SiteCreate', { title: 'Bad port', kind: 'proxy', target: '0' }), /needs target/);
  await assert.rejects(() => harness.call('SiteCreate', { title: 'Bad port', kind: 'proxy', target: 'http' }), /needs target/);
  await assert.rejects(
    () => harness.call('SiteCreate', { title: 'Two ways', kind: 'proxy', target: '3000', runtime: 'command' }),
    /no runtime of its own/,
  );
  await assert.rejects(
    () => harness.call('SiteCreate', { title: 'Static with a port', target: '3000' }),
    /target is only for a proxy publication/,
  );
  // A host Project has no environment to publish from, so the refusal comes before anything is written.
  const hostProject = toolHarness(t, {
    projects: [{ id: 7, slug: 'wemx', path: '/host/wemx', executionKind: 'host', lifecycle: 'active' }],
    projectRef: { kind: 'managed', projectId: 7 },
    runtimeAvailable: true,
  });
  await assert.rejects(() => hostProject.call('SiteCreate', { title: 'Host', kind: 'proxy', target: '3000' }), /managed Project/);
  assert.deepEqual(harness.store.allSites(), [], 'a refused create persists nothing');
});

test('SitePublish verifies a proxy publication through the transport and flips it live', async (t) => {
  const adopted = [];
  const harness = toolHarness(t, {
    projects: [{ id: 7, slug: 'kolin', path: '/host/kolin', executionKind: 'managed', lifecycle: 'active' }],
    runtimeAvailable: true,
    publications: {
      establish: async (target) => ({ socketPath: `/run/project/broker/pub-${target.id}.sock`, generation: 3 }),
      probe: async (path) => {
        assert.equal(path, '/run/project/broker/pub-proxy-a1b2c3.sock');
        return { answered: true, status: 200, detail: 'GET / answered 200' };
      },
      adopt: (siteId, socketPath) => { adopted.push([siteId, socketPath]); },
    },
  });
  harness.store.insertSite(site({ id: 'proxy-a1b2c3', slug: 'proxy-a1b2c3', kind: 'proxy', target: '3000', runtime: 'static', status: 'draft', currentReleaseId: null }));

  const published = await harness.call('SitePublish', { site: 'proxy-a1b2c3' });
  const stored = harness.store.siteById('proxy-a1b2c3');
  assert.equal(stored.status, 'live');
  assert.ok(stored.lastPublishAt, 'a verified publication records when it was verified');
  assert.equal(stored.currentReleaseId, null, 'nothing is copied, so there is no release to point at');
  assert.equal(harness.store.releases('proxy-a1b2c3').length, 0);
  assert.deepEqual(adopted, [['proxy-a1b2c3', '/run/project/broker/pub-proxy-a1b2c3.sock']]);
  assert.match(published.content[0].text, /answered on 127\.0\.0\.1:3000/);
});

test('a proxy publication is not published when nothing answers on its port', async (t) => {
  const harness = toolHarness(t, {
    projects: [{ id: 7, slug: 'kolin', path: '/host/kolin', executionKind: 'managed', lifecycle: 'active' }],
    runtimeAvailable: true,
    publications: {
      establish: async () => ({ socketPath: '/run/project/broker/pub.sock', generation: 1 }),
      probe: async () => ({ answered: false, status: null, detail: 'connect ECONNREFUSED' }),
      adopt: () => { throw new Error('a publication that did not answer must not be adopted'); },
    },
  });
  harness.store.insertSite(site({ id: 'proxy-2', slug: 'proxy-b1b2c3', kind: 'proxy', target: '3000', runtime: 'static', status: 'draft', currentReleaseId: null }));

  await assert.rejects(() => harness.call('SitePublish', { site: 'proxy-b1b2c3' }), /nothing answered on 127\.0\.0\.1:3000/);
  const stored = harness.store.siteById('proxy-2');
  assert.equal(stored.status, 'failed');
  assert.match(stored.lastError, /ECONNREFUSED/);
});

test('a proxy publication is not published when its readiness request answers 5xx', async (t) => {
  const harness = toolHarness(t, {
    projects: [{ id: 7, slug: 'kolin', path: '/host/kolin', executionKind: 'managed', lifecycle: 'active' }],
    runtimeAvailable: true,
    publications: {
      establish: async () => ({ socketPath: '/run/project/broker/pub.sock', generation: 1 }),
      probe: async () => ({ answered: true, status: 503, detail: 'GET / answered 503' }),
      adopt: () => { throw new Error('an unhealthy publication must not be adopted'); },
    },
  });
  harness.store.insertSite(site({ id: 'proxy-5xx', slug: 'proxy-f1b2c3', kind: 'proxy', target: '3000', runtime: 'static', status: 'draft', currentReleaseId: null }));

  await assert.rejects(() => harness.call('SitePublish', { site: 'proxy-f1b2c3' }), /unhealthy status/);
  assert.equal(harness.store.siteById('proxy-5xx').status, 'failed');
  assert.match(harness.store.siteById('proxy-5xx').lastError, /503/);
});

test('a proxy publication whose Project environment cannot be reached says so instead of going live', async (t) => {
  const harness = toolHarness(t, {
    projects: [{ id: 7, slug: 'kolin', path: '/host/kolin', executionKind: 'managed', lifecycle: 'active' }],
    runtimeAvailable: true,
    publications: {
      establish: async () => { throw new Error('Environment is stopped; request an explicit start'); },
      probe: async () => { throw new Error('unreachable'); },
      adopt: () => {},
    },
  });
  harness.store.insertSite(site({ id: 'proxy-3', slug: 'proxy-c1b2c3', kind: 'proxy', target: '3000', runtime: 'static', status: 'draft', currentReleaseId: null }));

  await assert.rejects(() => harness.call('SitePublish', { site: 'proxy-c1b2c3' }), /could not be reached/);
  assert.equal(harness.store.siteById('proxy-3').status, 'failed');
});

test('SiteGet tells the agent which Project environment serves a proxy publication', async (t) => {
  const harness = toolHarness(t, {
    projects: [{ id: 7, slug: 'kolin', path: '/host/kolin', executionKind: 'managed', lifecycle: 'active' }],
    admin: true,
    projectEnvironment: async (projectId, actor) => {
      assert.deepEqual([projectId, actor], [7, 1]);
      return { state: 'running', lastError: null };
    },
  });
  harness.store.insertSite(site({
    id: 'proxy-4', slug: 'proxy-d1b2c3', ownerUserId: 9, kind: 'proxy', target: '3000', runtime: 'static',
    status: 'live', currentReleaseId: null, lastError: 'The validated container is not running',
  }));

  const detail = await harness.call('SiteGet', { site: 'proxy-d1b2c3' });
  const body = detail.content[0].text;
  assert.match(body, /Served by the environment of project kolin/);
  assert.match(body, /kind {7}proxy/);
  assert.match(body, /target {5}3000 inside the Project/);
  assert.match(body, /environment running/);
  assert.match(body, /status {5}degraded/, 'the address stays published while its health is visible');
  assert.doesNotMatch(body, /No releases yet/, 'a proxy publication never claims a release it cannot have');
  assert.equal(detail.details.kind, 'proxy');
  assert.equal(detail.details.target, '3000');
  assert.equal(detail.details.degraded, true);
  assert.deepEqual(detail.details.project, { id: 7, slug: 'kolin', executionKind: 'managed', environment: { state: 'running', lastError: null } });
});

test('the per-site lifecycle tools refuse a proxy publication and name the Project instead', async (t) => {
  const harness = toolHarness(t, { admin: true, configRaw: { allowEnvironments: true } });
  harness.store.insertSite(site({ id: 'proxy-5', slug: 'proxy-e1b2c3', kind: 'proxy', target: '3000', runtime: 'static', status: 'live', currentReleaseId: null }));

  for (const [tool, input, expected] of [
    ['SiteExec', { site: 'proxy-e1b2c3', command: 'ls' }, /Project environment/],
    ['SiteControl', { site: 'proxy-e1b2c3', action: 'restart' }, /Start, stop and restart belong to that Project/],
    ['SiteSnapshot', { site: 'proxy-e1b2c3' }, /snapshot of that Project belongs to the Project/],
    ['SiteLogs', { site: 'proxy-e1b2c3' }, /Sandbox plugin/],
    ['SiteRollback', { site: 'proxy-e1b2c3', releaseId: 'rel-1' }, /Sandbox plugin/],
  ]) {
    await assert.rejects(() => harness.call(tool, input), expected, `${tool} must refuse a proxy publication`);
  }

  // Resource limits belong to the Project environment, not to the publication in front of it.
  await assert.rejects(
    () => harness.call('SiteUpdate', { site: 'proxy-e1b2c3', environmentMemoryMb: 2048 }),
    /set them on the Project environment/,
  );
  // Everything that is about the address itself still works.
  const updated = await harness.call('SiteUpdate', { site: 'proxy-e1b2c3', title: 'Nový název' });
  assert.equal(harness.store.siteById('proxy-5').title, 'Nový název');
  assert.match(updated.content[0].text, /Served by the environment of project/);
});

test('a proxy publication answers through the project socket, and a stranger cannot tell it exists', async (t) => {
  const dir = tempDir('publication');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = join(dir, 'pub.sock');
  let applicationCookie;
  const application = createServer((req, res) => {
    applicationCookie = req.headers.cookie;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`from the project: ${req.url}`);
  });
  await new Promise((resolve, reject) => { application.once('error', reject); application.listen(socketPath, resolve); });
  t.after(() => new Promise((resolve) => application.close(resolve)));

  const { handler } = serveHarness(
    t,
    { kind: 'proxy', target: '3000', runtime: 'static', currentReleaseId: null, visibility: 'project' },
    { endpointFor: (siteId) => (siteId === 'site-1' ? { kind: 'socket', path: socketPath } : null) },
  );

  // A member of the Project the site is shared with reaches the application inside it, by the same path a
  // visitor's request takes: the session is read BEFORE the transport, so access is decided exactly as it
  // is for a file publication.
  const cookie = `${cookieName('site-1')}=${signSession('serve-secret', { u: 2, g: 1, e: Date.now() + 60_000 })}`;
  const answered = await handler(request('demo-abc123/reports/q3', { headers: { accept: 'application/json', cookie } }));
  assert.equal(answered.status, 200);
  // The application saw the remainder of the path unrewritten: the slug is the address, not a prefix it
  // has to know about.
  assert.equal(await bodyText(answered.body), 'from the project: /reports/q3');
  assert.equal(applicationCookie, undefined, 'the Sites access credential is consumed by the gateway and never reaches the Project application');
  assert.equal(answered.headers['x-robots-tag'], 'noindex, nofollow', 'a non-public answer stays unindexed');

  // And the parity rule: somebody who may not see it gets the answer a free slug gets, whether or not an
  // application is listening behind it.
  const stranger = await handler(request('demo-abc123/', { headers: { accept: 'application/json' } }));
  const unknown = await handler(request('never-taken-000000/', { headers: { accept: 'application/json' } }));
  assert.equal(stranger.status, unknown.status);
  assert.equal(stranger.body, unknown.body);
});

test('a proxy publication without a transport is not served from anything else', async (t) => {
  const { handler } = serveHarness(t, {
    kind: 'proxy', target: '3000', runtime: 'static', currentReleaseId: null, visibility: 'public',
  });
  const response = await handler(request('demo-abc123/'));
  assert.equal(response.status, 503);
  assert.match(String(response.body), /project environment that serves this page is not available/i);

  // A draft is not published at all: it answers exactly like a slug nobody took.
  const { handler: draftHandler } = serveHarness(t, {
    kind: 'proxy', target: '3000', runtime: 'static', currentReleaseId: null, visibility: 'public', status: 'draft',
  });
  const draft = await draftHandler(request('demo-abc123/'));
  const unknown = await draftHandler(request('never-taken-000000/'));
  assert.equal(draft.status, unknown.status);
  assert.equal(draft.body, unknown.body);
});

test('the publication service establishes, probes and releases one transport per publication', async (t) => {
  const dir = tempDir('publication-service');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = join(dir, 'pub.sock');
  const application = createServer((_req, res) => { res.writeHead(204); res.end(); });
  await new Promise((resolve, reject) => { application.once('error', reject); application.listen(socketPath, resolve); });
  t.after(() => new Promise((resolve) => application.close(resolve)));

  const store = new SitesStore(makeDb());
  store.insertSite(site({
    id: 'pub-1', slug: 'pub-a1b2c3', projectId: 7, ownerUserId: 1, kind: 'proxy', target: '3000',
    runtime: 'static', status: 'draft', currentReleaseId: null,
  }));
  const calls = [];
  const service = new ProjectPublicationService({
    store,
    control: () => ({
      projectPublicationBinding: async (input) => { calls.push(['bind', input]); return { generation: 4, socketPath }; },
      projectPublicationRelease: async (input) => { calls.push(['release', input]); },
    }),
    project: () => ({ executionKind: 'managed', lifecycle: 'active' }),
  });

  // A publish creates the durable record, and the seam refuses to write one for nobody: the account that
  // is publishing travels with the request. Only the re-establish half is account-free.
  const binding = await service.establish(store.siteById('pub-1'), 1);
  assert.deepEqual(calls[0], ['bind', {
    project: { kind: 'managed', projectId: 7 }, accountUserId: 1, publicationId: 'pub-1', port: 3000,
  }]);
  assert.equal(binding.socketPath, socketPath);
  const probe = await service.probe(socketPath);
  assert.equal(probe.answered, true);
  assert.equal(probe.status, 204);
  assert.equal((await service.probe(join(dir, 'gone.sock'))).answered, false, 'a socket nobody listens on is not an answer');

  service.adopt('pub-1', socketPath);
  assert.deepEqual(service.endpointFor('pub-1'), { kind: 'socket', path: socketPath });

  // A draft holds no transport, and a remembered one that answers is never asked for twice.
  await service.reconcile();
  assert.equal(calls.filter(([name]) => name === 'bind').length, 1, 'a draft publication is left alone');
  store.updateSite('pub-1', { status: 'live' });
  await service.reconcile();
  assert.equal(calls.filter(([name]) => name === 'bind').length, 1, 'an answering transport is not re-established');
  assert.equal(store.siteById('pub-1').lastError, null);

  await service.release(store.siteById('pub-1'));
  assert.deepEqual(calls.at(-1), ['release', { project: { kind: 'managed', projectId: 7 }, publicationId: 'pub-1' }]);
  assert.equal(service.endpointFor('pub-1'), null, 'a released publication answers through nothing');
});

test('reconciliation keeps a 5xx publication live but records it as unhealthy', async (t) => {
  const endpoint = await runtimeServer(t, (_req, res) => { res.writeHead(503); res.end('down'); });
  const store = new SitesStore(makeDb());
  store.insertSite(site({
    id: 'pub-5xx', slug: 'pub-f1b2c3', projectId: 7, ownerUserId: 1, kind: 'proxy', target: '3000',
    runtime: 'static', status: 'live', currentReleaseId: null,
  }));
  const service = new ProjectPublicationService({
    store,
    control: () => ({
      projectPublicationBinding: async () => ({ generation: 1, socketPath: endpoint.path }),
      projectPublicationRelease: async () => {},
    }),
    project: () => ({ executionKind: 'managed', lifecycle: 'active' }),
  });
  service.adopt('pub-5xx', endpoint.path);

  await service.reconcile();
  assert.equal(store.siteById('pub-5xx').status, 'live');
  assert.match(store.siteById('pub-5xx').lastError, /503/);
  assert.deepEqual(service.endpointFor('pub-5xx'), endpoint, 'the valid transport remains available to visitors');
});

test('a publication whose transport stopped answering is retried on a bounded cadence and never demoted', async () => {
  const store = new SitesStore(makeDb());
  store.insertSite(site({
    id: 'pub-live', slug: 'pub-c1b2c3', projectId: 7, ownerUserId: 1, kind: 'proxy', target: '3000',
    runtime: 'static', status: 'live', currentReleaseId: null,
  }));
  const bindings = [];
  const service = new ProjectPublicationService({
    store,
    control: () => ({
      projectPublicationBinding: async (input) => { bindings.push(input); return { generation: 1, socketPath: '/nonexistent/pub.sock' }; },
      projectPublicationRelease: async () => {},
    }),
    project: () => ({ executionKind: 'managed', lifecycle: 'active' }),
  });

  await service.reconcile();
  assert.equal(bindings.length, 1);
  // The sweep carries no account: it re-establishes a transport whose publisher may be long gone, and the
  // seam accepts that only because the record it re-establishes already exists.
  assert.ok(!('accountUserId' in bindings[0]), 'the reconcile sweep asks for no account');
  assert.match(store.siteById('pub-live').lastError, /ENOENT|connect/i, 'the row says why nobody can reach it');
  // Established, published and still published: an application that stopped answering is not a reason to
  // answer 404 for an address that exists.
  assert.equal(store.siteById('pub-live').status, 'live');

  // The environment is not asked again on every tick: establishing a transport costs guest round trips.
  await service.reconcile();
  await service.reconcile();
  assert.equal(bindings.length, 1, 'a failing publication backs off instead of hammering the environment');
});
