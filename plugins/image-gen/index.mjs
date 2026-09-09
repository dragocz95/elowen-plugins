// Image generation plugin: the host's image seam (ctx.images) → PNG saved into the plugin's data dir,
// served back to the chat by the daemon's /brain/images/:file route — the tool returns a markdown image
// so the web chat renders it inline (the CLI shows the URL).
//
// The transport lives in core, not here: an API-key provider goes to its OpenAI-compatible Images API and
// a connected ChatGPT account to its own image backend, and the account's OAuth token never enters plugin
// code. This plugin picks the provider, the model and the size, and writes the bytes it gets back.
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SIZES = new Set(['1024x1024', '1536x1024', '1024x1536']);
export function normalizeSize(value, fallback = '1024x1024') {
  return typeof value === 'string' && SIZES.has(value.trim()) ? value.trim() : fallback;
}

const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });
const fail = (e) => ok(`Error: ${e instanceof Error ? e.message : String(e)}`);

/** The ChatGPT account serves its own image models; an API-key endpoint serves the OpenAI ones. */
const CODEX_PROVIDER_TYPE = 'oauth-openai-codex';
const DEFAULT_MODEL = { [CODEX_PROVIDER_TYPE]: 'gpt-image-2.5-sunburst' };
const FALLBACK_MODEL = 'gpt-image-1';

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

export function register(ctx) {
  // Credentials come from a configured brain provider (chosen in settings) — one central account or key,
  // not a second secret entered here.
  const providerId = typeof ctx.config.provider === 'string' ? ctx.config.provider.trim() : '';
  const provider = ctx.resolveProvider(providerId);
  if (!providerUsable(provider)) { ctx.logger.warn('enabled but no usable image provider configured — tool not registered'); return; }
  const model = resolveModel(ctx.config.model, provider.type);
  const defaultSize = normalizeSize(ctx.config.size);

  ctx.registerTool(defineTool({
    name: 'GenerateImage', label: 'Generate image',
    description: [
      'Generate a brand-new image, picture, illustration, logo, icon, diagram, poster or photo-like render',
      'from a text prompt, using the configured image model. Use it whenever someone asks',
      'you to draw, paint, create, design or visualize something that does not exist yet; to change an image',
      'that already exists (a file in the repository or a public URL) use EditImage instead, because this tool',
      'takes no source image. Write the prompt as a specific description of the subject, style, composition and',
      'colours — a vague prompt gives a vague picture — and pick the aspect ratio with size: 1024x1024 (square),',
      '1536x1024 (landscape) or 1024x1536 (portrait); anything else falls back to the configured default.',
      'One PNG is produced per call, saved into the plugin data directory and returned as a markdown image that',
      'renders inline in the web chat (the CLI shows the URL instead). Image models are slow: a call may take up',
      'to two minutes and then fail with a timeout. The tool cannot render reliable text inside the image, does',
      'not return the raw bytes or the file path, and is unavailable until an image provider is configured in',
      'settings.',
    ].join(' '),
    parameters: Type.Object({
      prompt: Type.String({ description: 'What to draw: subject, style, composition, colours and mood, as concretely as you can, e.g. "a flat-design logo of a blue owl on a white background"' }),
      size: Type.Optional(Type.String({ description: 'Output resolution and aspect ratio: "1024x1024" (square), "1536x1024" (landscape) or "1024x1536" (portrait). Any other value uses the configured default.' })),
    }),
    execute: async (_id, p) => {
      try {
        const prompt = typeof p.prompt === 'string' ? p.prompt.trim() : '';
        if (!prompt) return ok('Error: prompt is required.');
        const image = await ctx.images.generate({
          providerId, model, prompt, size: normalizeSize(p.size, defaultSize),
        });
        const file = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.png`;
        writeFileSync(join(ctx.dataDir(), file), image.png);
        // The daemon serves this plugin's data dir on /brain/images — the markdown renders inline.
        return ok(`![${prompt.slice(0, 80).replaceAll(']', '')}](/api/brain/images/${file})`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.logger.info(`image generation registered (${provider.label}, ${model})`);
}
