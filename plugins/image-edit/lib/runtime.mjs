import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CODEX_PROVIDER_TYPE = 'oauth-openai-codex';
const DEFAULT_MODEL = { [CODEX_PROVIDER_TYPE]: 'gpt-image-2.5-sunburst' };
const FALLBACK_MODEL = 'gpt-image-1';

const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });

/** A provider usable for images: an API key, or the connected ChatGPT account whose credential core holds. */
export function providerUsable(provider) {
  return !!provider && (!!provider.apiKey || provider.type === CODEX_PROVIDER_TYPE);
}

/** The model field may hold an exec from an older config (`orca:openai/gpt-image-1`) or a bare id; the
 *  image APIs want the bare model — the segment after the last `/`. */
export function resolveModel(raw, providerType) {
  const fallback = DEFAULT_MODEL[providerType] ?? FALLBACK_MODEL;
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return fallback;
  return s.slice(s.lastIndexOf('/') + 1).trim() || fallback;
}

/** Common image-plugin plumbing. The marketplace installs each plugin directory independently, so this
 *  module is mirrored byte-for-byte in both payloads and its parity is pinned by the image plugin tests. */
export function createImageRuntime(ctx, sourceId) {
  const dataDir = ctx.dataDir();
  if (typeof ctx.registerChatImageSource === 'function') {
    ctx.registerChatImageSource({
      id: sourceId,
      resolve: (file) => {
        if (!/^[a-z0-9]+\.png$/.test(file)) return null;
        try { return { bytes: readFileSync(join(dataDir, file)), mimeType: 'image/png' }; }
        catch { return null; }
      },
    });
  }

  const providerId = typeof ctx.config.provider === 'string' ? ctx.config.provider.trim() : '';
  const provider = ctx.resolveProvider(providerId);
  if (!providerUsable(provider)) {
    ctx.logger.warn('enabled but no usable image provider configured — tool not registered');
    return null;
  }
  const model = resolveModel(ctx.config.model, provider.type);

  return {
    providerId,
    provider,
    model,
    ok,
    fail: (error) => ok(`Error: ${error instanceof Error ? error.message : String(error)}`),
    async render(operation, request, alt) {
      const image = await ctx.images[operation](request);
      const file = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.png`;
      writeFileSync(join(dataDir, file), image.png);
      return ok(`![${alt.slice(0, 80).replaceAll(']', '')}](/api/brain/images/${file})`);
    },
  };
}
