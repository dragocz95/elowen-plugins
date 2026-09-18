// Image generation plugin: the host's image seam (ctx.images) → PNG saved into the plugin's data dir,
// served back to the chat by the daemon's /brain/images/:file route — the tool returns a markdown image
// so the web chat renders it inline (the CLI shows the URL).
//
// The transport lives in core, not here: an API-key provider goes to its OpenAI-compatible Images API and
// a connected ChatGPT account to its own image backend, and the account's OAuth token never enters plugin
// code. This plugin picks the provider, the model and the size, and writes the bytes it gets back.
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { createImageRuntime } from './lib/runtime.mjs';

export { providerUsable, resolveModel } from './lib/runtime.mjs';

const SIZES = new Set(['1024x1024', '1536x1024', '1024x1536']);
export function normalizeSize(value, fallback = '1024x1024') {
  return typeof value === 'string' && SIZES.has(value.trim()) ? value.trim() : fallback;
}

export function register(ctx) {
  // Credentials come from a configured brain provider (chosen in settings) — one central account or key,
  // not a second secret entered here.
  const runtime = createImageRuntime(ctx, 'image-gen');
  if (!runtime) return;
  const { providerId, provider, model } = runtime;
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
        if (!prompt) return runtime.ok('Error: prompt is required.');
        // The daemon serves this plugin's data dir on /brain/images — the markdown renders inline.
        return runtime.render('generate', {
          providerId, model, prompt, size: normalizeSize(p.size, defaultSize),
        }, prompt);
      } catch (e) { return runtime.fail(e); }
    },
  }));

  ctx.logger.info(`image generation registered (${provider.label}, ${model})`);
}
