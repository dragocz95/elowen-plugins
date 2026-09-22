import assert from 'node:assert/strict';
import test from 'node:test';

import { GatewayDnsTargetService, ownershipTxtRecord, verifyOwnershipTxt } from '../plugins/sites/dist/dns.js';
import { parseSiteHostname } from '../plugins/sites/dist/hostname.js';

const dnsError = (code) => Object.assign(new Error(code), { code });
const key = (hostname) => hostname.replace(/\.$/, '').toLowerCase();

const resolver = (records = {}, failures = {}) => ({
  async resolveCname(hostname) {
    const name = key(hostname);
    if (failures.cname) throw dnsError(failures.cname);
    if (!(name in (records.cname ?? {}))) throw dnsError('ENODATA');
    return records.cname[name];
  },
  async resolve4(hostname) {
    const name = key(hostname);
    if (failures.a) throw dnsError(failures.a);
    if (!(name in (records.a ?? {}))) throw dnsError('ENODATA');
    return records.a[name];
  },
  async resolve6(hostname) {
    const name = key(hostname);
    if (failures.aaaa) throw dnsError(failures.aaaa);
    if (!(name in (records.aaaa ?? {}))) throw dnsError('ENODATA');
    return records.aaaa[name];
  },
  async resolveTxt(hostname) {
    const name = key(hostname);
    if (failures.txt) throw dnsError(failures.txt);
    if (!(name in (records.txt ?? {}))) throw dnsError('ENODATA');
    return records.txt[name];
  },
});

test('TXT ownership verification joins chunks and keeps missing distinct from resolver failure', async () => {
  const token = 'token-123';
  const proof = ownershipTxtRecord('shop.example.com', token);
  assert.deepEqual(proof, {
    name: '_elowen-site.shop.example.com',
    type: 'TXT',
    value: 'elowen-site-verification=token-123',
  });

  assert.equal((await verifyOwnershipTxt('shop.example.com', token, resolver({
    txt: { '_elowen-site.shop.example.com': [['elowen-site-', 'verification=token-123']] },
  }))).state, 'ready');
  assert.equal((await verifyOwnershipTxt('shop.example.com', token, resolver({
    txt: { '_elowen-site.shop.example.com': [['wrong']] },
  }))).state, 'mismatch');
  const ninthProof = await verifyOwnershipTxt('shop.example.com', token, resolver({
    txt: {
      '_elowen-site.shop.example.com': [
        ...Array.from({ length: 8 }, (_, index) => ['wrong-' + index]),
        ['elowen-site-verification=token-123'],
      ],
    },
  }));
  assert.equal(ninthProof.state, 'ready');
  assert.equal(ninthProof.observedValues.length, 8, 'returned observations stay bounded');
  assert.equal((await verifyOwnershipTxt('shop.example.com', token, resolver())).state, 'missing');
  assert.equal((await verifyOwnershipTxt('shop.example.com', token, resolver({}, { txt: 'ETIMEOUT' }))).state, 'unavailable');
});

test('record plans cover hostname, IPv4, IPv6 and root ALIAS/ANAME fallback', async () => {
  const hostResolver = resolver({
    a: { 'gateway.example.net': ['192.0.2.10'] },
    aaaa: { 'gateway.example.net': ['2001:db8::10'] },
  });
  const hostService = new GatewayDnsTargetService({
    configured: () => 'gateway.example.net',
    fallbackHostname: () => null,
    resolver: hostResolver,
  });
  const target = hostService.current().target;
  assert.ok(target);
  assert.equal(target, hostService.current().target, 'rendering and verification share one parsed destination object');

  assert.deepEqual(await target.recordPlan(parseSiteHostname('www.example.com')), {
    state: 'ready',
    hostname: 'www.example.com',
    kind: 'subdomain',
    delegatedRootWarning: true,
    preferred: [{ name: 'www.example.com', type: 'CNAME', value: 'gateway.example.net.' }],
    fallback: [],
  });
  assert.deepEqual(await target.recordPlan(parseSiteHostname('example.com')), {
    state: 'ready',
    hostname: 'example.com',
    kind: 'root',
    delegatedRootWarning: false,
    preferred: [{ name: 'example.com', type: 'ALIAS/ANAME', value: 'gateway.example.net.' }],
    fallback: [
      { name: 'example.com', type: 'A', value: '192.0.2.10' },
      { name: 'example.com', type: 'AAAA', value: '2001:db8::10' },
    ],
  });

  const ipv4 = new GatewayDnsTargetService({
    configured: () => '192.0.2.20',
    fallbackHostname: () => null,
    resolver: resolver(),
  }).current().target;
  assert.deepEqual((await ipv4.recordPlan(parseSiteHostname('www.example.com'))).preferred,
    [{ name: 'www.example.com', type: 'A', value: '192.0.2.20' }]);

  const ipv6 = new GatewayDnsTargetService({
    configured: () => '2001:0db8:0:0:0:0:0:20',
    fallbackHostname: () => null,
    resolver: resolver(),
  }).current().target;
  assert.deepEqual((await ipv6.recordPlan(parseSiteHostname('example.com'))).preferred,
    [{ name: 'example.com', type: 'AAAA', value: '2001:db8::20' }]);
});

test('a correct A together with a wrong AAAA is misdirected, never ready', async () => {
  const target = new GatewayDnsTargetService({
    configured: () => 'gateway.example.net',
    fallbackHostname: () => null,
    resolver: resolver({
      a: {
        'gateway.example.net': ['192.0.2.10'],
        'shop.example.com': ['192.0.2.10'],
      },
      aaaa: {
        'gateway.example.net': ['2001:db8::10'],
        'shop.example.com': ['2001:db8::99'],
      },
    }),
  }).current().target;

  assert.deepEqual(await target.verifyHostname('shop.example.com'), {
    state: 'misdirected',
    observedTargets: ['192.0.2.10', '2001:db8::99'],
  });
});

test('an exact CNAME is unavailable when its configured destination has no address', async () => {
  const target = new GatewayDnsTargetService({
    configured: () => 'gateway.example.net',
    fallbackHostname: () => null,
    resolver: resolver({
      cname: { 'shop.example.com': ['gateway.example.net.'] },
    }),
  }).current().target;

  const observation = await target.verifyHostname('shop.example.com');
  assert.equal(observation.state, 'unavailable');
  assert.match(observation.detail, /no A or AAAA answer/);
});


test('traffic DNS keeps a missing answer distinct from resolver unavailability', async () => {
  const missing = new GatewayDnsTargetService({
    configured: () => '192.0.2.10',
    fallbackHostname: () => null,
    resolver: resolver(),
  }).current().target;
  assert.equal((await missing.verifyHostname('shop.example.com')).state, 'missing');

  const unavailable = new GatewayDnsTargetService({
    configured: () => '192.0.2.10',
    fallbackHostname: () => null,
    resolver: resolver({}, { cname: 'ETIMEOUT', a: 'ETIMEOUT', aaaa: 'ETIMEOUT' }),
  }).current().target;
  assert.equal((await unavailable.verifyHostname('shop.example.com')).state, 'unavailable');
});
