// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, type Baseline, type LocalFile, type RemoteFile } from '../plugins/onedrive/src/merge.js';
import {
  buildIgnore, containedIn, isFloorIgnored, normalizeIgnorePatterns, scanLocal, IGNORE_FLOOR,
} from '../plugins/onedrive/src/scan.js';

const localAt = (sha: string): LocalFile => ({ present: true, size: 10, mtimeMs: 1, sha256: sha });
const remoteAt = (etag: string): RemoteFile => ({ present: true, itemId: 'i', etag, size: 10 });
const gone = { present: false } as const;
const base = (sha: string, etag: string): Baseline => ({ sha256: sha, etag });

describe('onedrive merge matrix', () => {
  it('covers every combination of the two sides exactly once', () => {
    // Never synced before.
    expect(decide(localAt('a'), gone, null).action).toBe('upload');
    expect(decide(gone, remoteAt('1'), null).action).toBe('download');
    expect(decide(gone, gone, null).action).toBe('forget');
    // Both appeared independently: there is no baseline to say which was meant, so neither is guessed at.
    expect(decide(localAt('a'), remoteAt('1'), null).action).toBe('conflict');

    // One side moved.
    expect(decide(localAt('b'), remoteAt('1'), base('a', '1')).action).toBe('upload');
    expect(decide(localAt('a'), remoteAt('2'), base('a', '1')).action).toBe('download');
    expect(decide(localAt('a'), remoteAt('1'), base('a', '1')).action).toBe('none');

    // Both moved: keep both, decide later.
    expect(decide(localAt('b'), remoteAt('2'), base('a', '1')).action).toBe('conflict');

    // Real deletions, applied.
    expect(decide(gone, remoteAt('1'), base('a', '1')).action).toBe('deleteRemote');
    expect(decide(localAt('a'), gone, base('a', '1')).action).toBe('trashLocal');
    expect(decide(gone, gone, base('a', '1')).action).toBe('forget');
  });

  it('lets content win over a deletion made against a version that no longer exists', () => {
    // Someone deleted it in OneDrive while it was being edited here. Honouring that deletion would throw
    // away an edit nobody has seen; re-uploading loses nothing, because the deletion can simply be repeated.
    expect(decide(localAt('b'), gone, base('a', '1')).action).toBe('upload');
    // And the mirror image: deleted here, changed there.
    expect(decide(gone, remoteAt('2'), base('a', '1')).action).toBe('download');
  });

  it('reports which side moved, not just what to do', () => {
    // The UI has to explain a conflict to a person, and "both changed" reads very differently from
    // "it appeared on both sides at once".
    expect(decide(localAt('b'), remoteAt('2'), base('a', '1'))).toEqual({
      action: 'conflict', local: 'changed', remote: 'changed',
    });
    expect(decide(localAt('a'), remoteAt('1'), null)).toEqual({
      action: 'conflict', local: 'added', remote: 'added',
    });
  });
});

describe('onedrive ignore floor', () => {
  it('refuses credentials, version control internals and dependencies wherever they sit', () => {
    for (const rel of [
      '.git/config', 'src/.git/HEAD', 'node_modules/x/index.js', 'web/node_modules/y/a.js',
      '.env', '.env.production', 'services/api/.env', 'certs/server.pem', 'deploy/key.key',
      'a/b/id_rsa', '.ssh/known_hosts', 'app/.npmrc', '.elowen-trash/2026/a.txt',
    ]) {
      expect(isFloorIgnored(rel), rel).toBe(true);
    }
    for (const rel of ['src/index.ts', 'README.md', 'docs/.environment.md', 'keys.md', 'environment.json']) {
      expect(isFloorIgnored(rel), rel).toBe(false);
    }
  });

  it('cannot be widened by operator patterns, only narrowed', () => {
    // An extra pattern list is additive by construction. There is deliberately no way to express
    // "actually, do mirror .env" — a setting that can switch off a credentials filter is a leak.
    const ignored = buildIgnore('*.log, build/**');
    expect(ignored('.env')).toBe(true);
    expect(ignored('app.log')).toBe(true);
    expect(ignored('build/out.js')).toBe(true);
    expect(ignored('src/index.ts')).toBe(false);
    // A malformed pattern must not throw and must not open anything.
    expect(buildIgnore(',,   ,')('.env')).toBe(true);
    expect(IGNORE_FLOOR.length).toBeGreaterThan(0);
  });

  it('normalises legacy and array ignore lists without losing commas inside globs', () => {
    expect(normalizeIgnorePatterns('*.{log,tmp}, build/**\ncache/**')).toEqual([
      '*.{log,tmp}', 'build/**', 'cache/**',
    ]);
    expect(normalizeIgnorePatterns(['*.{log,tmp}', 'reports/a,b/**', ' build/** '])).toEqual([
      '*.{log,tmp}', 'reports/a,b/**', 'build/**',
    ]);
    expect(buildIgnore('*.{log,tmp}')('debug.log')).toBe(true);
    expect(buildIgnore(['*.{log,tmp}'])('debug.tmp')).toBe(true);
  });
});

describe('onedrive local scan', () => {
  function project(): string {
    const root = mkdtempSync(join(tmpdir(), 'onedrive-scan-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'index.ts'), 'export const a = 1;\n');
    writeFileSync(join(root, 'README.md'), '# hi\n');
    writeFileSync(join(root, '.env'), 'SECRET=1\n');
    mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'dep', 'index.js'), 'x\n');
    return root;
  }

  const options = {
    ignored: buildIgnore(''),
    maxBytes: 1024 * 1024,
    settleMs: 0,
    now: Date.now() + 60_000,
    maxFiles: 1000,
  };

  it('walks a plain directory without mirroring the floor', async () => {
    const root = project();
    const result = await scanLocal(root, options);
    expect([...result.files.keys()].sort()).toEqual(['README.md', 'src/index.ts']);
    expect(result.fromGit).toBe(false);
  });

  it('skips a symlink instead of following it out of the project', async () => {
    const root = project();
    const outside = mkdtempSync(join(tmpdir(), 'onedrive-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'not yours\n');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));

    const result = await scanLocal(root, options);
    expect(result.files.has('link.txt')).toBe(false);
    expect(result.skipped).toContainEqual({ rel: 'link.txt', reason: 'symlink' });
    // And the containment check itself agrees about the target.
    expect(await containedIn(root, join(outside, 'secret.txt'))).toBe(false);
    expect(await containedIn(root, join(root, 'README.md'))).toBe(true);
  });

  it('reports an oversized file rather than leaving it silently missing', async () => {
    const root = project();
    writeFileSync(join(root, 'big.bin'), Buffer.alloc(4096));
    const result = await scanLocal(root, { ...options, maxBytes: 1024 });
    expect(result.files.has('big.bin')).toBe(false);
    expect(result.skipped).toContainEqual({ rel: 'big.bin', reason: 'too-large' });
  });

  it('holds back a file that is still being written, but not a settled one', async () => {
    const root = project();
    writeFileSync(join(root, 'writing.txt'), 'half');
    // Age everything except the file "still being written", so the assertion is about the settle window
    // and not merely about the whole fixture being fresh.
    const old = new Date(Date.now() - 3_600_000);
    for (const rel of ['README.md', 'src/index.ts']) utimesSync(join(root, rel), old, old);

    const result = await scanLocal(root, { ...options, now: Date.now(), settleMs: 5_000 });
    expect(result.files.has('writing.txt')).toBe(false);
    expect(result.files.has('README.md')).toBe(true);
    expect(result.files.has('src/index.ts')).toBe(true);
  });
});
