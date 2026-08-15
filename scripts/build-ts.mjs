// Compile every TypeScript plugin in this registry: each one owns a `tsconfig.plugins.<name>.json`
// that extends `tsconfig.base.json` and emits `plugins/<name>/src/**/*.ts` → `plugins/<name>/dist/`.
// This mirrors the daemon repo's `npm run build:ts`, which compiles the same plugins the same way —
// a plugin that moved here must produce the same JavaScript it produced there.
//
// The compiled output is COMMITTED, exactly like the browser bundles: the marketplace installs a plugin
// by cloning this repo and copying files, and never compiles anything. `plugins/<name>/dist/index.js` is
// therefore not a build artefact in the usual sense — it is the file users actually run, and the file
// the manifest's `entry` points at. `npm run check:dist` rebuilds and fails on any difference, so a
// committed build cannot quietly stop matching its source.
//
// Pass a plugin name to build just that one: `node scripts/build-ts.mjs editor`.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv[2];

const configs = readdirSync(root)
  .filter((f) => /^tsconfig\.plugins\..+\.json$/.test(f))
  .filter((f) => !only || f === `tsconfig.plugins.${only}.json`)
  .sort();

if (only && configs.length === 0) {
  throw new Error(`[build-ts] no tsconfig.plugins.${only}.json in this repo`);
}

// Not an error: this registry may legitimately hold only .mjs plugins, and it did until the first
// TypeScript one arrived. Failing here would make `npm run check` impossible to pass in that state.
if (configs.length === 0) {
  console.log('[build-ts] no TypeScript plugins in this registry — nothing to compile');
  process.exit(0);
}

// `tsc -b` over all of them at once: it is incremental per project and reports every error, rather than
// stopping at the first plugin that fails.
const tsc = join(root, 'node_modules', '.bin', 'tsc');
const res = spawnSync(tsc, ['-b', ...configs], { cwd: root, stdio: 'inherit' });
if (res.error) throw res.error;
if (res.status !== 0) process.exit(res.status ?? 1);

console.log(`[build-ts] ${configs.length} plugin(s) compiled`);
