export type BrowserSessionState = 'creating' | 'agent' | 'user' | 'closing' | 'closed' | 'error';

export interface BrowserArtifactRef {
  version: 1;
  artifactId: string;
  token: string;
  sessionId: string;
}

export interface BrowserArtifactData {
  browserSessionId: string;
  state: BrowserSessionState;
  title: string;
  url: string;
  favicon: string | null;
  lastAction: string | null;
}

export interface BrowserArtifactPublisher {
  readonly available: boolean;
  open(input: {
    toolCallId: string;
    conversationId: string;
    expiresAt: number;
    data: BrowserArtifactData;
  }): Promise<BrowserArtifactRef | null>;
  update(ref: BrowserArtifactRef, data: BrowserArtifactData): Promise<void>;
  close(ref: BrowserArtifactRef): Promise<void>;
}

export interface CDPSessionLike {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(event: string, listener: (payload: unknown) => void): void;
  /** Required, not optional: the diagnostics collector subscribes to five CDP domains per tab and has to
   *  prove it unsubscribed from all of them on a tab switch. An optional `off` turns that proof into a
   *  silent no-op — the listeners stay, holding the previous tab's session alive. Puppeteer's CDPSession
   *  is an EventEmitter, so every real implementation and every test double already has it. */
  off(event: string, listener: (payload: unknown) => void): void;
  detach?(): Promise<void>;
}

export interface BrowserTargetLike {
  type(): string;
  url(): string;
  page(): Promise<PageLike | null>;
  opener?(): BrowserTargetLike | null;
  targetId?(): string;
}

export interface PageLike {
  url(): string;
  title(): Promise<string>;
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  close(options?: Record<string, unknown>): Promise<void>;
  isClosed?(): boolean;
  createCDPSession(): Promise<CDPSessionLike>;
  setViewport?(viewport: { width: number; height: number }): Promise<void>;
  authenticate?(credentials: { username: string; password: string }): Promise<void>;
  target?(): BrowserTargetLike;
}

interface BrowserProcessLike {
  pid?: number;
}

export interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
  connected?: boolean;
  process?(): BrowserProcessLike | null;
  targets?(): BrowserTargetLike[];
  on?(event: string, listener: (target: BrowserTargetLike) => void): void;
  off?(event: string, listener: (target: BrowserTargetLike) => void): void;
}

interface BrowserLaunchOptions {
  executablePath: string;
  userDataDir: string;
  proxyUrl: string;
  viewport: { width: number; height: number };
}

export interface BrowserProcessFactory {
  launch(options: BrowserLaunchOptions): Promise<BrowserLike>;
  dependencyAvailable(): Promise<boolean>;
}

export interface ProxyLease {
  url: string;
  username: string;
  password: string;
  close(): Promise<void>;
}

export interface BrowserProxyFactory {
  readonly safePinningAvailable: boolean;
  dependencyAvailable?(): Promise<boolean>;
  open(userId: number): Promise<ProxyLease>;
  closeAll(): Promise<void>;
}

export interface ManagedProcessRecord {
  userId: number;
  pid: number;
  startedAtTicks: string;
  executablePath: string;
  profilePath: string;
  createdAt: number;
}

export interface ProcessSnapshot {
  pid: number;
  startedAtTicks: string;
  executablePath: string;
  args: string[];
  rssBytes?: number;
}

export interface ProcessInspector {
  inspect(pid: number): ProcessSnapshot | null;
  terminate(pid: number, signal?: 'SIGTERM' | 'SIGKILL'): void;
}

export interface AxElementRef {
  ref: string;
  /** The DOM node behind this accessibility node, or null when there is none. Parts of an accessibility
   *  tree are computed rather than rendered — the root web area, a generated list marker — and those have
   *  no box to click or to photograph. Recording them as null is what lets a refusal say WHY. */
  backendNodeId: number | null;
  role: string;
  name: string;
  /** Whether this element takes input. Everything the snapshot printed is addressable — a heading can be
   *  photographed like anything else — but only an interactive element can be clicked or filled. */
  interactive: boolean;
  disabled: boolean;
}

export interface AccessibilitySnapshot {
  title: string;
  url: string;
  text: string;
  elements: Map<string, AxElementRef>;
  capturedAt: number;
}

export interface BrowserTabInfo {
  id: string;
  sessionId: string;
  targetId: string;
  openerTargetId: string | null;
  title: string;
  url: string;
  active: boolean;
}

export interface ScreencastFrame {
  data: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  timestamp: number;
}

export interface BrowserActionEvent {
  kind: 'cursor' | 'action' | 'control' | 'tab' | 'closed';
  data: Record<string, unknown>;
}

export interface BrowserLogger {
  debug?(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface BrowserClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const SYSTEM_CLOCK: BrowserClock = {
  now: () => Date.now(),
  sleep: (ms, signal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Operation aborted.'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Operation aborted.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  }),
};
