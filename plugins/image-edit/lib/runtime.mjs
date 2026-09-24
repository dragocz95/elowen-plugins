import { randomUUID } from 'node:crypto';

const CODEX_PROVIDER_TYPE = 'oauth-openai-codex';
const DEFAULT_MODEL = { [CODEX_PROVIDER_TYPE]: 'gpt-image-2.5-sunburst' };
const FALLBACK_MODEL = 'gpt-image-1';
const OUTPUT_FOLDER = 'generated-images';

const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });

/** A provider usable for images: an API key, or the connected ChatGPT account whose credential core holds. */
export function providerUsable(provider) {
  return !!provider && (!!provider.apiKey || provider.type === CODEX_PROVIDER_TYPE);
}

/** The model field may hold an exec from an older config (`orca:openai/gpt-image-1`) or a bare id; the
 * image APIs want the bare model — the segment after the last `/`. */
export function resolveModel(raw, providerType) {
  const fallback = DEFAULT_MODEL[providerType] ?? FALLBACK_MODEL;
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return fallback;
  return s.slice(s.lastIndexOf('/') + 1).trim() || fallback;
}

/** Common image-plugin plumbing. The marketplace installs each plugin directory independently, so this
 * module is mirrored byte-for-byte in both payloads and its parity is pinned by the image plugin tests. */
export function createImageRuntime(ctx) {
  const providerId = typeof ctx.config.provider === 'string' ? ctx.config.provider.trim() : '';
  const provider = ctx.resolveProvider(providerId);
  if (!providerUsable(provider)) {
    ctx.logger.warn('enabled but no usable image provider configured — tool not registered');
    return null;
  }
  const model = resolveModel(ctx.config.model, provider.type);
  const files = ctx.projectImageFiles();

  return {
    providerId,
    provider,
    model,
    files,
    ok,
    fail: (error) => ok(`Error: ${error instanceof Error ? error.message : String(error)}`),
    async render(operation, request, outputPath, overwrite = false) {
      if (outputPath !== undefined && (typeof outputPath !== 'string' || !outputPath.trim() || !/\.png$/i.test(outputPath))) {
        throw new Error('output path must end in .png');
      }
      if (typeof overwrite !== 'boolean') throw new Error('overwrite must be a boolean');
      if (overwrite && outputPath === undefined) throw new Error('overwrite requires an explicit output_path');
      const image = await ctx.images[operation](request);
      const path = await files.write(outputPath ?? `${OUTPUT_FOLDER}/${randomUUID()}.png`, image.png, overwrite);
      return ok(`Image saved: ${path}\nModel: ${image.model}\nSize: ${image.size ?? 'auto'}. An authorized sender can use ShareImage({path: "${path}"}) to show it in chat.`);
    },
  };
}
