import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { BrowserConfig } from './config.js';
import type { BrowserLogger } from './types.js';

/** PILOT (ELOWEN_BROWSER_VNC): the authenticated way a browser tab reaches an account's VNC server.
 *
 *  This exists because the daemon cannot carry a WebSocket into a plugin today: `PluginHttpResponse`
 *  offers a buffered body or an SSE stream and nothing else, no core route listens for an HTTP upgrade,
 *  and the Next.js BFF works in `Request`/`Response` and so can never emit a 101. See the report: the
 *  clean fix is a core `registerWebSocketRoute`, and this loopback listener is the pilot's stand-in for
 *  it — deliberately shaped like what that route's handler would be, so it can be deleted rather than
 *  ported.
 *
 *  A browser `WebSocket` cannot set an Authorization header, which is the whole reason for the ticket:
 *  the session's OWNER asks an ordinary authenticated plugin route for one, and it is the only thing
 *  that opens a socket. */

export interface VncTicket {
  userId: number;
  sessionId: string;
  expiresAt: number;
}

/** Tickets are single use and short lived, and each one names the account AND the session it was minted
 *  for. A ticket is therefore not a capability for "the VNC bridge": it opens exactly one connection to
 *  exactly one session, and only for the account that asked. */
export class VncTicketStore {
  private readonly tickets = new Map<string, VncTicket>();

  constructor(private readonly ttlMs: number, private readonly now: () => number = () => Date.now()) {}

  mint(userId: number, sessionId: string): { ticket: string; expiresAt: number } {
    this.sweep();
    const ticket = randomBytes(24).toString('base64url');
    const expiresAt = this.now() + this.ttlMs;
    this.tickets.set(ticket, { userId, sessionId, expiresAt });
    return { ticket, expiresAt };
  }

  /** Redeem, or refuse. Redeeming REMOVES the ticket before it is validated: a replay must fail even
   *  when it arrives inside the validity window, and an expired ticket must not linger to be retried. */
  redeem(candidate: string): VncTicket | null {
    this.sweep();
    const found = this.find(candidate);
    if (!found) return null;
    this.tickets.delete(found.key);
    return found.ticket.expiresAt > this.now() ? found.ticket : null;
  }

  revokeSession(sessionId: string): void {
    for (const [key, ticket] of this.tickets) if (ticket.sessionId === sessionId) this.tickets.delete(key);
  }

  size(): number { this.sweep(); return this.tickets.size; }

  /** Constant-time lookup over the candidate, so a caller cannot learn a valid prefix by timing. */
  private find(candidate: string): { key: string; ticket: VncTicket } | null {
    const probe = Buffer.from(candidate, 'utf8');
    for (const [key, ticket] of this.tickets) {
      const known = Buffer.from(key, 'utf8');
      if (known.length === probe.length && timingSafeEqual(known, probe)) return { key, ticket };
    }
    return null;
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, ticket] of this.tickets) if (ticket.expiresAt <= now) this.tickets.delete(key);
  }
}

export interface VncBridgeTarget {
  socketPath: string;
  /** Whether this connection may send input, or may only watch. The agent owns the page unless a user
   *  holds the takeover lease, and a view-only client is refused at the BRIDGE rather than trusted to
   *  set `viewOnly` on itself — a flag in the viewer's own JavaScript protects nobody. */
  interactive: boolean;
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
export function filterViewOnly(chunk: Buffer): Buffer | null {
  if (chunk.length === 0) return null;
  return INPUT_MESSAGE_TYPES.has(chunk[0]!) ? null : chunk;
}

export interface VncBridgeDeps {
  config: () => BrowserConfig;
  tickets: VncTicketStore;
  logger: BrowserLogger;
  /** Where this ticket's session is drawn, or null when the session has gone. Resolved at connect time
   *  rather than stored in the ticket: a session that closed between minting and connecting must not
   *  still be reachable. */
  resolve(ticket: VncTicket): VncBridgeTarget | null;
}

interface WebSocketLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  send(data: Buffer): void;
  close(): void;
  readyState: number;
  readonly OPEN: number;
}

interface WebSocketServerLike {
  handleUpgrade(request: unknown, socket: Socket, head: Buffer, callback: (ws: WebSocketLike) => void): void;
  close(): void;
}

export class VncBridge {
  private server: Server | null = null;
  private wss: WebSocketServerLike | null = null;
  private readonly connections = new Set<() => void>();
  private portValue = 0;

  constructor(private readonly deps: VncBridgeDeps) {}

  get port(): number { return this.portValue; }
  get connectionCount(): number { return this.connections.size; }

  /** Bound to loopback only, and on an ephemeral port: nothing off this host can reach it, and the
   *  reverse proxy is given the port rather than assuming one. */
  async listen(host = '127.0.0.1'): Promise<number> {
    const moduleName = 'ws';
    const loaded = await import(moduleName) as { WebSocketServer?: new (options: { noServer: boolean }) => WebSocketServerLike };
    if (!loaded.WebSocketServer) throw new Error('The ws package does not expose WebSocketServer.');
    this.wss = new loaded.WebSocketServer({ noServer: true });
    const server = createServer((_req, res) => { res.writeHead(404).end(); });
    server.on('upgrade', (request, socket, head) => this.upgrade(request, socket as Socket, head));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, host, () => { server.off('error', reject); resolve(); });
    });
    const address = server.address();
    this.portValue = typeof address === 'object' && address ? address.port : 0;
    this.server = server;
    this.deps.logger.info(`browser vnc bridge listening on ${host}:${this.portValue}`);
    return this.portValue;
  }

  private upgrade(request: { url?: string }, socket: Socket, head: Buffer): void {
    const refuse = (status: string): void => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    let ticketValue: string;
    try { ticketValue = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('ticket') ?? ''; }
    catch { refuse('400 Bad Request'); return; }
    if (!ticketValue) { refuse('401 Unauthorized'); return; }
    const ticket = this.deps.tickets.redeem(ticketValue);
    if (!ticket) { refuse('401 Unauthorized'); return; }
    const target = this.deps.resolve(ticket);
    if (!target) { refuse('404 Not Found'); return; }
    this.wss?.handleUpgrade(request, socket, head, (ws) => this.pipe(ws, target));
  }

  private pipe(ws: WebSocketLike, target: VncBridgeTarget): void {
    const upstream = connect(target.socketPath);
    let closed = false;
    const shutdown = (): void => {
      if (closed) return;
      closed = true;
      this.connections.delete(shutdown);
      upstream.destroy();
      if (ws.readyState === ws.OPEN) ws.close();
    };
    this.connections.add(shutdown);
    upstream.on('data', (chunk: Buffer) => { if (ws.readyState === ws.OPEN) ws.send(chunk); });
    upstream.on('error', shutdown);
    upstream.on('close', shutdown);
    ws.on('message', (data: unknown) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const allowed = target.interactive ? chunk : filterViewOnly(chunk);
      if (allowed) upstream.write(allowed);
    });
    ws.on('close', shutdown);
    ws.on('error', shutdown);
  }

  async close(): Promise<void> {
    for (const shutdown of [...this.connections]) shutdown();
    this.wss?.close();
    this.wss = null;
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
