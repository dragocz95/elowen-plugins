import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { GuestFileResult, ManagedProjectFileRoot, SandboxAccountControl } from './coreSeams.js';

const MANAGED_CHUNK_BYTES = 512 * 1024;
const MANAGED_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const MANAGED_GIT_TIMEOUT_MS = 120_000;
const MANAGED_LEASE_HEARTBEAT_MS = 10_000;

export interface ManagedEntry {
  path: string;
  rel?: string;
  kind: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  mtimeMs: number;
  version?: string;
}

export class ManagedMirror {
  readonly kind = 'managed' as const;
  readonly lockKey: string;
  get root(): string { return this.rootInfo.root; }
  constructor(
    private readonly sandbox: SandboxAccountControl,
    readonly project: { kind: 'managed'; projectId: number },
    readonly accountUserId: number,
    readonly rootInfo: ManagedProjectFileRoot,
    readonly subpath = '',
    readonly workspaceId: string | null = null,
    private readonly gitTimeoutMs = MANAGED_GIT_TIMEOUT_MS,
  ) {
    this.lockKey = `managed:${project.projectId}:${workspaceId ?? 'project'}`;
  }

  private path(rel: string): string {
    const clean = rel.replaceAll('\\', '/').replace(/^\/+/, '');
    return clean ? posix.join(this.rootInfo.root, this.subpath, clean) : posix.join(this.rootInfo.root, this.subpath);
  }

  private async call(operation: Record<string, unknown>): Promise<GuestFileResult> {
    // No root travels with the request. The runtime decides an operation's namespace from the entry point
    // it arrived through and overwrites whatever a caller names, so sending one only made it look as
    // though this plugin could choose its own confinement. `path()` above is what places an operation
    // inside the root the runtime already resolved for this project.
    const result = await this.sandbox.projectFiles({
      project: this.project,
      accountUserId: this.accountUserId,
      operation,
      workspaceId: this.workspaceId,
      expectedGeneration: this.rootInfo.generation,
      startIfNeeded: false,
    });
    if (result.kind !== operation.kind) throw new Error(`Managed filesystem returned ${result.kind} for ${String(operation.kind)}`);
    return result;
  }

  async stat(rel: string): Promise<ManagedEntry | null> {
    const result = await this.call({ kind: 'stat', path: this.path(rel) });
    if (result.kind !== 'stat' || !result.entry) return null;
    return { ...result.entry, mtimeMs: Date.parse(result.entry.modifiedAt) || 0 };
  }

  async listFolders(rel = ''): Promise<{ name: string; path: string }[]> {
    const result = await this.call({ kind: 'list', path: this.path(rel), limit: 500, metadata: true });
    if (result.kind !== 'list') throw new Error('Managed filesystem returned an invalid folder listing');
    return result.entries.filter((entry) => entry.kind === 'directory').map((entry) => ({ name: entry.path.split('/').pop() ?? '', path: rel ? `${rel}/${entry.path.split('/').pop()}` : entry.path.split('/').pop() ?? '' }));
  }

  async walk(options: { limit: number; skip?: readonly string[] }): Promise<{ entries: ManagedEntry[]; complete: boolean }> {
    // One sentinel entry is the only way an unpaged walk can distinguish an exactly-full complete tree
    // from one whose remaining paths were never examined. The guest contract admits 20,001 for the
    // mirror's documented 20,000-path cap; the sentinel itself is never presented as mirrored content.
    const result = await this.call({ kind: 'walk', path: this.path(''), limit: options.limit + 1, skip: [...(options.skip ?? [])], maxDepth: 64 });
    if (result.kind !== 'walk') throw new Error('Managed filesystem returned an invalid walk');
    const prefix = `${this.rootInfo.root.replace(/\/$/, '')}/`;
    const base = this.subpath ? `${prefix}${this.subpath.replace(/\/$/, '')}/` : prefix;
    const entries = result.entries.map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      size: entry.size,
      mtimeMs: entry.mtime,
      rel: entry.path.startsWith(base) ? entry.path.slice(base.length) : '',
    })).filter((entry) => entry.rel !== '') as (ManagedEntry & { rel: string })[];
    return { entries: entries.slice(0, options.limit), complete: !result.truncated && entries.length <= options.limit };
  }

  async open(rel: string): Promise<{ size: number; version: string; read(offset: number, length: number): Promise<Uint8Array>; close(): Promise<void> }> {
    const path = this.path(rel);
    const first = await this.readAt(path, 0, MANAGED_CHUNK_BYTES);
    const version = first.version;
    return {
      size: first.totalBytes,
      version,
      read: async (offset, length) => {
        const result = await this.readAt(path, offset, length, version);
        if (result.version !== version || result.totalBytes !== first.totalBytes) throw new Error(`Managed file changed while it was being read: ${rel}`);
        return result.bytes;
      },
      close: async () => {},
    };
  }

  private async readAt(path: string, offset: number, length: number, expectedVersion?: string): Promise<{ bytes: Uint8Array; version: string; totalBytes: number }> {
    const result = await this.call({ kind: 'read', path, maxBytes: Math.min(MANAGED_CHUNK_BYTES, Math.max(0, length)), offset, length, ...(expectedVersion ? { expectedVersion } : {}) });
    if (result.kind !== 'read') throw new Error('Managed filesystem returned an invalid read');
    const bytes = Buffer.from(result.base64, 'base64');
    if (bytes.length > length || bytes.length > MANAGED_CHUNK_BYTES) throw new Error('Managed filesystem exceeded its read bound');
    return { bytes, version: result.version, totalBytes: result.totalBytes };
  }

  async hash(rel: string): Promise<{ sha256: string; size: number; version: string }> {
    const file = await this.open(rel);
    const hash = createHash('sha256');
    let offset = 0;
    try {
      while (offset < file.size) {
        const bytes = await file.read(offset, Math.min(MANAGED_CHUNK_BYTES, file.size - offset));
        if (!bytes.length) throw new Error(`Managed file ended before EOF: ${rel}`);
        hash.update(bytes);
        offset += bytes.length;
      }
      return { sha256: hash.digest('hex'), size: file.size, version: file.version };
    } finally { await file.close(); }
  }

  async write(rel: string, bytes: Uint8Array, expectedVersion: string | null): Promise<ManagedEntry> {
    if (bytes.length <= MANAGED_CHUNK_BYTES) {
      const result = await this.call({ kind: 'write', path: this.path(rel), base64: Buffer.from(bytes).toString('base64'), expectedVersion });
      if (result.kind !== 'write') throw new Error('Managed filesystem returned an invalid write');
      return { ...result.entry, mtimeMs: Date.parse(result.entry.modifiedAt) || 0 };
    }
    const begin = await this.call({ kind: 'write-begin', path: this.path(rel), expectedVersion, size: bytes.length });
    if (begin.kind !== 'write-begin') throw new Error('Managed filesystem returned an invalid write handle');
    try {
      for (let offset = 0; offset < bytes.length; offset += begin.chunkSize) {
        await this.call({ kind: 'write-chunk', path: this.path(rel), uploadId: begin.uploadId, offset, base64: Buffer.from(bytes.subarray(offset, Math.min(bytes.length, offset + begin.chunkSize))).toString('base64') });
      }
      const done = await this.call({ kind: 'write-commit', path: this.path(rel), uploadId: begin.uploadId });
      if (done.kind !== 'write-commit') throw new Error('Managed filesystem returned an invalid committed write');
      return { ...done.entry, mtimeMs: Date.parse(done.entry.modifiedAt) || 0 };
    } catch (error) {
      try { await this.call({ kind: 'write-abort', path: this.path(rel), uploadId: begin.uploadId }); }
      catch { /* Preserve the original write failure; the guest lease still expires safely. */ }
      throw error;
    }
  }

  async mkdir(rel: string): Promise<void> { await this.call({ kind: 'mkdir', path: this.path(rel) }); }
  async rename(rel: string, destination: string, expectedVersion: string): Promise<void> { await this.call({ kind: 'rename', path: this.path(rel), destination: this.path(destination), expectedVersion }); }
  async remove(rel: string, expectedVersion: string): Promise<boolean> {
    const result = await this.call({ kind: 'remove', path: this.path(rel), expectedVersion });
    return result.kind === 'remove' && result.removed;
  }

  async git(args: readonly string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    const prepared = await this.sandbox.prepareExecution({ command: { type: 'argv', file: '/usr/bin/git', args: [...args] }, cwd: this.path(''), leaseKind: 'files', projectRef: this.project }, { accountUserId: this.accountUserId, roots: [this.rootInfo.root] });
    if (prepared.mode !== 'managed' || prepared.projectRef?.kind !== 'managed' || prepared.projectRef.projectId !== this.project.projectId
      || typeof prepared.cancel !== 'function') {
      await prepared.lease.release();
      throw new Error('Managed Git execution returned a different Project or an incomplete launch');
    }
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let interrupt!: (error: unknown) => void;
      const interrupted = new Promise<never>((_resolve, reject) => { interrupt = reject; });
      void interrupted.catch(() => {});
      timer = setTimeout(() => interrupt(new Error('Managed Git command timed out')), this.gitTimeoutMs);
      heartbeat = setInterval(() => { void Promise.resolve().then(() => prepared.lease.heartbeat()).catch(interrupt); }, MANAGED_LEASE_HEARTBEAT_MS);
      const session = await Promise.race([prepared.start(), interrupted]);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      const collect = (chunk: Buffer, target: Buffer[]): void => {
        bytes += chunk.length;
        if (bytes > MANAGED_GIT_OUTPUT_BYTES) interrupt(new Error('Managed Git output exceeded its bound'));
        else target.push(chunk);
      };
      session.stdout.on('data', (chunk: Buffer) => collect(chunk, stdout));
      session.stderr.on('data', (chunk: Buffer) => collect(chunk, stderr));
      session.stdin.end();
      const result = await Promise.race([session.closed, interrupted]);
      if (result.code === null) throw new Error('Managed Git command ended by signal');
      return { stdout: prepared.sanitizeOutput(Buffer.concat(stdout).toString('utf8')),
        stderr: prepared.sanitizeOutput(Buffer.concat(stderr).toString('utf8')), code: result.code };
    } catch (error) {
      await prepared.cancel();
      const value = error as { stdout?: unknown; stderr?: unknown; code?: unknown; message?: unknown };
      const stderr = String(value.stderr ?? '');
      return { stdout: String(value.stdout ?? ''), stderr: stderr || String(value.message ?? ''), code: typeof value.code === 'number' ? value.code : 1 };
    } finally {
      clearTimeout(timer);
      clearInterval(heartbeat);
      await prepared.lease.release();
    }
  }
}
