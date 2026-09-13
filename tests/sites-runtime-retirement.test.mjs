import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshotManagedRelease } from '../plugins/sites/dist/managedPublish.js';
import { SitesStore } from '../plugins/sites/dist/store.js';

test('the shipped Sites surface contains only static and managed Project proxy publication', () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('plugins/sites/elowen-plugin.json', root), 'utf8'));
  assert.deepEqual(manifest.provides.tools, [
    'SiteCreate', 'SitePreview', 'SitePublish', 'SiteGet', 'SiteList', 'SiteUpdate',
    'SiteRollback', 'SiteShare', 'SiteUnshare', 'SiteDelete',
  ]);
  assert.equal(manifest.provides.apiRoutes.includes('conversion'), false);
  assert.equal(manifest.configSchema.some((field) => /environment|runtime|loopback|startTimeout|maxResponse/i.test(field.key)), false);
  assert.equal(Object.keys(manifest.web.strings).some((key) => /runtime|command|php/i.test(key)), false);
  assert.equal('settings' in manifest.web, false);
  for (const file of [
    'environment', 'migration', 'dataSync', 'recipe', 'baseImage', 'conversionImage', 'podman', 'siteRuntimeAuthority',
    'runtime', 'php', 'releaseEnvironment',
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

test('boot preserves retired runtime source_dir as opaque audit data without resolving a Project root', () => {
  const rows = [
    { id: 'legacy-env', runtime: 'environment', source: '/srv/retired/sites/app' },
    { id: 'legacy-command', runtime: 'command', source: '/outside/every/project' },
    { id: 'legacy-php', runtime: 'php', source: '/srv/retired/php' },
  ];
  const db = makeDb((version, handle) => {
    if (version !== 17) return;
    const insert = handle.prepare(`INSERT INTO p_sites_sites (
      id, slug, title, project_id, owner_user_id, source_dir, runtime, status, created_at, updated_at
    ) VALUES (?, ?, 'Retired', 7, 1, ?, ?, 'live', ?, ?)`);
    for (const row of rows) {
      insert.run(row.id, row.id, row.source, row.runtime, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    }
  });
  const store = new SitesStore(db);
  let rootLookups = 0;

  store.migrateSourceReferences(() => { rootLookups += 1; return null; });

  assert.equal(rootLookups, 0);
  assert.deepEqual(
    db.prepare("SELECT id, runtime, source_rel AS sourceRel FROM p_sites_sites WHERE runtime <> 'static' ORDER BY id").all(),
    rows.map((row) => ({ id: row.id, runtime: row.runtime, sourceRel: row.source })).sort((a, b) => a.id.localeCompare(b.id)),
  );
  assert.equal(db.prepare("SELECT 1 FROM pragma_table_info('p_sites_sites') WHERE name = 'source_dir'").get(), undefined);
  assert.deepEqual(store.allSites(), []);
  assert.deepEqual(store.sitesOwnedBy(1), []);
  assert.deepEqual(store.siteIdsOwnedBy(1), [], 'account cleanup must not delete retained audit rows');
  db.prepare("UPDATE p_sites_sites SET status = 'deleting' WHERE id = 'legacy-env'").run();
  assert.deepEqual(store.deletingSites(), [], 'daemon cleanup must not consume a retained audit row');
  for (const row of rows) assert.equal(store.siteById(row.id), null);
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
    limits: { maxAssetBytes: 1024, maxTotalBytes: 4096 },
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
    limits: { maxAssetBytes: 400_000, maxTotalBytes: 500_000 },
  }), /changed during publication/);
  assert.equal(existsSync(target), false);
  rmSync(join(target, '..'), { recursive: true, force: true });
});
