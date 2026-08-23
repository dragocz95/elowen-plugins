// @vitest-environment node
/** The editor plugin's file-operation coverage, adopted verbatim from the Elowen package
 *  (tests/integrations/projectFiles.test.ts) when the plugin moved here.
 *
 *  It straddles two owners on purpose, exactly as it did there. The file operations under test are the
 *  PLUGIN's (`plugins/editor/src/files.js`), but every one of them takes the path guard as a parameter —
 *  in production `ctx.host.projectFiles().safe` — so the suite passes the daemon's real `safeProjectPath`
 *  in rather than a stub, and the path-traversal assertions still measure what a running instance does.
 *  The daemon's own `listDirs`, `isProjectImage` and `projectRangeLog` cases did NOT come along: core
 *  routes call those, the editor never does, and they stayed in the package that owns them. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { safeProjectPath } from 'elowen/dist/integrations/projectFiles.js';
import {
  convertOfficeToPdf, listProjectFiles, readProjectFile as readFile, writeProjectFile as writeFile, readProjectByteRange as readRange, readProjectBytes as readBytes,
  createProjectFile as createFile, createProjectDir as createDir, deleteProjectEntry as deleteEntry,
  renameProjectEntry as renameEntry, copyProjectEntry as copyEntry, projectCommitDiff, projectCommitFiles,
  projectCommitFileDiff as commitFileDiff, projectCommitLog,
} from '../plugins/editor/src/files.js';
import { fileKindOf, mimeTypeOf } from '../plugins/editor/src/fileTypes.js';

const readProjectFile = (root: string, path: string) => readFile(safeProjectPath, root, path);
const writeProjectFile = (root: string, path: string, content: string) => writeFile(safeProjectPath, root, path, content);
const readProjectBytes = (root: string, path: string) => readBytes(safeProjectPath, root, path);
const readProjectRange = (root: string, path: string, start: number, end?: number) => readRange(safeProjectPath, root, path, start, end);
const createProjectFile = (root: string, path: string) => createFile(safeProjectPath, root, path);
const createProjectDir = (root: string, path: string) => createDir(safeProjectPath, root, path);
const deleteProjectEntry = (root: string, path: string) => deleteEntry(safeProjectPath, root, path);
const renameProjectEntry = (root: string, from: string, to: string) => renameEntry(safeProjectPath, root, from, to);
const copyProjectEntry = (root: string, from: string, to: string) => copyEntry(safeProjectPath, root, from, to);
const projectCommitFileDiff = (root: string, hash: string, path: string) => commitFileDiff(safeProjectPath, root, hash, path);

let root: string;
const w = (rel: string, body: string) => { const p = join(root, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body); };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elowen-files-'));
  w('src/index.ts', 'export const x = 1;');
  w('README.md', '# hi');
  w('node_modules/dep/index.js', 'ignored');
  w('.git/config', 'ignored');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('listProjectFiles', () => {
  it('lists files + dirs, skipping node_modules and .git', () => {
    const paths = listProjectFiles(root).map((n) => n.path);
    expect(paths).toContain('src');
    expect(paths).toContain(join('src', 'index.ts'));
    expect(paths).toContain('README.md');
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
    expect(paths.some((p) => p.includes('.git'))).toBe(false);
    expect(listProjectFiles(root).find((node) => node.path === 'README.md')?.size).toBe(4);
  });
});

describe('file preview routing', () => {
  it('classifies known text and preview formats while unknown files fail closed as binary', () => {
    expect(fileKindOf('src/config.v2/file')).toBe('binary');
    expect(fileKindOf('src/config.v2/file.ts')).toBe('text');
    expect(fileKindOf('report.PDF')).toBe('pdf');
    expect(fileKindOf('slides.pptx')).toBe('office');
    expect(fileKindOf('data.csv')).toBe('csv');
    expect(fileKindOf('archive.zip')).toBe('binary');
    expect(mimeTypeOf('report.PDF')).toBe('application/pdf');
  });
});

describe('readProjectFile', () => {
  it('reads file content', () => {
    expect(readProjectFile(root, 'src/index.ts')).toEqual({ content: 'export const x = 1;', truncated: false });
  });
});

describe('writeProjectFile', () => {
  it('writes content and round-trips, creating parent dirs', () => {
    writeProjectFile(root, 'a/b/c.txt', 'hello');
    expect(readFileSync(join(root, 'a/b/c.txt'), 'utf8')).toBe('hello');
  });
});

describe('projectCommitDiff', () => {
  it('rejects a non-hex hash (no git option/flag injection) and errors safely', async () => {
    expect(await projectCommitDiff(root, '-O/tmp/pwn')).toBe('');
    expect(await projectCommitDiff(root, 'not a hash')).toBe('');
    expect(await projectCommitDiff(root, '--output=/tmp/x')).toBe('');
    expect(await projectCommitDiff(root, 'deadbeef')).toBe(''); // valid hex but non-repo → caught
  });
});

describe('file-manager operations', () => {
  it('creates an empty file and refuses to clobber an existing one', () => {
    createProjectFile(root, 'a/new.ts');
    expect(readFileSync(join(root, 'a/new.ts'), 'utf8')).toBe('');
    expect(() => createProjectFile(root, 'README.md')).toThrow(/already exists/);
  });

  it('creates a directory', () => {
    createProjectDir(root, 'fresh/dir');
    expect(listProjectFiles(root).map((n) => n.path)).toContain(join('fresh', 'dir'));
    expect(() => createProjectDir(root, 'src')).toThrow(/already exists/);
  });

  it('renames an entry, requiring an existing source and a free target', () => {
    renameProjectEntry(root, 'README.md', 'docs/README.md');
    expect(existsSync(join(root, 'README.md'))).toBe(false);
    expect(readFileSync(join(root, 'docs/README.md'), 'utf8')).toBe('# hi');
    expect(() => renameProjectEntry(root, 'nope.txt', 'x.txt')).toThrow(/source does not exist/);
    expect(() => renameProjectEntry(root, 'docs/README.md', 'src/index.ts')).toThrow(/already exists/);
  });

  it('copies (duplicates) an entry', () => {
    copyProjectEntry(root, 'README.md', 'README copy.md');
    expect(readFileSync(join(root, 'README copy.md'), 'utf8')).toBe('# hi');
    expect(existsSync(join(root, 'README.md'))).toBe(true); // original untouched
    expect(() => copyProjectEntry(root, 'README.md', 'src/index.ts')).toThrow(/already exists/);
  });

  it('deletes a file or directory but never the project root', () => {
    deleteProjectEntry(root, 'README.md');
    expect(existsSync(join(root, 'README.md'))).toBe(false);
    deleteProjectEntry(root, 'src');
    expect(existsSync(join(root, 'src'))).toBe(false);
    expect(() => deleteProjectEntry(root, '.')).toThrow(/project root/);
  });

  it('reads raw bytes and bounded ranges for previews, refusing escapes', () => {
    expect(readProjectBytes(root, 'README.md')?.toString('utf8')).toBe('# hi');
    expect(readProjectRange(root, 'README.md', 2, 3)).toMatchObject({ size: 4, start: 2, end: 3 });
    expect(readProjectRange(root, 'README.md', 2, 3)?.bytes.toString()).toBe('hi');
    expect(readProjectRange(root, 'README.md', 99)).toBeNull();
    expect(() => readProjectBytes(root, '../../etc/passwd')).toThrow(/outside project/);
  });

  it('refuses file-manager ops that escape the project root', () => {
    expect(() => createProjectFile(root, '../escape.ts')).toThrow(/outside project/);
    expect(() => createProjectDir(root, '../escape')).toThrow(/outside project/);
    expect(() => deleteProjectEntry(root, '../../tmp')).toThrow(/outside project/);
    expect(() => renameProjectEntry(root, 'README.md', '../escape.md')).toThrow(/outside project/);
    expect(() => copyProjectEntry(root, 'README.md', '../escape.md')).toThrow(/outside project/);
  });
});

describe('Office preview conversion', () => {
  it.runIf(existsSync('/usr/bin/soffice'))('converts an Office document to a bounded PDF preview', async () => {
    w('brief.txt', 'Office preview');
    execFileSync('soffice', [`-env:UserInstallation=${pathToFileURL(join(root, 'fixture-profile')).href}`, '--headless', '--convert-to', 'docx', '--outdir', root, join(root, 'brief.txt')], { stdio: 'pipe' });
    const pdf = await convertOfficeToPdf(safeProjectPath, root, 'brief.docx');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 15_000);
});

describe('projectCommitFiles / projectCommitFileDiff', () => {
  it('rejects a non-hex hash (no git option/flag injection) and errors safely', async () => {
    expect(await projectCommitFiles(root, '--output=/tmp/x')).toEqual([]);
    expect(await projectCommitFiles(root, 'not a hash')).toEqual([]);
    expect(await projectCommitFileDiff(root, '-O/tmp/pwn', 'README.md')).toBe('');
    expect(await projectCommitFileDiff(root, 'deadbeef', 'README.md')).toBe(''); // valid hex, non-repo → caught
  });

  it('lists a commit\'s changed files and diffs a single file within it', async () => {
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.email', 't@t.io');
    git('config', 'user.name', 'T');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    w('src/index.ts', 'export const x = 2;'); // modify a tracked file
    git('add', '-A');
    git('commit', '-q', '-m', 'change');
    const hash = git('rev-parse', 'HEAD').toString().trim();

    const files = await projectCommitFiles(root, hash);
    expect(files).toEqual([join('src', 'index.ts')]);

    const diff = await projectCommitFileDiff(root, hash, 'src/index.ts');
    expect(diff).toContain('-export const x = 1;');
    expect(diff).toContain('+export const x = 2;');
    expect(await projectCommitFileDiff(root, hash, 'README.md')).toBe(''); // untouched by this commit
  });
});

describe('projectCommitLog', () => {
  it('returns an empty list outside a git repo', async () => {
    expect(await projectCommitLog(root, 10)).toEqual([]);
  });

  it('returns commits newest-first with timestamps and per-file +/- line counts', async () => {
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.email', 't@t.io');
    git('config', 'user.name', 'T');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    w('src/index.ts', 'export const x = 2;\nexport const y = 3;'); // 1 line changed, 1 added
    git('add', '-A');
    git('commit', '-q', '-m', 'change index');

    const log = await projectCommitLog(root, 10);
    expect(log.length).toBe(2);
    // newest first
    expect(log[0].subject).toBe('change index');
    expect(log[0].author).toBe('T');
    expect(typeof log[0].timestamp).toBe('number');
    expect(log[0].timestamp).toBeGreaterThan(0);
    expect(log[0].hash).toMatch(/^[0-9a-f]{7,}$/);
    const f = log[0].files.find((x) => x.path === join('src', 'index.ts'));
    expect(f).toBeTruthy();
    expect(f!.added).toBe(2);
    expect(f!.deleted).toBe(1);
  });

  it('honors the limit and clamps a bogus limit instead of trusting it', async () => {
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.email', 't@t.io');
    git('config', 'user.name', 'T');
    for (let i = 0; i < 4; i++) { w('f.txt', `v${i}`); git('add', '-A'); git('commit', '-q', '-m', `c${i}`); }
    expect((await projectCommitLog(root, 2)).length).toBe(2);
    // a non-finite / negative limit must not blow up or inject — it falls back to a safe default
    expect((await projectCommitLog(root, -5 as number)).length).toBeGreaterThan(0);
  });
});

describe('path-traversal safety', () => {
  it('refuses to read or write outside the project root', () => {
    expect(() => readProjectFile(root, '../../etc/passwd')).toThrow(/outside project/);
    expect(() => readProjectFile(root, '/etc/passwd')).toThrow(/outside project/);
    expect(() => writeProjectFile(root, '../escape.txt', 'nope')).toThrow(/outside project/);
  });

  it('refuses to read through a symlink that points outside the project', () => {
    const outside = mkdtempSync(join(tmpdir(), 'elowen-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'SECRET');
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'link'));
      expect(() => readProjectFile(root, 'link')).toThrow(/outside project/);
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });

  it('refuses to write through a symlinked directory that escapes the project', () => {
    const outside = mkdtempSync(join(tmpdir(), 'elowen-outside-'));
    try {
      symlinkSync(outside, join(root, 'linkdir'));
      expect(() => writeProjectFile(root, 'linkdir/pwned.txt', 'nope')).toThrow(/outside project/);
      expect(existsSync(join(outside, 'pwned.txt'))).toBe(false); // nothing written outside
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });

  it('refuses to OVERWRITE an existing leaf file that is a symlink pointing outside', () => {
    const outside = mkdtempSync(join(tmpdir(), 'elowen-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'ORIGINAL');
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'link')); // existing leaf symlink
      expect(() => writeProjectFile(root, 'link', 'OVERWRITTEN')).toThrow(/outside project/);
      expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('ORIGINAL'); // untouched
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });
});
