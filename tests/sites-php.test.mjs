import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { executePhp } from '../plugins/sites/dist/php.js';

const tempDir = () => mkdtempSync(join(tmpdir(), 'sites-php-'));

const request = (overrides = {}) => ({
  method: 'POST',
  path: '',
  query: { q: 'one' },
  headers: { 'content-type': 'application/json', cookie: 'app_session=abc', authorization: 'Bearer site-token' },
  body: async () => Buffer.from('{"hello":"world"}'),
  json: async () => ({}),
  ...overrides,
});

test('PHP runs as one isolated CGI request and may use site-local cookies', async (t) => {
  const root = tempDir();
  const release = join(root, 'release');
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, 'index.php'), '<?php');
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const preparedInputs = [];
  let released = 0;
  const script = `
    const { spawn } = require('node:child_process');
    const descendant = spawn('sleep', ['30'], { stdio: 'ignore' });
    descendant.unref();
    const payload = JSON.stringify({
      childPid: descendant.pid,
      method: process.env.REQUEST_METHOD,
      query: process.env.QUERY_STRING,
      cookie: process.env.HTTP_COOKIE,
      authorization: process.env.HTTP_AUTHORIZATION,
      user: process.env.HTTP_X_ELOWEN_USER_ID,
      pathInfo: process.env.PATH_INFO,
    });
    process.stdout.write('Status: 201 Created\\r\\n');
    process.stdout.write('Content-Type: application/json\\r\\n');
    process.stdout.write('Set-Cookie: php_session=xyz; Path=/; HttpOnly\\r\\n');
    process.stdout.write('Set-Cookie: preference=compact; Path=/\\r\\n');
    process.stdout.write('Access-Control-Allow-Origin: https://client.example\\r\\n\\r\\n');
    process.stdout.write(payload);
  `;
  const sandbox = {
    prepareExecution: async (input, options) => {
      preparedInputs.push({ input, options });
      return {
        mode: 'confined', cwd: release, home: root, roots: [release], workspace: null,
        launch: { type: 'argv', file: process.execPath, args: ['-e', script], env: {} },
        lease: { id: 'lease-1', accountUserId: 7, workspaceId: null, homeGeneration: 1, heartbeat() {}, release() { released += 1; } },
      };
    },
  };
  const response = await executePhp(
    { ctx: { control: () => sandbox }, siteDir: () => root },
    { id: 'site-1', ownerUserId: 7 },
    release,
    request({ path: 'reports/today' }),
    'reports/today',
    { userId: 9, name: 'josef' },
    { maxResponseBytes: 1024 * 1024, requestTimeoutSeconds: 5 },
    'https://demo.sites.agent.example/',
  );

  assert.equal(response.status, 201);
  assert.deepEqual(response.headers['set-cookie'], [
    'php_session=xyz; Path=/; HttpOnly',
    'preference=compact; Path=/',
  ]);
  assert.equal(response.headers['access-control-allow-origin'], 'https://client.example');
  const body = JSON.parse(Buffer.from(response.body).toString('utf8'));
  const { childPid, ...requestBody } = body;
  assert.deepEqual(requestBody, {
    method: 'POST', query: 'q=one', cookie: 'app_session=abc', authorization: 'Bearer site-token',
    user: '9', pathInfo: '/reports/today',
  });
  assert.throws(() => process.kill(childPid, 0), 'a CGI descendant must not outlive the request lease');
  assert.equal(preparedInputs[0].input.command.file, '/usr/bin/php-cgi');
  assert.equal(preparedInputs[0].input.network, 'isolated');
  assert.deepEqual(preparedInputs[0].options.roots, [release, join(root, 'run')]);
  assert.equal(released, 1);
});

test('PHP refuses a release with no index or requested PHP script', async (t) => {
  const root = tempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await assert.rejects(() => executePhp(
    { ctx: { control: () => ({}) }, siteDir: () => root },
    { id: 'site-1', ownerUserId: 7 },
    root,
    request(),
    '',
    { userId: null, name: null },
    { maxResponseBytes: 1024, requestTimeoutSeconds: 1 },
    'https://demo.sites.agent.example/',
  ), /entry script/);
});

test('a CGI Location header implies a 302 and stays on the site origin', async (t) => {
  const root = tempDir();
  const release = join(root, 'release');
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, 'index.php'), '<?php');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sandbox = {
    prepareExecution: async () => ({
      mode: 'confined', cwd: release, home: root, roots: [release], workspace: null,
      launch: { type: 'argv', file: process.execPath, args: ['-e', "process.stdout.write('Location: /login\\r\\n\\r\\n')"], env: {} },
      lease: { id: 'lease-2', accountUserId: 7, workspaceId: null, homeGeneration: 1, heartbeat() {}, release() {} },
    }),
  };
  const response = await executePhp(
    { ctx: { control: () => sandbox }, siteDir: () => root },
    { id: 'site-1', ownerUserId: 7 }, release, request({ method: 'GET', body: async () => Buffer.alloc(0) }), '',
    { userId: null, name: null }, { maxResponseBytes: 1024, requestTimeoutSeconds: 5 },
    'https://demo.sites.agent.example/',
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, 'https://demo.sites.agent.example/login');
});
