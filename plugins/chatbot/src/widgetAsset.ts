import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** The widget script a customer pastes into their own website.
 *
 *  The asset is read from the plugin's OWN directory (`plugins/chatbot/embed/widget.v1.js`, committed by
 *  the repository's build and drift-checked there), resolved against this module's URL rather than any
 *  configurable path: a deployment that could point the plugin at a different file could serve a customer
 *  a bundle nobody reviewed. The daemon imports the plugin entry with a cache-busting query, so a plugin
 *  reload gives this module a fresh read; within one process the bytes and their hash are read once.
 *
 *  The served name is `v1/widget.js` while the file is `widget.v1.js`: the URL the customer pasted stays
 *  stable across compatible fixes, and the file name carries the protocol version the bytes speak. A
 *  breaking change ships as a `v2` mount and a new snippet, never as two shapes in one handler. */

/** The built asset, as an answer to one request. */
export interface WidgetAsset {
  /** The exact bytes to serve. */
  body: string;
  /** Strong validator over those bytes. */
  etag: string;
}

/** How long a browser may reuse the script without asking again.
 *
 *  Deliberately short and `must-revalidate` rather than the immutable caching a hashed asset usually gets:
 *  the customer's snippet carries no build hash, and a customer cannot be asked to edit their site because
 *  the panel had a bug. Five minutes bounds how long a fix waits behind a cache while still keeping the
 *  bytes off the wire in the common case, because an unchanged asset answers `304` and the browser keeps
 *  what it holds. */
export const WIDGET_CACHE_CONTROL = 'public, max-age=300, must-revalidate';

/** The URL the repository's build writes the bundle to, resolved against the compiled module. From
 *  `dist/widgetAsset.js` and from `src/widgetAsset.ts` alike this lands on the plugin's `embed/`. */
const WIDGET_ASSET_URL = new URL('../embed/widget.v1.js', import.meta.url);

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
