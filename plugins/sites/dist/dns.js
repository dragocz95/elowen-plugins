import { isIP } from 'node:net';
import { strictHostname } from './hostname.js';
const DNS_TARGET_ERROR = 'Sites DNS destination must be one hostname, IPv4 address or IPv6 address, with no scheme, path, port, network prefix, zone or wildcard.';
const NEGATIVE_DNS_CODES = new Set(['ENODATA', 'ENOTFOUND', 'EAI_NONAME']);
const normalizedHost = (value) => value.trim().replace(/\.+$/, '').toLowerCase();
const fqdn = (value) => normalizedHost(value) + '.';
const negativeDnsError = (error) => {
    const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : '';
    return NEGATIVE_DNS_CODES.has(code);
};
const answer = async (query) => {
    try {
        return { values: await query(), error: null };
    }
    catch (error) {
        if (negativeDnsError(error))
            return { values: [], error: null };
        return { values: [], error: error instanceof Error ? error.message : String(error) };
    }
};
/** Canonical address parsing is shared by settings, record rendering and verification. */
function canonicalDnsAddress(value) {
    const candidate = value.trim();
    const family = isIP(candidate);
    if (family === 4)
        return { kind: 'ipv4', value: candidate };
    if (family !== 6)
        return null;
    try {
        const serialized = new URL('http://[' + candidate + ']/').hostname;
        return { kind: 'ipv6', value: serialized.slice(1, -1) };
    }
    catch {
        return null;
    }
}
const addresses = async (resolver, hostname, samples) => {
    const ipv4 = new Set();
    const ipv6 = new Set();
    const errors = [];
    let answered = false;
    for (let sample = 0; sample < samples; sample += 1) {
        const [v4, v6] = await Promise.all([
            answer(() => resolver.resolve4(fqdn(hostname))),
            answer(() => resolver.resolve6(fqdn(hostname))),
        ]);
        for (const value of v4.values) {
            const parsed = canonicalDnsAddress(value);
            if (parsed?.kind === 'ipv4')
                ipv4.add(parsed.value);
        }
        for (const value of v6.values) {
            const parsed = canonicalDnsAddress(value);
            if (parsed?.kind === 'ipv6')
                ipv6.add(parsed.value);
        }
        answered = answered || v4.values.length > 0 || v6.values.length > 0;
        if (v4.error)
            errors.push(v4.error);
        if (v6.error)
            errors.push(v6.error);
    }
    return { ipv4, ipv6, answered, errors };
};
const cnameChain = async (resolver, hostname, expected) => {
    const pending = [hostname];
    const visited = new Set();
    const observed = new Set();
    const errors = [];
    for (let depth = 0; pending.length > 0 && depth < 8; depth += 1) {
        const current = normalizedHost(pending.shift() ?? '');
        if (!current || visited.has(current))
            continue;
        visited.add(current);
        const result = await answer(() => resolver.resolveCname(fqdn(current)));
        if (result.error)
            errors.push(result.error);
        for (const raw of result.values) {
            const target = normalizedHost(raw);
            if (!target)
                continue;
            observed.add(target);
            if (expected !== null && target === expected) {
                return { reachesTarget: true, observed: [...observed], errors };
            }
            if (!visited.has(target))
                pending.push(target);
        }
    }
    return { reachesTarget: false, observed: [...observed], errors };
};
class GatewayDnsTarget {
    kind;
    value;
    resolver;
    constructor(kind, value, resolver) {
        this.kind = kind;
        this.value = value;
        this.resolver = resolver;
    }
    requiredRecord(name) {
        return {
            name,
            type: this.kind === 'hostname' ? 'CNAME' : this.kind === 'ipv4' ? 'A' : 'AAAA',
            value: this.kind === 'hostname' ? this.value + '.' : this.value,
        };
    }
    async recordPlan(hostname) {
        if (hostname.kind === 'subdomain' || this.kind !== 'hostname') {
            return {
                state: 'ready',
                hostname: hostname.ascii,
                kind: hostname.kind,
                delegatedRootWarning: hostname.delegatedRootWarning,
                preferred: [this.requiredRecord(hostname.ascii)],
                fallback: [],
            };
        }
        const resolved = await addresses(this.resolver, this.value, 1);
        if (resolved.errors.length > 0 || !resolved.answered) {
            return {
                state: 'unavailable',
                hostname: hostname.ascii,
                kind: hostname.kind,
                delegatedRootWarning: hostname.delegatedRootWarning,
                preferred: [{ name: hostname.ascii, type: 'ALIAS/ANAME', value: this.value + '.' }],
                fallback: [],
            };
        }
        return {
            state: 'ready',
            hostname: hostname.ascii,
            kind: hostname.kind,
            delegatedRootWarning: hostname.delegatedRootWarning,
            preferred: [{ name: hostname.ascii, type: 'ALIAS/ANAME', value: this.value + '.' }],
            fallback: [
                ...[...resolved.ipv4].map((value) => ({ name: hostname.ascii, type: 'A', value })),
                ...[...resolved.ipv6].map((value) => ({ name: hostname.ascii, type: 'AAAA', value })),
            ],
        };
    }
    /** Verify one exact hostname. Every published A and AAAA answer must belong to this destination. */
    async verifyHostname(hostname, samples = 1) {
        const cname = await cnameChain(this.resolver, hostname, this.kind === 'hostname' ? this.value : null);
        const [observed, allowed] = await Promise.all([
            addresses(this.resolver, hostname, samples),
            this.kind === 'hostname'
                ? addresses(this.resolver, this.value, samples)
                : Promise.resolve({
                    ipv4: new Set(this.kind === 'ipv4' ? [this.value] : []),
                    ipv6: new Set(this.kind === 'ipv6' ? [this.value] : []),
                    answered: true,
                    errors: [],
                }),
        ]);
        const observedTargets = [
            ...cname.observed,
            ...observed.ipv4,
            ...observed.ipv6,
        ].filter((value, index, all) => all.indexOf(value) === index).slice(0, 8);
        if (this.kind === 'hostname' && !allowed.answered) {
            const errors = [...allowed.errors, ...cname.errors, ...observed.errors];
            return {
                state: 'unavailable',
                observedTargets,
                detail: errors[0] ?? 'The configured DNS destination currently has no A or AAAA answer.',
            };
        }
        const wrongAddress = [...observed.ipv4].some((value) => !allowed.ipv4.has(value))
            || [...observed.ipv6].some((value) => !allowed.ipv6.has(value));
        if (wrongAddress)
            return { state: 'misdirected', observedTargets };
        const matchingAddress = [...observed.ipv4].some((value) => allowed.ipv4.has(value))
            || [...observed.ipv6].some((value) => allowed.ipv6.has(value));
        const errors = [...cname.errors, ...observed.errors, ...allowed.errors];
        if (cname.reachesTarget || matchingAddress) {
            return errors.length > 0
                ? { state: 'unavailable', observedTargets, detail: errors[0] }
                : { state: 'ready', observedTargets };
        }
        if (observed.answered || cname.observed.length > 0) {
            return { state: 'misdirected', observedTargets };
        }
        return errors.length > 0
            ? { state: 'unavailable', observedTargets, detail: errors[0] }
            : { state: 'missing', observedTargets };
    }
}
export function resolveGatewayDnsTarget(value, fallbackHostname, resolver) {
    const configured = typeof value === 'string' && value.trim() !== '';
    const candidate = configured ? value.trim() : fallbackHostname?.trim() ?? '';
    if (!candidate)
        return { target: null, error: configured ? DNS_TARGET_ERROR : null };
    const bare = candidate.endsWith('.') ? candidate.slice(0, -1) : candidate;
    const address = canonicalDnsAddress(candidate) ?? canonicalDnsAddress(bare);
    if (address)
        return { target: new GatewayDnsTarget(address.kind, address.value, resolver), error: null };
    const hostname = strictHostname(bare);
    if (hostname)
        return { target: new GatewayDnsTarget('hostname', hostname, resolver), error: null };
    return { target: null, error: DNS_TARGET_ERROR };
}
/** Caches the parsed target until either configured value changes. All consumers receive the same object. */
export class GatewayDnsTargetService {
    deps;
    cacheKey = null;
    cached = null;
    constructor(deps) {
        this.deps = deps;
    }
    current() {
        const configured = this.deps.configured();
        const fallback = this.deps.fallbackHostname();
        const key = JSON.stringify([configured, fallback]);
        if (this.cached && this.cacheKey === key)
            return this.cached;
        this.cacheKey = key;
        this.cached = resolveGatewayDnsTarget(configured, fallback, this.deps.resolver);
        return this.cached;
    }
}
export const ownershipTxtRecord = (hostname, token) => ({
    name: '_elowen-site.' + normalizedHost(hostname),
    type: 'TXT',
    value: 'elowen-site-verification=' + token,
});
export async function verifyOwnershipTxt(hostname, token, resolver) {
    const record = ownershipTxtRecord(hostname, token);
    try {
        const rows = await resolver.resolveTxt(fqdn(record.name));
        const observedValues = [];
        let matches = false;
        for (const chunks of rows) {
            const value = chunks.join('');
            if (value === record.value)
                matches = true;
            if (observedValues.length < 8)
                observedValues.push(value);
        }
        return matches
            ? { state: 'ready', observedValues }
            : { state: 'mismatch', observedValues };
    }
    catch (error) {
        if (negativeDnsError(error))
            return { state: 'missing', observedValues: [] };
        return {
            state: 'unavailable',
            observedValues: [],
            detail: error instanceof Error ? error.message : String(error),
        };
    }
}
