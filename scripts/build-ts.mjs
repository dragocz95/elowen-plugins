// Compile every plugin that owns plugins/<name>/src/**/*.ts. Discovery is directory-based, so a new
// TypeScript plugin is built immediately without adding another root-level tsconfig file.
//
// Compiled output is committed because the marketplace copies plugins verbatim and never compiles them.
// Pass a plugin name to build only that plugin: `node scripts/build-ts.mjs editor`.
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(root, 'plugins');
const only = process.argv[2];

const plugins = readdirSync(pluginsDir)
  .filter((name) => {
    const src = join(pluginsDir, name, 'src');
    return existsSync(src) && statSync(src).isDirectory();
  })
  .filter((name) => !only || name === only)
  .sort();

if (only && plugins.length === 0) {
  throw new Error(`[build-ts] no plugins/${only}/src directory in this repo`);
}
if (plugins.length === 0) {
  console.log('[build-ts] no TypeScript plugins in this registry - nothing to compile');
  process.exit(0);
}

// Keep generated configs under the repository root so TypeScript resolves root node_modules/@types.
// The directory is removed even when compilation fails.
const configDir = mkdtempSync(join(root, '.tsconfig-build-'));
const configs = [];
let failedStatus = 0;
try {
  for (const name of plugins) {
    const src = join(pluginsDir, name, 'src');
    const dist = join(pluginsDir, name, 'dist');
    const config = join(configDir, `${name}.json`);
    writeFileSync(config, JSON.stringify({
      extends: join(root, 'tsconfig.base.json'),
      compilerOptions: {
        incremental: true,
        rootDir: src,
        outDir: dist,
        tsBuildInfoFile: join(dist, '.tsbuildinfo'),
      },
      include: [join(src, '**/*')],
    }));
    configs.push(config);
  }

  const tsc = join(root, 'node_modules', '.bin', 'tsc');
  for (const config of configs) {
    const result = spawnSync(tsc, ['-p', config], { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      failedStatus = result.status ?? 1;
      break;
    }
  }
} finally {
  rmSync(configDir, { recursive: true, force: true });
}

if (failedStatus !== 0) process.exit(failedStatus);
console.log(`[build-ts] ${plugins.length} plugin(s) compiled`);
