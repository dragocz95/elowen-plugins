import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReleaseEnv, systemdEnvironment } from '../plugins/sites/dist/releaseEnvironment.js';
import { DataSyncService } from '../plugins/sites/dist/dataSync.js';

test('systemd environment values preserve literal quotes, dollars, backslashes, percent and newlines', () => {
  assert.equal(systemdEnvironment({ TOKEN: 'a "$HOME" \\literal %n' }), 'TOKEN="a \\"\\$HOME\\" \\\\literal %n"\n');
  assert.equal(systemdEnvironment({ MULTI: 'first\nsecond', EMPTY: '' }), 'EMPTY=""\nMULTI="first\nsecond"\n');
  assert.throws(() => systemdEnvironment({ TOKEN: 'private\0value' }), /cannot be represented/);
  assert.throws(() => systemdEnvironment({ 'BAD\nNAME': 'private' }), /cannot be represented/);
});

test('dotenv loading preserves the legacy reserved-key contract and refuses links before moving secrets', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-env-'));
  try {
    assert.deepEqual(readReleaseEnv(root), {});
    writeFileSync(join(root, '.env'), 'APP_TOKEN="value # literal"\nHOME=/bad\nPORT=1\nNODE_ENV=bad\nELOWEN_TOKEN=bad\n');
    assert.deepEqual(readReleaseEnv(root), { APP_TOKEN: 'value # literal' });
    rmSync(join(root, '.env'));
    const foreign = join(root, 'foreign');
    writeFileSync(foreign, 'APP_TOKEN=other\n', { mode: 0o644 });
    symlinkSync(foreign, join(root, '.env'));
    const sync = new DataSyncService({ artifactDir: () => join(root, 'artifacts'), executor: {} });
    assert.throws(() => sync.extractSecretArtifacts('site', root, ['.env']), /could not be loaded/);
    assert.equal(statSync(foreign).mode & 0o777, 0o644);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
