import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  hashToken,
  mintVisitorToken,
  newPublicId,
  newSecret,
  newTokenId,
  newVisitorId,
  readAuthorizationToken,
  sameHash,
  verifyVisitorToken,
  type VisitorTokenPayload,
} from '../plugins/chatbot/src/token.js';
import { checkAllowedOrigin, isUsableOrigin, normalizeOrigin, OriginError } from '../plugins/chatbot/src/origin.js';
import {
  isCanonicalUuid,
  isPublicId,
  validateBotCreate,
  validateBotPatch,
  validateOrigins,
  validatePublicBotRequest,
  validateTurnSubmission,
} from '../plugins/chatbot/src/validation.js';
import { conversationChannelId, visitorSource } from '../plugins/chatbot/src/adapter.js';

/** Everything a visitor's authority is made of, checked without a daemon: the signed token, the domain
 *  allowlist, the strict payloads and the conversation key. These are the parts that must be REAL, so they
 *  are also the parts that must be provable without one. */

const SECRET = newSecret();
const NOW = 1_800_000_000_000;

function payload(overrides: Partial<VisitorTokenPayload> = {}): VisitorTokenPayload {
  return {
    v: 1,
    bot: newPublicId(),
    sub: newVisitorId(),
    jti: newTokenId(),
    iat: Math.floor(NOW / 1000),
    exp: Math.floor(NOW / 1000) + 3600,
    ...overrides,
  };
}

/** Re-sign an arbitrary payload, so a test can prove the SHAPE check rather than the signature check. */
function sign(secret: string, value: unknown): string {
  const body = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const signed = `v1.${body}`;
  return `${signed}.${createHmac('sha256', secret).update(signed, 'utf8').digest('base64url')}`;
}

describe('visitor token', () => {
  it('verifies what it minted', () => {
    const issued = payload();
    const token = mintVisitorToken(SECRET, issued);
    const verified = verifyVisitorToken({ secret: SECRET, token, nowMs: NOW });
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.payload).toEqual(issued);
  });

  it('refuses a token whose payload was edited, even with a valid-looking shape', () => {
    const issued = payload();
    const token = mintVisitorToken(SECRET, issued);
    const [, body, signature] = token.split('.') as [string, string, string];
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as VisitorTokenPayload;
    const tampered = Buffer.from(JSON.stringify({ ...decoded, sub: newVisitorId() }), 'utf8').toString('base64url');
    const result = verifyVisitorToken({ secret: SECRET, token: `v1.${tampered}.${signature}`, nowMs: NOW });
    expect(result).toEqual({ ok: false, reason: 'signature' });
  });

  it('refuses a token signed with another key', () => {
    const issued = payload();
    const token = mintVisitorToken(newSecret(), issued);
    expect(verifyVisitorToken({ secret: SECRET, token, nowMs: NOW }).ok).toBe(false);
  });

  it('refuses an expired token and a not-yet-valid one', () => {
    const expired = payload({ iat: Math.floor(NOW / 1000) - 7200, exp: Math.floor(NOW / 1000) - 3600 });
    expect(verifyVisitorToken({ secret: SECRET, token: mintVisitorToken(SECRET, expired), nowMs: NOW }))
      .toEqual({ ok: false, reason: 'expired' });
    const future = payload({ iat: Math.floor(NOW / 1000) + 3600, exp: Math.floor(NOW / 1000) + 7200 });
    expect(verifyVisitorToken({ secret: SECRET, token: mintVisitorToken(SECRET, future), nowMs: NOW }))
      .toEqual({ ok: false, reason: 'not_yet_valid' });
  });

  it('checks the payload SHAPE after the signature, so a well-signed oddity is still refused', () => {
    const extra = { ...payload(), role: 'admin' };
    expect(verifyVisitorToken({ secret: SECRET, token: sign(SECRET, extra), nowMs: NOW }))
      .toEqual({ ok: false, reason: 'shape' });
    expect(verifyVisitorToken({ secret: SECRET, token: sign(SECRET, { v: 2, bot: 'x', sub: 'y', jti: 'z', iat: 1, exp: 2 }), nowMs: NOW }))
      .toEqual({ ok: false, reason: 'shape' });
    // `exp` before `iat` can never describe a token this server minted.
    expect(verifyVisitorToken({ secret: SECRET, token: sign(SECRET, payload({ iat: 100, exp: 50 })), nowMs: NOW }))
      .toEqual({ ok: false, reason: 'shape' });
  });

  it('refuses anything that is not the three-part v1 format', () => {
    for (const bad of ['', 'v1', 'v2.a.b', 'v1..b', 'v1.a.', 'not-a-token']) {
      expect(verifyVisitorToken({ secret: SECRET, token: bad, nowMs: NOW })).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('stores only a digest, and compares digests without short-circuiting', () => {
    const token = mintVisitorToken(SECRET, payload());
    const digest = hashToken(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(sameHash(digest, hashToken(token))).toBe(true);
    expect(sameHash(digest, hashToken(`${token}x`))).toBe(false);
    expect(sameHash(digest, 'ff')).toBe(false);
  });

  it('reads the token from its own authorization scheme and nothing else', () => {
    expect(readAuthorizationToken({ authorization: 'ChatbotVisitor abc.def.ghi' })).toBe('abc.def.ghi');
    expect(readAuthorizationToken({ authorization: 'Bearer abc.def.ghi' })).toBeNull();
    expect(readAuthorizationToken({ authorization: 'ChatbotVisitor' })).toBeNull();
    expect(readAuthorizationToken({ authorization: 'ChatbotVisitor a b' })).toBeNull();
    expect(readAuthorizationToken({})).toBeNull();
  });

  it('generates identifiers that cannot be enumerated', () => {
    expect(newVisitorId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newTokenId()).toMatch(/^[0-9a-f]{32}$/);
    expect(isPublicId(newPublicId())).toBe(true);
    const ids = new Set(Array.from({ length: 64 }, () => newVisitorId()));
    expect(ids.size).toBe(64);
  });
});

describe('allowed domains', () => {
  it('reduces a domain to scheme://host and refuses anything else', () => {
    expect(normalizeOrigin('https://www.example.cz')).toBe('https://www.example.cz');
    expect(normalizeOrigin('https://www.example.cz:8443/')).toBe('https://www.example.cz:8443');
    expect(normalizeOrigin('  https://www.example.cz  ')).toBe('https://www.example.cz');
    for (const bad of ['', 'example.cz', 'ftp://example.cz', 'https://user:pw@example.cz', 'https://example.cz/formular', 'https://example.cz/?a=1', 'https://example.cz/#top']) {
      expect(() => normalizeOrigin(bad), bad).toThrow(OriginError);
    }
  });

  it('allows plain http only for a loopback host', () => {
    expect(isUsableOrigin('https://www.example.cz')).toBe(true);
    expect(isUsableOrigin('http://localhost:3000')).toBe(true);
    expect(isUsableOrigin('http://127.0.0.1:8080')).toBe(true);
    expect(isUsableOrigin('http://www.example.cz')).toBe(false);
  });

  it('matches the request Origin exactly, and refuses a missing one', () => {
    const allowed = ['https://www.example.cz'];
    expect(checkAllowedOrigin('https://www.example.cz', allowed)).toEqual({ ok: true, origin: 'https://www.example.cz' });
    expect(checkAllowedOrigin('https://evil.cz', allowed)).toEqual({ ok: false, reason: 'origin_not_allowed' });
    expect(checkAllowedOrigin('https://www.example.cz.evil.cz', allowed)).toEqual({ ok: false, reason: 'origin_not_allowed' });
    expect(checkAllowedOrigin(undefined, allowed)).toEqual({ ok: false, reason: 'origin_not_allowed' });
    expect(checkAllowedOrigin('  ', allowed)).toEqual({ ok: false, reason: 'origin_not_allowed' });
  });
});

describe('strict payloads', () => {
  const bot = newPublicId();

  const uuid = '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c34';
  const page = { url: 'https://www.example.cz/objednavka', title: 'Objednávka | Example' };
  const turn = (overrides: Record<string, unknown> = {}) => ({ schemaVersion: 2, clientTurnId: uuid, message: 'ahoj', page, ...overrides });

  it('refuses unknown fields instead of ignoring them', () => {
    expect(validatePublicBotRequest({ schemaVersion: 2, bot, origin: 'https://evil.cz' })).toMatchObject({ ok: false });
    expect(validateTurnSubmission(turn({ visitorId: 'x' }))).toMatchObject({ ok: false });
    expect(validateTurnSubmission(turn({ page: { ...page, aria: '' } }))).toMatchObject({ ok: false, error: '"page": unknown field "aria"' });
    expect(validateBotCreate({ chatbotUserId: 3, type: 'chatbot' })).toMatchObject({ ok: false });
    expect(validateBotPatch({ chatbotUserId: 3, expectedUpdatedAt: 'now', displayName: '', prompt: '', origins: [], enabled: true })).toMatchObject({ ok: false });
  });

  it('refuses a schema version it does not implement', () => {
    expect(validatePublicBotRequest({ schemaVersion: 99, bot })).toMatchObject({ ok: false });
    expect(validateTurnSubmission(turn({ schemaVersion: 99 }))).toMatchObject({ ok: false });
  });

  it('requires a real public id and a canonical UUID', () => {
    expect(validatePublicBotRequest({ schemaVersion: 2, bot: 'cbt_nope' })).toMatchObject({ ok: false });
    expect(validatePublicBotRequest({ schemaVersion: 2, bot })).toMatchObject({ ok: true });
    expect(isCanonicalUuid(uuid)).toBe(true);
    expect(isCanonicalUuid('2F1A4C3E-9B7D-4F6A-8C2E-1D5B7A9F0C34')).toBe(false);
    expect(validateTurnSubmission(turn({ clientTurnId: 'nope' }))).toMatchObject({ ok: false });
    expect(validateTurnSubmission(turn())).toEqual({ ok: true, value: { clientTurnId: uuid, message: 'ahoj', page, uploadId: null } });
  });

  it('bounds the message by BYTES and refuses an empty one', () => {
    expect(validateTurnSubmission(turn({ message: '   ' }))).toMatchObject({ ok: false });
    // 1025 two-byte characters is 2050 bytes: over the cap while still SHORT in JavaScript code units, which
    // is the difference between a byte bound and a `length` check.
    expect(validateTurnSubmission(turn({ message: 'ž'.repeat(1025) }))).toMatchObject({ ok: false, error: '"message" is too long' });
    expect(validateTurnSubmission(turn({ message: 'ž'.repeat(1024) }))).toMatchObject({ ok: true });
  });

  it('requires the page a message was written on, apart from the message', () => {
    const { page: _omitted, ...withoutPage } = turn();
    expect(validateTurnSubmission(withoutPage)).toEqual({ ok: false, error: 'missing field "page"' });
    const refused: [string, unknown][] = [
      ['a page that is not an object', 'https://www.example.cz/'],
      ['a page that is null', null],
      ['a page with no title', { url: page.url }],
      ['a page with no address', { title: page.title }],
      ['a title that is not text', { ...page, title: 3 }],
      ['a title past the page-text bound', { ...page, title: 'x'.repeat(121) }],
      ['an address past its bound', { ...page, url: `https://www.example.cz/${'a'.repeat(4096)}` }],
      ['an address carrying a query', { ...page, url: 'https://www.example.cz/objednavka?rc=1234' }],
      ['an address carrying a fragment', { ...page, url: 'https://www.example.cz/objednavka#krok-2' }],
      ['an address carrying credentials', { ...page, url: 'https://jan:heslo@www.example.cz/' }],
      ['an address of another scheme', { ...page, url: 'javascript:alert(1)' }],
      ['an address that is not a URL', { ...page, url: 'objednavka' }],
    ];
    for (const [what, value] of refused) {
      expect(validateTurnSubmission(turn({ page: value })), what).toMatchObject({ ok: false });
    }
    // An empty title is a page that has none, which is a page all the same.
    expect(validateTurnSubmission(turn({ page: { ...page, title: '' } }))).toMatchObject({ ok: true });
    expect(validateTurnSubmission(turn({ page: { ...page, title: 'x'.repeat(120) } }))).toMatchObject({ ok: true });
  });

  it('normalises an allowlist, refuses a wildcard and refuses a path', () => {
    expect(validateOrigins(['https://www.example.cz/', 'https://www.example.cz'])).toEqual({ ok: true, value: ['https://www.example.cz'] });
    expect(validateOrigins(['https://*.example.cz'])).toMatchObject({ ok: false });
    expect(validateOrigins(['https://www.example.cz/x'])).toMatchObject({ ok: false });
    expect(validateOrigins('https://www.example.cz')).toMatchObject({ ok: false });
  });
});

describe('the conversation key', () => {
  it('carries BOTH identities, so neither a repeated visitor nor a repeated chatbot can share a session', () => {
    const visitor = newVisitorId();
    expect(conversationChannelId(7, visitor)).toBe(`7:${visitor}`);
    expect(conversationChannelId(8, visitor)).toBe(`8:${visitor}`);
    expect(conversationChannelId(7, visitor)).not.toBe(conversationChannelId(7, newVisitorId()));
  });

  it('names the chatbot as the acting account and keeps every client-supplied identity out of the source', () => {
    const visitor = newVisitorId();
    const source = visitorSource({ chatbotUserId: 12, visitorId: visitor, displayName: 'Úřad' });
    expect(source.platform).toBe('chatbot');
    expect(source.channelId).toBe(`12:${visitor}`);
    expect(source.access?.actAsUserId).toBe(12);
    expect(source.access?.prompt).toBeUndefined();
    // The sender is the anonymous visitor id this server generated, and nothing about a person is claimed.
    expect(source.userId).toBe(visitor);
    expect(source.userName).toBeUndefined();
    expect(source.verifiedEmail).toBeUndefined();
    // Not a direct chat: a website widget is a room other people can reach, so it must not inherit the
    // "this is the account's own conversation" rules.
    expect(source.direct).toBeUndefined();
  });
});