import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { parseSiteHostname } from '../plugins/sites/dist/hostname.js';
import { HostnameClaimError, SitesStore } from '../plugins/sites/dist/store.js';

const BASE = 'sites.example.com';
const NOW = Date.parse('2026-09-22T06:00:00.000Z');

const makeDb = ({ through = Infinity, from } = {}) => {
  const raw = from?.raw ?? new Database(':memory:');
  const applied = new Set(from?.applied ?? []);
  const handle = { exec: (sql) => raw.exec(sql), prepare: (sql) => raw.prepare(sql) };
  return {
    ...handle,
    raw,
    applied,
    migrate(steps) {
      for (const step of [...steps].sort((a, b) => a.version - b.version)) {
        if (step.version > through || applied.has(step.version)) continue;
        raw.transaction(() => {
          step.up(handle);
          applied.add(step.version);
        })();
      }
    },
    appliedVersion: () => Math.max(0, ...applied),
    transaction: (fn) => raw.transaction(fn)(),
  };
};

const insertV19Site = (db, { id, slug, status, requested = null, error = null }) => {
  db.prepare(`INSERT INTO p_sites_sites (
    id, slug, title, project_id, owner_user_id, source_dir, source_rel, runtime, status,
    created_at, updated_at, certificate_requested_at, certificate_error
  ) VALUES (?, ?, ?, 7, 1, '', '', 'static', ?, ?, ?, ?, ?)`).run(
    id, slug, slug, status,
    '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', requested, error,
  );
};

const site = (id, slug = id) => ({
  id,
  slug,
  title: id,
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
  createdAt: '2026-09-22T06:00:00.000Z',
  updatedAt: '2026-09-22T06:00:00.000Z',
  createdModel: 'test/model',
  lastPublishAt: null,
  lastPublishModel: null,
  lastError: null,
});

const storeOptions = (overrides = {}) => ({
  hostnameBase: BASE,
  now: () => NOW,
  randomId: (() => { let n = 0; return () => `hostname-${++n}`; })(),
  randomToken: (() => { let n = 0; return () => `token-${++n}`; })(),
  ...overrides,
});

test('migration v20 upgrades the exact v19 shape and preserves generated URL and certificate intent', () => {
  const v19 = makeDb({ through: 19 });
  new SitesStore(v19, { hostnameBase: BASE });
  insertV19Site(v19, { id: 'live', slug: 'live-a1', status: 'live' });
  insertV19Site(v19, { id: 'draft', slug: 'draft-a1', status: 'draft', requested: '2026-09-20T00:00:00.000Z' });
  insertV19Site(v19, { id: 'failed', slug: 'failed-a1', status: 'failed', error: 'certbot refused' });
  insertV19Site(v19, { id: 'deleting', slug: 'deleting-a1', status: 'deleting' });

  const upgraded = makeDb({ from: v19 });
  const store = new SitesStore(upgraded, { hostnameBase: BASE });

  assert.equal(upgraded.appliedVersion(), 21);
  const siteColumns = upgraded.prepare("PRAGMA table_info('p_sites_sites')").all().map((column) => column.name);
  assert.ok(siteColumns.includes('primary_custom_hostname_id'));
  assert.ok(!siteColumns.includes('certificate_requested_at'));
  assert.ok(!siteColumns.includes('certificate_error'));

  const rows = upgraded.prepare(`SELECT site_id, hostname, certificate_state, certificate_requested_at,
    certificate_error_code, certificate_error_detail, removal_requested_at
    FROM p_sites_hostnames ORDER BY site_id`).all();
  assert.deepEqual(rows, [
    {
      site_id: 'deleting', hostname: 'deleting-a1.sites.example.com', certificate_state: 'none',
      certificate_requested_at: null, certificate_error_code: null, certificate_error_detail: null,
      removal_requested_at: '2026-01-02T00:00:00.000Z',
    },
    {
      site_id: 'draft', hostname: 'draft-a1.sites.example.com', certificate_state: 'requested',
      certificate_requested_at: '2026-09-20T00:00:00.000Z', certificate_error_code: null, certificate_error_detail: null,
      removal_requested_at: null,
    },
    {
      site_id: 'failed', hostname: 'failed-a1.sites.example.com', certificate_state: 'authority_refused',
      certificate_requested_at: null, certificate_error_code: 'authority_refused', certificate_error_detail: 'certbot refused',
      removal_requested_at: null,
    },
    {
      site_id: 'live', hostname: 'live-a1.sites.example.com', certificate_state: 'none',
      certificate_requested_at: null, certificate_error_code: null, certificate_error_detail: null,
      removal_requested_at: null,
    },
  ]);
  for (const id of ['live', 'draft', 'failed', 'deleting']) {
    const original = store.siteForCleanup(id);
    assert.equal(store.generatedHostname(id).hostname, `${original.slug}.${BASE}`);
  }
  store.completeHostnameRemoval(store.generatedHostname('deleting').id);
  assert.equal(store.generatedHostname('deleting'), null,
    'a pre-existing deletion can continue cleanup immediately after migration');
});

test('a hostless v19 upgrade starts and reconciles generated rows when a base later appears', () => {
  const v19 = makeDb({ through: 19 });
  new SitesStore(v19);
  insertV19Site(v19, {
    id: 'hostless',
    slug: 'hostless-a1',
    status: 'live',
    requested: '2026-09-20T00:00:00.000Z',
  });

  const upgraded = makeDb({ from: v19 });
  const hostless = new SitesStore(upgraded);
  assert.equal(upgraded.appliedVersion(), 21);
  assert.equal(hostless.generatedHostname('hostless'), null);

  const configured = new SitesStore(makeDb({ from: upgraded }), { hostnameBase: BASE });
  const generated = configured.generatedHostname('hostless');
  assert.equal(generated.hostname, 'hostless-a1.sites.example.com');
  assert.equal(generated.certificateState, 'none',
    'a live Site without an issued slug remains eligible for the ordinary certificate sweep');
});


test('claims are globally case-insensitive and the ten-hostname limit is enforced atomically', () => {
  const store = new SitesStore(makeDb(), storeOptions());
  store.insertSite(site('site-1'));
  store.insertSite(site('site-2'));

  store.claimCustomHostname('site-1', parseSiteHostname('One.Customer.example'));
  assert.throws(() => store.claimCustomHostname('site-2', parseSiteHostname('ONE.customer.example')),
    (error) => error instanceof HostnameClaimError && error.code === 'domain_claimed');

  for (let index = 2; index <= 10; index += 1) {
    store.claimCustomHostname('site-1', parseSiteHostname(`host-${index}.customer.example`));
  }
  assert.throws(() => store.claimCustomHostname('site-1', parseSiteHostname('host-11.customer.example')),
    (error) => error instanceof HostnameClaimError && error.code === 'hostname_limit');
  assert.equal(store.customHostnames('site-1').length, 10);
});

test('an unverified reservation expires after 24 hours while a verified claim does not', () => {
  let now = NOW;
  const store = new SitesStore(makeDb(), storeOptions({ now: () => now }));
  store.insertSite(site('site-1'));
  store.insertSite(site('site-2'));

  const expiring = store.claimCustomHostname('site-1', parseSiteHostname('expiring.customer.example'));
  assert.equal(Date.parse(expiring.ownershipExpiresAt) - NOW, 24 * 60 * 60 * 1000);
  now += 24 * 60 * 60 * 1000;
  store.claimCustomHostname('site-2', parseSiteHostname('expiring.customer.example'));
  assert.equal(store.customHostnames('site-1').some((row) => row.id === expiring.id), false);

  const durable = store.claimCustomHostname('site-1', parseSiteHostname('durable.customer.example'));
  store.verifyHostnameOwnership(durable.id);
  now += 30 * 24 * 60 * 60 * 1000;
  store.expireUnverifiedHostnameReservations();
  assert.equal(store.hostnameById(durable.id).ownershipExpiresAt, null);
  assert.notEqual(store.hostnameById(durable.id).ownershipVerifiedAt, null);
});

test('first ready custom hostname becomes primary and changing primary validates in one transaction', () => {
  const store = new SitesStore(makeDb(), storeOptions());
  store.insertSite(site('site-1'));
  store.insertSite(site('site-2'));

  const first = store.claimCustomHostname('site-1', parseSiteHostname('first.customer.example'));
  const second = store.claimCustomHostname('site-1', parseSiteHostname('second.customer.example'));
  const foreign = store.claimCustomHostname('site-2', parseSiteHostname('foreign.customer.example'));
  assert.throws(
    () => store.recordHostnameCertificate(first.id, { state: 'ready' }),
    /verified ownership and ready DNS/,
  );
  const activate = (hostname) => {
    store.verifyHostnameOwnership(hostname.id);
    store.recordHostnameDns(hostname.id, 'ready', ['192.0.2.10']);
    store.recordHostnameCertificate(hostname.id, { state: 'ready' });
  };
  activate(first);
  assert.equal(store.siteById('site-1').primaryCustomHostnameId, first.id);

  activate(second);
  activate(foreign);
  store.setPrimaryCustomHostname('site-1', second.id);
  assert.equal(store.siteById('site-1').primaryCustomHostnameId, second.id);

  assert.throws(() => store.setPrimaryCustomHostname('site-1', foreign.id));
  assert.equal(store.siteById('site-1').primaryCustomHostnameId, second.id, 'failed change preserves the prior primary');
});

test('stored DNS observations are decoded only from validated string arrays', () => {
  const db = makeDb();
  const store = new SitesStore(db, storeOptions());
  store.insertSite(site('site-1'));
  const claimed = store.claimCustomHostname('site-1', parseSiteHostname('observed.customer.example'));
  store.recordHostnameDns(claimed.id, 'misdirected', ['192.0.2.10', '2001:db8::20']);
  assert.deepEqual(store.hostnameById(claimed.id).dnsObserved, ['192.0.2.10', '2001:db8::20']);

  db.prepare('UPDATE p_sites_hostnames SET dns_observed_json = ? WHERE id = ?')
    .run('{"not":"an array"}', claimed.id);
  assert.throws(() => store.hostnameById(claimed.id), /Invalid stored DNS observation values/);
});


test('removal and Site deletion retain hostname reservations until cleanup completes', () => {
  const store = new SitesStore(makeDb(), storeOptions());
  store.insertSite(site('site-1'));
  store.insertSite(site('site-2'));
  const claimed = store.claimCustomHostname('site-1', parseSiteHostname('held.customer.example'));

  store.requestHostnameRemoval(claimed.id);
  assert.throws(() => store.claimCustomHostname('site-2', parseSiteHostname('held.customer.example')),
    (error) => error.code === 'domain_claimed');
  store.completeHostnameRemoval(claimed.id);
  store.claimCustomHostname('site-2', parseSiteHostname('held.customer.example'));

  store.beginDelete('site-1');
  assert.ok(store.hostnamesForSite('site-1').every((row) => row.removalRequestedAt !== null));
  assert.throws(() => store.deleteSite('site-1'), /hostname cleanup/);
  for (const row of store.hostnamesForSite('site-1')) store.completeHostnameRemoval(row.id);
  store.deleteSite('site-1');
  assert.equal(store.siteForCleanup('site-1'), null);
});
