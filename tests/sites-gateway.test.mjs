import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { SiteGatewayManager } from '../plugins/sites/dist/gateway.js';

// `.invalid` is reserved by RFC 6761 and guaranteed never to resolve, so the wildcard probe inside
// `reconcile` answers "missing" from the resolver rather than from a mock — which is the state this
// feature actually ships in until an operator creates the record.
const APP_HOST = 'agent.example.invalid';
const HOSTNAME_BASE = `sites.${APP_HOST}`;
const PROBE_HOST = `elowen-probe.${HOSTNAME_BASE}`;

const dnsFailure = (code) => Object.assign(new Error(code), { code });
const missingDns = async () => { throw dnsFailure('ENODATA'); };
const makeResolver = (overrides = {}) => {
  const queries = [];
  const resolver = {};
  for (const kind of ['resolveCname', 'resolve4', 'resolve6']) {
    resolver[kind] = async (hostname) => {
      queries.push([kind, hostname]);
      return await (overrides[kind]?.(hostname) ?? missingDns());
    };
  }
  return { resolver, queries };
};

const makeHarness = ({ hostnameBase = HOSTNAME_BASE, contactEmail = 'ops@example.com', gatewayDnsTarget, dns = {} } = {}) => {
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
    config: { contactEmail, ...(gatewayDnsTarget === undefined ? {} : { gatewayDnsTarget }) },
    instanceSecrets: () => bag,
    publicWebUrl: () => `https://${APP_HOST}`,
    logger: { warn: (message) => warnings.push(message), info: () => {} },
    control: (name) => name === 'publishedSitesGateway' ? control : undefined,
  };
  const resolved = makeResolver(dns);
  return {
    manager: new SiteGatewayManager(ctx, { resolver: resolved.resolver, randomLabel: () => 'elowen-probe' }),
    control, values, warnings, calls, queries: resolved.queries,
  };
};

test('the readiness check names the exact DNS record while the wildcard is missing', async () => {
  const harness = makeHarness();
  const readiness = await harness.manager.readiness();

  // This is now the ONLY place a person is told what to create — there is no hosting screen and no
  // configuration form, because the record lives at a registrar this instance cannot write to. A
  // readiness check that only says "not configured" leaves the feature permanently unusable.
  assert.equal(readiness.ok, false);
  assert.equal(readiness.status, 'missing');
  assert.match(readiness.detail, /does not resolve/);
  assert.match(readiness.hint, /registrar/);

  // The record travels as LABELLED FIELDS, not inside the sentence: it is retyped by hand into somebody
  // else's control panel, where one wrong character fails silently — the wildcard simply does not
  // resolve, which is the same symptom as never having created it. The settings screen renders each
  // value with its own copy control, so no part of it has to be picked out of prose.
  assert.deepEqual(readiness.fix, [
    { label: 'Type', value: 'CNAME' },
    { label: 'Name', value: '*.sites.agent.example.invalid' },
    { label: 'Value', value: 'agent.example.invalid.' },
  ]);

  // Nothing was asked of the broker: without the record there is no certificate to obtain.
  assert.equal(harness.calls.sync, 0);
  assert.deepEqual(harness.calls.ensure, []);
});

test('a CNAME chain to the app hostname makes the gateway serve before any certificate', async () => {
  const harness = makeHarness({
    dns: {
      resolveCname: async (hostname) => hostname === `${PROBE_HOST}.`
        ? ['Edge.Example.Invalid.']
        : hostname === 'edge.example.invalid.' ? [`${APP_HOST}.`] : await missingDns(),
    },
  });
  const status = await harness.manager.reconcile();

  assert.equal(status.active, true);
  assert.equal(harness.calls.sync, 1, 'the challenge vhost is published first');
  assert.equal(harness.manager.isActive(), true);
  assert.equal(harness.queries.every(([, hostname]) => hostname.endsWith('.')), true, 'every DNS query must be absolute');
  const readiness = await harness.manager.readiness();
  assert.equal(readiness.ok, true);
  assert.equal(readiness.hint, undefined, 'a working gateway has nothing for an operator to do');
});

test('flattened IPv4 DNS is accepted when either answer set intersects', async () => {
  const harness = makeHarness({
    dns: {
      resolve4: async (hostname) => hostname === `${PROBE_HOST}.`
        ? ['192.0.2.40', '192.0.2.41']
        : hostname === `${APP_HOST}.` ? ['192.0.2.41', '192.0.2.42'] : await missingDns(),
    },
  });
  assert.equal((await harness.manager.reconcile()).active, true);
});

test('flattened IPv6 DNS is accepted without an IPv4 answer', async () => {
  const harness = makeHarness({
    dns: {
      resolve6: async (hostname) => hostname === `${PROBE_HOST}.`
        ? ['2001:db8::20']
        : hostname === `${APP_HOST}.` ? ['2001:DB8::20'] : await missingDns(),
    },
  });
  assert.equal((await harness.manager.reconcile()).active, true);
});

test('an explicit origin IP accepts direct Sites DNS while the main app remains proxied', async () => {
  const origin = '198.51.100.77';
  const harness = makeHarness({
    gatewayDnsTarget: origin,
    dns: {
      resolve4: async (hostname) => hostname === `${PROBE_HOST}.`
        ? [origin]
        : hostname === `${APP_HOST}.` ? ['192.0.2.10'] : await missingDns(),
    },
  });

  const readiness = await harness.manager.readiness();
  assert.equal(readiness.ok, true);
  assert.equal(harness.calls.sync, 1);
  assert.deepEqual(harness.manager.requiredRecord(), {
    type: 'A', name: `*.${HOSTNAME_BASE}`, value: origin,
  });
});

test('an explicit origin hostname accepts a CNAME without consulting the proxied app destination', async () => {
  const target = 'origin.example.invalid';
  const harness = makeHarness({
    gatewayDnsTarget: target,
    dns: {
      resolveCname: async (hostname) => hostname === `${PROBE_HOST}.` ? [`${target}.`] : await missingDns(),
    },
  });

  assert.equal((await harness.manager.reconcile()).active, true);
  assert.deepEqual(harness.manager.requiredRecord(), {
    type: 'CNAME', name: `*.${HOSTNAME_BASE}`, value: `${target}.`,
  });
  assert.equal(harness.queries.some(([, hostname]) => hostname === `${APP_HOST}.`), false);
});

test('an explicit IPv6 origin produces and validates an AAAA record', async () => {
  const target = '2001:4860:4860::8844';
  const harness = makeHarness({
    gatewayDnsTarget: target,
    dns: { resolve6: async (hostname) => hostname === `${PROBE_HOST}.` ? [target.toUpperCase()] : await missingDns() },
  });

  assert.equal((await harness.manager.reconcile()).active, true);
  assert.deepEqual(harness.manager.requiredRecord(), {
    type: 'AAAA', name: `*.${HOSTNAME_BASE}`, value: target,
  });
});

test('an explicit DNS destination still refuses a different resolved target', async () => {
  const harness = makeHarness({
    gatewayDnsTarget: 'origin.example.invalid',
    dns: {
      resolveCname: async (hostname) => hostname === `${PROBE_HOST}.`
        ? ['wrong.example.invalid.']
        : await missingDns(),
      resolve4: async (hostname) => hostname === `${PROBE_HOST}.`
        ? ['203.0.113.10']
        : hostname === 'origin.example.invalid.' ? ['192.0.2.10'] : await missingDns(),
    },
  });

  const readiness = await harness.manager.readiness();
  assert.equal(readiness.status, 'misdirected');
  assert.match(readiness.detail, /origin\.example\.invalid/);
  assert.equal(harness.calls.sync, 0);
  assert.deepEqual(readiness.fix, [
    { label: 'Type', value: 'CNAME' },
    { label: 'Name', value: `*.${HOSTNAME_BASE}` },
    { label: 'Value', value: 'origin.example.invalid.' },
  ]);
});

test('an invalid configured DNS destination blocks readiness instead of falling back', async () => {
  const harness = makeHarness({ gatewayDnsTarget: 'https://origin.example.invalid/path' });
  const readiness = await harness.manager.readiness();

  assert.equal(readiness.ok, false);
  assert.equal(readiness.status, 'unavailable');
  assert.match(readiness.detail, /DNS destination/i);
  assert.equal(readiness.fix, undefined);
  assert.equal(harness.calls.sync, 0);
});

test('a wildcard resolving to another destination is reported as misdirected', async () => {
  const harness = makeHarness({
    dns: {
      resolve4: async (hostname) => hostname === `${PROBE_HOST}.`
        ? ['203.0.113.10']
        : hostname === `${APP_HOST}.` ? ['192.0.2.10'] : await missingDns(),
    },
  });
  const readiness = await harness.manager.readiness();
  assert.equal(readiness.ok, false);
  assert.equal(readiness.status, 'misdirected');
  assert.match(readiness.detail, /resolves, but not to/);
  assert.deepEqual(readiness.observedTargets, ['203.0.113.10']);
  assert.deepEqual(readiness.fix, [
    { label: 'Type', value: 'CNAME' },
    { label: 'Name', value: '*.sites.agent.example.invalid' },
    { label: 'Value', value: 'agent.example.invalid.' },
  ]);
  assert.equal(harness.calls.sync, 0);
});

test('a transient CNAME lookup failure is unavailable rather than a proven wrong target', async () => {
  const harness = makeHarness({
    dns: {
      resolveCname: async () => { throw dnsFailure('SERVFAIL'); },
      resolve4: async (hostname) => hostname === `${PROBE_HOST}.`
        ? ['203.0.113.10']
        : hostname === `${APP_HOST}.` ? ['192.0.2.10'] : await missingDns(),
    },
  });
  const readiness = await harness.manager.readiness();
  assert.equal(readiness.status, 'unavailable');
  assert.match(readiness.detail, /could not complete/i);
  assert.equal(harness.calls.sync, 0);
});

test('changing load-balanced answers are compared as unordered sampled sets', async () => {
  const counts = new Map();
  const next = (hostname, answers) => {
    const count = counts.get(hostname) ?? 0;
    counts.set(hostname, count + 1);
    return answers[count % answers.length];
  };
  const harness = makeHarness({
    dns: {
      resolve4: async (hostname) => hostname === `${PROBE_HOST}.`
        ? next(hostname, [['192.0.2.11'], ['192.0.2.12', '192.0.2.10']])
        : hostname === `${APP_HOST}.`
          ? next(hostname, [['192.0.2.10', '192.0.2.13'], ['192.0.2.14']])
          : await missingDns(),
    },
  });
  assert.equal((await harness.manager.reconcile()).active, true);
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
  const harness = makeHarness({ dns: { resolveCname: async () => [`${APP_HOST}.`] } });
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

test('the certificate sweep consults the backoff, skips drafts, and runs often enough to matter', () => {
  // SOURCE CHECK, because all three failures are invisible at runtime until it is far too late: the
  // rate-limit budget is already spent, a draft slug is already in a public Certificate Transparency
  // log, or a freshly published page has already been unreachable for hours.
  const source = readFileSync(new URL('../plugins/sites/dist/index.js', import.meta.url), 'utf8');
  // Scoped to the sweep's OWN body: both guards appear elsewhere in this file, so matching the whole
  // module would keep passing after either one is deleted from the loop that has to enforce it.
  const start = source.indexOf('const syncGateway =');
  const end = source.indexOf('if (isDaemonProcess())', start);
  assert.ok(start > -1 && end > start, 'syncGateway must still be recognisable in the build');
  const sweep = source.slice(start, end);

  // `mayAttempt` existed and the backoff map was maintained correctly — and NOTHING called it, so every
  // plugin reload re-attempted each failing site against the authority's per-hostname failure budget.
  assert.match(sweep, /mayAttempt\(/, 'syncGateway must skip slugs that are still backed off');

  // A draft has no release to serve, so issuing for it only publishes its slug before anybody chose to.
  assert.match(sweep, /status !== 'live'/, 'only a live site earns a certificate');

  // A publish arrives from a forked runner that never reconciles. Without a sweep between the 12-hour
  // renewals, the site is live in the store while nginx has no server block for it.
  assert.match(source, /issue-site-certificates/, 'new sites must converge sooner than the renewal sweep');

  // The certificate sweep gives up immediately on an inactive gateway, so it can never be what brings
  // one back. Recovery therefore needs its own interval: the operator adds the DNS record the readiness
  // check asked for, and without this nothing notices until the twelve-hour renewal — a wildcard that
  // started resolving at 09:00 leaves every site dark until 21:00, with no signal it was accepted.
  const registration = source.indexOf("registerInterval('recover-site-gateway'");
  assert.ok(registration > -1, 'a gateway that is down must retry sooner than the renewal sweep');
  assert.match(source.slice(registration, registration + 300), /isActive\(\)/,
    'recovery must skip the probe while the gateway is up');
});

test('the site address comes from the broker, so a forked tool runner reports the same one', () => {
  const harness = makeHarness();
  // `hostnameBase` deliberately does NOT read reconcile state: a tool call runs in a runner that never
  // reconciles, and a site's address must be the same fact there as in the daemon.
  assert.equal(harness.manager.hostnameBase(), HOSTNAME_BASE);
  assert.equal(harness.manager.isActive(), false, 'having an address is not the same as it working');

  assert.equal(makeHarness({ hostnameBase: null }).manager.requiredRecord(), null);
});
