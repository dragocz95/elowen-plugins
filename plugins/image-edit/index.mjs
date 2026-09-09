// Image-edit plugin: image-to-image through the host's image seam (ctx.images). The source image comes
// from an accessible repo path (guarded) or a public URL; the edited PNG is saved to the plugin data dir
// and served back to the chat by the daemon's /brain/images route, so it renders inline.
//
// The transport lives in core: an API-key provider goes to its OpenAI-compatible edits API and a connected
// ChatGPT account to its own image backend, whose OAuth token never enters plugin code. This plugin loads
// the source bytes and writes the result.
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FETCH_TIMEOUT_MS = 120_000;
const SIZES = new Set(['1024x1024', '1536x1024', '1024x1536']);
const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });
const fail = (e) => ok(`Error: ${e instanceof Error ? e.message : String(e)}`);

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

/** "auto" and anything unrecognised mean "let the model choose", which both transports express by simply
 *  not sending a size. */
export function editSize(value) {
  return typeof value === 'string' && SIZES.has(value.trim()) ? value.trim() : undefined;
}

export function register(ctx) {
  // Credentials come from a configured brain provider (chosen in settings) — one central account or key.
  const providerId = typeof ctx.config.provider === 'string' ? ctx.config.provider.trim() : '';
  const provider = ctx.resolveProvider(providerId);
  if (!providerUsable(provider)) { ctx.logger.warn('enabled but no usable image provider configured — tool not registered'); return; }
  const model = resolveModel(ctx.config.model, provider.type);

  ctx.registerTool(defineTool({
    name: 'EditImage', label: 'Edit image',
    description: [
      'Edit, modify, retouch or restyle an image that already exists (image-to-image) by describing the change',
      'in words: remove or add an object, change the background or colours, redraw it in another style, clean it',
      'up or extend it. The source must be given either as path — a picture file inside your accessible',
      'repositories, PNG or JPEG — or as url, a public http(s) link to the picture; give exactly one of them, and',
      'when neither is present the call is refused. To create a picture from nothing but a description use',
      'GenerateImage instead, since this tool always needs a source image. Put the desired change in instruction',
      '("make the sky orange", "remove the person on the left"), and set size to 1024x1024, 1536x1024, 1024x1536',
      'or auto to keep the model\'s own choice. The result is a new PNG saved in the plugin data directory and',
      'returned as a markdown image that renders inline in the web chat; the original file is never overwritten.',
      'Image models are slow, so a call may take up to two minutes and then time out, the edit is a fresh render',
      'rather than a pixel-exact patch of the source, and the tool is unavailable until an image provider is',
      'configured in settings.',
    ].join(' '),
    parameters: Type.Object({
      instruction: Type.String({ description: 'What to change about the image, e.g. "remove the background and make it transparent white"' }),
      path: Type.Optional(Type.String({ description: 'Source image as a file path inside your accessible repositories, e.g. "assets/logo.png" (PNG or JPEG). Use this or url, not both.' })),
      url: Type.Optional(Type.String({ description: 'Source image as a public http(s) URL. Use this or path, not both.' })),
      size: Type.Optional(Type.String({ description: 'Output resolution: "1024x1024" (square), "1536x1024" (landscape), "1024x1536" (portrait) or "auto". Any other value is treated as "auto".' })),
    }),
    execute: async (_id, p) => {
      try {
        const instruction = typeof p.instruction === 'string' ? p.instruction.trim() : '';
        if (!instruction) return ok('Error: instruction is required.');
        // Load the source bytes from a guarded repo path or a public URL.
        let bytes;
        let mime = 'image/png';
        if (p.path) {
          if (!/\.(?:png|jpe?g)$/i.test(String(p.path))) return ok('Error: path must point to a PNG or JPEG image.');
          bytes = readFileSync(ctx.assertPathAllowed(p.path));
          if (/\.jpe?g$/i.test(p.path)) mime = 'image/jpeg';
        } else if (p.url) {
          const u = new URL(p.url);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') return ok('Error: url must be http(s).');
          const r = await fetch(u, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
          if (!r.ok) throw new Error(`fetch source HTTP ${r.status}`);
          const contentType = r.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
          if (contentType && !['image/png', 'image/jpeg'].includes(contentType)) throw new Error('source URL must return a PNG or JPEG image');
          mime = contentType || mime;
          bytes = Buffer.from(await r.arrayBuffer());
        } else {
          return ok('Error: provide either a repo file path or a public image URL.');
        }

        const size = editSize(p.size);
        const image = await ctx.images.edit({
          providerId, model, prompt: instruction, images: [{ bytes, mime }], ...(size ? { size } : {}),
        });
        const file = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.png`;
        writeFileSync(join(ctx.dataDir(), file), image.png);
        return ok(`![${instruction.slice(0, 80).replaceAll(']', '')}](/api/brain/images/${file})`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.logger.info(`image-edit registered (${provider.label}, ${model})`);
}
