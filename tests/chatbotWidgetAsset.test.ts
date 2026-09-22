// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { WIDGET_CACHE_CONTROL, matchesEtag, widgetAsset, widgetAssetHeaders } from '../plugins/chatbot/src/widgetAsset.js';
import { WIDGET_ASSET_NAME, PUBLIC_SCHEMA_VERSION } from '../plugins/chatbot/src/publicContract.js';
import { createChatbotHost, publicRequest, registerBot, type ChatbotHost } from './helpers/chatbotHost.js';

/** The script a customer pastes into their website, and the two things that must hold about it: it is
 *  served to a page that has none of the things this daemon's own clients have, and it can never reach a
 *  model provider on its own. */

const pluginRoot = fileURLToPath(new URL('../plugins/chatbot', import.meta.url));
const assetPath = join(pluginRoot, 'embed', 'widget.v2.js');

let host: ChatbotHost;
beforeEach(() => {
  host = createChatbotHost();
  registerBot(host);
});

describe('the served widget', () => {
  it('answers a script tag that carries no visitor token, no Origin header and no trusted network origin', async () => {
    // This is the whole point of serving it before the gates: a `<script src>` from a customer's page has no
    // Origin, no token and no visitor behind it, and refusing it would mean the widget never loads anywhere.
    const answer = await host.handler(publicRequest({
      method: 'GET',
      path: WIDGET_ASSET_NAME,
      headers: {},
      origin: null,
    }));
    expect(answer.status).toBe(200);
    expect(answer.headers?.['content-type']).toBe('application/javascript; charset=utf-8');
    expect(answer.headers?.['cache-control']).toBe(WIDGET_CACHE_CONTROL);
    expect(answer.body).toBe(readFileSync(assetPath, 'utf8'));
  });

  it('answers a revalidation with the bytes it already holds, and nothing else', async () => {
    const asset = widgetAsset();
    const revalidated = await host.handler(publicRequest({
      method: 'GET',
      path: WIDGET_ASSET_NAME,
      headers: { 'if-none-match': asset.etag },
      origin: null,
    }));
    expect(revalidated.status).toBe(304);
    expect(revalidated.body).toBeUndefined();
    expect(revalidated.headers?.etag).toBe(asset.etag);
    expect(revalidated.headers?.['cache-control']).toBe('public, no-cache, must-revalidate');

    const changed = await host.handler(publicRequest({
      method: 'GET',
      path: WIDGET_ASSET_NAME,
      headers: { 'if-none-match': '"a-different-build"' },
      origin: null,
    }));
    expect(changed.status).toBe(200);
  });

  it('identifies the bytes it serves by what they are, so a fix reaches visitors without a customer editing their site', () => {
    const asset = widgetAsset();
    const expected = createHash('sha256').update(asset.body, 'utf8').digest('hex').slice(0, 32);
    expect(asset.etag).toBe(`"${expected}"`);
    // The stable snippet must ask on each load but retain the body for a cheap 304 response.
    expect(WIDGET_CACHE_CONTROL).toBe('public, no-cache, must-revalidate');
    expect(WIDGET_CACHE_CONTROL).toContain('must-revalidate');
    expect(matchesEtag(`"other", ${asset.etag}`, asset.etag)).toBe(true);
    expect(matchesEtag(undefined, asset.etag)).toBe(false);
    expect(matchesEtag('*', asset.etag)).toBe(true);
    expect(matchesEtag('W/"something-else"', asset.etag)).toBe(false);
    expect(widgetAssetHeaders(asset.etag)['content-type']).toBe('application/javascript; charset=utf-8');
  });

  it('serves the version of the protocol its own name claims', () => {
    expect(WIDGET_ASSET_NAME).toBe('widget.js');
    expect(PUBLIC_SCHEMA_VERSION).toBe(2);
    const source = readFileSync(assetPath, 'utf8');
    // The bundle is the widget, not a stub: it carries the global the site uses and the mount it talks to.
    expect(source).toContain('ElowenChatbot');
    expect(source.length).toBeGreaterThan(100_000);
  });

  it('cannot reach a model provider, because the sources may not import one', () => {
    // A widget runs on a stranger's page. The page-action half it uses is the DETERMINISTIC one
    // (`@page-agent/page-controller`); the same project's model-driven packages are what must never be
    // pulled in, so the import list of the widget's own sources is asserted rather than trusted.
    const allowed = new Set(['deep-chat', '@page-agent/page-controller', 'ivya/aria']);
    const files = readdirSync(join(pluginRoot, 'embed-src')).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(4);
    for (const file of files) {
      const source = readFileSync(join(pluginRoot, 'embed-src', file), 'utf8');
      for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
        const specifier = match[1]!;
        if (specifier.startsWith('.')) continue;
        expect(allowed.has(specifier), `${file} imports ${specifier}`).toBe(true);
      }
    }
    // And the built bundle carries none of the model-driven half. (Deep-chat's own source does name provider
    // hosts in service definitions this widget never configures — which is why the browser check watches the
    // network for real rather than trusting a string scan.)
    const bundle = readFileSync(assetPath, 'utf8');
    expect(bundle).not.toContain('@page-agent/core');
    expect(bundle).not.toContain('@page-agent/llms');
    expect(bundle).not.toContain('apiKey');
  });
});
