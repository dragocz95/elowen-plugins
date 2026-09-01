// Image generation plugin: OpenAI Images API → PNG saved into the plugin's data dir, served back to
// the chat by the daemon's /brain/images/:file route — the tool returns a markdown image so the web
// chat renders it inline (the CLI shows the URL).
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TIMEOUT_MS = 120_000; // image models are slow
const SIZES = new Set(['1024x1024', '1536x1024', '1024x1536']);
export function normalizeSize(value, fallback = '1024x1024') {
  return typeof value === 'string' && SIZES.has(value.trim()) ? value.trim() : fallback;
}

const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });
const fail = (e) => ok(`Error: ${e instanceof Error ? e.message : String(e)}`);

/** The model field is now an exec from the model picker (`orca:openai/gpt-image-1`, `openai/gpt-image-1`)
 *  or a bare id; the OpenAI Images API wants the bare model — the segment after the last `/`. */
function resolveModel(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return 'gpt-image-1';
  return s.slice(s.lastIndexOf('/') + 1).trim() || s || 'gpt-image-1';
}


/** OpenAI-compatible Images API base: the configured proxy/endpoint, default platform OpenAI.
 *  Trailing slash trimmed — paths below append /images/… directly. */
function resolveBase(raw) {
  const s = typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : '';
  return s || 'https://api.openai.com/v1';
}
export function register(ctx) {
  // Credentials come from a configured brain provider (chosen in settings) — one central key, not a
  // second secret entered here.
  const provider = ctx.resolveProvider(typeof ctx.config.provider === 'string' ? ctx.config.provider.trim() : '');
  if (!provider?.apiKey) { ctx.logger.warn('enabled but no image provider configured — tool not registered'); return; }
  const apiKey = provider.apiKey;
  const base = resolveBase(provider.baseUrl);
  const model = resolveModel(ctx.config.model);
  const defaultSize = normalizeSize(ctx.config.size);

  ctx.registerTool(defineTool({
    name: 'GenerateImage', label: 'Generate image',
    description: [
      'Generate a brand-new image, picture, illustration, logo, icon, diagram, poster or photo-like render',
      'from a text prompt, using the configured OpenAI-compatible image model. Use it whenever someone asks',
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
        const res = await fetch(`${base}/images/generations`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, prompt, size: normalizeSize(p.size, defaultSize), n: 1 }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(`openai images HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
        }
        const data = await res.json();
        const b64 = data.data?.[0]?.b64_json;
        if (!b64) throw new Error('no image in the response');
        const file = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.png`;
        writeFileSync(join(ctx.dataDir(), file), Buffer.from(b64, 'base64'));
        // The daemon serves this plugin's data dir on /brain/images — the markdown renders inline.
        return ok(`![${prompt.slice(0, 80).replaceAll(']', '')}](/api/brain/images/${file})`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.logger.info(`image generation registered (${model})`);
}
