import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('deadcode maps artifact imports to source without hiding unused exports', (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'deadcode-resolution-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  mkdirSync(join(fixture, 'scripts'));
  copyFileSync(join(root, 'scripts/check-deadcode.mjs'), join(fixture, 'scripts/check-deadcode.mjs'));
  symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir');
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'deadcode-fixture', private: true, type: 'module' }));
  writeFileSync(join(fixture, 'knip.json'), JSON.stringify({
    entry: ['entry.mjs'],
    project: ['plugins/*/src/**/*.ts'],
  }));
  // Both relationships must resolve, not just the first TypeScript reference.
  for (const name of ['first', 'second']) {
    mkdirSync(join(fixture, 'plugins', name, 'src'), { recursive: true });
    mkdirSync(join(fixture, 'plugins', name, 'dist'));
    writeFileSync(join(fixture, 'plugins', name, 'src/index.ts'), 'export const used = 1;\n');
    writeFileSync(join(fixture, 'plugins', name, 'dist/index.js'), 'export const used = 1;\n');
  }
  writeFileSync(join(fixture, 'entry.mjs'), [
    "import { used as first } from './plugins/first/dist/index.js';",
    "import { used as second } from './plugins/second/dist/index.js';",
    'console.log(first, second);',
  ].join('\n'));
  const run = () => spawnSync(process.execPath, [join(fixture, 'scripts/check-deadcode.mjs')], {
    cwd: fixture,
    encoding: 'utf8',
    timeout: 30_000,
  });
  const clean = run();
  assert.ifError(clean.error);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);

  writeFileSync(join(fixture, 'plugins/second/src/index.ts'), 'export const used = 1;\nexport const genuinelyUnused = 2;\n');
  const unused = run();
  assert.ifError(unused.error);
  assert.equal(unused.status, 1, unused.stdout + unused.stderr);
  assert.match(unused.stdout + unused.stderr, /genuinelyUnused/);
});
