import { existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gt, valid } from 'semver';

const scriptRoot = fileURLToPath(new URL('..', import.meta.url));

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status ?? 1}`);
};

const atomicWrite = (path, content) => {
  const temp = `${path}.release-${process.pid}`;
  writeFileSync(temp, content);
  renameSync(temp, path);
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function releasePlugin({
  root = scriptRoot,
  pluginName,
  newVersion,
  summary,
  date = new Date().toISOString().slice(0, 10),
  verifyArtifacts = true,
  requireClean = true,
  postCheck = true,
} = {}) {
  root = resolve(root);
  if (!pluginName || !newVersion || !summary?.trim()) {
    throw new Error('usage: npm run release:plugin -- <plugin> <new-version> "<changelog summary>"');
  }
  if (!valid(newVersion)) throw new Error(`invalid semantic version: ${newVersion}`);
  if (/\r|\n/.test(summary)) throw new Error('changelog summary must be one line');

  if (verifyArtifacts) {
    run('npm', ['run', 'check:web'], root);
    run('npm', ['run', 'check:dist'], root);
  }
  if (requireClean) {
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    if (status.error) throw status.error;
    if (status.status !== 0) throw new Error('git status failed');
    if (status.stdout.trim()) throw new Error('release requires a clean working tree after artifact verification');
  }

  const pluginsDir = join(root, 'plugins');
  const pluginNames = readdirSync(pluginsDir)
    .filter((name) => statSync(join(pluginsDir, name)).isDirectory())
    .filter((name) => existsSync(join(pluginsDir, name, 'elowen-plugin.json')));
  if (!pluginNames.includes(pluginName)) throw new Error(`unknown plugin: ${pluginName}`);

  const manifestFile = join(pluginsDir, pluginName, 'elowen-plugin.json');
  const registryFile = join(root, 'registry.json');
  const changelogFile = join(root, 'CHANGELOG.md');
  const originals = {
    manifest: readFileSync(manifestFile, 'utf8'),
    registry: readFileSync(registryFile, 'utf8'),
    changelog: existsSync(changelogFile) ? readFileSync(changelogFile, 'utf8') : null,
  };
  const manifest = JSON.parse(originals.manifest);
  const registry = JSON.parse(originals.registry);
  const entry = registry.plugins?.find((candidate) => candidate.name === pluginName);
  if (!entry) throw new Error(`plugin ${pluginName} is absent from registry.json`);
  if (entry.version !== manifest.version) {
    throw new Error(`version drift before release: manifest ${manifest.version}, registry ${entry.version}`);
  }
  if (!gt(newVersion, manifest.version)) {
    throw new Error(`new version ${newVersion} must be greater than ${manifest.version}`);
  }

  manifest.version = newVersion;
  entry.version = newVersion;
  for (const key of ['requiresCore', 'requiresSharedApi']) {
    if (manifest[key] === undefined) delete entry[key];
    else entry[key] = manifest[key];
  }
  const heading = '# Changelog';
  const previous = originals.changelog?.trim() || heading;
  const body = previous.startsWith(heading) ? previous.slice(heading.length).trimStart() : previous;
  const changelog = `${heading}\n\n## ${pluginName} ${newVersion} - ${date}\n\n- ${summary.trim()}\n${body ? `\n${body.trimEnd()}\n` : ''}`;

  try {
    atomicWrite(manifestFile, json(manifest));
    atomicWrite(registryFile, json(registry));
    atomicWrite(changelogFile, changelog);
    if (postCheck) {
      run(process.execPath, [join(root, 'scripts', 'check-manifests.mjs')], root);
      run(process.execPath, [join(root, 'scripts', 'check-languages.mjs')], root);
      run(process.execPath, [join(root, 'scripts', 'check-shared-compat.mjs')], root);
    }
  } catch (error) {
    atomicWrite(manifestFile, originals.manifest);
    atomicWrite(registryFile, originals.registry);
    if (originals.changelog === null) {
      if (existsSync(changelogFile)) unlinkSync(changelogFile);
    } else {
      atomicWrite(changelogFile, originals.changelog);
    }
    throw error;
  }

  console.log(`release-plugin: ${pluginName} ${entry.version} - manifest, registry and changelog updated`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    releasePlugin({
      pluginName: process.argv[2],
      newVersion: process.argv[3],
      summary: process.argv.slice(4).join(' '),
      date: process.env.ELOWEN_RELEASE_DATE,
      verifyArtifacts: process.env.ELOWEN_RELEASE_SKIP_VERIFY !== '1',
      requireClean: process.env.ELOWEN_RELEASE_SKIP_CLEAN !== '1',
      postCheck: process.env.ELOWEN_RELEASE_SKIP_POSTCHECK !== '1',
      root: process.env.ELOWEN_RELEASE_ROOT ?? scriptRoot,
    });
  } catch (error) {
    console.error(`release-plugin: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
