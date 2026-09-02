import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../scripts/check-manifests.mjs', import.meta.url);
const roots = [];
test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(field) {
  const root = mkdtempSync(join(tmpdir(), 'elowen-manifest-check-'));
  roots.push(root);
  const plugin = join(root, 'plugins', 'demo');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(plugin, 'index.mjs'), 'export function register() {}\n');
  writeFileSync(join(plugin, 'elowen-plugin.json'), JSON.stringify({
    name: 'demo', version: '1.0.0', apiVersion: '1', description: 'Demo', entry: 'index.mjs',
    configSchema: [field],
  }));
  writeFileSync(join(root, 'registry.json'), JSON.stringify({ schema: 1, plugins: [{ name: 'demo' }] }));
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [script.pathname], {
    encoding: 'utf8',
    env: { ...process.env, ELOWEN_MANIFEST_CHECK_ROOT: root },
  });
}

test('fails when the published core would degrade an unknown config field type', () => {
  const result = run(fixture({ key: 'project', label: 'Project', type: 'future-project-picker' }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown type "future-project-picker"/);
});

test('fails when a config default is not accepted by the real manifest schema', () => {
  const result = run(fixture({
    key: 'projects', label: 'Projects', type: 'multiSelect', default: [],
    options: [{ value: 'one', label: 'One' }],
  }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid plugin manifest: .*default/);
});

test('accepts a manifest the published core parses without degradation', () => {
  const result = run(fixture({
    key: 'mode', label: 'Mode', type: 'enum', default: 'safe',
    options: [{ value: 'safe', label: 'Safe' }],
  }));
  assert.equal(result.status, 0, result.stderr);
});
