import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { VISITOR_AUTHORIZATION_SCHEME } from './publicContract.js';
/** Anonymous visitors carry a credential the SERVER issued. A visitor id guessed, leaked or typed by a
 *  client is worth nothing on its own: authority is the signature over the id, the chatbot it was issued
 *  for and its expiry, and the database row that still records it as live. */
/** Instance-secret key holding the 256-bit signing key. It is created on the first boot reconcile, is
 *  never written to configuration, never returned in a response and never logged. */
export const TOKEN_SECRET_KEY = 'visitor-token-hmac-v1';
/** Wire prefix of the token format. A new format gets a new prefix rather than a reinterpretation of an
 *  existing one. */
const TOKEN_PREFIX = 'v1';
/** 128 bits of cryptographic randomness: the visitor identifier and the token identifier both come from
 *  here, so neither can be enumerated. */
const RANDOM_BYTES = 16;
export function newSecret() {
    return randomBytes(32).toString('base64url');
}
/** The shape of every visitor id {@link newVisitorId} issues: the lowercase hex spelling of
 *  {@link RANDOM_BYTES}. */
const VISITOR_ID_PATTERN = new RegExp(`^[0-9a-f]{${RANDOM_BYTES * 2}}$`);
export function isVisitorId(value) {
    return VISITOR_ID_PATTERN.test(value);
}
export function newVisitorId() {
    return randomBytes(RANDOM_BYTES).toString('hex');
}
/** The chatbot's public identifier, as it appears in an embed snippet and in a visitor token. It is an
 *  identifier and not a secret, but it is still generated HERE so nobody can choose one that reads as
 *  another site's chatbot. */
export function newPublicId() {
    return `cbt_${randomBytes(12).toString('hex')}`;
}
export function newTokenId() {
    return randomBytes(RANDOM_BYTES).toString('hex');
}
/** SHA-256 of the whole token, hex. Only this is stored, so a database read yields no usable credential. */
export function hashToken(token) {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}
const base64url = (value) => value.toString('base64url');
const signatureOf = (secret, signed) => createHmac('sha256', secret).update(signed, 'utf8').digest();
export function mintVisitorToken(secret, payload) {
    const encoded = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
    const signed = `${TOKEN_PREFIX}.${encoded}`;
    return `${signed}.${base64url(signatureOf(secret, signed))}`;
}
const isPositiveInt = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
/** Verify a token. The order is deliberate and must stay: the SIGNATURE is checked first, in constant
 *  time, so nothing an attacker wrote is parsed before it has been proven to be ours; only then the
 *  payload shape, then its lifetime, then the binding to the chatbot the request addressed. Database
 *  state (the row's hash and revocation) is the caller's next step. */
export function verifyVisitorToken(input) {
    const parts = input.token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX || parts[1] === '' || parts[2] === '')
        return { ok: false, reason: 'malformed' };
    const [, encoded, providedSignature] = parts;
    const expected = signatureOf(input.secret, `${TOKEN_PREFIX}.${encoded}`);
    let provided;
    try {
        provided = Buffer.from(providedSignature, 'base64url');
    }
    catch {
        return { ok: false, reason: 'malformed' };
    }
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
        return { ok: false, reason: 'signature' };
    let parsed;
    try {
        parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    }
    catch {
        return { ok: false, reason: 'shape' };
    }
    if (!isVisitorTokenPayload(parsed))
        return { ok: false, reason: 'shape' };
    const now = Math.floor(input.nowMs / 1000);
    if (parsed.exp <= now)
        return { ok: false, reason: 'expired' };
    // A token that claims to have been issued in the future cannot be one this server minted, unless the
    // clock moved backwards; either way it is not honoured.
    if (parsed.iat > now + CLOCK_SKEW_SECONDS)
        return { ok: false, reason: 'not_yet_valid' };
    if (input.expectedBot !== undefined && parsed.bot !== input.expectedBot)
        return { ok: false, reason: 'bot_mismatch' };
    return { ok: true, payload: parsed };
}
/** Tolerated clock skew when judging `iat`, in seconds. Local clock jumps must not invalidate tokens
 *  that were issued moments ago by another process on the same host. */
const CLOCK_SKEW_SECONDS = 60;
function isVisitorTokenPayload(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const candidate = value;
    if (Object.keys(candidate).length !== 6)
        return false;
    return candidate.v === 1
        && typeof candidate.bot === 'string' && candidate.bot !== ''
        && typeof candidate.sub === 'string' && candidate.sub !== ''
        && typeof candidate.jti === 'string' && candidate.jti !== ''
        && isPositiveInt(candidate.iat)
        && isPositiveInt(candidate.exp)
        && candidate.exp > candidate.iat;
}
/** Compare two hex digests without leaking where they differ. A length mismatch is itself not secret. */
export function sameHash(a, b) {
    if (a.length !== b.length)
        return false;
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
/** The `Authorization` value a widget sends. The scheme is its own, so this credential can never be
 *  mistaken for a bearer token of another surface. */
export function readAuthorizationToken(headers) {
    const raw = headers.authorization ?? headers.Authorization;
    if (typeof raw !== 'string')
        return null;
    const [scheme, value, ...rest] = raw.trim().split(/\s+/);
    if (rest.length > 0 || scheme !== VISITOR_AUTHORIZATION_SCHEME || !value)
        return null;
    return value;
}
