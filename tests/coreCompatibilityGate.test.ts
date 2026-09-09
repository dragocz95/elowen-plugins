// @vitest-environment node
/** The install-time `requiresCore` gate, driven over the REAL manifests with the SDK's own comparison.
 *
 *  A plugin that reaches a managed project through the Sandbox environment control cannot run on a core
 *  that has no such control: it installs happily and then throws inside `register(ctx)` on the first
 *  missing method, which the loader swallows as "plugin skipped". The manifest gate is what turns that
 *  into a refusal the user can read, so what matters is that the declared floor is actually above every
 *  released core and actually satisfied by this candidate. Asserting the imports alone would prove
 *  neither. */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { isNewer } from 'elowen/dist/cli/version.js';
import { parseManifest } from 'elowen/dist/plugins/manifest.js';

const require_ = createRequire(import.meta.url);
const candidateVersion = JSON.parse(readFileSync(require_.resolve('elowen/package.json'), 'utf8')).version as string;

/** The last core published without the environment control. Anything that consumes one must refuse here. */
const BASELINE_WITHOUT_ENVIRONMENTS = '0.28.34';

/** Exactly the control methods a managed environment provides. A plugin naming any of them needs a core
 *  that has them, so this list is the evidence for which manifests must carry the floor. */
const ENVIRONMENT_METHODS = [
  'environmentFor', 'requestEnvironment', 'environmentOperation', 'projectFiles', 'revokeProjectAccess',
  'environmentSnapshots', 'environmentLogs', 'managedWorktrees', 'projectPreviewBinding',
];

const pluginsDir = join(import.meta.dirname, '..', 'plugins');
const names = readdirSync(pluginsDir).filter((name) => existsSync(join(pluginsDir, name, 'elowen-plugin.json')));
const manifestOf = (name: string) =>
  parseManifest(JSON.parse(readFileSync(join(pluginsDir, name, 'elowen-plugin.json'), 'utf8'))) as
    { name: string; requiresCore?: string };

/** Everything the plugin actually ships, minus its own tests and node_modules. */
function sourceOf(name: string): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'web' || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(mjs|js|ts|tsx)$/.test(entry.name)) parts.push(readFileSync(path, 'utf8'));
    }
  };
  walk(join(pluginsDir, name));
  return parts.join('\n');
}

const environmentConsumers = names.filter((name) => {
  // `ctx.host.projectFiles()` is the long-standing host PATH GUARD and shares a name with the environment
  // control's file operation. Matching it would gate plugins that never touch an environment: msteams
  // uses it to validate a download target and runs on any core.
  const source = sourceOf(name).split('host.projectFiles').join('hostPathGuard');
  return ENVIRONMENT_METHODS.some((method) => source.includes(`${method}(`) || source.includes(`.${method}`));
});

describe('requiresCore gate against the built candidate', () => {
  it('found the environment consumers to gate', () => {
    // If this list ever empties the assertions below would pass by covering nothing.
    expect(environmentConsumers.length).toBeGreaterThan(0);
    expect(environmentConsumers).toContain('sites');
    // The host path guard must not be mistaken for the control, or the gate spreads to plugins that
    // would then refuse to install on cores they run on perfectly well.
    expect(environmentConsumers).not.toContain('msteams');
  });

  it.each(environmentConsumers)('%s declares a floor no released core satisfies', (name) => {
    const manifest = manifestOf(name);
    expect(manifest.requiresCore, `${name} consumes an environment and declares no requiresCore`).toBeTruthy();
    // The gate refuses when requiresCore is NEWER than the daemon. On the last core without the control
    // it must refuse, or the plugin installs onto a daemon that cannot run it.
    expect(isNewer(manifest.requiresCore!, BASELINE_WITHOUT_ENVIRONMENTS), `${name} would install on ${BASELINE_WITHOUT_ENVIRONMENTS}`).toBe(true);
  });

  it.each(names)('%s is admitted by this candidate', (name) => {
    const manifest = manifestOf(name);
    // The same expression the marketplace evaluates before copying a plugin folder.
    const refused = Boolean(manifest.requiresCore) && isNewer(manifest.requiresCore!, candidateVersion);
    expect(refused, `${name} needs ${manifest.requiresCore} but the candidate is ${candidateVersion}`).toBe(false);
  });

  it('is running against the candidate rather than a pinned release', () => {
    // The whole point: a pinned older SDK would satisfy the admission assertions while proving nothing
    // about the core this work actually produces.
    expect(isNewer(candidateVersion, BASELINE_WITHOUT_ENVIRONMENTS)).toBe(true);
  });
});
