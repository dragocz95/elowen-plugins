import { connect } from 'node:net';
import { RfbInputFilter } from './rfb-filter.js';
/** The route this plugin answers on, and therefore the tail of the URL the card dials. */
export const VNC_ROUTE_PATH = 'vnc';
/** A ticket opens one connection and is redeemed on the upgrade, so it only has to outlive the round trip
 *  from minting it to dialling. Short on purpose: a ticket sitting in a page that was never used is a
 *  credential with no owner. */
const VNC_TICKET_TTL_MS = 15_000;
/** Stop reading from the VNC server once this much is queued for a viewer that is not keeping up.
 *  Without it a slow phone on a scrolling page accumulates the whole difference in the daemon's heap. */
const BACKPRESSURE_HIGH_WATER = 4 * 1024 * 1024;
const BACKPRESSURE_POLL_MS = 50;
/** Application close codes. The 4000 range is reserved for exactly this, and the card reads them to tell
 *  "the room is full" — a state that resolves itself when somebody leaves — from a broken connection. */
export const VNC_CLOSE = {
    unauthenticated: 4401,
    unavailable: 4404,
    viewerLimit: 4429,
    protocol: 4400,
    upstreamLost: 4502,
    sessionClosed: 4503,
};
/** Whether this daemon can carry a WebSocket into a plugin at all.
 *
 *  Tested rather than assumed, because the plugin is installable on a core that predates the contract.
 *  The manifest's `requiresCore` states the same thing declaratively; this is what makes the failure a
 *  readable log line instead of a TypeError during registration. */
export function webSocketSupport(ctx) {
    const candidate = ctx;
    return typeof candidate.registerWebSocketRoute === 'function' && typeof candidate.issueWebSocketTicket === 'function'
        ? candidate
        : null;
}
const asPayload = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const raw = value;
    if (typeof raw.sessionId !== 'string' || !raw.sessionId)
        return null;
    return { sessionId: raw.sessionId };
};
const asBuffer = (data) => typeof data === 'string' ? Buffer.from(data, 'binary') : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
export class VncTransport {
    deps;
    bySession = new Map();
    constructor(deps) {
        this.deps = deps;
    }
    /** Ask the core for the socket route. Called once at registration. */
    register(core) {
        core.registerWebSocketRoute({
            path: VNC_ROUTE_PATH,
            access: 'user',
            handler: (conn) => this.handle(conn),
        });
    }
    /** Mint the credential the card opens the socket with. The caller has ALREADY been proved to own the
     *  session by the ordinary authenticated route that reaches this, so the ticket inherits exactly that
     *  authority and carries nothing else. */
    issueTicket(core, userId, payload) {
        const { ticket, expiresAt } = core.issueWebSocketTicket({ userId, payload, ttlMs: VNC_TICKET_TTL_MS });
        return { url: `/ws/plugins/browser/${VNC_ROUTE_PATH}?ticket=${encodeURIComponent(ticket)}`, expiresAt };
    }
    viewerCount(sessionId) { return this.bySession.get(sessionId)?.size ?? 0; }
    /** Drop every live view of a session, because the thing they were views OF has gone. The card sees an
     *  ordinary close and reconnects, which either finds a healthy session or is told there is none. */
    closeSession(sessionId, reason) {
        const peers = this.bySession.get(sessionId);
        if (!peers)
            return;
        for (const peer of [...peers])
            peer.shutdown(VNC_CLOSE.sessionClosed, reason);
    }
    closeAll(reason) {
        for (const sessionId of [...this.bySession.keys()])
            this.closeSession(sessionId, reason);
    }
    /** Synchronous on purpose, and it must stay that way.
     *
     *  The daemon pauses the socket after the upgrade until the handler registers `onMessage` or returns,
     *  so an `await` before that registration delays the client's opening RFB bytes behind whatever is
     *  being awaited. Nothing here needs to wait: the target is resolved from memory and the upstream
     *  socket is dialled without blocking, because Node queues writes made before a connection lands. */
    handle(conn) {
        // The daemon already redeemed the ticket and enforced this route's access level against its owner,
        // so this is a shape check on an identity that is already trusted, not an authorisation decision.
        const userId = conn.auth.userId;
        if (typeof userId !== 'number') {
            conn.close(VNC_CLOSE.unauthenticated, 'unauthenticated');
            return;
        }
        const payload = asPayload(conn.payload);
        if (!payload) {
            conn.close(VNC_CLOSE.protocol, 'invalid_ticket');
            return;
        }
        const target = this.deps.resolve(userId, payload);
        if (!target) {
            conn.close(VNC_CLOSE.unavailable, 'session_unavailable');
            return;
        }
        // The viewer limit is a limit on RFB CONNECTIONS, because that is what costs: x11vnc encodes the
        // whole framebuffer once per client and cannot scale it down for a small one.
        const peers = this.bySession.get(payload.sessionId) ?? new Set();
        if (peers.size >= this.deps.config().maxViewersPerSession) {
            conn.close(VNC_CLOSE.viewerLimit, 'viewer_limit');
            return;
        }
        this.bySession.set(payload.sessionId, peers);
        this.pipe(conn, payload, target, peers);
    }
    pipe(conn, payload, target, peers) {
        const filter = new RfbInputFilter();
        let closed = false;
        let paused = false;
        let resumeTimer = null;
        // Dialled first so the callbacks below have something to write to. `net.connect` returns immediately
        // and queues anything written before the connection lands, so this does not block the registration
        // that follows it.
        const upstream = (this.deps.dial ?? defaultDial)(target.socketPath);
        const entry = {
            sessionId: payload.sessionId,
            shutdown: (code, reason) => {
                if (closed)
                    return;
                closed = true;
                if (resumeTimer)
                    clearTimeout(resumeTimer);
                peers.delete(entry);
                if (peers.size === 0)
                    this.bySession.delete(payload.sessionId);
                upstream.destroy();
                conn.close(code, reason);
            },
        };
        peers.add(entry);
        // FIRST, and synchronously: the daemon leaves the socket paused until this is registered, so noVNC's
        // opening handshake bytes wait here rather than anywhere later in this function.
        conn.onMessage((data) => {
            if (closed)
                return;
            // Framed on every connection: see RfbInputFilter. Input is let through for every viewer, because
            // every viewer IS the session's owner — the ticket proved that — and the owner may always reach
            // into their own browser, agent driving or not. The takeover lease decides whether the AGENT waits,
            // not whether the human's click arrives; gating clicks on it once left a connection opened before
            // the takeover dead until it happened to reconnect.
            const result = filter.push(asBuffer(data), true);
            if (result.forward.length > 0)
                upstream.write(result.forward);
            if (result.close) {
                this.deps.logger.warn(`browser vnc connection closed: ${result.close}`);
                entry.shutdown(VNC_CLOSE.protocol, 'protocol_error');
            }
        });
        conn.onClose(() => entry.shutdown(VNC_CLOSE.upstreamLost, 'closed'));
        conn.signal.addEventListener('abort', () => entry.shutdown(VNC_CLOSE.sessionClosed, 'aborted'), { once: true });
        // A viewer that cannot keep up must not become the daemon's memory problem. Reading stops while its
        // queue drains, which lets the VNC server's own socket buffer apply the back pressure instead.
        const relieve = () => {
            if (closed)
                return;
            if (conn.bufferedAmount() > BACKPRESSURE_HIGH_WATER) {
                resumeTimer = setTimeout(relieve, BACKPRESSURE_POLL_MS);
                resumeTimer.unref?.();
                return;
            }
            paused = false;
            resumeTimer = null;
            upstream.resume();
        };
        upstream.on('data', (chunk) => {
            if (closed)
                return;
            conn.send(chunk);
            if (paused || conn.bufferedAmount() <= BACKPRESSURE_HIGH_WATER)
                return;
            paused = true;
            upstream.pause();
            resumeTimer = setTimeout(relieve, BACKPRESSURE_POLL_MS);
            resumeTimer.unref?.();
        });
        upstream.on('error', () => entry.shutdown(VNC_CLOSE.upstreamLost, 'display_lost'));
        upstream.on('close', () => entry.shutdown(VNC_CLOSE.upstreamLost, 'display_lost'));
    }
}
function defaultDial(socketPath) {
    const socket = connect(socketPath);
    return socket;
}
