import { closeSync, mkdirSync, openSync, rmSync, writeSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { CONTENT_TYPES, PublishError, type SnapshotLimits, type SnapshotResult, extensionOf } from './publish.js';

const READ_CHUNK_BYTES = 256 * 1024;
const MAX_STATIC_FILES = 5_000;
const MAX_APPLICATION_FILES = 60_000;
const STATIC_SKIPS = ['.git', 'node_modules', '.next', '.cache', '.DS_Store'];
const APPLICATION_SKIPS = ['.git'];

interface GuestWalkResult {
  kind: 'walk';
  root: string;
  rootKind: 'file' | 'directory' | 'symlink' | 'other' | null;
  entries: { path: string; kind: 'file' | 'directory' | 'symlink'; size: number; mtime: number }[];
  truncated: boolean;
}

interface GuestReadResult {
  kind: 'read';
  base64: string;
  version: string;
  totalBytes: number;
}

export interface ManagedProjectFiles {
  projectFiles(input: {
    project: { kind: 'managed'; projectId: number };
    accountUserId: number;
    operation:
      | { kind: 'walk'; path: string; limit: number; skip?: string[] }
      | { kind: 'read'; path: string; maxBytes: number; offset: number; length: number }
      | { kind: 'mkdir'; path: string };
  }): Promise<GuestWalkResult | GuestReadResult | { kind: 'mkdir'; entry: unknown }>;
}

const within = (root: string, path: string): string | null => {
  const rel = posix.relative(root, path);
  if (rel === '' || rel === '..' || rel.startsWith('../') || posix.isAbsolute(rel)) return null;
  return rel;
};

/** Copy a managed Project tree through Sandbox's bounded, versioned guest-file transport.
 *
 * No host path is resolved. Each file is read in bounded chunks and every chunk must report the same
 * content version and total size. A Project generation change or an in-place source edit therefore fails
 * the publication instead of combining bytes from two versions. The caller supplies a fresh release
 * directory; any partial tree is removed before an error escapes. */
export async function snapshotManagedRelease(
  control: ManagedProjectFiles,
  input: {
    projectId: number;
    accountUserId: number;
    sourceRoot: string;
    releaseDir: string;
    limits: SnapshotLimits;
  },
): Promise<SnapshotResult> {
  const application = input.limits.mode === 'command' || input.limits.mode === 'php';
  const fileLimit = application ? MAX_APPLICATION_FILES : MAX_STATIC_FILES;
  const warnings: string[] = [];
  let fileCount = 0;
  let sizeBytes = 0;

  try {
    const walked = await control.projectFiles({
      project: { kind: 'managed', projectId: input.projectId },
      accountUserId: input.accountUserId,
      operation: {
        kind: 'walk',
        path: input.sourceRoot,
        limit: fileLimit + 1,
        skip: application ? APPLICATION_SKIPS : STATIC_SKIPS,
      },
    });
    if (walked.kind !== 'walk') throw new PublishError('Sandbox returned an invalid Project file listing.');
    if (walked.rootKind === null) throw new PublishError('the build output does not exist. Build the project first.');
    if (walked.rootKind !== 'directory') throw new PublishError('the build output is not a directory.');
    if (walked.truncated) throw new PublishError(`the output has more than ${fileLimit} entries.`);

    mkdirSync(input.releaseDir, { recursive: true });
    for (const entry of walked.entries) {
      const rel = within(input.sourceRoot, entry.path);
      if (!rel) continue;
      const target = join(input.releaseDir, ...rel.split('/'));
      if (entry.kind === 'directory') {
        mkdirSync(target, { recursive: true });
        continue;
      }
      if (entry.kind === 'symlink') {
        warnings.push(`skipped symlink ${rel}`);
        continue;
      }
      if (!application) {
        const ext = extensionOf(rel);
        if (!(ext in CONTENT_TYPES)) {
          warnings.push(`skipped ${rel} (.${ext || 'no extension'} is not a publishable file type)`);
          continue;
        }
      }
      if (fileCount >= fileLimit) throw new PublishError(`the output has more than ${fileLimit} files.`);
      if (entry.size > input.limits.maxAssetBytes) {
        throw new PublishError(`${rel} is ${Math.ceil(entry.size / 1048576)} MB, above the per-file limit. Reduce it or raise "Largest file" in the plugin settings.`);
      }

      mkdirSync(dirname(target), { recursive: true });
      const output = openSync(target, 'wx', 0o644);
      let offset = 0;
      let version: string | null = null;
      let totalBytes: number | null = null;
      try {
        do {
          const read = await control.projectFiles({
            project: { kind: 'managed', projectId: input.projectId },
            accountUserId: input.accountUserId,
            operation: { kind: 'read', path: entry.path, maxBytes: READ_CHUNK_BYTES, offset, length: READ_CHUNK_BYTES },
          });
          if (read.kind !== 'read') throw new PublishError('Sandbox returned an invalid Project file read.');
          if (version === null) {
            version = read.version;
            totalBytes = read.totalBytes;
            if (totalBytes > input.limits.maxAssetBytes) {
              throw new PublishError(`${rel} is ${Math.ceil(totalBytes / 1048576)} MB, above the per-file limit. Reduce it or raise "Largest file" in the plugin settings.`);
            }
            if (sizeBytes + totalBytes > input.limits.maxTotalBytes) {
              throw new PublishError('the build output is larger than the per-site limit. Reduce it or raise "Largest site" in the plugin settings.');
            }
          } else if (read.version !== version || read.totalBytes !== totalBytes) {
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
      } finally {
        closeSync(output);
      }
      fileCount += 1;
      sizeBytes += totalBytes ?? 0;
    }

    if (fileCount === 0) throw new PublishError('the build output contains no publishable files.');
    if (!application && !walked.entries.some((entry) => entry.kind === 'file' && within(input.sourceRoot, entry.path) === 'index.html')) {
      warnings.push('there is no index.html at the top of the output, so the site root will not render.');
    }
    return { fileCount, sizeBytes, warnings };
  } catch (error) {
    rmSync(input.releaseDir, { recursive: true, force: true });
    throw error;
  }
}
