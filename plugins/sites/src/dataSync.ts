import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

import type { CommandExecutor } from './podman.js';

/** Moving a legacy site's mutable state into a container, and back out again.
 *
 *  A `release-copy` alone converts only the CODE. A command site keeps its data wherever its confined
 *  process put it, which for the sites this was built for is a SQLite file under the process's HOME —
 *  outside the release directory and therefore outside anything the release copy touches. Flipping such a
 *  site without moving that file produces a container serving the right code against an empty database.
 *
 *  HOW HOME IS DERIVED, AND WHY IT IS NOT CONFIGURED. `runtime.ts` builds a command site's environment as
 *  `{ ...releaseEnv, ...prepared.launch.env, ... }` and `RESERVED_ENV` blocks `.env` from setting HOME, so
 *  HOME can only ever come from `sandbox.prepareExecution`. That preparation also returns `home` and
 *  `roots` as first-class fields. Asking the sandbox for the same preparation the legacy runtime would
 *  get is therefore the ONLY answer that is correct by construction, and it is why this module accepts no
 *  path from a caller: an operator-supplied root would be a second, unverified opinion about where a
 *  site's data lives, and a wrong one would tar up somebody else's directory. */

/** The provenance of a HOME, as the Sandbox contract actually reports it.
 *
 *  ⚠️ `home` IS NOT ONE OF `roots`, and an earlier version of this guard assumed it was.
 *
 *  `SandboxPreparedExecution` returns `home` and `roots` as two SEPARATE first-class fields, and they
 *  answer two different questions. `roots` is "which directories may this child see", named by the caller
 *  and here just the release directory. `home` is "whose HOME does this child get", derived by Sandbox
 *  from `accountUserId` and bound into the guest namespace separately by the bubblewrap builder. A HOME
 *  outside the caller's roots is therefore the NORMAL, intended result, not an anomaly — so requiring
 *  containment refused every correct preparation and made every data-carrying conversion impossible.
 *
 *  What actually makes the HOME trustworthy is OWNERSHIP, not location: this plugin named the account,
 *  Sandbox resolved that account's home, and the lease it returns states which account it really issued
 *  for. Checking the lease against the owner we asked for is the honest proof, and it is a proof the
 *  caller cannot forge by naming a path, because no path is accepted from a caller at all. */
export interface LegacyHomeProvenance {
  /** Absolute HOME exactly as the preparation reported it. */
  home: string;
  /** The account THIS plugin asked Sandbox to prepare for: the site's owner. */
  expectedOwnerUserId: number;
  /** The account the returned lease was actually issued for. Sandbox's own answer, not ours. */
  leaseAccountUserId: number | null;
  /** The home of the process that is really running, or the one this conversion already pinned. When
   *  present the answer must match it exactly: a fresh preparation that names a different directory is
   *  the case where a capture would archive somebody else's tree. */
  expectedHome?: string | null;
}

/** WHAT to capture under a HOME, and the reason this is not simply "the HOME".
 *
 *  A HOME IS NOT A SITE. Two published sites can be confined to the SAME sandbox home — on the fleet this
 *  was written for, two of the three command sites share one. Capturing a whole home would therefore put
 *  one site's database, credentials and uploads into the other site's conversion archive, load them into
 *  the other site's data volume, and hand them back on the other site's rollback. That is a cross-site
 *  data leak dressed as a migration, and it would look like a clean success in every log.
 *
 *  So the whole home is not merely discouraged here, it is UNREPRESENTABLE: `includes` is required, must
 *  be non-empty, and every entry is a relative path that {@link assertAppOwnedSelection} refuses if it
 *  names the home itself or escapes it. There is no flag, default or empty-list shorthand that widens a
 *  capture back to everything. */
export interface LegacyDataSelection {
  /** Absolute, sandbox-derived and already validated by {@link validateLegacyLocation}. */
  home: string;
  /** App-owned paths RELATIVE to `home`, e.g. `.local/share/<app>`. Never empty, never `.`. */
  includes: readonly string[];
}

export interface DataSyncDeps {
  executor: CommandExecutor;
  /** Where protected artifacts live for a site. Derived from the plugin data directory, never a caller. */
  artifactDir(siteId: string): string;
  /** Tar binary. Injected so a test can point at a shim; not a caller-supplied value. */
  tarBinary?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_LIMIT_BYTES = 64 * 1024;

/** A path is usable only when the sandbox itself named it. Containment is checked on RESOLVED paths with
 *  a separator-aware prefix, so `/home/site-a-evil` is not accepted as living under `/home/site-a`. */
export function withinRoots(path: string, roots: readonly string[]): boolean {
  if (!isAbsolute(path)) return false;
  const target = resolve(path);
  return roots.some((root) => {
    if (!isAbsolute(root)) return false;
    const base = resolve(root);
    if (target === base) return true;
    const rel = relative(base, target);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  });
}

/** Validate what the sandbox returned before anything is read or written through it.
 *
 *  Throws rather than falling back: a conversion that cannot prove where the site's data lives must stop,
 *  because both plausible fallbacks — skip the data, or guess a path — silently produce a wrong result. */
/** Refuse a capture that is not confined to app-owned subtrees.
 *
 *  Every rejection here is a way the whole home, or a neighbour's data, could otherwise end up in the
 *  archive. `..` is checked on the NORMALISED path, so `app/../../other-site` is caught rather than only
 *  a leading `..`. Returns the normalised include list, so the caller tars exactly what was validated
 *  instead of the raw strings. */
export function assertAppOwnedSelection(selection: LegacyDataSelection): string[] {
  const { includes } = selection;
  if (includes.length === 0) {
    throw new Error('a data capture must name the app-owned paths to take; capturing a whole home is refused');
  }
  return includes.map((raw) => {
    if (typeof raw !== 'string' || raw.trim() === '') throw new Error('a data capture path must be a non-empty string');
    if (isAbsolute(raw)) throw new Error(`a data capture path must be relative to the home: ${raw}`);
    const clean = normalize(raw).replace(/[/\\]+$/, '');
    if (clean === '' || clean === '.' || clean === '..') {
      throw new Error('a data capture path must name a subtree, not the home itself');
    }
    if (clean.split(/[/\\]/).includes('..')) {
      throw new Error(`a data capture path must stay inside the home: ${raw}`);
    }
    return clean;
  });
}

/** Establish that a reported HOME really is this site's, and return it CANONICALISED.
 *
 *  Throws rather than falling back: a conversion that cannot prove where the site's data lives must stop,
 *  because both plausible fallbacks — skip the data, or guess a path — silently produce a wrong result.
 *
 *  The canonical path is what every later step uses, so a symlinked home is resolved ONCE, here, and the
 *  containment checks downstream compare like with like instead of comparing a link against its target. */
export function validateLegacyHome(provenance: LegacyHomeProvenance): string {
  const { home, expectedOwnerUserId, leaseAccountUserId, expectedHome } = provenance;
  if (!home || !isAbsolute(home)) throw new Error('the sandbox did not report an absolute HOME for this site');

  // OWNERSHIP IS THE BOUNDARY. Sandbox derives the home from the account, so the lease account is the
  // only thing that ties the directory it named to the site whose data we are about to take. A lease for
  // a different account means we were handed someone else's home, whatever the path looks like.
  if (leaseAccountUserId === null || leaseAccountUserId !== expectedOwnerUserId) {
    throw new Error(
      `the sandbox prepared this execution for account ${leaseAccountUserId ?? 'none'} rather than the site owner ${expectedOwnerUserId}`,
    );
  }

  // A live site's home exists. A missing one means the preparation described something that is not the
  // directory the running process has been writing to.
  if (!existsSync(home)) throw new Error('the sandbox HOME does not exist, so it is not a running site\'s data directory');
  if (!statSync(home).isDirectory()) throw new Error('the sandbox HOME is not a directory');
  const canonical = realpathSync(resolve(home));

  if (expectedHome !== undefined && expectedHome !== null) {
    const pinned = existsSync(expectedHome) ? realpathSync(resolve(expectedHome)) : resolve(expectedHome);
    if (pinned !== canonical) {
      throw new Error(`this conversion is bound to ${expectedHome} but the sandbox now reports ${home}`);
    }
  }
  return canonical;
}

/** Refuse an include that leaves the home through a symlink or a bind, on the RESOLVED path.
 *
 *  {@link assertAppOwnedSelection} rejects a path that escapes textually; this rejects one that escapes
 *  through the filesystem. `.local/share/app` is a perfectly well-formed relative path even when `.local`
 *  is a link into the neighbouring site that shares this home, and tar given `-C home -- .local/share/app`
 *  follows that intermediate link without complaint. The archive would then hold the neighbour's data,
 *  and the rollback would write this site's data over theirs.
 *
 *  Only paths that EXIST are resolved: an include an app has not created yet is normal and is skipped by
 *  the capture anyway. The final component is checked with `lstat`, so a subtree that is itself a link out
 *  is refused rather than followed. */
export function assertContainedSubtrees(canonicalHome: string, includes: readonly string[]): string[] {
  const base = realpathSync(canonicalHome);
  return includes.filter((include) => {
    const target = join(base, include);
    if (!existsSync(target)) return false;
    if (lstatSync(target).isSymbolicLink()) {
      throw new Error(`the app-owned path ${include} is a symlink, so capturing it would leave this site's home`);
    }
    // The parents are resolved too: the escape usually happens on an intermediate component.
    if (!withinRoots(realpathSync(target), [base])) {
      throw new Error(`the app-owned path ${include} resolves outside this site's home`);
    }
    return true;
  });
}

export class DataSyncService {
  constructor(private readonly deps: DataSyncDeps) {}

  private get tar(): string {
    return this.deps.tarBinary ?? 'tar';
  }

  /** UID AND MODE POLICY for every archive this operation creates, reads or unpacks.
   *
   *  Rootless Podman maps the service account to uid 0 inside and any other in-container uid into the
   *  subuid range, so host ownership numbers are meaningless across the boundary and restoring them
   *  would either fail or write files the service account cannot read back. `--numeric-owner` keeps tar
   *  from consulting host passwd for names that do not exist on the other side, and `--no-same-owner`
   *  makes extraction land as the extracting user rather than attempting a chown it has no right to.
   *  Modes are preserved, because a database's 0600 matters; owners are not, because they cannot be. */
  private tarPolicyFlags(create: boolean): string[] {
    return create ? ['--numeric-owner'] : ['--numeric-owner', '--no-same-owner'];
  }

  private async runTar(args: readonly string[], cwd?: string): Promise<void> {
    const result = await this.deps.executor.run(this.tar, args, {
      env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
      timeoutMs: this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      outputLimitBytes: OUTPUT_LIMIT_BYTES,
      ...(cwd ? { cwd } : {}),
    });
    if (result.code !== 0) {
      throw new Error(`tar failed (${result.code}): ${(result.stderr || result.stdout).trim().slice(0, 400)}`);
    }
  }

  /** The protected directory a site's conversion artifacts live in. 0700 so nothing confined can read a
   *  captured `.env` or a database archive out of it. */
  private protectedDir(siteId: string): string {
    const dir = this.deps.artifactDir(siteId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    return dir;
  }

  archivePath(siteId: string, name: string): string {
    return join(this.protectedDir(siteId), name);
  }

  /** Take the post-quiesce snapshot of the legacy data directory.
   *
   *  Called ONLY after the legacy process is stopped and verified gone: a tar taken while a SQLite writer
   *  is live captures a torn page and a `-wal` whose transaction never landed. Returns null when the
   *  directory does not exist, which is the honest answer for a stateless site rather than an empty
   *  archive that looks like a successful capture of nothing. */
  async captureLegacyData(siteId: string, selection: LegacyDataSelection): Promise<string | null> {
    const includes = assertAppOwnedSelection(selection);
    if (!existsSync(selection.home)) return null;
    // Only what is actually there. A missing include is normal — an app that has not written its uploads
    // directory yet still converts — but tar would fail the whole capture on the first absent path.
    const present = assertContainedSubtrees(selection.home, includes);
    if (present.length === 0) return null;

    const archive = this.archivePath(siteId, 'legacy-data.tar');
    const temporary = `${archive}.partial`;
    rmSync(temporary, { force: true });
    // Paths are stored RELATIVE to the home, so a restore never depends on the host layout the archive
    // was taken on, and the archive contains only the named subtrees.
    //
    // `--` terminates the option list: an include is app data, and a future manifest entry beginning with
    // a dash must be a path to tar, never a flag. Symlinks are stored as links rather than followed;
    // following one would pull whatever it points at — including the neighbouring site sharing this home
    // — into an archive that is later unpacked with the plugin's own rights.
    await this.runTar(['-cf', temporary, ...this.tarPolicyFlags(true), '-C', selection.home, '--', ...present]);
    // Rename last: a partial file must never be mistaken for a complete snapshot by a resumed driver.
    renameSync(temporary, archive);
    chmodSync(archive, 0o600);
    return archive;
  }

  /** Restore a captured archive back over the legacy data directory.
   *
   *  The reverse of {@link captureLegacyData}, used when a rollback has to carry writes the CONTAINER
   *  made back to the legacy runtime. Never called with the legacy process running, for the same reason
   *  the capture is not. */
  async restoreLegacyData(selection: LegacyDataSelection, archive: string, siteId?: string): Promise<void> {
    const includes = assertAppOwnedSelection(selection);
    if (!existsSync(archive)) throw new Error(`the archive to restore is missing: ${archive}`);
    mkdirSync(selection.home, { recursive: true });
    // A restore WRITES, so an include that resolves out of the home is worse here than in the capture:
    // it would replace a neighbour's subtree with this site's data. Checked after the home is known to
    // exist, on whatever subtrees are there today; the ones being recreated cannot escape anything yet.
    assertContainedSubtrees(selection.home, includes);

    // ATOMIC REPLACE, not an overlay.
    //
    // `tar -x` over a live tree only ADDS and OVERWRITES. A file the application deleted while the site
    // was converted comes back from the old tree, and for SQLite that is not merely untidy: a resurrected
    // `data.db-wal` belonging to a database that has since been checkpointed is read on open and applied
    // over pages it does not match. The database is then silently corrupt.
    //
    // So each app-owned subtree is replaced whole: the current one is moved aside into a retained backup,
    // the archive is unpacked into an empty path, and only then is the backup dropped. A journal records
    // which subtree is mid-swap so a crash between the two moves is recoverable rather than a hole.
    const journalPath = siteId === undefined ? null : join(this.protectedDir(siteId), 'restore-journal.json');
    const backupRoot = siteId === undefined
      ? join(selection.home, '.elowen-restore-backup')
      : join(this.protectedDir(siteId), 'restore-backup');
    mkdirSync(backupRoot, { recursive: true, mode: 0o700 });

    for (const include of includes) {
      const target = join(selection.home, include);
      const backup = join(backupRoot, include.replace(/[/\\]/g, '__'));
      if (journalPath) {
        writeFileSync(journalPath, `${JSON.stringify({ include, target, backup, at: Date.now() })}\n`, { mode: 0o600 });
      }
      rmSync(backup, { recursive: true, force: true });
      if (existsSync(target)) renameSync(target, backup);
      mkdirSync(dirname(target), { recursive: true });
      try {
        await this.runTar(['-xf', archive, ...this.tarPolicyFlags(false), '-C', selection.home, '--', include]);
      } catch (error) {
        // Put the original back before reporting: a failed restore must not leave the app with nothing.
        rmSync(target, { recursive: true, force: true });
        if (existsSync(backup)) renameSync(backup, target);
        throw error;
      }
      rmSync(backup, { recursive: true, force: true });
    }
    if (journalPath) rmSync(journalPath, { force: true });
  }

  /** Finish a restore a crash interrupted.
   *
   *  The journal names exactly one subtree that was mid-swap. If the target is missing and the backup is
   *  present, the move out succeeded and the unpack did not, so the backup goes back; that is the only
   *  state that loses data if left alone. Anything else is already settled. */
  recoverInterruptedRestore(siteId: string): { recovered: string | null } {
    const journalPath = join(this.deps.artifactDir(siteId), 'restore-journal.json');
    if (!existsSync(journalPath)) return { recovered: null };
    let entry: { include?: string; target?: string; backup?: string };
    try { entry = JSON.parse(readFileSync(journalPath, 'utf8')) as typeof entry; }
    catch { rmSync(journalPath, { force: true }); return { recovered: null }; }
    const { target, backup, include } = entry;
    if (typeof target === 'string' && typeof backup === 'string' && !existsSync(target) && existsSync(backup)) {
      mkdirSync(dirname(target), { recursive: true });
      renameSync(backup, target);
      rmSync(journalPath, { force: true });
      return { recovered: include ?? target };
    }
    rmSync(journalPath, { force: true });
    return { recovered: null };
  }


  /** Lift `.env` out of the staged workspace into the protected artifact directory.
   *
   *  Two separate reasons, both load-bearing. The staged workspace becomes the container's `/workspace`
   *  bind mount READ-WRITE, so a secret left there is a secret the site's own code can rewrite or leak
   *  through its own served tree. And the release directory it was copied from must stay untouched, so
   *  the secret is moved out of the COPY and never edited in place at the source.
   *
   *  Returns null when the release carried no `.env`, which most static sites do not. */
  extractSecretArtifacts(siteId: string, workspace: string, files: readonly string[]): string[] {
    const secretsDir = join(this.protectedDir(siteId), 'secrets');
    mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
    chmodSync(secretsDir, 0o700);
    const moved: string[] = [];
    for (const file of files) {
      const staged = join(workspace, file);
      // Absent is normal: a release may not carry every file its recipe knows about, and refusing here
      // would block a conversion over a file the app itself treats as optional.
      if (!existsSync(staged)) continue;
      if (!statSync(staged).isFile()) throw new Error(`the staged secret ${file} is not a regular file`);
      const artifact = join(secretsDir, file);
      mkdirSync(dirname(artifact), { recursive: true, mode: 0o700 });
      renameSync(staged, artifact);
      chmodSync(artifact, 0o600);
      moved.push(file);
    }
    return moved;
  }

  /** Pack everything the container needs at first boot into ONE archive for the data volume.
   *
   *  The volume is the only thing this operation can write before the container has ever run, so the
   *  provisioning script, the application unit, the captured data and the secrets all travel through it.
   *  A bind mount would not do: the mount source is fixed when the container is created, and the capture
   *  does not exist yet at that point.
   *
   *  Everything lands under a single dot-directory so the app's own data directory stays clean and the
   *  bootstrap unit has one predictable path to test for. */
  async buildSeedArchive(siteId: string, input: {
    provisionScript: string;
    appUnit: string;
    dataArchive: string | null;
  }): Promise<string> {
    const stageRoot = join(this.protectedDir(siteId), 'seed');
    rmSync(stageRoot, { recursive: true, force: true });
    const stage = join(stageRoot, '.elowen-conversion');
    mkdirSync(stage, { recursive: true, mode: 0o700 });
    writeFileSync(join(stage, 'provision.sh'), input.provisionScript, { mode: 0o700 });
    writeFileSync(join(stage, 'elowen-app.service'), input.appUnit, { mode: 0o600 });
    if (input.dataArchive) copyFileSync(input.dataArchive, join(stage, 'legacy-data.tar'));
    const secrets = join(this.protectedDir(siteId), 'secrets');
    if (existsSync(secrets)) cpSync(secrets, join(stage, 'secrets'), { recursive: true, dereference: false });

    const seed = this.archivePath(siteId, 'volume-seed.tar');
    const temporary = `${seed}.partial`;
    rmSync(temporary, { force: true });
    await this.runTar(['-cf', temporary, ...this.tarPolicyFlags(true), '-C', stageRoot, '--', '.elowen-conversion']);
    renameSync(temporary, seed);
    chmodSync(seed, 0o600);
    // The staging tree held plaintext credentials only to be packed; the archive is the artefact that
    // survives, and it is 0600 in the same protected directory.
    rmSync(stageRoot, { recursive: true, force: true });
    return seed;
  }

  /** A digest over the staged secrets themselves: name AND bytes, in sorted order.
   *
   *  Names alone prove nothing. Swapping the CONTENTS of `.env` for another tenant's credentials leaves
   *  the name list identical, so a digest built from names would happily wave through exactly the
   *  substitution it exists to catch. */
  stagedSecretDigest(siteId: string): string {
    const root = join(this.deps.artifactDir(siteId), 'secrets');
    const hash = createHash('sha256');
    for (const name of this.stagedSecretNames(siteId)) {
      hash.update(name);
      hash.update('\0');
      hash.update(readFileSync(join(root, name)));
      hash.update('\0');
    }
    return hash.digest('hex');
  }

  /** The secret names currently staged in the protected directory, relative to the release root, so a
   *  flip can re-derive exactly the digest the preparation recorded. Sorted for stability. */
  stagedSecretNames(siteId: string): string[] {
    const root = join(this.deps.artifactDir(siteId), 'secrets');
    if (!existsSync(root)) return [];
    const names: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(join(dir, entry.name), rel);
        else if (entry.isFile()) names.push(rel);
      }
    };
    walk(root, '');
    return names.sort();
  }

  /** Everything this conversion wrote for a site, removed together. Used by rollback and by the orphan
   *  sweep so a failed attempt leaves no archive of somebody's database behind. */
  discardArtifacts(siteId: string): void {
    rmSync(this.deps.artifactDir(siteId), { recursive: true, force: true });
  }

  /** Whether a captured archive exists, so a resumed driver can tell "not captured yet" from "captured
   *  and already loaded" without re-reading the tar. */
  hasArtifact(siteId: string, name: string): boolean {
    const path = join(this.deps.artifactDir(siteId), name);
    return existsSync(path) && statSync(path).isFile();
  }
}

/** Path of the per-site artifact directory, given the plugin's own site directory. Exported so the
 *  wiring and the tests derive it the same way instead of each spelling the layout out again. */
export const migrationArtifactDir = (siteDir: string): string => join(siteDir, 'migration', 'artifacts');

/** Guard for a staged workspace path: it must sit under the site's own plugin directory. The service
 *  builds this path itself, so this is a belt-and-braces check against a future caller passing one in. */
export const workspaceOwnedBy = (workspace: string, siteDir: string): boolean => {
  const rel = relative(resolve(siteDir), resolve(workspace));
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
};
