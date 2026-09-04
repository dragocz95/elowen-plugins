import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { BrowserConfig } from './config.js';
import type { BrowserLogger } from './types.js';

/** PILOT (ELOWEN_BROWSER_VNC): the X display an account's Chrome is drawn on, and the VNC server that
 *  publishes it. Nothing here runs unless `vncEnabled` is set; the default path is untouched.
 *
 *  Why a real display at all: the CDP layer this replaces can only ever SYNTHESISE input. Chrome routes
 *  a synthesized key through the renderer, so every shortcut the BROWSER owns — Ctrl+L, Ctrl+T, a real
 *  contextmenu, a native drag — never happens. An X server has no such split: x11vnc replays the event
 *  through XTEST and Chrome cannot tell it from a keyboard.
 */

export interface VncDisplayHandle {
  userId: number;
  /** The X display number, as in `:97`. */
  displayNumber: number;
  display: string;
  xauthPath: string;
  /** The RFB endpoint. A unix socket inside the 0700 plugin data directory: the VNC server opens NO
   *  TCP listener at all, so "unreachable off localhost" is a property of the socket family rather than
   *  of a bind address someone can misconfigure later. */
  socketPath: string;
  width: number;
  height: number;
  xvfbPid: number;
  vncPid: number;
}

interface ManagedDisplay extends VncDisplayHandle {
  xvfb: ChildProcess;
  vnc: ChildProcess;
  /** Set once either process exits, so a caller can tell a display that is merely idle from one whose
   *  server died underneath it. A dead display cannot be repaired in place — the framebuffer, and every
   *  window Chrome mapped onto it, went with it — so it is only ever discarded. */
  failure: string | null;
}

export class VncDisplayError extends Error {
  constructor(message: string) { super(message); this.name = 'VncDisplayError'; }
}

const waitFor = async (probe: () => boolean, timeoutMs: number, intervalMs = 50): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (probe()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return probe();
};

/** X marks a display as taken with a lock file, and the socket appears once it is serving. Checking both
 *  is what keeps two accounts off one display without a registry that a daemon restart would lose. */
const displayInUse = (displayNumber: number): boolean =>
  existsSync(`/tmp/.X${displayNumber}-lock`) || existsSync(`/tmp/.X11-unix/X${displayNumber}`);

export class VncDisplayPool {
  private readonly displays = new Map<number, ManagedDisplay>();
  private readonly starting = new Map<number, Promise<ManagedDisplay>>();
  private readonly root: string;

  constructor(private readonly deps: {
    dataDir: string;
    config: () => BrowserConfig;
    logger: BrowserLogger;
  }) {
    this.root = join(deps.dataDir, 'displays');
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    chmodSync(this.root, 0o700);
  }

  has(userId: number): boolean { return this.displays.has(userId) || this.starting.has(userId); }

  get(userId: number): VncDisplayHandle | null { return this.displays.get(userId) ?? null; }

  activeCount(): number { return this.displays.size; }

  /** Why this display is unusable, or null while it is healthy. */
  failure(userId: number): string | null { return this.displays.get(userId)?.failure ?? null; }

  async acquire(userId: number): Promise<VncDisplayHandle> {
    const existing = this.displays.get(userId);
    if (existing && !existing.failure) return existing;
    if (existing) await this.release(userId);
    const pending = this.starting.get(userId);
    if (pending) return pending;
    const start = this.start(userId);
    this.starting.set(userId, start);
    try { return await start; }
    finally { this.starting.delete(userId); }
  }

  private async start(userId: number): Promise<ManagedDisplay> {
    const config = this.deps.config();
    const width = config.maxViewportWidth;
    const height = config.viewportHeight;
    const displayNumber = this.reserveDisplayNumber();
    const userRoot = join(this.root, `u-${userId}`);
    mkdirSync(userRoot, { recursive: true, mode: 0o700 });
    chmodSync(userRoot, 0o700);
    const xauthPath = join(userRoot, 'Xauthority');
    const socketPath = join(userRoot, 'vnc.sock');
    rmSync(socketPath, { force: true });

    // An X display with no cookie is open to every process on the host that can reach its socket. One
    // account's browser must not be drivable from another's, so each display gets its own secret and
    // Chrome is the only thing handed it.
    this.writeXauthority(xauthPath, displayNumber);

    const xvfb = spawn('Xvfb', [
      `:${displayNumber}`,
      '-screen', '0', `${width}x${height}x24`,
      '-nolisten', 'tcp',
      '-auth', xauthPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'], detached: false });

    const managed: ManagedDisplay = {
      userId, displayNumber, display: `:${displayNumber}`, xauthPath, socketPath,
      width, height, xvfbPid: xvfb.pid ?? 0, vncPid: 0,
      xvfb, vnc: xvfb, failure: null,
    };

    let xvfbErrors = '';
    xvfb.stderr?.on('data', (chunk: Buffer) => { xvfbErrors = `${xvfbErrors}${chunk.toString('utf8')}`.slice(-2000); });
    xvfb.once('exit', (code, signal) => {
      managed.failure ??= `Xvfb for user ${userId} exited (${signal ?? code}).`;
      this.deps.logger.warn(`browser vnc display :${displayNumber} lost its X server: ${signal ?? code}`);
    });

    if (!await waitFor(() => existsSync(`/tmp/.X11-unix/X${displayNumber}`), 10_000)) {
      xvfb.kill('SIGKILL');
      throw new VncDisplayError(`The virtual display did not start.${xvfbErrors ? ` ${xvfbErrors.trim().split('\n').pop()}` : ''}`);
    }

    // Refusing TCP takes all three: `-rfbport 0` alone still leaves x11vnc listening on the IPv6
    // wildcard at 5900 — measured on this host — which is a world-reachable VNC server with no password.
    //
    // `-localhost` is deliberately NOT among them. It looks like the belt-and-braces option and it is
    // actively harmful here: x11vnc cannot resolve a unix-socket peer to 127.0.0.1, so it accepts the
    // connection, sends the RFB banner and then drops it mid-handshake. With no TCP listener at all
    // there is nothing left for it to restrict.
    const vnc = spawn('x11vnc', [
      '-display', `:${displayNumber}`,
      '-auth', xauthPath,
      '-unixsock', socketPath,
      '-rfbport', '0',
      '-rfbportv6', '0',
      '-noipv6',
      '-nopw',
      '-shared',
      '-forever',
      '-ncache', '0',
      '-wait', String(config.vncPollMs),
      '-defer', String(config.vncDeferMs),
      '-quiet',
    ], { stdio: ['ignore', 'ignore', 'pipe'], detached: false });

    let vncErrors = '';
    vnc.stderr?.on('data', (chunk: Buffer) => { vncErrors = `${vncErrors}${chunk.toString('utf8')}`.slice(-2000); });
    vnc.once('exit', (code, signal) => {
      managed.failure ??= `x11vnc for user ${userId} exited (${signal ?? code}).`;
      this.deps.logger.warn(`browser vnc server for display :${displayNumber} exited: ${signal ?? code}`);
    });
    managed.vnc = vnc;
    managed.vncPid = vnc.pid ?? 0;

    if (!await waitFor(() => existsSync(socketPath), 10_000)) {
      vnc.kill('SIGKILL');
      xvfb.kill('SIGKILL');
      throw new VncDisplayError(`The VNC server did not start.${vncErrors ? ` ${vncErrors.trim().split('\n').pop()}` : ''}`);
    }
    // x11vnc creates the socket world-connectable. The 0700 directory above already gates it, but the
    // socket says so itself rather than depending on a parent nobody re-checks.
    chmodSync(socketPath, 0o600);

    this.displays.set(userId, managed);
    this.deps.logger.info(`browser vnc display :${displayNumber} ready for user ${userId} (${width}x${height})`);
    return managed;
  }

  async release(userId: number): Promise<void> {
    const managed = this.displays.get(userId);
    if (!managed) return;
    this.displays.delete(userId);
    // The VNC server first: it holds the display open, and killing X underneath it leaves it spinning
    // on a connection that will never answer.
    await this.stop(managed.vnc, 'x11vnc');
    await this.stop(managed.xvfb, 'Xvfb');
    rmSync(managed.socketPath, { force: true });
    rmSync(`/tmp/.X${managed.displayNumber}-lock`, { force: true });
  }

  async releaseAll(): Promise<void> {
    await Promise.allSettled([...this.displays.keys()].map((userId) => this.release(userId)));
  }

  private async stop(child: ChildProcess, name: string): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const exited = await waitFor(() => child.exitCode !== null || child.signalCode !== null, 3_000);
    if (exited) return;
    this.deps.logger.warn(`browser vnc ${name} did not exit on SIGTERM; killing`);
    child.kill('SIGKILL');
    await waitFor(() => child.exitCode !== null || child.signalCode !== null, 2_000);
  }

  /** A free display number above the range a desktop session would use. The lock file X itself writes is
   *  the interlock; this only avoids handing out a number that is already claimed. */
  private reserveDisplayNumber(): number {
    const taken = new Set([...this.displays.values()].map((display) => display.displayNumber));
    for (let candidate = 90; candidate < 190; candidate += 1) {
      if (taken.has(candidate) || displayInUse(candidate)) continue;
      return candidate;
    }
    throw new VncDisplayError('No free X display number is available.');
  }

  private writeXauthority(path: string, displayNumber: number): void {
    const cookie = randomBytes(16);
    const display = Buffer.from(String(displayNumber), 'ascii');
    const name = Buffer.from('MIT-MAGIC-COOKIE-1', 'ascii');
    // Xauthority record: family, then address, display number, auth name and auth data, each
    // length-prefixed big-endian. FamilyLocal (256) with the host name is what Xlib matches a unix-socket
    // connection against — the same record `xauth add :N MIT-MAGIC-COOKIE-1 …` writes.
    const parts: Buffer[] = [];
    const push = (value: Buffer): void => {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(value.length, 0);
      parts.push(length, value);
    };
    const family = Buffer.alloc(2);
    family.writeUInt16BE(256, 0);
    parts.push(family);
    push(Buffer.from(hostname(), 'ascii'));
    push(display);
    push(name);
    push(cookie);
    writeFileSync(path, Buffer.concat(parts), { mode: 0o600 });
    chmodSync(path, 0o600);
  }
}
