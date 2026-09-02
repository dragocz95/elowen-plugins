import type { BrowserConfig } from './config.js';
import type { BrowserLogger, CDPSessionLike, ScreencastFrame } from './types.js';

interface ScreencastPayload {
  sessionId?: number;
  data?: string;
  metadata?: { deviceWidth?: number; deviceHeight?: number; timestamp?: number };
}

interface Subscriber {
  id: string;
  send(frame: ScreencastFrame): Promise<void>;
  sending: boolean;
  latest: ScreencastFrame | null;
  closed: boolean;
}

export class StreamBudget {
  private windowStartedAt = 0;
  private bytes = 0;

  constructor(private readonly limit: () => number, private readonly now: () => number = () => Date.now()) {}

  consume(bytes: number): boolean {
    const now = this.now();
    if (now - this.windowStartedAt >= 1000) {
      this.windowStartedAt = now;
      this.bytes = 0;
    }
    if (this.bytes + bytes > this.limit()) return false;
    this.bytes += bytes;
    return true;
  }
}

export class ScreencastHub {
  private readonly subscribers = new Map<string, Subscriber>();
  private started = false;
  private closed = false;
  private latestFrame: ScreencastFrame | null = null;
  private lastFrameAt = 0;
  private quality: number;
  private fps: number;
  private consecutiveDrops = 0;
  private reconfiguring: Promise<void> | null = null;
  private readonly onFrame = (payload: unknown): void => { void this.handleFrame(payload as ScreencastPayload); };

  constructor(
    private cdp: CDPSessionLike,
    private readonly config: () => BrowserConfig,
    private readonly budget: StreamBudget,
    private readonly logger: BrowserLogger,
  ) {
    this.quality = config().jpegQuality;
    this.fps = config().webFps;
    cdp.on('Page.screencastFrame', this.onFrame);
  }

  subscriberCount(): number { return this.subscribers.size; }

  async subscribe(id: string, send: (frame: ScreencastFrame) => Promise<void>): Promise<() => Promise<void>> {
    if (this.closed) throw new Error('Browser screencast is closed.');
    if (this.subscribers.has(id)) throw new Error('Browser screencast subscriber already exists.');
    if (this.subscribers.size >= this.config().maxViewersPerSession) throw new Error('Browser viewer limit reached.');
    const subscriber: Subscriber = { id, send, sending: false, latest: null, closed: false };
    this.subscribers.set(id, subscriber);
    // Page.startScreencast only guarantees the initial frame to the viewer that started it. A second phone or
    // tab joining a static page would otherwise wait forever for a paint that may never happen.
    if (this.latestFrame) this.enqueue(subscriber, this.latestFrame);
    if (!this.started) await this.start();
    return async () => {
      const current = this.subscribers.get(id);
      if (!current) return;
      current.closed = true;
      current.latest = null;
      this.subscribers.delete(id);
      if (this.subscribers.size === 0) await this.stop();
    };
  }

  async replaceCdp(cdp: CDPSessionLike): Promise<void> {
    const wasStarted = this.started;
    if (wasStarted) await this.stop();
    this.cdp.off?.('Page.screencastFrame', this.onFrame);
    this.cdp = cdp;
    this.latestFrame = null;
    cdp.on('Page.screencastFrame', this.onFrame);
    if (wasStarted && this.subscribers.size > 0) await this.start();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.latestFrame = null;
    for (const subscriber of this.subscribers.values()) {
      subscriber.closed = true;
      subscriber.latest = null;
    }
    this.subscribers.clear();
    await this.stop();
    this.cdp.off?.('Page.screencastFrame', this.onFrame);
  }

  private async start(): Promise<void> {
    if (this.started || this.closed) return;
    const config = this.config();
    this.lastFrameAt = 0;
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: this.quality,
      maxWidth: config.maxViewportWidth,
      maxHeight: config.viewportHeight,
      // Chrome only emits compositor frames. Skipping every Nth frame can starve a static page before it
      // reaches N, so capture every frame and enforce the configured FPS after ACKing it below.
      everyNthFrame: 1,
    });
    this.started = true;
  }

  private async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.cdp.send('Page.stopScreencast').catch(() => {});
  }

  private async handleFrame(payload: ScreencastPayload): Promise<void> {
    if (Number.isSafeInteger(payload.sessionId)) {
      await this.cdp.send('Page.screencastFrameAck', { sessionId: payload.sessionId }).catch((error) => {
        this.logger.warn(`browser screencast ACK failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    if (!payload.data || this.closed || this.subscribers.size === 0) return;
    const frameAt = Math.round((payload.metadata?.timestamp ?? Date.now() / 1000) * 1000);
    if (this.lastFrameAt > 0 && frameAt - this.lastFrameAt < 1000 / this.fps) return;
    const bytes = Math.floor(payload.data.length * 0.75);
    const deliveredBytes = bytes * this.subscribers.size;
    if (bytes > this.config().maxFrameBytes || !this.budget.consume(deliveredBytes)) {
      this.consecutiveDrops += 1;
      if (this.consecutiveDrops >= 3) void this.adaptDown();
      return;
    }
    this.consecutiveDrops = 0;
    this.lastFrameAt = frameAt;
    const frame: ScreencastFrame = {
      data: payload.data,
      mimeType: 'image/jpeg',
      width: Math.max(1, Math.round(payload.metadata?.deviceWidth ?? this.config().maxViewportWidth)),
      height: Math.max(1, Math.round(payload.metadata?.deviceHeight ?? this.config().viewportHeight)),
      timestamp: frameAt,
    };
    this.latestFrame = frame;
    for (const subscriber of this.subscribers.values()) this.enqueue(subscriber, frame);
  }

  private enqueue(subscriber: Subscriber, frame: ScreencastFrame): void {
    if (subscriber.closed) return;
    if (subscriber.sending) {
      subscriber.latest = frame;
      return;
    }
    subscriber.sending = true;
    void this.pump(subscriber, frame);
  }

  private async pump(subscriber: Subscriber, first: ScreencastFrame): Promise<void> {
    let frame: ScreencastFrame | null = first;
    try {
      while (frame && !subscriber.closed) {
        subscriber.latest = null;
        await subscriber.send(frame);
        frame = subscriber.latest;
      }
    } catch (error) {
      subscriber.closed = true;
      this.subscribers.delete(subscriber.id);
      if (this.subscribers.size === 0) await this.stop();
      this.logger.debug?.(`browser screencast subscriber disconnected: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      subscriber.sending = false;
      subscriber.latest = null;
    }
  }

  private adaptDown(): Promise<void> {
    if (this.reconfiguring) return this.reconfiguring;
    this.reconfiguring = (async () => {
      this.consecutiveDrops = 0;
      const nextQuality = Math.max(40, this.quality - 5);
      const nextFps = Math.max(1, this.fps - 1);
      if (nextQuality === this.quality && nextFps === this.fps) return;
      this.quality = nextQuality;
      this.fps = nextFps;
      if (this.started) {
        await this.stop();
        if (this.subscribers.size > 0 && !this.closed) await this.start();
      }
    })().finally(() => { this.reconfiguring = null; });
    return this.reconfiguring;
  }
}
