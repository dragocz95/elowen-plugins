import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshotManagedRelease } from '../plugins/sites/dist/managedPublish.js';

test('the shipped Sites surface contains no per-Site environment runtime', () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('plugins/sites/elowen-plugin.json', root), 'utf8'));
  assert.deepEqual(manifest.provides.tools, [
    'SiteCreate', 'SitePreview', 'SitePublish', 'SiteGet', 'SiteList', 'SiteUpdate',
    'SiteRollback', 'SiteLogs', 'SiteShare', 'SiteUnshare', 'SiteDelete',
  ]);
  assert.equal(manifest.provides.apiRoutes.includes('conversion'), false);
  assert.equal(manifest.configSchema.some((field) => /^environment|allowEnvironments|maxEnvironments/.test(field.key)), false);
  assert.equal('settings' in manifest.web, false);
  for (const file of [
    'environment', 'migration', 'dataSync', 'recipe', 'baseImage', 'conversionImage', 'podman', 'siteRuntimeAuthority',
  ]) {
    assert.equal(existsSync(new URL(`plugins/sites/src/${file}.ts`, root)), false, `${file}.ts is retired`);
    assert.equal(existsSync(new URL(`plugins/sites/dist/${file}.js`, root)), false, `${file}.js is retired`);
  }
});

test('managed static publication copies bounded version-stable Project files', async () => {
  const target = mkdtempSync(join(tmpdir(), 'sites-managed-release-'));
  rmSync(target, { recursive: true, force: true });
  const bytes = Buffer.from('<h1>managed</h1>');
  const calls = [];
  const control = {
    projectFiles: async (input) => {
      calls.push(input);
      if (input.operation.kind === 'walk') {
        return {
          kind: 'walk', root: '/demo/sites/app', rootKind: 'directory', truncated: false,
          entries: [{ path: '/demo/sites/app/index.html', kind: 'file', size: bytes.length, mtime: 1 }],
        };
      }
      const chunk = bytes.subarray(input.operation.offset, input.operation.offset + input.operation.length);
      return { kind: 'read', base64: chunk.toString('base64'), version: 'sha256:v1', totalBytes: bytes.length };
    },
  };

  const result = await snapshotManagedRelease(control, {
    projectId: 7, accountUserId: 1, sourceRoot: '/demo/sites/app', releaseDir: target,
    limits: { maxAssetBytes: 1024, maxTotalBytes: 4096, mode: 'static' },
  });
  assert.deepEqual(result, { fileCount: 1, sizeBytes: bytes.length, warnings: [] });
  assert.equal(readFileSync(join(target, 'index.html'), 'utf8'), bytes.toString());
  assert.equal(calls.every((call) => call.project.projectId === 7 && call.accountUserId === 1), true);
  rmSync(target, { recursive: true, force: true });
});

test('managed publication removes a partial release when a file version changes', async () => {
  const target = join(mkdtempSync(join(tmpdir(), 'sites-managed-drift-')), 'release');
  const bytes = Buffer.alloc(300_000, 0x61);
  const control = {
    projectFiles: async (input) => {
      if (input.operation.kind === 'walk') {
        return {
          kind: 'walk', root: '/demo/sites/app', rootKind: 'directory', truncated: false,
          entries: [{ path: '/demo/sites/app/index.html', kind: 'file', size: bytes.length, mtime: 1 }],
        };
      }
      const chunk = bytes.subarray(input.operation.offset, input.operation.offset + input.operation.length);
      return {
        kind: 'read', base64: chunk.toString('base64'),
        version: input.operation.offset === 0 ? 'sha256:v1' : 'sha256:v2', totalBytes: bytes.length,
      };
    },
  };

  await assert.rejects(() => snapshotManagedRelease(control, {
    projectId: 7, accountUserId: 1, sourceRoot: '/demo/sites/app', releaseDir: target,
    limits: { maxAssetBytes: 400_000, maxTotalBytes: 500_000, mode: 'static' },
  }), /changed during publication/);
  assert.equal(existsSync(target), false);
  rmSync(join(target, '..'), { recursive: true, force: true });
});
