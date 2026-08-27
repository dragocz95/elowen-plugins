// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { satisfies } from 'semver';
import { describe, expect, it } from 'vitest';

/** Does every plugin here actually LOAD against the daemon's dependency tree?
 *
 *  The Elowen package holds a list of packages it keeps in `dependencies` purely for the plugins that
 *  live here (tests/contract/registryPluginDependencies.test.ts). That list asserts a NAME is declared —
 *  which says nothing about whether the plugin still imports cleanly. A major bump of `baileys` or
 *  `grammy`, a helper dropped from `elowen-plugin-shared`'s exports, or a new bare import added here and
 *  never mirrored into the daemon: all three leave that list green and break the plugin at import time
 *  on every instance that has it enabled.
 *
 *  This measures the behaviour instead of the name. An installed plugin resolves its bare specifiers
 *  through the DAEMON's node_modules (the marketplace symlinks them next to the plugin), so the honest
 *  question is "does importing this file succeed with only what the daemon ships?" — asked here by
 *  importing each entry for real and resolving each bare specifier against the installed elowen package.
 */
const registryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The daemon package under test, and the dependency set an installed plugin can actually reach. */
const daemonPkg = JSON.parse(
  readFileSync(join(registryRoot, 'node_modules', 'elowen', 'package.json'), 'utf-8'),
) as { version: string; dependencies: Record<string, string> };

const plugins = readdirSync(join(registryRoot, 'plugins'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(registryRoot, 'plugins', e.name, 'elowen-plugin.json')))
  .map((e) => e.name);

/** Bare specifiers (not relative, not node: builtins) imported anywhere under a plugin's own files. */
function bareImports(pluginDir: string): string[] {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // `web`/`web-src` are the BROWSER bundle: esbuild inlines react and friends at build time, so its
      // imports are never resolved by the daemon and are not runtime dependencies of the plugin.
      if (entry.name === 'node_modules' || entry.name === 'web' || entry.name === 'web-src') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!/\.(mjs|js|ts|tsx)$/.test(entry.name)) continue;
      const source = readFileSync(path, 'utf-8');
      // Match import SYNTAX, not any quoted string that happens to follow the word "from". A doc
      // comment reading `tell "subsystem off" from "no such endpoint"` is ordinary English, and a
      // looser pattern reported it as a missing dependency called "no such endpoint".
      //
      // A static import/export is a top-level statement, so it is anchored to the start of a line;
      // `[^;'"]*?` keeps a multi-line `{ A, B }` clause in while stopping the match from running past
      // the end of the statement. Dynamic import() and require() can appear anywhere, so they are
      // matched on their call shape instead.
      const patterns = [
        /^\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm,
        /^\s*import\s+['"]([^'"]+)['"]/gm,
        /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
        /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
      ];
      for (const pattern of patterns) {
        for (const m of source.matchAll(pattern)) {
          const spec = m[1]!;
          if (spec.startsWith('node:') || spec.startsWith('.')) continue;
          found.add(spec);
        }
      }
    }
  };
  walk(pluginDir);
  return [...found].sort();
}

/** `@scope/name/sub` → `@scope/name`; `pkg/sub` → `pkg`. */
const packageOf = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!);

describe('every plugin imports cleanly against the daemon it will run inside', () => {
  it('reads a real plugin set and a real daemon', () => {
    // Both sides of every assertion below come from disk; if either read empty the suite would pass
    // while proving nothing at all.
    expect(plugins.length).toBeGreaterThan(5);
    expect(Object.keys(daemonPkg.dependencies).length).toBeGreaterThan(10);
  });

  it.each(plugins)('%s imports without an unresolved specifier', async (name) => {
    const dir = join(registryRoot, 'plugins', name);
    // The manifest field is `entry` — there is no `main`. Reading the wrong name fell through to the
    // `index.mjs` default, which happens to be right for every plugin here TODAY, so the suite passed
    // while never actually following a manifest. A plugin whose entry is anything else (a compiled
    // `dist/index.js`, say) would have been imported from a path that does not exist.
    const manifest = JSON.parse(readFileSync(join(dir, 'elowen-plugin.json'), 'utf-8')) as { entry?: string };
    expect(manifest.entry, `${name} has no entry in its manifest`).toBeTruthy();
    const entry = join(dir, manifest.entry!);
    // The import is the assertion: a missing dependency, a dropped subpath export or a breaking major
    // all surface here as a real resolution error rather than as a passing name check.
    await expect(import(entry)).resolves.toBeDefined();
  });

  it.each(plugins)('%s only imports packages the daemon actually declares', (name) => {
    const specs = bareImports(join(registryRoot, 'plugins', name));
    const missing = specs
      .map(packageOf)
      // The daemon's own package name appears when a test helper reaches into it; that is not a plugin
      // runtime dependency and never travels with an install.
      .filter((pkg) => pkg !== 'elowen')
      .filter((pkg) => !(pkg in daemonPkg.dependencies));
    expect(missing, `${name} imports packages elowen@${daemonPkg.version} does not ship: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('tests each plugin dependency at the version the daemon actually ships', () => {
    // The version installed HERE is what every suite runs against; the range the daemon declares is what
    // production resolves. When they disagree, green tests say nothing about the daemon people run —
    // this repo tested whatsapp against baileys rc14 while the daemon shipped rc13, on the most fragile
    // protocol client in the set.
    const imported = new Set(plugins.flatMap((name) => bareImports(join(registryRoot, 'plugins', name)).map(packageOf)));
    const mismatched: string[] = [];
    for (const pkg of [...imported].sort()) {
      const declared = daemonPkg.dependencies[pkg];
      if (!declared) continue; // covered by the assertion above
      const installedPath = join(registryRoot, 'node_modules', pkg, 'package.json');
      if (!existsSync(installedPath)) continue; // covered by the resolution assertion below
      const installed = (JSON.parse(readFileSync(installedPath, 'utf-8')) as { version: string }).version;
      if (!satisfies(installed, declared)) mismatched.push(`${pkg}@${installed} vs daemon's "${declared}"`);
    }
    expect(mismatched, `tested against versions the daemon would not resolve: ${mismatched.join('; ')}`)
      .toEqual([]);
  });

  it.each(plugins)('%s resolves every bare specifier it imports, subpath included', (name) => {
    const dir = join(registryRoot, 'plugins', name);
    const unresolved: string[] = [];
    for (const spec of bareImports(dir)) {
      // ESM resolution, not require.resolve: a package whose `exports` map has no '.' entry resolves
      // fine for an `import` and throws ERR_PACKAGE_PATH_NOT_EXPORTED for a require — measuring it the
      // CJS way would report working plugins as broken.
      //
      // Subpath exports are the sharp edge this catches: `elowen-plugin-shared/help` can vanish from the
      // package's `exports` map while the package itself stays installed and every name check stays green.
      try { import.meta.resolve(spec); } catch { unresolved.push(spec); }
    }
    expect(unresolved, `${name} has unresolvable imports: ${unresolved.join(', ')}`).toEqual([]);
  });
});
