import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DataSyncService } from '../plugins/sites/dist/dataSync.js';
import { parseAppRecipe, appUnit, provisionScript } from '../plugins/sites/dist/recipe.js';

test('conversion carries dotenv values in a protected systemd environment file, not the public unit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sites-env-'));
  try {
    const artifacts = join(root, 'artifacts');
    const workspace = join(root, 'workspace');
    const unpacked = join(root, 'unpacked');
    mkdirSync(workspace);
    mkdirSync(unpacked);
    writeFileSync(join(workspace, '.env'), 'CLIENT_SECRET="test-private-value"\nHOME=/wrong\nPORT=9999\nELOWEN_TOKEN=not-inherited\n');
    const recipe = parseAppRecipe({ kind: 'node-app', argv: ['/usr/bin/node', 'server.mjs'], env: { PORT: '80' }, secretFiles: ['.env'] });
    const sync = new DataSyncService({ artifactDir: () => artifacts, executor: {
      run: async (file, args, options) => ({ code: 0, stdout: execFileSync(file, args, { cwd: options.cwd, encoding: 'utf8' }), stderr: '' }),
    } });
    sync.extractSecretArtifacts('site', workspace, recipe.secretFiles);
    const unit = appUnit(recipe);
    const script = provisionScript(recipe);
    const archive = await sync.buildSeedArchive('site', { appUnit: unit, provisionScript: script, dataArchive: null });
    execFileSync('tar', ['-xf', archive, '-C', unpacked]);
    const envFile = join(unpacked, '.elowen-conversion/app.env');
    assert.ok(existsSync(envFile), 'the app needs parsed environment values, not just a copied .env');
    assert.equal(statSync(envFile).mode & 0o777, 0o600);
    const env = readFileSync(envFile, 'utf8');
    assert.match(env, /CLIENT_SECRET="test-private-value"/);
    assert.doesNotMatch(env, /HOME=|PORT=|ELOWEN_TOKEN=/);
    assert.deepEqual(unit.split('\n').filter((line) => line.startsWith('EnvironmentFile=')), [
      'EnvironmentFile=/etc/elowen-app.env',
      'EnvironmentFile=/etc/elowen-app-recipe.env',
    ], 'systemd must load explicit recipe settings last so they override dotenv values');
    assert.doesNotMatch(unit + script, /test-private-value|not-inherited/);
    assert.match(script, /install -m 0600.*app.env/);
    assert.equal(existsSync(join(artifacts, 'seed')), false);
    const etc = join(root, 'etc');
    const bin = join(root, 'bin');
    mkdirSync(join(etc, 'systemd/system'), { recursive: true });
    mkdirSync(bin);
    writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const isolatedScript = script.replaceAll('/data', unpacked).replaceAll('/workspace', workspace).replaceAll('/etc', etc);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      execFileSync('/bin/sh', ['-eu'], { input: isolatedScript, env: { PATH: `${bin}:/usr/bin:/bin` } });
      assert.equal(readFileSync(join(etc, 'elowen-app.env'), 'utf8'), env);
      assert.equal(statSync(join(etc, 'elowen-app.env')).mode & 0o777, 0o600);
      assert.equal(readFileSync(join(etc, 'elowen-app-recipe.env'), 'utf8'), 'PORT="80"\n');
      assert.equal(existsSync(envFile), false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the captured data archive is unpacked once, so a reboot cannot revert what the app has written', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sites-reboot-'));
  try {
    const artifacts = join(root, 'artifacts');
    const workspace = join(root, 'workspace');
    const unpacked = join(root, 'unpacked');
    const captured = join(root, 'captured');
    mkdirSync(workspace);
    mkdirSync(unpacked);
    mkdirSync(captured);
    // What the legacy runtime held when the conversion captured it, archived the way `dataSync` archives
    // it: relative to the sandbox home, which the script unpacks relative to the recipe's data directory.
    writeFileSync(join(captured, 'app.db'), 'captured-at-conversion-time');
    const legacyArchive = join(root, 'legacy-data.tar');
    execFileSync('tar', ['-cf', legacyArchive, '-C', captured, '.']);

    const recipe = parseAppRecipe({ kind: 'node-app', argv: ['/usr/bin/node', 'server.mjs'] });
    const sync = new DataSyncService({ artifactDir: () => artifacts, executor: {
      run: async (file, args, options) => ({ code: 0, stdout: execFileSync(file, args, { cwd: options.cwd, encoding: 'utf8' }), stderr: '' }),
    } });
    const seed = await sync.buildSeedArchive('site', {
      appUnit: appUnit(recipe), provisionScript: provisionScript(recipe), dataArchive: legacyArchive,
    });
    execFileSync('tar', ['-xf', seed, '-C', unpacked]);

    // The same isolation the test above uses: the script's absolute paths are rebased onto the temp tree
    // and `systemctl` is stubbed, so the REAL generated script runs, twice, as two boots of one container.
    const etc = join(root, 'etc');
    const bin = join(root, 'bin');
    mkdirSync(join(etc, 'systemd/system'), { recursive: true });
    mkdirSync(bin);
    writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const script = provisionScript(recipe)
      .replaceAll('/data', unpacked).replaceAll('/workspace', workspace).replaceAll('/etc', etc);
    const boot = () => execFileSync('/bin/sh', ['-eu'], { input: script, env: { PATH: `${bin}:/usr/bin:/bin` } });
    const staged = join(unpacked, '.elowen-conversion/legacy-data.tar');
    const live = join(unpacked, 'app.db');

    assert.ok(existsSync(staged), 'the seed must carry the capture the first boot restores');
    boot();
    assert.equal(readFileSync(live, 'utf8'), 'captured-at-conversion-time');
    assert.equal(existsSync(staged), false, 'a consumed archive must not outlive the boot that unpacked it');

    // Everything the site did after the conversion. A second boot must leave it exactly as it is.
    writeFileSync(live, 'written-by-the-app-after-the-conversion');
    boot();
    assert.equal(readFileSync(live, 'utf8'), 'written-by-the-app-after-the-conversion',
      'restarting the container re-extracted the capture and reverted the application data');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('node recipes always protect the runtime dotenv file', () => {
  const recipe = parseAppRecipe({ kind: 'node-app', argv: ['/usr/bin/node', 'server.mjs'] });
  assert.ok(recipe.secretFiles.includes('.env'));
});
