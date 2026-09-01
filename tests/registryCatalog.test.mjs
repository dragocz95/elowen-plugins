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

/** The grant set a user is asked to approve at install time.
 *
 *  `capabilities` is not documentation: the daemon shows it on the install prompt and holds the plugin
 *  to it, so it is the difference between an extension that reads the task store and one that also
 *  reaches the network, the git checkout and the user's tmux. The daemon used to carry a skeleton test
 *  pinning the agents plugin's set; it was deleted along with the plugin, and the checks above cover
 *  only version, apiVersion and entry. A plugin could therefore widen what it asks for and every test
 *  in this repo would stay green.
 *
 *  Pinned as an expected list so widening one is a deliberate edit here — reviewable as the privilege
 *  change it is — rather than a line that slips through inside an unrelated manifest bump. Arrays are
 *  compared as sets: reordering is not a grant change, adding or removing an entry is.
 */
const EXPECTED_CAPABILITIES = {
  codebase: { reads: ['embeddings'], network: true },
  cronjob: { reads: ['stores'] },
  editor: { reads: ['project-files', 'stores'] },
  github: { reads: ['controls', 'db', 'git', 'stores'], network: true },
  // EditImage downloads an optional public source and sends image bytes to the configured Images API.
  'image-edit': { network: true },
  lsp: { network: true },
  // MCP persists server ownership/tool discovery in its DB and connects to remote HTTP/SSE endpoints.
  // stdio execution remains separately restricted to instance administrators by the plugin itself.
  mcp: { reads: ['db'], network: true },
  msteams: { reads: ['project-files', 'stores'], mutates: ['users'] },
  // Reads only, and each one is load-bearing: `controls` reaches the Microsoft identity and the
  // account-explicit sandbox lookup, `stores` re-checks project tenancy outside a request, `db` holds the
  // mirror baseline. No `mutates`: the files it writes are the ones a person asked it to mirror, and it
  // never reaches into another plugin's domain.
  onedrive: { reads: ['controls', 'db', 'project-files', 'stores'], network: true },
  // Reads only, and each one decides who may open a published page: `stores` answers "does this account
  // still exist, is it an administrator, may it still see this Project" on EVERY request to a site,
  // because a site session proves identity and never permission; `db` holds the sites and their guest
  // lists; `controls` finds the account's active Sandbox workspace so a new site lands in a real Git
  // worktree. No `network` and no `mutates`: this release publishes files that are already on disk and
  // runs nothing of its own beyond a runtime an administrator turned on. `network` is that runtime:
  // requests are forwarded to a process on a loopback socket, which is network activity even though it
  // never leaves the machine.
  sites: { reads: ['controls', 'db', 'stores'], network: true },
  // `controls` is the host-owned live catalog: SkillLoad must resolve the exact grant/owner-filtered set
  // announced to this turn instead of reopening only the skills plugin's own files.
  skills: { reads: ['controls', 'stores'] },
  todo: { reads: ['db'] },
  // `network` is the whole point — it dials a telephone through an HTTP service — and `db` is what makes
  // the hourly call limit survive a restart, which is the only thing standing between a repeating agent
  // and somebody's ringing phone. Nothing else: it reads no project files and touches no other plugin's
  // domain. Anything added here widens what the agent can do with a real phone line, so weigh it as that.
  'voice-bot': { reads: ['db'], network: true },
};

const normalizeCapabilities = (capabilities) =>
  Object.fromEntries(
    Object.entries(capabilities).map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value]),
  );

test('every plugin that asks for capabilities is pinned', () => {
  // Both directions. A plugin that GAINS a capabilities block is the interesting case: it would be
  // granted whatever it declares, unpinned, because no expectation below names it. Eight of the fifteen
  // plugins declare one today.
  const declaring = folders.filter((name) => manifestOf(name).capabilities).sort();
  assert.ok(declaring.length >= 8, `expected the manifests to declare capabilities, found ${declaring.length}`);
  assert.deepEqual(
    declaring,
    Object.keys(EXPECTED_CAPABILITIES).sort(),
    'a plugin gained or lost its capabilities block — pin the new grant set in EXPECTED_CAPABILITIES',
  );
});

for (const [name, expected] of Object.entries(EXPECTED_CAPABILITIES)) {
  test(`${name}: its declared capabilities are exactly the approved grant set`, () => {
    const { capabilities } = manifestOf(name);
    assert.ok(capabilities, `${name}: manifest no longer declares capabilities`);
    assert.deepEqual(
      normalizeCapabilities(capabilities),
      normalizeCapabilities(expected),
      `${name}: the install-time grant set changed — approve it here if it is intended`,
    );
  });
}

// A manifest that DECLARES a control it never registers is a lie the daemon now acts on: the dependency
// gate would accept a provider that publishes nothing, and the consumer would enable into silence.
for (const name of folders) {
  const declared = manifestOf(name).provides?.controls ?? [];
  if (declared.length === 0) continue;
  test(`${name}: registers every control it declares`, () => {
    const dir = join(pluginsDir, name);
    const sources = [];
    const collect = (path) => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const full = join(path, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') collect(full); continue; }
        if (/\.(mjs|js|ts)$/.test(entry.name)) sources.push(readFileSync(full, 'utf8'));
      }
    };
    collect(dir);
    const source = sources.join('\n');
    for (const key of declared) {
      assert.ok(
        source.includes(`registerControl('${key}'`) || source.includes(`registerControl("${key}"`),
        `${name} declares control ${key} but never registers it`,
      );
    }
  });
}

for (const name of folders) {
  const required = manifestOf(name).requiresControls ?? [];
  if (required.length === 0) continue;
  test(`${name}: something in this registry provides the controls it requires`, () => {
    // The daemon refuses to enable a plugin whose required control nothing publishes. A dependency on a
    // key no plugin here provides is therefore a plugin that can never be switched on.
    const provided = new Set(folders.flatMap((other) => manifestOf(other).provides?.controls ?? []));
    const orphaned = required.filter((key) => !provided.has(key));
    assert.deepEqual(orphaned, [], `${name} requires controls nothing in this registry provides: ${orphaned.join(', ')}`);
  });
}
