import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createServer } from 'node:net';

import { SitesStore } from '../plugins/sites/dist/store.js';
import { SiteCertificateService, evaluatePeerCertificate, probeGatewayCertificate, recordedCertificate } from '../plugins/sites/dist/certificate.js';

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
  const store = new SitesStore(db, { hostnameBase: 'sites.elowen.example' });
  store.migrateSourceReferences(() => null);
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
  return {
    store,
    service,
    issued,
    probed,
    site: () => store.siteById('site-1'),
    hostname: () => store.generatedHostname('site-1'),
  };
};

const NOT_COVERED = {
  reachable: true,
  covered: false,
  detail: `the gateway answers ${HOSTNAME} with a certificate for ${OTHER_HOSTNAME}`,
};

const certificate = (overrides = {}) => ({
  certificateState: 'none',
  certificateRequestedAt: null,
  certificateErrorCode: null,
  certificateErrorDetail: null,
  ...overrides,
});

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
  assert.equal(h.hostname().certificateRequestedAt, null);
  assert.equal(h.hostname().certificateErrorDetail, null);
});

test('a refused issuance is reported as an error carrying the authority reason and is recorded on the row', async () => {
  const h = harness({ issue: () => { throw new Error('certbot failed: too many failed authorizations recently'); } });

  const readiness = await h.service.publish(site(), HOSTNAME);

  assert.equal(readiness.state, 'error');
  assert.match(readiness.detail, /too many failed authorizations recently/);
  assert.equal(h.hostname().certificateErrorDetail, 'certbot failed: too many failed authorizations recently');
  assert.equal(h.hostname().certificateRequestedAt, null);
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
  h.store.failGeneratedCertificate('site-1', 'certbot failed: too many failed authorizations recently');

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
  assert.notEqual(h.hostname().certificateRequestedAt, null);
  assert.match(readiness.detail, /requested/);
});

test('a recorded issuance failure outranks a pending handshake when readiness is read', async () => {
  const h = harness({ canIssue: false, probe: async () => NOT_COVERED });
  h.store.failGeneratedCertificate('site-1', 'certbot failed: DNS problem');

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

test('a hostname this process cannot derive is pending without the broker and an error with it', async () => {
  const withoutBroker = harness({ canIssue: false });
  const withBroker = harness();

  const runner = await withoutBroker.service.publish(site(), null);
  const daemon = await withBroker.service.publish(site(), null);

  assert.equal(runner.state, 'pending');
  assert.match(runner.detail, /no gateway broker/);
  // Recorded even with no hostname to probe: the daemon can derive one and is the process that will.
  assert.notEqual(withoutBroker.hostname().certificateRequestedAt, null);
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
  const recorded = recordedCertificate(site(), certificate());

  assert.equal(recorded.state, 'unrecorded');
  assert.match(recorded.detail, /no pending request and no recorded failure/);
  // And it names the ambiguity rather than hiding it: a successful issuance clears both columns, so this is
  // also what a perfectly working site looks like from the row alone.
  assert.match(recorded.detail, /completed issuance/);
  assert.doesNotMatch(recorded.detail, /\bis being served\b|\bverified\b|\bvalid until\b/);
});

test('a recorded request reports the wait, with the stamp that says how long it has been waiting', () => {
  const recorded = recordedCertificate(site(), certificate({
    certificateState: 'requested',
    certificateRequestedAt: '2026-09-12T02:40:00.000Z',
  }));

  assert.equal(recorded.state, 'requested');
  assert.match(recorded.detail, /2026-09-12T02:40:00\.000Z/);
  assert.match(recorded.detail, /next gateway sweep/);
});

test('a recorded failure reports the authority reason and outranks a stale pending request', () => {
  // The order matters: a runner records a request BEFORE the daemon has had a chance to fail it again, so a
  // row can hold both. The failure is the fact a reader has to act on.
  const failed = recordedCertificate(site(), certificate({
    certificateState: 'authority_refused',
    certificateErrorCode: 'authority_refused',
    certificateErrorDetail: 'certbot failed: too many failed authorizations recently',
  }));
  const both = recordedCertificate(site(), certificate({
    certificateState: 'authority_refused',
    certificateRequestedAt: '2026-09-12T02:40:00.000Z',
    certificateErrorCode: 'authority_refused',
    certificateErrorDetail: 'certbot failed: DNS problem',
  }));

  assert.equal(failed.state, 'error');
  assert.match(failed.detail, /too many failed authorizations recently/);
  assert.equal(both.state, 'error');
  assert.match(both.detail, /DNS problem/);
});

test('a site that is not live has no certificate line at all', () => {
  for (const status of ['draft', 'deleting']) {
    assert.equal(recordedCertificate(site({ status }), certificate({
      certificateState: 'requested',
      certificateRequestedAt: '2026-09-12T02:40:00.000Z',
    })), null, status);
  }
});

test('no row in any combination can be read as a certificate that is ready', () => {
  // The safety assertion, exhaustive over the row shape: `ready` is a word only an observed handshake earns,
  // and this reader has none. A future state added here without a probe behind it fails this.
  let judged = 0;
  for (const status of ['live', 'draft', 'deleting']) {
    for (const certificateRequestedAt of [null, '2026-09-12T02:40:00.000Z']) {
      for (const certificateError of [null, '', 'certbot failed: DNS problem']) {
        const recorded = recordedCertificate(site({ status }), certificate({
          certificateState: certificateError ? 'authority_refused' : certificateRequestedAt ? 'requested' : 'none',
          certificateRequestedAt,
          certificateErrorCode: certificateError ? 'authority_refused' : null,
          certificateErrorDetail: certificateError || null,
        }));
        if (recorded === null) continue;
        judged += 1;
        assert.ok(['error', 'requested', 'unrecorded'].includes(recorded.state),
          `${status}/${certificateRequestedAt}/${certificateError} produced ${recorded.state}`);
        assert.notEqual(recorded.state, 'ready');
      }
    }
  }
  // Counted, because a reader that regressed to answering null for everything would skip every assertion
  // above and leave this test green while saying nothing at all.
  assert.equal(judged, 6, 'every live combination must have been judged');
});

test('the recorded reading is synchronous, which is what makes it probe-free', () => {
  // A TLS handshake cannot be awaited from a synchronous function, so returning without a promise IS the
  // proof that a listing of twenty sites opens no sockets. It also takes the row and nothing else — no
  // store, no gateway, no probe — so there is nothing it could reach even if it wanted to.
  assert.equal(recordedCertificate.constructor.name, 'Function', 'an async reader could hide a probe');
  assert.equal(recordedCertificate.length, 2, 'the Site and its generated hostname record are the only inputs');
  const result = recordedCertificate(site(), certificate());
  assert.equal(typeof result.then, 'undefined');
});
