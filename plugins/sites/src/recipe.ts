import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

import type { ConversionImageKind } from './conversionImage.js';
import { assertAppOwnedSelection } from './dataSync.js';
import { systemdEnvironment } from './releaseEnvironment.js';

/** What a converted command site needs in order to actually SERVE, and where its data lives.
 *
 *  WHY A PER-SITE ARTEFACT RATHER THAN A CONSTANT. The three command sites this was written for differ in
 *  every dimension that matters: one keeps no state, two share a single sandbox home and own different
 *  subtrees of it, one reads `PORT` and the others `DEV_PORT`. A single built-in recipe cannot express
 *  that, and a caller-supplied blob would hand an administrator arbitrary paths and arbitrary argv.
 *
 *  So the recipe is an OWNED artefact: the plugin derives its path from the site id, and every field is
 *  validated on read. The caller names a recipe kind, never a path and never a command line.
 *
 *  WHY THE BASE IMAGE IS NOT ENOUGH ON ITS OWN. `baseImage.ts` boots systemd and proxies the host ingress
 *  socket to `127.0.0.1:80` inside, but nothing in it listens on that port. A conversion that stopped
 *  there would produce a container that is up, healthy by every container-level check, and answering
 *  nothing. The unit generated here is what closes that gap. */

/** The kinds of conversion this operation knows how to run. A NAME from this set is the only recipe
 *  input a caller may supply. */
const RECIPE_KINDS = ['release-copy', 'node-app'] as const;
export type RecipeKind = (typeof RECIPE_KINDS)[number];

export const isRecipeKind = (value: unknown): value is RecipeKind =>
  typeof value === 'string' && (RECIPE_KINDS as readonly string[]).includes(value);

/** Environment variable names a recipe may set for the app.
 *
 *  Refused rather than filtered, so a manifest that names something unexpected fails loudly instead of
 *  silently converting a site whose app then cannot find its configuration. `HOME` is refused because the
 *  unit sets it to the app-owned `/data` path and a recipe overriding it would point the app back at a
 *  directory the container does not have. `PATH` is refused for the obvious reason. */
const REFUSED_ENV_KEYS = new Set(['HOME', 'PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'NODE_OPTIONS']);
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

export interface AppRecipe {
  kind: RecipeKind;
  /** Argv the unit runs. Argv, never a shell string: a command line would make every quoting mistake in
   *  a manifest a code-execution surface. */
  argv: readonly string[];
  /** Non-secret environment for the app. Secrets stay in the protected artefact and reach the app as a
   *  file, exactly as they do for the legacy runtime. */
  env: Readonly<Record<string, string>>;
  /** App-owned subtrees under the sandbox home, relative. Empty means the app keeps no state outside its
   *  release, which is a real answer and not the same as "capture everything". */
  dataIncludes: readonly string[];
  /** Where the captured subtrees are mounted inside, under the persistent volume. */
  dataDir: string;
  /** Release-relative files that carry credentials and must live in the protected artefact rather than in
   *  the writable staged workspace. Which files these are is per application: one app keeps a `.env`,
   *  another an `auth.json`, another both a `.env` and a `config.json`. Naming them here rather than
   *  assuming `.env` is what keeps that knowledge out of the shared plugin. */
  secretFiles: readonly string[];
  /** Which derivative image the app needs: files served by nginx, or a Node runtime. */
  image: ConversionImageKind;
  /** The invariant that proves this specific application is actually serving.
   *
   *  A live socket is not an answer: `systemd-socket-proxyd` accepts a connection whether or not anything
   *  is listening behind it, so a container whose application never started still looks connectable. Each
   *  app knows a request that only succeeds when it is genuinely up, and that is what completion demands. */
  readiness: { path: string; expectStatus: number };
}

/** Where the conversion's own files land inside the container.
 *
 *  Under the persistent volume rather than a bind mount, because they have to be there BEFORE the
 *  container first runs and the volume is the only thing this operation can seed at that point. The
 *  bootstrap unit removes the staged secrets once they are installed, so they do not linger on the volume
 *  for the life of the site. */
const CONVERSION_STAGE = '/data/.elowen-conversion';
const DATA_ARCHIVE_STAGE = `${CONVERSION_STAGE}/legacy-data.tar`;
const SECRET_STAGE = `${CONVERSION_STAGE}/secrets`;

/** The only root a recipe may place data under. */
const DATA_ROOT = '/data';

/** Names a static site must never serve, whatever a recipe or a release contains. */
const PROTECTED_STATIC_NAMES = new Set(['.env', '.git', '.htaccess', '.npmrc', 'config.json', 'auth.json']);

const parseReadiness = (raw: unknown, image: ConversionImageKind): AppRecipe['readiness'] => {
  if (raw === undefined) return { path: '/', expectStatus: image === 'static' ? 200 : 200 };
  if (raw === null || typeof raw !== 'object') throw new Error('recipe readiness must be an object');
  const record = raw as Record<string, unknown>;
  const path = record.path === undefined ? '/' : asString(record.path, 'readiness.path');
  if (!path.startsWith('/')) throw new Error('recipe readiness path must be absolute');
  if (path.includes('..')) throw new Error('recipe readiness path must not traverse');
  const status = record.expectStatus === undefined ? 200 : record.expectStatus;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error('recipe readiness expectStatus must be an HTTP status code');
  }
  return { path, expectStatus: status };
};

/** Whether a release-relative path is safe for a static site to serve. */
export const staticServable = (rel: string): boolean => {
  const parts = rel.split('/').filter(Boolean);
  if (parts.length === 0) return false;
  // Dotfiles at any depth, and the well-known credential names, never go into a served tree.
  return !parts.some((part) => part.startsWith('.') || PROTECTED_STATIC_NAMES.has(part));
};

const asString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`recipe ${field} must be a non-empty string`);
  return value;
};

/** Parse and validate a recipe artefact. Throws on anything it cannot vouch for; there is no partial
 *  acceptance, because a half-understood recipe would convert a site into something nobody described. */
export function parseAppRecipe(raw: unknown): AppRecipe {
  if (raw === null || typeof raw !== 'object') throw new Error('a recipe must be a JSON object');
  const record = raw as Record<string, unknown>;

  const kind = record.kind;
  if (!isRecipeKind(kind)) throw new Error(`unknown recipe kind: ${String(kind)}`);

  if (!Array.isArray(record.argv) || record.argv.length === 0) throw new Error('recipe argv must be a non-empty array');
  const argv = record.argv.map((entry, index) => asString(entry, `argv[${index}]`));
  // A NUL byte truncates an argument at the exec boundary, so an argv carrying one does not run what the
  // manifest says it runs.
  if (argv.some((entry) => entry.includes('\0'))) throw new Error('recipe argv must not contain a NUL byte');

  const envRaw = record.env === undefined ? {} : record.env;
  if (envRaw === null || typeof envRaw !== 'object' || Array.isArray(envRaw)) throw new Error('recipe env must be an object');
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envRaw as Record<string, unknown>)) {
    if (!ENV_KEY_PATTERN.test(key)) throw new Error(`recipe env name is not a plain variable name: ${key}`);
    if (REFUSED_ENV_KEYS.has(key)) throw new Error(`recipe env must not set ${key}`);
    const text = asString(value, `env.${key}`);
    // A newline would end the assignment and start a new directive in the generated unit.
    if (/[\n\r\0]/.test(text)) throw new Error(`recipe env value for ${key} must be a single line`);
    env[key] = text;
  }

  const includesRaw = record.dataIncludes === undefined ? [] : record.dataIncludes;
  if (!Array.isArray(includesRaw)) throw new Error('recipe dataIncludes must be an array');
  const dataIncludes = includesRaw.length === 0
    ? []
    // The SAME validator the capture uses, applied here so a bad manifest is refused when it is read
    // rather than when a site is already stopped and half-converted.
    : assertAppOwnedSelection({ home: '/', includes: includesRaw.map((entry, index) => asString(entry, `dataIncludes[${index}]`)) });

  const dataDirRaw = record.dataDir === undefined ? '/data' : asString(record.dataDir, 'dataDir');
  // CANONICAL containment, not a prefix test. `startsWith('/data')` accepts `/datax`, which is a
  // different filesystem entirely, and `/data/../../etc`, which is not under the volume at all.
  const dataDir = posix.resolve(dataDirRaw);
  if (dataDir !== DATA_ROOT && !dataDir.startsWith(`${DATA_ROOT}/`)) {
    throw new Error(`recipe dataDir must resolve under ${DATA_ROOT}, got ${dataDir}`);
  }

  const secretsRaw = record.secretFiles === undefined ? [] : record.secretFiles;
  if (!Array.isArray(secretsRaw)) throw new Error('recipe secretFiles must be an array');
  // The same containment rule as a data include: a secret path is release-relative, and one that escaped
  // would have the plugin move a file out of somebody else's tree and into this site's artefacts.
  const secretFiles = secretsRaw.length === 0
    ? []
    : assertAppOwnedSelection({ home: '/', includes: secretsRaw.map((entry, index) => asString(entry, `secretFiles[${index}]`)) });

  const image: ConversionImageKind = kind === 'release-copy' ? 'static' : 'node';
  // The legacy command runtime loads .env even when the application does not read it itself.
  if (image === 'node' && !secretFiles.includes('.env')) secretFiles.push('.env');

  // A STATIC site has no process to hand a secret to: nginx serves the workspace as files, so anything
  // "restored" into it becomes a downloadable URL. Refusing the list outright is the only safe answer;
  // silently dropping it would convert a site whose operator believed its credentials had travelled.
  if (image === 'static' && secretFiles.length > 0) {
    throw new Error('a static recipe must not declare secretFiles: nginx would serve them as files');
  }
  if (image === 'static' && dataIncludes.length > 0) {
    throw new Error('a static recipe has no process to own application data');
  }

  const readiness = parseReadiness(record.readiness, image);

  return { kind, argv, env, dataIncludes, dataDir, secretFiles, image, readiness };
}

/** Read a site's recipe from the artefact directory the plugin owns.
 *
 *  The path is DERIVED from the site's own directory, so no caller ever names it. Absent is a refusal
 *  rather than a default: converting a stateful app under an assumed recipe is how data goes missing. */
export function loadAppRecipe(artifactDir: string): AppRecipe {
  const path = join(artifactDir, 'recipe.json');
  if (!existsSync(path)) {
    throw new Error(`this site has no conversion recipe at ${path}; an administrator must supply one before converting`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`the conversion recipe is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  // A registered recipe is wrapped with its binding; the inner object is the recipe itself.
  const envelope = parsed as { recipe?: unknown };
  return parseAppRecipe(envelope && typeof envelope === 'object' && 'recipe' in envelope ? envelope.recipe : parsed);
}

/** Everything in a staged STATIC tree that must not be served, found before the container is built.
 *
 *  Defence in depth in front of the nginx rules, and the layer that catches what a URL pattern cannot.
 *  A symlink named `public-leak` pointing at `.env` is requested as `/public-leak`: no dot, no known
 *  credential name, nothing a path pattern can see. Only looking at the FILE finds it.
 *
 *  Refusing at staging rather than stripping is deliberate: a release that carries a link into its own
 *  secrets is not a release anybody meant to publish as static, and silently dropping the entry would
 *  convert a site whose author still believes that path works. */
export function auditStaticTree(workspace: string): string[] {
  const offenders: string[] = [];
  const root = resolve(workspace);
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        // Reported whatever it points at. Even a link that stays inside the tree is refused, because
        // resolving it is how a name with no dot in it reaches a file the deny rules do cover.
        let target = '(unreadable)';
        try { target = readlinkSync(full); } catch { /* reported as unreadable */ }
        offenders.push(`${rel} is a symlink to ${target}`);
        continue;
      }
      if (entry.isDirectory()) { walk(full, rel); continue; }
      if (!entry.isFile()) { offenders.push(`${rel} is not a regular file`); continue; }
      if (!staticServable(rel)) offenders.push(`${rel} must not be served by a static site`);
      // A hard link out of the tree cannot be detected by name, but a file whose resolved path leaves
      // the root can, and that is the other way a served entry reaches somewhere it should not.
      try {
        const real = realpathSync(full);
        if (real !== root && !real.startsWith(`${root}/`)) offenders.push(`${rel} resolves outside the workspace`);
      } catch {
        offenders.push(`${rel} could not be resolved`);
      }
    }
  };
  walk(root, '');
  return offenders;
}

/** Make a staged STATIC tree readable by the server that will actually serve it.
 *
 *  WHY 0700 IS WRONG HERE, AND ONLY HERE. The staged workspace is created 0700 because it is the
 *  plugin's, and for a node conversion that is exactly right: the app runs as root inside, which maps to
 *  the service account, and the mode is never in the way. nginx does not run as root. Its WORKERS drop to
 *  `www-data`, which maps into the subuid range, so on a 0700 tree they get EACCES on `/workspace` and
 *  `try_files ... =404` reports it as a plain 404. The site serves nothing while every status says the
 *  conversion succeeded.
 *
 *  So the served tree gets ordinary published-content modes: directories traversable and listable,
 *  files readable. The ANCESTORS get execute only, never read: a worker has to walk through them to
 *  reach the mount source, but nothing should be able to list what else this site's directory holds —
 *  the artefact directory beside it keeps the secrets and stays 0700, and an execute-only parent leaves
 *  it unreachable by name.
 *
 *  Called only after the secrets are lifted out and the tree is audited, so nothing widened here was ever
 *  a credential. The release this was copied from is not touched: every mode change lands on the copy. */
export function relaxStaticServingPermissions(workspace: string, ancestors: readonly string[]): void {
  for (const ancestor of ancestors) {
    // Execute for group and other, read for NEITHER. Enough to walk through, not enough to list.
    //
    // Set rather than or-ed: these directories are created with the daemon's umask, so they usually
    // arrive 0755 and already readable. Only adding the execute bit would leave them listable, which
    // publishes the names of everything else this site keeps — releases, logs, and the artefact
    // directory holding its secrets. That directory is 0700 in its own right, so an execute-only parent
    // makes it unreachable rather than merely unreadable.
    const owner = statSync(ancestor).mode & 0o700;
    chmodSync(ancestor, owner | 0o111);
  }
  const walk = (dir: string): void => {
    chmodSync(dir, 0o755);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      // The audit already refused symlinks and anything unservable, so every remaining entry is a plain
      // directory or a plain file. Following one here would be chmod-ing whatever it pointed at.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) chmodSync(full, 0o644);
    }
  };
  walk(workspace);
}

/** Install a recipe as an immutable, site-bound artefact.
 *
 *  WHY THIS EXISTS RATHER THAN "PUT A FILE THERE". Asking an operator to hand-place JSON into a
 *  plugin-owned directory is an unsafe installation step: nothing validates it, nothing binds it to the
 *  site it describes, and nothing stops it being edited between preparing and flipping. Registration
 *  validates first, records WHICH site and WHICH release it was approved against, and writes it 0400 so
 *  the ordinary path cannot rewrite it.
 *
 *  `expectedReleaseId` is the binding that matters: a recipe describes one published build. Approving it
 *  and then publishing a new release would leave a container running last week's argv against this
 *  week's files, so the claim refuses a recipe whose release no longer matches. */
export function installAppRecipe(
  artifactDir: string,
  input: { siteId: string; expectedReleaseId: string; recipe: unknown },
): AppRecipe {
  const recipe = parseAppRecipe(input.recipe);
  mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
  const path = join(artifactDir, 'recipe.json');
  const body = `${JSON.stringify({
    siteId: input.siteId,
    expectedReleaseId: input.expectedReleaseId,
    installedAt: new Date().toISOString(),
    recipe,
  }, null, 2)}\n`;
  // Replaced whole rather than edited: a 0400 file cannot be reopened for writing, and a half-written
  // recipe is one a flip could still read.
  const temporary = `${path}.partial`;
  rmSync(temporary, { force: true });
  writeFileSync(temporary, body, { mode: 0o600 });
  rmSync(path, { force: true });
  renameSync(temporary, path);
  chmodSync(path, 0o400);
  return recipe;
}

/** The site and release a stored recipe was approved for, or null when none is installed. */
export function recipeBinding(artifactDir: string): { siteId: string; expectedReleaseId: string } | null {
  const path = join(artifactDir, 'recipe.json');
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { siteId?: unknown; expectedReleaseId?: unknown };
    if (typeof raw.siteId !== 'string' || typeof raw.expectedReleaseId !== 'string') return null;
    return { siteId: raw.siteId, expectedReleaseId: raw.expectedReleaseId };
  } catch { return null; }
}

/** The systemd unit that makes a converted site answer.
 *
 *  `WorkingDirectory=/workspace` because that is where the staged release copy is mounted and where the
 *  app expects to find its own files, exactly as the legacy runtime ran it inside the release directory.
 *  `HOME` points into the app-owned data directory so anything the app writes relative to its home lands
 *  on the persistent volume rather than on the container's disposable layer.
 *
 *  Socket-activated ordering is deliberate: `elowen-ingress.socket` already listens on the host-owned
 *  path, so the proxy has somewhere to forward as soon as this unit is up, and a slow app start delays
 *  requests instead of refusing them. */
export function appUnit(recipe: AppRecipe): string {
  return [
    '[Unit]',
    'Description=Elowen converted site application',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    'WorkingDirectory=/workspace',
    `Environment=HOME=${recipe.dataDir}`,
    'Environment=NODE_ENV=production',
    'EnvironmentFile=/etc/elowen-app.env',
    'EnvironmentFile=/etc/elowen-app-recipe.env',
    // Argv as a bare exec line with each argument quoted by systemd's own rules. `ExecStart=` takes the
    // first token as the binary, so an absolute path is required and validated by the recipe author.
    `ExecStart=${recipe.argv.map((arg) => `"${arg.replace(/(["\\])/g, '\\$1')}"`).join(' ')}`,
    'Restart=always',
    'RestartSec=2',
    'StandardOutput=journal',
    'StandardError=journal',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

/** The provisioning script run once inside a freshly created container, before it first serves.
 *
 *  Written as a script rather than baked into the base image because the DATA placement is per-app: the
 *  capture is unpacked under the app's own directory on the persistent volume, and only the recipe knows
 *  where that is. Idempotent, so a resumed or retried conversion re-runs it harmlessly. */
export function provisionScript(recipe: AppRecipe): string {
  return [
    '#!/bin/sh',
    'set -eu',
    `mkdir -p '${recipe.dataDir}'`,
    // The application unit ships on the volume and is installed here, because the container rootfs is
    // built before the recipe is known and systemd reads units from the rootfs, not from /data.
    `install -m 0644 '${CONVERSION_STAGE}/elowen-app.service' /etc/systemd/system/elowen-app.service`,
    `if [ -f '${CONVERSION_STAGE}/app.env' ]; then install -m 0600 '${CONVERSION_STAGE}/app.env' /etc/elowen-app.env; else test -f /etc/elowen-app.env; fi`,
    'install -m 0600 /dev/null /etc/elowen-app-recipe.env',
    // A separate, later file gives explicit recipe settings precedence over dotenv values.
    `printf '%s' '${Buffer.from(systemdEnvironment(recipe.env)).toString('base64')}' | base64 -d > /etc/elowen-app-recipe.env`,
    `rm -f '${CONVERSION_STAGE}/app.env'`,
    // The captured subtrees were archived relative to the sandbox home, so they are unpacked relative to
    // the app's data directory, which is the home the unit hands the app.
    `if [ -f '${DATA_ARCHIVE_STAGE}' ]; then tar -xf '${DATA_ARCHIVE_STAGE}' -C '${recipe.dataDir}'; fi`,
    // Each secret goes back to the release-relative path the app already reads it from, at 0600. The
    // names are the recipe's, so the shared plugin never assumes an application's configuration layout.
    ...recipe.secretFiles.map((file) =>
      `if [ -f '${join(SECRET_STAGE, file)}' ]; then mkdir -p "$(dirname '/workspace/${file}')"; install -m 0600 '${join(SECRET_STAGE, file)}' '/workspace/${file}'; fi`),
    // The staged copies are removed once installed: a conversion artefact holding credentials has no
    // reason to outlive the boot that consumed it.
    `rm -rf '${SECRET_STAGE}'`,
    'systemctl daemon-reload',
    'systemctl enable --now elowen-app.service',
    '',
  ].join('\n');
}
