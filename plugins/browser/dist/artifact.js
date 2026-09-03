const artifactPayload = (data) => ({
    browserSessionId: data.browserSessionId,
    state: data.state,
    title: data.title,
    url: data.url,
    favicon: data.favicon,
    lastAction: data.lastAction,
});
const fallbackText = (data) => {
    const state = data.state === 'user' ? 'User control' : data.state === 'agent' ? 'Agent control' : data.state;
    const location = data.title || data.url || 'Browser session';
    return `${location}\n${state}${data.lastAction ? ` · ${data.lastAction}` : ''}`;
};
export class ElowenArtifactPublisher {
    context;
    available;
    constructor(context) {
        this.context = context;
        this.available = !!context.chatArtifacts
            && typeof context.chatArtifacts.open === 'function'
            && typeof context.chatArtifacts.update === 'function'
            && typeof context.chatArtifacts.close === 'function';
    }
    async open(input) {
        if (!this.available)
            return null;
        if (this.context.currentSessionId() !== input.conversationId) {
            throw new Error('Browser artifact conversation scope changed before it opened.');
        }
        return this.context.chatArtifacts.open(input.toolCallId, {
            id: `browser:${input.data.browserSessionId}`,
            view: 'browser-session',
            fallback: fallbackText(input.data),
            expiresAt: new Date(input.expiresAt).toISOString(),
            data: artifactPayload(input.data),
            media: {
                transport: 'sse',
                path: `/plugins/browser/api/stream?sessionId=${encodeURIComponent(input.data.browserSessionId)}`,
            },
        });
    }
    async update(ref, data) {
        if (!this.available)
            return;
        this.context.chatArtifacts.update(ref, { data: artifactPayload(data), fallback: fallbackText(data) });
    }
    async close(ref) {
        if (!this.available)
            return;
        this.context.chatArtifacts.close(ref);
    }
}
export const UNAVAILABLE_ARTIFACT_PUBLISHER = {
    available: false,
    open: async () => null,
    update: async () => { },
    close: async () => { },
};
export function artifactData(input) {
    return {
        browserSessionId: input.browserSessionId,
        state: input.state,
        title: input.title ?? '',
        url: input.url ?? '',
        favicon: input.favicon ?? null,
        lastAction: input.lastAction ?? null,
    };
}
export function parseArtifactRef(value) {
    if (!value)
        return null;
    try {
        const parsed = JSON.parse(value);
        if (parsed.version !== 1 || typeof parsed.artifactId !== 'string' || typeof parsed.token !== 'string'
            || typeof parsed.sessionId !== 'string')
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
export const serializeArtifactRef = (ref) => ref ? JSON.stringify(ref) : null;
