export class StreamBudget {
    limit;
    now;
    windowStartedAt = 0;
    bytes = 0;
    constructor(limit, now = () => Date.now()) {
        this.limit = limit;
        this.now = now;
    }
    consume(bytes) {
        const now = this.now();
        if (now - this.windowStartedAt >= 1000) {
            this.windowStartedAt = now;
            this.bytes = 0;
        }
        if (this.bytes + bytes > this.limit())
            return false;
        this.bytes += bytes;
        return true;
    }
}
export class ScreencastHub {
    cdp;
    config;
    budget;
    logger;
    subscribers = new Map();
    started = false;
    closed = false;
    quality;
    fps;
    consecutiveDrops = 0;
    reconfiguring = null;
    onFrame = (payload) => { void this.handleFrame(payload); };
    constructor(cdp, config, budget, logger) {
        this.cdp = cdp;
        this.config = config;
        this.budget = budget;
        this.logger = logger;
        this.quality = config().jpegQuality;
        this.fps = config().webFps;
        cdp.on('Page.screencastFrame', this.onFrame);
    }
    subscriberCount() { return this.subscribers.size; }
    async subscribe(id, send) {
        if (this.closed)
            throw new Error('Browser screencast is closed.');
        if (this.subscribers.has(id))
            throw new Error('Browser screencast subscriber already exists.');
        if (this.subscribers.size >= this.config().maxViewersPerSession)
            throw new Error('Browser viewer limit reached.');
        this.subscribers.set(id, { id, send, sending: false, latest: null, closed: false });
        if (!this.started)
            await this.start();
        return async () => {
            const subscriber = this.subscribers.get(id);
            if (!subscriber)
                return;
            subscriber.closed = true;
            subscriber.latest = null;
            this.subscribers.delete(id);
            if (this.subscribers.size === 0)
                await this.stop();
        };
    }
    async replaceCdp(cdp) {
        const wasStarted = this.started;
        if (wasStarted)
            await this.stop();
        this.cdp.off?.('Page.screencastFrame', this.onFrame);
        this.cdp = cdp;
        cdp.on('Page.screencastFrame', this.onFrame);
        if (wasStarted && this.subscribers.size > 0)
            await this.start();
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        for (const subscriber of this.subscribers.values()) {
            subscriber.closed = true;
            subscriber.latest = null;
        }
        this.subscribers.clear();
        await this.stop();
        this.cdp.off?.('Page.screencastFrame', this.onFrame);
    }
    async start() {
        if (this.started || this.closed)
            return;
        const config = this.config();
        await this.cdp.send('Page.startScreencast', {
            format: 'jpeg',
            quality: this.quality,
            maxWidth: config.maxViewportWidth,
            maxHeight: config.viewportHeight,
            everyNthFrame: Math.max(1, Math.round(60 / this.fps)),
        });
        this.started = true;
    }
    async stop() {
        if (!this.started)
            return;
        this.started = false;
        await this.cdp.send('Page.stopScreencast').catch(() => { });
    }
    async handleFrame(payload) {
        if (Number.isSafeInteger(payload.sessionId)) {
            await this.cdp.send('Page.screencastFrameAck', { sessionId: payload.sessionId }).catch((error) => {
                this.logger.warn(`browser screencast ACK failed: ${error instanceof Error ? error.message : String(error)}`);
            });
        }
        if (!payload.data || this.closed || this.subscribers.size === 0)
            return;
        const bytes = Math.floor(payload.data.length * 0.75);
        const deliveredBytes = bytes * this.subscribers.size;
        if (bytes > this.config().maxFrameBytes || !this.budget.consume(deliveredBytes)) {
            this.consecutiveDrops += 1;
            if (this.consecutiveDrops >= 3)
                void this.adaptDown();
            return;
        }
        this.consecutiveDrops = 0;
        const frame = {
            data: payload.data,
            mimeType: 'image/jpeg',
            width: Math.max(1, Math.round(payload.metadata?.deviceWidth ?? this.config().maxViewportWidth)),
            height: Math.max(1, Math.round(payload.metadata?.deviceHeight ?? this.config().viewportHeight)),
            timestamp: Math.round((payload.metadata?.timestamp ?? Date.now() / 1000) * 1000),
        };
        for (const subscriber of this.subscribers.values())
            this.enqueue(subscriber, frame);
    }
    enqueue(subscriber, frame) {
        if (subscriber.closed)
            return;
        if (subscriber.sending) {
            subscriber.latest = frame;
            return;
        }
        subscriber.sending = true;
        void this.pump(subscriber, frame);
    }
    async pump(subscriber, first) {
        let frame = first;
        try {
            while (frame && !subscriber.closed) {
                subscriber.latest = null;
                await subscriber.send(frame);
                frame = subscriber.latest;
            }
        }
        catch (error) {
            subscriber.closed = true;
            this.subscribers.delete(subscriber.id);
            if (this.subscribers.size === 0)
                await this.stop();
            this.logger.debug?.(`browser screencast subscriber disconnected: ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            subscriber.sending = false;
            subscriber.latest = null;
        }
    }
    adaptDown() {
        if (this.reconfiguring)
            return this.reconfiguring;
        this.reconfiguring = (async () => {
            this.consecutiveDrops = 0;
            const nextQuality = Math.max(40, this.quality - 5);
            const nextFps = Math.max(1, this.fps - 1);
            if (nextQuality === this.quality && nextFps === this.fps)
                return;
            this.quality = nextQuality;
            this.fps = nextFps;
            if (this.started) {
                await this.stop();
                if (this.subscribers.size > 0 && !this.closed)
                    await this.start();
            }
        })().finally(() => { this.reconfiguring = null; });
        return this.reconfiguring;
    }
}
