import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../scripts/release-plugin.mjs', import.meta.url);
const roots = [];
test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture({ manifestVersion = '1.0.0', registryVersion = manifestVersion, webCheck = 'pass' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'elowen-release-'));
  roots.push(root);
  const plugin = join(root, 'plugins', 'demo');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(plugin, 'elowen-plugin.json'), JSON.stringify({
    name: 'demo', version: manifestVersion, apiVersion: '1', description: 'Demo', entry: 'index.mjs',
  }, null, 2));
  writeFileSync(join(plugin, 'index.mjs'), 'export function register() {}\n');
  writeFileSync(join(root, 'registry.json'), JSON.stringify({
    plugins: [{ name: 'demo', version: registryVersion, apiVersion: '1' }],
  }, null, 2));
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    scripts: {
      'check:web': webCheck === 'pass' ? 'node -e "process.exit(0)"' : 'node -e "process.exit(7)"',
      'check:dist': 'node -e "process.exit(0)"',
    },
  }));
  return { root, plugin };
}

function run(root, args, { verify = false } = {}) {
  return spawnSync(process.execPath, [script.pathname, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ELOWEN_RELEASE_ROOT: root,
      ELOWEN_RELEASE_DATE: '2026-08-27',
      ELOWEN_RELEASE_SKIP_VERIFY: verify ? '0' : '1',
      ELOWEN_RELEASE_SKIP_CLEAN: '1',
      ELOWEN_RELEASE_SKIP_POSTCHECK: '1',
    },
  });
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('raises manifest and catalog together and writes one changelog entry', () => {
  const { root, plugin } = fixture();
  const result = run(root, ['demo', '1.1.0', 'Add safer project selection']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(join(plugin, 'elowen-plugin.json')).version, '1.1.0');
  assert.equal(readJson(join(root, 'registry.json')).plugins[0].version, '1.1.0');
  assert.match(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), /## demo 1\.1\.0 - 2026-08-27\n\n- Add safer project selection/);
});

test('refuses pre-existing manifest/catalogue drift without changing either file', () => {
  const { root, plugin } = fixture({ registryVersion: '0.9.0' });
  const beforeManifest = readFileSync(join(plugin, 'elowen-plugin.json'), 'utf8');
  const beforeRegistry = readFileSync(join(root, 'registry.json'), 'utf8');
  const result = run(root, ['demo', '1.1.0', 'Should not land']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /version drift before release/);
  assert.equal(readFileSync(join(plugin, 'elowen-plugin.json'), 'utf8'), beforeManifest);
  assert.equal(readFileSync(join(root, 'registry.json'), 'utf8'), beforeRegistry);
});

test('runs artifact verification before writing release metadata', () => {
  const { root, plugin } = fixture({ webCheck: 'fail' });
  const result = run(root, ['demo', '1.1.0', 'Should not land'], { verify: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm run check:web failed with exit 7/);
  assert.equal(readJson(join(plugin, 'elowen-plugin.json')).version, '1.0.0');
  assert.equal(readJson(join(root, 'registry.json')).plugins[0].version, '1.0.0');
});
