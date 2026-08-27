import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { satisfies } from 'semver';

const scriptRoot = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(process.env.ELOWEN_SHARED_CHECK_ROOT ?? scriptRoot);
const errors = [];

const readJson = (path, label) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    errors.push(`${label}: invalid or missing ${path}`);
    return {};
  }
};

const registryPkg = readJson(join(root, 'package.json'), 'registry');
const daemonRoot = resolve(process.env.ELOWEN_SHARED_DAEMON_ROOT ?? join(root, 'node_modules', 'elowen'));
const daemonPkg = readJson(join(daemonRoot, 'package.json'), 'published daemon');
const sharedRoot = resolve(process.env.ELOWEN_SHARED_PACKAGE_ROOT ?? join(root, 'node_modules', 'elowen-plugin-shared'));
const sharedPkg = readJson(join(sharedRoot, 'package.json'), 'installed shared package');
let sharedApi = null;
try {
  ({ PLUGIN_SHARED_API_VERSION: sharedApi } = await import(pathToFileURL(join(sharedRoot, 'index.mjs')).href));
} catch {
  errors.push(`installed shared package: cannot import PLUGIN_SHARED_API_VERSION from ${sharedRoot}`);
}

const registryRange = registryPkg.devDependencies?.['elowen-plugin-shared'];
const daemonRange = daemonPkg.dependencies?.['elowen-plugin-shared'];
if (!registryRange) errors.push('registry: devDependencies.elowen-plugin-shared is missing');
if (!daemonRange) errors.push('published daemon: dependencies.elowen-plugin-shared is missing');
if (sharedPkg.version && registryRange && !satisfies(sharedPkg.version, registryRange)) {
  errors.push(`registry tests ${sharedPkg.version}, outside its declared range ${registryRange}`);
}
if (sharedPkg.version && daemonRange && !satisfies(sharedPkg.version, daemonRange)) {
  errors.push(`registry tests shared ${sharedPkg.version}, but published daemon ${daemonPkg.version ?? '?'} ships ${daemonRange}`);
}

const importPattern = /(?:from\s*|import\s+|import\s*\(\s*|require\s*\(\s*)['"]elowen-plugin-shared(?:\/[^'"]*)?['"]/g;
const importsShared = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'web', 'web-src'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (importsShared(path)) return true;
      continue;
    }
    if (/\.(mjs|js|ts)$/.test(entry.name) && importPattern.test(readFileSync(path, 'utf8'))) {
      importPattern.lastIndex = 0;
      return true;
    }
    importPattern.lastIndex = 0;
  }
  return false;
};

const pluginsDir = join(root, 'plugins');
const pluginNames = readdirSync(pluginsDir)
  .filter((name) => statSync(join(pluginsDir, name)).isDirectory())
  .filter((name) => existsSync(join(pluginsDir, name, 'elowen-plugin.json')))
  .sort();
let sharedConsumers = 0;
for (const name of pluginNames) {
  const dir = join(pluginsDir, name);
  if (!importsShared(dir)) continue;
  sharedConsumers += 1;
  const manifest = readJson(join(dir, 'elowen-plugin.json'), `plugin ${name}`);
  if (manifest.requiresSharedApi === undefined) {
    errors.push(`plugin ${name}: imports elowen-plugin-shared but declares no requiresSharedApi`);
  } else if (manifest.requiresSharedApi !== sharedApi) {
    errors.push(`plugin ${name}: requiresSharedApi ${manifest.requiresSharedApi}, installed shared package exposes API ${sharedApi}`);
  }
}

const defaultExtraRoots = [resolve(root, '..', 'elowen'), resolve(root, '..', 'elowen-chetty')];
const configuredExtras = process.env.ELOWEN_SHARED_EXTRA_ROOTS;
const extraRoots = configuredExtras === undefined
  ? defaultExtraRoots
  : configuredExtras.split(delimiter).filter(Boolean).map(resolve);
for (const extraRoot of extraRoots) {
  if (!existsSync(join(extraRoot, 'package.json'))) continue;
  const label = dirname(extraRoot) === dirname(root) ? extraRoot.split('/').pop() : extraRoot;
  const pkg = readJson(join(extraRoot, 'package.json'), label);
  const sourceSharedRoot = join(extraRoot, 'packages', 'plugin-shared');
  if (!existsSync(join(sourceSharedRoot, 'package.json'))) {
    errors.push(`${label}: packages/plugin-shared is missing`);
    continue;
  }
  const sourcePkg = readJson(join(sourceSharedRoot, 'package.json'), `${label} shared package`);
  let sourceApi = null;
  try {
    ({ PLUGIN_SHARED_API_VERSION: sourceApi } = await import(pathToFileURL(join(sourceSharedRoot, 'index.mjs')).href));
  } catch {
    errors.push(`${label}: cannot import packages/plugin-shared/index.mjs`);
  }
  if (sourcePkg.version !== sharedPkg.version) {
    errors.push(`${label}: source shared package is ${sourcePkg.version}, registry tests ${sharedPkg.version}`);
  }
  if (sourceApi !== sharedApi) {
    errors.push(`${label}: shared API is ${sourceApi}, registry tests API ${sharedApi}`);
  }
  const declared = pkg.dependencies?.['elowen-plugin-shared'];
  if (!declared || !satisfies(sharedPkg.version, declared)) {
    errors.push(`${label}: dependency ${declared ?? '(missing)'} does not accept shared ${sharedPkg.version}`);
  }
}

if (errors.length > 0) {
  console.error(`shared-check: ${errors.length} problem(s)\n`);
  for (const error of errors) console.error(`  x ${error}`);
  process.exit(1);
}
console.log(`shared-check: OK - shared ${sharedPkg.version} / API ${sharedApi}, ${sharedConsumers} plugin consumer(s)`);
