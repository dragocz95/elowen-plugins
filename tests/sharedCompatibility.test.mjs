import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../scripts/check-shared-compat.mjs', import.meta.url);
const roots = [];
test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture({ requiresSharedApi = 2, daemonVersion = '0.1.7', omitSharedApi = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'elowen-shared-check-'));
  roots.push(root);
  const daemon = join(root, 'daemon');
  const shared = join(root, 'node_modules', 'elowen-plugin-shared');
  const plugin = join(root, 'plugins', 'demo');
  mkdirSync(daemon, { recursive: true });
  mkdirSync(shared, { recursive: true });
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { 'elowen-plugin-shared': '^0.1.7' } }));
  writeFileSync(join(daemon, 'package.json'), JSON.stringify({ version: '0.28.17', dependencies: { 'elowen-plugin-shared': daemonVersion } }));
  writeFileSync(join(shared, 'package.json'), JSON.stringify({ name: 'elowen-plugin-shared', version: '0.1.7', type: 'module' }));
  writeFileSync(join(shared, 'index.mjs'), 'export const PLUGIN_SHARED_API_VERSION = 2;\n');
  writeFileSync(join(plugin, 'index.mjs'), "import 'elowen-plugin-shared/format';\n");
  const manifest = { name: 'demo', entry: 'index.mjs', requiresSharedApi };
  if (omitSharedApi) delete manifest.requiresSharedApi;
  writeFileSync(join(plugin, 'elowen-plugin.json'), JSON.stringify(manifest));
  return { root, daemon, plugin };
}

function run({ root, daemon }) {
  return spawnSync(process.execPath, [script.pathname], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ELOWEN_SHARED_CHECK_ROOT: root,
      ELOWEN_SHARED_DAEMON_ROOT: daemon,
      ELOWEN_SHARED_EXTRA_ROOTS: '',
    },
  });
}

test('fails when a plugin imports shared code without declaring its API contract', () => {
  const fx = fixture({ omitSharedApi: true });
  const result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /imports elowen-plugin-shared but declares no requiresSharedApi/);
});

test('fails when registry tests a shared version the published daemon cannot ship', () => {
  const fx = fixture({ daemonVersion: '0.1.5' });
  const result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /published daemon .* ships 0\.1\.5/);
});

test('accepts an exact shared API and compatible package versions', () => {
  const fx = fixture();
  const result = run(fx);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /shared 0\.1\.7 \/ API 2/);
});
