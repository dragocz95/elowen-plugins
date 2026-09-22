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

const makeHarness = ({ hostnameBase = HOSTNAME_BASE, contactEmail = 'ops@example.com', gatewayDnsTarget, dns = {}, publicWebUrl = `https://${APP_HOST}`, gatewayAvailable = true } = {}) => {
  const values = new Map();
  const warnings = [];
  const calls = { status: 0, sync: 0, ensure: [], remove: [], order: [] };
  const bag = {
    get: (key) => values.has(key) ? { value: values.get(key), version: 1 } : null,
    has: (key) => values.has(key),
    set: (key, value) => { values.set(key, value); return 1; },
    delete: (key) => values.delete(key),
  };
  const control = {
    hostnameBase: () => hostnameBase,
    reservedHostnames: () => [APP_HOST, HOSTNAME_BASE],
    syncBindings: async (input) => {
      calls.sync += 1;
      calls.order.push('sync');
      calls.lastSnapshot = input.bindings;
      return { available: true, active: true, hostnameBase, bindings: [] };
    },
    ensureBinding: async (input) => {
      calls.ensure.push(input);
      calls.order.push('ensure');
      return {
        available: true,
        active: true,
        hostnameBase,
        bindings: [{ hostname: input.binding.hostname, present: true }],
      };
    },
    removeBinding: async (input) => {
      calls.remove.push(input);
      calls.order.push('remove');
      return { available: true, active: true, hostnameBase, bindings: [] };
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
    publicWebUrl: () => publicWebUrl,
    logger: { warn: (message) => warnings.push(message), info: () => {} },
    control: (name) => gatewayAvailable && name === 'publishedSitesGateway' ? control : undefined,
  };
  const resolved = makeResolver(dns);
  return {
    manager: new SiteGatewayManager(ctx, { resolver: resolved.resolver, randomLabel: () => 'elowen-probe' }),
    control, values, warnings, calls, queries: resolved.queries,
  };
};

test('the readiness check names the exact DNS record while the wildcard is missing', async () => {
  const harness = makeHarness({
    dns: {
      resolve4: async (hostname) => hostname === `${APP_HOST}.` ? ['192.0.2.10'] : await missingDns(),
    },
  });
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
      resolve4: async (hostname) => hostname === `${APP_HOST}.` ? ['192.0.2.10'] : await missingDns(),
    },
  });
  const status = await harness.manager.reconcile([]);

  assert.equal(status.active, true);
  assert.equal(harness.calls.sync, 1, 'the challenge vhost is published first');
  assert.equal(harness.manager.isActive(), true);
  assert.equal(harness.queries.every(([, hostname]) => hostname.endsWith('.')), true, 'every DNS query must be absolute');
  const readiness = await harness.manager.readiness();
  assert.equal(readiness.ok, true);
  assert.equal(readiness.hint, undefined, 'a working gateway has nothing for an operator to do');
});

test('flattened IPv4 DNS rejects every extra address outside the destination set', async () => {
  const harness = makeHarness({
    dns: {
      resolve4: async (hostname) => hostname === `${PROBE_HOST}.`
        ? ['192.0.2.40', '192.0.2.41']
        : hostname === `${APP_HOST}.` ? ['192.0.2.41', '192.0.2.42'] : await missingDns(),
    },
  });
  assert.equal((await harness.manager.reconcile([])).active, false);
  assert.equal((await harness.manager.readiness()).status, 'misdirected');
});

test('flattened IPv6 DNS is accepted without an IPv4 answer', async () => {
  const harness = makeHarness({
    dns: {
      resolve6: async (hostname) => hostname === `${PROBE_HOST}.`
        ? ['2001:db8::20']
        : hostname === `${APP_HOST}.` ? ['2001:DB8::20'] : await missingDns(),
    },
  });
  assert.equal((await harness.manager.reconcile([])).active, true);
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

  await harness.manager.reconcile([]);
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
      resolve4: async (hostname) => hostname === `${target}.` ? ['192.0.2.20'] : await missingDns(),
    },
  });

  assert.equal((await harness.manager.reconcile([])).active, true);
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

  assert.equal((await harness.manager.reconcile([])).active, true);
  assert.deepEqual(harness.manager.requiredRecord(), {
    type: 'AAAA', name: `*.${HOSTNAME_BASE}`, value: target,
  });
});

test('an expanded IPv6 destination matches the compressed form a resolver returns', async () => {
  // A resolver answers in the compressed form and an operator types the expanded one (or the reverse).
  // Comparing the two as lowercased strings makes a correct record look misdirected forever, so both
  // sides go through one address parser before they are compared.
  const harness = makeHarness({
    gatewayDnsTarget: '2001:0DB8:0000:0000:0000:0000:0000:0020',
    dns: { resolve6: async (hostname) => hostname === `${PROBE_HOST}.` ? ['2001:db8::20'] : await missingDns() },
  });

  assert.equal((await harness.manager.reconcile([])).active, true);
  assert.deepEqual(harness.manager.requiredRecord(), {
    type: 'AAAA', name: `*.${HOSTNAME_BASE}`, value: '2001:db8::20',
  });
});

test('a destination carrying a prefix, a path or a trailing-dot address is read exactly', async () => {
  // `domainToASCII` quietly drops a CIDR suffix and a trailing dot, so `188.130.140.170/32` came back as
  // a hostname and produced a CNAME to an address, which no registrar can accept.
  for (const rejected of ['188.130.140.170/32', 'https://origin.example.invalid/path', '999.1.1.1', '2001:db8::1%eth0']) {
    const harness = makeHarness({ gatewayDnsTarget: rejected });
    const readiness = await harness.manager.readiness();
    assert.equal(readiness.status, 'unavailable', rejected);
    assert.match(readiness.detail, /DNS destination/i, rejected);
    assert.equal(readiness.fix, undefined, rejected);
    assert.equal(harness.calls.sync, 0, rejected);
  }

  // A trailing dot is how a registrar writes a fully qualified value, so the address behind it is read as
  // the address it is, not as a hostname whose last label happens to be a number.
  const dotted = makeHarness({ gatewayDnsTarget: '188.130.140.170.' });
  assert.deepEqual(dotted.manager.requiredRecord(), {
    type: 'A', name: `*.${HOSTNAME_BASE}`, value: '188.130.140.170',
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
        ? ['192.0.2.10']
        : hostname === `${APP_HOST}.` ? ['192.0.2.10'] : await missingDns(),
    },
  });
  const readiness = await harness.manager.readiness();
  assert.equal(readiness.status, 'unavailable');
  assert.match(readiness.detail, /could not complete/i);
  assert.equal(harness.calls.sync, 0);
});

test('sampling load-balanced answers rejects any destination outside the allowed set', async () => {
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
  assert.equal((await harness.manager.reconcile([])).active, false);
  assert.equal((await harness.manager.readiness()).status, 'misdirected');
});

test('concurrent reconciles join one broker call', async () => {
  const harness = makeHarness({ dns: {
    resolveCname: async () => [`${APP_HOST}.`],
    resolve4: async (hostname) => hostname === `${APP_HOST}.` ? ['192.0.2.10'] : await missingDns(),
  } });
  const first = harness.manager.reconcile([]);
  const second = harness.manager.reconcile([]);
  assert.equal(first, second, 'the second caller joins the in-flight sweep');
  await Promise.all([first, second]);
  assert.equal(harness.calls.sync, 1);
});

test('complete binding snapshots sync before one binding is ensured', async () => {
  const harness = makeHarness({ dns: {
    resolveCname: async () => [`${APP_HOST}.`],
    resolve4: async (hostname) => hostname === `${APP_HOST}.` ? ['192.0.2.10'] : await missingDns(),
  } });
  const generated = { hostname: `demo-abc123.${HOSTNAME_BASE}`, slug: 'demo-abc123', class: 'generated' };
  const custom = { hostname: 'www.customer.example', slug: 'demo-abc123', class: 'custom' };
  const snapshot = [generated, custom];

  harness.calls.order.length = 0;
  await harness.manager.reconcile(snapshot);
  await harness.manager.ensureBinding(custom, snapshot);

  assert.deepEqual(harness.calls.order, ['sync', 'ensure']);
  assert.deepEqual(harness.calls.lastSnapshot, snapshot);
  assert.deepEqual(harness.calls.ensure[0].bindings, snapshot);
  assert.deepEqual(harness.calls.ensure[0].binding, custom);
});

test('one failed custom certificate does not mark the synchronized gateway unavailable', async () => {
  const harness = makeHarness({ dns: {
    resolveCname: async () => [`${APP_HOST}.`],
    resolve4: async (hostname) => hostname === `${APP_HOST}.` ? ['192.0.2.10'] : await missingDns(),
  } });
  const binding = { hostname: 'broken.customer.example', slug: 'broken-abc123', class: 'custom' };
  await harness.manager.reconcile([binding]);
  harness.control.ensureBinding = async () => { throw new Error('validation failed'); };

  await assert.rejects(harness.manager.ensureBinding(binding, [binding]), /validation failed/);
  assert.equal(harness.manager.isActive(), true);
});

test('a broker refusal is a failed binding issuance', async () => {
  const harness = makeHarness();
  const binding = { hostname: `demo-abc123.${HOSTNAME_BASE}`, slug: 'demo-abc123', class: 'generated' };
  harness.control.ensureBinding = async () => ({
    available: true, active: false, hostnameBase: HOSTNAME_BASE, detail: 'certbot timed out',
  });
  await assert.rejects(harness.manager.ensureBinding(binding, [binding]), /certbot timed out/);
});

test('binding removal propagates broker failure for durable cleanup', async () => {
  const harness = makeHarness();
  harness.control.removeBinding = async () => { throw new Error('certbot is holding the lineage'); };
  await assert.rejects(
    harness.manager.removeBinding('www.customer.example', 'demo-abc123', []),
    /certbot is holding the lineage/,
  );
});

test('binding removal refuses to complete without the gateway control', async () => {
  const harness = makeHarness({ gatewayAvailable: false });
  await assert.rejects(
    harness.manager.removeBinding('www.customer.example', 'demo-abc123', []),
    /No published-sites gateway broker/,
  );
});

test('issuance refuses to start without the certificate contact address', async () => {
  const harness = makeHarness({ contactEmail: '   ' });
  const binding = { hostname: `demo-abc123.${HOSTNAME_BASE}`, slug: 'demo-abc123', class: 'generated' };
  await assert.rejects(harness.manager.ensureBinding(binding, [binding]), /contact email/i);
  assert.deepEqual(harness.calls.ensure, []);
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

test('daemon sweeps use durable hostname coordination on both issue and renewal cadences', () => {
  const source = readFileSync(new URL('../plugins/sites/dist/index.js', import.meta.url), 'utf8');
  const coordinator = readFileSync(new URL('../plugins/sites/dist/hostnameCoordinator.js', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../plugins/sites/dist/store.js', import.meta.url), 'utf8');

  assert.match(source, /issue-site-certificates/);
  assert.match(source, /renew-site-gateway/);
  assert.match(source, /hostnameCoordinator\.sweep/);
  assert.match(coordinator, /certificateRetryAt/);
  assert.match(coordinator, /dnsAttempts/);
  assert.match(store, /dns_attempts INTEGER NOT NULL DEFAULT 0/);
  assert.match(store, /certificate_failures INTEGER NOT NULL DEFAULT 0/);

  const registration = source.indexOf("registerInterval('recover-site-gateway'");
  assert.ok(registration > -1);
  assert.match(source.slice(registration, registration + 300), /isActive\(\)/);
});

test('the site address comes from the broker, so a forked tool runner reports the same one', () => {
  const harness = makeHarness();
  // `hostnameBase` deliberately does NOT read reconcile state: a tool call runs in a runner that never
  // reconciles, and a site's address must be the same fact there as in the daemon.
  assert.equal(harness.manager.hostnameBase(), HOSTNAME_BASE);
  assert.equal(harness.manager.isActive(), false, 'having an address is not the same as it working');

  // The record names the base sites are ACTUALLY addressed at, which is why this harness — a broker
  // answering null beside an HTTPS app — now produces a record rather than nothing. It used to assert
  // `null` here, and that reading was only ever true because the hostname had a single source; it is
  // rewritten rather than dropped because the invariant it was protecting still has to hold, and it holds
  // at the other end: a record is named where a base exists and nowhere else.
  const brokerless = makeHarness({ hostnameBase: null });
  assert.equal(brokerless.manager.hostnameBase(), HOSTNAME_BASE,
    'the app URL derives the same base core would, so no process is left addressless');
  assert.deepEqual(brokerless.manager.requiredRecord(), {
    type: 'CNAME', name: `*.${HOSTNAME_BASE}`, value: `${APP_HOST}.`,
  }, 'the record an operator is told to create must name the base the sites use');
});

test('no hostname from any source means no DNS record to instruct, and no invented one', () => {
  // The invariant the rewritten assertion above used to carry: nothing derivable anywhere is still nothing.
  for (const publicWebUrl of [null, 'http://agent.example.invalid', 'https://localhost']) {
    const harness = makeHarness({ hostnameBase: null, publicWebUrl });
    assert.equal(harness.manager.hostnameBase(), null, String(publicWebUrl));
    assert.equal(harness.manager.requiredRecord(), null, String(publicWebUrl));
  }
});
