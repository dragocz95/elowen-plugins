// @vitest-environment node
/** The managed LSP journey against a REAL language server in a REAL rootless container.
 *
 *  Every other LSP suite drives a stand-in transport, which proves the manager's logic but not that a
 *  language server can actually be installed into a guest, found on its PATH, launched through the
 *  environment provider's argv lease, and made to answer publishDiagnostics across the podman exec
 *  boundary. That boundary is where the interesting failures live: the guest shell used to swallow the
 *  first protocol frames, and a transient unit used to suffocate below the environment's pid budget.
 *
 *  Opt-in, like the daemon's own runtime acceptance, and confined to an exclusively created private
 *  Podman store. It never constructs a default-store client, not even for cleanup.
 */
import { it, expect } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { PodmanClient, SpawnExecutor, isolatedPodmanOptions } from 'elowen/plugins/sandbox/lib/podman.mjs';
import { createEnvironmentRuntime } from 'elowen/plugins/sandbox/lib/environmentRuntime.mjs';
import { initSandboxDb } from 'elowen/plugins/sandbox/lib/db.mjs';
import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { GUEST_FILE_CHUNK_BYTES } from 'elowen/dist/plugins/environmentTypes.js';
import { ManagedLspManager } from '../plugins/lsp/src/managed.js';
import { LspClient } from '../plugins/lsp/src/client.js';

const PROJECT_ID = 7;
const ACTOR = 1;

it.runIf(process.env.ELOWEN_TEST_PODMAN === '1')('installs, runs and shuts down a real language server inside a managed guest', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'lsp-'));
  const isolation = isolatedPodmanOptions(join(scratch, 'podman'), `lsp-${randomBytes(6).toString('hex')}`, { useUserSessionBus: true });
  const paths = isolation.isolation;
  const client = new PodmanClient(isolation);
  const sql = openDb(':memory:');
  let engineVerified = false;
  let stage = 'engine';
  try {
    const info = await client.info();
    assert.equal(info.graphRoot, paths.storage);
    assert.equal(info.runRoot, paths.runroot);
    engineVerified = true;

    const db = makePluginDb(sql, 'sandbox', { canMigrate: true });
    const project: any = { id: PROJECT_ID, executionKind: 'managed', lifecycle: 'active' };
    const projectRef = { kind: 'managed' as const, projectId: PROJECT_ID };
    const logged: string[] = [];
    const ctx: any = {
      db: () => db,
      currentAccountUserId: () => ACTOR,
      currentAccess: () => ({ readOnly: false, projectRef }),
      config: {},
      logger: { info: () => {}, warn: (message: string) => logged.push(message), error: (message: string) => logged.push(message) },
      host: { stores: () => ({
        usersRead: { list: () => [{ id: ACTOR }], mayUsePlugin: () => true, isAdmin: () => true },
        userProjects: { canAccess: () => project.lifecycle === 'active', canManage: () => true },
        projects: { get: () => project, beginDeletion: () => true, finishDeletion: () => true },
      }) },
    };
    initSandboxDb(ctx);
    const runtime = createEnvironmentRuntime({ ctx, db, dataDir: join(scratch, 'sandbox'), namespace: paths.namespace, podman: client, daemon: true });
    // The same surface the Sandbox plugin registers: the environment control plus the managed branch of
    // its prepareExecution, which forwards the selected project and acting account to the runtime.
    const sandboxControl = {
      ...runtime.control,
      prepareExecution: (input: any, options?: { accountUserId?: number }) =>
        runtime.prepareExecution({ ...input, projectRef: input.projectRef ?? projectRef }, options?.accountUserId ?? ACTOR),
    };
    ctx.control = (name: string) => (name === 'sandbox' ? sandboxControl : null);

    stage = 'environment start';
    const started = await runtime.requestEnvironment({ project: projectRef, accountUserId: ACTOR, action: { kind: 'start' } });
    await runtime.reconcile();
    const startOp = await runtime.environmentOperation({ accountUserId: ACTOR, operationId: started.id });
    assert.equal(startOp?.status, 'succeeded', startOp?.error ?? 'Environment did not start');

    const manager = new ManagedLspManager(ctx, projectRef, ACTOR);
    try {
      stage = 'guest server inventory before install';
      const before = await manager.statusAsync();
      expect(before.servers.find((server) => server.command === 'typescript-language-server')?.installed).toBe(false);

      // expectedVersion null means "must not exist", so an overwrite has to carry the version it saw.
      const write = async (text: string, expectedVersion: string | null = null) => {
        const result = await runtime.control.projectFiles({
          project: projectRef, accountUserId: ACTOR,
          operation: { kind: 'write', path: '/workspace/probe.ts', base64: Buffer.from(text).toString('base64'), expectedVersion },
        });
        assert.equal(result.kind, 'write');
        return result.version as string;
      };
      const currentVersion = async () => {
        const seen = await runtime.control.projectFiles({
          project: projectRef, accountUserId: ACTOR,
          operation: { kind: 'read', path: '/workspace/probe.ts', maxBytes: GUEST_FILE_CHUNK_BYTES },
        });
        return seen.version as string;
      };

      stage = 'seed the guest workspace';
      await write('export const total: number = "not a number";\n');
      // A tsconfig is what makes the guest workspace a real TypeScript project rather than a loose file.
      await runtime.control.projectFiles({
        project: projectRef, accountUserId: ACTOR,
        operation: { kind: 'write', path: '/workspace/tsconfig.json', expectedVersion: null,
          base64: Buffer.from(JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' } })).toString('base64') },
      });

      stage = 'a check before the install reports the server missing, not broken';
      // The guest has a file to check but no server to check it with. Launching one regardless leaves
      // `/usr/bin/env` exiting 127 before the handshake, which reads as a crashed server: three of those
      // exhaust the restart budget and withdraw diagnostics for the whole runtime generation. Four
      // consecutive checks prove neither the misreport nor the permanent withdrawal happens.
      for (let attempt = 0; attempt < 4; attempt++) {
        const missing = await manager.checkFile('/workspace/probe.ts');
        expect(missing.skipped).toBe('no-server-installed');
        expect(missing.server).toBe('TypeScript');
      }

      stage = 'guest language-server install';
      await manager.changePackages('typescript-language-server', false);
      const after = await manager.statusAsync();
      expect(after.servers.find((server) => server.command === 'typescript-language-server')?.installed).toBe(true);

      stage = 'raw initialize handshake through the provider lease';
      {
        const prepared: any = await sandboxControl.prepareExecution({
          projectRef, command: { type: 'argv', file: 'typescript-language-server', args: ['--stdio'] }, cwd: '/workspace', leaseKind: 'lsp',
        });
        // The transport heartbeats the lease every 5s and tears the server down if it ever rejects, so a
        // heartbeat that cannot renew looks exactly like a crashed language server.
        await prepared.lease.heartbeat();
        const { spawn } = await import('node:child_process');
        const child = spawn(prepared.launch.file, prepared.launch.args, { cwd: prepared.cwd, env: prepared.launch.env, stdio: ['pipe', 'pipe', 'pipe'] });
        const stderr: Buffer[] = [];
        let stdout = '';
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        // The capability set the real client sends. An empty one is not a smaller version of this: the
        // server then has no reason to publish diagnostics at all, and the handshake looks healthy while
        // no verdict ever arrives.
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
          // null, as the managed client sends: a host pid is not a process the guest server can watch.
          processId: null, rootUri: 'file:///workspace',
          capabilities: { textDocument: { publishDiagnostics: { relatedInformation: false }, synchronization: { didSave: true } } },
          workspaceFolders: [{ uri: 'file:///workspace', name: 'root' }],
        } });
        // Written immediately, as the real transport does: the guest launch must not lose the frames
        // that arrive before the server has attached its own stdin.
        child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
        const send = (message: unknown) => {
          const payload = JSON.stringify(message);
          child.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
        };
        const outcome = await new Promise<string>((resolve) => {
          const timer = setTimeout(() => resolve('timeout'), 60_000);
          child.on('close', (code) => { clearTimeout(timer); resolve(`closed:${code}`); });
          let opened = false;
          const poll = setInterval(() => {
            if (!opened && /"id"\s*:\s*1\b/.test(stdout) && stdout.includes('"result"')) {
              opened = true;
              send({ jsonrpc: '2.0', method: 'initialized', params: {} });
              send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: {
                uri: 'file:///workspace/probe.ts', languageId: 'typescript', version: 1,
                text: 'export const total: number = "not a number";\n' } } });
            }
            // tsserver publishes a syntactic pass first, with an empty array, and the semantic verdict
            // a moment later. Settling on the first publish would assert an all-clear it never meant.
            if (/not assignable/i.test(stdout)) { clearTimeout(timer); clearInterval(poll); resolve('diagnosed'); }
          }, 100);
          poll.unref();
        });
        child.kill('SIGKILL');
        await prepared.lease.cancel?.();
        await prepared.lease.release();
        assert.equal(outcome, 'diagnosed',
          `no publishDiagnostics (${outcome}); stdout(${stdout.length}B)=${JSON.stringify(stdout.slice(-900))}; guest stderr: ${Buffer.concat(stderr).toString().slice(0, 900)}`);
        // A real server verdict over the provider lease, not merely bytes on the pipe.
        expect(stdout).toContain('capabilities');
        expect(stdout).toMatch(/not assignable/i);
        // The pin, proven where it matters: the guest drives a TypeScript that still ships tsserver.
        expect(stdout).toMatch(/"version":"5\./);
      }

      stage = 'diagnostic on a genuinely broken file';
      // checkFile degrades a read failure to skipped:'unreadable', so prove the manager's own read path
      // works before relying on its verdict; otherwise a transport fault reads as a clean check.
      const readBack = await runtime.control.projectFiles({
        project: projectRef, accountUserId: ACTOR, expectedGeneration: (manager as any).generation,
        operation: { kind: 'read', path: '/workspace/probe.ts', maxBytes: GUEST_FILE_CHUNK_BYTES },
      });
      expect(Buffer.from(readBack.base64, 'base64').toString()).toContain('not a number');
      // checkFile turns any client exception into skipped:'server-error'. Drive the same product path
      // once with the error left to propagate, so a real fault is named instead of categorised away.
      {
        const source = 'export const total: number = "not a number";\n';
        const readied: any = await (manager as any).prepare('typescript-language-server', ['--stdio'], '/workspace');
        const transport = (manager as any).transport(readied);
        // The watchdog pid comes from the manager, never from this file: a client built with the default
        // would carry the host pid into the guest and the server would exit before answering.
        const client = new LspClient(transport, '/workspace', undefined, (manager as any).watchdogProcessId());
        try {
          const verdict = await client.diagnose('/workspace/probe.ts', source, 'typescript', 30_000, 1_500);
          expect(verdict.published).toBe(true);
          expect(verdict.diagnostics.length).toBeGreaterThan(0);
        } finally { transport.dispose(); }
      }

      const broken = await manager.checkFile('/workspace/probe.ts');
      expect(broken.skipped).toBeUndefined();
      expect(broken.server).toBe('TypeScript');
      // A real tsserver verdict, not merely "some diagnostics": the assignment is the reported problem.
      expect(broken.diagnostics.length).toBeGreaterThan(0);
      expect(broken.diagnostics.some((entry) => /not assignable/i.test(entry.message))).toBe(true);

      stage = 'diagnostic clears once the error is fixed';
      await write('export const total: number = 41 + 1;\n', await currentVersion());
      const fixed = await manager.checkFile('/workspace/probe.ts');
      expect(fixed.skipped).toBeUndefined();
      expect(fixed.diagnostics).toEqual([]);
    } finally {
      // Not a stage assignment: shutting down must not relabel the stage a failure above was reported at.
      await manager.shutdown();
    }
    stage = 'lease release after shutdown';
    // Shutdown must release every guest execution lease it took, not just close the host pipe. An
    // unreleased lease keeps the environment busy, so the delete below is what would notice a leak.
    expect(logged.filter((message) => message.includes('cleanup failed'))).toEqual([]);

    stage = 'environment teardown';
    const deleted = await runtime.requestEnvironment({ project: projectRef, accountUserId: ACTOR, action: { kind: 'delete' } });
    await runtime.reconcile();
    const deleteOp = await runtime.environmentOperation({ accountUserId: ACTOR, operationId: deleted.id });
    assert.equal(deleteOp?.status, 'succeeded', deleteOp?.error ?? 'Environment delete did not complete');
    await runtime.dispose();
  } catch (error) {
    console.error(`Managed guest LSP stage failed: ${stage}`);
    throw error;
  } finally {
    sql.close();
    if (engineVerified) {
      const reset = await new SpawnExecutor().run('/usr/bin/podman',
        ['--root', paths.storage, '--runroot', paths.runroot, '--tmpdir', paths.tmp, '--storage-driver', 'vfs', 'system', 'reset', '--force'],
        { env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: paths.home, XDG_RUNTIME_DIR: paths.runtime, TMPDIR: paths.tmp,
          ...(paths.userBus ? { DBUS_SESSION_BUS_ADDRESS: `unix:path=${paths.userBus.path}` } : {}) },
        timeoutMs: 180_000, outputLimitBytes: 1024 * 1024 });
      if (reset.code !== 0) throw new Error(`Private Podman cleanup failed; retained ${scratch}: ${reset.stderr}`);
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}, 900_000);
