import { useEffect, useRef, useState } from 'react';

/** The live view: one real RFB client on one canvas.
 *
 *  ONE connection, moved between the thumbnail slot and the expanded slot rather than duplicated. The
 *  obvious alternative — a second, view-only connection for the thumbnail — was measured and rejected:
 *  x11vnc encodes and sends the FULL framebuffer per client, with no per-client downscale, so a 300px
 *  thumbnail pays exactly what the big canvas pays. A second viewer took scrolling from 316 kB/s to
 *  523 kB/s, +65% for a picture a third of the width.
 *
 *  Only one of the two surfaces is ever visible — the expanded canvas is a portal over the whole
 *  document — so moving the node costs a reparent and nothing else. The container is created once and
 *  outlives every slot change, because it is what noVNC owns: remounting it would drop the connection
 *  every time the reader expands or collapses the card. */

/** Measured good values for this framebuffer, and not worth a setting each: quality 4 is close to the
 *  JPEG 70 the screencast used, and 6 is the compression level above which the CPU cost stops buying
 *  bytes. The one knob that genuinely trades one thing for another is the server's update coalescing,
 *  and that one IS configurable. */
const QUALITY_LEVEL = 4;
const COMPRESSION_LEVEL = 6;

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 15_000;
/** A connection has to LIVE this long before it counts as healthy and resets the backoff. The handshake
 *  alone does not: a server that hangs up on the first message after it would otherwise be retried at
 *  the minimum interval forever, with the card blinking between placeholder and canvas every time. */
const STABLE_CONNECTION_MS = 5_000;
/** A full room does not empty in half a second, so a refused viewer waits properly instead of polling. */
const VIEWER_LIMIT_RETRY_MS = 10_000;

interface RfbLike {
  viewOnly: boolean;
  scaleViewport: boolean;
  clipViewport: boolean;
  qualityLevel: number;
  compressionLevel: number;
  focus(): void;
  blur(): void;
  disconnect(): void;
  addEventListener(type: string, listener: (event: CustomEvent) => void): void;
}

type RfbConstructor = new (target: HTMLElement, url: string, options?: Record<string, unknown>) => RfbLike;

export type VncConnectionState = 'connecting' | 'connected' | 'disconnected' | 'viewer_limit' | 'unavailable' | 'failed';

/** What asking for a live view produced.
 *
 *  A refusal is a normal answer with a reason, not an exception: the room being full and the session not
 *  having a display yet are ordinary states of a card that is still perfectly usable, and the reader is
 *  told which one it is. The reason comes from the TICKET rather than from the socket's close code
 *  because noVNC does not surface one — its `disconnect` event says only whether the close was clean. */
export type VncTicketResult =
  | { kind: 'ticket'; url: string; width?: number; height?: number }
  | { kind: 'refused'; reason: 'viewer_limit' | 'unavailable' };

export interface VncSurfaceProps {
  /** Where to mount the canvas right now. The node itself never changes. */
  slot: HTMLElement | null;
  /** Mints a fresh single-use ticket. Called again on every reconnect, because a ticket opens exactly
   *  one connection — reusing one would be refused at the upgrade. */
  ticket(): Promise<VncTicketResult>;
  /** Whether this viewer holds the takeover lease. Reflected onto the client so it grabs the keyboard and
   *  shows a pointer; the SERVER is what actually refuses input, so a tampered flag changes nothing. */
  interactive: boolean;
  /** Paused when there is nothing left to show, so a closed session does not reconnect forever. */
  enabled: boolean;
}

/** noVNC is an ES module with no types of its own. */
async function loadRfb(): Promise<RfbConstructor | null> {
  try {
    const loaded = await import('@novnc/novnc') as { default?: RfbConstructor };
    return loaded.default ?? null;
  } catch { return null; }
}

export function useVncSurface({ slot, ticket, interactive, enabled }: VncSurfaceProps): {
  state: VncConnectionState;
  /** The framebuffer's shape, so the canvas box and the picture coincide instead of letterboxing. Known
   *  from the ticket, before a single pixel has arrived. */
  aspect: number | null;
  container: HTMLDivElement | null;
} {
  const [state, setState] = useState<VncConnectionState>('connecting');
  const [aspect, setAspect] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RfbLike | null>(null);
  // Both are read at the moment they matter rather than depended on. `ticket` is a fresh closure every
  // render by design — it has to mint a NEW ticket each time — so depending on it would tear the
  // connection down and rebuild it on every parent render.
  const ticketRef = useRef(ticket);
  ticketRef.current = ticket;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;

  if (!containerRef.current && typeof document !== 'undefined') {
    const node = document.createElement('div');
    node.className = 'browser-artifact__vnc';
    containerRef.current = node;
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !slot) return;
    slot.appendChild(container);
    return () => { if (container.parentNode === slot) slot.removeChild(container); };
  }, [slot]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    let disposed = false;
    let client: RfbLike | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let backoff = RECONNECT_MIN_MS;

    const report = (next: VncConnectionState): void => { if (!disposed) setState(next); };
    const later = (delay: number): void => {
      if (disposed) return;
      timer = setTimeout(() => { timer = null; void attempt(); }, delay);
    };
    const retryLater = (): void => {
      later(backoff);
      backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
    };

    const attempt = async (): Promise<void> => {
      if (disposed) return;
      report('connecting');
      // The TICKET decides whether there is anything to connect to, and says why not when there is not.
      // A host that cannot carry a socket, a session with no display yet and a full room all answer here,
      // which is also what keeps noVNC from being loaded at all on an instance that cannot use it.
      const issued = await ticketRef.current().catch((): VncTicketResult => ({ kind: 'refused', reason: 'unavailable' }));
      if (disposed) return;
      if (issued.kind === 'refused') {
        report(issued.reason === 'viewer_limit' ? 'viewer_limit' : 'unavailable');
        if (issued.reason === 'viewer_limit') later(VIEWER_LIMIT_RETRY_MS);
        else retryLater();
        return;
      }
      const Rfb = await loadRfb();
      if (disposed) return;
      if (!Rfb) { report('failed'); return; }
      if (issued.width && issued.height) setAspect(issued.width / issued.height);
      const url = new URL(issued.url, window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      client = new Rfb(container, url.toString());
      rfbRef.current = client;
      client.scaleViewport = true;
      client.clipViewport = false;
      client.qualityLevel = QUALITY_LEVEL;
      client.compressionLevel = COMPRESSION_LEVEL;
      client.viewOnly = !interactiveRef.current;
      let connectedAt: number | null = null;
      client.addEventListener('connect', () => {
        connectedAt = Date.now();
        report('connected');
      });
      client.addEventListener('disconnect', () => {
        if (rfbRef.current === client) rfbRef.current = null;
        if (connectedAt !== null && Date.now() - connectedAt >= STABLE_CONNECTION_MS) backoff = RECONNECT_MIN_MS;
        report('disconnected');
        // Why it went is asked of the next ticket rather than guessed from the close: if the room filled
        // up or the session ended, the mint above says so in words.
        retryLater();
      });
      client.addEventListener('securityfailure', () => report('failed'));
    };

    void attempt();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      try { client?.disconnect(); } catch { /* already gone */ }
      if (rfbRef.current === client) rfbRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    const client = rfbRef.current;
    if (!client) return;
    client.viewOnly = !interactive;
    if (interactive) client.focus();
    else client.blur();
  }, [interactive, state]);

  return { state, aspect, container: containerRef.current };
}
