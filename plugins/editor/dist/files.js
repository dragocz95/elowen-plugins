import { readFileSync, writeFileSync, statSync, readdirSync, mkdirSync, realpathSync, existsSync, rmSync, renameSync, cpSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const IGNORE = new Set(['.git', 'node_modules', '.next', 'dist', '.turbo', 'coverage', '.cache']);
const MAX_FILE = 2 * 1024 * 1024;
const MAX_RAW = 10 * 1024 * 1024;
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
            if (IGNORE.has(entry.name))
                continue;
            const abs = join(dir, entry.name);
            const path = relative(resolvedRoot, abs);
            if (entry.isDirectory()) {
                out.push({ path, type: 'dir' });
                if (depth < maxDepth)
                    visit(abs, depth + 1);
            }
            else
                out.push({ path, type: 'file' });
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
    return !stat.isFile() || stat.size > MAX_RAW ? null : readFileSync(abs);
}
export function createProjectFile(safe, root, rel) {
    const abs = safe(root, rel, true);
    if (existsSync(abs))
        throw new EditorFileError('already exists');
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, '', 'utf8');
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
