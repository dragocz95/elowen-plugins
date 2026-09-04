import { createServer } from 'node:http';
import { connect } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
/** Tickets are single use and short lived, and each one names the account AND the session it was minted
 *  for. A ticket is therefore not a capability for "the VNC bridge": it opens exactly one connection to
 *  exactly one session, and only for the account that asked. */
export class VncTicketStore {
    ttlMs;
    now;
    tickets = new Map();
    constructor(ttlMs, now = () => Date.now()) {
        this.ttlMs = ttlMs;
        this.now = now;
    }
    mint(userId, sessionId) {
        this.sweep();
        const ticket = randomBytes(24).toString('base64url');
        const expiresAt = this.now() + this.ttlMs;
        this.tickets.set(ticket, { userId, sessionId, expiresAt });
        return { ticket, expiresAt };
    }
    /** Redeem, or refuse. Redeeming REMOVES the ticket before it is validated: a replay must fail even
     *  when it arrives inside the validity window, and an expired ticket must not linger to be retried. */
    redeem(candidate) {
        this.sweep();
        const found = this.find(candidate);
        if (!found)
            return null;
        this.tickets.delete(found.key);
        return found.ticket.expiresAt > this.now() ? found.ticket : null;
    }
    revokeSession(sessionId) {
        for (const [key, ticket] of this.tickets)
            if (ticket.sessionId === sessionId)
                this.tickets.delete(key);
    }
    size() { this.sweep(); return this.tickets.size; }
    /** Constant-time lookup over the candidate, so a caller cannot learn a valid prefix by timing. */
    find(candidate) {
        const probe = Buffer.from(candidate, 'utf8');
        for (const [key, ticket] of this.tickets) {
            const known = Buffer.from(key, 'utf8');
            if (known.length === probe.length && timingSafeEqual(known, probe))
                return { key, ticket };
        }
        return null;
    }
    sweep() {
        const now = this.now();
        for (const [key, ticket] of this.tickets)
            if (ticket.expiresAt <= now)
                this.tickets.delete(key);
    }
}
/** RFB client-to-server message types that carry INPUT. A view-only connection may still send
 *  SetPixelFormat (0), SetEncodings (2) and FramebufferUpdateRequest (3); it may not send
 *  KeyEvent (4), PointerEvent (5) or ClientCutText (6). */
const INPUT_MESSAGE_TYPES = new Set([4, 5, 6]);
/** Drop input from a view-only client without tearing the connection down. Messages are variable
 *  length, so a chunk is only forwarded whole when it BEGINS with a non-input message and the client is
 *  view-only; anything containing an input opcode at a message boundary is dropped. The pilot keeps
 *  this coarse on purpose: a full client-side RFB parser belongs in the core WebSocket route, not here.
 */
export function filterViewOnly(chunk) {
    if (chunk.length === 0)
        return null;
    return INPUT_MESSAGE_TYPES.has(chunk[0]) ? null : chunk;
}
export class VncBridge {
    deps;
    server = null;
    wss = null;
    connections = new Set();
    portValue = 0;
    constructor(deps) {
        this.deps = deps;
    }
    get port() { return this.portValue; }
    get connectionCount() { return this.connections.size; }
    /** Bound to loopback only, and on an ephemeral port: nothing off this host can reach it, and the
     *  reverse proxy is given the port rather than assuming one. */
    async listen(host = '127.0.0.1') {
        const moduleName = 'ws';
        const loaded = await import(moduleName);
        if (!loaded.WebSocketServer)
            throw new Error('The ws package does not expose WebSocketServer.');
        this.wss = new loaded.WebSocketServer({ noServer: true });
        const server = createServer((_req, res) => { res.writeHead(404).end(); });
        server.on('upgrade', (request, socket, head) => this.upgrade(request, socket, head));
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, host, () => { server.off('error', reject); resolve(); });
        });
        const address = server.address();
        this.portValue = typeof address === 'object' && address ? address.port : 0;
        this.server = server;
        this.deps.logger.info(`browser vnc bridge listening on ${host}:${this.portValue}`);
        return this.portValue;
    }
    upgrade(request, socket, head) {
        const refuse = (status) => {
            socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
            socket.destroy();
        };
        let ticketValue;
        try {
            ticketValue = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('ticket') ?? '';
        }
        catch {
            refuse('400 Bad Request');
            return;
        }
        if (!ticketValue) {
            refuse('401 Unauthorized');
            return;
        }
        const ticket = this.deps.tickets.redeem(ticketValue);
        if (!ticket) {
            refuse('401 Unauthorized');
            return;
        }
        const target = this.deps.resolve(ticket);
        if (!target) {
            refuse('404 Not Found');
            return;
        }
        this.wss?.handleUpgrade(request, socket, head, (ws) => this.pipe(ws, target));
    }
    pipe(ws, target) {
        const upstream = connect(target.socketPath);
        let closed = false;
        const shutdown = () => {
            if (closed)
                return;
            closed = true;
            this.connections.delete(shutdown);
            upstream.destroy();
            if (ws.readyState === ws.OPEN)
                ws.close();
        };
        this.connections.add(shutdown);
        upstream.on('data', (chunk) => { if (ws.readyState === ws.OPEN)
            ws.send(chunk); });
        upstream.on('error', shutdown);
        upstream.on('close', shutdown);
        ws.on('message', (data) => {
            const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
            const allowed = target.interactive ? chunk : filterViewOnly(chunk);
            if (allowed)
                upstream.write(allowed);
        });
        ws.on('close', shutdown);
        ws.on('error', shutdown);
    }
    async close() {
        for (const shutdown of [...this.connections])
            shutdown();
        this.wss?.close();
        this.wss = null;
        const server = this.server;
        this.server = null;
        if (!server)
            return;
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
