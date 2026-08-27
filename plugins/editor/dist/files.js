import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileKindOf, MAX_BUFFERED_BYTES, MAX_OFFICE_BYTES } from './fileTypes.js';
const run = promisify(execFile);
const IGNORE = new Set(['.git', 'node_modules', '.next', 'dist', '.turbo', 'coverage', '.cache']);
/** Marks a half-written upload. Listed nowhere: an in-flight transfer is not a project file, and one
 *  left behind by a dropped connection would otherwise sit in the tree forever pretending to be one. */
const UPLOAD_SUFFIX = '.elowen-upload';
const MAX_FILE = 2 * 1024 * 1024;
const MAX_RANGE_BYTES = 8 * 1024 * 1024;
const MAX_OFFICE_OUTPUT_BYTES = MAX_BUFFERED_BYTES;
const MAX_OFFICE_CONVERSIONS = 2;
let activeOfficeConversions = 0;
/** A refusal the operator is meant to read — "already exists", "source does not exist". Only these
 *  messages travel to the client: a raw fs error carries the absolute server path of the project (and
 *  tells the caller whether a path exists), so the route maps everything else to a flat 'invalid path'. */
export class EditorFileError extends Error {
}
export function listProjectFiles(root, maxDepth = 8) {
    // A project row can outlive its directory (moved, unmounted, deleted). Listing has nothing to show
    // then, which is an empty tree — not a 500 that makes the whole editor look broken.
    let resolvedRoot;
    try {
        resolvedRoot = realpathSync(root);
    }
    catch {
        return [];
    }
    const out = [];
    const visit = (dir, depth) => {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
        for (const entry of entries) {
            if (IGNORE.has(entry.name) || entry.name.endsWith(UPLOAD_SUFFIX))
                continue;
            const abs = join(dir, entry.name);
            const path = relative(resolvedRoot, abs);
            if (entry.isDirectory()) {
                out.push({ path, type: 'dir' });
                if (depth < maxDepth)
                    visit(abs, depth + 1);
            }
            else
                out.push({ path, type: 'file', size: statSync(abs).size });
        }
    };
    visit(resolvedRoot, 0);
    return out;
}
export function readProjectFile(safe, root, rel) {
    const abs = safe(root, rel);
    const stat = statSync(abs);
    if (!stat.isFile() || stat.size > MAX_FILE)
        return { content: '', truncated: true };
    return { content: readFileSync(abs, 'utf8'), truncated: false };
}
export function writeProjectFile(safe, root, rel, content) {
    const abs = safe(root, rel, true);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
}
export function readProjectBytes(safe, root, rel) {
    const abs = safe(root, rel);
    const stat = statSync(abs);
    return !stat.isFile() || stat.size > MAX_BUFFERED_BYTES ? null : readFileSync(abs);
}
export function projectFileSize(safe, root, rel) {
    const stat = statSync(safe(root, rel));
    return stat.isFile() ? stat.size : null;
}
export function readProjectByteRange(safe, root, rel, start, requestedEnd) {
    const abs = safe(root, rel);
    const stat = statSync(abs);
    if (!stat.isFile() || start < 0 || start >= stat.size)
        return null;
    const end = Math.min(requestedEnd ?? stat.size - 1, stat.size - 1, start + MAX_RANGE_BYTES - 1);
    if (end < start)
        return null;
    const bytes = Buffer.allocUnsafe(end - start + 1);
    const fd = openSync(abs, 'r');
    try {
        const read = readSync(fd, bytes, 0, bytes.length, start);
        return { bytes: read === bytes.length ? bytes : bytes.subarray(0, read), size: stat.size, start, end: start + read - 1 };
    }
    finally {
        closeSync(fd);
    }
}
export class OfficePreviewError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
export async function convertOfficeToPdf(safe, root, rel) {
    const abs = safe(root, rel);
    const stat = statSync(abs);
    if (!stat.isFile() || fileKindOf(rel) !== 'office')
        throw new OfficePreviewError(415, 'unsupported office file');
    if (stat.size > MAX_OFFICE_BYTES)
        throw new OfficePreviewError(413, 'office file is too large to preview');
    if (activeOfficeConversions >= MAX_OFFICE_CONVERSIONS)
        throw new OfficePreviewError(429, 'office preview is busy');
    activeOfficeConversions += 1;
    const work = mkdtempSync(join(tmpdir(), 'elowen-office-preview-'));
    const outDir = join(work, 'out');
    const profileDir = join(work, 'profile');
    mkdirSync(outDir);
    try {
        await run('soffice', [
            `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
            '--headless', '--convert-to', 'pdf', '--outdir', outDir, abs,
        ], { timeout: 20_000, maxBuffer: 1024 * 1024 });
        const output = join(outDir, `${basename(abs, `.${rel.split('.').pop() ?? ''}`)}.pdf`);
        if (!existsSync(output))
            throw new OfficePreviewError(415, 'office conversion failed');
        const outputStat = statSync(output);
        if (!outputStat.isFile() || outputStat.size > MAX_OFFICE_OUTPUT_BYTES)
            throw new OfficePreviewError(413, 'converted preview is too large');
        return readFileSync(output);
    }
    catch (error) {
        if (error instanceof OfficePreviewError)
            throw error;
        throw new OfficePreviewError(415, 'office conversion failed');
    }
    finally {
        activeOfficeConversions -= 1;
        rmSync(work, { recursive: true, force: true });
    }
}
export function createProjectFile(safe, root, rel) {
    const abs = safe(root, rel, true);
    if (existsSync(abs))
        throw new EditorFileError('already exists');
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, '', 'utf8');
}
/** Appends one chunk of an upload beside its destination, and on the final chunk moves it into place.
 *
 *  It goes through a temp file rather than straight at the target for the reason that matters to
 *  somebody dropping a file in: an upload that dies halfway must not leave a truncated file sitting
 *  where the real one should be, looking complete to every reader. Until the last chunk lands there is
 *  nothing at the destination at all.
 *
 *  `offset` is what the caller believes has already been written, and it must match the temp file
 *  exactly. Chunks that arrive out of order or with a gap are refused instead of padded — silently
 *  zero-filling the hole would produce a corrupt file that no error ever mentioned. */
export function uploadProjectChunk(safe, root, rel, bytes, offset, final, overwrite) {
    if (!Number.isSafeInteger(offset) || offset < 0)
        throw new EditorFileError('invalid offset');
    // What the editor hands back on download it will also accept, so the ceiling is the same one.
    if (offset + bytes.length > MAX_BUFFERED_BYTES)
        throw new EditorFileError('file too large');
    const abs = safe(root, rel, true);
    // The temp lives beside the target so it lands on the same filesystem — a rename across devices is
    // not atomic, and the whole point of the temp is that the move either happened or did not.
    const temp = `${abs}${UPLOAD_SUFFIX}`;
    // Refuse an unintended overwrite at the START, before a large upload spends time on the wire, and
    // again at the END, because the file may have appeared in between.
    if (!overwrite && existsSync(abs))
        throw new EditorFileError('already exists');
    mkdirSync(dirname(abs), { recursive: true });
    const written = offset === 0 ? 0 : existsSync(temp) ? statSync(temp).size : 0;
    if (offset !== written)
        throw new EditorFileError('upload out of order');
    writeFileSync(temp, bytes, { flag: offset === 0 ? 'w' : 'a' });
    const total = statSync(temp).size;
    if (!final)
        return { written: total };
    if (!overwrite && existsSync(abs)) {
        rmSync(temp, { force: true });
        throw new EditorFileError('already exists');
    }
    renameSync(temp, abs);
    return { written: total };
}
export function createProjectDir(safe, root, rel) {
    const abs = safe(root, rel, true);
    if (existsSync(abs))
        throw new EditorFileError('already exists');
    mkdirSync(abs, { recursive: true });
}
export function deleteProjectEntry(safe, root, rel) {
    const projectRoot = realpathSync(root);
    const abs = safe(root, rel, true);
    if (abs === projectRoot)
        throw new EditorFileError('cannot delete project root');
    rmSync(abs, { recursive: true, force: true });
}
export function renameProjectEntry(safe, root, from, to) {
    const src = safe(root, from, true);
    const dst = safe(root, to, true);
    if (!existsSync(src))
        throw new EditorFileError('source does not exist');
    if (existsSync(dst))
        throw new EditorFileError('target already exists');
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(src, dst);
}
export function copyProjectEntry(safe, root, from, to) {
    const src = safe(root, from, true);
    const dst = safe(root, to, true);
    if (!existsSync(src))
        throw new EditorFileError('source does not exist');
    if (existsSync(dst))
        throw new EditorFileError('target already exists');
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst, { recursive: true });
}
const gitRoot = (root) => realpathSync(root);
export async function projectChangedFiles(root) {
    try {
        const { stdout } = await run('git', ['-C', gitRoot(root), 'status', '--porcelain'], { maxBuffer: 4 * 1024 * 1024 });
        return stdout.split('\n').map((line) => line.slice(3).trim()).filter(Boolean).map((path) => { const at = path.indexOf(' -> '); return at >= 0 ? path.slice(at + 4) : path; });
    }
    catch {
        return [];
    }
}
export async function projectWorkingDiff(root) {
    try {
        return (await run('git', ['-C', gitRoot(root), 'diff', 'HEAD'], { maxBuffer: 8 * 1024 * 1024 })).stdout;
    }
    catch {
        return '';
    }
}
export async function projectFileAtHead(safe, root, rel) {
    const resolvedRoot = gitRoot(root);
    const clean = relative(resolvedRoot, safe(root, rel));
    try {
        return (await run('git', ['-C', resolvedRoot, 'show', `HEAD:${clean}`], { maxBuffer: 4 * 1024 * 1024 })).stdout;
    }
    catch {
        return '';
    }
}
export async function projectFileDiff(safe, root, rel) {
    const resolvedRoot = gitRoot(root);
    const clean = relative(resolvedRoot, safe(root, rel));
    try {
        return (await run('git', ['-C', resolvedRoot, 'diff', '--', clean], { maxBuffer: 4 * 1024 * 1024 })).stdout;
    }
    catch {
        return '';
    }
}
/** Kept byte-identical to the host's `src/shared/gitSha.ts` (a plugin cannot import runtime code from
 *  core, and `tests/contract/editorGitShaParity.test.ts` holds the two in step). Hex-only by design: the
 *  value is interpolated into a `git` command line, and the plain-hex shape is what guarantees it can
 *  never be read as a flag or a pathspec. The lower bound is 4, because that is the shortest hash git
 *  itself abbreviates to and the UI passes through whatever the user pasted. */
const isGitSha = (value) => /^[0-9a-f]{4,40}$/i.test(value);
export async function projectCommitDiff(root, hash) {
    if (!isGitSha(hash))
        return '';
    try {
        return (await run('git', ['-C', gitRoot(root), 'show', '--stat', '--patch', hash], { maxBuffer: 8 * 1024 * 1024 })).stdout;
    }
    catch {
        return '';
    }
}
export async function projectCommitFiles(root, hash) {
    if (!isGitSha(hash))
        return [];
    try {
        return (await run('git', ['-C', gitRoot(root), 'show', '--name-only', '--pretty=format:', hash], { maxBuffer: 4 * 1024 * 1024 })).stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    }
    catch {
        return [];
    }
}
export async function projectCommitFileDiff(safe, root, hash, rel) {
    if (!isGitSha(hash))
        return '';
    const resolvedRoot = gitRoot(root);
    const clean = relative(resolvedRoot, safe(root, rel));
    try {
        return (await run('git', ['-C', resolvedRoot, 'show', '--pretty=format:', hash, '--', clean], { maxBuffer: 4 * 1024 * 1024 })).stdout;
    }
    catch {
        return '';
    }
}
export async function projectCommitLog(root, limit) {
    // The route clamps to [1,500]; this guards a direct caller without narrowing that range.
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 30;
    try {
        const { stdout } = await run('git', ['-C', gitRoot(root), 'log', '-n', String(n), '--numstat', '--pretty=format:\x01%h\x09%ct\x09%an\x09%s'], { maxBuffer: 8 * 1024 * 1024 });
        const commits = [];
        let current = null;
        for (const line of stdout.split('\n')) {
            if (line.startsWith('\x01')) {
                const [hash = '', ts = '', author = '', ...subject] = line.slice(1).split('\t');
                current = { hash, author, subject: subject.join('\t'), timestamp: Number(ts) * 1000, files: [] };
                commits.push(current);
            }
            else if (current && line.trim()) {
                const [added = '', deleted = '', ...path] = line.split('\t');
                const joined = path.join('\t').trim();
                if (joined)
                    current.files.push({ path: joined, added: added === '-' ? 0 : Number(added) || 0, deleted: deleted === '-' ? 0 : Number(deleted) || 0 });
            }
        }
        return commits;
    }
    catch {
        return [];
    }
}
