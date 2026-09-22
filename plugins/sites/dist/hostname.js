import { isIP } from 'node:net';
import { domainToASCII, domainToUnicode } from 'node:url';
import { parse } from 'tldts';
export class SiteHostnameError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'SiteHostnameError';
    }
}
const HOSTNAME_CHARACTERS = /^[a-z0-9.\-\u{80}-\u{10ffff}]+$/iu;
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const invalid = () => {
    throw new SiteHostnameError('invalid_hostname', 'Enter one public hostname without a scheme, path, port, wildcard or DNS record prefix.');
};
const canonicalCandidate = (value) => {
    const trimmed = value.trim();
    if (!trimmed || !HOSTNAME_CHARACTERS.test(trimmed))
        return null;
    const bare = trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
    if (!bare || bare.endsWith('.') || isIP(bare) !== 0)
        return null;
    const ascii = domainToASCII(bare.toLowerCase());
    if (!ascii || ascii.length > 253)
        return null;
    const labels = ascii.split('.');
    if (labels.length < 2 || labels.some((label) => label.length === 0 || label.length > 63 || !LABEL.test(label)))
        return null;
    if (/^\d+$/.test(labels.at(-1) ?? ''))
        return null;
    return ascii;
};
const canonicalReserved = (value) => typeof value === 'string' ? canonicalCandidate(value) : null;
const isReserved = (hostname, reserved) => {
    const app = canonicalReserved(reserved.appHostname);
    const generatedBase = canonicalReserved(reserved.generatedHostnameBase);
    const gateway = canonicalReserved(reserved.gatewayHostname);
    const ownGenerated = canonicalReserved(reserved.ownGeneratedHostname);
    if (hostname === app || hostname === gateway || hostname === ownGenerated)
        return true;
    if (generatedBase && (hostname === generatedBase || hostname.endsWith('.' + generatedBase)))
        return true;
    return (reserved.reservedHostnames ?? []).some((entry) => canonicalReserved(entry) === hostname);
};
/** The only boundary for a customer-supplied hostname. Stored values are always canonical ASCII. */
export function parseSiteHostname(value, reserved = {}) {
    if (typeof value !== 'string')
        return invalid();
    const ascii = canonicalCandidate(value);
    if (ascii === null)
        return invalid();
    if (ascii === 'localhost' || ascii.endsWith('.local')
        || ascii === 'in-addr.arpa' || ascii.endsWith('.in-addr.arpa')
        || ascii === 'ip6.arpa' || ascii.endsWith('.ip6.arpa'))
        invalid();
    const parsed = parse(ascii, { allowPrivateDomains: true });
    if (!parsed.domain) {
        throw new SiteHostnameError('public_suffix', 'A public suffix by itself cannot be used as a Site hostname.');
    }
    if (isReserved(ascii, reserved)) {
        throw new SiteHostnameError('reserved_hostname', 'This hostname is reserved by the Elowen instance.');
    }
    const kind = parsed.domain === ascii ? 'root' : 'subdomain';
    return {
        ascii,
        unicode: domainToUnicode(ascii).toLowerCase(),
        kind,
        delegatedRootWarning: kind === 'subdomain',
    };
}
