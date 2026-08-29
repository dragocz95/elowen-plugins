import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { SiteGatewayManager } from '../plugins/sites/dist/gateway.js';

// `.invalid` is reserved by RFC 6761 and guaranteed never to resolve, so the wildcard probe inside
// `reconcile` answers "missing" from the resolver rather than from a mock — which is the state this
// feature actually ships in until an operator creates the record.
const APP_HOST = 'agent.example.invalid';
const HOSTNAME_BASE = `sites.${APP_HOST}`;

const makeHarness = ({ hostnameBase = HOSTNAME_BASE, contactEmail = 'ops@example.com' } = {}) => {
  const values = new Map();
  const warnings = [];
  const calls = { status: 0, sync: 0, ensure: [], remove: [] };
  const bag = {
    get: (key) => values.has(key) ? { value: values.get(key), version: 1 } : null,
    has: (key) => values.has(key),
    set: (key, value) => { values.set(key, value); return 1; },
    delete: (key) => values.delete(key),
  };
  const control = {
    hostnameBase: () => hostnameBase,
    syncSites: async () => {
      calls.sync += 1;
      return { available: true, active: true, hostnameBase, slugs: [] };
    },
    ensureSite: async (input) => {
      calls.ensure.push(input);
      return { available: true, active: true, hostnameBase, slugs: [input.slug] };
    },
    removeSite: async (input) => {
      calls.remove.push(input);
      return { available: true, active: true, hostnameBase, slugs: [] };
    },
    deny: async () => ({ available: true, active: false, hostnameBase }),
    status: async () => {
      calls.status += 1;
      return { available: false, active: false, hostnameBase: null, detail: 'no gateway on this daemon' };
    },
  };
  const ctx = {
    config: { contactEmail },
    instanceSecrets: () => bag,
    publicWebUrl: () => `https://${APP_HOST}`,
    logger: { warn: (message) => warnings.push(message), info: () => {} },
    control: (name) => name === 'publishedSitesGateway' ? control : undefined,
  };
  return { manager: new SiteGatewayManager(ctx), control, values, warnings, calls };
};

test('the readiness check names the exact DNS record while the wildcard is missing', async () => {
  const harness = makeHarness();
  const readiness = await harness.manager.readiness();

  // This is now the ONLY place a person is told what to create — there is no hosting screen and no
  // configuration form, because the record lives at a registrar this instance cannot write to. A
  // readiness check that only says "not configured" leaves the feature permanently unusable.
  assert.equal(readiness.ok, false);
  assert.match(readiness.detail, /does not resolve/);
  assert.match(readiness.hint, /\*\.sites\.agent\.example\.invalid/);
  assert.match(readiness.hint, /CNAME/);
  assert.match(readiness.hint, /agent\.example\.invalid\./);

  // Nothing was asked of the broker: without the record there is no certificate to obtain.
  assert.equal(harness.calls.sync, 0);
  assert.deepEqual(harness.calls.ensure, []);
});

test('a resolvable wildcard is what makes the gateway serve, and it publishes before any certificate', async () => {
  const harness = makeHarness();
  // Stand in for a resolving wildcard: the probe is the only thing between "record exists" and
  // "publish the vhost", and HTTP-01 is answered by a port-80 block that must already be serving.
  harness.manager.wildcardResolves = async () => true;
  const status = await harness.manager.reconcile();

  assert.equal(status.active, true);
  assert.equal(harness.calls.sync, 1, 'the challenge vhost is published first');
  assert.equal(harness.manager.isActive(), true);
  const readiness = await harness.manager.readiness();
  assert.equal(readiness.ok, true);
  assert.equal(readiness.hint, undefined, 'a working gateway has nothing for an operator to do');
});

test('concurrent reconciles join one broker call', async () => {
  const harness = makeHarness({ hostnameBase: null });
  const first = harness.manager.reconcile();
  const second = harness.manager.reconcile();
  assert.equal(first, second, 'the second caller joins the in-flight sweep');
  await Promise.all([first, second]);
  assert.equal(harness.calls.status, 1);
});

test('a failed certificate backs off per slug, so one broken site cannot spend the others rate limit', async () => {
  const harness = makeHarness();
  harness.control.ensureSite = async () => { throw new Error('validation failed'); };

  assert.equal(harness.manager.mayAttempt('broken-abc123'), true, 'the first attempt is always allowed');
  await assert.rejects(harness.manager.ensureSite('broken-abc123'), /validation failed/);

  // The failure is what stops the retry loop, and it stops it for THIS site only.
  assert.equal(harness.manager.mayAttempt('broken-abc123'), false);
  assert.equal(harness.manager.mayAttempt('healthy-def456'), true);
});

test('a site that succeeds clears its own backoff, and one bad slug never marks the gateway down', async () => {
  const harness = makeHarness();
  harness.manager.wildcardResolves = async () => true;
  await harness.manager.reconcile();
  assert.equal(harness.manager.isActive(), true);

  harness.control.ensureSite = async () => { throw new Error('validation failed'); };
  await assert.rejects(harness.manager.ensureSite('broken-abc123'));
  // One site failing is not the gateway failing: every other site must stay addressable.
  assert.equal(harness.manager.isActive(), true);

  harness.control.ensureSite = async (input) => ({ available: true, active: true, hostnameBase: HOSTNAME_BASE, slugs: [input.slug] });
  await harness.manager.ensureSite('broken-abc123');
  assert.equal(harness.manager.mayAttempt('broken-abc123'), true, 'success releases the slug immediately');
  assert.deepEqual([...harness.manager.issuedSlugs()], ['broken-abc123']);
});

test('a broker that refuses the site is a failed publish, not a published site with a caveat', async () => {
  const harness = makeHarness();
  harness.control.ensureSite = async () => ({ available: true, active: false, hostnameBase: HOSTNAME_BASE, detail: 'certbot timed out' });
  await assert.rejects(harness.manager.ensureSite('demo-abc123'), /certbot timed out/);
});

test('removing a site never throws, because the site is already gone', async () => {
  const harness = makeHarness();
  harness.control.removeSite = async () => { throw new Error('certbot is holding the lineage'); };
  await harness.manager.removeSite('demo-abc123');
  assert.equal(harness.warnings.length, 1, 'the stuck certificate is reported, not raised');
  assert.match(harness.warnings[0], /demo-abc123/);
});

test('issuance refuses to start without the contact address a certificate authority requires', async () => {
  const harness = makeHarness({ contactEmail: '   ' });
  await assert.rejects(harness.manager.ensureSite('demo-abc123'), /contact email/i);
  assert.deepEqual(harness.calls.ensure, [], 'nothing reached the broker');
});

test('the gateway token is minted once, reused, and shaped like the marker nginx sets', () => {
  const harness = makeHarness();
  const first = harness.manager.gatewayToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(harness.manager.gatewayToken(), first, 'a second read does not rotate the marker');

  // A fresh manager over the same secret bag is a plugin reload: rotating here would lock out every
  // site already being served, because nginx sends the token this value has to match.
  const reloaded = makeHarness();
  reloaded.values.set('gatewayToken', first);
  assert.equal(reloaded.manager.gatewayToken(), first);
});

test('the certificate sweep actually consults the backoff it maintains', () => {
  // SOURCE CHECK, because the bug this pins was invisible at runtime: `mayAttempt` existed, the backoff
  // map was maintained correctly, and NOTHING called it — so every plugin reload re-attempted each
  // failing site and spent the certificate authority's per-hostname failure budget. A behavioural test
  // cannot see the difference until the budget is already gone, which is far too late.
  const sweep = readFileSync(new URL('../plugins/sites/dist/index.js', import.meta.url), 'utf8');
  assert.match(sweep, /mayAttempt\(/, 'syncGateway must skip slugs that are still backed off');
});

test('the site address comes from the broker, so a forked tool runner reports the same one', () => {
  const harness = makeHarness();
  // `hostnameBase` deliberately does NOT read reconcile state: a tool call runs in a runner that never
  // reconciles, and a site's address must be the same fact there as in the daemon.
  assert.equal(harness.manager.hostnameBase(), HOSTNAME_BASE);
  assert.equal(harness.manager.isActive(), false, 'having an address is not the same as it working');

  assert.equal(makeHarness({ hostnameBase: null }).manager.requiredRecord(), null);
});
