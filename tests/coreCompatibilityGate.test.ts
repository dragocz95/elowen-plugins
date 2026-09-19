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
const configuredCoreRoot = process.env.ELOWEN_CORE_ROOT?.trim();
const candidatePackage = configuredCoreRoot ? join(configuredCoreRoot, 'package.json') : require_.resolve('elowen/package.json');
const candidateVersion = JSON.parse(readFileSync(candidatePackage, 'utf8')).version as string;

/** The last core published without the environment control. Anything that consumes one must refuse here. */
const BASELINE_WITHOUT_ENVIRONMENTS = '0.28.34';

/** Exactly the control methods a managed environment provides. A plugin naming any of them needs a core
 *  that has them, so this list is the evidence for which manifests must carry the floor. */
const ENVIRONMENT_METHODS = [
  'environmentFor', 'requestEnvironment', 'environmentOperation', 'projectFiles', 'revokeProjectAccess',
  'environmentSnapshots', 'environmentLogs', 'managedWorktrees', 'projectPreviewBinding',
];

/** The last core published without the per-step context seam (`ctx.registerStepContext`). A provider
 *  registered there runs mid-turn, after the last tool result; on an older core the method simply does not
 *  exist on `ctx`. */
const BASELINE_WITHOUT_STEP_CONTEXT = '0.28.46';

/** The seam itself. One method today, named separately from the environment control because the floor each
 *  one implies is a different release, and a plugin may consume either without the other. */
const STEP_CONTEXT_METHODS = ['registerStepContext'];

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

const stepContextConsumers = names.filter((name) => {
  const source = sourceOf(name);
  return STEP_CONTEXT_METHODS.some((method) => source.includes(`${method}(`) || source.includes(`.${method}`));
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

/** The same gate for the per-step context seam.
 *
 *  The environment assertions above prove the mechanism, not this floor: a plugin can consume a mid-turn
 *  provider without touching any environment control, and the release that added the seam is a different
 *  number. The todo plugin registers one, so its floor has to sit above every core that lacks it — enforced
 *  here rather than remembered, because the failure mode is silent: the plugin installs, `register()` throws
 *  on the missing method, and the loader reports only "plugin skipped". */
describe('requiresCore gate for the per-step context seam', () => {
  it('found the step-context consumers to gate', () => {
    // Same reason as the environment list: if this empties, every assertion below passes while covering
    // nothing, and the floor rots back into memory.
    expect(stepContextConsumers.length).toBeGreaterThan(0);
    expect(stepContextConsumers).toContain('todo');
    // A turn-context provider is the once-per-turn sibling and shares a prefix with the seam, so the plugin
    // that registers one must not be dragged above a core it runs on perfectly well.
    expect(stepContextConsumers).not.toContain('lsp');
  });

  it.each(stepContextConsumers)('%s declares a floor no core without the seam satisfies', (name) => {
    const manifest = manifestOf(name);
    expect(manifest.requiresCore, `${name} registers step context and declares no requiresCore`).toBeTruthy();
    expect(isNewer(manifest.requiresCore!, BASELINE_WITHOUT_STEP_CONTEXT), `${name} would install on ${BASELINE_WITHOUT_STEP_CONTEXT}`).toBe(true);
  });

  it('is running against a candidate that carries the seam', () => {
    expect(isNewer(candidateVersion, BASELINE_WITHOUT_STEP_CONTEXT), `the candidate is ${candidateVersion}, which has no registerStepContext`).toBe(true);
  });
});

/** The apiVersion 2 floor, and the reason it needs its own gate rather than trusting `apiVersion` alone.
 *
 *  `parseManifest` matches `apiVersion` exactly, so an API-1 core does refuse an API-2 plugin. But it
 *  refuses it in the WRONG PLACE: `validateStaging` parses the manifest (marketplace.ts:790) before it
 *  reaches the `requiresCore` gate (:797), so the user gets `unsupported plugin apiVersion "2"
 *  (need "1")` — a sentence that does not even name a version to upgrade to — instead of the actionable
 *  `needs Elowen X or newer, update Elowen first` that the floor exists to produce. On the daemon's own
 *  load path it is worse: `discoverPlugins` swallows the parse failure with an empty catch, so the plugin
 *  vanishes from the installed inventory with no log line at all.
 *
 *  Every plugin in this registry declares apiVersion 2, so every floor must sit above the last core that
 *  speaks apiVersion 1. That is what keeps the two statements telling the same story. */
const BASELINE_WITHOUT_API_2 = '0.28.49';

describe('requiresCore gate for the plugin API 2 contract', () => {
  it('found the manifests to gate', () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(names)('%s declares a floor no apiVersion 1 core satisfies', (name) => {
    const manifest = manifestOf(name) as { requiresCore?: string; apiVersion?: string };
    expect(manifest.requiresCore, `${name} declares no requiresCore`).toBeTruthy();
    expect(
      isNewer(manifest.requiresCore!, BASELINE_WITHOUT_API_2),
      `${name} would pass the marketplace gate on ${BASELINE_WITHOUT_API_2}, which speaks apiVersion 1`,
    ).toBe(true);
  });

  it('is running against a candidate that speaks apiVersion 2', () => {
    expect(
      isNewer(candidateVersion, BASELINE_WITHOUT_API_2),
      `the candidate is ${candidateVersion}, which is not above the last apiVersion 1 core`,
    ).toBe(true);
  });
});
