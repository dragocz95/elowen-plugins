/** A stand-in for noVNC's RFB client, aliased over `@novnc/novnc` for the whole UI runner.
 *
 *  An alias rather than a `vi.mock`, because the real package is installed under
 *  `plugins/browser/node_modules` and so does not resolve from a test file at the repo root — a mock
 *  registered against a specifier vitest cannot resolve is silently not applied, and the component then
 *  falls back to "the client failed to load" while the test waits for a connection that never comes.
 *
 *  The real client opens a WebSocket to a VNC server, which is not something jsdom can have. Everything
 *  the CARD is responsible for happens around it — minting a ticket, dialling the URL it names,
 *  reflecting the lease onto `viewOnly`, holding the connecting notice up until the handshake lands — so
 *  this exposes exactly the surface `VncSurface` uses and lets a test drive the events. */

export interface FakeRfbClient {
  viewOnly: boolean;
  scaleViewport: boolean;
  clipViewport: boolean;
  qualityLevel: number;
  compressionLevel: number;
  focused: boolean;
  disconnected: boolean;
  readonly target: HTMLElement;
  readonly url: string;
  focus(): void;
  blur(): void;
  disconnect(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  emit(type: string, detail?: unknown): void;
}

/** Every client constructed since the last reset, newest last. */
export const rfbClients: FakeRfbClient[] = [];

export function resetRfbClients(): void { rfbClients.length = 0; }

export default class FakeRfb implements FakeRfbClient {
  viewOnly = false;
  scaleViewport = false;
  clipViewport = true;
  qualityLevel = 0;
  compressionLevel = 0;
  focused = false;
  disconnected = false;
  private readonly listeners = new Map<string, (event: unknown) => void>();

  constructor(readonly target: HTMLElement, readonly url: string) { rfbClients.push(this); }

  focus(): void { this.focused = true; }
  blur(): void { this.focused = false; }
  disconnect(): void { this.disconnected = true; }
  addEventListener(type: string, listener: (event: unknown) => void): void { this.listeners.set(type, listener); }
  emit(type: string, detail?: unknown): void { this.listeners.get(type)?.({ detail }); }
}
