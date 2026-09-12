import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createServer } from 'node:net';

import { SitesStore } from '../plugins/sites/dist/store.js';
import { SiteCertificateService, evaluatePeerCertificate, probeGatewayCertificate, recordedCertificate, sitesDueForCertificate } from '../plugins/sites/dist/certificate.js';

const HOSTNAME = 'demo-abc123.sites.elowen.example';
const OTHER_HOSTNAME = 'someone-else.sites.elowen.example';

/** The plugin database as the daemon's `makePluginDb` behaves: steps run in version order, each one at
 *  most once, and the record of what ran survives the database being opened again. `through` stops the
 *  chain where an older release left it; `from` reopens a database an earlier `makeDb` produced. */
const makeDb = ({ beforeStep, through = Infinity, from } = {}) => {
  const db = from?.raw ?? new Database(':memory:');
  const applied = new Set(from?.applied ?? []);
  const handle = { exec: (sql) => db.exec(sql), prepare: (sql) => db.prepare(sql) };
  return {
    ...handle,
    raw: db,
    applied,
    migrate: (steps) => {
      for (const step of [...steps].sort((a, b) => a.version - b.version)) {
        if (step.version > through || applied.has(step.version)) continue;
        beforeStep?.(step.version, handle);
        step.up(handle);
        applied.add(step.version);
      }
    },
    appliedVersion: () => Math.max(0, ...applied),
    transaction: (fn) => db.transaction(fn)(),
  };
};

/** Column definitions as SQLite reports them, reduced to what a migration decides. */
const tableShape = (db, table) => db.prepare(`PRAGMA table_info('${table}')`).all()
  .map(({ name, type, notnull, dflt_value: dflt }) => ({ name, type, notnull, dflt }));

/** A site row exactly as a release before the certificate columns wrote one. */
const insertLegacySite = (handle, id) => handle.prepare(`INSERT INTO p_sites_sites (
  id, slug, title, project_id, owner_user_id, source_dir, runtime, status, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
  id, `${id}-abc123`, 'Legacy', 7, 1, '/tmp/legacy', 'static', 'live',
  '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
);

const site = (overrides = {}) => ({
  id: 'site-1',
  slug: 'demo-abc123',
  title: 'Demo',
  summary: '',
  projectId: 7,
  ownerUserId: 1,
  visibility: 'private',
  accessGeneration: 1,
  sourceRel: 'sites/demo-abc123',
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

/** A certificate as `tls.TLSSocket.getPeerCertificate()` reports one, reduced to the fields judged. */
const peerCertificate = ({ names = [HOSTNAME], from = '2026-01-01T00:00:00.000Z', to = '2027-01-01T00:00:00.000Z' } = {}) => ({
  subject: { CN: names[0] },
  subjectaltname: names.map((name) => `DNS:${name}`).join(', '),
  valid_from: new Date(from).toUTCString(),
  valid_to: new Date(to).toUTCString(),
});

const harness = ({ canIssue = true, issue, probe, mayAttempt = true, issuedSlugs = [] } = {}) => {
  const db = makeDb();
  const store = new SitesStore(db);
  store.insertSite(site());
  const issued = [];
  const probed = [];
  const service = new SiteCertificateService({
    canIssue: () => canIssue,
    issue: async (slug) => {
      issued.push(slug);
      if (issue) await issue(slug);
    },
    mayAttempt: () => mayAttempt,
    issuedSlugs: () => (canIssue ? issuedSlugs : null),
    store,
    probe: async (hostname) => {
      probed.push(hostname);
      return probe ? await probe(hostname) : { reachable: true, covered: true, detail: `serving ${hostname}` };
    },
  });
  return { store, service, issued, probed, site: () => store.siteById('site-1') };
};

const NOT_COVERED = {
  reachable: true,
  covered: false,
  detail: `the gateway answers ${HOSTNAME} with a certificate for ${OTHER_HOSTNAME}`,
};

test('a foreign certificate served for a site hostname is not read as coverage', () => {
  const observation = evaluatePeerCertificate(HOSTNAME, peerCertificate({ names: [OTHER_HOSTNAME] }), Date.parse('2026-06-01T00:00:00Z'));

  assert.equal(observation.reachable, true);
  assert.equal(observation.covered, false);
  assert.match(observation.detail, new RegExp(OTHER_HOSTNAME));
});

test('a certificate naming the site and inside its validity window is coverage', () => {
  const observation = evaluatePeerCertificate(HOSTNAME, peerCertificate(), Date.parse('2026-06-01T00:00:00Z'));

  assert.equal(observation.covered, true);
});

test('an expired certificate for the right hostname is not coverage', () => {
  const observation = evaluatePeerCertificate(HOSTNAME, peerCertificate(), Date.parse('2028-06-01T00:00:00Z'));

  assert.equal(observation.covered, false);
  assert.match(observation.detail, /validity window/);
});

test('a handshake that presents no certificate at all is not coverage', () => {
  const observation = evaluatePeerCertificate(HOSTNAME, {}, Date.now());

  assert.equal(observation.covered, false);
  assert.match(observation.detail, /without presenting a certificate/);
});

test('publishing where the broker is present and issuance succeeds reports a verified certificate', async () => {
  const h = harness();

  const readiness = await h.service.publish(site(), HOSTNAME);

  assert.equal(readiness.state, 'ready');
  assert.deepEqual(h.issued, ['demo-abc123']);
  assert.deepEqual(h.probed, [HOSTNAME]);
  // The request is answered by the attempt, so nothing is left for the sweep to redo.
  assert.equal(h.site().certificateRequestedAt, null);
  assert.equal(h.site().certificateError, null);
});

test('a refused issuance is reported as an error carrying the authority reason and is recorded on the row', async () => {
  const h = harness({ issue: () => { throw new Error('certbot failed: too many failed authorizations recently'); } });

  const readiness = await h.service.publish(site(), HOSTNAME);

  assert.equal(readiness.state, 'error');
  assert.match(readiness.detail, /too many failed authorizations recently/);
  assert.equal(h.site().certificateError, 'certbot failed: too many failed authorizations recently');
  assert.equal(h.site().certificateRequestedAt, null);
  // The failure is terminal for this call: no probe can turn a refusal into a usable address.
  assert.deepEqual(h.probed, []);
});

test('a hostname not yet answered right after its own issuance is transient, not a fault', async () => {
  // A gateway reload returns before the running workers have swapped, so a handshake microseconds after
  // issuance can still be answered by the configuration that was live a moment ago. Reporting the ordinary
  // successful publish as an error would be the same defect in the other direction.
  const h = harness({ probe: async () => NOT_COVERED, issuedSlugs: ['demo-abc123'] });

  const readiness = await h.service.publish(site(), HOSTNAME);

  assert.equal(readiness.state, 'pending');
  assert.match(readiness.detail, /was issued and the gateway reloaded/);
  assert.deepEqual(h.issued, ['demo-abc123']);
});

test('nothing is claimed usable when a fresh issuance is not being served', async () => {
  // The safety half of the case above, asserted on its own so a later change to how the transient is worded
  // can never quietly turn a hostname the gateway is not serving into a verified one.
  const h = harness({ probe: async () => NOT_COVERED, issuedSlugs: ['demo-abc123'] });

  const readiness = await h.service.publish(site(), HOSTNAME);

  assert.notEqual(readiness.state, 'ready');
  assert.match(readiness.detail, new RegExp(OTHER_HOSTNAME));
});

test('a certificate that exists but is not being served never degrades into a pending wait', async () => {
  // The state after issuance succeeded and the gateway config did not follow. Reporting it as pending would
  // promise a sweep that has already run, so a reader would wait for something nobody is going to do.
  const h = harness({ probe: async () => NOT_COVERED, issuedSlugs: ['demo-abc123'] });

  const afterRead = await h.service.readiness(site(), HOSTNAME);

  assert.equal(afterRead.state, 'error');
  assert.match(afterRead.detail, /holds a certificate/);
});

test('a peer that accepts the connection and then says nothing is bounded, not waited on forever', async (t) => {
  // `tls.connect`'s own timeout option fires on inactivity, which this peer never triggers, so a publish
  // would hang on it. Also the one place the real probe — SNI, sockets and settle-once — actually runs.
  const held = [];
  const server = createServer((socket) => { held.push(socket); });
  t.after(() => { for (const socket of held) socket.destroy(); server.close(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const started = Date.now();
  const observation = await probeGatewayCertificate(HOSTNAME, { host: '127.0.0.1', port });

  assert.equal(observation.reachable, false);
  assert.equal(observation.covered, false);
  assert.match(observation.detail, /did not complete a TLS handshake within/);
  assert.ok(Date.now() - started < 15_000, 'the probe must settle on its own deadline');
});

test('a port nothing listens on is reported unreachable rather than treated as pending coverage', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));

  const observation = await probeGatewayCertificate(HOSTNAME, { host: '127.0.0.1', port });

  assert.equal(observation.reachable, false);
  assert.match(observation.detail, /did not answer a TLS handshake/);
});

test('a backed-off slug is not asked again, and reports the recorded reason instead', async () => {
  // The authority counts failed validations per hostname per hour against a budget every site shares, so the
  // path an agent repeats after reading a failure must not be the one that spends it.
  const h = harness({ mayAttempt: false, probe: async () => NOT_COVERED });
  h.store.updateSite('site-1', { certificateError: 'certbot failed: too many failed authorizations recently' });

  const readiness = await h.service.publish(site(), HOSTNAME);

  assert.deepEqual(h.issued, []);
  assert.equal(readiness.state, 'error');
  assert.match(readiness.detail, /too many failed authorizations recently/);
});

test('a correctly named certificate from an untrusted chain is not coverage', () => {
  // A browser refuses this exactly as firmly as the wrong name, and the handshake answers it for free.
  const observation = evaluatePeerCertificate(HOSTNAME, peerCertificate(), Date.parse('2026-06-01T00:00:00Z'), {
    trusted: false,
    detail: 'SELF_SIGNED_CERT_IN_CHAIN',
  });

  assert.equal(observation.covered, false);
  assert.match(observation.detail, /SELF_SIGNED_CERT_IN_CHAIN/);
});

test('the validity window is read from the shape OpenSSL actually reports', () => {
  // Node hands back `Sep 12 02:00:00 2026 GMT`, not an ISO string, and a parser that only handled the
  // latter would report every real certificate as having no readable window.
  const observation = evaluatePeerCertificate(HOSTNAME, {
    subject: { CN: HOSTNAME },
    subjectaltname: `DNS:${HOSTNAME}`,
    valid_from: 'Sep 12 02:00:00 2026 GMT',
    valid_to: 'Dec 11 02:00:00 2026 GMT',
  }, Date.parse('2026-10-01T00:00:00Z'));

  assert.equal(observation.covered, true);
});

test('publishing without the broker records the request for the daemon and reports pending, issuing nothing', async () => {
  const h = harness({ canIssue: false, probe: async () => NOT_COVERED });

  const readiness = await h.service.publish(site(), HOSTNAME);

  assert.equal(readiness.state, 'pending');
  assert.deepEqual(h.issued, []);
  assert.notEqual(h.site().certificateRequestedAt, null);
  assert.match(readiness.detail, /requested/);
});

test('a recorded issuance failure outranks a pending handshake when readiness is read', async () => {
  const h = harness({ canIssue: false, probe: async () => NOT_COVERED });
  h.store.updateSite('site-1', { certificateError: 'certbot failed: DNS problem' });

  const readiness = await h.service.readiness(site(), HOSTNAME);

  assert.equal(readiness.state, 'error');
  assert.match(readiness.detail, /DNS problem/);
});

test('a gateway that answers no TLS handshake is an error rather than a pending certificate', async () => {
  const h = harness({ canIssue: false, probe: async () => ({ reachable: false, covered: false, detail: 'connect ECONNREFUSED 127.0.0.1:443' }) });

  const readiness = await h.service.readiness(site(), HOSTNAME);

  assert.equal(readiness.state, 'error');
  assert.match(readiness.detail, /ECONNREFUSED/);
});

test('the sweep selector skips drafts and certified sites but never an explicitly requested one', () => {
  const sites = [
    { slug: 'draft', status: 'draft', certificateRequestedAt: null },
    { slug: 'certified', status: 'live', certificateRequestedAt: null },
    { slug: 'uncertified', status: 'live', certificateRequestedAt: null },
    { slug: 'certified-but-requested', status: 'live', certificateRequestedAt: '2026-09-12T02:40:00.000Z' },
  ];

  const due = sitesDueForCertificate(sites, {
    all: false,
    issued: new Set(['certified', 'certified-but-requested']),
    mayAttempt: () => true,
  });

  assert.deepEqual(due.map((entry) => entry.slug), ['uncertified', 'certified-but-requested']);
});

test('the backoff outranks an explicit request, so a retry loop cannot spend the failure budget', () => {
  // The request overrides the "already issued" skip and NOTHING else. Letting it override the backoff put
  // the authority's shared per-hour validation budget at the mercy of an agent republishing after a failure.
  const sites = [
    { slug: 'backed-off', status: 'live', certificateRequestedAt: null },
    { slug: 'backed-off-but-requested', status: 'live', certificateRequestedAt: '2026-09-12T02:40:00.000Z' },
    { slug: 'requested-draft', status: 'draft', certificateRequestedAt: '2026-09-12T02:40:00.000Z' },
  ];

  const due = sitesDueForCertificate(sites, { all: false, issued: new Set(), mayAttempt: () => false });

  assert.deepEqual(due, []);
});

test('a hostname this process cannot derive is pending without the broker and an error with it', async () => {
  const withoutBroker = harness({ canIssue: false });
  const withBroker = harness();

  const runner = await withoutBroker.service.publish(site(), null);
  const daemon = await withBroker.service.publish(site(), null);

  assert.equal(runner.state, 'pending');
  assert.match(runner.detail, /no gateway broker/);
  // Recorded even with no hostname to probe: the daemon can derive one and is the process that will.
  assert.notEqual(withoutBroker.site().certificateRequestedAt, null);
  assert.equal(daemon.state, 'error');
  assert.match(daemon.detail, /no sites domain/);
  assert.deepEqual(withBroker.issued, []);
});

// ── the recorded half: what a listing may say without opening a socket ───────────────────────────
//
// `SiteList` reports many sites at once, so it cannot pay a TLS handshake each. Everything below is read
// from the row, and the point of the type is what it CANNOT say: a row records that a request was made and
// why an attempt failed, and neither establishes that the gateway is serving a certificate right now.

test('a row that has recorded nothing reports exactly that, and never that it is served', () => {
  const recorded = recordedCertificate(site());

  assert.equal(recorded.state, 'unrecorded');
  assert.match(recorded.detail, /neither a pending request nor a failure/);
  assert.doesNotMatch(recorded.detail, /\bserv(ing|ed)\b|\bvalid\b|\bverified\b/);
});

test('a recorded request reports the wait, with the stamp that says how long it has been waiting', () => {
  const recorded = recordedCertificate(site({ certificateRequestedAt: '2026-09-12T02:40:00.000Z' }));

  assert.equal(recorded.state, 'requested');
  assert.match(recorded.detail, /2026-09-12T02:40:00\.000Z/);
  assert.match(recorded.detail, /next gateway sweep/);
});

test('a recorded failure reports the authority reason and outranks a stale pending request', () => {
  // The order matters: a runner records a request BEFORE the daemon has had a chance to fail it again, so a
  // row can hold both. The failure is the fact a reader has to act on.
  const failed = recordedCertificate(site({ certificateError: 'certbot failed: too many failed authorizations recently' }));
  const both = recordedCertificate(site({
    certificateRequestedAt: '2026-09-12T02:40:00.000Z',
    certificateError: 'certbot failed: DNS problem',
  }));

  assert.equal(failed.state, 'error');
  assert.match(failed.detail, /too many failed authorizations recently/);
  assert.equal(both.state, 'error');
  assert.match(both.detail, /DNS problem/);
});

test('a site that is not live has no certificate line at all', () => {
  for (const status of ['draft', 'deleting']) {
    assert.equal(recordedCertificate(site({ status, certificateRequestedAt: '2026-09-12T02:40:00.000Z' })), null, status);
  }
});

test('no row in any combination can be read as a certificate that is ready', () => {
  // The safety assertion, exhaustive over the row shape: `ready` is a word only an observed handshake earns,
  // and this reader has none. A future state added here without a probe behind it fails this.
  for (const status of ['live', 'draft', 'deleting']) {
    for (const certificateRequestedAt of [null, '2026-09-12T02:40:00.000Z']) {
      for (const certificateError of [null, '', 'certbot failed: DNS problem']) {
        const recorded = recordedCertificate(site({ status, certificateRequestedAt, certificateError }));
        if (recorded === null) continue;
        assert.ok(['error', 'requested', 'unrecorded'].includes(recorded.state),
          `${status}/${certificateRequestedAt}/${certificateError} produced ${recorded.state}`);
        assert.notEqual(recorded.state, 'ready');
      }
    }
  }
});

test('the recorded reading is synchronous, which is what makes it probe-free', () => {
  // A TLS handshake cannot be awaited from a synchronous function, so returning without a promise IS the
  // proof that a listing of twenty sites opens no sockets. It also takes the row and nothing else — no
  // store, no gateway, no probe — so there is nothing it could reach even if it wanted to.
  assert.equal(recordedCertificate.constructor.name, 'Function', 'an async reader could hide a probe');
  assert.equal(recordedCertificate.length, 1, 'the row is the only input');
  const result = recordedCertificate(site());
  assert.equal(typeof result.then, 'undefined');
});

// ── the schema half: migration v18 ───────────────────────────────────────────────────────────────
//
// The two certificate columns are what the readiness path reads and writes, so an upgrade that does not
// produce them, or that disturbs the rows already there, breaks every behaviour above on a real database
// while every test using a freshly built schema still passes.

test('migration v18 adds two nullable certificate columns and leaves a row written before them intact', () => {
  const db = makeDb({ beforeStep: (version, handle) => { if (version === 18) insertLegacySite(handle, 'legacy'); } });
  const store = new SitesStore(db);

  const columns = new Map(tableShape(db, 'p_sites_sites').map((column) => [column.name, column]));
  for (const name of ['certificate_requested_at', 'certificate_error']) {
    assert.deepEqual(columns.get(name), { name, type: 'TEXT', notnull: 0, dflt: null },
      `${name} must be nullable with no default, so an existing row needs no value`);
  }

  const row = store.siteById('legacy');
  assert.equal(row.slug, 'legacy-abc123');
  assert.equal(row.status, 'live');
  assert.equal(row.runtime, 'static');
  assert.equal(row.certificateRequestedAt, null, 'a row that predates the columns has requested nothing');
  assert.equal(row.certificateError, null, 'and has recorded no failure');
  // It also behaves as one: a live site nobody has issued for is exactly what the sweep must pick up.
  assert.deepEqual(
    sitesDueForCertificate([row], { all: false, issued: new Set(), mayAttempt: () => true }).map((entry) => entry.slug),
    ['legacy-abc123'],
  );
});

test('opening a database that already carries migration v18 alters nothing and keeps its values', () => {
  const first = makeDb({ beforeStep: (version, handle) => { if (version === 18) insertLegacySite(handle, 'legacy'); } });
  const before = new SitesStore(first);
  before.updateSite('legacy', { certificateError: 'certbot failed: DNS problem' });
  const shapeBefore = tableShape(first, 'p_sites_sites');

  // The plugin is loaded again over the same database, as every daemon boot does.
  const reopened = makeDb({ from: first });
  const store = new SitesStore(reopened);

  assert.equal(reopened.appliedVersion(), 18);
  assert.deepEqual(tableShape(reopened, 'p_sites_sites'), shapeBefore, 'a second load adds no column a second time');
  assert.equal(store.siteById('legacy').certificateError, 'certbot failed: DNS problem');
});

test('a database left at the schema before the certificate columns upgrades into the shape of a fresh one', () => {
  const stamps = {
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    lastPublishAt: '2026-01-01T00:00:00.000Z',
  };
  const older = makeDb({ through: 17 });
  const olderStore = new SitesStore(older);
  olderStore.insertSite(site({ ...stamps }));
  assert.equal(older.appliedVersion(), 17, 'the older release stopped before the certificate columns');

  const upgraded = makeDb({ from: older });
  const store = new SitesStore(upgraded);
  const fresh = makeDb();
  const freshStore = new SitesStore(fresh);
  freshStore.insertSite(site({ ...stamps }));

  assert.equal(upgraded.appliedVersion(), 18);
  assert.deepEqual(tableShape(upgraded, 'p_sites_sites'), tableShape(fresh, 'p_sites_sites'));
  assert.deepEqual(store.siteById('site-1'), freshStore.siteById('site-1'),
    'an upgraded row reads back exactly like one written against the current schema');

  // And the upgraded database accepts what the readiness path writes.
  store.updateSite('site-1', { certificateRequestedAt: '2026-09-12T02:40:00.000Z' });
  assert.equal(store.siteById('site-1').certificateRequestedAt, '2026-09-12T02:40:00.000Z');
});
