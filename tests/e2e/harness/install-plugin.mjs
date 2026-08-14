// Puts a plugin from THIS registry into a throwaway daemon's data directory, the way the daemon's own
// marketplace does when a user installs it from Settings → Plugins.
//
// Why this exists: the daemon under test is the published `elowen` package, which no longer bundles the
// plugins kept here — so an E2E scenario has to supply the plugin itself. The daemon's marketplace does
// exactly two things after downloading (src/plugins/marketplace.ts): it copies the folder into
// `<dataDir>/plugins/<name>`, and it symlinks the host's `node_modules` next to it so the plugin's bare
// imports (`elowen-plugin-shared`, `jose`, `grammy`, …) resolve against the host's dependency tree. This
// mirrors both steps, so a suite exercises the same on-disk shape a real install produces.
//
// It deliberately does NOT go through the marketplace HTTP route: that would test GitHub availability and
// the network, not the plugin. Installing from disk keeps the scenario about the plugin's own behaviour.

import { cpSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const registryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Install one of this registry's plugins into a daemon data dir. Call it from `spawnRealDaemon`'s
 * `prepareDataDir` hook, i.e. after the temp dirs exist and before the daemon's first boot — a plugin
 * that appears later is not discovered until something triggers a registry reload.
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
