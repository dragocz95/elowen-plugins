import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, chmodSync, constants, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { delimiter, join } from 'node:path';
/** The X display an account's Chrome is drawn on, and the VNC server that publishes it.
 *
 *  Why a real display: the CDP layer this replaces could only ever SYNTHESISE input. Chrome routes a
 *  synthesized key through the renderer, so every shortcut the BROWSER owns — Ctrl+L, Ctrl+T, a real
 *  contextmenu, a native drag — never happened. An X server has no such split: x11vnc replays the event
 *  through XTEST and Chrome cannot tell it from a keyboard.
 *
 *  One display and one VNC server per USER, shared by that account's tab sessions, because they share the
 *  one Chrome process that is drawn on it. */
/** x11vnc's framebuffer poll interval. Measured on this host at 1280x800: 10 ms paired with `-defer 10`
 *  reaches 88 ms click-to-pixel. Not configurable — polling faster than the defer window buys nothing,
 *  and polling slower makes the defer setting a lie. */
const VNC_POLL_MS = 10;
/** How long a start may take before it is called a failure. Xvfb answers in well under a second on a
 *  warm host; the margin is for a cold one under load. */
const START_TIMEOUT_MS = 10_000;
class VirtualDisplayError extends Error {
    constructor(message) { super(message); this.name = 'VirtualDisplayError'; }
}
const waitFor = async (probe, timeoutMs, intervalMs = 50) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (probe())
            return true;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return probe();
};
/** X marks a display as taken with a lock file, and the socket appears once it is serving. Checking both
 *  is what keeps two accounts off one display without a registry that a daemon restart would lose. */
const displayInUse = (displayNumber) => existsSync(`/tmp/.X${displayNumber}-lock`) || existsSync(`/tmp/.X11-unix/X${displayNumber}`);
/** An executable on PATH, as a pure read. Deliberately not `which`: the readiness report calls this, and
 *  an operator opening a status page must not spawn processes to answer it. */
export function detectExecutable(name) {
    for (const entry of (process.env.PATH ?? '').split(delimiter)) {
        if (!entry)
            continue;
        const candidate = join(entry, name);
        try {
            accessSync(candidate, constants.X_OK);
            return candidate;
        }
        catch { /* try the next PATH entry */ }
    }
    return null;
}
export class VirtualDisplayPool {
    deps;
    displays = new Map();
    starting = new Map();
    root;
    constructor(deps) {
        this.deps = deps;
        this.root = join(deps.dataDir, 'displays');
        mkdirSync(this.root, { recursive: true, mode: 0o700 });
        chmodSync(this.root, 0o700);
    }
    has(userId) { return this.displays.has(userId) || this.starting.has(userId); }
    get(userId) { return this.displays.get(userId) ?? null; }
    activeCount() { return this.displays.size; }
    /** Why this display is unusable, or null while it is healthy. */
    failure(userId) { return this.displays.get(userId)?.failure ?? null; }
    async acquire(userId) {
        const existing = this.displays.get(userId);
        if (existing && !existing.failure)
            return existing;
        if (existing)
            await this.release(userId);
        const pending = this.starting.get(userId);
        if (pending)
            return pending;
        const start = this.start(userId);
        this.starting.set(userId, start);
        try {
            return await start;
        }
        finally {
            this.starting.delete(userId);
        }
    }
    async start(userId) {
        const config = this.deps.config();
        const width = config.maxViewportWidth;
        const height = config.viewportHeight;
        const displayNumber = this.reserveDisplayNumber();
        const rootPath = join(this.root, `u-${userId}`);
        mkdirSync(rootPath, { recursive: true, mode: 0o700 });
        chmodSync(rootPath, 0o700);
        const xauthPath = join(rootPath, 'Xauthority');
        const socketPath = join(rootPath, 'vnc.sock');
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
        const managed = {
            userId, displayNumber, display: `:${displayNumber}`, xauthPath, socketPath, rootPath,
            width, height, xvfbPid: xvfb.pid ?? 0, vncPid: 0,
            xvfb, vnc: xvfb, failure: null,
        };
        let xvfbErrors = '';
        xvfb.stderr?.on('data', (chunk) => { xvfbErrors = `${xvfbErrors}${chunk.toString('utf8')}`.slice(-2000); });
        xvfb.once('exit', (code, signal) => {
            managed.failure ??= `Xvfb for user ${userId} exited (${signal ?? code}).`;
            this.deps.logger.warn(`browser vnc display :${displayNumber} lost its X server: ${signal ?? code}`);
        });
        if (!await waitFor(() => existsSync(`/tmp/.X11-unix/X${displayNumber}`), START_TIMEOUT_MS)) {
            xvfb.kill('SIGKILL');
            throw new VirtualDisplayError(`The virtual display did not start.${xvfbErrors ? ` ${xvfbErrors.trim().split('\n').pop()}` : ''}`);
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
            '-wait', String(VNC_POLL_MS),
            '-defer', String(config.vncDeferMs),
            '-quiet',
        ], { stdio: ['ignore', 'ignore', 'pipe'], detached: false });
        let vncErrors = '';
        vnc.stderr?.on('data', (chunk) => { vncErrors = `${vncErrors}${chunk.toString('utf8')}`.slice(-2000); });
        vnc.once('exit', (code, signal) => {
            managed.failure ??= `x11vnc for user ${userId} exited (${signal ?? code}).`;
            this.deps.logger.warn(`browser vnc server for display :${displayNumber} exited: ${signal ?? code}`);
        });
        managed.vnc = vnc;
        managed.vncPid = vnc.pid ?? 0;
        if (!await waitFor(() => existsSync(socketPath), START_TIMEOUT_MS)) {
            vnc.kill('SIGKILL');
            xvfb.kill('SIGKILL');
            throw new VirtualDisplayError(`The VNC server did not start.${vncErrors ? ` ${vncErrors.trim().split('\n').pop()}` : ''}`);
        }
        // x11vnc creates the socket world-connectable. The 0700 directory above already gates it, but the
        // socket says so itself rather than depending on a parent nobody re-checks.
        chmodSync(socketPath, 0o600);
        this.displays.set(userId, managed);
        this.recordDisplay(managed);
        this.deps.logger.info(`browser vnc display :${displayNumber} ready for user ${userId} (${width}x${height})`);
        return managed;
    }
    /** Write down what was started, so a daemon that is killed before it can clean up still knows — after a
     *  restart — which Xvfb and x11vnc belonged to it. Without this an orphaned pair holds a framebuffer
     *  and a display number that nothing will ever reclaim. */
    recordDisplay(managed) {
        const xvfb = this.deps.processInspector.inspect(managed.xvfbPid);
        const vnc = this.deps.processInspector.inspect(managed.vncPid);
        if (!xvfb || !vnc) {
            this.deps.logger.warn(`browser vnc display :${managed.displayNumber} could not be recorded; orphan cleanup will not cover it`);
            return;
        }
        this.deps.store.saveDisplay({
            userId: managed.userId,
            displayNumber: managed.displayNumber,
            xvfbPid: managed.xvfbPid,
            xvfbStartedAtTicks: xvfb.startedAtTicks,
            xvfbExecutablePath: xvfb.executablePath,
            vncPid: managed.vncPid,
            vncStartedAtTicks: vnc.startedAtTicks,
            vncExecutablePath: vnc.executablePath,
            socketPath: managed.socketPath,
            rootPath: managed.rootPath,
            createdAt: Date.now(),
        });
    }
    async release(userId) {
        const managed = this.displays.get(userId);
        if (!managed)
            return;
        this.displays.delete(userId);
        // The VNC server first: it holds the display open, and killing X underneath it leaves it spinning
        // on a connection that will never answer.
        await this.stop(managed.vnc, 'x11vnc');
        await this.stop(managed.xvfb, 'Xvfb');
        this.discard(managed.rootPath, managed.displayNumber);
        this.deps.store.deleteDisplay(userId);
    }
    async releaseAll() {
        await Promise.allSettled([...this.displays.keys()].map((userId) => this.release(userId)));
    }
    /** The X lock, the RFB socket and the MIT-MAGIC-COOKIE that authenticated the display. The cookie is
     *  the reason the whole directory goes rather than just the socket: a secret that outlives the display
     *  it belonged to is a secret with no owner. */
    discard(rootPath, displayNumber) {
        rmSync(rootPath, { recursive: true, force: true });
        rmSync(`/tmp/.X${displayNumber}-lock`, { force: true });
    }
    async stop(child, name) {
        if (child.exitCode !== null || child.signalCode !== null)
            return;
        child.kill('SIGTERM');
        const exited = await waitFor(() => child.exitCode !== null || child.signalCode !== null, 3_000);
        if (exited)
            return;
        this.deps.logger.warn(`browser vnc ${name} did not exit on SIGTERM; killing`);
        child.kill('SIGKILL');
        await waitFor(() => child.exitCode !== null || child.signalCode !== null, 2_000);
    }
    /** Kill the Xvfb and x11vnc pairs a previous daemon left behind, and forget the rest.
     *
     *  Identity is checked exactly as it is for an orphaned Chrome: a PID on its own is a promise the
     *  kernel does not keep, because the number is reused. A process is only terminated when its start
     *  time, its executable and the display or socket on its command line all still match what was
     *  written down. */
    reconcileOrphans() {
        for (const record of this.deps.store.displays()) {
            this.terminateOrphan(record.xvfbPid, record.xvfbStartedAtTicks, record.xvfbExecutablePath, `:${record.displayNumber}`);
            this.terminateOrphan(record.vncPid, record.vncStartedAtTicks, record.vncExecutablePath, record.socketPath);
            this.discard(record.rootPath, record.displayNumber);
            this.deps.store.deleteDisplay(record.userId);
        }
    }
    terminateOrphan(pid, startedAtTicks, executablePath, argToken) {
        const snapshot = this.deps.processInspector.inspect(pid);
        if (!snapshot)
            return;
        const matches = snapshot.startedAtTicks === startedAtTicks
            && snapshot.executablePath === executablePath
            && snapshot.args.includes(argToken);
        if (!matches) {
            this.deps.logger.warn(`refused to terminate PID ${pid}: managed virtual display identity no longer matches`);
            return;
        }
        try {
            this.deps.processInspector.terminate(pid);
        }
        catch (error) {
            this.deps.logger.warn(`could not terminate orphan virtual display process ${pid}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /** A free display number above the range a desktop session would use. The lock file X itself writes is
     *  the interlock; this only avoids handing out a number that is already claimed. */
    reserveDisplayNumber() {
        const taken = new Set([...this.displays.values()].map((display) => display.displayNumber));
        for (let candidate = 90; candidate < 190; candidate += 1) {
            if (taken.has(candidate) || displayInUse(candidate))
                continue;
            return candidate;
        }
        throw new VirtualDisplayError('No free X display number is available.');
    }
    writeXauthority(path, displayNumber) {
        const cookie = randomBytes(16);
        const display = Buffer.from(String(displayNumber), 'ascii');
        const name = Buffer.from('MIT-MAGIC-COOKIE-1', 'ascii');
        // Xauthority record: family, then address, display number, auth name and auth data, each
        // length-prefixed big-endian. FamilyLocal (256) with the host name is what Xlib matches a unix-socket
        // connection against — the same record `xauth add :N MIT-MAGIC-COOKIE-1 …` writes.
        const parts = [];
        const push = (value) => {
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
