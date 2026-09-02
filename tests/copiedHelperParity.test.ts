// @vitest-environment node
/** Parity for the daemon helpers a plugin carries its OWN copy of.
 *
 *  A plugin may take only TYPES from core, so any core helper it needs at RUNTIME it copies into its
 *  own tree. The copy then has to be held in step by hand. The daemon used to own a test that scanned
 *  every plugin's `src` tree and pinned these copies; it was deleted along with the four plugins that
 *  moved into this registry, and for those four nothing replaced it. That test's own comment recorded
 *  the failure it was written for: a change narrowed a hex-shape regex to `{7,64}`, which still
 *  accepted every FULL hash, so nothing looked broken while every abbreviated hash the UI passes
 *  through silently stopped resolving. `gitSha` below is exactly that helper.
 *
 *  Source text cannot be compared across the repo boundary — the daemon's npm package publishes
 *  `dist/`, not `src/` — so this pins BEHAVIOUR against the built checkout named by
 *  ELOWEN_CORE_ROOT. Requiring the root explicitly prevents a developer's sibling checkout or stale
 *  installed package from silently becoming the comparison target.
 *  Behavioural equivalence is what survives TypeScript compilation and what actually breaks a user.
 *
 *  The copies are DISCOVERED, not hand-listed, so one added tomorrow is covered the moment it exists
 *  rather than when someone remembers to write its test. A plugin file counts as a copy of a core
 *  `shared/<name>` module when it sits at the same basename AND exports exactly the expected names.
 *  A narrowly pinned forward-export set lets the registry ship before the corresponding core release;
 *  once core catches up, the same expected set collapses back to exact core parity automatically.
 *  Plugins also keep smaller same-named helpers of their own (clock, logger, text, time, paths) that
 *  were never copies; those export a narrower surface, which is what tells the two apart.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';


const root = fileURLToPath(new URL('..', import.meta.url));
const configuredCoreRoot = process.env.ELOWEN_CORE_ROOT?.trim();
if (!configuredCoreRoot) {
  throw new Error('[copied-helper-parity] ELOWEN_CORE_ROOT must point to the authoritative built core checkout');
}
const coreRoot = resolve(configuredCoreRoot);
const coreSharedDir = join(coreRoot, 'dist', 'shared');
const coreUiKitTypesPath = join(coreRoot, 'packages/plugin-ui-kit/index.d.ts');
if (!existsSync(join(coreSharedDir, 'execs.js')) || !existsSync(coreUiKitTypesPath)) {
  throw new Error(`[copied-helper-parity] ELOWEN_CORE_ROOT lacks built shared helpers or ui-kit sources: ${coreRoot}`);
}
if (!/PLUGIN_UI_API_VERSION:\s*13\b/.test(readFileSync(coreUiKitTypesPath, 'utf8'))) {
  throw new Error(`[copied-helper-parity] ELOWEN_CORE_ROOT does not expose plugin UI API 13: ${coreRoot}`);
}
console.info(`[copied-helper-parity] core source: ELOWEN_CORE_ROOT (${coreRoot})`);

/** Ids of the copies this file pins behaviourally. The discovery scan below asserts this list is
 *  exactly what it found, so a NEW copy fails the suite until someone adds cases for it here.
 *
 *  EMPTY ON PURPOSE. Every copy this file used to pin belonged to `agents` or `work`, and both plugins
 *  are gone — no plugin in this registry carries a copy of a core helper today. What survives is the
 *  scan, and the guard is now the empty set: the first plugin to copy a core helper in fails the check
 *  below and has to be pinned deliberately, which is the failure this file existed to catch all along.
 *  Deleting the file instead would have removed the guard along with the copies it happened to hold. */
const PINNED: readonly string[] = [];

/** The registry can be released before core, so a copy may legitimately carry an export the installed
 *  core does not have yet; unioning those with core's exports keeps the comparison an exact set on both
 *  sides of a release. Empty while nothing is pinned. */
const FORWARD_EXPORTS: Readonly<Record<string, readonly string[]>> = {};

type Candidate = {
  id: string;
  srcRel: string;
  distRel: string;
  pluginExports: string[];
  coreExports: string[];
  isCopy: boolean;
};

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const coreModules = new Set(
  readdirSync(coreSharedDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.slice(0, -'.js'.length)),
);

const pluginsDir = join(root, 'plugins');
const candidates: Candidate[] = [];
/** A plugin source with no compiled twin — it would silently drop out of the scan, so it is asserted
 *  empty rather than ignored. */
const unbuilt: string[] = [];

for (const plugin of readdirSync(pluginsDir, { withFileTypes: true })) {
  if (!plugin.isDirectory()) continue;
  const srcDir = join(pluginsDir, plugin.name, 'src');
  if (!existsSync(srcDir)) continue;
  for (const srcPath of walkTs(srcDir)) {
    const moduleName = basename(srcPath, '.ts');
    if (!coreModules.has(moduleName)) continue;
    const srcRel = srcPath.slice(root.length);
    const distPath = srcPath.replace(`${plugin.name}/src/`, `${plugin.name}/dist/`).replace(/\.ts$/, '.js');
    if (!existsSync(distPath)) {
      unbuilt.push(srcRel);
      continue;
    }
    const id = `${plugin.name}/${moduleName}`;
    const pluginExports = Object.keys(await import(pathToFileURL(distPath).href)).sort();
    const coreExports = Object.keys(await import(pathToFileURL(join(coreSharedDir, `${moduleName}.js`)).href)).sort();
    const expectedExports = [...new Set([...coreExports, ...(FORWARD_EXPORTS[id] ?? [])])].sort();
    candidates.push({
      id,
      srcRel,
      distRel: distPath.slice(root.length),
      pluginExports,
      coreExports,
      isCopy:
        pluginExports.length === expectedExports.length &&
        pluginExports.every((name, i) => name === expectedExports[i]),
    });
  }
}

const copies = candidates.filter((c) => c.isCopy).map((c) => c.id).sort();

describe('the scan that finds helpers copied out of core', () => {
  it('still has both sides to compare', () => {
    // Without a floor the whole file would pass forever the day the scan breaks — a renamed folder, a
    // moved dist layout — and report nothing while checking nothing.
    //
    // The CORE side keeps a real floor: those helpers exist regardless of which plugins are installed,
    // so a zero here means the scan failed to resolve core rather than that there is nothing to find.
    // The PLUGIN side deliberately has none any more. Every copy used to live in `agents` or `work`, and
    // with both gone the honest count is one candidate and zero copies — a floor over that would just be
    // a number nobody could satisfy, and raising it back is a job for whoever adds the next copy.
    expect(coreModules.size).toBeGreaterThanOrEqual(26);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
  });

  it('could resolve a compiled twin for every candidate it saw', () => {
    // A copy whose dist is missing would drop out of the scan silently and stop being compared.
    expect(unbuilt).toEqual([]);
  });

  it('pins every copy it discovered', () => {
    // The failure this catches: a plugin copies another core helper in, and nobody writes cases for it.
    // Adding a copy therefore has to be a deliberate edit to PINNED plus a case table below.
    expect(copies).toEqual(PINNED);
  });
});
