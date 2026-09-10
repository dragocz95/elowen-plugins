import { createHash } from 'node:crypto';
import { closeSync, constants, cpSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, rmSync, statSync, utimesSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Read size for hashing one tree entry — the digest costs the same memory whatever it is hashing. */
const DIGEST_CHUNK_BYTES = 4 * 1048576;

import type { LegacyDataSelection } from './dataSync.js';
import { appUnit, auditStaticTree, CONVERSION_STAGE, provisionScript, type AppRecipe, type RecipeKind } from './recipe.js';
import type { ConvertibleRuntime, RuntimeMigration, Site, SitesStore } from './store.js';

/** Converting a live site's runtime in place, one site at a time, resumable after a crash.
 *
 *  WHY THIS EXISTS AS AN OPERATION RATHER THAN A FIELD. `runtime` is the column `serve.ts` dispatches on,
 *  and nothing else in this plugin may write it: `updateSite` deliberately does not carry the key. A
 *  conversion is not a field edit, it is a container build, a content copy, a legacy process stop and a
 *  column flip that must all agree. Exposing the column instead would let a caller point a live hostname
 *  at an unbuilt container, or flip a command site while its process keeps running and its socket keeps
 *  answering.
 *
 *  WHAT IS PRESERVED, AND WHY IT IS NOT RE-DERIVED. The site keeps its id, slug, visibility, access
 *  generation, members, releases and `current_release_id`. The claim captures the undo material up front
 *  precisely because the flip overwrites some of it; a rollback that read the site back would restore
 *  whatever the flip left, not what was there before.
 *
 *  WHY THE CONTAINER IS PREPARED BEFORE THE FLIP AND NOT RECREATED BY IT. `EnvironmentSupervisor.start`
 *  reaches the runtime provider, whose `ensureInitialContainer` creates a container only when the engine
 *  reports it absent; an existing `created` or `exited` container is STARTED, reusing its own writable
 *  layer. So a container this migrator builds ahead of
 *  time survives the flip untouched, and the flip costs a start rather than a rebuild. That property is
 *  load-bearing, not incidental, and {@link prepare} is written to leave the container in exactly that
 *  state.
 *
 *  WHY STATIC CONTENT COMES FROM THE RELEASE. A site serves its RELEASE directory, an immutable published
 *  snapshot; `sourceDir` is the editable working copy the agent may have moved on from. Staging the
 *  source would silently publish unreleased edits under a live hostname the moment the flip lands. */

/** Refusals a caller can act on, kept apart from genuine faults so the API can answer 409 rather than
 *  502 for "somebody else is mid-operation". */
export class MigrationRefused extends Error {}

export interface MigrationDeps {
  store: SitesStore;
  /** The plugin's own per-site directory. The staged workspace lives under it, so the container's
   *  `/workspace` is owned by this operation and never the site's editable source. */
  siteDir(siteId: string): string;
  releaseDir(siteId: string, releaseId: string): string;
  /** Stop a legacy command process and RESOLVE only once it is gone. Awaited explicitly: reconcile walks
   *  `liveCommandSites()` only, so a flipped site leaves its own supervisor's desired set and no sweep
   *  will ever come back for the process. Nothing else stops it. */
  stopLegacyRuntime(siteId: string): Promise<void>;
  /** Whether the legacy supervisor still holds a process for this site, checked after the stop rather
   *  than trusted from it. */
  legacyRunning(siteId: string): boolean;
  /** Restart the legacy runtime after a rollback. Only meaningful for a command site. */
  startLegacyRuntime(site: Site): Promise<void>;
  /** The site's validated recipe artefact: which image, which argv and env, which subtrees are its data
   *  and which release files are secrets. Read fresh, never cached across a reload. */
  loadRecipe(siteId: string): AppRecipe;
  /** Which site and release the stored recipe was approved for, or null when none is registered. */
  recipeBinding(siteId: string): { siteId: string; expectedReleaseId: string } | null;
  /** Write a validated recipe as an immutable, site-bound artefact. */
  installRecipe(siteId: string, input: { siteId: string; expectedReleaseId: string; recipe: unknown }): AppRecipe;
  /** Build the container on the recipe's derivative image and leave it NOT running, so the flip can
   *  start it without a rebuild. */
  prepareContainer(input: { site: Site; workspace: string; recipe: AppRecipe }): Promise<void>;
  /** Hand the site to the environment supervisor. Reached only after the flip is durable. */
  startEnvironment(site: Site): Promise<void>;
  /** Stop the environment container and RESOLVE only once it has actually exited. A rollback that
   *  exported a live volume would capture a torn SQLite page, which is the same defect the legacy
   *  quiesce exists to prevent, on the other side of the conversion. */
  stopContainer(siteId: string): Promise<void>;
  /** Whether the container has reached a stopped state, checked rather than inferred from the stop. */
  containerStopped(siteId: string): Promise<boolean>;
  /** Prove the container and volume carrying this site's name were created by THIS plugin for THIS site.
   *  A name is not ownership: a foreign object that happens to share the name must be refused, never
   *  adopted and never deleted. Returns null when nothing with that name exists. */
  inspectOwnership(
    siteId: string,
    expect: { workspace: string; image: string },
  ): Promise<{ owned: boolean; workspace: string | null; detail: string } | null>;
  /** The image tag a recipe's derivative resolves to right now. Compared against what an existing
   *  container was created from, so a container built on a superseded and possibly vulnerable image is
   *  rebuilt rather than reused. */
  conversionImageTag(recipe: AppRecipe): string;
  /** Whether the converted site actually answers ITS OWN invariant over real HTTP.
   *
   *  The recipe supplies the request and the status it must produce, because only the application knows
   *  one that fails when it is down. A connectable socket does not: the ingress proxy accepts whether or
   *  not anything is listening behind it. */
  verifyReadiness(site: Site, expect: AppRecipe['readiness']): Promise<{ ready: boolean; detail: string }>;
  /** Tear down container, volume and, when it is ours to remove, the broker directory. Idempotent.
   *
   *  `removeBroker` is false whenever the directory belongs to a live legacy writer. */
  discardContainer(siteId: string, options: { removeBroker: boolean }): Promise<void>;
  /** Whether the broker directory this site's container mounts is already on disk. */
  brokerDirectoryExists(siteId: string): boolean;
  /** Have the gateway create it. Never a plugin-side mkdir: the directory is root-owned. */
  prepareBrokerDirectory(siteId: string): Promise<void>;
  /** Remove a path the container may have written into, through the user namespace that owns it. */
  removeStaged(paths: readonly string[]): Promise<void>;

  // --- completion. Retiring the staged copy, so a converted site ends up with ONE working copy. ---

  /** Rebuild the container on `site.sourceDir` and leave it NOT running, ready to be seeded. The staged
   *  container and its volume are gone when this resolves, which is why the volume is exported first. */
  rebindToSource(site: Site): Promise<void>;
  /** Turn the moved binding into an ordinary live one: no staging, running intent. Reached only after the
   *  rebuilt container has answered. */
  publishBinding(site: Site): void;
  /** Delete the conversion's spent seed directory from the persistent volume, from inside the container
   *  that is still running. */
  clearConversionStage(site: Site, stageDir: string): Promise<void>;

  // --- data movement. Absent only for a site with nothing outside its release. ---

  /** Ask the SANDBOX where this site's confined process keeps its data, and the RECIPE which subtrees
   *  under it belong to this app.
   *
   *  Both halves are required and neither is caller-supplied: the home is proved against the roots the
   *  sandbox granted, and the includes come from the site's validated recipe. Two sites can share one
   *  home, so the home alone never identifies a site's data. */
  resolveLegacyData(site: Site): Promise<LegacyDataSelection | null>;
  /** The home of the process that is ACTUALLY RUNNING for this site, read from the live runtime rather
   *  than from a fresh sandbox preparation. A new preparation can be handed a different home than the
   *  running lease holds, and capturing from that one would archive the wrong directory. Null when no
   *  process is running, which is what a resumed flip after a stop legitimately sees. */
  runningLegacyHome(siteId: string): string | null;
  /** Snapshot the app-owned subtrees. Called only after the legacy process is verified stopped. */
  captureLegacyData(siteId: string, selection: LegacyDataSelection): Promise<string | null>;
  /** Pack the provisioning script, the application unit, the captured data and the secrets into one
   *  archive for the data volume. */
  buildSeedArchive(siteId: string, input: { provisionScript: string; appUnit: string; dataArchive: string | null }): Promise<string>;
  /** Seed the environment's persistent data volume before its container has ever run. */
  loadDataVolume(site: Site, seedArchive: string): Promise<void>;
  /** Export the environment's data volume, so writes made while converted can travel back. */
  exportDataVolume(site: Site, output: string): Promise<boolean>;
  /** Unpack an archive back over the SAME app-owned subtrees the capture was confined to. */
  restoreLegacyData(selection: LegacyDataSelection, archive: string, siteId: string): Promise<void>;
  /** Finish a restore a crash interrupted, before anything else reads the tree. */
  recoverInterruptedRestore(siteId: string): { recovered: string | null };
  /** Give a staged STATIC tree the modes the serving process needs, and its ancestors traversal.
   *  Called only after the secrets have been lifted out and the tree audited. */
  relaxStaticServing(siteId: string, workspace: string): void;
  /** Move the recipe's secret files out of the staged workspace into the protected artefact directory. */
  extractSecretArtifacts(siteId: string, workspace: string, files: readonly string[]): string[];
  /** A digest over the staged secrets' names AND bytes, so a flip re-derives the same value only when
   *  nothing about them changed. */
  stagedSecretDigest(siteId: string): string;
  /** Absolute path of a named artifact for a site, without creating it. */
  artifactPath(siteId: string, name: string): string;
  /** Drop every artifact this conversion wrote for a site. */
  discardArtifacts(siteId: string): void;

  now?(): Date;
}

export interface MigrationStatus {
  siteId: string;
  stage: RuntimeMigration['stage'] | 'none';
  fromRuntime: ConvertibleRuntime | null;
  contentDigest: string | null;
  lastError: string | null;
}

/** Where a site's staged workspace lives. Derived from the site id, never from a caller argument. */
export const stagedWorkspace = (deps: Pick<MigrationDeps, 'siteDir'>, siteId: string): string =>
  join(deps.siteDir(siteId), 'migration', 'workspace');

/** Everything one conversion wrote under the site's own plugin directory: the staged copy, the recipe,
 *  the secrets it lifted out and every archive it packed. Removed as one tree when the site no longer has
 *  a staged copy to serve from. */
const migrationDirectory = (deps: Pick<MigrationDeps, 'siteDir'>, siteId: string): string =>
  join(deps.siteDir(siteId), 'migration');

/** What boot recovery writes onto a conversion a restart interrupted. Built in one place because a
 *  completion has to RECOGNISE it: a conversion interrupted after its flip is not a failed conversion,
 *  it is a finished one whose last step nobody got to run. */
export const interruptedByRestart = (stage: RuntimeMigration['stage']): string =>
  `interrupted by a restart while ${stage}; re-claim to retry or roll back`;

/** How far a completion got, kept on the site's runtime records rather than in memory: it destroys the
 *  staged container and rebuilds it, so a driver that dies half way has to be able to pick the operation
 *  up rather than start it again from a volume that no longer exists. */
const COMPLETION_RECORD = 'completion';
/** The export of the persistent volume, taken before the staged container is retired and read back once
 *  its replacement exists. While this file is the only copy of the site's data, nothing removes it. */
const COMPLETION_ARCHIVE = 'completion-data.tar';

/** A stable digest over a directory tree: relative path, size and bytes of every file, in sorted order.
 *
 *  Sorted because readdir order is filesystem-dependent, and a digest that changed between two identical
 *  trees would fail every verification for no reason. Paths are normalised to forward slashes so the
 *  value does not encode the host's separator. */
export function digestTree(root: string): string {
  const hash = createHash('sha256');
  // One buffer for the whole tree: a command release runs to tens of thousands of small files, and a
  // fresh chunk-sized allocation per file would cost far more than the reads it serves.
  const buffer = Buffer.allocUnsafe(DIGEST_CHUNK_BYTES);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = join(dir, entry.name);
      // Symlinks are hashed by their own presence rather than followed: following one would let a link
      // inside a release pull an arbitrary host file into the digest, and into the comparison that
      // decides a flip is safe.
      if (entry.isSymbolicLink()) { hash.update(`L ${relative(root, full).split(sep).join('/')}\n`); continue; }
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile()) continue;
      const rel = relative(root, full).split(sep).join('/');
      hash.update(`F ${rel} ${statSync(full).size}\n`);
      // Fed to the digest a chunk at a time. A release may hold an asset far larger than the daemon's
      // heap, and reading one whole would fail the conversion on the very files the streaming serve
      // path exists to carry.
      const fd = openSync(full, constants.O_RDONLY);
      try {
        for (;;) {
          const read = readSync(fd, buffer, 0, buffer.length, null);
          if (read === 0) break;
          hash.update(buffer.subarray(0, read));
        }
      } finally {
        closeSync(fd);
      }
    }
  };
  if (existsSync(root)) walk(root);
  return hash.digest('hex');
}

/** The mount point the runtime binds an empty file over so a converted site has no Git repository of its
 *  own inside its workspace. It exists on the host because the bind source lives in the mounted tree, and
 *  copying it into a Project folder would drop an unreadable `.git` file into somebody's repository. */
const GIT_STUB_ENTRY = '.git';

/** Fold the staged workspace back into the site's own source folder, so the two become one working copy.
 *
 *  ADDITIVE, NEVER DESTRUCTIVE. A file that exists only in the source folder is left exactly where it is:
 *  the staged copy came from a published release, so anything the author wrote since is newer work, not a
 *  deletion the container made. A file the container changed is newer than the one in the source folder
 *  and replaces it; anything else is left alone. The comparison is the modification time, because that is
 *  the only ordering both sides actually carry — the staged copy was written with the release's own
 *  timestamps preserved.
 *
 *  `skip` carries the recipe's secret files. They were lifted out of the staged copy before it was ever
 *  mounted and the container's own bootstrap installs them back into its workspace, so they are the
 *  environment's to hold; copying them here would write credentials into a Project folder instead.
 *
 *  Returns the relative paths that were written, so a caller can report what a completion actually moved. */
export function reconcileIntoSource(workspace: string, sourceDir: string, skip: readonly string[]): string[] {
  const skipped = new Set([...skip, GIT_STUB_ENTRY]);
  const written: string[] = [];
  if (!existsSync(workspace)) return written;
  mkdirSync(sourceDir, { recursive: true });
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (skipped.has(rel)) continue;
      const from = join(dir, entry.name);
      const to = join(sourceDir, ...rel.split('/'));
      if (entry.isDirectory()) {
        mkdirSync(to, { recursive: true });
        walk(from, rel);
        continue;
      }
      // A symlink is carried across as a symlink and never followed, on the same reasoning the digest
      // uses: following one would copy whatever it points at, including a file outside the workspace.
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (existsSync(to)) {
        const staged = lstatSync(from);
        const current = lstatSync(to);
        if (staged.mtimeMs <= current.mtimeMs) continue;
        rmSync(to, { recursive: true, force: true });
      }
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to, { dereference: false, preserveTimestamps: true, recursive: false });
      // `cpSync` preserves a regular file's timestamps but has nothing to preserve them from for a
      // symlink it recreated, so the ordering this function decides on is restored explicitly.
      if (entry.isFile()) {
        const staged = statSync(from);
        utimesSync(to, staged.atime, staged.mtime);
      }
      written.push(rel);
    }
  };
  walk(workspace, '');
  return written;
}

/** One value covering everything a flip is about to trust: the workspace as it will be mounted, the names
 *  of the secrets that were lifted out of it, and the recipe that decides what runs.
 *
 *  All three together, because any one of them changing alone is enough to make the container serve
 *  something nobody verified: a swapped file in the workspace, a secret added or removed, or a recipe
 *  edited to run a different command against the same tree. */
export function finalArtifactDigest(
  workspace: string,
  secretDigest: string,
  recipe: Pick<AppRecipe, 'kind' | 'argv' | 'env' | 'dataIncludes' | 'dataDir' | 'secretFiles' | 'image' | 'readiness'>,
): string {
  const hash = createHash('sha256');
  hash.update(digestTree(workspace));
  // The secrets by their BYTES, not their names: swapping the contents of a file leaves the name list
  // identical, and that substitution is exactly what this is meant to catch.
  hash.update('\0secrets\0');
  hash.update(secretDigest);
  hash.update('\0recipe\0');
  hash.update(JSON.stringify({
    kind: recipe.kind,
    argv: recipe.argv,
    env: Object.fromEntries(Object.entries(recipe.env).sort(([a], [b]) => (a < b ? -1 : 1))),
    dataIncludes: [...recipe.dataIncludes].sort(),
    dataDir: recipe.dataDir,
    secretFiles: [...recipe.secretFiles].sort(),
    image: recipe.image,
    readiness: recipe.readiness,
  }));
  return hash.digest('hex');
}

/** The site as the LEGACY runtime knew it, rebuilt from what the claim captured.
 *
 *  A rollback has to ask where the legacy data lives, but by then the site row already says
 *  `environment`: the flip changed it, which is the whole point. Every resolver downstream keys off
 *  `runtime`, so handing it the live row makes it answer for a runtime that no longer describes the
 *  question. The conversion recorded the original runtime, command, bind, port and release precisely so
 *  this can be reconstructed rather than guessed. */
export const legacyDescriptor = (site: Site, migration: RuntimeMigration): Site => ({
  ...site,
  runtime: migration.fromRuntime,
  startCommand: migration.fromStartCommand,
  bind: migration.fromBind,
  port: migration.fromPort,
  // The release the legacy runtime actually served. `current_release_id` is never touched by a
  // conversion, so these agree today, but reading the captured one keeps that from being an assumption.
  currentReleaseId: migration.fromReleaseId ?? site.currentReleaseId,
});

export class RuntimeMigrationService {
  constructor(private readonly deps: MigrationDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  status(siteId: string): MigrationStatus {
    const migration = this.deps.store.runtimeMigration(siteId);
    if (!migration) return { siteId, stage: 'none', fromRuntime: null, contentDigest: null, lastError: null };
    return {
      siteId,
      stage: migration.stage,
      fromRuntime: migration.fromRuntime,
      contentDigest: migration.contentDigest,
      lastError: migration.lastError,
    };
  }

  /** Register a validated recipe, bound to this site and the release it serves right now.
   *
   *  Refused while a conversion is in flight: changing the recipe under a prepared container would leave
   *  the flip verifying a digest that no longer describes what is about to run. */
  registerRecipe(siteId: string, expectedReleaseId: string, recipe: unknown): AppRecipe {
    const existing = this.deps.store.runtimeMigration(siteId);
    if (existing && existing.lastError === null) {
      throw new MigrationRefused('a conversion is in flight for this site; roll it back before changing the recipe');
    }
    return this.deps.installRecipe(siteId, { siteId, expectedReleaseId, recipe });
  }

  /** Claim the site and build its container from a copy of the live release.
   *
   *  Leaves the container built but NOT running. For a command site that is not a preference: its broker
   *  socket directory is occupied by the live process, and the environment start sequence would `rm -rf`
   *  that directory out from under it. Preparing without starting keeps both runtimes off each other
   *  until {@link flip} quiesces the legacy one. */
  async prepare(siteId: string, recipe: RecipeKind): Promise<MigrationStatus> {
    const site = this.deps.store.siteById(siteId);
    if (!site) throw new MigrationRefused('this site does not exist');
    if (site.runtime === 'environment') throw new MigrationRefused('this site is already a persistent environment');
    if (site.runtime === 'unsupported') throw new MigrationRefused('this site has an unsupported runtime and cannot be converted');

    const existing = this.deps.store.runtimeMigration(siteId);
    // A prepared conversion is re-preparable only after it failed; re-staging under a live claim would
    // rebuild the workspace a flip may already be verifying against.
    if (existing?.stage === 'flipped' && existing.lastError === null) {
      throw new MigrationRefused('this site is already converted; roll it back before preparing again');
    }
    if (!this.deps.store.tryClaimRuntimeMigration({ siteId, recipe, requestedAt: this.now().toISOString() })) {
      throw new MigrationRefused('this site is busy: another conversion, snapshot, rollback or shell holds it');
    }

    try {
      const claimed = this.deps.store.runtimeMigration(siteId);
      if (!claimed?.fromReleaseId) throw new Error('the conversion claim recorded no release to stage from');
      // The recipe was approved for ONE site and ONE published build. A republish since then means the
      // argv and the files no longer describe each other.
      const binding = this.deps.recipeBinding(siteId);
      if (!binding) throw new MigrationRefused('no conversion recipe is registered for this site');
      if (binding.siteId !== siteId) {
        throw new MigrationRefused(`the registered recipe belongs to site ${binding.siteId}`);
      }
      if (binding.expectedReleaseId !== claimed.fromReleaseId) {
        throw new MigrationRefused(
          `the registered recipe was approved for release ${binding.expectedReleaseId}, but the site now serves ${claimed.fromReleaseId}`,
        );
      }
      const source = this.deps.releaseDir(siteId, claimed.fromReleaseId);
      if (!existsSync(source)) throw new Error(`the live release directory is missing: ${source}`);

      const workspace = stagedWorkspace(this.deps, siteId);

      // OWNERSHIP AND MOUNT VALIDITY, before anything is destroyed.
      //
      // A container already carrying this site's name is not automatically ours, and even ours may be
      // stale: `prepareContainer` no-ops on an existing container, so re-staging the workspace under one
      // that bind-mounted the OLD directory leaves it mounting a deleted inode. The site would then serve
      // whatever the removed tree used to be, or nothing, with every status reporting success.
      // The FULL specification, not just the label. A container that is ours can still have been built
      // on a superseded image: the derivative tag embeds the digest of its Containerfile and its nginx
      // configuration, so a security fix to either produces a new tag, and a container still carrying
      // the old one is exactly the vulnerable thing that must not be reused.
      const expectedImage = this.deps.conversionImageTag(this.deps.loadRecipe(siteId));
      const existingContainer = await this.deps.inspectOwnership(siteId, { workspace, image: expectedImage });
      if (existingContainer && !existingContainer.owned) {
        throw new MigrationRefused(
          `a container or volume named for this site exists but is not this plugin's: ${existingContainer.detail}`,
        );
      }
      if (existingContainer?.owned) {
        // Any difference at all, including a stale image, means the container is discarded and rebuilt.
        // Reusing one that merely matches by name is how an old vulnerable build stays in service.
        // The broker survives: at this point the legacy runtime may still be serving on it.
        await this.deps.discardContainer(siteId, { removeBroker: false });
      }

      // THE BIND SOURCE MUST EXIST BEFORE `podman create`.
      //
      // Podman statfs-es every bind source at create time, so a missing broker directory fails the whole
      // create with 125 and no container is made. A command site hid this: its live process already had
      // the gateway create the directory, so the conversion silently inherited one. A static or PHP site
      // has none, and a loopback-bound command site has none either, so all three failed.
      //
      // Created through the GATEWAY, never a plugin mkdir: the directory is root-owned with a mode the
      // service account cannot produce.
      if (!this.deps.brokerDirectoryExists(siteId)) {
        // Recorded BEFORE the call, so a crash between the two leaves a directory cleanup knows it owns.
        // The reverse order would leave an orphan nobody is responsible for.
        this.deps.store.markBrokerPrepared(siteId, true);
        await this.deps.prepareBrokerDirectory(siteId);
      }
      // When it already exists it belongs to the live legacy runtime, and it is left exactly alone. It is
      // not re-prepared: `prepare-runtime-socket` does `rm -rf`, which would delete the socket a serving
      // process is answering on. The flip re-prepares it only after that process is verified stopped, and
      // the container is not running then, so no established mount is left pointing at a dead inode.

      // Only now, with no container holding it, is the tree safe to recreate. A previous failed attempt
      // may have left a partial tree the container wrote into as a non-root user, so removal goes through
      // the namespace-aware path rather than a plain rm.
      await this.deps.removeStaged([workspace]);
      mkdirSync(workspace, { recursive: true, mode: 0o700 });
      // The RELEASE, not `sourceDir`. `.env` and any other file the release carries travels as a file
      // inside the workspace, which is also how a legacy command site reads it today — so no credential
      // is passed through Podman argv, an env file or anything `podman inspect` would show.
      cpSync(source, workspace, { recursive: true, dereference: false, preserveTimestamps: true });

      const digest = digestTree(workspace);
      const sourceDigest = digestTree(source);
      if (digest !== sourceDigest) throw new Error('the staged copy does not match the release it was taken from');
      this.deps.store.recordRuntimeMigrationDigest(siteId, digest);

      // Read BEFORE anything is built, so a recipe that cannot be vouched for stops the conversion while
      // the site is still untouched.
      const recipe = this.deps.loadRecipe(siteId);
      // The secrets leave the writable copy before the container is ever pointed at it, and the release
      // they came from is never edited: the move happens on the COPY.
      const movedSecrets = this.deps.extractSecretArtifacts(siteId, workspace, recipe.secretFiles);

      // A STATIC tree is inspected as FILES before the container is ever pointed at it. nginx refuses
      // symlinks at request time, but a release that carries one into its own secrets should never get
      // as far as being built, and a file that resolves outside the workspace is not servable at all.
      if (recipe.image === 'static') {
        const offenders = auditStaticTree(workspace);
        if (offenders.length > 0) {
          throw new MigrationRefused(`this release cannot be served as a static site: ${offenders.slice(0, 5).join('; ')}`);
        }
        // AFTER the secrets are out and the tree is audited, never before: widening a tree that still
        // held a credential would publish it for the window in between. nginx workers drop to a
        // non-root user that maps into the subuid range, so a 0700 tree is unreadable to them and the
        // site answers 404 while every status reports success.
        this.deps.relaxStaticServing(siteId, workspace);
      }

      // The digest above proved the copy matched the release. This one covers the workspace as it will
      // actually be MOUNTED, which is a different tree because the secrets have just left it, and binds
      // in the secret names and the recipe so a flip can prove none of the three moved in between.
      void movedSecrets;
      this.deps.store.recordRuntimeMigrationFinalDigest(
        siteId,
        finalArtifactDigest(workspace, this.deps.stagedSecretDigest(siteId), recipe),
      );

      await this.deps.prepareContainer({ site, workspace, recipe });
      if (!this.deps.store.advanceRuntimeMigration(siteId, 'preparing', 'prepared')) {
        throw new Error('the conversion slot moved while the container was being prepared');
      }
      return this.status(siteId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.store.failRuntimeMigration(siteId, message);
      throw error;
    }
  }

  /** Quiesce the legacy runtime, flip the column, then start the container that is already built.
   *
   *  The order is the whole point. The legacy stop is awaited and then VERIFIED, because a command site
   *  and its replacement would otherwise both hold the same source tree and the same broker socket path.
   *  The flip is durable before the environment is started, so a crash in between resumes forward into a
   *  site that is already an environment rather than one that is half of each. */
  async flip(siteId: string): Promise<MigrationStatus> {
    const migration = this.deps.store.runtimeMigration(siteId);
    if (!migration) throw new MigrationRefused('this site has no conversion to flip');
    if (migration.stage === 'flipped') return this.status(siteId);
    if (migration.stage !== 'prepared') throw new MigrationRefused('this conversion has not finished preparing');
    // Reported BEFORE the generic failure, because it is the more urgent and more actionable fact: a
    // previous attempt stopped the legacy runtime and never replaced it, so the site is DOWN right now.
    // Retrying from here would also run the whole flip against a stopped site and capture from a tree
    // nothing is writing to, with no live process left to prove whose it is.
    if (migration.legacyStopped) {
      throw new MigrationRefused(
        'this conversion stopped the legacy runtime and has not restored it; recover or roll back before retrying',
      );
    }
    if (migration.lastError !== null) throw new MigrationRefused('this conversion failed; retry the preparation first');

    const site = this.deps.store.siteById(siteId);
    if (!site) throw new MigrationRefused('this site does not exist');

    try {
      // DEFECT 8, the other half: prove nothing moved between preparing and flipping. The workspace is
      // about to be mounted read-write into a container that will serve the internet, so it is checked
      // against the digest recorded when it was verified, together with the secrets and the recipe.
      const recipe = this.deps.loadRecipe(siteId);
      const workspace = stagedWorkspace(this.deps, siteId);
      if (migration.finalDigest === null) throw new Error('this conversion recorded no verified artifact digest');
      const verify = (): void => {
        const observed = finalArtifactDigest(workspace, this.deps.stagedSecretDigest(siteId), recipe);
        if (observed !== migration.finalDigest) {
          throw new Error('the staged workspace, secrets or recipe changed after they were verified');
        }
      };
      verify();

      // TOCTOU: the seed is packed from the SAME files the check just read, and re-verified immediately
      // afterwards. Checking once and packing later leaves a window in which the bytes that reach the
      // container are not the bytes that were approved.
      const earlySeedInputs = { provisionScript: provisionScript(recipe), appUnit: appUnit(recipe) };

      // DEFECT 7: the home to capture comes from the process that is ACTUALLY RUNNING, read before the
      // stop. A fresh sandbox preparation can be handed a different home than the running lease holds,
      // and archiving that one would take the wrong directory — or, on a shared home, somebody else's.
      let location: LegacyDataSelection | null = null;
      if (migration.fromRuntime === 'command' && recipe.dataIncludes.length > 0) {
        const declared = await this.deps.resolveLegacyData(legacyDescriptor(site, migration));
        if (!declared) throw new Error('this site declares app data but its data directory could not be resolved');

        // A RETRY must not re-derive provenance. The first attempt recorded the home of the process that
        // was actually running; by the time a retry gets here that process is gone, `runningLegacyHome`
        // answers null, and accepting whatever the sandbox now offers would archive a different
        // directory — on a shared home, the neighbour's.
        const remembered = migration.legacyHome;
        if (remembered !== null) {
          if (resolve(remembered) !== resolve(declared.home)) {
            throw new Error(
              `this conversion recorded ${remembered} as the site's home but the sandbox now reports ${declared.home}`,
            );
          }
        } else {
          const running = this.deps.runningLegacyHome(siteId);
          // Null here is not "no opinion", it is "the process this conversion is about is not running",
          // and capturing without live provenance is how the wrong tree gets archived.
          if (running === null) {
            throw new Error('the legacy process is not running, so its data directory cannot be proven before capture');
          }
          if (resolve(running) !== resolve(declared.home)) {
            throw new Error(
              `the running process uses ${running} but the sandbox now reports ${declared.home}; refusing to capture the wrong home`,
            );
          }
          this.deps.store.recordLegacyHome(siteId, resolve(running));
        }
        location = declared;
      }

      if (migration.fromRuntime === 'command') {
        // DEFECT 2: durable BEFORE the stop. A crash after this leaves a marker for a runtime that may
        // still be up, and recovery starting something already running is harmless. The other order
        // leaves a stopped site that nothing knows it owes a restart to.
        this.deps.store.markLegacyStopped(siteId, true);
        await this.deps.stopLegacyRuntime(siteId);
        // Verified rather than assumed: two writers on one source tree is the failure this operation is
        // built to prevent, and a stop that silently did nothing looks exactly like one that worked.
        if (this.deps.legacyRunning(siteId)) {
          throw new Error('the legacy command process is still running after an awaited stop');
        }
      }

      // The snapshot happens in the quiesced window and nowhere else. Before the stop it would capture a
      // torn database; after the flip the container owns the volume and the legacy tree is already stale.
      // The volume is seeded UNCONDITIONALLY, because the provisioning script and the application unit
      // travel through it even for an app with no data to carry. Skipping the seed when there is no
      // capture is how a container ends up running with nothing listening behind its ingress.
      const dataArchive = location ? await this.deps.captureLegacyData(siteId, location) : null;
      // Re-verified here, immediately before the bytes are packed, so the window between approving them
      // and using them contains no await that could let them change.
      verify();
      const seed = await this.deps.buildSeedArchive(siteId, { ...earlySeedInputs, dataArchive });
      await this.deps.loadDataVolume(site, seed);

      if (!this.deps.store.flipSiteRuntimeToEnvironment(siteId)) {
        throw new Error('the site runtime could not be flipped; it changed underneath the conversion');
      }
      // The legacy runtime is gone for good on this path: the column now says environment, so the marker
      // has no restart left to owe.
      this.deps.store.markLegacyStopped(siteId, false);

      const flipped = this.deps.store.siteById(siteId);
      if (!flipped) throw new Error('the site disappeared during the flip');
      // Starts the container prepared above: the provider creates only when none exists, so the writable
      // layer built during preparation is reused rather than thrown away.
      await this.deps.startEnvironment(flipped);
      return this.status(siteId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.store.failRuntimeMigration(siteId, message);
      throw error;
    }
  }

  /** Retire the staged copy, so the converted site is left with ONE working copy and no way back.
   *
   *  WHY A CONVERSION HAS TWO WORKING COPIES UNTIL THIS RUNS. A preparation stages the published release
   *  into a copy it owns and mounts THAT, because the flip must serve the bytes it verified rather than
   *  whatever the source folder holds at the time. The consequence is a site whose container serves one
   *  directory while every agent and every tool edits another. Completion ends that: the staged copy is
   *  folded back into the site's own source folder, the container is rebuilt on the source folder, and the
   *  conversion's directory is removed. What is left is indistinguishable from a natively created
   *  environment — same mount, no staging binding, no artefacts.
   *
   *  THE ORDER IS THE OPERATION. Each step is durable before the one it unlocks, so a driver that dies
   *  half way is resumed by calling this again rather than starting over:
   *
   *  1. The files are folded into the source folder while the staged copy is still being served, so a
   *     failure there changes nothing at all.
   *  2. The spent seed leaves the persistent volume and the volume is exported to an archive. Nothing is
   *     destroyed before that archive exists, because retiring the container takes its volume with it.
   *  3. The container is rebuilt on the source folder, and the archive is loaded back into the new volume
   *     together with a fresh seed — the first boot consumed the credentials the old one carried.
   *  4. The site is started and has to ANSWER before the binding is published as live.
   *  5. Only then does the conversion's directory go, and last of all the row: while it exists this
   *     operation still owns the site, and dropping it is the point of no return. */
  async complete(siteId: string): Promise<MigrationStatus> {
    const migration = this.deps.store.runtimeMigration(siteId);
    // Nothing left to retire. A second call after the row is gone answers with the site's status rather
    // than refusing, because a resumed driver cannot tell "already finished" from "never started".
    if (!migration) return this.status(siteId);
    if (migration.stage !== 'flipped' && migration.stage !== 'completing') {
      throw new MigrationRefused('only a flipped conversion can be completed');
    }
    const site = this.deps.store.siteById(siteId);
    if (site?.runtime !== 'environment') throw new MigrationRefused('this site is not serving as an environment');
    const recipe = this.deps.loadRecipe(siteId);
    const resumed = this.deps.store.runtimeRecord(siteId, COMPLETION_RECORD) !== null;
    // A flipped column and a started container are not a serving site, so completing demands that the
    // site actually answers. Asked only while the staged container is still the one serving: past that
    // point this operation has taken the site down itself, and its own start is what proves it came back.
    if (!resumed) {
      const readiness = await this.deps.verifyReadiness(site, recipe.readiness);
      if (!readiness.ready) {
        throw new MigrationRefused(`this site is not answering yet, so the conversion cannot be completed: ${readiness.detail}`);
      }
    }
    // A flip whose start threw is still recorded as flipped, because the column move is durable before the
    // start. Completing THAT would drop the only record of how to get back, on a site that never came up.
    // A restart that landed between the flip and the completion is the one exception: it recorded a
    // failure for a site that is up and serving, and the claim below is what tells the two apart.
    if (!this.deps.store.beginRuntimeCompletion(siteId, interruptedByRestart('flipped'))) {
      throw new MigrationRefused(
        `this conversion failed and cannot be completed: ${migration.lastError ?? 'the conversion slot moved underneath it'}`,
      );
    }

    try {
      if (!resumed) {
        reconcileIntoSource(stagedWorkspace(this.deps, siteId), site.sourceDir, recipe.secretFiles);
        // The seed goes while the container can still be asked, and the export is taken from a stopped
        // container for the same reason a rollback stops one first: a live volume exports a torn page.
        await this.deps.clearConversionStage(site, CONVERSION_STAGE);
        await this.deps.stopContainer(siteId);
        if (!await this.deps.containerStopped(siteId)) {
          throw new Error('the environment container is still running, so its data cannot be exported consistently');
        }
        await this.deps.exportDataVolume(site, this.deps.artifactPath(siteId, COMPLETION_ARCHIVE));
        this.deps.store.putRuntimeRecord(siteId, COMPLETION_RECORD, 'exported');
      }

      if (this.completionProgress(siteId) === 'exported') {
        await this.deps.rebindToSource(site);
        this.deps.store.putRuntimeRecord(siteId, COMPLETION_RECORD, 'rebound');
      }

      if (this.completionProgress(siteId) === 'rebound') {
        const carried = this.deps.artifactPath(siteId, COMPLETION_ARCHIVE);
        if (existsSync(carried)) await this.deps.loadDataVolume(site, carried);
        // The seed is rebuilt rather than carried: the bootstrap unit deletes the credentials and the
        // application unit it installed on first boot, so the archive above holds neither, and the
        // container this completion built has a rootfs that never saw them.
        await this.deps.loadDataVolume(site, await this.deps.buildSeedArchive(siteId, {
          provisionScript: provisionScript(recipe), appUnit: appUnit(recipe), dataArchive: null,
        }));
        this.deps.store.putRuntimeRecord(siteId, COMPLETION_RECORD, 'seeded');
      }

      if (this.completionProgress(siteId) === 'seeded') {
        await this.deps.startEnvironment(site);
        const readiness = await this.deps.verifyReadiness(site, recipe.readiness);
        if (!readiness.ready) {
          throw new Error(`the site does not answer from its own source folder: ${readiness.detail}`);
        }
        this.deps.store.putRuntimeRecord(siteId, COMPLETION_RECORD, 'live');
      }

      // The conversion's directory goes BEFORE the binding is published: removing it is an operation on a
      // staging binding, and publishing is what ends that. Both happen only once the site has answered.
      const directory = migrationDirectory(this.deps, siteId);
      if (existsSync(directory)) await this.deps.removeStaged([directory]);
      this.deps.publishBinding(site);
      this.deps.store.deleteRuntimeRecord(siteId, COMPLETION_RECORD);
      this.deps.store.clearRuntimeMigration(siteId);
      return this.status(siteId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.store.failRuntimeMigration(siteId, message);
      throw error;
    }
  }

  private completionProgress(siteId: string): string | null {
    return this.deps.store.runtimeRecord(siteId, COMPLETION_RECORD);
  }

  /** Finish the completions nobody is driving.
   *
   *  A conversion that a restart interrupted after its flip is a finished conversion with one step left,
   *  and the site is serving from a staged copy until that step runs — which is exactly the state an
   *  operator cannot see and would not know to fix. So the periodic reconcile finishes it: a flipped slot
   *  carrying only the restart marker, or a completion of its own that a restart cut short.
   *
   *  A completion that FAILED for any other reason is left alone. It recorded why on the row, and
   *  retrying it every two seconds would bury that reason under its own repetitions. */
  async reconcileCompletions(): Promise<MigrationStatus[]> {
    const settled: MigrationStatus[] = [];
    for (const migration of this.deps.store.runtimeMigrations()) {
      const resumable = migration.stage === 'flipped'
        ? migration.lastError === interruptedByRestart('flipped')
        : migration.stage === 'completing'
          && (migration.lastError === null || migration.lastError === interruptedByRestart('completing'));
      if (!resumable) continue;
      try { settled.push(await this.complete(migration.siteId)); }
      catch (error) {
        // A refusal means the site is not ready to be completed yet, and the next sweep asks again. A
        // fault is already recorded on the row, so it is reported rather than rethrown: one site that
        // cannot finish must not stop the sweep from finishing the others.
        if (!(error instanceof MigrationRefused)) settled.push(this.status(migration.siteId));
      }
    }
    return settled;
  }

  /** Put one site back the way it was, from any stage.
   *
   *  Serving is restored BEFORE the container is torn down, so the gap is the restore itself rather than
   *  the cleanup behind it. Releases and `current_release_id` were never touched, so a static site
   *  resumes from its release directory: the editable source is not exposed by a rollback, because the
   *  static path never reads it. */
  async rollback(siteId: string, options: { restoreData?: boolean } = {}): Promise<MigrationStatus> {
    const migration = this.deps.store.runtimeMigration(siteId);
    if (!migration) throw new MigrationRefused('this site has no conversion to roll back');
    // A completion has already retired the staged container, and the site's data is in an archive only it
    // knows how to load back. There is nothing left to roll back TO until it has finished.
    if (migration.stage === 'completing') {
      throw new MigrationRefused('this conversion is being completed; finish the completion before rolling anything back');
    }
    const site = this.deps.store.siteById(siteId);
    if (!site) throw new MigrationRefused('this site does not exist');

    if (migration.stage === 'flipped') {
      const carryData = options.restoreData !== false
        && migration.fromRuntime === 'command'
        && this.deps.loadRecipe(siteId).dataIncludes.length > 0;

      // STAGE 1, export. Resumable: once recorded, a retry reads the archive rather than asking a volume
      // the discard may already have removed, which is how a retry used to silently lose every write the
      // container made.
      let carried = migration.rollbackArchive;
      if (carryData && (migration.rollbackStage === 'none' || migration.rollbackStage === 'quiescing')) {
        // DEFECT 1: QUIESCE FIRST. The container is still serving and still writing; exporting its volume
        // live captures a torn SQLite page, exactly the fault the legacy quiesce exists to prevent.
        //
        // The marker is recorded BEFORE the stop, the same discipline `legacyStopped` follows. The row
        // says `environment` and `live` for this whole window, so a periodic reconcile that arrives
        // between the stop and the export sees a container it believes should be up and starts it again.
        // Recorded first, a crash in the gap leaves a marker for a container that may still be running,
        // which the retry resolves harmlessly; the other order leaves a stopped container nobody owns.
        this.deps.store.recordRollbackProgress(siteId, 'quiescing');
        await this.deps.stopContainer(siteId);
        if (!await this.deps.containerStopped(siteId)) {
          throw new Error('the environment container is still running, so its data cannot be exported consistently');
        }
        const output = this.deps.artifactPath(siteId, 'rollback-data.tar');
        carried = await this.deps.exportDataVolume(site, output) ? output : null;
        this.deps.store.recordRollbackProgress(siteId, 'exported', carried);
      } else if (!carryData && (migration.rollbackStage === 'none' || migration.rollbackStage === 'quiescing')) {
        this.deps.store.recordRollbackProgress(siteId, 'quiescing');
        await this.deps.stopContainer(siteId);
        this.deps.store.recordRollbackProgress(siteId, 'exported', null);
        carried = null;
      }

      // STAGE 2, RESTORE, and it happens BEFORE anything is destroyed.
      //
      // The container is already stopped, so it is serving nothing and holding nothing open. Restoring
      // first means a failure here leaves the container and its volume intact and a retry can export
      // again; discarding first would burn the only copy of the writes if the restore then failed.
      if (this.deps.store.runtimeMigration(siteId)?.rollbackStage === 'exported') {
        if (carried) {
          // A crash during an earlier attempt may have left a subtree moved aside but not yet unpacked.
          this.deps.recoverInterruptedRestore(siteId);
          const remembered = migration.legacyHome;
          // Asked about the runtime the conversion RECORDED. The row says `environment` by now, and a
          // resolver keyed off that answers for the wrong thing, or for nothing at all.
          const location = await this.deps.resolveLegacyData(legacyDescriptor(site, migration));
          if (!location) {
            throw new Error('the sandbox could not name this site\'s data directory, so container writes cannot be carried back');
          }
          if (remembered !== null && resolve(remembered) !== resolve(location.home)) {
            throw new Error(`this conversion recorded ${remembered} as the site's home; refusing to restore into ${location.home}`);
          }
          // Atomic per subtree, so a file the container deleted stays deleted rather than being
          // resurrected from the frozen tree underneath.
          await this.deps.restoreLegacyData(location, carried, siteId);
        }
        this.deps.store.recordRollbackProgress(siteId, 'restored');
      }

      // STAGE 3, discard. The data is already back, so losing the container now costs nothing.
      if (this.deps.store.runtimeMigration(siteId)?.rollbackStage === 'restored') {
        await this.deps.discardContainer(siteId, { removeBroker: true });
        this.deps.store.recordRollbackProgress(siteId, 'discarded');
      }

      if (this.deps.store.runtimeMigration(siteId)?.rollbackStage !== 'discarded') {
        throw new Error('the rollback did not finish, so the site was left as an environment');
      }
      if (!this.deps.store.revertSiteRuntimeFromMigration(siteId)) {
        throw new Error('the site runtime could not be restored');
      }
      const restored = this.deps.store.siteById(siteId);
      // The start is AWAITED and it only returns once the endpoint actually answers, so reaching the line
      // below is the proof that the legacy runtime is serving again.
      if (restored?.runtime === 'command') await this.startRestoredLegacy(restored);
      this.deps.store.markLegacyStopped(siteId, false);
      // ONLY NOW. While the conversion held this site, a periodic reconcile may have written `failed` and
      // an error onto the row, and a site left `failed` is absent from `liveCommandSites()` and therefore
      // dark for good. That stale verdict is cleared here, after readiness was proven and never before
      // it: a failure above throws, and an error that is real has to survive.
      this.deps.store.completeRuntimeRollback(siteId);
    } else {
      // Never flipped, so the container never owned anything and there is nothing to carry back.
      //
      // THE BROKER IS ONLY OURS TO REMOVE IF WE MADE IT. A conversion of a socket-bound command site
      // inherited a directory its live process is still answering on; removing it here would take a
      // serving site down and leave that process writing to an unlinked path. Only a directory this
      // conversion asked the gateway to create is removed, and only while no legacy process holds it.
      const ownsBroker = migration.brokerPrepared && !this.deps.legacyRunning(siteId);
      await this.deps.discardContainer(siteId, { removeBroker: ownsBroker });
      if (ownsBroker) this.deps.store.markBrokerPrepared(siteId, false);

      // The legacy runtime may already have been STOPPED by a flip that failed after the quiesce, and a
      // rollback that walked away from that would leave the site dark for good.
      if (migration.legacyStopped) {
        const legacy = this.deps.store.siteById(siteId);
        if (legacy?.runtime === 'command') await this.startRestoredLegacy(legacy);
        this.deps.store.markLegacyStopped(siteId, false);
        // Same rule as the flipped branch: the awaited start is the evidence, and only evidence clears a
        // status the reconciler wrote while this site was held down.
        this.deps.store.completeRuntimeRollback(siteId);
      }
    }

    await this.deps.removeStaged([stagedWorkspace(this.deps, siteId)]);
    this.deps.discardArtifacts(siteId);
    this.deps.store.clearRuntimeMigration(siteId);
    return this.status(siteId);
  }

  /** Start the legacy runtime a rollback has just restored, and make a failure VISIBLE on the site.
   *
   *  The revert clears `last_error` because the runtime column is moving back and the old message
   *  described the other side. If the start then fails and nothing records why, the site is left
   *  `failed` with no reason at all: an operator sees a dark site and no explanation, which is worse
   *  than the stale verdict this whole path exists to clean up. The error is written before it is
   *  rethrown, so the caller still sees the rollback fail. */
  private async startRestoredLegacy(site: Site): Promise<void> {
    try {
      await this.deps.startLegacyRuntime(site);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.store.updateSite(site.id, { status: 'failed', lastError: message });
      throw error;
    }
  }

  /** Settle conversions a restart interrupted, so no slot stays owned by a driver that no longer exists
   *  and no half-built container is left behind.
   *
   *  Deliberately does NOT resume forward. Each stage is settled to a state a person can act on:
   *
   *  - `preparing`: nothing was verified and the site never moved, so the container and staged copy are
   *    discarded as orphans and the slot is marked failed and re-claimable.
   *  - `prepared`: the container is intentional and the site is still serving legacy, so it is kept and
   *    only the ownership marker is released.
   *  - `flipped`: the site is already an environment and its own supervisor reconciles it; the marker is
   *    released so a rollback or a complete can proceed.
   *  - `completing`: the staged copy is already being retired. The marker is recorded the same way, and
   *    {@link reconcileCompletions} recognises it and carries the completion the rest of the way, because
   *    a half-retired conversion has no state a person could usefully act on. */
  async recoverInterrupted(): Promise<MigrationStatus[]> {
    const settled: MigrationStatus[] = [];
    for (const migration of this.deps.store.runtimeMigrations()) {
      // DEFECT 2: the dark-site restart runs BEFORE the already-failed early return, because a failed
      // slot is precisely the case where the site is down. A flip that threw after the quiesce records
      // its error and stops; skipping such a slot on the next boot would leave the site off for good.
      const restarted = await this.restoreStoppedLegacy(migration);
      if (restarted === 'failed') { settled.push(this.status(migration.siteId)); continue; }

      if (migration.lastError !== null) { settled.push(this.status(migration.siteId)); continue; }
      if (migration.stage === 'preparing') {
        // Orphan cleanup, best effort per resource: a container that will not go must not stop the slot
        // being released, or the site can never be retried.
        // Same ownership rule as a rollback: a directory this conversion did not create belongs to the
        // legacy runtime, which may be serving on it right now.
        const ownsBroker = migration.brokerPrepared && !this.deps.legacyRunning(migration.siteId);
        try { await this.deps.discardContainer(migration.siteId, { removeBroker: ownsBroker }); }
        catch { /* reported through the slot */ }
        if (ownsBroker) this.deps.store.markBrokerPrepared(migration.siteId, false);
        try { await this.deps.removeStaged([stagedWorkspace(this.deps, migration.siteId)]); } catch { /* same */ }
        try { this.deps.discardArtifacts(migration.siteId); } catch { /* same */ }
      }

      this.deps.store.failRuntimeMigration(migration.siteId, interruptedByRestart(migration.stage));
      settled.push(this.status(migration.siteId));
    }
    return settled;
  }

  /** Bring back a legacy runtime this conversion stopped and never replaced.
   *
   *  `reconcile` walks live command sites and a half-converted one still says command, so it is not
   *  missing from that set — it is simply not running, and only the durable marker records that the
   *  conversion is the reason. Nothing else in the plugin will ever start it. */
  private async restoreStoppedLegacy(migration: RuntimeMigration): Promise<'none' | 'restarted' | 'failed'> {
    if (!migration.legacyStopped || migration.stage === 'flipped') return 'none';
    const site = this.deps.store.siteById(migration.siteId);
    if (site?.runtime !== 'command') return 'none';
    try {
      await this.deps.startLegacyRuntime(site);
      this.deps.store.markLegacyStopped(migration.siteId, false);
      return 'restarted';
    } catch (error) {
      this.deps.store.failRuntimeMigration(
        migration.siteId,
        `the legacy runtime could not be restarted after an interrupted conversion: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Left marked, so the next boot tries again rather than forgetting a dark site. Recording the
      // failure above is what releases the reconcile guard: an unowned slot no longer holds the site
      // down, so the ordinary sweep takes over the restart while this marker keeps the debt recorded.
      return 'failed';
    }
  }

  /** What a boot or a plugin reload owes. Reports rather than acts: resuming a conversion moves a live
   *  hostname between runtimes, which is an administrator's decision and not a side effect of a restart.
   *  A crash mid-prepare therefore leaves a claimed slot that a person retries or rolls back. */
  pending(): MigrationStatus[] {
    return this.deps.store.runtimeMigrations().map((migration) => ({
      siteId: migration.siteId,
      stage: migration.stage,
      fromRuntime: migration.fromRuntime,
      contentDigest: migration.contentDigest,
      lastError: migration.lastError,
    }));
  }
}

/** Best-effort removal for a tree the container never touched. The namespace-aware path belongs to the
 *  Podman client and is injected, so this stays usable in a test with no Podman at all. */
export const plainRemove = async (paths: readonly string[]): Promise<void> => {
  for (const path of paths) rmSync(path, { recursive: true, force: true });
};
