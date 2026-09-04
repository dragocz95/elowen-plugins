import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SitesStore, Site } from './store.js';

/** Reserved first segment of every site's own path space. A site's own files can never claim it, so the
 *  sign-in endpoint cannot be shadowed by something the agent published. */
export const RESERVED_PREFIX = '__elowen';

/** Who is asking to open a site. Admin-ness is deliberately not carried here: it is re-derived from the
 *  live account stores by `mayOpen` on every decision, never trusted from the caller's snapshot. */
export interface Viewer {
  userId: number | null;
}

/** The live account/project facts an access decision needs. Passed in rather than read from a captured
 *  context so the decision has exactly one implementation for both the public and the authenticated path. */
export interface AccessDeps {
  accountExists(userId: number): boolean;
  isAdmin(userId: number): boolean;
  canAccessProject(userId: number, projectId: number): boolean;
}

/** May this viewer open this site RIGHT NOW.
 *
 *  Deliberately re-derived on every request instead of being baked into the site session. A session can
 *  only prove who the visitor is; whether that person still has access changes for reasons the session
 *  never sees — the Project was taken away, the account was deleted, the guest list was edited, an
 *  administrator was demoted. Anything cheaper than asking again is a stale answer with a long life. */
export function mayOpen(site: Site, viewer: Viewer, store: SitesStore, deps: AccessDeps): boolean {
  if (site.visibility === 'public') return true;
  const { userId } = viewer;
  if (userId === null) return false;
  if (!deps.accountExists(userId)) return false;
  if (deps.isAdmin(userId)) return true;
  if (userId === site.ownerUserId) return true;
  if (store.isMember(site.id, userId)) return true;
  if (site.visibility === 'authenticated') return true;
  if (site.visibility === 'project') return deps.canAccessProject(userId, site.projectId);
  return false;
}

/** Whether an account may create and publish sites at all. Viewing is governed by the site itself. */
export function mayPublish(userId: number | null, deps: AccessDeps, publishers: 'everyone' | 'admins'): boolean {
  if (userId === null) return false;
  if (!deps.accountExists(userId)) return false;
  return publishers === 'everyone' || deps.isAdmin(userId);
}

export interface SessionPayload {
  /** Account id of the visitor. */
  u: number;
  /** The site's access generation when the session was minted. */
  g: number;
  /** Expiry, epoch milliseconds. */
  e: number;
}

const b64url = (input: Buffer): string => input.toString('base64url');

const mac = (secret: string, body: string): Buffer =>
  createHmac('sha256', secret).update(body).digest();

export function signSession(secret: string, payload: SessionPayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${b64url(mac(secret, body))}`;
}

/** Verify a site session cookie. Returns the payload only when the signature, the shape and the expiry
 *  all hold; every failure answers null so a caller cannot accidentally branch on the reason. */
export function verifySession(secret: string, value: string | undefined, now: number): SessionPayload | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot <= 0 || dot === value.length - 1) return null;
  const body = value.slice(0, dot);
  const provided = Buffer.from(value.slice(dot + 1), 'base64url');
  const expected = mac(secret, body);
  // Equal length is a precondition of timingSafeEqual, and a length mismatch is itself a rejection.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { u, g, e } = parsed as Record<string, unknown>;
  if (!Number.isSafeInteger(u) || !Number.isSafeInteger(g) || !Number.isSafeInteger(e)) return null;
  const payload = { u: u as number, g: g as number, e: e as number };
  return payload.e > now ? payload : null;
}

export const cookieName = (siteId: string): string => `elowen_site_${siteId.replace(/-/g, '')}`;

/** Parse a Cookie header into a map. Duplicate names keep the FIRST value, matching how a browser sends
 *  the most specific path first — a wider cookie cannot displace the site's own. */
export function readCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

export interface MintedTicket {
  token: string;
  tokenHash: string;
}

export function mintTicket(): MintedTicket {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

/** Tickets are stored hashed for the same reason passwords are: a readable database row must not be a
 *  usable credential. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const MAX_RETURN_PATH = 512;

/** Normalise the path a visitor should land on after signing in.
 *
 *  The result is always relative to the site's own root, so it can never redirect off this site. A scheme,
 *  a protocol-relative prefix, a backslash, a NUL, a parent traversal or the reserved endpoint prefix all
 *  collapse to the site root rather than being rejected loudly — the visitor wanted to see the site, and
 *  the safe answer is its front page. */
export function normalizeReturnPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return '';
  if (raw.length > MAX_RETURN_PATH) return '';
  if (raw.includes('\0') || raw.includes('\\')) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return '';
  // A protocol-relative prefix. Stripping the slashes would leave a harmless relative path here, but
  // "//host/…" is written by someone trying to leave, and answering it with the site root says so.
  if (raw.startsWith('//')) return '';
  const trimmed = raw.replace(/^\/+/, '');
  if (trimmed === '') return '';
  const parts = trimmed.split('?');
  const pathPart = parts[0] ?? '';
  // Checked on the DECODED form as well: `..%2f..%2f` passes a literal-segment test and would only be
  // caught later by the serving layer's containment check. A redirect target should not depend on
  // something further down the line refusing it.
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return '';
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return '';
  const segments = [...pathPart.split('/'), ...decoded.split('/')];
  if (segments.some((segment) => segment === '..' || segment === '.')) return '';
  if (segments[0] === RESERVED_PREFIX || decoded.split('/')[0] === RESERVED_PREFIX) return '';
  if (!/^[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(pathPart)) return '';
  const query = parts.slice(1).join('?');
  if (query && !/^[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*$/.test(query)) return pathPart;
  return query ? `${pathPart}?${query}` : pathPart;
}
