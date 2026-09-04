import { useEffect, useRef, useState } from 'react';

/** PILOT (ELOWEN_BROWSER_VNC): the live view as a real RFB client instead of a stream of JPEGs.
 *
 *  ONE connection, one canvas, moved between the thumbnail and the expanded canvas.
 *
 *  The obvious alternative — a second, view-only connection for the thumbnail — was measured and
 *  rejected: x11vnc encodes and sends the FULL 1280x800 stream per client, with no per-client
 *  downscale, so a 300px thumbnail pays the same price as the canvas. A second viewer took scrolling
 *  from 316 kB/s to 523 kB/s, +65% for a picture a third of the width. Keeping the CDP screencast for
 *  the thumbnail costs the same second stream AND keeps the screencast hub alive, so it is worse again.
 *
 *  Only one of the two surfaces is ever visible — the expanded canvas is a portal over the whole
 *  document — so moving the node costs a reparent and nothing else. */

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

export interface VncSurfaceProps {
  /** Where to mount the canvas right now. The node itself never changes. */
  slot: HTMLElement | null;
  /** Mints a fresh single-use ticket and returns the socket URL to dial. */
  ticket: () => Promise<{ url: string; interactive: boolean } | null>;
  /** Whether this viewer currently drives the session. Reflected onto the client for the cursor and
   *  keyboard grab; the BRIDGE is what actually refuses input, so a tampered flag changes nothing. */
  interactive: boolean;
  quality: number;
  compression: number;
  onStateChange?(state: VncConnectionState): void;
}

export type VncConnectionState = 'connecting' | 'connected' | 'disconnected' | 'failed';

/** noVNC is an ES module with no types of its own, and the bundle must not fail to build on a host
 *  where the dependency is absent — this is a pilot behind a flag. */
async function loadRfb(): Promise<RfbConstructor | null> {
  try {
    const loaded = await import('@novnc/novnc') as { default?: RfbConstructor };
    return loaded.default ?? null;
  } catch { return null; }
}

export function useVncSurface({ slot, ticket, interactive, quality, compression, onStateChange }: VncSurfaceProps): {
  state: VncConnectionState;
  container: HTMLDivElement | null;
} {
  const [state, setState] = useState<VncConnectionState>('connecting');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RfbLike | null>(null);
  const generation = useRef(0);

  // The container is created ONCE and outlives every slot change, because it is what noVNC owns: a
  // remount would drop the connection every time the reader expands or collapses the card.
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
    if (!container) return;
    const current = ++generation.current;
    let disposed = false;
    let client: RfbLike | null = null;

    const report = (next: VncConnectionState): void => {
      if (generation.current !== current) return;
      setState(next);
      onStateChange?.(next);
    };

    void (async () => {
      const Rfb = await loadRfb();
      if (!Rfb || disposed || generation.current !== current) { report('failed'); return; }
      const issued = await ticket().catch(() => null);
      if (!issued || disposed || generation.current !== current) { report('failed'); return; }
      const url = new URL(issued.url, window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      client = new Rfb(container, url.toString());
      rfbRef.current = client;
      client.scaleViewport = true;
      client.clipViewport = false;
      client.qualityLevel = quality;
      client.compressionLevel = compression;
      client.viewOnly = !issued.interactive;
      client.addEventListener('connect', () => report('connected'));
      client.addEventListener('disconnect', () => report('disconnected'));
      client.addEventListener('securityfailure', () => report('failed'));
    })();

    return () => {
      disposed = true;
      try { client?.disconnect(); } catch { /* already gone */ }
      if (rfbRef.current === client) rfbRef.current = null;
    };
    // `ticket` is a fresh closure each render by design — it must mint a NEW single-use ticket on every
    // reconnect — so it is deliberately not a dependency; reconnecting is driven by the URL, not by it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, compression]);

  useEffect(() => {
    const client = rfbRef.current;
    if (!client) return;
    client.viewOnly = !interactive;
    if (interactive) client.focus();
    else client.blur();
  }, [interactive]);

  return { state, container: containerRef.current };
}
