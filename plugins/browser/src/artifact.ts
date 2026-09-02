import type { PluginContext } from 'elowen/plugin-api';
import type { BrowserArtifactData, BrowserArtifactPublisher, BrowserArtifactRef } from './types.js';

const artifactPayload = (data: BrowserArtifactData): Record<string, string | null> => ({
  browserSessionId: data.browserSessionId,
  state: data.state,
  title: data.title,
  url: data.url,
  lastAction: data.lastAction,
});

const fallbackText = (data: BrowserArtifactData): string => {
  const state = data.state === 'user' ? 'User control' : data.state === 'agent' ? 'Agent control' : data.state;
  const location = data.title || data.url || 'Browser session';
  return `${location}\n${state}${data.lastAction ? ` · ${data.lastAction}` : ''}`;
};

export class ElowenArtifactPublisher implements BrowserArtifactPublisher {
  readonly available: boolean;

  constructor(private readonly context: PluginContext) {
    this.available = !!context.chatArtifacts
      && typeof context.chatArtifacts.open === 'function'
      && typeof context.chatArtifacts.update === 'function'
      && typeof context.chatArtifacts.close === 'function';
  }

  async open(input: {
    toolCallId: string;
    conversationId: string;
    expiresAt: number;
    data: BrowserArtifactData;
  }): Promise<BrowserArtifactRef | null> {
    if (!this.available) return null;
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

  async update(ref: BrowserArtifactRef, data: BrowserArtifactData): Promise<void> {
    if (!this.available) return;
    this.context.chatArtifacts.update(ref, { data: artifactPayload(data), fallback: fallbackText(data) });
  }

  async close(ref: BrowserArtifactRef): Promise<void> {
    if (!this.available) return;
    this.context.chatArtifacts.close(ref);
  }
}

export const UNAVAILABLE_ARTIFACT_PUBLISHER: BrowserArtifactPublisher = {
  available: false,
  open: async () => null,
  update: async () => {},
  close: async () => {},
};

export function artifactData(input: {
  browserSessionId: string;
  state: BrowserArtifactData['state'];
  title?: string;
  url?: string;
  lastAction?: string | null;
}): BrowserArtifactData {
  return {
    browserSessionId: input.browserSessionId,
    state: input.state,
    title: input.title ?? '',
    url: input.url ?? '',
    lastAction: input.lastAction ?? null,
  };
}

export function parseArtifactRef(value: string | null): BrowserArtifactRef | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<BrowserArtifactRef>;
    if (parsed.version !== 1 || typeof parsed.artifactId !== 'string' || typeof parsed.token !== 'string'
      || typeof parsed.sessionId !== 'string') return null;
    return parsed as BrowserArtifactRef;
  } catch {
    return null;
  }
}

export const serializeArtifactRef = (ref: BrowserArtifactRef | null): string | null => ref ? JSON.stringify(ref) : null;
