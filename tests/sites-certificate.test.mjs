import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { SitesStore } from '../plugins/sites/dist/store.js';
import { SiteCertificateService, evaluatePeerCertificate, sitesDueForCertificate } from '../plugins/sites/dist/certificate.js';

const HOSTNAME = 'demo-abc123.sites.elowen.example';
const OTHER_HOSTNAME = 'someone-else.sites.elowen.example';

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

test('issuance that reports success while the gateway serves another certificate is an error, never ready', async () => {
  const h = harness({ probe: async () => NOT_COVERED, issuedSlugs: ['demo-abc123'] });

  const readiness = await h.service.publish(site(), HOSTNAME);

  assert.equal(readiness.state, 'error');
  assert.match(readiness.detail, new RegExp(OTHER_HOSTNAME));
});

test('a certificate that exists but is not being served never degrades into a pending wait', async () => {
  // The state after issuance succeeded and the gateway config did not follow. Reporting it as pending would
  // promise a sweep that has already run, so a reader would wait for something nobody is going to do.
  const h = harness({ probe: async () => NOT_COVERED, issuedSlugs: ['demo-abc123'] });

  const afterPublish = await h.service.publish(site(), HOSTNAME);
  const afterRead = await h.service.readiness(site(), HOSTNAME);

  assert.equal(afterPublish.state, 'error');
  assert.equal(afterRead.state, 'error');
  assert.match(afterRead.detail, /holds a certificate/);
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
