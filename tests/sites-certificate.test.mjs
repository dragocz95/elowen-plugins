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

const harness = ({ canIssue = true, issue, probe } = {}) => {
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
  const h = harness({ probe: async () => NOT_COVERED });

  const readiness = await h.service.publish(site(), HOSTNAME);

  assert.equal(readiness.state, 'error');
  assert.match(readiness.detail, /reported the certificate .* as issued but/);
  assert.match(readiness.detail, new RegExp(OTHER_HOSTNAME));
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

test('an explicit request is attempted even while the slug is backed off, and a draft still is not', () => {
  const sites = [
    { slug: 'backed-off', status: 'live', certificateRequestedAt: null },
    { slug: 'backed-off-but-requested', status: 'live', certificateRequestedAt: '2026-09-12T02:40:00.000Z' },
    { slug: 'requested-draft', status: 'draft', certificateRequestedAt: '2026-09-12T02:40:00.000Z' },
  ];

  const due = sitesDueForCertificate(sites, { all: false, issued: new Set(), mayAttempt: () => false });

  assert.deepEqual(due.map((entry) => entry.slug), ['backed-off-but-requested']);
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
