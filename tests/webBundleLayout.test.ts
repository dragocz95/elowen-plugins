// @vitest-environment node
/** A committed browser bundle must be the one a clean checkout produces.
 *
 *  esbuild labels each bundled module with its path relative to the build directory. Under the `npm ci`
 *  CI runs, every dependency sits inside the checkout, so every label is repo-relative. A bundle built in
 *  a working copy whose `node_modules` points at a sibling checkout instead records paths that climb out
 *  of the repo, and that artifact is what the marketplace ships, because a plugin is installed by copying
 *  files and nothing is ever compiled on the way. `check:web` catches it, but only after a full rebuild
 *  in CI; this reads the committed bytes directly and names the cause. */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const pluginsDir = join(import.meta.dirname, '..', 'plugins');
const bundles = readdirSync(pluginsDir)
  .map((name) => ({ name, path: join(pluginsDir, name, 'web', 'index.js') }))
  .filter((entry) => existsSync(entry.path));

describe('committed web bundles', () => {
  it('found bundles to check', () => {
    // Without this the assertion below would pass by iterating over nothing.
    expect(bundles.length).toBeGreaterThan(0);
  });

  it.each(bundles.map((entry) => entry.name))('%s resolves every module inside the checkout', (name) => {
    const source = readFileSync(bundles.find((entry) => entry.name === name)!.path, 'utf8');
    const escaping = [...source.matchAll(/\.\.(?:\/[^\s"'`]*)*\/node_modules\/[^\s"'`]*/g)].map((match) => match[0]);
    expect(
      [...new Set(escaping)],
      `${name}/web/index.js was built where node_modules lives outside the checkout, so it is not the bundle `
      + 'a clean `npm ci` produces. Rebuild it with `node scripts/build-web.mjs` in a checkout that owns its '
      + 'own node_modules.',
    ).toEqual([]);
  });
});
