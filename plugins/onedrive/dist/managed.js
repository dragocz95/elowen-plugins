import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { posix } from 'node:path';
const execFileP = promisify(execFile);
const MANAGED_CHUNK_BYTES = 512 * 1024;
export class ManagedMirror {
    sandbox;
    project;
    accountUserId;
    rootInfo;
    subpath;
    workspaceId;
    kind = 'managed';
    lockKey;
    get root() { return this.rootInfo.root; }
    constructor(sandbox, project, accountUserId, rootInfo, subpath = '', workspaceId = null) {
        this.sandbox = sandbox;
        this.project = project;
        this.accountUserId = accountUserId;
        this.rootInfo = rootInfo;
        this.subpath = subpath;
        this.workspaceId = workspaceId;
        this.lockKey = `managed:${project.projectId}:${workspaceId ?? 'project'}`;
    }
    path(rel) {
        const clean = rel.replaceAll('\\', '/').replace(/^\/+/, '');
        return clean ? posix.join(this.rootInfo.root, this.subpath, clean) : posix.join(this.rootInfo.root, this.subpath);
    }
    async call(operation) {
        const result = await this.sandbox.projectFiles({
            project: this.project,
            accountUserId: this.accountUserId,
            operation: { ...operation, root: this.rootInfo.root },
            root: this.rootInfo.root,
            workspaceId: this.workspaceId,
            expectedGeneration: this.rootInfo.generation,
            startIfNeeded: false,
        });
        if (result.kind !== operation.kind)
            throw new Error(`Managed filesystem returned ${result.kind} for ${String(operation.kind)}`);
        return result;
    }
    async stat(rel) {
        const result = await this.call({ kind: 'stat', path: this.path(rel) });
        if (result.kind !== 'stat' || !result.entry)
            return null;
        return { ...result.entry, mtimeMs: Date.parse(result.entry.modifiedAt) || 0 };
    }
    async listFolders(rel = '') {
        const result = await this.call({ kind: 'list', path: this.path(rel), limit: 500, metadata: true });
        if (result.kind !== 'list')
            throw new Error('Managed filesystem returned an invalid folder listing');
        return result.entries.filter((entry) => entry.kind === 'directory').map((entry) => ({ name: entry.path.split('/').pop() ?? '', path: rel ? `${rel}/${entry.path.split('/').pop()}` : entry.path.split('/').pop() ?? '' }));
    }
    async walk(options) {
        const result = await this.call({ kind: 'walk', path: this.path(''), limit: options.limit, skip: [...(options.skip ?? [])], maxDepth: 64 });
        if (result.kind !== 'walk')
            throw new Error('Managed filesystem returned an invalid walk');
        const prefix = `${this.rootInfo.root.replace(/\/$/, '')}/`;
        const base = this.subpath ? `${prefix}${this.subpath.replace(/\/$/, '')}/` : prefix;
        const entries = result.entries.map((entry) => ({
            path: entry.path,
            kind: entry.kind,
            size: entry.size,
            mtimeMs: entry.mtime,
            rel: entry.path.startsWith(base) ? entry.path.slice(base.length) : '',
        })).filter((entry) => entry.rel !== '');
        return { entries, complete: !result.truncated };
    }
    async open(rel) {
        const path = this.path(rel);
        const first = await this.readAt(path, 0, MANAGED_CHUNK_BYTES);
        const version = first.version;
        return {
            size: first.totalBytes,
            version,
            read: async (offset, length) => {
                const result = await this.readAt(path, offset, length, version);
                if (result.version !== version || result.totalBytes !== first.totalBytes)
                    throw new Error(`Managed file changed while it was being read: ${rel}`);
                return result.bytes;
            },
            close: async () => { },
        };
    }
    async readAt(path, offset, length, expectedVersion) {
        const result = await this.call({ kind: 'read', path, maxBytes: Math.min(MANAGED_CHUNK_BYTES, Math.max(0, length)), offset, length, ...(expectedVersion ? { expectedVersion } : {}) });
        if (result.kind !== 'read')
            throw new Error('Managed filesystem returned an invalid read');
        const bytes = Buffer.from(result.base64, 'base64');
        if (bytes.length > length || bytes.length > MANAGED_CHUNK_BYTES)
            throw new Error('Managed filesystem exceeded its read bound');
        return { bytes, version: result.version, totalBytes: result.totalBytes };
    }
    async hash(rel) {
        const file = await this.open(rel);
        const hash = createHash('sha256');
        let offset = 0;
        try {
            while (offset < file.size) {
                const bytes = await file.read(offset, Math.min(MANAGED_CHUNK_BYTES, file.size - offset));
                if (!bytes.length)
                    throw new Error(`Managed file ended before EOF: ${rel}`);
                hash.update(bytes);
                offset += bytes.length;
            }
            return { sha256: hash.digest('hex'), size: file.size, version: file.version };
        }
        finally {
            await file.close();
        }
    }
    async write(rel, bytes, expectedVersion) {
        if (bytes.length <= MANAGED_CHUNK_BYTES) {
            const result = await this.call({ kind: 'write', path: this.path(rel), base64: Buffer.from(bytes).toString('base64'), expectedVersion });
            if (result.kind !== 'write')
                throw new Error('Managed filesystem returned an invalid write');
            return { ...result.entry, mtimeMs: Date.parse(result.entry.modifiedAt) || 0 };
        }
        const begin = await this.call({ kind: 'write-begin', path: this.path(rel), expectedVersion, size: bytes.length });
        if (begin.kind !== 'write-begin')
            throw new Error('Managed filesystem returned an invalid write handle');
        try {
            for (let offset = 0; offset < bytes.length; offset += begin.chunkSize) {
                await this.call({ kind: 'write-chunk', path: this.path(rel), uploadId: begin.uploadId, offset, base64: Buffer.from(bytes.subarray(offset, Math.min(bytes.length, offset + begin.chunkSize))).toString('base64') });
            }
            const done = await this.call({ kind: 'write-commit', path: this.path(rel), uploadId: begin.uploadId });
            if (done.kind !== 'write-commit')
                throw new Error('Managed filesystem returned an invalid committed write');
            return { ...done.entry, mtimeMs: Date.parse(done.entry.modifiedAt) || 0 };
        }
        catch (error) {
            try {
                await this.call({ kind: 'write-abort', path: this.path(rel), uploadId: begin.uploadId });
            }
            catch { /* Preserve the original write failure; the guest lease still expires safely. */ }
            throw error;
        }
    }
    async mkdir(rel) { await this.call({ kind: 'mkdir', path: this.path(rel) }); }
    async rename(rel, destination, expectedVersion) { await this.call({ kind: 'rename', path: this.path(rel), destination: this.path(destination), expectedVersion }); }
    async remove(rel, expectedVersion) {
        const result = await this.call({ kind: 'remove', path: this.path(rel), expectedVersion });
        return result.kind === 'remove' && result.removed;
    }
    async git(args) {
        const prepared = await this.sandbox.prepareExecution({ command: { type: 'argv', file: '/usr/bin/git', args: [...args] }, cwd: this.path(''), leaseKind: 'files', projectRef: this.project }, { accountUserId: this.accountUserId, roots: [this.rootInfo.root] });
        try {
            const launch = prepared.launch;
            const result = launch.type === 'argv'
                ? await execFileP(launch.file, launch.args, { cwd: prepared.cwd, env: launch.env, maxBuffer: 64 * 1024 * 1024 })
                : await execFileP('/bin/sh', ['-c', launch.command], { cwd: prepared.cwd, env: launch.env, maxBuffer: 64 * 1024 * 1024 });
            return { stdout: String(result.stdout), stderr: String(result.stderr), code: 0 };
        }
        catch (error) {
            const value = error;
            return { stdout: String(value.stdout ?? ''), stderr: String(value.stderr ?? ''), code: typeof value.code === 'number' ? value.code : 1 };
        }
        finally {
            await prepared.lease.release();
        }
    }
}
