import { chmodSync, closeSync, mkdirSync, openSync, rmSync, symlinkSync, writeSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { CONTENT_TYPES, PublishError, extensionOf } from './publish.js';
const READ_CHUNK_BYTES = 256 * 1024;
const MAX_STATIC_FILES = 5_000;
const MAX_APPLICATION_FILES = 60_000;
const STATIC_SKIPS = ['.git', 'node_modules', '.next', '.cache', '.DS_Store'];
const within = (root, path) => {
    const rel = posix.relative(root, path);
    if (rel === '' || rel === '..' || rel.startsWith('../') || posix.isAbsolute(rel))
        return null;
    return rel;
};
const manifestPath = (path) => {
    if (typeof path !== 'string' || path === '' || path.includes('\0') || posix.isAbsolute(path)) {
        throw new PublishError('Sandbox returned an invalid publication path.');
    }
    const normalized = posix.normalize(path);
    if (normalized !== path || normalized === '..' || normalized.startsWith('../')) {
        throw new PublishError('Sandbox returned a publication path outside its source root.');
    }
    return path;
};
const permissionMode = (mode) => {
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) {
        throw new PublishError('Sandbox returned invalid publication permissions.');
    }
    return mode;
};
const symlinkTarget = (path, target) => {
    if (typeof target !== 'string' || target === '' || target.includes('\0') || posix.isAbsolute(target)) {
        throw new PublishError(`the Project symlink ${path} has an unsafe target.`);
    }
    const resolved = posix.normalize(posix.join(posix.dirname(path), target));
    if (resolved === '..' || resolved.startsWith('../') || posix.isAbsolute(resolved)) {
        throw new PublishError(`the Project symlink ${path} leaves the publication root.`);
    }
    return target;
};
async function copyManagedFile(control, input, sourcePath, target, rel, metadata, sizeBefore) {
    mkdirSync(dirname(target), { recursive: true });
    const output = openSync(target, 'wx', 0o600);
    let offset = 0;
    let version = metadata.version ?? null;
    let totalBytes = null;
    try {
        do {
            const read = await control.projectFiles({
                project: { kind: 'managed', projectId: input.projectId },
                accountUserId: input.accountUserId,
                operation: { kind: 'read', path: sourcePath, maxBytes: READ_CHUNK_BYTES, offset, length: READ_CHUNK_BYTES },
            });
            if (read.kind !== 'read')
                throw new PublishError('Sandbox returned an invalid Project file read.');
            if (!Number.isSafeInteger(read.totalBytes) || read.totalBytes < 0 || read.totalBytes !== metadata.size) {
                throw new PublishError(`Sandbox returned inconsistent metadata for ${rel}.`);
            }
            if (totalBytes === null) {
                totalBytes = read.totalBytes;
                if (version !== null && read.version !== version) {
                    throw new PublishError(`the Project file ${rel} changed during publication. Build a stable output and publish again.`);
                }
                version = read.version;
                if (totalBytes > input.limits.maxAssetBytes) {
                    throw new PublishError(`${rel} is ${Math.ceil(totalBytes / 1048576)} MB, above the per-file limit. Reduce it or raise "Largest file" in the plugin settings.`);
                }
                if (sizeBefore + totalBytes > input.limits.maxTotalBytes) {
                    throw new PublishError('the build output is larger than the per-site limit. Reduce it or raise "Largest site" in the plugin settings.');
                }
            }
            else if (read.version !== version || read.totalBytes !== totalBytes) {
                throw new PublishError(`the Project file ${rel} changed during publication. Build a stable output and publish again.`);
            }
            const chunk = Buffer.from(read.base64, 'base64');
            if (chunk.length > READ_CHUNK_BYTES || chunk.length > (totalBytes ?? 0) - offset) {
                throw new PublishError('Sandbox returned an invalid Project file chunk.');
            }
            if (chunk.length === 0 && offset < (totalBytes ?? 0)) {
                throw new PublishError(`the Project file ${rel} ended before its declared size.`);
            }
            for (let written = 0; written < chunk.length;) {
                written += writeSync(output, chunk, written, chunk.length - written);
            }
            offset += chunk.length;
        } while (offset < (totalBytes ?? 0));
    }
    finally {
        closeSync(output);
    }
    chmodSync(target, metadata.mode);
    return totalBytes ?? 0;
}
function validateApplicationManifest(result) {
    if (typeof result.root !== 'string' || !posix.isAbsolute(result.root)) {
        throw new PublishError('Sandbox returned an invalid application manifest root.');
    }
    permissionMode(result.mode);
    if (!Array.isArray(result.entries) || result.entries.length > MAX_APPLICATION_FILES) {
        throw new PublishError(`the output has more than ${MAX_APPLICATION_FILES} entries.`);
    }
    const entries = [];
    const byPath = new Map();
    for (const raw of result.entries) {
        if (!raw || !['file', 'directory', 'symlink'].includes(raw.kind)) {
            throw new PublishError('Sandbox returned an unsupported publication entry.');
        }
        const path = manifestPath(raw.path);
        const mode = permissionMode(raw.mode);
        if (byPath.has(path))
            throw new PublishError(`Sandbox returned duplicate publication metadata for ${path}.`);
        let entry;
        if (raw.kind === 'file') {
            if (!Number.isSafeInteger(raw.size) || (raw.size ?? -1) < 0 || typeof raw.version !== 'string' || raw.version === '') {
                throw new PublishError(`Sandbox returned incomplete file metadata for ${path}.`);
            }
            entry = { path, kind: 'file', mode, size: raw.size, version: raw.version };
        }
        else if (raw.kind === 'symlink') {
            entry = { path, kind: 'symlink', mode, target: symlinkTarget(path, raw.target) };
        }
        else {
            entry = { path, kind: 'directory', mode };
        }
        entries.push(entry);
        byPath.set(path, entry);
    }
    for (const entry of entries) {
        let parent = posix.dirname(entry.path);
        while (parent !== '.') {
            const ancestor = byPath.get(parent);
            if (!ancestor || ancestor.kind !== 'directory') {
                throw new PublishError(`Sandbox returned inconsistent publication ancestry for ${entry.path}.`);
            }
            parent = posix.dirname(parent);
        }
        if (entry.kind === 'symlink') {
            const resolved = posix.normalize(posix.join(posix.dirname(entry.path), entry.target));
            if (resolved !== '.' && !byPath.has(resolved)) {
                throw new PublishError(`the Project symlink ${entry.path} has no target in the publication manifest.`);
            }
        }
    }
    return entries;
}
async function snapshotManagedApplication(control, input) {
    const result = await control.projectFiles({
        project: { kind: 'managed', projectId: input.projectId },
        accountUserId: input.accountUserId,
        operation: { kind: 'export-manifest', path: input.sourceRoot },
    });
    if (result.kind !== 'export-manifest')
        throw new PublishError('Sandbox returned an invalid application manifest.');
    const entries = validateApplicationManifest(result);
    const directories = entries.filter((entry) => entry.kind === 'directory').sort((a, b) => a.path.length - b.path.length);
    const files = entries.filter((entry) => entry.kind === 'file');
    const symlinks = entries.filter((entry) => entry.kind === 'symlink');
    let fileCount = 0;
    let sizeBytes = 0;
    mkdirSync(input.releaseDir, { recursive: true });
    for (const entry of directories)
        mkdirSync(join(input.releaseDir, ...entry.path.split('/')), { recursive: true });
    for (const entry of files) {
        if (fileCount >= MAX_APPLICATION_FILES)
            throw new PublishError(`the output has more than ${MAX_APPLICATION_FILES} files.`);
        const target = join(input.releaseDir, ...entry.path.split('/'));
        const copied = await copyManagedFile(control, input, posix.join(input.sourceRoot, entry.path), target, entry.path, { size: entry.size, version: entry.version, mode: entry.mode }, sizeBytes);
        fileCount += 1;
        sizeBytes += copied;
    }
    for (const entry of symlinks) {
        if (fileCount >= MAX_APPLICATION_FILES)
            throw new PublishError(`the output has more than ${MAX_APPLICATION_FILES} files.`);
        const bytes = Buffer.byteLength(entry.target);
        if (sizeBytes + bytes > input.limits.maxTotalBytes) {
            throw new PublishError('the build output is larger than the per-site limit. Reduce it or raise "Largest site" in the plugin settings.');
        }
        symlinkSync(entry.target, join(input.releaseDir, ...entry.path.split('/')));
        fileCount += 1;
        sizeBytes += bytes;
    }
    for (const entry of directories.sort((a, b) => b.path.length - a.path.length)) {
        chmodSync(join(input.releaseDir, ...entry.path.split('/')), entry.mode);
    }
    if (fileCount === 0)
        throw new PublishError('the build output contains no publishable files.');
    return { fileCount, sizeBytes, warnings: [] };
}
/** Copy a managed Project tree through Sandbox's bounded, versioned guest-file transport.
 *
 * No host path is resolved. Static output uses a bounded walk. Command and PHP output use Sandbox's
 * publication manifest so executable bits and safe relative symlinks survive the immutable snapshot.
 * Every regular file is read in bounded chunks against one content version. Any partial tree is removed
 * before an error escapes. */
export async function snapshotManagedRelease(control, input) {
    const application = input.limits.mode === 'command' || input.limits.mode === 'php';
    try {
        if (application)
            return await snapshotManagedApplication(control, input);
        const warnings = [];
        let fileCount = 0;
        let sizeBytes = 0;
        const walked = await control.projectFiles({
            project: { kind: 'managed', projectId: input.projectId },
            accountUserId: input.accountUserId,
            operation: { kind: 'walk', path: input.sourceRoot, limit: MAX_STATIC_FILES + 1, skip: STATIC_SKIPS },
        });
        if (walked.kind !== 'walk')
            throw new PublishError('Sandbox returned an invalid Project file listing.');
        if (walked.rootKind === null)
            throw new PublishError('the build output does not exist. Build the project first.');
        if (walked.rootKind !== 'directory')
            throw new PublishError('the build output is not a directory.');
        if (walked.truncated)
            throw new PublishError(`the output has more than ${MAX_STATIC_FILES} entries.`);
        mkdirSync(input.releaseDir, { recursive: true });
        for (const entry of walked.entries) {
            const rel = within(input.sourceRoot, entry.path);
            if (!rel)
                continue;
            const target = join(input.releaseDir, ...rel.split('/'));
            if (entry.kind === 'directory') {
                mkdirSync(target, { recursive: true });
                continue;
            }
            if (entry.kind === 'symlink') {
                warnings.push(`skipped symlink ${rel}`);
                continue;
            }
            const ext = extensionOf(rel);
            if (!(ext in CONTENT_TYPES)) {
                warnings.push(`skipped ${rel} (.${ext || 'no extension'} is not a publishable file type)`);
                continue;
            }
            if (fileCount >= MAX_STATIC_FILES)
                throw new PublishError(`the output has more than ${MAX_STATIC_FILES} files.`);
            if (!Number.isSafeInteger(entry.size) || entry.size < 0)
                throw new PublishError(`Sandbox returned inconsistent metadata for ${rel}.`);
            const copied = await copyManagedFile(control, input, entry.path, target, rel, { size: entry.size, mode: 0o644 }, sizeBytes);
            fileCount += 1;
            sizeBytes += copied;
        }
        if (fileCount === 0)
            throw new PublishError('the build output contains no publishable files.');
        if (!walked.entries.some((entry) => entry.kind === 'file' && within(input.sourceRoot, entry.path) === 'index.html')) {
            warnings.push('there is no index.html at the top of the output, so the site root will not render.');
        }
        return { fileCount, sizeBytes, warnings };
    }
    catch (error) {
        rmSync(input.releaseDir, { recursive: true, force: true });
        throw error;
    }
}
