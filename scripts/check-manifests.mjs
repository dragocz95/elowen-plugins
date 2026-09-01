import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest } from 'elowen/dist/plugins/manifest.js';

const scriptRoot = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(process.env.ELOWEN_MANIFEST_CHECK_ROOT ?? scriptRoot);
const pluginsDir = join(root, 'plugins');
const errors = [];
const registryFile = join(root, 'registry.json');
let catalogByName = new Map();
try {
  const registry = JSON.parse(readFileSync(registryFile, 'utf8'));
  catalogByName = new Map((Array.isArray(registry.plugins) ? registry.plugins : []).map((entry) => [entry.name, entry]));
} catch {
  errors.push('registry.json is not valid JSON');
}

const pluginNames = readdirSync(pluginsDir)
  .filter((name) => statSync(join(pluginsDir, name)).isDirectory())
  .filter((name) => existsSync(join(pluginsDir, name, 'elowen-plugin.json')))
  .sort();

for (const name of pluginNames) {
  const file = join(pluginsDir, name, 'elowen-plugin.json');
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    errors.push(`plugin ${name}: manifest is not valid JSON`);
    continue;
  }

  const warnings = [];
  try {
    parseManifest(raw, (warning) => warnings.push(warning));
  } catch (error) {
    errors.push(`plugin ${name}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  // New cores deliberately drop unknown fields so the rest of a plugin can load. A registry release must
  // be stricter: publishing a field before the published daemon knows it makes that setting disappear on
  // every installed instance, and older cores reject the whole plugin rather than degrade it.
  for (const warning of warnings) errors.push(`plugin ${name}: ${warning}`);

  const catalog = catalogByName.get(name);
  if (!catalog) {
    errors.push(`plugin ${name}: missing from registry.json`);
    continue;
  }
  for (const key of ['requiresCore', 'requiresSharedApi']) {
    if (catalog[key] !== raw[key]) {
      errors.push(`plugin ${name}: registry ${key} ${JSON.stringify(catalog[key])} does not match manifest ${JSON.stringify(raw[key])}`);
    }
  }
}

if (errors.length > 0) {
  console.error(`manifest-check: ${errors.length} problem(s)\n`);
  for (const error of errors) console.error(`  x ${error}`);
  process.exit(1);
}
console.log(`manifest-check: OK - ${pluginNames.length} manifest(s) accepted by published elowen`);
