// Build the chatbot's embeddable widget: `plugins/chatbot/embed-src/index.ts` compiled into ONE browser
// file, `plugins/chatbot/embed/widget.v2.js`, which the plugin's public hook serves as `v2/widget.js`.
//
// It is a browser artifact and nothing else. It must NOT externalize React, the host UI runtime or anything
// from `window.ElowenUiRuntime`: it runs on a third party's website where none of those exist, so every
// dependency is bundled in. `deep-chat` renders the panel and `@page-agent/page-controller` performs an
// approved action inside the page — and nothing from either library's model-driven half is imported
// anywhere, which is what keeps a model client, a provider key and a model endpoint out of the file.
//
// The output is COMMITTED, like every other browser bundle in this registry, because the marketplace copies
// a plugin verbatim and never compiles anything. `npm run check:chatbot-assets` re-runs this build and fails
// if the committed file differs, so the served widget cannot quietly stop matching its source.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { BROWSER_BUNDLES } from './browserBundles.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'plugins', 'chatbot', BROWSER_BUNDLES.chatbotEmbed.source, 'index.ts');
const bundle = join(root, 'plugins', 'chatbot', BROWSER_BUNDLES.chatbotEmbed.output, 'widget.v2.js');

/** The IIFE is the script the customer's `<script src>` loads, so the bundle defines no module system and
 *  leaves exactly one global behind (`window.ElowenChatbot`), which the widget itself owns and deletes on
 *  `destroy()`. */
await build({
  entryPoints: [entry],
  outfile: bundle,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome100', 'firefox100', 'safari15', 'edge100'],
  minify: true,
  legalComments: 'none',
  charset: 'utf8',
  banner: { js: '/* Elowen chatbot widget v2 — https://elowen.dev */' },
  nodePaths: [join(root, 'node_modules')],
});

const bytes = readFileSync(bundle);
writeFileSync(bundle, `${readFileSync(bundle, 'utf8').trimEnd()}\n`);
console.log(`[build-chatbot-assets] embed-src → embed/widget.v2.js (${Math.round(bytes.byteLength / 1024)} kB)`);