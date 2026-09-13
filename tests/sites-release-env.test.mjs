import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReleaseEnv } from '../plugins/sites/dist/releaseEnvironment.js';

test('dotenv loading preserves runtime-owned variables and refuses symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-env-'));
  try {
    assert.deepEqual(readReleaseEnv(root), {});
    writeFileSync(join(root, '.env'), 'APP_TOKEN="value # literal"\nHOME=/bad\nPORT=1\nNODE_ENV=bad\nELOWEN_TOKEN=bad\n');
    assert.deepEqual(readReleaseEnv(root), { APP_TOKEN: 'value # literal' });
    rmSync(join(root, '.env'));
    const foreign = join(root, 'foreign');
    writeFileSync(foreign, 'APP_TOKEN=other\n');
    symlinkSync(foreign, join(root, '.env'));
    assert.throws(() => readReleaseEnv(root), /could not be loaded/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
