import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PUBLIC_SCHEMA_VERSION } from './publicContract.js';

/** The widget script a customer pastes into their own website.
 *
 *  The asset is read from the plugin's OWN directory (`plugins/chatbot/embed/widget.v2.js`, committed by
 *  the repository's build and drift-checked there), resolved against this module's URL rather than any
 *  configurable path: a deployment that could point the plugin at a different file could serve a customer
 *  a bundle nobody reviewed. The daemon imports the plugin entry with a cache-busting query, so a plugin
 *  reload gives this module a fresh read; within one process the bytes and their hash are read once.
 *
 *  The served name is `v2/widget.js` while the file is `widget.v2.js`: the URL the customer pasted stays
 *  stable across compatible fixes, and the file name carries the protocol version the bytes speak. A
 *  breaking change ships as a `v2` mount and a new snippet, never as two shapes in one handler. */

/** The built asset, as an answer to one request. */
export interface WidgetAsset {
  /** The exact bytes to serve. */
  body: string;
  /** Strong validator over those bytes. */
  etag: string;
}

/** The stable embed URL must revalidate on every load. `no-cache` permits storing the bytes, unlike
 *  `no-store`: an unchanged strong ETag returns a bodyless 304, while a new build downloads once.
 *  Customers do not need to regenerate their snippet for compatible fixes. */
export const WIDGET_CACHE_CONTROL = 'public, no-cache, must-revalidate';

/** The URL the repository's build writes the bundle to, resolved against the compiled module. From
 *  `dist/widgetAsset.js` and from `src/widgetAsset.ts` alike this lands on the plugin's `embed/`. */
const WIDGET_ASSET_URL = new URL(`../embed/widget.v${PUBLIC_SCHEMA_VERSION}.js`, import.meta.url);

let cached: WidgetAsset | null = null;

/** Read the built bundle. A missing or empty asset is an error rather than an empty script: a customer
 *  whose page loads nothing can never be told why, and a silently empty widget looks like a working one. */
export function widgetAsset(): WidgetAsset {
  if (cached) return cached;
  let body: string;
  try {
    body = readFileSync(WIDGET_ASSET_URL, 'utf8');
  } catch (error) {
    throw new Error(`chatbot: the widget asset ${WIDGET_ASSET_URL.pathname} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (body.trim() === '') throw new Error(`chatbot: the widget asset ${WIDGET_ASSET_URL.pathname} is empty`);
  cached = { body, etag: `"${createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 32)}"` };
  return cached;
}

/** Whether the caller already holds these exact bytes. `If-None-Match` is a list, because a browser that
 *  holds more than one validator sends them all. */
export function matchesEtag(header: string | undefined, etag: string): boolean {
  if (typeof header !== 'string' || header.trim() === '') return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((candidate) => candidate.trim() === etag);
}

/** The answer headers for the asset, on a first fetch and on a revalidation alike. No CORS header appears
 *  here: a classic `<script src>` is not a CORS request, the asset carries nothing private, and answering
 *  a cross-origin response with an echoed Origin would only make this endpoint look like one that grants
 *  something by origin. */
export function widgetAssetHeaders(etag: string): Record<string, string> {
  return {
    'content-type': 'application/javascript; charset=utf-8',
    'cache-control': WIDGET_CACHE_CONTROL,
    etag,
  };
}