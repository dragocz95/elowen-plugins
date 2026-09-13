import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshotManagedRelease } from '../plugins/sites/dist/managedPublish.js';
import { SitesStore } from '../plugins/sites/dist/store.js';

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

const makeDb = (beforeStep = () => {}) => {
  const db = new Database(':memory:');
  let version = 0;
  const handle = { exec: (sql) => db.exec(sql), prepare: (sql) => db.prepare(sql) };
  return {
    ...handle,
    migrate: (steps) => {
      for (const step of steps) {
        if (step.version <= version) continue;
        beforeStep(step.version, handle);
        step.up(handle);
        version = step.version;
      }
    },
    transaction: (fn) => db.transaction(fn)(),
  };
};

test('boot preserves legacy environment source_dir as opaque audit data without resolving a Project root', () => {
  const sources = ['/srv/retired/sites/app', '/outside/every/project'];
  const db = makeDb((version, handle) => {
    if (version !== 17) return;
    const insert = handle.prepare(`INSERT INTO p_sites_sites (
      id, slug, title, project_id, owner_user_id, source_dir, runtime, status, created_at, updated_at
    ) VALUES (?, ?, ?, 7, 1, ?, 'environment', 'live', ?, ?)`);
    for (const [index, source] of sources.entries()) {
      insert.run(`legacy-env-${index}`, `legacy-env-${index}`, 'Retired', source, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    }
  });
  const store = new SitesStore(db);
  let rootLookups = 0;

  store.migrateSourceReferences(() => { rootLookups += 1; return null; });

  assert.equal(rootLookups, 0);
  assert.deepEqual(
    db.prepare("SELECT id, source_rel AS sourceRel FROM p_sites_sites WHERE runtime = 'environment' ORDER BY id").all(),
    sources.map((sourceRel, index) => ({ id: `legacy-env-${index}`, sourceRel })),
  );
  assert.equal(db.prepare("SELECT 1 FROM pragma_table_info('p_sites_sites') WHERE name = 'source_dir'").get(), undefined);
  assert.deepEqual(store.allSites(), []);
});

test('boot ignores a dormant environment row with null source_rel after source_dir was already removed', () => {
  const db = makeDb();
  const store = new SitesStore(db);
  store.migrateSourceReferences(() => null);
  db.prepare(`INSERT INTO p_sites_sites (
    id, slug, title, project_id, owner_user_id, source_rel, runtime, status, created_at, updated_at
  ) VALUES ('legacy-env', 'legacy-env', 'Retired', 7, 1, NULL, 'environment', 'live', ?, ?)`).run(
    '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
  );

  assert.doesNotThrow(() => store.migrateSourceReferences(() => null));
  assert.equal(db.prepare("SELECT source_rel AS sourceRel FROM p_sites_sites WHERE id = 'legacy-env'").get().sourceRel, null);
  assert.equal(store.siteById('legacy-env'), null);
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

test('managed command publication preserves executable bits and safe relative symlink dependencies', async () => {
  const target = join(mkdtempSync(join(tmpdir(), 'sites-managed-command-')), 'release');
  const files = new Map([
    ['/demo/app/bin/start', Buffer.from('#!/bin/sh\nexec node ../lib/server.js\n')],
    ['/demo/app/lib/server.js', Buffer.from('console.log("ready")\n')],
  ]);
  const calls = [];
  const control = {
    projectFiles: async (input) => {
      calls.push(input.operation.kind);
      if (input.operation.kind === 'export-manifest') {
        return {
          kind: 'export-manifest', root: '/demo/app', mode: 0o755,
          entries: [
            { path: 'bin', kind: 'directory', mode: 0o755 },
            { path: 'bin/start', kind: 'file', mode: 0o755, size: files.get('/demo/app/bin/start').length, version: 'start-v1' },
            { path: 'bin/server.js', kind: 'symlink', mode: 0o777, target: '../lib/server.js' },
            { path: 'lib', kind: 'directory', mode: 0o755 },
            { path: 'lib/server.js', kind: 'file', mode: 0o644, size: files.get('/demo/app/lib/server.js').length, version: 'server-v1' },
          ],
        };
      }
      const bytes = files.get(input.operation.path);
      const version = input.operation.path.endsWith('/start') ? 'start-v1' : 'server-v1';
      const chunk = bytes.subarray(input.operation.offset, input.operation.offset + input.operation.length);
      return { kind: 'read', base64: chunk.toString('base64'), version, totalBytes: bytes.length };
    },
  };

  const result = await snapshotManagedRelease(control, {
    projectId: 7, accountUserId: 1, sourceRoot: '/demo/app', releaseDir: target,
    limits: { maxAssetBytes: 1024, maxTotalBytes: 4096, mode: 'command' },
  });

  assert.equal(lstatSync(join(target, 'bin/start')).mode & 0o777, 0o755);
  assert.equal(lstatSync(join(target, 'bin/server.js')).isSymbolicLink(), true);
  assert.equal(readlinkSync(join(target, 'bin/server.js')), '../lib/server.js');
  assert.equal(readFileSync(join(target, 'lib/server.js'), 'utf8'), 'console.log("ready")\n');
  assert.deepEqual(result, {
    fileCount: 3,
    sizeBytes: files.get('/demo/app/bin/start').length + files.get('/demo/app/lib/server.js').length + Buffer.byteLength('../lib/server.js'),
    warnings: [],
  });
  assert.equal(calls[0], 'export-manifest');
  rmSync(join(target, '..'), { recursive: true, force: true });
});

test('managed application publication rejects unsafe symlinks and inconsistent metadata atomically', async () => {
  for (const linkTarget of ['/etc/passwd', '../../outside']) {
    const target = join(mkdtempSync(join(tmpdir(), 'sites-managed-link-')), 'release');
    const control = {
      projectFiles: async () => ({
        kind: 'export-manifest', root: '/demo/app', mode: 0o755,
        entries: [{ path: 'dependency', kind: 'symlink', mode: 0o777, target: linkTarget }],
      }),
    };
    await assert.rejects(() => snapshotManagedRelease(control, {
      projectId: 7, accountUserId: 1, sourceRoot: '/demo/app', releaseDir: target,
      limits: { maxAssetBytes: 1024, maxTotalBytes: 4096, mode: 'php' },
    }), /unsafe target|leaves the publication root/);
    assert.equal(existsSync(target), false);
    rmSync(join(target, '..'), { recursive: true, force: true });
  }

  const target = join(mkdtempSync(join(tmpdir(), 'sites-managed-metadata-')), 'release');
  const control = {
    projectFiles: async (input) => input.operation.kind === 'export-manifest'
      ? { kind: 'export-manifest', root: '/demo/app', mode: 0o755, entries: [{ path: 'start', kind: 'file', mode: 0o755, size: 3, version: 'v1' }] }
      : { kind: 'read', base64: Buffer.from('four').toString('base64'), version: 'v1', totalBytes: 4 },
  };
  await assert.rejects(() => snapshotManagedRelease(control, {
    projectId: 7, accountUserId: 1, sourceRoot: '/demo/app', releaseDir: target,
    limits: { maxAssetBytes: 1024, maxTotalBytes: 4096, mode: 'command' },
  }), /inconsistent metadata/);
  assert.equal(existsSync(target), false);
  rmSync(join(target, '..'), { recursive: true, force: true });
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
