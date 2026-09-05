// Tests exercise committed dist files. Give Knip the same source/output relationships as build-ts
// through TypeScript project references, so artifact imports count as uses of the original exports.
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(root, 'plugins');
const configDir = mkdtempSync(join(tmpdir(), 'elowen-knip-'));
let status;
try {
  const references = readdirSync(pluginsDir)
    .filter((name) => {
      const src = join(pluginsDir, name, 'src');
      return existsSync(src) && statSync(src).isDirectory();
    })
    .sort()
    .map((name) => {
      const path = join(configDir, `${name}.json`);
      writeFileSync(path, JSON.stringify({
        compilerOptions: {
          rootDir: relative(configDir, join(pluginsDir, name, 'src')),
          outDir: relative(configDir, join(pluginsDir, name, 'dist')),
        },
        files: [],
      }));
      return { path };
    });
  const config = join(configDir, 'tsconfig.json');
  writeFileSync(config, JSON.stringify({ files: [], references }));
  const result = spawnSync(process.execPath, [
    join(root, 'node_modules', 'knip', 'bin', 'knip.js'),
    '--tsConfig', relative(root, config),
    ...process.argv.slice(2),
  ], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  status = result.status ?? 1;
} finally {
  rmSync(configDir, { recursive: true, force: true });
}
process.exitCode = status;
