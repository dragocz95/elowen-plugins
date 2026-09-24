import { isIP } from 'node:net';
import { domainToASCII, domainToUnicode } from 'node:url';
import { parse } from 'tldts';

type SiteHostnameKind = 'root' | 'subdomain';

export interface SiteHostname {
  ascii: string;
  unicode: string;
  kind: SiteHostnameKind;
  delegatedRootWarning: boolean;
}

export type SiteHostnameErrorCode = 'invalid_hostname' | 'public_suffix' | 'reserved_hostname';

export class SiteHostnameError extends Error {
  constructor(readonly code: SiteHostnameErrorCode, message: string) {
    super(message);
    this.name = 'SiteHostnameError';
  }
}

export interface ReservedSiteHostnames {
  appHostname?: string | null;
  generatedHostnameBase?: string | null;
  gatewayHostname?: string | null;
  reservedHostnames?: readonly string[];
  ownGeneratedHostname?: string | null;
}

const HOSTNAME_CHARACTERS = /^[a-z0-9.\-\u{80}-\u{10ffff}]+$/iu;
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const invalid = (): never => {
  throw new SiteHostnameError('invalid_hostname', 'Enter one public hostname without a scheme, path, port, wildcard or DNS record prefix.');
};

const canonicalCandidate = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || !HOSTNAME_CHARACTERS.test(trimmed)) return null;
  const bare = trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
  if (!bare || bare.endsWith('.') || isIP(bare) !== 0) return null;
  const ascii = domainToASCII(bare.toLowerCase());
  if (!ascii || ascii.length > 253) return null;
  const labels = ascii.split('.');
  if (labels.length < 2 || labels.some((label) => label.length === 0 || label.length > 63 || !LABEL.test(label))) return null;
  if (/^\d+$/.test(labels.at(-1) ?? '')) return null;
  return ascii;
};

const canonicalReserved = (value: string | null | undefined): string | null =>
  typeof value === 'string' ? canonicalCandidate(value) : null;

/** The strict hostname check behind the Sites DNS destination. Unlike the user-facing candidate this
 *  trims nothing and strips no trailing dot: the destination parser normalizes its input first and a
 *  doubly dotted value must stay refused rather than normalize into a hostname. Null for anything that
 *  is not exactly one dotted hostname; IP addresses never pass (IPv4 ends in a numeric label, IPv6
 *  fails the character class, and the explicit `isIP` refusal covers the rest). */
export function strictHostname(value: string): string | null {
  if (!value || value !== value.trim() || value.endsWith('.')) return null;
  return canonicalCandidate(value);
}

const isReserved = (hostname: string, reserved: ReservedSiteHostnames): boolean => {
  const app = canonicalReserved(reserved.appHostname);
  const generatedBase = canonicalReserved(reserved.generatedHostnameBase);
  const gateway = canonicalReserved(reserved.gatewayHostname);
  const ownGenerated = canonicalReserved(reserved.ownGeneratedHostname);
  if (hostname === app || hostname === gateway || hostname === ownGenerated) return true;
  if (generatedBase && (hostname === generatedBase || hostname.endsWith('.' + generatedBase))) return true;
  return (reserved.reservedHostnames ?? []).some((entry) => canonicalReserved(entry) === hostname);
};

/** The only boundary for a customer-supplied hostname. Stored values are always canonical ASCII. */
export function parseSiteHostname(value: unknown, reserved: ReservedSiteHostnames = {}): SiteHostname {
  if (typeof value !== 'string') return invalid();
  const ascii = canonicalCandidate(value);
  if (ascii === null) return invalid();
  if (ascii === 'localhost' || ascii.endsWith('.local')
    || ascii === 'in-addr.arpa' || ascii.endsWith('.in-addr.arpa')
    || ascii === 'ip6.arpa' || ascii.endsWith('.ip6.arpa')) invalid();

  const parsed = parse(ascii, { allowPrivateDomains: true });
  if (!parsed.domain) {
    throw new SiteHostnameError('public_suffix', 'A public suffix by itself cannot be used as a Site hostname.');
  }
  if (isReserved(ascii, reserved)) {
    throw new SiteHostnameError('reserved_hostname', 'This hostname is reserved by the Elowen instance.');
  }

  const kind: SiteHostnameKind = parsed.domain === ascii ? 'root' : 'subdomain';
  return {
    ascii,
    unicode: domainToUnicode(ascii).toLowerCase(),
    kind,
    delegatedRootWarning: kind === 'subdomain',
  };
}
