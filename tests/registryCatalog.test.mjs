import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `registry.json` is the catalog a daemon reads to decide what it may install: a name absent from it
 *  cannot be installed at all, and the version shown there is what the UI offers as an update.
 *
 *  Two plugins carried a hand-written version-parity check and fourteen did not, so a manifest bumped
 *  without touching the catalog — or a plugin folder added without listing it — drifted silently
 *  everywhere else. This walks BOTH directions over every plugin instead, so a new one is covered the
 *  moment it exists rather than when someone remembers to write its test.
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const pluginsDir = join(root, 'plugins');

const catalog = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const folders = readdirSync(pluginsDir)
  .filter((name) => statSync(join(pluginsDir, name)).isDirectory())
  .filter((name) => existsSync(join(pluginsDir, name, 'elowen-plugin.json')));

const manifestOf = (name) =>
  JSON.parse(readFileSync(join(pluginsDir, name, 'elowen-plugin.json'), 'utf8'));

test('the catalog and the plugin folders are read from disk, not assumed', () => {
  // Both sides feed every assertion below; if either came back empty the whole file would pass while
  // checking nothing.
  assert.ok(folders.length > 10, `expected the registry to hold plugins, found ${folders.length}`);
  assert.ok(catalog.plugins.length > 10, `expected a populated catalog, found ${catalog.plugins.length}`);
});

test('every plugin folder is listed in the catalog', () => {
  // A folder missing from the catalog is invisible: the marketplace refuses to install a name it does
  // not list, so the plugin exists in git and reaches nobody.
  const listed = new Set(catalog.plugins.map((p) => p.name));
  const unlisted = folders.filter((name) => !listed.has(name));
  assert.deepEqual(unlisted, [], `plugin folders absent from registry.json: ${unlisted.join(', ')}`);
});

test('every catalog entry has a plugin folder behind it', () => {
  // The opposite failure: the catalog offers a name, the user clicks install, and the copy step fails
  // with a 502 because there is no payload in the repo.
  const present = new Set(folders);
  const dangling = catalog.plugins.map((p) => p.name).filter((name) => !present.has(name));
  assert.deepEqual(dangling, [], `catalog entries with no plugins/<name>/ folder: ${dangling.join(', ')}`);
});

for (const name of folders) {
  test(`${name}: catalog version and apiVersion match its manifest`, () => {
    const manifest = manifestOf(name);
    const entry = catalog.plugins.find((p) => p.name === name);
    assert.ok(entry, `${name} is not in registry.json`);
    // The catalog version drives the "update available" badge. When it lags the manifest, an installed
    // user is told they are current while the repo already holds a newer build.
    assert.equal(entry.version, manifest.version, `${name}: catalog says ${entry.version}, manifest says ${manifest.version}`);
    assert.equal(entry.apiVersion, manifest.apiVersion, `${name}: catalog apiVersion disagrees with the manifest`);
  });

  test(`${name}: the entry point named by its manifest exists`, () => {
    // The daemon imports exactly this path after copying the folder, and the marketplace refuses an
    // install whose entry is missing. For a compiled plugin this is also what proves the built output
    // was committed and not just produced locally.
    const manifest = manifestOf(name);
    assert.ok(manifest.entry, `${name}: manifest has no entry`);
    const entryPath = join(pluginsDir, name, manifest.entry);
    assert.ok(existsSync(entryPath), `${name}: entry "${manifest.entry}" does not exist in the repo`);
  });

  test(`${name}: its entry point is committed, not just present on disk`, () => {
    // A daemon installs by `git clone --depth 1` and copies the tree, so it only ever sees COMMITTED
    // files. Existence on disk proves nothing: a compiled plugin whose dist/ was built locally but
    // never added would pass every other check here and fail at install time with "entry not found".
    //
    // `npm run check:dist` cannot catch this either — it compares with `git diff`, which is blind to
    // untracked files.
    const manifest = manifestOf(name);
    const relative = join('plugins', name, manifest.entry);
    const tracked = execFileSync('git', ['ls-files', '--', relative], { cwd: root, encoding: 'utf8' }).trim();
    assert.notEqual(tracked, '', `${name}: entry "${manifest.entry}" is not tracked by git — it would be missing from a clone`);
  });
}
