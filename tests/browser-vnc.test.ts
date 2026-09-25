// @vitest-environment node
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import type { PluginDb } from 'elowen/plugin-api';
import { resolveConfig } from '../plugins/browser/src/config.js';
import { RfbInputFilter } from '../plugins/browser/src/rfb-filter.js';
import {
  VncTransport, VNC_CLOSE, VNC_ROUTE_PATH, webSocketSupport,
  type PluginWebSocketConnection, type UpstreamSocket, type VncTarget,
} from '../plugins/browser/src/vnc-transport.js';
import { VirtualDisplayPool, detectExecutable } from '../plugins/browser/src/virtual-display.js';
import { BrowserStore } from '../plugins/browser/src/store.js';
import { PuppeteerCoreFactory } from '../plugins/browser/src/browser-launcher.js';
import { containsColour, KEYSYM, RfbClient } from './support/rfb-client.js';
import type { BrowserLogger, ProcessInspector } from '../plugins/browser/src/types.js';

const logger: BrowserLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const roots: string[] = [];
const root = (): string => {
  const path = mkdtempSync(`${tmpdir()}/browser-vnc-`);
  roots.push(path);
  return path;
};
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function pluginDb(): PluginDb {
  const raw = new Database(':memory:');
  raw.exec('CREATE TABLE plugin_migrations(version INTEGER PRIMARY KEY)');
  const handle = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => {
      const statement = raw.prepare(sql);
      return {
        run: (...params: unknown[]) => statement.run(...params),
        get: (...params: unknown[]) => statement.get(...params),
        all: (...params: unknown[]) => statement.all(...params),
      };
    },
    migrate: (steps: { version: number; up(db: PluginDb): void }[]) => {
      for (const step of steps) if (!raw.prepare('SELECT 1 FROM plugin_migrations WHERE version=?').get(step.version)) {
        raw.transaction(() => { step.up(handle as PluginDb); raw.prepare('INSERT INTO plugin_migrations(version) VALUES (?)').run(step.version); })();
      }
    },
    appliedVersion: () => 0,
    transaction: <T>(fn: () => T) => raw.transaction(fn)(),
  };
  return handle as PluginDb;
}

/** A connection shaped exactly like the one the daemon hands a handler, so the transport can be driven
 *  without a daemon, a socket or an X server. */
class FakeConnection implements PluginWebSocketConnection {
  readonly sent: Buffer[] = [];
  readonly closes: { code?: number; reason?: string }[] = [];
  private inbound: ((data: string | Uint8Array, isBinary: boolean) => void) | null = null;
  private closeCb: ((code: number, reason: string) => void) | null = null;
  private readonly controller = new AbortController();
  queued = 0;
  readonly params: Record<string, string> = {};
  readonly query: Record<string, string> = {};

  constructor(
    readonly auth: PluginWebSocketConnection['auth'],
    readonly payload: unknown,
  ) {}

  get signal(): AbortSignal { return this.controller.signal; }
  send(data: string | Uint8Array): void { this.sent.push(Buffer.from(data as Uint8Array)); }
  onMessage(cb: (data: string | Uint8Array, isBinary: boolean) => void): void { this.inbound = cb; }
  onClose(cb: (code: number, reason: string) => void): void { this.closeCb = cb; }
  close(code?: number, reason?: string): void { this.closes.push({ code, reason }); }
  bufferedAmount(): number { return this.queued; }

  /** Whether the handler registered its inbound callback. The daemon leaves the socket PAUSED until it
   *  does, so this is the difference between a client's opening bytes flowing and sitting in a buffer. */
  get listening(): boolean { return this.inbound !== null; }
  deliver(bytes: Buffer): void { this.inbound?.(bytes, true); }
  hangUp(): void { this.closeCb?.(1000, 'gone'); }
  abort(): void { this.controller.abort(); }
}

class FakeUpstream implements UpstreamSocket {
  readonly written: Buffer[] = [];
  destroyed = false;
  paused = false;
  private handlers = new Map<string, (chunk?: Buffer) => void>();
  on(event: string, listener: (chunk?: never) => void): void { this.handlers.set(event, listener as (chunk?: Buffer) => void); }
  write(chunk: Buffer): void { this.written.push(chunk); }
  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }
  destroy(): void { this.destroyed = true; }
  emit(event: 'data', chunk: Buffer): void;
  emit(event: 'error' | 'close'): void;
  emit(event: string, chunk?: Buffer): void { this.handlers.get(event)?.(chunk); }
  get forwarded(): Buffer { return Buffer.concat(this.written); }
}

/** The client half of an RFB 3.8 handshake with no authentication: version, security type, ClientInit. */
const HANDSHAKE = Buffer.concat([Buffer.from('RFB 003.008\n', 'ascii'), Buffer.from([1]), Buffer.from([1])]);
const KEY_EVENT = (key: number): Buffer => Buffer.from([4, 1, 0, 0, 0, 0, 0, key]);
const POINTER_EVENT = Buffer.from([5, 1, 0, 10, 0, 20]);
const FRAMEBUFFER_UPDATE_REQUEST = Buffer.from([3, 1, 0, 0, 0, 0, 5, 0, 3, 32]);
const SET_ENCODINGS = Buffer.from([2, 0, 0, 1, 0, 0, 0, 0]);

const authOf = (userId: number | null): PluginWebSocketConnection['auth'] =>
  ({ userId, admin: false, tokenScope: 'user', accessibleProjects: null });

describe('browser live view configuration', () => {
  it('defaults the one knob it kept to the low-latency setting', () => {
    // The decision was latency, not bandwidth: 10 ms reaches 88 ms click-to-pixel.
    expect(resolveConfig({}).vncDeferMs).toBe(10);
    expect(resolveConfig({ vncDeferMs: 100_000 }).vncDeferMs).toBe(400);
    expect(resolveConfig({ vncDeferMs: 1 }).vncDeferMs).toBe(5);
  });

  it('has retired every setting the screencast owned', () => {
    const config = resolveConfig({ webFps: 12, jpegQuality: 90, globalStreamMegabits: 40, maxInputEventsPerSecond: 200, vncEnabled: true });
    expect(config).not.toHaveProperty('webFps');
    expect(config).not.toHaveProperty('jpegQuality');
    expect(config).not.toHaveProperty('globalStreamBytesPerSecond');
    expect(config).not.toHaveProperty('maxInputEventsPerSecond');
    // There is no flag any more: the virtual display is the only way a session runs.
    expect(config).not.toHaveProperty('vncEnabled');
  });
});

describe('browser live view core contract', () => {
  it('detects a daemon that cannot carry a socket instead of throwing at registration', () => {
    expect(webSocketSupport({ logger } as never)).toBeNull();
    expect(webSocketSupport({ registerWebSocketRoute: () => {} } as never)).toBeNull();
    const capable = { registerWebSocketRoute: () => {}, issueWebSocketTicket: () => ({ ticket: 't', expiresAt: 0 }) };
    expect(webSocketSupport(capable as never)).toBe(capable);
  });

  it('registers one user-access route and mints a ticket bound to the calling account', () => {
    const routes: { path: string; access: string }[] = [];
    const minted: unknown[] = [];
    const core = {
      registerWebSocketRoute: (route: { path: string; access: string }) => routes.push(route),
      issueWebSocketTicket: (input: unknown) => { minted.push(input); return { ticket: 'tkt-1', expiresAt: 42 }; },
    };
    const transport = new VncTransport({ config: () => resolveConfig({}), logger, resolve: () => null });
    transport.register(core);
    // One segment, matched by exact count, and declared in the manifest — see the contract test.
    expect(routes).toEqual([{ path: VNC_ROUTE_PATH, access: 'user', handler: expect.any(Function) }]);

    const issued = transport.issueTicket(core, 7, { sessionId: 'session-1' });
    // The ticket binds to the id the authenticated route resolved. Minting for anyone else would hand
    // out that account's access, because nothing downstream re-checks who asked.
    expect(minted).toEqual([{ userId: 7, payload: { sessionId: 'session-1' }, ttlMs: 15_000 }]);
    expect(issued.url).toBe('/ws/plugins/browser/vnc?ticket=tkt-1');
  });
});

describe('browser live view transport', () => {
  const transportWith = (target: VncTarget | null, patch: Record<string, unknown> = {}) => {
    const upstream = new FakeUpstream();
    const transport = new VncTransport({
      config: () => resolveConfig(patch),
      logger,
      resolve: () => target,
      dial: () => upstream,
    });
    return { transport, upstream };
  };
  const target: VncTarget = { socketPath: '/tmp/vnc.sock' };

  it('starts listening before anything else, because the socket is paused until it does', () => {
    const { transport } = transportWith(target);
    const conn = new FakeConnection(authOf(1), { sessionId: 'session-1' });
    transport.handle(conn);
    // Registered synchronously by the time the handler returns. An await placed before it would leave
    // noVNC's opening handshake sitting in the daemon's buffer.
    expect(conn.listening).toBe(true);
    expect(conn.closes).toEqual([]);
  });

  it('refuses a ticket whose payload is not one of ours, and a session that has gone', () => {
    const bad = transportWith(target);
    const wrongShape = new FakeConnection(authOf(1), { nothing: true });
    bad.transport.handle(wrongShape);
    expect(wrongShape.closes).toEqual([{ code: VNC_CLOSE.protocol, reason: 'invalid_ticket' }]);

    const gone = transportWith(null);
    const closed = new FakeConnection(authOf(1), { sessionId: 'session-1' });
    gone.transport.handle(closed);
    expect(closed.closes).toEqual([{ code: VNC_CLOSE.unavailable, reason: 'session_unavailable' }]);
    // Nothing was dialled for a session that is not there.
    expect(gone.upstream.written).toEqual([]);
  });

  it('carries the framebuffer out and the owner\'s input in, lease or no lease', () => {
    const { transport, upstream } = transportWith(target);
    // No takeover lease anywhere in the ticket. Production regression: the lease used to be sealed into
    // the ticket at mint time, so a connection opened BEFORE "Take control" stayed view-only for as long
    // as it lived — the owner's clicks vanished until the socket happened to reconnect.
    const conn = new FakeConnection(authOf(1), { sessionId: 'session-1' });
    transport.handle(conn);
    conn.deliver(Buffer.concat([HANDSHAKE, SET_ENCODINGS, POINTER_EVENT, FRAMEBUFFER_UPDATE_REQUEST, KEY_EVENT(97)]));
    // Byte for byte: the filter frames the stream, it does not rewrite it, and it drops nothing of the
    // owner's.
    expect(upstream.forwarded).toEqual(Buffer.concat([HANDSHAKE, SET_ENCODINGS, POINTER_EVENT, FRAMEBUFFER_UPDATE_REQUEST, KEY_EVENT(97)]));
    expect(conn.closes).toEqual([]);
    upstream.emit('data', Buffer.from([0, 0, 0, 1]));
    expect(conn.sent).toEqual([Buffer.from([0, 0, 0, 1])]);
  });

  it('refuses one viewer past the limit and lets the next in when someone leaves', () => {
    const { transport } = transportWith(target, { maxViewersPerSession: 2 });
    const first = new FakeConnection(authOf(1), { sessionId: 'session-1' });
    const second = new FakeConnection(authOf(1), { sessionId: 'session-1' });
    const third = new FakeConnection(authOf(1), { sessionId: 'session-1' });
    transport.handle(first);
    transport.handle(second);
    transport.handle(third);
    expect(transport.viewerCount('session-1')).toBe(2);
    expect(third.closes).toEqual([{ code: VNC_CLOSE.viewerLimit, reason: 'viewer_limit' }]);
    // A full room empties: the seat the departing viewer held is genuinely given back.
    second.hangUp();
    expect(transport.viewerCount('session-1')).toBe(1);
    const fourth = new FakeConnection(authOf(1), { sessionId: 'session-1' });
    transport.handle(fourth);
    expect(fourth.closes).toEqual([]);
    expect(transport.viewerCount('session-1')).toBe(2);
  });

  it('drops every view of a session that ended, and tears down the socket with it', () => {
    const { transport, upstream } = transportWith(target);
    const conn = new FakeConnection(authOf(1), { sessionId: 'session-1' });
    transport.handle(conn);
    transport.closeSession('session-1', 'display_lost');
    expect(conn.closes).toEqual([{ code: VNC_CLOSE.sessionClosed, reason: 'display_lost' }]);
    // The upstream goes too: a connection to a framebuffer nobody owns is a leak, not a view.
    expect(upstream.destroyed).toBe(true);
    expect(transport.viewerCount('session-1')).toBe(0);
  });

  it('stops reading from the VNC server while a slow viewer is behind', () => {
    vi.useFakeTimers();
    try {
      const { transport, upstream } = transportWith(target);
      const conn = new FakeConnection(authOf(1), { sessionId: 'session-1' });
      transport.handle(conn);
      conn.queued = 8 * 1024 * 1024;
      upstream.emit('data', Buffer.from([1]));
      // Otherwise the difference between what the server produces and what the phone can take is
      // accumulated in the daemon's heap, per viewer.
      expect(upstream.paused).toBe(true);
      vi.advanceTimersByTime(200);
      expect(upstream.paused).toBe(true);
      conn.queued = 0;
      vi.advanceTimersByTime(200);
      expect(upstream.paused).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets go when the daemon aborts the connection', () => {
    const { transport, upstream } = transportWith(target);
    const conn = new FakeConnection(authOf(1), { sessionId: 'session-1' });
    transport.handle(conn);
    // A plugin reload or a daemon shutdown: the one signal a frame producer gets.
    conn.abort();
    expect(upstream.destroyed).toBe(true);
    expect(transport.viewerCount('session-1')).toBe(0);
  });
});

describe('browser live view input filter', () => {
  const framed = (filter: RfbInputFilter, chunk: Buffer, allowInput: boolean) => filter.push(chunk, allowInput);

  it('measures each message instead of sniffing the first byte of a chunk', () => {
    // The regression this exists for: "does this chunk begin with an input opcode" passes a PointerEvent
    // that a client concatenated after a SetEncodings, which is the whole boundary defeated in one line.
    const filter = new RfbInputFilter();
    framed(filter, HANDSHAKE, false);
    const result = framed(filter, Buffer.concat([SET_ENCODINGS, POINTER_EVENT]), false);
    expect(result.forward).toEqual(SET_ENCODINGS);
    expect(result.dropped).toBe(1);
  });

  it('reassembles a message split across frames', () => {
    const filter = new RfbInputFilter();
    framed(filter, HANDSHAKE, false);
    const half = FRAMEBUFFER_UPDATE_REQUEST.subarray(0, 4);
    expect(framed(filter, half, false).forward).toHaveLength(0);
    expect(framed(filter, FRAMEBUFFER_UPDATE_REQUEST.subarray(4), false).forward).toEqual(FRAMEBUFFER_UPDATE_REQUEST);
  });

  it('drops a clipboard paste, which is input by another name', () => {
    const filter = new RfbInputFilter();
    framed(filter, HANDSHAKE, false);
    const cutText = Buffer.concat([Buffer.from([6, 0, 0, 0, 0, 0, 0, 2]), Buffer.from('hi', 'ascii')]);
    const result = framed(filter, cutText, false);
    expect(result.forward).toHaveLength(0);
    expect(result.dropped).toBe(1);
  });

  it('frames the Extended Clipboard caps every noVNC opens with, and gates the rest of that extension', () => {
    // Production regression: x11vnc offers Extended Clipboard, noVNC answers with a caps message whose
    // length field is NEGATIVE (-(4 + 6*4) = -28). Read as unsigned that is a 4 GB "paste", the filter
    // closed the connection, the card reconnected every second — and the live view never appeared.
    const extended = (flags: number, body: Buffer): Buffer => {
      const header = Buffer.alloc(8);
      header[0] = 6;
      header.writeInt32BE(-(4 + body.length), 4);
      const flagBytes = Buffer.alloc(4);
      flagBytes.writeUInt32BE(flags, 0);
      return Buffer.concat([header, flagBytes, body]);
    };
    const caps = extended(0x01000000 | 0x1f, Buffer.alloc(6 * 4));
    const filter = new RfbInputFilter();
    framed(filter, HANDSHAKE, false);
    const negotiated = framed(filter, Buffer.concat([caps, FRAMEBUFFER_UPDATE_REQUEST]), false);
    expect(negotiated.close).toBeNull();
    expect(negotiated.forward).toEqual(Buffer.concat([caps, FRAMEBUFFER_UPDATE_REQUEST]));
    expect(negotiated.dropped).toBe(0);
    // A "provide" pushes text at the page; without the lease it is dropped like a plain paste.
    const provide = extended(0x10000000 | 0x1, Buffer.from([0x78, 0x9c, 1, 2, 3]));
    const pushed = framed(filter, provide, false);
    expect(pushed.forward).toHaveLength(0);
    expect(pushed.dropped).toBe(1);
    expect(framed(filter, provide, true).forward).toEqual(provide);
  });

  it('closes rather than guessing when it can no longer frame the stream', () => {
    const filter = new RfbInputFilter();
    framed(filter, HANDSHAKE, false);
    // An opcode with no known length means every byte after it is unclassifiable, and forwarding blind
    // would forward input with it. Failing closed is the only safe answer.
    const result = framed(filter, Buffer.from([200, 0, 0, 0]), false);
    expect(result.close).toMatch(/cannot frame/);
    expect(result.forward).toHaveLength(0);
  });

  it('refuses a handshake that is not RFB, and a security type it cannot follow', () => {
    expect(new RfbInputFilter().push(Buffer.from('GET / HTTP/1.1\n', 'ascii'), false).close).toMatch(/version string/);
    const wrongSecurity = new RfbInputFilter();
    wrongSecurity.push(Buffer.from('RFB 003.008\n', 'ascii'), false);
    // Anything but None is followed by auth bytes of a length this cannot predict.
    expect(wrongSecurity.push(Buffer.from([2]), false).close).toMatch(/security type/);
  });

  it('lets a driver through untouched, having framed the same stream', () => {
    const filter = new RfbInputFilter();
    const result = framed(filter, Buffer.concat([HANDSHAKE, POINTER_EVENT, KEY_EVENT(97)]), true);
    expect(result.forward).toEqual(Buffer.concat([HANDSHAKE, POINTER_EVENT, KEY_EVENT(97)]));
    expect(result.dropped).toBe(0);
  });
});

describe('browser virtual display bookkeeping', () => {
  let store: BrowserStore;
  beforeEach(() => { store = new BrowserStore(pluginDb()); });

  const inspector = (live: Map<number, { startedAtTicks: string; executablePath: string; args: string[] }>, killed: number[]): ProcessInspector => ({
    inspect: (pid) => {
      const found = live.get(pid);
      return found ? { pid, ...found } : null;
    },
    terminate: (pid) => { killed.push(pid); },
  });

  it('finds Xvfb and x11vnc on PATH without running anything', () => {
    // The readiness panel calls this, and opening a status page must not spawn processes.
    expect(detectExecutable('Xvfb')).toMatch(/Xvfb$/);
    expect(detectExecutable('definitely-not-a-real-binary-xyz')).toBeNull();
  });

  it('kills an orphaned display pair after a hard restart, and forgets it', () => {
    store.saveDisplay({
      userId: 1, displayNumber: 97, xvfbPid: 4001, xvfbStartedAtTicks: '111', xvfbExecutablePath: '/usr/bin/Xvfb',
      vncPid: 4002, vncStartedAtTicks: '222', vncExecutablePath: '/usr/bin/x11vnc',
      socketPath: '/tmp/vnc-1.sock', rootPath: root(), createdAt: Date.now(),
    });
    const killed: number[] = [];
    const live = new Map([
      [4001, { startedAtTicks: '111', executablePath: '/usr/bin/Xvfb', args: ['Xvfb', ':97', '-screen'] }],
      [4002, { startedAtTicks: '222', executablePath: '/usr/bin/x11vnc', args: ['x11vnc', '-unixsock', '/tmp/vnc-1.sock'] }],
    ]);
    const pool = new VirtualDisplayPool({ dataDir: root(), config: () => resolveConfig({}), store, processInspector: inspector(live, killed), logger });
    pool.reconcileOrphans();
    expect(killed.sort()).toEqual([4001, 4002]);
    // Forgotten too, or the next boot would try to kill the same numbers again.
    expect(store.displays()).toEqual([]);
  });

  it('refuses to kill a PID the kernel handed to somebody else', () => {
    const rootPath = root();
    store.saveDisplay({
      userId: 1, displayNumber: 97, xvfbPid: 4001, xvfbStartedAtTicks: '111', xvfbExecutablePath: '/usr/bin/Xvfb',
      vncPid: 4002, vncStartedAtTicks: '222', vncExecutablePath: '/usr/bin/x11vnc',
      socketPath: '/tmp/vnc-1.sock', rootPath, createdAt: Date.now(),
    });
    const killed: number[] = [];
    // Same numbers, different processes: a PID is reused, which is exactly why the record carries a
    // start time and an executable as well.
    const live = new Map([
      [4001, { startedAtTicks: '999', executablePath: '/usr/bin/Xvfb', args: ['Xvfb', ':97'] }],
      [4002, { startedAtTicks: '222', executablePath: '/usr/bin/postgres', args: ['postgres'] }],
    ]);
    const pool = new VirtualDisplayPool({ dataDir: root(), config: () => resolveConfig({}), store, processInspector: inspector(live, killed), logger });
    pool.reconcileOrphans();
    expect(killed).toEqual([]);
    // The record still goes: it names processes that are no longer ours to manage.
    expect(store.displays()).toEqual([]);
    // And the secrets go with it, whether or not anything was killed.
    expect(existsSync(rootPath)).toBe(false);
  });

  it('deletes a user\'s display record along with the rest of their state', () => {
    store.saveDisplay({
      userId: 5, displayNumber: 97, xvfbPid: 1, xvfbStartedAtTicks: '1', xvfbExecutablePath: '/usr/bin/Xvfb',
      vncPid: 2, vncStartedAtTicks: '2', vncExecutablePath: '/usr/bin/x11vnc',
      socketPath: '/tmp/a.sock', rootPath: '/tmp/a', createdAt: Date.now(),
    });
    store.deleteUser(5);
    expect(store.displays()).toEqual([]);
  });
});

/** The end-to-end proof, and the one thing a design document cannot stand in for: a real X server, a
 *  real headed Chrome on it, a real VNC server, and input that arrives as NATIVE input rather than as
 *  something CDP synthesised.
 *
 *  Off by default because it needs Xvfb, x11vnc and Chrome on the host and takes about half a minute:
 *
 *      ELOWEN_BROWSER_VNC_E2E=1 npx vitest run tests/browser-vnc.test.ts
 */
const e2e = process.env.ELOWEN_BROWSER_VNC_E2E === '1';
const binaryPresent = (name: string): boolean => {
  try { execFileSync('which', [name], { stdio: 'ignore' }); return true; }
  catch { return false; }
};

/** Every TCP address this PID is listening on, as the kernel reports it. Asked of the process rather
 *  than of a port number, so the answer cannot be right by accident. */
const tcpListenersOf = (pid: number): string[] => {
  const output = execFileSync('ss', ['-ltnp'], { encoding: 'utf8' });
  return output.split('\n')
    .filter((line) => line.includes(`pid=${pid},`))
    .map((line) => line.trim().split(/\s+/)[3] ?? '')
    .filter(Boolean);
};

const realInspector: ProcessInspector = {
  inspect: (pid) => {
    try {
      const stat = execFileSync('cat', [`/proc/${pid}/stat`], { encoding: 'utf8' });
      const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
      return {
        pid,
        startedAtTicks: fields[19]!,
        executablePath: execFileSync('readlink', [`/proc/${pid}/exe`], { encoding: 'utf8' }).trim(),
        args: execFileSync('cat', [`/proc/${pid}/cmdline`], { encoding: 'utf8' }).split('\0').filter(Boolean),
      };
    } catch { return null; }
  },
  terminate: (pid, signal = 'SIGTERM') => { process.kill(pid, signal); },
};

describe.skipIf(!e2e)('browser live view end to end', () => {
  const cleanup: (() => Promise<void> | void)[] = [];
  afterAll(async () => { for (const step of cleanup.reverse()) await step(); });

  const poolFor = (dataDir: string, store = new BrowserStore(pluginDb())) => new VirtualDisplayPool({
    dataDir, config: () => resolveConfig({}), store, processInspector: realInspector, logger,
  });

  it('draws a native Chrome window on a private display and carries real input back into the page', async () => {
    expect(binaryPresent('Xvfb'), 'Xvfb must be installed for this test').toBe(true);
    expect(binaryPresent('x11vnc'), 'x11vnc must be installed for this test').toBe(true);

    const store = new BrowserStore(pluginDb());
    const displays = poolFor(root(), store);
    cleanup.push(() => displays.releaseAll());

    const display = await displays.acquire(1);
    expect(display.width).toBe(1280);
    expect(display.height).toBe(800);
    expect(existsSync(display.socketPath)).toBe(true);
    // The RFB endpoint is a socket in a private directory, not a port: nothing off this host can dial
    // it, and the mode says so rather than relying on a parent nobody re-checks.
    expect(lstatSync(display.socketPath).mode & 0o777).toBe(0o600);
    expect(lstatSync(display.xauthPath).mode & 0o777).toBe(0o600);
    // The regression this guards: `-rfbport 0` on its own still left x11vnc on the IPv6 wildcard at
    // 5900, an unauthenticated VNC server reachable from the internet.
    expect(tcpListenersOf(display.vncPid)).toEqual([]);
    // Written down while it runs, so a daemon killed now can still find these two after a restart.
    expect(store.displays()).toMatchObject([{ userId: 1, displayNumber: display.displayNumber, xvfbPid: display.xvfbPid, vncPid: display.vncPid }]);

    const browser = await new PuppeteerCoreFactory().launch({
      executablePath: '/opt/google/chrome/chrome',
      userDataDir: root(),
      // No proxy in the harness: the page under test is a data: URL, so nothing is dialled.
      proxyUrl: 'http://127.0.0.1:1',
      viewport: { width: display.width, height: display.height },
      display: { display: display.display, xauthPath: display.xauthPath },
    });
    cleanup.push(() => browser.close());

    const page = await browser.newPage();
    const content = `<!doctype html><html><head><meta charset="utf-8"><title>vnc</title><style>
      html,body{margin:0;padding:0;font:16px/1.4 system-ui;background:#fff}
      #probe{position:fixed;left:40px;top:40px;width:320px;height:40px;font-size:18px}
      #target{position:fixed;left:40px;top:120px;width:240px;height:80px;background:#1a52d6;color:#fff;border:0}
      #flag{position:fixed;left:400px;top:120px;width:200px;height:80px;background:#cccccc}
      .rows{margin-top:320px}.rows div{height:48px;border-bottom:1px solid #ddd}
    </style></head><body>
    <input id="probe" autocomplete="off"><button id="target">Target</button><div id="flag"></div>
    <div class="rows">${Array.from({ length: 200 }, (_, i) => `<div>row ${i}</div>`).join('')}</div>
    <script>
      window.__clicks = 0; window.__keys = []; window.__contextMenus = 0; window.__pointer = [];
      for (const type of ['mousedown', 'mouseup', 'contextmenu']) {
        document.addEventListener(type, (e) => { window.__pointer.push(type + ':' + e.button); }, true);
      }
      document.getElementById('target').addEventListener('click', () => {
        window.__clicks += 1;
        document.getElementById('flag').style.background = '#00ff00';
      });
      document.addEventListener('keydown', (e) => { window.__keys.push((e.ctrlKey ? 'Ctrl+' : '') + e.key); });
      document.addEventListener('contextmenu', (e) => { e.preventDefault(); window.__contextMenus += 1; });
    </script></body></html>`;
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(content)}`, { waitUntil: 'load' });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // A NATIVE window: the tab strip and the address bar are there, which is the point — a person taking
    // over gets the browser, not a stripped canvas. The automation infobar is not, because that is the
    // one piece of chrome nobody asked for. Measured on this host: 143px with it, 87px without.
    const geometry = await (page as unknown as { evaluate<T>(fn: () => T): Promise<T> }).evaluate(() => ({
      innerHeight: window.innerHeight, outerHeight: window.outerHeight,
      innerWidth: window.innerWidth,
      screenX: window.screenX, screenY: window.screenY,
    }));
    expect(geometry.outerHeight - geometry.innerHeight).toBe(87);
    expect(geometry.screenX).toBe(0);
    expect(geometry.screenY).toBe(0);
    // …and therefore the page is SHORTER than the framebuffer. Anything that assumed otherwise would be
    // photographing a box the window does not have.
    expect(geometry.innerHeight).toBeLessThan(display.height);

    const rfb = await RfbClient.connect({ socketPath: display.socketPath });
    cleanup.push(() => rfb.close());
    expect(rfb.width).toBe(1280);
    expect(rfb.height).toBe(800);

    const at = async (selector: string) => (page as unknown as {
      evaluate<T>(fn: (sel: string) => T, arg: string): Promise<T>;
    }).evaluate((sel) => {
      const rect = document.querySelector(sel)!.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, selector);
    const read = <T,>(fn: () => T): Promise<T> => (page as unknown as { evaluate<R>(f: () => R): Promise<R> }).evaluate(fn);
    /** The page's coordinates are relative to the VIEWPORT; the framebuffer's start at the window's top
     *  left. The difference is the browser chrome, and forgetting it aims every click 87px too high. */
    const chromeHeight = geometry.outerHeight - geometry.innerHeight;
    const onScreen = (point: { x: number; y: number }) => ({ x: point.x, y: point.y + chromeHeight });

    // Baseline frame, so what follows is genuinely an update rather than the first paint.
    rfb.requestUpdate(false);
    await rfb.readUpdate();

    // A CLICK sent as RFB, verified twice: in the page's own DOM over CDP, and in the pixels that come
    // back. Either alone would be half the loop.
    const target = onScreen(await at('#target'));
    const startedAt = Date.now();
    await rfb.click(target.x, target.y);
    rfb.requestUpdate(true);
    let sawGreen = false;
    const deadline = startedAt + 8_000;
    while (!sawGreen && Date.now() < deadline) {
      const update = await rfb.readUpdate();
      if (containsColour(update.rects, 0x00, 0xff, 0x00)) { sawGreen = true; break; }
      rfb.requestUpdate(true);
    }
    expect(sawGreen).toBe(true);
    expect(await read(() => (window as unknown as { __clicks: number }).__clicks)).toBe(1);

    // The SECONDARY BUTTON, which is the single clearest thing this move buys: a synthesized CDP click
    // cannot produce a contextmenu event at all, and here Chrome cannot tell the press from a mouse.
    //
    // Retried rather than asserted once. The press and release are replayed through XTEST into a
    // compositor that is also busy encoding frames, and a gesture that lands while it is mid-update is
    // simply not seen — a person clicks again and thinks nothing of it. What is NOT tolerated is the
    // event never arriving.
    let secondary: { contextMenus: number; seen: string[] } | null = null;
    for (let attempt = 0; attempt < 4 && !secondary?.contextMenus; attempt += 1) {
      await rfb.click(target.x, target.y, 'right');
      await new Promise((resolve) => setTimeout(resolve, 700));
      secondary = await read(() => ({
        contextMenus: (window as unknown as { __contextMenus: number }).__contextMenus,
        seen: (window as unknown as { __pointer: string[] }).__pointer,
      }));
    }
    expect(secondary?.seen ?? []).toContain('contextmenu:2');
    expect(secondary?.contextMenus ?? 0).toBeGreaterThan(0);

    // TEXT, and the other thing CDP had to special-case: a Ctrl+A the BROWSER handles rather than one
    // the input controller had to translate into a selectAll command.
    const probe = onScreen(await at('#probe'));
    await rfb.click(probe.x, probe.y);
    await new Promise((resolve) => setTimeout(resolve, 250));
    rfb.type('Hello VNC 42');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await read(() => (document.getElementById('probe') as HTMLInputElement).value)).toBe('Hello VNC 42');

    rfb.key(KEYSYM.ControlLeft, true);
    rfb.tap('a'.codePointAt(0)!);
    rfb.key(KEYSYM.ControlLeft, false);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await read(() => {
      const el = document.getElementById('probe') as HTMLInputElement;
      return { start: el.selectionStart, end: el.selectionEnd };
    })).toEqual({ start: 0, end: 12 });

    rfb.tap(KEYSYM.Tab);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await read(() => document.activeElement?.id ?? null)).toBe('target');

    // SCROLL, as wheel buttons 4 and 5 — the gesture that has to feel native for this to be worth it.
    const before = await read(() => window.scrollY);
    for (let step = 0; step < 8; step += 1) {
      rfb.pointer(640, 500, 16);
      rfb.pointer(640, 500, 0);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(await read(() => window.scrollY)).toBeGreaterThan(before);
  }, 120_000);

  it('carries the owner\'s input through the transport to a real x11vnc, with no lease in the ticket', async () => {
    // The transport in front of a real server, with the ticket shape production mints: session only.
    // Input must pass — a connection opened before "Take control" is the common case, not the exception.
    const displays = poolFor(root());
    const display = await displays.acquire(3);
    try {
      const transport = new VncTransport({
        config: () => resolveConfig({}),
        logger,
        resolve: () => ({ socketPath: display.socketPath }),
      });
      const conn = new FakeConnection(authOf(3), { sessionId: 'session-e2e' });
      transport.handle(conn);
      // The server's RFB banner comes back, so this is a live connection to a real x11vnc.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(Buffer.concat(conn.sent).toString('ascii')).toMatch(/^RFB \d{3}\.\d{3}\n/);
      conn.deliver(Buffer.concat([HANDSHAKE, POINTER_EVENT, KEY_EVENT(97)]));
      await new Promise((resolve) => setTimeout(resolve, 500));
      // The server took the input without complaint: still connected.
      expect(conn.closes).toEqual([]);

      // What noVNC ACTUALLY sends next: x11vnc offers the Extended Clipboard extension and the client
      // answers with a caps message whose length field is negative. The first release read it unsigned,
      // closed every connection one second after it opened, and the live view never appeared. Sent
      // byte-for-byte as noVNC builds it, against the real server, and the picture must still come.
      // The extension is negotiated the way libvncserver expects: the client asks for it through the
      // ExtendedClipboard pseudo-encoding, the server enables it and announces its caps, the client
      // answers with its own. Sent out of that order the server calls the message corrupted and hangs up.
      const extendedClipboardEncoding = Buffer.from([2, 0, 0, 1, 0xc0, 0xa1, 0xe5, 0xce]);
      conn.deliver(extendedClipboardEncoding);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const serverCaps = Buffer.concat(conn.sent).subarray(12);
      // ServerCutText with a negative length: the server's half of the negotiation, proof the extension
      // is live on this x11vnc and the client's caps are what comes next in production.
      expect(serverCaps.indexOf(Buffer.from([3, 0, 0, 0, 0xff]))).toBeGreaterThanOrEqual(0);
      const caps = Buffer.alloc(8 + 4 + 5 * 4);
      caps[0] = 6;
      caps.writeInt32BE(-(4 + 5 * 4), 4);
      caps.writeUInt32BE(0x01000000 | 0x1f, 8);
      const sentBefore = conn.sent.length;
      conn.deliver(Buffer.concat([caps, FRAMEBUFFER_UPDATE_REQUEST]));
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(conn.closes).toEqual([]);
      expect(conn.sent.length).toBeGreaterThan(sentBefore);
    } finally {
      await displays.releaseAll();
    }
  }, 60_000);

  it('recycles the whole assembly when the X server dies underneath it', async () => {
    const displays = poolFor(root());
    try {
      const display = await displays.acquire(4);
      expect(displays.failure(4)).toBeNull();
      process.kill(display.xvfbPid, 'SIGKILL');
      await new Promise((resolve) => setTimeout(resolve, 800));
      // A dead framebuffer cannot be repaired in place: every window mapped onto it went with it, so the
      // pool reports the assembly as unusable and the sweep closes the sessions that were drawn on it.
      expect(displays.failure(4)).toMatch(/exited/);
      // Acquiring again builds a NEW pair rather than handing back the corpse.
      const replacement = await displays.acquire(4);
      expect(replacement.xvfbPid).not.toBe(display.xvfbPid);
      expect(existsSync(replacement.socketPath)).toBe(true);
      expect(displays.failure(4)).toBeNull();
    } finally {
      await displays.releaseAll();
    }
  }, 60_000);

  it('takes the display down with the session, leaving no X server and no secrets behind', async () => {
    const store = new BrowserStore(pluginDb());
    const displays = poolFor(root(), store);
    const display = await displays.acquire(2);
    const lock = `/tmp/.X${display.displayNumber}-lock`;
    expect(existsSync(display.socketPath)).toBe(true);
    await displays.release(2);
    expect(existsSync(display.socketPath)).toBe(false);
    expect(existsSync(display.xauthPath)).toBe(false);
    expect(existsSync(lock)).toBe(false);
    expect(displays.get(2)).toBeNull();
    // The ownership record goes with it, so the next boot has nothing to reconcile.
    expect(store.displays()).toEqual([]);
  }, 60_000);
});
