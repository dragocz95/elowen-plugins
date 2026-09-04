import type { PluginContext } from 'elowen/plugin-api';
import { boundText } from './redaction.js';
import type { BrowserArtifactData, BrowserArtifactPublisher, BrowserArtifactRef } from './types.js';

const MAX_ARTIFACT_TITLE = 512;
const MAX_ARTIFACT_URL = 2_048;
const MAX_ARTIFACT_FAVICON = 4_096;
const MAX_ARTIFACT_ACTION = 512;
const MAX_ARTIFACT_FALLBACK = 2_000;

interface ChatArtifactsBridge {
  open(toolCallId: string, artifact: {
    id: string;
    view: string;
    fallback: string;
    expiresAt: string;
    data: Record<string, string | null>;
    media: { transport: 'sse'; path: string };
  }): BrowserArtifactRef | Promise<BrowserArtifactRef>;
  update(ref: BrowserArtifactRef, patch: { data: Record<string, string | null>; fallback: string }): void | Promise<void>;
  close(ref: BrowserArtifactRef): void | Promise<void>;
}

type ArtifactContext = PluginContext & { chatArtifacts?: ChatArtifactsBridge };

const artifactPayload = (data: BrowserArtifactData): Record<string, string | null> => ({
  browserSessionId: data.browserSessionId,
  state: data.state,
  title: data.title,
  url: data.url,
  favicon: data.favicon,
  lastAction: data.lastAction,
});

const fallbackText = (data: BrowserArtifactData): string => {
  const state = data.state === 'user' ? 'User control' : data.state === 'agent' ? 'Agent control' : data.state;
  const location = data.title || data.url || 'Browser session';
  return boundText(`${location}\n${state}${data.lastAction ? ` · ${data.lastAction}` : ''}`, MAX_ARTIFACT_FALLBACK);
};

export class ElowenArtifactPublisher implements BrowserArtifactPublisher {
  readonly available: boolean;
  private readonly artifacts: ChatArtifactsBridge | null;

  constructor(private readonly context: PluginContext) {
    const artifacts = (context as ArtifactContext).chatArtifacts;
    this.artifacts = artifacts
      && typeof artifacts.open === 'function'
      && typeof artifacts.update === 'function'
      && typeof artifacts.close === 'function'
      ? artifacts
      : null;
    this.available = this.artifacts !== null;
  }

  async open(input: {
    toolCallId: string;
    conversationId: string;
    expiresAt: number;
    data: BrowserArtifactData;
  }): Promise<BrowserArtifactRef | null> {
    const artifacts = this.artifacts;
    if (!artifacts) return null;
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

  async update(ref: BrowserArtifactRef, data: BrowserArtifactData): Promise<void> {
    if (!this.artifacts) return;
    await this.artifacts.update(ref, { data: artifactPayload(data), fallback: fallbackText(data) });
  }

  async close(ref: BrowserArtifactRef): Promise<void> {
    if (!this.artifacts) return;
    await this.artifacts.close(ref);
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
  favicon?: string | null;
  lastAction?: string | null;
}): BrowserArtifactData {
  return {
    browserSessionId: input.browserSessionId,
    state: input.state,
    title: boundText(input.title ?? '', MAX_ARTIFACT_TITLE),
    url: boundText(input.url ?? '', MAX_ARTIFACT_URL),
    favicon: input.favicon && input.favicon.length <= MAX_ARTIFACT_FAVICON ? input.favicon : null,
    lastAction: input.lastAction ? boundText(input.lastAction, MAX_ARTIFACT_ACTION) : null,
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
