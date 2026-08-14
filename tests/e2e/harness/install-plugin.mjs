// Puts a plugin from THIS registry into a throwaway daemon's data directory, the way the daemon's own
// marketplace does when a user installs it from Settings → Plugins.
//
// The daemon's marketplace does exactly two things after downloading (src/plugins/marketplace.ts): it
// copies the folder into `<dataDir>/plugins/<name>`, and it symlinks the host's `node_modules` next to
// it so the plugin's bare imports (`elowen-plugin-shared`, `jose`, `grammy`, …) resolve against the
// host's dependency tree. This mirrors both steps, so a suite exercises the same on-disk shape a real
// install produces.
//
// It deliberately does NOT go through the marketplace HTTP route: that would test GitHub availability and
// the network, not the plugin. Installing from disk keeps the scenario about the plugin's own behaviour.
//
// THE SHADOWING PROBLEM. The daemon under test is a published `elowen` release, and a release made
// BEFORE a plugin moved here still bundles its own copy of it. The daemon scans the bundled dir first
// and the first occurrence of a name wins (src/plugins/loader.ts — `discoverPlugins`), so that stale
// bundled copy silently shadows the one under test: the scenario passes while exercising code from npm.
// Proven the blunt way — a `throw` appended to this registry's cronjob entry, and the cron E2E still
// went green. So installing is not enough; the host has to be stripped of what this registry owns.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const registryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Plugin folders this registry owns — read from disk, so a newly adopted plugin is covered at once. */
function registryPluginNames() {
  return readdirSync(join(registryRoot, 'plugins'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(registryRoot, 'plugins', e.name, 'elowen-plugin.json')))
    .map((e) => e.name);
}

/**
 * Remove from the installed `elowen` package every bundled plugin this registry owns, so nothing can
 * shadow the copy under test. Idempotent, and safe to call from every suite: it only ever deletes a
 * folder this repository is the source of truth for, and `npm ci` restores the package anyway.
 *
 * @returns {string[]} The plugin names actually stripped (empty once the host stops bundling them).
 */
export function stripShadowingPlugins() {
  const bundledDir = join(registryRoot, 'node_modules', 'elowen', 'dist', 'plugins');
  if (!existsSync(bundledDir)) throw new Error(`stripShadowingPlugins: no bundled plugin dir at ${bundledDir}`);
  const stripped = [];
  for (const name of registryPluginNames()) {
    const shadow = join(bundledDir, name);
    if (!existsSync(shadow)) continue;
    rmSync(shadow, { recursive: true, force: true });
    stripped.push(name);
  }
  return stripped;
}

/**
 * Install one of this registry's plugins into a daemon data dir. Call it from `spawnRealDaemon`'s
 * `prepareDataDir` hook, i.e. after the temp dirs exist and before the daemon's first boot — a plugin
 * that appears later is not discovered until something triggers a registry reload.
 *
 * Strips the shadowing bundled copies first, so what boots is what this repository contains.
 *
 * @param {string} dataDir  The daemon's data directory (the harness hands this to prepareDataDir).
 * @param {string} name     Plugin folder name under this registry's `plugins/`.
 * @returns {string} The installed plugin directory.
 */
export function installRegistryPlugin(dataDir, name) {
  const source = join(registryRoot, 'plugins', name);
  if (!existsSync(join(source, 'elowen-plugin.json'))) {
    throw new Error(`installRegistryPlugin: no plugin named "${name}" in this registry (${source})`);
  }
  stripShadowingPlugins();

  const target = join(dataDir, 'plugins', name);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });

  // The host modules the plugin imports by bare specifier. The daemon symlinks its OWN node_modules here;
  // the registry's tree is the equivalent, because it carries `elowen` (and therefore its dependencies)
  // plus whatever a plugin needs to run.
  const hostModules = join(registryRoot, 'node_modules');
  const link = join(target, 'node_modules');
  if (!existsSync(link)) symlinkSync(hostModules, link, 'dir');
  return target;
}

/**
 * Assert, from a running daemon, that the plugin it loaded is THIS registry's copy and not a bundled
 * one. Call it inside a scenario after login: `source: 'user'` is the daemon's own word for "came from
 * the data dir". Without this a future release that re-bundles a name would put the suites straight
 * back to testing npm.
 *
 * @param {(method: string, path: string) => Promise<{status: number, text: string}>} http  Suite's HTTP helper.
 * @param {string} name  Plugin name.
 */
export async function assertLoadedFromRegistry(http, name) {
  const res = await http('GET', '/plugins');
  if (res.status !== 200) throw new Error(`assertLoadedFromRegistry: GET /plugins → ${res.status}`);
  const entry = JSON.parse(res.text).find((p) => p.name === name);
  if (!entry) throw new Error(`assertLoadedFromRegistry: the daemon does not list "${name}" at all`);
  if (entry.source !== 'user') {
    throw new Error(
      `assertLoadedFromRegistry: "${name}" loaded from '${entry.source}', not this registry — a bundled `
      + 'copy in the published elowen package is shadowing it, so this suite is testing npm.',
    );
  }
}
