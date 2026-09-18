import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SitesStore } from '../plugins/sites/dist/store.js';
import {
  CAPTURE_GRANT_TTL_MS, PREVIEW_IMAGE_MAX_BYTES, PREVIEW_IMAGE_TTL_MS, PREVIEW_MANUAL_REFRESH_MIN_MS,
  SitePreviewImageService, retryDelay,
} from '../plugins/sites/dist/previewImage.js';
import { createSiteHandler } from '../plugins/sites/dist/serve.js';
import { createApiHandlers } from '../plugins/sites/dist/api.js';
import { CAPTURE_HEADER, captureCookieName, cookieName, hashToken, mintTicket, signSession } from '../plugins/sites/dist/access.js';
import { resolveConfig } from '../plugins/sites/dist/config.js';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

const makeDb = () => {
  const db = new Database(':memory:');
  let version = 0;
  const handle = { exec: (sql) => db.exec(sql), prepare: (sql) => db.prepare(sql) };
  return {
    ...handle,
    migrate: (steps) => { for (const step of steps) if (step.version > version) { step.up(handle); version = step.version; } },
    transaction: (fn) => db.transaction(fn)(),
  };
};

const tempDir = (label) => mkdtempSync(join(tmpdir(), `sites-preview-${label}-`));

const site = (overrides = {}) => ({
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
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  createdModel: '',
  lastPublishAt: '2026-09-01T00:00:00.000Z',
  lastPublishModel: '',
  lastError: null,
  ...overrides,
});

const ACTIVE_PROJECT = { executionKind: 'managed', lifecycle: 'active' };
const config = (raw = {}, gatewayHost = 'sites.example') => resolveConfig(raw, 'https://app.example', gatewayHost);

/** A browser control that answers with one picture and remembers what it was asked for. */
function captureControl({ bytes = Buffer.from('webp-bytes'), mimeType = 'image/webp', width = 1280, height = 800, fail = null, onCapture } = {}) {
  const calls = [];
  return {
    calls,
    available: () => true,
    async capture(request) {
      calls.push(request);
      await onCapture?.(request);
      if (fail) throw fail;
      return { image: bytes, mimeType, width, height };
    },
  };
}

const unusableControl = { available: () => false, capture: async () => { throw new Error('never called'); } };

/** The capture service under test, over one store and one data directory. */
function previewHarness(t, { store = new SitesStore(makeDb()), control, project = ACTIVE_PROJECT, configRaw = {}, gatewayHost = 'sites.example', root } = {}) {
  const directory = root ?? tempDir('dir');
  if (!root) t.after(() => rmSync(directory, { recursive: true, force: true }));
  // `control: null` is the explicit "this instance has no capture control"; omitting it means a working one.
  const chosen = control === undefined ? captureControl() : control;
  const serviceFor = (capture = chosen) => new SitePreviewImageService({
    store,
    siteDir: (id) => join(directory, id),
    project: () => project,
    captureControl: () => capture,
    config: () => config(configRaw, gatewayHost),
    logger: { warn() {} },
  });
  return { store, root: directory, control: chosen, serviceFor, service: serviceFor() };
}

/** Mint a grant the way the capture service does, and return the token that goes on the wire. */
function mintGrant(store, siteId) {
  const grant = mintTicket();
  store.putCaptureGrant(grant.tokenHash, siteId, store.siteById(siteId).accessGeneration, Date.now() + CAPTURE_GRANT_TTL_MS);
  return grant.token;
}

// ── the stored picture ───────────────────────────────────────────────────────────────────────────

test('a Site keeps exactly one picture, and a new capture replaces it under the next version', async (t) => {
  const harness = previewHarness(t, { control: captureControl({ bytes: Buffer.from('first') }) });
  const { store, service, root } = harness;
  store.insertSite(site());

  assert.deepEqual(service.view('site-1'), { state: 'none', version: 0, capturedAt: null, width: null, height: null });

  assert.deepEqual(service.request('site-1', 'publish'), { ok: true });
  await service.settled();

  const stored = store.previewImage('site-1');
  assert.equal(stored.state, 'ready');
  assert.equal(stored.version, 1);
  assert.equal(stored.bytes, 5);
  assert.equal(stored.mime, 'image/webp');
  assert.equal(stored.width, 1280);
  assert.equal(stored.height, 800);
  assert.equal(readFileSync(join(root, 'site-1', 'preview'), 'utf8'), 'first', 'the picture is on disk');
  assert.deepEqual(service.read('site-1'), { bytes: Buffer.from('first'), mime: 'image/webp', version: 1 });

  const replacement = harness.serviceFor(captureControl({ bytes: Buffer.from('second-picture') }));
  assert.deepEqual(replacement.request('site-1', 'publish'), { ok: true });
  await replacement.settled();

  assert.equal(store.previewImage('site-1').version, 2, 'the version is what a client fetches with');
  assert.equal(readFileSync(join(root, 'site-1', 'preview'), 'utf8'), 'second-picture');
  assert.deepEqual(readdirSync(join(root, 'site-1')), ['preview'],
    'one image per Site: the replaced picture leaves no second file and no temporary one');
  assert.deepEqual(replacement.read('site-1'), { bytes: Buffer.from('second-picture'), mime: 'image/webp', version: 2 });
});

test('the picture is taken through the site own published address, with the grant in a reserved header', async (t) => {
  const control = captureControl();
  const { store, service } = previewHarness(t, { control });
  store.insertSite(site());

  assert.deepEqual(service.request('site-1', 'publish'), { ok: true });
  await service.settled();

  const [request] = control.calls;
  assert.equal(request.url, 'https://demo-abc123.sites.example/',
    'the address is derived from the site row and the gateway, never supplied by a caller');
  assert.equal(request.headers[CAPTURE_HEADER].length > 30, true, 'a one-use grant travels in the reserved header');
  assert.equal(request.url.includes(request.headers[CAPTURE_HEADER]), false, 'the grant is never part of an address');
  assert.deepEqual({ w: request.viewport.width, h: request.viewport.height }, { w: 1280, h: 800 });
  assert.ok(request.maxBytes <= PREVIEW_IMAGE_MAX_BYTES, 'the picture is bounded before a browser is launched');
  assert.equal(request.format, 'webp');
});

test('a picture that does not hold up is refused rather than described wrongly', async (t) => {
  for (const entry of [
    { label: 'an empty image', answer: { bytes: Buffer.alloc(0), mimeType: 'image/webp' }, expected: /returned no image/ },
    { label: 'a type a register cannot show', answer: { bytes: Buffer.from('gif'), mimeType: 'image/gif' }, expected: /not a picture this register can show/ },
    { label: 'no dimensions', answer: { bytes: Buffer.from('png'), mimeType: 'image/png', width: 0, height: 0 }, expected: /described no image dimensions/ },
    { label: 'more than a picture may weigh', answer: { bytes: Buffer.alloc(PREVIEW_IMAGE_MAX_BYTES + 1, 1), mimeType: 'image/png' }, expected: /above the/ },
  ]) {
    const { store, service } = previewHarness(t, { control: captureControl(entry.answer) });
    store.insertSite(site());
    await service.request('site-1', 'publish');
    await service.settled();

    const row = store.previewImage('site-1');
    assert.equal(row.state, 'failed', entry.label);
    assert.match(row.lastError, entry.expected, entry.label);
    assert.equal(row.version, 0, `${entry.label}: nothing is stored under a version`);
    assert.equal(service.read('site-1'), null, `${entry.label}: and there is nothing to serve`);
  }
});

test('a failed capture keeps the picture that was already there', async (t) => {
  const harness = previewHarness(t, { control: captureControl({ bytes: Buffer.from('good') }) });
  const { store, service } = harness;
  store.insertSite(site());
  await service.request('site-1', 'publish');
  await service.settled();

  const failing = harness.serviceFor(captureControl({ fail: new Error('the page answered 503, so there is nothing to picture') }));
  assert.deepEqual(failing.request('site-1', 'publish'), { ok: true });
  await failing.settled();

  const row = store.previewImage('site-1');
  assert.equal(row.state, 'failed');
  assert.equal(row.version, 1, 'the version is unchanged, so a client keeps the picture it already has');
  assert.notEqual(row.capturedAt, null, 'and so is when that picture was taken');
  assert.match(row.lastError, /answered 503/);
  assert.equal(row.attempts, 1);
  assert.ok(row.nextAttemptAt > Date.now(), 'the next attempt is deferred');
  assert.equal(failing.view('site-1').state, 'failed');
  assert.equal(failing.read('site-1').bytes.toString(), 'good', 'the previous picture is still served');
});

test('a site this instance cannot picture is refused with a reason and never launches a browser', async (t) => {
  for (const entry of [
    { label: 'no capture control at all', control: null, subject: site(), expected: /Browser plugin is not available/ },
    { label: 'a browser that cannot be used', control: unusableControl, subject: site(), expected: /no browser to render pages with/ },
    { label: 'a site that is not published', control: captureControl(), subject: site({ status: 'draft' }), expected: /has not been published yet/ },
    {
      label: 'a Project that is not running', control: captureControl(), subject: site(),
      project: { executionKind: 'managed', lifecycle: 'stopped' }, expected: /not an active managed Project/,
    },
    {
      label: 'an instance with no site address', control: captureControl(), subject: site(),
      gatewayHost: null, expected: /no site address/,
    },
    {
      label: 'a legacy row with nothing left to serve', control: captureControl(),
      subject: site({ kind: 'static', target: '', currentReleaseId: null }), expected: /no published files left to show/,
    },
  ]) {
    const { store, service, control } = previewHarness(t, entry);
    store.insertSite(entry.subject);
    const outcome = service.request(entry.subject.id, 'publish');
    assert.equal(outcome.ok, false, entry.label);
    assert.match(outcome.reason, entry.expected, entry.label);

    // The lazy path is silent about the same facts, but it must not launch a browser over them either.
    service.ensureFresh([entry.subject]);
    await service.settled();
    assert.equal(control?.calls?.length ?? 0, 0, `${entry.label}: the lazy path launches nothing`);
  }
});

test('the lazy path asks for a missing or outdated picture and nothing else', async (t) => {
  const control = captureControl();
  const harness = previewHarness(t, { control });
  const { store, service } = harness;
  store.insertSite(site({ id: 'site-1', slug: 'one-abc123' }));
  store.insertSite(site({ id: 'site-2', slug: 'two-abc123' }));

  service.ensureFresh(store.allSites());
  await service.settled();
  assert.equal(control.calls.length, 2, 'a picture nobody has taken is asked for on the first read');

  service.ensureFresh(store.allSites());
  await service.settled();
  assert.equal(control.calls.length, 2, 'a fresh picture is not taken again');

  // Age one of them past the TTL, exactly as time passing would. A reader is told nothing about it: the
  // very read that could report the age is the read that takes a new picture, so the age is work under
  // way rather than a state of the site.
  store.storePreviewImage('site-2', { bytes: 4, mime: 'image/webp', width: 1, height: 1 }, Date.now() - PREVIEW_IMAGE_TTL_MS - 1000);
  assert.equal(service.view('site-2').state, 'ready', 'an outdated picture is not reported as a state');
  assert.equal(service.view('site-1').state, 'ready', 'the other one is untouched');

  service.ensureFresh([store.siteById('site-2')]);
  await service.settled();
  assert.equal(control.calls.length, 3, 'and only the outdated one is taken again');
  assert.equal(service.view('site-2').state, 'ready');
});

test('a site whose capture failed is retried lazily, but not before its backoff has passed', async (t) => {
  const control = captureControl({ fail: new Error('nothing answered on the Project transport') });
  const { store, service } = previewHarness(t, { control });
  store.insertSite(site());

  await service.request('site-1', 'publish');
  await service.settled();
  assert.equal(control.calls.length, 1);

  // The retry is deferred, so a register left open does not launch a browser over a page that is down.
  service.ensureFresh(store.allSites());
  await service.settled();
  assert.equal(control.calls.length, 1, 'the backoff holds the next attempt back');

  // Once the backoff has passed, the next read tries again.
  const store2 = store;
  store2.storePreviewImage('site-1', { bytes: 1, mime: 'image/webp', width: 1, height: 1 }, Date.now());
  store2.failPreviewImage('site-1', 'still down', Date.now() - 1);
  service.ensureFresh(store.allSites());
  await service.settled();
  assert.equal(control.calls.length, 2, 'a due attempt is made on the next read');
  assert.equal(store.previewImage('site-1').attempts, 2, 'and its failure is counted');
  assert.ok(retryDelay(2) > retryDelay(1), 'so the wait after it is longer');
});

test('one capture runs at a time, however many sites are asked for', async (t) => {
  let concurrent = 0;
  let peak = 0;
  const control = captureControl({
    onCapture: async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
    },
  });
  const { store, service } = previewHarness(t, { control });
  for (const id of ['a', 'b', 'c']) store.insertSite(site({ id, slug: `${id}-abc123` }));

  for (const id of ['a', 'b', 'c']) assert.deepEqual(service.request(id, 'publish'), { ok: true });
  await service.settled();

  assert.equal(control.calls.length, 3);
  assert.equal(peak, 1, 'a second browser is never launched over the first');
});

test('a manager may ask again only after the rate limit, and a publish is not rate limited', async (t) => {
  const control = captureControl();
  const { store, service } = previewHarness(t, { control });
  store.insertSite(site());

  assert.deepEqual(service.request('site-1', 'manual'), { ok: true });
  await service.settled();

  const refused = service.request('site-1', 'manual');
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /a moment ago/);
  assert.ok(refused.retryAfterMs > 0 && refused.retryAfterMs <= PREVIEW_MANUAL_REFRESH_MIN_MS,
    'the refusal says how long to wait');

  // A publish is not a person pressing a button twice: it has just made the address live, and a picture of
  // it is the point of the register that follows.
  assert.deepEqual(service.request('site-1', 'publish'), { ok: true });
  await service.settled();
  assert.equal(control.calls.length, 2);
});

test('a request that is already in flight is not started twice', async (t) => {
  const control = captureControl({ onCapture: async () => { await new Promise((resolve) => setTimeout(resolve, 5)); } });
  const { store, service } = previewHarness(t, { control });
  store.insertSite(site());

  assert.deepEqual(service.request('site-1', 'publish'), { ok: true });
  const second = service.request('site-1', 'publish');
  assert.equal(second.ok, false);
  assert.match(second.reason, /already being taken/);
  assert.equal(service.view('site-1').state, 'pending', 'and the register is told one is coming');
  await service.settled();
  assert.equal(control.calls.length, 1);
});

test('the wait after a failure doubles and stays capped', () => {
  assert.equal(retryDelay(0), 60_000);
  assert.equal(retryDelay(1), 120_000);
  assert.equal(retryDelay(2), 240_000);
  assert.equal(retryDelay(20), 30 * 60_000, 'a page that is down is not retried faster for waiting longer');
});

// ── the grant ────────────────────────────────────────────────────────────────────────────────────

test('a capture grant is spent exactly once, and only by the site and generation it was minted for', () => {
  const store = new SitesStore(makeDb());
  store.insertSite(site());

  store.putCaptureGrant('hash-a', 'site-1', 1, Date.now() + CAPTURE_GRANT_TTL_MS);
  assert.equal(store.takeCaptureGrant('hash-a', 'site-1', 1, Date.now()), true);
  assert.equal(store.takeCaptureGrant('hash-a', 'site-1', 1, Date.now()), false, 'a spent grant is spent');

  store.putCaptureGrant('hash-b', 'site-1', 1, Date.now() + CAPTURE_GRANT_TTL_MS);
  assert.equal(store.takeCaptureGrant('hash-b', 'site-1', 2, Date.now()), false,
    'an access change between minting and use kills the grant');

  store.putCaptureGrant('hash-c', 'site-1', 1, Date.now() + CAPTURE_GRANT_TTL_MS);
  assert.equal(store.takeCaptureGrant('hash-c', 'site-2', 1, Date.now()), false, 'another site cannot present it');

  store.putCaptureGrant('hash-d', 'site-1', 1, Date.now() - 1);
  assert.equal(store.takeCaptureGrant('hash-d', 'site-1', 1, Date.now()), false, 'an expired grant is dead');

  assert.equal(store.takeCaptureGrant('hash-never-minted', 'site-1', 1, Date.now()), false);

  // A second capture replaces the first grant, so one that was never spent cannot be replayed later.
  store.putCaptureGrant('hash-e', 'site-1', 1, Date.now() + CAPTURE_GRANT_TTL_MS);
  store.putCaptureGrant('hash-f', 'site-1', 1, Date.now() + CAPTURE_GRANT_TTL_MS);
  assert.equal(store.takeCaptureGrant('hash-e', 'site-1', 1, Date.now()), false);
  assert.equal(store.takeCaptureGrant('hash-f', 'site-1', 1, Date.now()), true);

  store.putCaptureGrant('stale-hash', 'site-2', 1, Date.now() - 1);
  store.pruneCaptureGrants(Date.now());
  assert.equal(store.takeCaptureGrant('stale-hash', 'site-2', 1, Date.now() + 1000), false, 'the sweep removes it');
});

test('the grant on the wire is the one the store minted, and it is hashed at rest', async (t) => {
  const control = captureControl();
  const store = new SitesStore(makeDb());
  store.insertSite(site());
  const { service } = previewHarness(t, { control, store });
  await service.request('site-1', 'publish');
  await service.settled();

  const token = control.calls[0].headers[CAPTURE_HEADER];
  assert.equal(store.takeCaptureGrant(hashToken(token), 'site-1', 1, Date.now()), true);
  assert.equal(store.takeCaptureGrant(token, 'site-1', 1, Date.now()), false, 'the token itself is never the key');
});

// ── the serving path, through the site own published hostname ────────────────────────────────────

function serveHarness(t, { store = new SitesStore(makeDb()), proxyProject, allowPublicSites = true } = {}) {
  const counted = [];
  const upstream = [];
  const handler = createSiteHandler({
    store,
    access: {
      accountExists: (id) => [1, 2, 9].includes(id),
      isAdmin: (id) => id === 9,
      canAccessProject: () => false,
      allowPublicSites: () => allowPublicSites,
    },
    secret: () => 'session-secret',
    config: () => ({ ...config(), gatewayToken: 'gateway-proof' }),
    releaseDir: () => { throw new Error('a proxy publication has no release'); },
    countHit: (id) => counted.push(id),
    endpointFor: () => ({ kind: 'socket', path: '/run/publication.sock' }),
    proxyLimits: () => ({ maxResponseBytes: 1024, requestTimeoutSeconds: 1 }),
    proxyProject: proxyProject ?? (async (_endpoint, _req, path, viewer, _limits, _root, blocked) => {
      upstream.push({ path, viewer, blocked });
      return { status: 200, headers: { 'content-type': 'text/html' }, body: 'project application' };
    }),
    usernameOf: () => 'filip',
  });
  const request = (path, extra = {}) => handler({
    method: extra.method ?? 'GET',
    path,
    query: {},
    body: async () => Buffer.alloc(0),
    headers: {
      host: `${path.replace(/^\/+/, '').split('/')[0]}.sites.example`,
      'x-elowen-site-gateway': 'gateway-proof',
      // A page navigation, which is what a capture and a browser both send.
      accept: 'text/html,application/xhtml+xml',
      ...(extra.headers ?? {}),
    },
  });
  return { store, handler, request, counted, upstream };
}

test('a grant renders a private page once and leaves a session behind for its own assets', async (t) => {
  const store = new SitesStore(makeDb());
  store.insertSite(site());
  const { request, counted, upstream } = serveHarness(t, { store });

  const served = await request('demo-abc123/', { headers: { [CAPTURE_HEADER]: mintGrant(store, 'site-1') } });
  assert.equal(served.status, 200, 'the page the grant was minted for is served');
  const setCookie = served.headers['set-cookie'];
  assert.ok(Array.isArray(setCookie), 'the response carries cookies');
  const captureCookie = setCookie.find((line) => line.startsWith(`${captureCookieName('site-1')}=`));
  assert.ok(captureCookie, 'and one of them is the capture session');

  // Every asset the page then asks for is served on that cookie, with no grant left to present.
  const asset = await request('demo-abc123/app.js', { headers: { cookie: captureCookie.split(';')[0] } });
  assert.equal(asset.status, 200);

  assert.deepEqual(counted, [], 'a picture of the page is not a visit, and neither are the assets it loads');
  assert.deepEqual(upstream.map((entry) => entry.viewer), [{ userId: null, name: null }, { userId: null, name: null }],
    'the render is anonymous upstream: the grant is not an account');
  assert.deepEqual(upstream[0].blocked, [cookieName('site-1'), captureCookieName('site-1')],
    'and neither cookie this plugin owns reaches the application');

  // A visitor with no capability at all is still sent to sign in.
  const stranger = await request('demo-abc123/');
  assert.equal(stranger.status, 302);
  assert.match(stranger.headers.location, /\/p\/sites\/enter/);
});

test('an ordinary visitor is counted as a visit, and only a capture is exempt from it', async (t) => {
  const store = new SitesStore(makeDb());
  store.insertSite(site());
  store.addMember('site-1', 2);
  const { request, counted } = serveHarness(t, { store });

  // What a person's browser presents: the site's own session, minted by the ticket handshake and re-decided
  // from live state on every request.
  const session = signSession('session-secret', { u: 2, g: 1, e: Date.now() + 60_000 });
  const visitor = await request('demo-abc123/', { headers: { cookie: `${cookieName('site-1')}=${session}` } });
  assert.equal(visitor.status, 200);
  assert.deepEqual(counted, ['site-1'], 'opening the page is a visit');
  assert.equal(visitor.headers['set-cookie'], undefined, 'and a visit mints no capture session');
});

test('a grant cannot be replayed, does not cross sites, and does not stand in for the gateway proof', async (t) => {
  const store = new SitesStore(makeDb());
  store.insertSite(site());
  store.insertSite(site({ id: 'site-2', slug: 'other-abc123' }));
  const { request, counted } = serveHarness(t, { store });

  const token = mintGrant(store, 'site-1');
  assert.equal((await request('demo-abc123/', { headers: { [CAPTURE_HEADER]: token } })).status, 200);
  const replayed = await request('demo-abc123/', { headers: { [CAPTURE_HEADER]: token } });
  assert.equal(replayed.status, 302, 'a spent grant is an ordinary anonymous visitor');
  assert.match(replayed.headers.location, /\/p\/sites\/enter/);

  const other = await request('other-abc123/', { headers: { [CAPTURE_HEADER]: mintGrant(store, 'site-2') } });
  assert.equal(other.status, 200, 'the grant for the other site works there');
  assert.equal((await request('demo-abc123/', { headers: { [CAPTURE_HEADER]: 'unknown-token' } })).status, 302);

  // The grant is not a way past the two proofs that a request came through the site gateway.
  const forgedHost = await request('demo-abc123/', { headers: { [CAPTURE_HEADER]: mintGrant(store, 'site-1'), host: 'app.example' } });
  assert.equal(forgedHost.status, 421, 'a wrong hostname is answered as a wrong address, capability or not');
  const forgedMarker = await request('demo-abc123/', { headers: { [CAPTURE_HEADER]: mintGrant(store, 'site-1'), 'x-elowen-site-gateway': 'wrong' } });
  assert.equal(forgedMarker.status, 404, 'and the gateway proof is not replaced by the grant');
  assert.deepEqual(counted, []);
});

test('an access change kills a grant that was minted before it', async (t) => {
  const store = new SitesStore(makeDb());
  store.insertSite(site());
  const { request } = serveHarness(t, { store });
  const token = mintGrant(store, 'site-1');
  store.bumpAccessGeneration('site-1');
  const response = await request('demo-abc123/', { headers: { [CAPTURE_HEADER]: token } });
  assert.equal(response.status, 302, 'sharing or unsharing is not bypassed by a picture already queued');
  assert.equal(response.headers['set-cookie'], undefined, 'and no capture session is minted');
});

test('a request with no grant, an unknown grant or an expired one is answered the same way', async (t) => {
  const store = new SitesStore(makeDb());
  store.insertSite(site({ visibility: 'public' }));
  const { request } = serveHarness(t, { store });

  for (const headers of [{}, { [CAPTURE_HEADER]: 'not-a-token' }, { [CAPTURE_HEADER]: '' }]) {
    const response = await request('demo-abc123/', { headers });
    assert.equal(response.status, 200, 'a public page answers a stranger and a bad token identically');
    assert.equal(response.headers['set-cookie'], undefined, 'and no capture session is minted for it');
  }

  const privateStore = new SitesStore(makeDb());
  privateStore.insertSite(site());
  const { request: privateRequest } = serveHarness(t, { store: privateStore });
  privateStore.putCaptureGrant(hashToken('expired-token'), 'site-1', 1, Date.now() - 1);
  assert.equal((await privateRequest('demo-abc123/', { headers: { [CAPTURE_HEADER]: 'expired-token' } })).status, 302);
});

// ── the API ──────────────────────────────────────────────────────────────────────────────────────

function apiHarness({ store = new SitesStore(makeDb()), previewImages, allowPublicSites = true } = {}) {
  const request = (overrides = {}) => ({
    auth: { userId: 1, admin: false, accessibleProjects: [] },
    method: 'GET', path: '', query: {}, headers: {},
    body: async () => Buffer.alloc(0), json: async () => ({}),
    ...overrides,
  });
  const handlers = createApiHandlers({
    store,
    access: {
      accountExists: (id) => [1, 2, 9].includes(id),
      isAdmin: (id) => id === 9,
      canAccessProject: () => false,
      allowPublicSites: () => allowPublicSites,
    },
    config: () => config(),
    previewImages,
    people: () => new Map([[1, { id: 1, username: 'filip', name: 'Filip', avatar: '' }]]),
    projectSlug: () => 'kolin',
    deleteSite: () => {},
    activateRelease: () => {},
    gatewayReadiness: async () => ({ ok: true, status: 'active' }),
    gatewayRecord: () => null,
  });
  return { store, handlers, request };
}

test('the picture endpoint serves what was stored, to whoever may open the page', async (t) => {
  const harness = previewHarness(t, { control: captureControl({ bytes: Buffer.from('picture-bytes') }) });
  const { store, service } = harness;
  store.insertSite(site());
  await service.request('site-1', 'publish');
  await service.settled();
  const { handlers, request } = apiHarness({ store, previewImages: service });

  const owner = await handlers.site(request({ path: 'site-1/preview' }));
  assert.equal(owner.status, 200);
  assert.equal(Buffer.from(owner.body).toString(), 'picture-bytes');
  assert.equal(owner.headers['content-type'], 'image/webp');
  assert.equal(owner.headers['x-content-type-options'], 'nosniff');
  assert.match(owner.headers['cache-control'], /immutable/);
  assert.equal(owner.headers.etag, '"preview-1"', 'the version is the cache key');

  // An account the page was never shared with may neither open it nor see a picture of it.
  const stranger = await handlers.site(request({ path: 'site-1/preview', auth: { userId: 2, admin: false, accessibleProjects: [] } }));
  assert.equal(stranger.status, 404, 'a page this account may not open is indistinguishable from one that does not exist');

  // An account the page was shared with may see the picture of it.
  store.addMember('site-1', 2);
  const guest = await handlers.site(request({ path: 'site-1/preview', auth: { userId: 2, admin: false, accessibleProjects: [] } }));
  assert.equal(guest.status, 200);
});

test('the picture endpoint ignores anything a caller adds to the request', async (t) => {
  const harness = previewHarness(t, { control: captureControl() });
  const { store, service } = harness;
  store.insertSite(site());
  await service.request('site-1', 'publish');
  await service.settled();
  const { handlers, request } = apiHarness({ store, previewImages: service });

  // There is no URL, host or path parameter to take: what is served is the site's own stored picture, and a
  // query full of instructions changes nothing about it.
  const response = await handlers.site(request({
    path: 'site-1/preview',
    query: { url: 'http://169.254.169.254/latest/meta-data/', host: 'evil.example', path: '../../etc/passwd' },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'image/webp');

  const missing = await handlers.site(request({ path: 'no-such-site/preview' }));
  assert.equal(missing.status, 404);

  const empty = await handlers.site(request({ path: 'site-empty/preview' }));
  assert.equal(empty.status, 404);
  assert.equal(empty.body.error, 'not found');
});

test('a manager can ask for a new picture, is rate limited, and a guest cannot ask at all', async (t) => {
  const harness = previewHarness(t, { control: captureControl() });
  const { store, service } = harness;
  store.insertSite(site());
  const { handlers, request } = apiHarness({ store, previewImages: service });

  const accepted = await handlers.site(request({ method: 'POST', path: 'site-1/preview/refresh' }));
  assert.equal(accepted.status, 202);
  assert.deepEqual(accepted.body, { queued: true });
  await service.settled();

  const limited = await handlers.site(request({ method: 'POST', path: 'site-1/preview/refresh' }));
  assert.equal(limited.status, 429);
  assert.match(limited.body.error, /a moment ago/);
  assert.ok(Number(limited.headers['retry-after']) > 0, 'the answer says how long to wait');

  // An account the page was never shared with learns nothing about it, exactly as every other route here.
  const stranger = await handlers.site(request({
    method: 'POST', path: 'site-1/preview/refresh', auth: { userId: 2, admin: false, accessibleProjects: [] },
  }));
  assert.equal(stranger.status, 404);
  // An account that may open the page but does not own it is refused for what it asks.
  store.addMember('site-1', 2);
  const guest = await handlers.site(request({
    method: 'POST', path: 'site-1/preview/refresh', auth: { userId: 2, admin: false, accessibleProjects: [] },
  }));
  assert.equal(guest.status, 403);

  // A site this instance cannot picture is refused with the reason rather than accepted and forgotten.
  store.insertSite(site({ id: 'site-draft', slug: 'draft-abc123', status: 'draft' }));
  const draft = await handlers.site(request({ method: 'POST', path: 'site-draft/preview/refresh' }));
  assert.equal(draft.status, 409);
  assert.match(draft.body.error, /not been published yet/);
});

test('the listing carries the picture state and asks only for the pictures this account owns', async (t) => {
  const control = captureControl();
  const harness = previewHarness(t, { control });
  const { store, service } = harness;
  store.insertSite(site());
  store.insertSite(site({ id: 'site-shared', slug: 'shared-abc123', ownerUserId: 2 }));
  store.addMember('site-shared', 1);
  const { handlers, request } = apiHarness({ store, previewImages: service });

  const listed = await handlers.list(request());
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.mine[0].preview, { state: 'pending', version: 0, capturedAt: null, width: null, height: null },
    'the register is told a picture is coming');
  assert.equal(listed.body.shared[0].preview.state, 'none',
    'a page this account only has shared with it is not pictured on its behalf');

  await service.settled();
  assert.equal(control.calls.length, 1, 'exactly the account own site was pictured');

  const refreshed = await handlers.list(request());
  assert.equal(refreshed.body.mine[0].preview.state, 'ready');
  assert.equal(refreshed.body.mine[0].preview.version, 1);
  assert.notEqual(refreshed.body.mine[0].preview.capturedAt, null);
});

test('the drawer is told why there is no picture, and only its manager is', async (t) => {
  const harness = previewHarness(t, { control: unusableControl });
  const { store, service } = harness;
  store.insertSite(site());
  const { handlers, request } = apiHarness({ store, previewImages: service });

  const manager = await handlers.site(request({ path: 'site-1' }));
  assert.equal(manager.status, 200);
  assert.match(manager.body.previewNotice, /no browser to render pages with/);
  assert.equal(manager.body.site.preview.state, 'none');

  store.addMember('site-1', 2);
  const guest = await handlers.site(request({ path: 'site-1', auth: { userId: 2, admin: false, accessibleProjects: [] } }));
  assert.equal(guest.status, 200);
  assert.equal(guest.body.previewNotice, null, 'a guest is not told what this instance did on the owner behalf');
});

test('a Sites surface with no capture service still lists and serves everything else', async () => {
  const store = new SitesStore(makeDb());
  store.insertSite(site());
  const { handlers, request } = apiHarness({ store, previewImages: undefined });

  const listed = await handlers.list(request());
  assert.equal(listed.body.mine[0].preview.state, 'none');
  assert.equal((await handlers.site(request({ path: 'site-1' }))).body.previewNotice, null);
  assert.equal((await handlers.site(request({ path: 'site-1/preview' }))).status, 404);
  assert.equal((await handlers.site(request({ method: 'POST', path: 'site-1/preview/refresh' }))).status, 503);
});

// ── deletion and races ───────────────────────────────────────────────────────────────────────────

test('deleting a site takes its picture and its unspent grant with it', async (t) => {
  const harness = previewHarness(t, { control: captureControl() });
  const { store, service, root } = harness;
  store.insertSite(site());
  await service.request('site-1', 'publish');
  await service.settled();
  assert.notEqual(service.read('site-1'), null);

  store.putCaptureGrant('live-hash', 'site-1', 1, Date.now() + CAPTURE_GRANT_TTL_MS);
  store.beginDelete('site-1');

  assert.equal(store.previewImage('site-1'), null, 'a tombstone holds no metadata about a page that is gone');
  assert.equal(store.takeCaptureGrant('live-hash', 'site-1', 1, Date.now()), false,
    'and a grant minted before the deletion cannot render it afterwards');
  assert.deepEqual(store.deletingSites().map((entry) => entry.id), ['site-1']);

  store.deleteSite('site-1');
  assert.equal(store.previewImage('site-1'), null);
  // The bytes themselves go with the Site's own directory, which cleanup removes.
  rmSync(join(root, 'site-1'), { recursive: true, force: true });
  assert.equal(service.read('site-1'), null);
});

test('a picture taken while its site was being deleted is not recorded', async (t) => {
  const store = new SitesStore(makeDb());
  const root = tempDir('race');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  store.insertSite(site());
  const service = new SitePreviewImageService({
    store,
    siteDir: (id) => join(root, id),
    project: () => ACTIVE_PROJECT,
    // The deletion lands while the browser is rendering, which is the window a durable delete marker has to
    // close: the row must not be resurrected by a picture of a page nobody can reach any more.
    captureControl: () => captureControl({ onCapture: async () => { store.beginDelete('site-1'); } }),
    config: () => config(),
  });

  await service.request('site-1', 'publish');
  await service.settled();

  assert.equal(store.previewImage('site-1'), null, 'no metadata is written for a site that is gone');
});

test('a minted grant resolves to the token the capture was handed', async (t) => {
  const control = captureControl();
  const store = new SitesStore(makeDb());
  store.insertSite(site());
  const { service } = previewHarness(t, { control, store });
  await service.request('site-1', 'publish');
  await service.settled();
  assert.equal(store.takeCaptureGrant(hashToken(control.calls[0].headers[CAPTURE_HEADER]), 'site-1', 1, Date.now()), true);
});
