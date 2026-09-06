import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ENVIRONMENT_READINESS_SLOTS,
  SITES_TOOLCHAIN,
  environmentReadinessChecks,
  environmentReadinessRows,
  toolchainRow,
} from '../plugins/sites/dist/readiness.js';

const report = (overrides = {}) => ({
  ready: false,
  detail: 'Environment support is unavailable.',
  items: [
    { id: 'os:supported', label: 'Supported operating system', ok: true, detail: 'Ubuntu is supported' },
    { id: 'package:podman', label: 'Podman', ok: true, detail: 'installed' },
    { id: 'subuid', label: 'Subordinate user IDs', ok: false, detail: 'not configured' },
    { id: 'base-image', label: 'Deterministic Sites base image', ok: true },
  ],
  ...overrides,
});

const run = async (checks) => {
  const rows = [];
  for (const check of checks) {
    const row = await check();
    if (row) rows.push(row);
  }
  return rows;
};

// The status card renders ONE row per registered check. A dependency checklist folded back into a
// single prose row is exactly the regression this pins.
test('every environment dependency gets its own readiness row', async () => {
  const status = report();
  const rows = await run(environmentReadinessChecks({ enabled: () => true, status: async () => status }));

  assert.equal(rows.length, status.items.length);
  assert.deepEqual(rows.map((row) => row.label), status.items.map((item) => item.label));
  assert.deepEqual(rows.map((row) => row.id), [
    'sites-env-os:supported',
    'sites-env-package:podman',
    'sites-env-subuid',
    'sites-env-base-image',
  ]);
  assert.deepEqual(rows.map((row) => row.ok), [true, true, false, true]);
  // Each detail describes only its own dependency, and an item without one still carries a detail.
  assert.equal(rows[0].detail, 'Ubuntu is supported');
  assert.equal(rows[3].detail, 'Ready.');
  for (const row of rows) assert.ok(!row.detail.includes(';'), `row ${row.id} folds several checks into one detail`);
  // The report-wide explanation stays with the failing dependency instead of every green one.
  assert.match(rows[2].hint, /Environment support is unavailable\./);
  assert.equal(rows[0].hint, undefined);
});

test('the dependency rows share a single provisioning probe per request', async () => {
  let probes = 0;
  const checks = environmentReadinessChecks({
    enabled: () => true,
    status: async () => { probes += 1; return report(); },
    ttlMs: 60_000,
  });

  const rows = await run(checks);
  assert.equal(probes, 1);
  assert.equal(rows.length, 4);
});

test('a stale probe is taken again once its window passes', async () => {
  let probes = 0;
  let clock = 0;
  const checks = environmentReadinessChecks({
    enabled: () => true,
    status: async () => { probes += 1; return report(); },
    now: () => clock,
    ttlMs: 1_000,
  });

  await run(checks);
  clock = 5_000;
  await run(checks);
  assert.equal(probes, 2);
});

test('disabled environments keep a single explanatory row', async () => {
  const rows = await run(environmentReadinessChecks({
    enabled: () => false,
    status: async () => { throw new Error('must not probe the host when environments are off'); },
  }));

  assert.deepEqual(rows.map((row) => row.id), ['sites-environments']);
  assert.equal(rows[0].ok, true);
});

test('more dependencies than slots are reported instead of dropped', () => {
  const items = Array.from({ length: ENVIRONMENT_READINESS_SLOTS + 3 }, (_unused, index) => ({
    id: `check-${index}`,
    label: `Check ${index}`,
    ok: index !== 0,
    detail: 'measured',
  }));
  const rows = environmentReadinessRows(report({ items }));

  assert.equal(rows.length, ENVIRONMENT_READINESS_SLOTS);
  assert.equal(rows.at(-1).id, 'sites-env-remaining');
  assert.equal(rows.at(-1).ok, true);
  assert.match(rows.at(-1).label, /4 further environment checks/);
});

test('each toolchain interpreter is its own row', () => {
  const present = new Set(['/usr/bin/node', '/usr/bin/npm', '/usr/bin/corepack', '/usr/bin/python3']);
  const rows = SITES_TOOLCHAIN.map((probe) => toolchainRow(probe, (path) => present.has(path)));

  assert.deepEqual(rows.map((row) => row.id), [
    'sites-toolchain-node',
    'sites-toolchain-python',
    'sites-toolchain-bun',
    'sites-toolchain-php',
  ]);
  // An optional interpreter reports its absence without failing the card; a required one fails.
  assert.deepEqual(rows.map((row) => row.ok), [true, true, true, true]);
  assert.match(rows[2].detail, /Missing from the confined Sandbox: \/usr\/local\/bin\/bun\./);
  for (const row of rows) assert.ok(!row.detail.includes(';'), `row ${row.id} folds several tools into one detail`);

  const missingNode = toolchainRow(SITES_TOOLCHAIN[0], () => false);
  assert.equal(missingNode.ok, false);
  assert.match(missingNode.hint, /Install the required tools/);
});
