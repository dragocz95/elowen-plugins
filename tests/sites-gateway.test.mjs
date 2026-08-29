import assert from 'node:assert/strict';
import test from 'node:test';

import { SiteGatewayManager } from '../plugins/sites/dist/gateway.js';

const NAMECHEAP_KEYS = {
  apiUser: 'namecheapApiUser', apiKey: 'namecheapApiKey', username: 'namecheapUsername',
  clientIp: 'namecheapClientIp', email: 'acmeEmail',
};

const makeHarness = () => {
  const values = new Map();
  const versions = new Map();
  const provisioned = [];
  let denied = 0;
  let statusCalls = 0;
  const bag = {
    get: (key) => values.has(key) ? { value: values.get(key), version: versions.get(key) ?? 1 } : null,
    has: (key) => values.has(key),
    set: (key, value) => { values.set(key, value); const version = (versions.get(key) ?? 0) + 1; versions.set(key, version); return version; },
    delete: (key) => values.delete(key),
  };
  const control = {
    hostnameBase: () => 'sites.agent.example.com',
    provisionNamecheap: async (input) => {
      provisioned.push(input);
      return { available: true, active: true, hostnameBase: 'sites.agent.example.com' };
    },
    deny: async () => { denied += 1; return { available: true, active: false, hostnameBase: 'sites.agent.example.com' }; },
    status: async () => { statusCalls += 1; return { available: true, active: false, hostnameBase: 'sites.agent.example.com', detail: 'credentials missing' }; },
  };
  const ctx = { instanceSecrets: () => bag, control: (name) => name === 'publishedSitesGateway' ? control : undefined };
  return { manager: new SiteGatewayManager(ctx), control, values, provisioned, get denied() { return denied; }, get statusCalls() { return statusCalls; } };
};

const request = (method, body = {}) => ({ method, json: async () => body });
const bodyOf = (response) => response.body;

test('gateway credentials are encrypted-bag writes and are never returned by the API', async () => {
  const harness = makeHarness();
  const credentials = {
    apiUser: 'operator', apiKey: 'super-secret-namecheap-key', username: 'operator',
    clientIp: '203.0.113.7', email: 'ops@example.com',
  };
  const response = await harness.manager.handle(request('PUT', credentials));
  assert.equal(response.status, 200);
  assert.deepEqual(bodyOf(response).configured, { apiUser: true, apiKey: true, username: true, clientIp: true, email: true });
  assert.equal(JSON.stringify(response.body).includes(credentials.apiKey), false);
  assert.equal(harness.values.get(NAMECHEAP_KEYS.apiKey), credentials.apiKey);
  assert.equal(harness.provisioned.length, 1);
  assert.equal(harness.provisioned[0].apiKey, credentials.apiKey);
  assert.match(harness.provisioned[0].gatewayToken, /^[A-Za-z0-9_-]{43}$/);
});

test('empty form fields preserve stored write-only values', async () => {
  const harness = makeHarness();
  await harness.manager.handle(request('PUT', {
    apiUser: 'operator', apiKey: 'super-secret-namecheap-key', username: 'operator',
    clientIp: '203.0.113.7', email: 'ops@example.com',
  }));
  await harness.manager.handle(request('PUT', { apiKey: '', email: 'renewals@example.com' }));
  assert.equal(harness.values.get(NAMECHEAP_KEYS.apiKey), 'super-secret-namecheap-key');
  assert.equal(harness.values.get(NAMECHEAP_KEYS.email), 'renewals@example.com');
});

test('an incomplete setup reports status without trying ACME', async () => {
  const harness = makeHarness();
  const response = await harness.manager.handle(request('GET'));
  assert.equal(harness.provisioned.length, 0);
  assert.equal(harness.statusCalls, 1);
  assert.equal(bodyOf(response).status.active, false);
  assert.equal(JSON.stringify(response.body).includes('apiKey'), true, 'field presence names are safe to return');
});

test('removing credentials switches the wildcard to its deny tombstone', async () => {
  const harness = makeHarness();
  for (const [field, key] of Object.entries(NAMECHEAP_KEYS)) harness.values.set(key, `${field}-value`);
  const response = await harness.manager.handle(request('DELETE'));
  assert.equal(harness.denied, 1);
  assert.equal(bodyOf(response).status.active, false);
  assert.equal([...harness.values.keys()].some((key) => Object.values(NAMECHEAP_KEYS).includes(key)), false);
});

test('credentials remain encrypted when the deny tombstone cannot be installed', async () => {
  const harness = makeHarness();
  for (const [field, key] of Object.entries(NAMECHEAP_KEYS)) harness.values.set(key, `${field}-value`);
  harness.control.deny = async () => { throw new Error('nginx reload failed'); };
  const response = await harness.manager.handle(request('DELETE'));
  assert.equal(response.status, 503);
  assert.equal(bodyOf(response).status.active, true);
  assert.deepEqual(bodyOf(response).configured, { apiUser: true, apiKey: true, username: true, clientIp: true, email: true });
});

test('concurrent reconciles join one gateway mutation', async () => {
  const harness = makeHarness();
  for (const [field, key] of Object.entries(NAMECHEAP_KEYS)) harness.values.set(key, `${field}-value`);
  let resolveProvision;
  let calls = 0;
  harness.control.provisionNamecheap = () => {
    calls += 1;
    return new Promise((resolve) => { resolveProvision = resolve; });
  };
  const first = harness.manager.reconcile();
  const second = harness.manager.reconcile();
  assert.equal(first, second);
  resolveProvision({ available: true, active: true, hostnameBase: 'sites.agent.example.com' });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});
