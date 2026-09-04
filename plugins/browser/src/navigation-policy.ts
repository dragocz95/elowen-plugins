import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { domainToASCII } from 'node:url';
import { isIP } from 'node:net';
import type { BrowserConfig } from './config.js';
import type { BrowserLogger, BrowserProxyFactory, ProxyLease } from './types.js';

export class NavigationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NavigationPolicyError';
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface HostResolver {
  resolve(hostname: string): Promise<ResolvedAddress[]>;
}

const SYSTEM_RESOLVER: HostResolver = {
  resolve: async (hostname) => (await dns.lookup(hostname, { all: true, verbatim: true }))
    .map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 })),
};

export interface PinnedTarget {
  url: URL;
  hostname: string;
  port: number;
  addresses: readonly ResolvedAddress[];
}

interface ParsedCidr {
  family: 4 | 6;
  bits: number;
  network: bigint;
}

const MAX_PINNED_ADDRESSES_PER_FAMILY = 4;
const BLOCKED_PORTS = new Set([22, 25, 111, 135, 137, 138, 139, 445, 2375, 2376, 3306, 5432, 6379, 9200, 11211]);
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal', 'instance-data', 'instance-data.ec2.internal']);
const METADATA_ADDRESSES = new Set(['169.254.169.254', '100.100.100.200', 'fd00:ec2::254']);
const BLOCKED_CIDRS = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
  '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24',
  '224.0.0.0/4', '240.0.0.0/4', '::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8', '2001:db8::/32',
].map(parseCidr);

function ipv4Value(address: string): bigint | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let result = 0n;
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    result = (result << 8n) | BigInt(value);
  }
  return result;
}

function expandIpv6(address: string): number[] | null {
  const normalized = address.toLowerCase().split('%')[0] ?? '';
  const pieces = normalized.split('::');
  if (pieces.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const output: number[] = [];
    for (const part of side.split(':')) {
      if (part.includes('.')) {
        const v4 = ipv4Value(part);
        if (v4 === null) return null;
        output.push(Number((v4 >> 16n) & 0xffffn), Number(v4 & 0xffffn));
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      output.push(Number.parseInt(part, 16));
    }
    return output;
  };
  const left = parseSide(pieces[0] ?? '');
  const right = parseSide(pieces[1] ?? '');
  if (!left || !right) return null;
  const zeros = pieces.length === 2 ? 8 - left.length - right.length : 0;
  if (zeros < 0 || (pieces.length === 1 && left.length !== 8)) return null;
  const words = [...left, ...Array.from({ length: zeros }, () => 0), ...right];
  return words.length === 8 ? words : null;
}

function mappedIpv4Address(address: string): string | null {
  const words = expandIpv6(address);
  if (!words || words.slice(0, 5).some((word) => word !== 0) || words[5] !== 0xffff) return null;
  const value = (words[6]! << 16) | words[7]!;
  return `${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}

function ipValue(address: string): { family: 4 | 6; value: bigint } | null {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Value(address);
    return value === null ? null : { family: 4, value };
  }
  if (family === 6) {
    const words = expandIpv6(address);
    if (!words) return null;
    return { family: 6, value: words.reduce((value, word) => (value << 16n) | BigInt(word), 0n) };
  }
  return null;
}

function parseCidr(value: string): ParsedCidr {
  const [address = '', bitsText = ''] = value.split('/');
  const parsed = ipValue(address);
  if (!parsed) throw new Error(`Invalid CIDR: ${value}`);
  const maxBits = parsed.family === 4 ? 32 : 128;
  const bits = Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > maxBits) throw new Error(`Invalid CIDR: ${value}`);
  const shift = BigInt(maxBits - bits);
  return { family: parsed.family, bits, network: (parsed.value >> shift) << shift };
}

function inCidr(address: string, cidr: ParsedCidr): boolean {
  const parsed = ipValue(address);
  if (!parsed || parsed.family !== cidr.family) return false;
  const maxBits = parsed.family === 4 ? 32 : 128;
  const shift = BigInt(maxBits - cidr.bits);
  return ((parsed.value >> shift) << shift) === cidr.network;
}

function normalizedHostname(hostname: string): string {
  const raw = hostname.trim().replace(/\.$/, '').toLowerCase();
  const unwrapped = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  const mapped = mappedIpv4Address(unwrapped);
  if (mapped) return mapped;
  if (isIP(unwrapped)) return unwrapped;
  const ascii = domainToASCII(unwrapped);
  if (!ascii || ascii.length > 253 || ascii.split('.').some((label) => !label || label.length > 63)) {
    throw new NavigationPolicyError('The destination hostname is invalid.');
  }
  return ascii;
}

class Allowlist {
  private readonly hosts = new Set<string>();
  private readonly cidrs: ParsedCidr[] = [];

  constructor(tokens: readonly string[]) {
    for (const raw of tokens) {
      const token = raw.trim().toLowerCase();
      if (!token) continue;
      if (token.includes('/')) {
        try { this.cidrs.push(parseCidr(token)); }
        catch { throw new NavigationPolicyError(`Invalid private-network allowlist entry: ${raw}`); }
      } else {
        this.hosts.add(normalizedHostname(token));
      }
    }
  }

  permits(hostname: string, address: string): boolean {
    return this.hosts.has(hostname) || this.cidrs.some((cidr) => inCidr(address, cidr));
  }
}

export class NavigationPolicy {
  private readonly allowlist: Allowlist;

  constructor(tokens: readonly string[], private readonly resolver: HostResolver = SYSTEM_RESOLVER) {
    this.allowlist = new Allowlist(tokens);
  }

  validateUrl(value: string): URL {
    let url: URL;
    try { url = new URL(value); }
    catch { throw new NavigationPolicyError('The browser destination must be an absolute URL.'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new NavigationPolicyError('Only http and https destinations are allowed.');
    }
    if (url.username || url.password) throw new NavigationPolicyError('Credentials are not allowed in browser URLs.');
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

  async resolve(value: string): Promise<PinnedTarget> {
    const url = this.validateUrl(value);
    const hostname = normalizedHostname(url.hostname);
    const literal = ipValue(hostname);
    const addresses = literal ? [{ address: hostname, family: literal.family }] : await this.resolver.resolve(hostname);
    if (addresses.length === 0) throw new NavigationPolicyError('The destination hostname did not resolve.');
    const unique = new Map<string, ResolvedAddress>();
    for (const entry of addresses) {
      const address = mappedIpv4Address(entry.address) ?? entry.address.toLowerCase();
      const parsed = ipValue(address);
      if (!parsed) throw new NavigationPolicyError('The resolver returned an invalid address.');
      if (unique.has(address)) continue;
      const blocked = METADATA_ADDRESSES.has(address) || BLOCKED_CIDRS.some((cidr) => inCidr(address, cidr));
      if (blocked && !this.allowlist.permits(hostname, address)) {
        throw new NavigationPolicyError('The destination resolves to a blocked network address.');
      }
      unique.set(address, { address, family: parsed.family });
    }
    const validated = [...unique.values()];
    const counts = new Map<4 | 6, number>([[4, 0], [6, 0]]);
    const pinned = validated.filter((entry) => {
      const count = counts.get(entry.family) ?? 0;
      if (count >= MAX_PINNED_ADDRESSES_PER_FAMILY) return false;
      counts.set(entry.family, count + 1);
      return true;
    });
    return {
      url,
      hostname,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      addresses: pinned.map((entry) => ({ ...entry })),
    };
  }
}

type PinnedLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address?: string | ResolvedAddress[],
  family?: number,
) => void;

type PinnedDnsLookup = (hostname: string, options: unknown, callback: PinnedLookupCallback) => void;

function createPinnedDnsLookup(target: PinnedTarget): PinnedDnsLookup {
  return (hostname, options, callback) => {
    let requested: string;
    try { requested = normalizedHostname(hostname); }
    catch (error) {
      callback(error instanceof Error ? error : new Error('Proxy DNS lookup hostname is invalid.'));
      return;
    }
    if (requested !== target.hostname) {
      const error = new Error('Proxy DNS lookup attempted a hostname outside the pinned request.') as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      callback(error);
      return;
    }
    queueMicrotask(() => {
      const lookupOptions = options && typeof options === 'object' ? options as { all?: unknown; family?: unknown } : {};
      const family = lookupOptions.family === 4 || lookupOptions.family === 6 ? lookupOptions.family : null;
      const candidates = family ? target.addresses.filter((entry) => entry.family === family) : target.addresses;
      if (candidates.length === 0) {
        const error = new Error('Proxy DNS lookup found no approved address for the requested family.') as NodeJS.ErrnoException;
        error.code = 'ENOTFOUND';
        callback(error);
        return;
      }
      if (lookupOptions.all === true) callback(null, candidates.map((entry) => ({ ...entry })));
      else callback(null, candidates[0]!.address, candidates[0]!.family);
    });
  };
}

export interface PinnedProxyServer {
  url: string;
  close(): Promise<void>;
}

/** Why the proxy turned a request away. Chrome renders every one of these as the same
 *  `ERR_TUNNEL_CONNECTION_FAILED`, so this is the only place the real reason can still be recorded. */
export type ProxyRejectionReason = 'auth' | 'rate_limit' | 'concurrency_limit' | 'policy';

export interface ProxyChainPinnedAdapter {
  readonly available: boolean;
  dependencyAvailable(): Promise<boolean>;
  createServer(input: {
    username: string;
    password: string;
    maxConcurrency: number;
    requestsPerMinute: number;
    resolve(url: string): Promise<PinnedTarget>;
    onRejected?(reason: ProxyRejectionReason, host: string, detail?: string): void;
  }): Promise<PinnedProxyServer>;
}

export interface ProxyChainPrepareRequest {
  username?: string;
  password?: string;
  hostname: string;
  port: number;
  isHttp: boolean;
  connectionId: string | number;
}

export interface ProxyChainPrepareResult {
  requestAuthentication?: boolean;
  failMsg?: string;
  dnsLookup?: PinnedDnsLookup;
  ipFamily?: 4 | 6;
}

export interface ProxyChainServerLike {
  port: number;
  listen(): Promise<void>;
  close(closeConnections?: boolean): Promise<void>;
  on?(event: string, listener: (data: { connectionId?: string | number }) => void): void;
}

interface ProxyChainModuleLike {
  Server: new (options: {
    host: string;
    port: number;
    verbose: boolean;
    prepareRequestFunction(input: ProxyChainPrepareRequest): Promise<ProxyChainPrepareResult>;
  }) => ProxyChainServerLike;
}

type ProxyChainLoader = () => Promise<ProxyChainModuleLike>;

const loadProxyChain: ProxyChainLoader = async () => {
  const moduleName = 'proxy-chain';
  return import(moduleName) as Promise<ProxyChainModuleLike>;
};

/** `proxy-chain` 3.0 forwards the returned `dnsLookup` into its direct handler for HTTP and CONNECT. */
export class DynamicProxyChainAdapter implements ProxyChainPinnedAdapter {
  readonly available = true;

  constructor(private readonly load: ProxyChainLoader = loadProxyChain) {}

  async dependencyAvailable(): Promise<boolean> {
    try { return typeof (await this.load()).Server === 'function'; }
    catch { return false; }
  }

  async createServer(input: {
    username: string;
    password: string;
    maxConcurrency: number;
    requestsPerMinute: number;
    resolve(url: string): Promise<PinnedTarget>;
    onRejected?(reason: ProxyRejectionReason, host: string, detail?: string): void;
  }): Promise<PinnedProxyServer> {
    const { Server } = await this.load();
    // `connectionId` is proxy-chain's per-SOCKET counter, and the same number comes back on
    // `connectionClosed`, so an entry is added and removed exactly once per socket.
    const activeConnections = new Set<string | number>();
    let rateWindowStartedAt = Date.now();
    let requestCount = 0;
    const reject = (reason: ProxyRejectionReason, host: string, detail?: string): void => {
      try { input.onRejected?.(reason, host, detail); }
      catch { /* reporting must never break the request path */ }
    };
    const server = new Server({
      host: '127.0.0.1',
      port: 0,
      verbose: false,
      prepareRequestFunction: async (request) => {
        const rawHost = `${request.hostname}:${request.port}`;
        if (request.username !== input.username || request.password !== input.password) {
          reject('auth', rawHost);
          return { requestAuthentication: true, failMsg: 'Proxy authentication required.' };
        }
        const now = Date.now();
        if (now - rateWindowStartedAt >= 60_000) {
          rateWindowStartedAt = now;
          requestCount = 0;
        }
        requestCount += 1;
        if (requestCount > input.requestsPerMinute) {
          reject('rate_limit', rawHost, `${requestCount} requests this minute over a limit of ${input.requestsPerMinute}`);
          throw new Error('Browser proxy request rate limit exceeded.');
        }
        if (!activeConnections.has(request.connectionId)) {
          if (activeConnections.size >= input.maxConcurrency) {
            reject('concurrency_limit', rawHost, `${activeConnections.size} open connections at a limit of ${input.maxConcurrency}`);
            throw new Error('Browser proxy concurrency limit exceeded.');
          }
          activeConnections.add(request.connectionId);
        }
        try {
          const requestHostname = normalizedHostname(request.hostname);
          const host = isIP(requestHostname) === 6 ? `[${requestHostname}]` : requestHostname;
          const protocol = request.isHttp ? 'http:' : 'https:';
          const target = await input.resolve(`${protocol}//${host}:${request.port}/`);
          return {
            requestAuthentication: false,
            dnsLookup: createPinnedDnsLookup(target),
          };
        } catch (error) {
          reject('policy', rawHost, error instanceof Error ? error.message : String(error));
          throw error;
        }
      },
    });
    server.on?.('connectionClosed', ({ connectionId }) => {
      if (connectionId !== undefined) activeConnections.delete(connectionId);
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

/** One warn line per reason per minute, per account. A page that trips the concurrency limit trips it on
 *  dozens of images at once, so logging every rejection would bury the first — and the first is the one
 *  that says what happened. */
const REJECTION_LOG_WINDOW_MS = 60_000;

export class EnforcingProxyManager implements BrowserProxyFactory {
  readonly safePinningAvailable: boolean;
  private readonly leases = new Set<ProxyLease>();
  private readonly rejectionLogs = new Map<string, { loggedAt: number; suppressed: number }>();

  constructor(
    private readonly config: () => BrowserConfig,
    private readonly adapter: ProxyChainPinnedAdapter,
    private readonly logger: BrowserLogger,
    private readonly resolver: HostResolver = SYSTEM_RESOLVER,
  ) {
    this.safePinningAvailable = adapter.available;
  }

  dependencyAvailable(): Promise<boolean> { return this.adapter.dependencyAvailable(); }

  async open(userId: number): Promise<ProxyLease> {
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
      onRejected: (reason, host, detail) => this.logRejection(userId, reason, host, detail),
    });
    const lease: ProxyLease = {
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

  async closeAll(): Promise<void> {
    const leases = [...this.leases];
    this.leases.clear();
    this.rejectionLogs.clear();
    await Promise.allSettled(leases.map((lease) => lease.close()));
  }

  /** Say why the proxy refused, because Chrome will not. Every rejection here reaches the page as a bare
   *  `ERR_TUNNEL_CONNECTION_FAILED` — no host, no cause — so without this line a blocked address and an
   *  exhausted connection budget are indistinguishable from the outside. */
  private logRejection(userId: number, reason: ProxyRejectionReason, host: string, detail?: string): void {
    const key = `${userId}:${reason}`;
    const now = Date.now();
    const previous = this.rejectionLogs.get(key);
    if (previous && now - previous.loggedAt < REJECTION_LOG_WINDOW_MS) {
      previous.suppressed += 1;
      return;
    }
    const suppressed = previous?.suppressed ?? 0;
    this.rejectionLogs.set(key, { loggedAt: now, suppressed: 0 });
    const also = suppressed > 0 ? ` (${suppressed} more in the last minute)` : '';
    const because = detail ? `: ${detail}` : '';
    this.logger.warn(`browser proxy refused ${host} for user ${userId} [${reason}]${because}${also}`);
  }
}
