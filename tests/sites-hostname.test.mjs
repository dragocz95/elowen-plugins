import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSiteHostname, SiteHostnameError } from '../plugins/sites/dist/hostname.js';

const rejects = (value, code) => {
  assert.throws(() => parseSiteHostname(value), (error) => {
    assert.ok(error instanceof SiteHostnameError);
    assert.equal(error.code, code);
    return true;
  }, String(value));
};

test('custom hostnames canonicalize Unicode, Punycode and one trailing root dot', () => {
  assert.deepEqual(parseSiteHostname('  BÜCHER.Example.  '), {
    ascii: 'xn--bcher-kva.example',
    unicode: 'bücher.example',
    kind: 'root',
    delegatedRootWarning: false,
  });
  assert.deepEqual(parseSiteHostname('XN--BCHER-KVA.Example').ascii, 'xn--bcher-kva.example');
  rejects('example.com..', 'invalid_hostname');
});

test('custom hostname boundary rejects URL-like, local, address and wildcard input', () => {
  for (const value of [
    'https://example.com', 'example.com/path', 'example.com:443', 'me@example.com',
    '*.example.com', '_service.example.com', 'two words.example', 'example.com\0',
    '127.0.0.1', '2001:db8::1', 'localhost', 'printer.local', '1.0.0.127.in-addr.arpa',
    'b.a.ip6.arpa', 'singlelabel', 'example.123',
  ]) rejects(value, 'invalid_hostname');
});

test('public suffixes and DNS length limits are rejected', () => {
  rejects('co.uk', 'public_suffix');
  rejects(`${'a'.repeat(64)}.example.com`, 'invalid_hostname');
  rejects(`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}.com`, 'invalid_hostname');
});

test('PSL classification distinguishes registrable roots from subdomains', () => {
  assert.equal(parseSiteHostname('example.com').kind, 'root');
  assert.equal(parseSiteHostname('example.co.uk').kind, 'root');
  assert.deepEqual(parseSiteHostname('shop.example.co.uk'), {
    ascii: 'shop.example.co.uk',
    unicode: 'shop.example.co.uk',
    kind: 'subdomain',
    delegatedRootWarning: true,
  });
});

test('reserved instance and generated names are refused after canonicalization', () => {
  const reserved = {
    appHostname: 'app.example.com',
    generatedHostnameBase: 'sites.example.com',
    gatewayHostname: 'gateway.example.com',
    reservedHostnames: ['reserved.example.com'],
    ownGeneratedHostname: 'demo.sites.example.com',
  };
  for (const value of [
    'APP.example.com.', 'sites.example.com', 'child.sites.example.com',
    'gateway.example.com', 'reserved.example.com', 'demo.sites.example.com',
  ]) {
    assert.throws(() => parseSiteHostname(value, reserved), (error) => error.code === 'reserved_hostname');
  }
});
