import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('todo manifest and marketplace registry expose the same release', () => {
  const manifest = JSON.parse(readFileSync(new URL('../plugins/todo/elowen-plugin.json', import.meta.url), 'utf8'));
  const registry = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'));
  const catalog = registry.plugins.find((plugin) => plugin.name === 'todo');

  // 0.14.14 keeps unreadable task metadata on disk: a corrupt column reads as empty with a marker, is
  // logged once, and is left out of any update that does not explicitly replace it.
  // 0.14.13 folds the chat task card, shares one preview rule with the rail and clocks the running row.
  // 0.14.12 isolated route card refresh failures from successful task mutations and pinned its task tools
  // through registration metadata. API 2 is the matched core contract after managed session migration.
  assert.equal(manifest.version, '0.14.14');
  assert.equal(manifest.apiVersion, '2');
  assert.equal(manifest.requiresCore, '0.28.49');
  assert.equal(catalog?.version, manifest.version);
  assert.equal(catalog?.requiresCore, manifest.requiresCore);
  assert.equal(catalog?.provides.tools, 5);
  assert.equal(catalog?.provides.apiRoutes, 2);
  assert.deepEqual(manifest.provides.tools, ['TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskDelete', 'TaskList']);
  assert.deepEqual(manifest.provides.apiRoutes, ['tasks', 'task']);
  assert.ok(manifest.provides.apiRoutes.every((path) => /^[a-z0-9][a-z0-9\-/]*$/.test(path)));
  assert.deepEqual(manifest.planSafe, ['TaskGet', 'TaskList']);
});
