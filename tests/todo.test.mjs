import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('todo manifest and marketplace registry expose the same release', () => {
  const manifest = JSON.parse(readFileSync(new URL('../plugins/todo/elowen-plugin.json', import.meta.url), 'utf8'));
  const registry = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'));
  const catalog = registry.plugins.find((plugin) => plugin.name === 'todo');

  assert.equal(manifest.version, '0.12.0');
  assert.equal(catalog?.version, manifest.version);
  assert.equal(catalog?.provides.tools, 5);
  assert.equal(catalog?.provides.apiRoutes, 2);
  assert.deepEqual(manifest.provides.tools, ['TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskDelete', 'TaskList']);
  assert.deepEqual(manifest.provides.apiRoutes, ['tasks', 'task']);
  assert.ok(manifest.provides.apiRoutes.every((path) => /^[a-z0-9][a-z0-9\-/]*$/.test(path)));
  assert.deepEqual(manifest.planSafe, ['TaskGet', 'TaskList']);
});
