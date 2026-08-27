import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';

const root = new URL('..', import.meta.url);

test('CI workflow parses and runs every registry gate before drift checks', () => {
  const workflow = YAML.parse(readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8'));
  const job = workflow?.jobs?.test;
  assert.equal(job?.name, 'Tests + bundle drift');

  const commands = job.steps.flatMap((step) => typeof step.run === 'string' ? [step.run] : []);
  assert.deepEqual(commands, [
    'npm ci',
    'npm run check',
    'npm test',
    'npm run check:web',
    'npm run check:dist',
  ]);
});

test('the local check script composes every static-analysis gate', () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(
    pkg.scripts.check,
    'npm run lint && npm run deadcode && npm run depcruise && npm run typecheck && npm run languages-check',
  );
});
