import { createHash } from 'node:crypto';
import { closeSync, constants, cpSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, rmSync, statSync, utimesSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
/** Read size for hashing one tree entry — the digest costs the same memory whatever it is hashing. */
const DIGEST_CHUNK_BYTES = 4 * 1048576;
import { appUnit, auditStaticTree, CONVERSION_STAGE, provisionScript } from './recipe.js';
import { environmentAlreadyDeleted } from './deletion.js';
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
export class MigrationRefused extends Error {
}
class CompletionInProgress extends MigrationRefused {
}
class RollbackInProgress extends MigrationRefused {
}
const isCompletionCandidateSite = (site) => site !== null && site.status !== 'deleting';
/** Where a site's staged workspace lives. Derived from the site id, never from a caller argument. */
export const stagedWorkspace = (deps, siteId) => join(deps.siteDir(siteId), 'migration', 'workspace');
/** Everything one conversion wrote under the site's own plugin directory: the staged copy, the recipe,
 *  the secrets it lifted out and every archive it packed. Removed as one tree when the site no longer has
 *  a staged copy to serve from. */
const migrationDirectory = (deps, siteId) => join(deps.siteDir(siteId), 'migration');
/** What boot recovery writes onto a conversion a restart interrupted. Built in one place because a
 *  completion has to RECOGNISE it: a conversion interrupted after its flip is not a failed conversion,
 *  it is a finished one whose last step nobody got to run. */
export const interruptedByRestart = (stage) => `interrupted by a restart while ${stage}; re-claim to retry or roll back`;
/** How far a completion got, kept on the site's runtime records rather than in memory: it destroys the
 *  staged container and rebuilds it, so a driver that dies half way has to be able to pick the operation
 *  up rather than start it again from a volume that no longer exists. */
const COMPLETION_RECORD = 'completion';
/** A durable request written by flip or the API. Only the daemon supervisor consumes it. */
const COMPLETION_REQUESTED = 'completion-requested';
/** The export of the persistent volume, taken before the staged container is retired and read back once
 *  its replacement exists. While this file is the only copy of the site's data, nothing removes it. */
const COMPLETION_ARCHIVE = 'completion-data.tar';
const COMPLETION_OPERATIONS = ['export', 'rebind', 'import-data', 'import-seed', 'retire'];
const completionOperationId = (attemptId, step) => `completion-${step}-${createHash('sha256').update(attemptId).digest('hex').slice(0, 20)}`;
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
export function reconcileIntoSource(workspace, sourceDir, skip) {
    const skipped = new Set([...skip, GIT_STUB_ENTRY]);
    const written = [];
    if (!existsSync(workspace))
        return written;
    mkdirSync(sourceDir, { recursive: true });
    const walk = (dir, prefix) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (skipped.has(rel))
                continue;
            const from = join(dir, entry.name);
            const to = join(sourceDir, ...rel.split('/'));
            if (entry.isDirectory()) {
                mkdirSync(to, { recursive: true });
                walk(from, rel);
                continue;
            }
            // A symlink is carried across as a symlink and never followed, on the same reasoning the digest
            // uses: following one would copy whatever it points at, including a file outside the workspace.
            if (!entry.isFile() && !entry.isSymbolicLink())
                continue;
            if (existsSync(to)) {
                const staged = lstatSync(from);
                const current = lstatSync(to);
                if (staged.mtimeMs <= current.mtimeMs)
                    continue;
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
const COMPLETION_RETRY_MS = 15_000;
export class RuntimeMigrationService {
    deps;
    completionRetryAt = new Map();
    activeFlips = new Set();
    activeCompletions = new Map();
    activeRollbacks = new Map();
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
        if (this.deps.projectExecutionKind(site.projectId) === 'managed') {
            throw new MigrationRefused('a managed Project stores this site at a guest path; runtime conversion is available only for host Projects');
        }
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
        if (this.activeFlips.has(siteId))
            throw new MigrationRefused('this conversion is already being flipped');
        this.activeFlips.add(siteId);
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
            // Starts the container prepared above: the provider creates only when none exists, so the writable
            // layer built during preparation is reused rather than thrown away.
            await this.deps.startEnvironment(flipped);
            // Completion can outlive the tool runner that flipped the row. The daemon supervisor owns every
            // destructive phase from here, so a client deadline cannot strand the conversion halfway through it.
            this.deps.store.putRuntimeRecord(siteId, COMPLETION_REQUESTED, this.now().toISOString());
            return this.status(siteId);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.deps.store.failRuntimeMigration(siteId, message);
            throw error;
        }
        finally {
            this.activeFlips.delete(siteId);
        }
    }
    /** Queue completion for the daemon supervisor without performing lifecycle work in the caller. */
    scheduleCompletion(siteId) {
        const migration = this.deps.store.runtimeMigration(siteId);
        if (!migration)
            throw new MigrationRefused('this site has no conversion to complete');
        if (migration.stage === 'completed')
            return this.status(siteId);
        if (migration.stage !== 'flipped' && migration.stage !== 'completing') {
            throw new MigrationRefused('only a flipped conversion can be completed');
        }
        this.deps.store.putRuntimeRecord(siteId, COMPLETION_REQUESTED, this.now().toISOString());
        return this.status(siteId);
    }
    /** Retire the staged copy, so the converted site is left with ONE working copy while undo is retained.
     *
     *  WHY A CONVERSION HAS TWO WORKING COPIES UNTIL THIS RUNS. A preparation stages the published release
     *  into a copy it owns and mounts THAT, because the flip must serve the bytes it verified rather than
     *  whatever the source folder holds at the time. The consequence is a site whose container serves one
     *  directory while every agent and every tool edits another. Completion ends that: the staged copy is
     *  folded back into the site's own source folder, the container is rebuilt on the source folder, and the
     *  staged workspace is removed. The recipe and data artefacts stay retained with the completed audit row,
     *  so an operator can still restore the stopped legacy runtime during the retention window.
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
     *  5. Only then is the staged workspace removed and the binding published. The completed row and its
     *     protected artefacts remain until an explicit retire step ends the rollback window. */
    async complete(siteId, resumableError = interruptedByRestart('flipped')) {
        const active = this.activeCompletions.get(siteId);
        if (active)
            return active;
        const run = this.completeNow(siteId, resumableError).finally(() => {
            this.activeCompletions.delete(siteId);
        });
        this.activeCompletions.set(siteId, run);
        return run;
    }
    async completeNow(siteId, resumableError) {
        const migration = this.deps.store.runtimeMigration(siteId);
        // Nothing left to retire. A second call after the row is gone answers with the site's status rather
        // than refusing, because a resumed driver cannot tell "already finished" from "never started".
        if (!migration || migration.stage === 'completed')
            return this.status(siteId);
        if (migration.stage !== 'flipped' && migration.stage !== 'completing') {
            throw new MigrationRefused('only a flipped conversion can be completed');
        }
        const site = this.deps.store.siteById(siteId);
        if (site?.runtime !== 'environment')
            throw new MigrationRefused('this site is not serving as an environment');
        let progress = this.completionProgress(siteId);
        // The recipe lives in the migration directory. Once retirement has removed that directory, the only
        // remaining work is publishing the binding and clearing records, which must stay resumable without it.
        const recipe = progress === 'retiring' ? null : this.deps.loadRecipe(siteId);
        // A flipped column and a started container are not a serving site, so completing demands that the
        // site actually answers. Asked only while the staged container is still the one serving: past that
        // point this operation has taken the site down itself, and its own start is what proves it came back.
        if (progress === null) {
            const readiness = await this.deps.verifyReadiness(site, recipe.readiness);
            if (!readiness.ready) {
                throw new MigrationRefused(`this site is not answering yet, so the conversion cannot be completed: ${readiness.detail}`);
            }
        }
        // A flip whose start threw is still recorded as flipped, because the column move is durable before the
        // start. Completing THAT would drop the only record of how to get back, on a site that never came up.
        // A restart that landed between the flip and the completion is the one exception: it recorded a
        // failure for a site that is up and serving, and the claim below is what tells the two apart.
        if (!this.deps.store.beginRuntimeCompletion(siteId, resumableError)) {
            const current = this.deps.store.runtimeMigration(siteId);
            if (current?.stage === 'completing' && current.lastError === null) {
                throw new CompletionInProgress('this conversion is already being completed');
            }
            throw new MigrationRefused(`this conversion failed and cannot be completed: ${current?.lastError ?? migration.lastError ?? 'the conversion slot moved underneath it'}`);
        }
        try {
            if (progress === null) {
                this.deps.store.putRuntimeRecord(siteId, COMPLETION_RECORD, 'exporting');
                progress = 'exporting';
            }
            if (progress === 'exporting') {
                reconcileIntoSource(stagedWorkspace(this.deps, siteId), await this.deps.sourcePath(site), recipe.secretFiles);
                // The marker precedes every operation in this phase. A retry uses the same export request id, so a
                // lost response rejoins the one Sandbox operation instead of consuming the volume twice.
                await this.deps.stopContainer(siteId);
                if (!await this.deps.containerStopped(siteId)) {
                    throw new Error('the environment container is still running, so its data cannot be exported consistently');
                }
                await this.deps.exportDataVolume(site, this.deps.artifactPath(siteId, COMPLETION_ARCHIVE), completionOperationId(migration.attemptId, 'export'));
                this.deps.store.putRuntimeRecord(siteId, COMPLETION_RECORD, 'exported');
                progress = 'exported';
            }
            if (progress === 'exported') {
                this.deps.store.putRuntimeRecord(siteId, COMPLETION_RECORD, 'rebinding');
                progress = 'rebinding';
            }
            if (progress === 'rebinding') {
                await this.deps.rebindToSource(site, completionOperationId(migration.attemptId, 'rebind'));
                this.deps.store.putRuntimeRecord(siteId, COMPLETION_RECORD, 'rebound');
                progress = 'rebound';
            }
            if (progress === 'rebound') {
                this.deps.store.putRuntimeRecord(siteId, COMPLETION_RECORD, 'importing');
                progress = 'importing';
            }
            if (progress === 'importing') {
                const carried = this.deps.artifactPath(siteId, COMPLETION_ARCHIVE);
                if (existsSync(carried)) {
                    await this.deps.loadDataVolume(site, carried, completionOperationId(migration.attemptId, 'import-data'));
                }
                // Rebinding prepared a replacement container, so the shared container-creation hook already
                // rebuilt and imported the disposable bootstrap stage. The carried application archive overlays
                // only its own files and does not remove that fresh stage.
                this.deps.store.putRuntimeRecord(siteId, COMPLETION_RECORD, 'seeded');
                progress = 'seeded';
            }
            if (progress === 'seeded') {
                this.deps.store.putRuntimeRecord(siteId, COMPLETION_RECORD, 'starting');
                progress = 'starting';
            }
            if (progress === 'starting') {
                await this.deps.startEnvironment(site);
                const readiness = await this.deps.verifyReadiness(site, recipe.readiness);
                if (!readiness.ready) {
                    throw new Error(`the site does not answer from its own source folder: ${readiness.detail}`);
                }
                await this.deps.clearConversionStage(site, CONVERSION_STAGE);
                if (!await this.deps.conversionStageAbsent(site, CONVERSION_STAGE)) {
                    throw new Error('the conversion seed directory survived cleanup in the final container');
                }
                this.deps.store.putRuntimeRecord(siteId, COMPLETION_RECORD, 'live');
                progress = 'live';
            }
            if (progress === 'live') {
                this.deps.store.putRuntimeRecord(siteId, COMPLETION_RECORD, 'retiring');
                progress = 'retiring';
            }
            if (progress === 'retiring') {
                // Only the served staging copy is spent. The recipe, secrets and data archives are the retained undo
                // material for a completed conversion and leave only through the explicit retire or rollback path.
                const workspace = stagedWorkspace(this.deps, siteId);
                if (existsSync(workspace)) {
                    await this.deps.removeStaged([workspace], completionOperationId(migration.attemptId, 'retire'));
                }
                this.deps.publishBinding(site);
            }
            for (const operation of COMPLETION_OPERATIONS) {
                this.deps.store.deleteRuntimeRecord(siteId, `artifact:${completionOperationId(migration.attemptId, operation)}`);
            }
            this.deps.store.deleteRuntimeRecord(siteId, `artifact:${completionOperationId(migration.attemptId, 'retire')}-0`);
            this.deps.store.deleteRuntimeRecord(siteId, COMPLETION_RECORD);
            this.deps.store.deleteRuntimeRecord(siteId, COMPLETION_REQUESTED);
            if (!this.deps.store.completeRuntimeMigration(siteId, this.now().toISOString())) {
                throw new Error('the completed conversion audit row could not be finalized');
            }
            return this.status(siteId);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.deps.store.failRuntimeMigration(siteId, message);
            throw error;
        }
    }
    completionProgress(siteId) {
        return this.deps.store.runtimeRecord(siteId, COMPLETION_RECORD);
    }
    /** Finish the completions nobody is driving.
     *
     *  A conversion that a restart interrupted after its flip is a finished conversion with one step left,
     *  and the site is serving from a staged copy until that step runs — which is exactly the state an
     *  operator cannot see and would not know to fix. So the periodic reconcile finishes every flipped slot,
     *  including the plain `last_error = NULL` rows left by older releases, plus a completion of its own that
     *  a restart cut short.
     *
     *  A completion that fails records why on the row and waits before trying again. The delay is in memory:
     *  a daemon restart may retry once immediately, while a live daemon never hammers a missing container on
     *  every two-second sweep. */
    async reconcileCompletions() {
        const settled = [];
        for (const migration of this.deps.store.runtimeMigrations()) {
            if (!isCompletionCandidateSite(this.deps.store.siteById(migration.siteId)))
                continue;
            if (migration.stage !== 'flipped' && migration.stage !== 'completing')
                continue;
            if (migration.stage === 'flipped' && this.deps.store.runtimeRecord(migration.siteId, COMPLETION_REQUESTED) === null)
                continue;
            if (this.activeFlips.has(migration.siteId) || this.activeCompletions.has(migration.siteId))
                continue;
            if (this.now().getTime() < (this.completionRetryAt.get(migration.siteId) ?? 0))
                continue;
            try {
                settled.push(await this.complete(migration.siteId, migration.lastError ?? interruptedByRestart('flipped')));
                this.completionRetryAt.delete(migration.siteId);
            }
            catch (error) {
                if (error instanceof CompletionInProgress)
                    continue;
                // Faults after the claim are recorded by `complete`. A readiness refusal happens before the claim,
                // so record it here too: the operator gets the real container error and the retry has a durable key.
                const current = this.deps.store.runtimeMigration(migration.siteId);
                if (current?.lastError === null) {
                    this.deps.store.failRuntimeMigration(migration.siteId, error instanceof Error ? error.message : String(error));
                }
                this.completionRetryAt.set(migration.siteId, this.now().getTime() + COMPLETION_RETRY_MS);
                settled.push(this.status(migration.siteId));
            }
        }
        return settled;
    }
    /** Permanently end the rollback window after the operator's retention period. */
    async retireCompleted(siteId) {
        const migration = this.deps.store.runtimeMigration(siteId);
        if (!migration)
            return this.status(siteId);
        if (migration.stage !== 'completed')
            throw new MigrationRefused('only a completed conversion can be retired');
        if (migration.rollbackStage !== 'none')
            throw new MigrationRefused('this conversion has a rollback in progress');
        const directory = migrationDirectory(this.deps, siteId);
        if (existsSync(directory))
            await this.deps.removeStaged([directory]);
        this.deps.discardArtifacts(siteId);
        this.deps.store.clearRuntimeMigration(siteId);
        return this.status(siteId);
    }
    /** Put one site back the way it was, from any stage.
     *
     *  Serving is restored BEFORE the container is torn down, so the gap is the restore itself rather than
     *  the cleanup behind it. Releases and `current_release_id` were never touched, so a static site
     *  resumes from its release directory: the editable source is not exposed by a rollback, because the
     *  static path never reads it. */
    scheduleRollback(siteId, options = {}) {
        const migration = this.deps.store.runtimeMigration(siteId);
        if (!migration)
            throw new MigrationRefused('this site has no conversion to roll back');
        if (migration.stage === 'completing') {
            throw new MigrationRefused('this conversion is being completed; finish the completion before rolling anything back');
        }
        if (!this.deps.store.requestRuntimeRollback(siteId, options.restoreData !== false)) {
            throw new MigrationRefused('this conversion could not be queued for rollback');
        }
        return this.status(siteId);
    }
    async rollback(siteId, options = {}) {
        const active = this.activeRollbacks.get(siteId);
        if (active)
            return active;
        const migration = this.deps.store.runtimeMigration(siteId);
        if (!migration || migration.rollbackStage === 'none')
            this.scheduleRollback(siteId, options);
        const run = this.rollbackNow(siteId).finally(() => this.activeRollbacks.delete(siteId));
        this.activeRollbacks.set(siteId, run);
        return run;
    }
    async rollbackNow(siteId) {
        const migration = this.deps.store.runtimeMigration(siteId);
        if (!migration)
            throw new MigrationRefused('this site has no conversion to roll back');
        if (migration.stage === 'completing') {
            throw new MigrationRefused('this conversion is being completed; finish the completion before rolling anything back');
        }
        const site = this.deps.store.siteById(siteId);
        if (!site)
            throw new MigrationRefused('this site does not exist');
        if (!this.deps.store.beginRuntimeRollback(siteId)) {
            throw new RollbackInProgress('this conversion rollback is already being driven');
        }
        try {
            if (migration.stage === 'flipped' || migration.stage === 'completed') {
                const currentSite = this.deps.store.siteById(siteId);
                // Releases 0.10.14 and older recorded `discarded` before reverting the site. Preserve recovery for
                // those rows by moving them back to the last non-destructive checkpoint when the row is still an environment.
                if (migration.rollbackStage === 'discarded' && currentSite.runtime === 'environment') {
                    this.deps.store.recordRollbackProgress(siteId, 'restored');
                }
                let current = this.deps.store.runtimeMigration(siteId);
                const recipe = current.rollbackStage === 'requested' || current.rollbackStage === 'quiescing' || current.rollbackStage === 'exported'
                    ? this.deps.loadRecipe(siteId)
                    : null;
                const carryData = current.rollbackRestoreData
                    && current.fromRuntime === 'command'
                    && recipe !== null
                    && recipe.dataIncludes.length > 0;
                let carried = current.rollbackArchive;
                if (current.rollbackStage === 'requested' || current.rollbackStage === 'quiescing') {
                    this.deps.store.recordRollbackProgress(siteId, 'quiescing');
                    await this.deps.stopContainer(siteId);
                    if (!await this.deps.containerStopped(siteId)) {
                        throw new Error('the environment container is still running, so its data cannot be exported consistently');
                    }
                    if (carryData) {
                        const output = this.deps.artifactPath(siteId, 'rollback-data.tar');
                        carried = await this.deps.exportDataVolume(site, output) ? output : null;
                    }
                    else {
                        carried = null;
                    }
                    this.deps.store.recordRollbackProgress(siteId, 'exported', carried);
                }
                current = this.deps.store.runtimeMigration(siteId);
                if (current.rollbackStage === 'exported') {
                    if (carried) {
                        this.deps.recoverInterruptedRestore(siteId);
                        const location = await this.deps.resolveLegacyData(legacyDescriptor(site, current));
                        if (!location) {
                            throw new Error('the sandbox could not name this site\'s data directory, so container writes cannot be carried back');
                        }
                        if (current.legacyHome !== null && resolve(current.legacyHome) !== resolve(location.home)) {
                            throw new Error(`this conversion recorded ${current.legacyHome} as the site's home; refusing to restore into ${location.home}`);
                        }
                        const archivePrefix = recipe.dataDir === '/data' ? '' : relative('/data', recipe.dataDir);
                        await this.deps.restoreLegacyData(location, carried, siteId, archivePrefix);
                    }
                    this.deps.store.recordRollbackProgress(siteId, 'restored');
                }
                current = this.deps.store.runtimeMigration(siteId);
                if (current.rollbackStage === 'restored') {
                    if (!this.deps.store.revertSiteRuntimeFromMigration(siteId)) {
                        throw new Error('the site runtime could not be restored');
                    }
                    this.deps.store.recordRollbackProgress(siteId, 'reverted');
                }
                current = this.deps.store.runtimeMigration(siteId);
                if (current.rollbackStage === 'reverted') {
                    const restored = this.deps.store.siteById(siteId);
                    if (restored?.runtime === 'command')
                        await this.startRestoredLegacy(restored);
                    if (restored)
                        await this.deps.restoreLegacyPublication(restored);
                    this.deps.store.markLegacyStopped(siteId, false);
                    if (!this.deps.store.completeRuntimeRollback(siteId)) {
                        throw new Error('the restored site could not be published as live');
                    }
                    this.deps.store.recordRollbackProgress(siteId, 'serving');
                }
                current = this.deps.store.runtimeMigration(siteId);
                if (current.rollbackStage === 'serving') {
                    const workspace = stagedWorkspace(this.deps, siteId);
                    if (existsSync(workspace))
                        await this.deps.removeStaged([workspace]);
                    try {
                        await this.deps.discardContainer(siteId, { removeBroker: false });
                    }
                    catch (error) {
                        if (!environmentAlreadyDeleted(error))
                            throw error;
                    }
                    this.deps.discardArtifacts(siteId);
                    this.deps.store.recordRollbackProgress(siteId, 'discarded');
                }
            }
            else {
                const workspace = stagedWorkspace(this.deps, siteId);
                if (existsSync(workspace))
                    await this.deps.removeStaged([workspace]);
                this.deps.discardArtifacts(siteId);
                const ownsBroker = migration.brokerPrepared && !this.deps.legacyRunning(siteId);
                try {
                    await this.deps.discardContainer(siteId, { removeBroker: ownsBroker });
                }
                catch (error) {
                    if (!environmentAlreadyDeleted(error))
                        throw error;
                }
                if (ownsBroker)
                    this.deps.store.markBrokerPrepared(siteId, false);
                if (migration.legacyStopped) {
                    const legacy = this.deps.store.siteById(siteId);
                    if (legacy?.runtime === 'command')
                        await this.startRestoredLegacy(legacy);
                    this.deps.store.markLegacyStopped(siteId, false);
                    this.deps.store.completeRuntimeRollback(siteId);
                }
            }
            this.deps.store.clearRuntimeMigration(siteId);
            return this.status(siteId);
        }
        catch (error) {
            this.deps.store.failRuntimeMigration(siteId, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
    async reconcileRollbacks() {
        const settled = [];
        for (const migration of this.deps.store.runtimeMigrations()) {
            if (migration.stage === 'completing' || migration.rollbackStage === 'none')
                continue;
            if (this.activeRollbacks.has(migration.siteId))
                continue;
            try {
                settled.push(await this.rollback(migration.siteId));
            }
            catch (error) {
                if (error instanceof RollbackInProgress)
                    continue;
                settled.push(this.status(migration.siteId));
            }
        }
        return settled;
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
     *    released so a rollback or a complete can proceed.
     *  - `completing`: the staged copy is already being retired. The marker is recorded the same way, and
     *    {@link reconcileCompletions} recognises it and carries the completion the rest of the way, because
     *    a half-retired conversion has no state a person could usefully act on. */
    async recoverInterrupted() {
        const settled = [];
        for (const migration of this.deps.store.runtimeMigrations()) {
            if (migration.stage === 'completed')
                continue;
            if (migration.rollbackStage !== 'none') {
                if (!migration.rollbackRequested && migration.lastError === null) {
                    this.deps.store.failRuntimeMigration(migration.siteId, 'the daemon restarted during rollback');
                    settled.push(this.status(migration.siteId));
                }
                continue;
            }
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
            if (migration.stage === 'flipped' || migration.stage === 'completing') {
                this.deps.store.putRuntimeRecord(migration.siteId, COMPLETION_REQUESTED, this.now().toISOString());
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
        return this.deps.store.runtimeMigrations().filter((migration) => migration.stage !== 'completed' || migration.rollbackStage !== 'none').map((migration) => ({
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
