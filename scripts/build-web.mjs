// Build the browser-UI bundle of every plugin in this registry that ships TS/React sources: a plugin
// with `web-src/index.{tsx,ts,jsx,js}` gets it bundled to `web/index.js` — the file its manifest's
// `web.entry` points at, and the ONLY thing the daemon reads (it hashes those bytes at load time and
// serves them on a content-hash URL).
//
// The built bundle is COMMITTED, because the marketplace installs a plugin by copying files and never
// compiles anything. `npm run check:web` re-runs this build and fails if the result differs from what is
// checked in, so a committed bundle can never quietly stop matching its source.
//
// Pass a plugin name to build just that one: `node scripts/build-web.mjs whatsapp`.
import { readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPluginUiBundle } from 'elowen-plugin-ui-kit/build';

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
  await buildPluginUiBundle({ entry, outfile: join(dir, 'web', 'index.js'), nodePaths: [join(root, 'node_modules')] });
  console.log(`[build-web] ${name}: web-src → web/index.js`);
  built += 1;
}

if (only && built === 0) throw new Error(`[build-web] no plugin named "${only}" with a web-src/ directory`);
if (!only) console.log(`[build-web] ${built} bundle(s)`);
