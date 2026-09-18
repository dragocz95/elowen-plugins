// Image-edit plugin: image-to-image through the host's image seam (ctx.images). The source image comes
// from an accessible repo path (guarded) or a public URL; the edited PNG is saved to the plugin data dir
// and served back to the chat by the daemon's /brain/images route, so it renders inline.
//
// The transport lives in core: an API-key provider goes to its OpenAI-compatible edits API and a connected
// ChatGPT account to its own image backend, whose OAuth token never enters plugin code. This plugin loads
// the source bytes and writes the result.
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { readFileSync } from 'node:fs';
import { createImageRuntime } from './lib/runtime.mjs';

export { providerUsable, resolveModel } from './lib/runtime.mjs';

const FETCH_TIMEOUT_MS = 120_000;
const SIZES = new Set(['1024x1024', '1536x1024', '1024x1536']);

/** "auto" and anything unrecognised mean "let the model choose", which both transports express by simply
 *  not sending a size. */
export function editSize(value) {
  return typeof value === 'string' && SIZES.has(value.trim()) ? value.trim() : undefined;
}

export function register(ctx) {
  // Credentials come from a configured brain provider (chosen in settings) — one central account or key.
  const runtime = createImageRuntime(ctx, 'image-edit');
  if (!runtime) return;
  const { providerId, provider, model } = runtime;
  const publicHttp = ctx.host.publicHttp();

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
        if (!instruction) return runtime.ok('Error: instruction is required.');
        // Load the source bytes from a guarded repo path or a public URL.
        let bytes;
        let mime = 'image/png';
        if (p.path) {
          if (!/\.(?:png|jpe?g)$/i.test(String(p.path))) return runtime.ok('Error: path must point to a PNG or JPEG image.');
          bytes = readFileSync(ctx.assertPathAllowed(p.path));
          if (/\.jpe?g$/i.test(p.path)) mime = 'image/jpeg';
        } else if (p.url) {
          const r = await publicHttp.request(p.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
          if (r.status < 200 || r.status >= 300) {
            r.cancel();
            throw new Error(`fetch source HTTP ${r.status}`);
          }
          const contentType = r.headers['content-type']?.split(';')[0].trim().toLowerCase() || '';
          if (contentType && !['image/png', 'image/jpeg'].includes(contentType)) {
            r.cancel();
            throw new Error('source URL must return a PNG or JPEG image');
          }
          const chunks = [];
          for await (const chunk of r.body) chunks.push(Buffer.from(chunk));
          mime = contentType || mime;
          bytes = Buffer.concat(chunks);
        } else {
          return runtime.ok('Error: provide either a repo file path or a public image URL.');
        }

        const size = editSize(p.size);
        return runtime.render('edit', {
          providerId, model, prompt: instruction, images: [{ bytes, mime }], ...(size ? { size } : {}),
        }, instruction);
      } catch (e) { return runtime.fail(e); }
    },
  }));

  ctx.logger.info(`image-edit registered (${provider.label}, ${model})`);
}
