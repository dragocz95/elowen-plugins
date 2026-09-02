import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { domainToASCII } from 'node:url';
import { isIP } from 'node:net';
export class NavigationPolicyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NavigationPolicyError';
    }
}
const SYSTEM_RESOLVER = {
    resolve: async (hostname) => (await dns.lookup(hostname, { all: true, verbatim: true }))
        .map((entry) => ({ address: entry.address, family: entry.family })),
};
const BLOCKED_PORTS = new Set([22, 25, 111, 135, 137, 138, 139, 445, 2375, 2376, 3306, 5432, 6379, 9200, 11211]);
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal', 'instance-data', 'instance-data.ec2.internal']);
const METADATA_ADDRESSES = new Set(['169.254.169.254', '100.100.100.200', 'fd00:ec2::254']);
const BLOCKED_CIDRS = [
    '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
    '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24',
    '224.0.0.0/4', '240.0.0.0/4', '::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8', '2001:db8::/32',
].map(parseCidr);
function ipv4Value(address) {
    const parts = address.split('.');
    if (parts.length !== 4)
        return null;
    let result = 0n;
    for (const part of parts) {
        const value = Number(part);
        if (!Number.isInteger(value) || value < 0 || value > 255)
            return null;
        result = (result << 8n) | BigInt(value);
    }
    return result;
}
function expandIpv6(address) {
    const normalized = address.toLowerCase().split('%')[0] ?? '';
    const pieces = normalized.split('::');
    if (pieces.length > 2)
        return null;
    const parseSide = (side) => {
        if (!side)
            return [];
        const output = [];
        for (const part of side.split(':')) {
            if (part.includes('.')) {
                const v4 = ipv4Value(part);
                if (v4 === null)
                    return null;
                output.push(Number((v4 >> 16n) & 0xffffn), Number(v4 & 0xffffn));
                continue;
            }
            if (!/^[0-9a-f]{1,4}$/.test(part))
                return null;
            output.push(Number.parseInt(part, 16));
        }
        return output;
    };
    const left = parseSide(pieces[0] ?? '');
    const right = parseSide(pieces[1] ?? '');
    if (!left || !right)
        return null;
    const zeros = pieces.length === 2 ? 8 - left.length - right.length : 0;
    if (zeros < 0 || (pieces.length === 1 && left.length !== 8))
        return null;
    const words = [...left, ...Array.from({ length: zeros }, () => 0), ...right];
    return words.length === 8 ? words : null;
}
function mappedIpv4Address(address) {
    const words = expandIpv6(address);
    if (!words || words.slice(0, 5).some((word) => word !== 0) || words[5] !== 0xffff)
        return null;
    const value = (words[6] << 16) | words[7];
    return `${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}
function ipValue(address) {
    const family = isIP(address);
    if (family === 4) {
        const value = ipv4Value(address);
        return value === null ? null : { family: 4, value };
    }
    if (family === 6) {
        const words = expandIpv6(address);
        if (!words)
            return null;
        return { family: 6, value: words.reduce((value, word) => (value << 16n) | BigInt(word), 0n) };
    }
    return null;
}
function parseCidr(value) {
    const [address = '', bitsText = ''] = value.split('/');
    const parsed = ipValue(address);
    if (!parsed)
        throw new Error(`Invalid CIDR: ${value}`);
    const maxBits = parsed.family === 4 ? 32 : 128;
    const bits = Number(bitsText);
    if (!Number.isInteger(bits) || bits < 0 || bits > maxBits)
        throw new Error(`Invalid CIDR: ${value}`);
    const shift = BigInt(maxBits - bits);
    return { family: parsed.family, bits, network: (parsed.value >> shift) << shift };
}
function inCidr(address, cidr) {
    const parsed = ipValue(address);
    if (!parsed || parsed.family !== cidr.family)
        return false;
    const maxBits = parsed.family === 4 ? 32 : 128;
    const shift = BigInt(maxBits - cidr.bits);
    return ((parsed.value >> shift) << shift) === cidr.network;
}
function normalizedHostname(hostname) {
    const raw = hostname.trim().replace(/\.$/, '').toLowerCase();
    const unwrapped = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
    const mapped = mappedIpv4Address(unwrapped);
    if (mapped)
        return mapped;
    if (isIP(unwrapped))
        return unwrapped;
    const ascii = domainToASCII(unwrapped);
    if (!ascii || ascii.length > 253 || ascii.split('.').some((label) => !label || label.length > 63)) {
        throw new NavigationPolicyError('The destination hostname is invalid.');
    }
    return ascii;
}
class Allowlist {
    hosts = new Set();
    cidrs = [];
    constructor(tokens) {
        for (const raw of tokens) {
            const token = raw.trim().toLowerCase();
            if (!token)
                continue;
            if (token.includes('/')) {
                try {
                    this.cidrs.push(parseCidr(token));
                }
                catch {
                    throw new NavigationPolicyError(`Invalid private-network allowlist entry: ${raw}`);
                }
            }
            else {
                this.hosts.add(normalizedHostname(token));
            }
        }
    }
    permits(hostname, address) {
        return this.hosts.has(hostname) || this.cidrs.some((cidr) => inCidr(address, cidr));
    }
}
export class NavigationPolicy {
    resolver;
    allowlist;
    constructor(tokens, resolver = SYSTEM_RESOLVER) {
        this.resolver = resolver;
        this.allowlist = new Allowlist(tokens);
    }
    validateUrl(value) {
        let url;
        try {
            url = new URL(value);
        }
        catch {
            throw new NavigationPolicyError('The browser destination must be an absolute URL.');
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new NavigationPolicyError('Only http and https destinations are allowed.');
        }
        if (url.username || url.password)
            throw new NavigationPolicyError('Credentials are not allowed in browser URLs.');
        const hostname = normalizedHostname(url.hostname);
        if (BLOCKED_HOSTS.has(hostname) && !this.allowlist.permits(hostname, hostname)) {
            throw new NavigationPolicyError('The destination hostname is blocked by browser network policy.');
        }
        const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
        if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || BLOCKED_PORTS.has(port)) {
            throw new NavigationPolicyError('The destination port is blocked by browser network policy.');
        }
        url.hostname = hostname;
        return url;
    }
    async resolve(value) {
        const url = this.validateUrl(value);
        const hostname = normalizedHostname(url.hostname);
        const literal = ipValue(hostname);
        const addresses = literal ? [{ address: hostname, family: literal.family }] : await this.resolver.resolve(hostname);
        if (addresses.length === 0)
            throw new NavigationPolicyError('The destination hostname did not resolve.');
        const unique = [...new Map(addresses.map((entry) => [entry.address, entry])).values()];
        for (const entry of unique) {
            if (!ipValue(entry.address))
                throw new NavigationPolicyError('The resolver returned an invalid address.');
            const blocked = METADATA_ADDRESSES.has(entry.address.toLowerCase()) || BLOCKED_CIDRS.some((cidr) => inCidr(entry.address, cidr));
            if (blocked && !this.allowlist.permits(hostname, entry.address)) {
                throw new NavigationPolicyError('The destination resolves to a blocked network address.');
            }
        }
        const selected = unique[0];
        return {
            url,
            hostname,
            port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
            address: selected.address,
            family: selected.family,
        };
    }
}
function createPinnedDnsLookup(target) {
    return (hostname, options, callback) => {
        let requested;
        try {
            requested = normalizedHostname(hostname);
        }
        catch (error) {
            callback(error instanceof Error ? error : new Error('Proxy DNS lookup hostname is invalid.'));
            return;
        }
        if (requested !== target.hostname) {
            const error = new Error('Proxy DNS lookup attempted a hostname outside the pinned request.');
            error.code = 'ENOTFOUND';
            callback(error);
            return;
        }
        queueMicrotask(() => {
            const all = !!options && typeof options === 'object' && options.all === true;
            if (all)
                callback(null, [{ address: target.address, family: target.family }]);
            else
                callback(null, target.address, target.family);
        });
    };
}
const loadProxyChain = async () => {
    const moduleName = 'proxy-chain';
    return import(moduleName);
};
/** `proxy-chain` 3.0 forwards the returned `dnsLookup` into its direct handler for HTTP and CONNECT. */
export class DynamicProxyChainAdapter {
    load;
    available = true;
    constructor(load = loadProxyChain) {
        this.load = load;
    }
    async dependencyAvailable() {
        try {
            return typeof (await this.load()).Server === 'function';
        }
        catch {
            return false;
        }
    }
    async createServer(input) {
        const { Server } = await this.load();
        const activeConnections = new Set();
        let rateWindowStartedAt = Date.now();
        let requestCount = 0;
        const server = new Server({
            host: '127.0.0.1',
            port: 0,
            verbose: false,
            prepareRequestFunction: async (request) => {
                if (request.username !== input.username || request.password !== input.password) {
                    return { requestAuthentication: true, failMsg: 'Proxy authentication required.' };
                }
                const now = Date.now();
                if (now - rateWindowStartedAt >= 60_000) {
                    rateWindowStartedAt = now;
                    requestCount = 0;
                }
                requestCount += 1;
                if (requestCount > input.requestsPerMinute)
                    throw new Error('Browser proxy request rate limit exceeded.');
                if (!activeConnections.has(request.connectionId)) {
                    if (activeConnections.size >= input.maxConcurrency)
                        throw new Error('Browser proxy concurrency limit exceeded.');
                    activeConnections.add(request.connectionId);
                }
                const requestHostname = normalizedHostname(request.hostname);
                const host = isIP(requestHostname) === 6 ? `[${requestHostname}]` : requestHostname;
                const protocol = request.isHttp ? 'http:' : 'https:';
                const target = await input.resolve(`${protocol}//${host}:${request.port}/`);
                return {
                    requestAuthentication: false,
                    dnsLookup: createPinnedDnsLookup(target),
                    ipFamily: target.family,
                };
            },
        });
        server.on?.('connectionClosed', ({ connectionId }) => {
            if (connectionId !== undefined)
                activeConnections.delete(connectionId);
        });
        await server.listen();
        return {
            // Chromium ignores credentials embedded in --proxy-server. Puppeteer supplies them separately through
            // Page.authenticate(), keeping the secret out of the process command line and /proc snapshots.
            url: `http://127.0.0.1:${server.port}`,
            close: () => server.close(true),
        };
    }
}
export class EnforcingProxyManager {
    config;
    adapter;
    logger;
    resolver;
    safePinningAvailable;
    leases = new Set();
    constructor(config, adapter, logger, resolver = SYSTEM_RESOLVER) {
        this.config = config;
        this.adapter = adapter;
        this.logger = logger;
        this.resolver = resolver;
        this.safePinningAvailable = adapter.available;
    }
    dependencyAvailable() { return this.adapter.dependencyAvailable(); }
    async open(userId) {
        if (!this.adapter.available || !await this.adapter.dependencyAvailable()) {
            throw new Error('Browser network proxy is unavailable because proxy-chain 3.0 pinned DNS support is not installed.');
        }
        const username = randomBytes(18).toString('base64url');
        const password = randomBytes(24).toString('base64url');
        const policy = new NavigationPolicy(this.config().privateNetworkAllowlist, this.resolver);
        const server = await this.adapter.createServer({
            username,
            password,
            maxConcurrency: this.config().proxyConcurrency,
            requestsPerMinute: this.config().proxyRequestsPerMinute,
            resolve: (url) => policy.resolve(url),
        });
        const lease = {
            url: server.url,
            username,
            password,
            close: async () => {
                this.leases.delete(lease);
                await server.close();
            },
        };
        this.leases.add(lease);
        this.logger.debug?.(`browser proxy opened for user ${userId}`);
        return lease;
    }
    async closeAll() {
        const leases = [...this.leases];
        this.leases.clear();
        await Promise.allSettled(leases.map((lease) => lease.close()));
    }
}
