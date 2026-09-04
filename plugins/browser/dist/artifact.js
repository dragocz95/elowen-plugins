import { boundText } from './redaction.js';
const MAX_ARTIFACT_TITLE = 512;
const MAX_ARTIFACT_URL = 2_048;
const MAX_ARTIFACT_FAVICON = 4_096;
const MAX_ARTIFACT_ACTION = 512;
const MAX_ARTIFACT_FALLBACK = 2_000;
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
    return boundText(`${location}\n${state}${data.lastAction ? ` · ${data.lastAction}` : ''}`, MAX_ARTIFACT_FALLBACK);
};
export class ElowenArtifactPublisher {
    context;
    available;
    artifacts;
    constructor(context) {
        this.context = context;
        const artifacts = context.chatArtifacts;
        this.artifacts = artifacts
            && typeof artifacts.open === 'function'
            && typeof artifacts.update === 'function'
            && typeof artifacts.close === 'function'
            ? artifacts
            : null;
        this.available = this.artifacts !== null;
    }
    async open(input) {
        const artifacts = this.artifacts;
        if (!artifacts)
            return null;
        if (this.context.currentSessionId() !== input.conversationId) {
            throw new Error('Browser artifact conversation scope changed before it opened.');
        }
        return await artifacts.open(input.toolCallId, {
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
        if (!this.artifacts)
            return;
        await this.artifacts.update(ref, { data: artifactPayload(data), fallback: fallbackText(data) });
    }
    async close(ref) {
        if (!this.artifacts)
            return;
        await this.artifacts.close(ref);
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
        title: boundText(input.title ?? '', MAX_ARTIFACT_TITLE),
        url: boundText(input.url ?? '', MAX_ARTIFACT_URL),
        favicon: input.favicon && input.favicon.length <= MAX_ARTIFACT_FAVICON ? input.favicon : null,
        lastAction: input.lastAction ? boundText(input.lastAction, MAX_ARTIFACT_ACTION) : null,
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
