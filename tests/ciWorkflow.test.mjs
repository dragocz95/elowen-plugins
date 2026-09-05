import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import YAML from 'yaml';

const root = new URL('..', import.meta.url);

test('CI workflow parses and runs every registry gate before drift checks', () => {
  const workflow = YAML.parse(readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8'));
  const job = workflow?.jobs?.test;
  assert.equal(job?.name, 'Tests + bundle drift');

  assert.equal(job.defaults.run['working-directory'], 'registry');
  assert.equal(job.env.ELOWEN_CORE_ROOT, '${{ github.workspace }}/core');
  assert.match(job.env.ELOWEN_CORE_REF, /^[0-9a-f]{40}$/);
  const coreCheckout = job.steps.find((step) => step.with?.repository === 'dragocz95/elowen');
  assert.equal(coreCheckout.with.ref, '${{ env.ELOWEN_CORE_REF }}');
  assert.equal(coreCheckout.with.path, 'core');
  assert.equal(coreCheckout.with['persist-credentials'], false);
  const pinGuard = job.steps.findIndex((step) => step.name === 'Require a pinned core release commit');
  assert.ok(pinGuard >= 0 && pinGuard < job.steps.indexOf(coreCheckout));
  assert.match(job.steps[pinGuard].run, /\^\[0-9a-f\]\{40\}\$/);
  const build = job.steps.findIndex((step) => step.name === 'Build core contract helpers');
  assert.equal(job.steps[build]['working-directory'], 'core');
  assert.equal(job.steps[build].run, 'npm run build:ts');
  assert.ok(build < job.steps.findIndex((step) => step.run === 'npm run check'));
  const versionGuard = job.steps.find((step) => step.name === 'Match core source to the installed daemon');
  assert.match(versionGuard.run, /assert\.equal/);
  assert.match(versionGuard.run, /node_modules\/elowen\/package\.json/);
  assert.match(versionGuard.run, /ELOWEN_CORE_ROOT/);
  const commands = job.steps.flatMap((step) => typeof step.run === 'string' && !step.name ? [step.run] : []);
  assert.deepEqual(commands, [
    'npm ci',
    'npm run check',
    'npm test',
    'npm run check:web',
    'npm run check:dist',
  ]);
});

test('the core checkout guard rejects missing and floating refs before checkout', () => {
  const workflow = YAML.parse(readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8'));
  const command = workflow.jobs.test.steps.find((step) => step.name === 'Require a pinned core release commit').run;
  for (const ref of ['', 'main', 'latest', 'v0.28.31', 'abcdef0']) {
    const result = spawnSync(command, { shell: true, encoding: 'utf8', env: { ...process.env, ELOWEN_CORE_REF: ref } });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, `unexpectedly accepted ${ref}`);
    assert.match(result.stderr, /must pin the full released core commit SHA/);
  }
  const result = spawnSync(command, { shell: true, encoding: 'utf8', env: { ...process.env, ELOWEN_CORE_REF: 'a'.repeat(40) } });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('the local check script composes every static-analysis gate', () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(
    pkg.scripts.check,
    'npm run lint && npm run deadcode && npm run depcruise && npm run typecheck && npm run languages-check && npm run shared-check && npm run manifest-check',
  );
});
