import { createHash } from 'node:crypto';
import { closeSync, constants, cpSync, existsSync, mkdirSync, openSync, readdirSync, readSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
/** Read size for hashing one tree entry — the digest costs the same memory whatever it is hashing. */
const DIGEST_CHUNK_BYTES = 4 * 1048576;
import { appUnit, auditStaticTree, provisionScript } from './recipe.js';
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
 *  WHY THE CONTAINER IS PREPARED BEFORE THE FLIP AND NOT RECREATED BY IT. `EnvironmentSupervisor.startNow`
 *  creates a container only when `podman inspect` reports it absent; an existing `created` or `exited`
 *  container is STARTED, reusing its own writable layer. So a container this migrator builds ahead of
 *  time survives the flip untouched, and the flip costs a start rather than a rebuild. That property is
 *  load-bearing, not incidental, and {@link prepare} is written to leave the container in exactly that
 *  state.
 *
 *  WHY STATIC CONTENT COMES FROM THE RELEASE. A site serves its RELEASE directory, an immutable published
 *  snapshot; `sourceDir` is the editable working copy the agent may have moved on from. Staging the
 *  source would silently publish unreleased edits under a live hostname the moment the flip lands. */
/** Refusals a caller can act on, kept apart from genuine faults so the API can answer 409 rather than
 *  502 for "somebody else is mid-operation". */
export class MigrationRefused extends Error {
}
/** Where a site's staged workspace lives. Derived from the site id, never from a caller argument. */
export const stagedWorkspace = (deps, siteId) => join(deps.siteDir(siteId), 'migration', 'workspace');
/** A stable digest over a directory tree: relative path, size and bytes of every file, in sorted order.
 *
 *  Sorted because readdir order is filesystem-dependent, and a digest that changed between two identical
 *  trees would fail every verification for no reason. Paths are normalised to forward slashes so the
 *  value does not encode the host's separator. */
export function digestTree(root) {
    const hash = createHash('sha256');
    // One buffer for the whole tree: a command release runs to tens of thousands of small files, and a
    // fresh chunk-sized allocation per file would cost far more than the reads it serves.
    const buffer = Buffer.allocUnsafe(DIGEST_CHUNK_BYTES);
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
            const full = join(dir, entry.name);
            // Symlinks are hashed by their own presence rather than followed: following one would let a link
            // inside a release pull an arbitrary host file into the digest, and into the comparison that
            // decides a flip is safe.
            if (entry.isSymbolicLink()) {
                hash.update(`L ${relative(root, full).split(sep).join('/')}\n`);
                continue;
            }
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!entry.isFile())
                continue;
            const rel = relative(root, full).split(sep).join('/');
            hash.update(`F ${rel} ${statSync(full).size}\n`);
            // Fed to the digest a chunk at a time. A release may hold an asset far larger than the daemon's
            // heap, and reading one whole would fail the conversion on the very files the streaming serve
            // path exists to carry.
            const fd = openSync(full, constants.O_RDONLY);
            try {
                for (;;) {
                    const read = readSync(fd, buffer, 0, buffer.length, null);
                    if (read === 0)
                        break;
                    hash.update(buffer.subarray(0, read));
                }
            }
            finally {
                closeSync(fd);
            }
        }
    };
    if (existsSync(root))
        walk(root);
    return hash.digest('hex');
}
/** One value covering everything a flip is about to trust: the workspace as it will be mounted, the names
 *  of the secrets that were lifted out of it, and the recipe that decides what runs.
 *
 *  All three together, because any one of them changing alone is enough to make the container serve
 *  something nobody verified: a swapped file in the workspace, a secret added or removed, or a recipe
 *  edited to run a different command against the same tree. */
export function finalArtifactDigest(workspace, secretDigest, recipe) {
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
export const legacyDescriptor = (site, migration) => ({
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
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    now() {
        return this.deps.now?.() ?? new Date();
    }
    status(siteId) {
        const migration = this.deps.store.runtimeMigration(siteId);
        if (!migration)
            return { siteId, stage: 'none', fromRuntime: null, contentDigest: null, lastError: null };
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
    registerRecipe(siteId, expectedReleaseId, recipe) {
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
    async prepare(siteId, recipe) {
        const site = this.deps.store.siteById(siteId);
        if (!site)
            throw new MigrationRefused('this site does not exist');
        if (site.runtime === 'environment')
            throw new MigrationRefused('this site is already a persistent environment');
        if (site.runtime === 'unsupported')
            throw new MigrationRefused('this site has an unsupported runtime and cannot be converted');
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
            if (!claimed?.fromReleaseId)
                throw new Error('the conversion claim recorded no release to stage from');
            // The recipe was approved for ONE site and ONE published build. A republish since then means the
            // argv and the files no longer describe each other.
            const binding = this.deps.recipeBinding(siteId);
            if (!binding)
                throw new MigrationRefused('no conversion recipe is registered for this site');
            if (binding.siteId !== siteId) {
                throw new MigrationRefused(`the registered recipe belongs to site ${binding.siteId}`);
            }
            if (binding.expectedReleaseId !== claimed.fromReleaseId) {
                throw new MigrationRefused(`the registered recipe was approved for release ${binding.expectedReleaseId}, but the site now serves ${claimed.fromReleaseId}`);
            }
            const source = this.deps.releaseDir(siteId, claimed.fromReleaseId);
            if (!existsSync(source))
                throw new Error(`the live release directory is missing: ${source}`);
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
                throw new MigrationRefused(`a container or volume named for this site exists but is not this plugin's: ${existingContainer.detail}`);
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
            if (digest !== sourceDigest)
                throw new Error('the staged copy does not match the release it was taken from');
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
            this.deps.store.recordRuntimeMigrationFinalDigest(siteId, finalArtifactDigest(workspace, this.deps.stagedSecretDigest(siteId), recipe));
            await this.deps.prepareContainer({ site, workspace, recipe });
            if (!this.deps.store.advanceRuntimeMigration(siteId, 'preparing', 'prepared')) {
                throw new Error('the conversion slot moved while the container was being prepared');
            }
            return this.status(siteId);
        }
        catch (error) {
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
    async flip(siteId) {
        const migration = this.deps.store.runtimeMigration(siteId);
        if (!migration)
            throw new MigrationRefused('this site has no conversion to flip');
        if (migration.stage === 'flipped')
            return this.status(siteId);
        if (migration.stage !== 'prepared')
            throw new MigrationRefused('this conversion has not finished preparing');
        // Reported BEFORE the generic failure, because it is the more urgent and more actionable fact: a
        // previous attempt stopped the legacy runtime and never replaced it, so the site is DOWN right now.
        // Retrying from here would also run the whole flip against a stopped site and capture from a tree
        // nothing is writing to, with no live process left to prove whose it is.
        if (migration.legacyStopped) {
            throw new MigrationRefused('this conversion stopped the legacy runtime and has not restored it; recover or roll back before retrying');
        }
        if (migration.lastError !== null)
            throw new MigrationRefused('this conversion failed; retry the preparation first');
        const site = this.deps.store.siteById(siteId);
        if (!site)
            throw new MigrationRefused('this site does not exist');
        try {
            // DEFECT 8, the other half: prove nothing moved between preparing and flipping. The workspace is
            // about to be mounted read-write into a container that will serve the internet, so it is checked
            // against the digest recorded when it was verified, together with the secrets and the recipe.
            const recipe = this.deps.loadRecipe(siteId);
            const workspace = stagedWorkspace(this.deps, siteId);
            if (migration.finalDigest === null)
                throw new Error('this conversion recorded no verified artifact digest');
            const verify = () => {
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
            let location = null;
            if (migration.fromRuntime === 'command' && recipe.dataIncludes.length > 0) {
                const declared = await this.deps.resolveLegacyData(legacyDescriptor(site, migration));
                if (!declared)
                    throw new Error('this site declares app data but its data directory could not be resolved');
                // A RETRY must not re-derive provenance. The first attempt recorded the home of the process that
                // was actually running; by the time a retry gets here that process is gone, `runningLegacyHome`
                // answers null, and accepting whatever the sandbox now offers would archive a different
                // directory — on a shared home, the neighbour's.
                const remembered = migration.legacyHome;
                if (remembered !== null) {
                    if (resolve(remembered) !== resolve(declared.home)) {
                        throw new Error(`this conversion recorded ${remembered} as the site's home but the sandbox now reports ${declared.home}`);
                    }
                }
                else {
                    const running = this.deps.runningLegacyHome(siteId);
                    // Null here is not "no opinion", it is "the process this conversion is about is not running",
                    // and capturing without live provenance is how the wrong tree gets archived.
                    if (running === null) {
                        throw new Error('the legacy process is not running, so its data directory cannot be proven before capture');
                    }
                    if (resolve(running) !== resolve(declared.home)) {
                        throw new Error(`the running process uses ${running} but the sandbox now reports ${declared.home}; refusing to capture the wrong home`);
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
            if (!flipped)
                throw new Error('the site disappeared during the flip');
            // Starts the container prepared above: `startNow` creates only when none exists, so the writable
            // layer built during preparation is reused rather than thrown away.
            await this.deps.startEnvironment(flipped);
            return this.status(siteId);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.deps.store.failRuntimeMigration(siteId, message);
            throw error;
        }
    }
    /** Retire the slot once the site is settled as an environment. Deliberately separate from {@link flip}:
     *  while the row exists the site can still be rolled back, and dropping it is the point of no return. */
    async complete(siteId) {
        const migration = this.deps.store.runtimeMigration(siteId);
        if (!migration)
            return this.status(siteId);
        if (migration.stage !== 'flipped')
            throw new MigrationRefused('only a flipped conversion can be completed');
        // A flip whose start threw is still recorded as flipped, because the column move is durable before
        // the start. Completing it would drop the only record of how to get back, on a site that never came
        // up. The failure has to be cleared by a retry or a rollback first.
        if (migration.lastError !== null) {
            throw new MigrationRefused(`this conversion failed and cannot be completed: ${migration.lastError}`);
        }
        const site = this.deps.store.siteById(siteId);
        if (site?.runtime !== 'environment')
            throw new MigrationRefused('this site is not serving as an environment');
        // DEFECT 5: a flipped column and a started container are not a serving site. Completing is the point
        // of no return, so it demands the site actually answers rather than merely existing.
        const readiness = await this.deps.verifyReadiness(site, this.deps.loadRecipe(siteId).readiness);
        if (!readiness.ready) {
            throw new MigrationRefused(`this site is not answering yet, so the conversion cannot be completed: ${readiness.detail}`);
        }
        this.deps.store.clearRuntimeMigration(siteId);
        return this.status(siteId);
    }
    /** Put one site back the way it was, from any stage.
     *
     *  Serving is restored BEFORE the container is torn down, so the gap is the restore itself rather than
     *  the cleanup behind it. Releases and `current_release_id` were never touched, so a static site
     *  resumes from its release directory: the editable source is not exposed by a rollback, because the
     *  static path never reads it. */
    async rollback(siteId, options = {}) {
        const migration = this.deps.store.runtimeMigration(siteId);
        if (!migration)
            throw new MigrationRefused('this site has no conversion to roll back');
        const site = this.deps.store.siteById(siteId);
        if (!site)
            throw new MigrationRefused('this site does not exist');
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
            }
            else if (!carryData && (migration.rollbackStage === 'none' || migration.rollbackStage === 'quiescing')) {
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
            if (restored?.runtime === 'command')
                await this.startRestoredLegacy(restored);
            this.deps.store.markLegacyStopped(siteId, false);
            // ONLY NOW. While the conversion held this site, a periodic reconcile may have written `failed` and
            // an error onto the row, and a site left `failed` is absent from `liveCommandSites()` and therefore
            // dark for good. That stale verdict is cleared here, after readiness was proven and never before
            // it: a failure above throws, and an error that is real has to survive.
            this.deps.store.completeRuntimeRollback(siteId);
        }
        else {
            // Never flipped, so the container never owned anything and there is nothing to carry back.
            //
            // THE BROKER IS ONLY OURS TO REMOVE IF WE MADE IT. A conversion of a socket-bound command site
            // inherited a directory its live process is still answering on; removing it here would take a
            // serving site down and leave that process writing to an unlinked path. Only a directory this
            // conversion asked the gateway to create is removed, and only while no legacy process holds it.
            const ownsBroker = migration.brokerPrepared && !this.deps.legacyRunning(siteId);
            await this.deps.discardContainer(siteId, { removeBroker: ownsBroker });
            if (ownsBroker)
                this.deps.store.markBrokerPrepared(siteId, false);
            // The legacy runtime may already have been STOPPED by a flip that failed after the quiesce, and a
            // rollback that walked away from that would leave the site dark for good.
            if (migration.legacyStopped) {
                const legacy = this.deps.store.siteById(siteId);
                if (legacy?.runtime === 'command')
                    await this.startRestoredLegacy(legacy);
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
    async startRestoredLegacy(site) {
        try {
            await this.deps.startLegacyRuntime(site);
        }
        catch (error) {
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
     *    released so a rollback or a complete can proceed. */
    async recoverInterrupted() {
        const settled = [];
        for (const migration of this.deps.store.runtimeMigrations()) {
            // DEFECT 2: the dark-site restart runs BEFORE the already-failed early return, because a failed
            // slot is precisely the case where the site is down. A flip that threw after the quiesce records
            // its error and stops; skipping such a slot on the next boot would leave the site off for good.
            const restarted = await this.restoreStoppedLegacy(migration);
            if (restarted === 'failed') {
                settled.push(this.status(migration.siteId));
                continue;
            }
            if (migration.lastError !== null) {
                settled.push(this.status(migration.siteId));
                continue;
            }
            if (migration.stage === 'preparing') {
                // Orphan cleanup, best effort per resource: a container that will not go must not stop the slot
                // being released, or the site can never be retried.
                // Same ownership rule as a rollback: a directory this conversion did not create belongs to the
                // legacy runtime, which may be serving on it right now.
                const ownsBroker = migration.brokerPrepared && !this.deps.legacyRunning(migration.siteId);
                try {
                    await this.deps.discardContainer(migration.siteId, { removeBroker: ownsBroker });
                }
                catch { /* reported through the slot */ }
                if (ownsBroker)
                    this.deps.store.markBrokerPrepared(migration.siteId, false);
                try {
                    await this.deps.removeStaged([stagedWorkspace(this.deps, migration.siteId)]);
                }
                catch { /* same */ }
                try {
                    this.deps.discardArtifacts(migration.siteId);
                }
                catch { /* same */ }
            }
            this.deps.store.failRuntimeMigration(migration.siteId, `interrupted by a restart while ${migration.stage}; re-claim to retry or roll back`);
            settled.push(this.status(migration.siteId));
        }
        return settled;
    }
    /** Bring back a legacy runtime this conversion stopped and never replaced.
     *
     *  `reconcile` walks live command sites and a half-converted one still says command, so it is not
     *  missing from that set — it is simply not running, and only the durable marker records that the
     *  conversion is the reason. Nothing else in the plugin will ever start it. */
    async restoreStoppedLegacy(migration) {
        if (!migration.legacyStopped || migration.stage === 'flipped')
            return 'none';
        const site = this.deps.store.siteById(migration.siteId);
        if (site?.runtime !== 'command')
            return 'none';
        try {
            await this.deps.startLegacyRuntime(site);
            this.deps.store.markLegacyStopped(migration.siteId, false);
            return 'restarted';
        }
        catch (error) {
            this.deps.store.failRuntimeMigration(migration.siteId, `the legacy runtime could not be restarted after an interrupted conversion: ${error instanceof Error ? error.message : String(error)}`);
            // Left marked, so the next boot tries again rather than forgetting a dark site. Recording the
            // failure above is what releases the reconcile guard: an unowned slot no longer holds the site
            // down, so the ordinary sweep takes over the restart while this marker keeps the debt recorded.
            return 'failed';
        }
    }
    /** What a boot or a plugin reload owes. Reports rather than acts: resuming a conversion moves a live
     *  hostname between runtimes, which is an administrator's decision and not a side effect of a restart.
     *  A crash mid-prepare therefore leaves a claimed slot that a person retries or rolls back. */
    pending() {
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
export const plainRemove = async (paths) => {
    for (const path of paths)
        rmSync(path, { recursive: true, force: true });
};
