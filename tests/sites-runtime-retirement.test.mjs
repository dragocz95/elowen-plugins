import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
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
    // The file-publication copier went with the model it served: a Site is an application inside a managed
    // Project, so nothing copies a build output into a release any more, in either transport.
    'publish', 'managedPublish',
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
