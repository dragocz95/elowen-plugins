// Build the browser UI of every plugin in this registry that ships TS/React sources: a plugin with
// `web-src/index.{tsx,ts,jsx,js}` gets bundled to `web/index.js`, then the finished bundle is scanned for
// Tailwind utilities and compiled to `web/index.css`.
//
// Both artifacts are COMMITTED, because the marketplace installs a plugin by copying files and never
// compiles anything. `npm run check:web` re-runs this build and fails if either result differs from what
// is checked in, so the installed JS and CSS can never quietly stop matching their source.
//
// Pass a plugin name to build just that one: `node scripts/build-web.mjs whatsapp`.
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPluginUiBundle, buildPluginUiCss } from 'elowen-plugin-ui-kit/build';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(root, 'plugins');
const ENTRY_NAMES = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
const only = process.argv[2];

let built = 0;
for (const name of readdirSync(pluginsDir)) {
  if (only && name !== only) continue;
  const dir = join(pluginsDir, name);
  if (!statSync(dir).isDirectory()) continue;
  const src = join(dir, 'web-src');
  if (!existsSync(src)) continue;
  const entry = ENTRY_NAMES.map((f) => join(src, f)).find((f) => existsSync(f));
  if (!entry) throw new Error(`[build-web] ${name}: web-src/ exists but has no index.{tsx,ts,jsx,js} entry`);
  // Browser libraries (lucide-react…) resolve from this repo's own node_modules. They are pinned in the
  // lockfile: the same source must produce the same bytes, or the drift check would fail on a dependency
  // bump rather than on a real change.
  const bundle = join(dir, 'web', 'index.js');
  const stylesheet = join(dir, 'web', 'index.css');
  // esbuild writes imported source CSS beside the JS bundle. Start clean so a plugin that removes its last
  // CSS import cannot accidentally carry the previous build forward, then append the generated utility layer.
  rmSync(stylesheet, { force: true });
  await buildPluginUiBundle({ entry, outfile: bundle, nodePaths: [join(root, 'node_modules')] });
  const authoredCss = existsSync(stylesheet) ? readFileSync(stylesheet, 'utf8') : '';
  const utilityCss = await buildPluginUiCss({ bundle, outfile: stylesheet });
  if (authoredCss.trim()) writeFileSync(stylesheet, `${authoredCss.trimEnd()}\n${utilityCss}`, 'utf8');
  console.log(`[build-web] ${name}: web-src → web/index.js + web/index.css`);
  built += 1;
}

if (only && built === 0) throw new Error(`[build-web] no plugin named "${only}" with a web-src/ directory`);
if (!only) console.log(`[build-web] ${built} bundle(s)`);
