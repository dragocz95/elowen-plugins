import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import type { SiteHostname } from './hostname.js';

const DNS_TARGET_ERROR = 'Sites DNS destination must be one hostname, IPv4 address or IPv6 address, with no scheme, path, port, network prefix, zone or wildcard.';
const DNS_NAME_CHARACTERS = /^[a-z0-9.\-\u{80}-\u{10ffff}]+$/iu;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const NEGATIVE_DNS_CODES = new Set(['ENODATA', 'ENOTFOUND', 'EAI_NONAME']);

export interface TrafficDnsResolver {
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}

export interface OwnershipDnsResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
}

type DnsTrafficState = 'ready' | 'missing' | 'misdirected' | 'unavailable';

interface DnsTrafficObservation {
  state: DnsTrafficState;
  observedTargets: string[];
  detail?: string;
}

type DirectDnsRecord = {
  name: string;
  type: 'A' | 'AAAA' | 'CNAME';
  value: string;
};

export type DnsRecord = DirectDnsRecord | {
  name: string;
  type: 'ALIAS/ANAME';
  value: string;
};

export interface DnsRecordPlan {
  state: 'ready' | 'unavailable';
  hostname: string;
  kind: SiteHostname['kind'];
  delegatedRootWarning: boolean;
  preferred: DnsRecord[];
  fallback: DnsRecord[];
  detail?: string;
}

type DnsAnswer = { values: string[]; error: string | null };
type AddressAnswers = {
  ipv4: Set<string>;
  ipv6: Set<string>;
  answered: boolean;
  errors: string[];
};

const normalizedHost = (value: string): string => value.trim().replace(/\.+$/, '').toLowerCase();
const fqdn = (value: string): string => normalizedHost(value) + '.';

const negativeDnsError = (error: unknown): boolean => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  return NEGATIVE_DNS_CODES.has(code);
};

const answer = async (query: () => Promise<string[]>): Promise<DnsAnswer> => {
  try {
    return { values: await query(), error: null };
  } catch (error) {
    if (negativeDnsError(error)) return { values: [], error: null };
    return { values: [], error: error instanceof Error ? error.message : String(error) };
  }
};

/** Canonical address parsing is shared by settings, record rendering and verification. */
function canonicalDnsAddress(value: string): { kind: 'ipv4' | 'ipv6'; value: string } | null {
  const candidate = value.trim();
  const family = isIP(candidate);
  if (family === 4) return { kind: 'ipv4', value: candidate };
  if (family !== 6) return null;
  try {
    const serialized = new URL('http://[' + candidate + ']/').hostname;
    return { kind: 'ipv6', value: serialized.slice(1, -1) };
  } catch {
    return null;
  }
}

const dnsHostname = (value: string): string | null => {
  if (!DNS_NAME_CHARACTERS.test(value)) return null;
  const ascii = domainToASCII(value.toLowerCase());
  if (!ascii || ascii.length > 253 || !ascii.includes('.')) return null;
  const labels = ascii.split('.');
  if (labels.some((label) => label.length < 1 || label.length > 63 || !DNS_LABEL.test(label))) return null;
  if (/^\d+$/.test(labels.at(-1) ?? '')) return null;
  return ascii;
};

const addresses = async (
  resolver: TrafficDnsResolver,
  hostname: string,
  samples: number,
): Promise<AddressAnswers> => {
  const ipv4 = new Set<string>();
  const ipv6 = new Set<string>();
  const errors: string[] = [];
  let answered = false;
  for (let sample = 0; sample < samples; sample += 1) {
    const [v4, v6] = await Promise.all([
      answer(() => resolver.resolve4(fqdn(hostname))),
      answer(() => resolver.resolve6(fqdn(hostname))),
    ]);
    for (const value of v4.values) {
      const parsed = canonicalDnsAddress(value);
      if (parsed?.kind === 'ipv4') ipv4.add(parsed.value);
    }
    for (const value of v6.values) {
      const parsed = canonicalDnsAddress(value);
      if (parsed?.kind === 'ipv6') ipv6.add(parsed.value);
    }
    answered = answered || v4.values.length > 0 || v6.values.length > 0;
    if (v4.error) errors.push(v4.error);
    if (v6.error) errors.push(v6.error);
  }
  return { ipv4, ipv6, answered, errors };
};

const cnameChain = async (
  resolver: TrafficDnsResolver,
  hostname: string,
  expected: string | null,
): Promise<{ reachesTarget: boolean; observed: string[]; errors: string[] }> => {
  const pending = [hostname];
  const visited = new Set<string>();
  const observed = new Set<string>();
  const errors: string[] = [];
  for (let depth = 0; pending.length > 0 && depth < 8; depth += 1) {
    const current = normalizedHost(pending.shift() ?? '');
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const result = await answer(() => resolver.resolveCname(fqdn(current)));
    if (result.error) errors.push(result.error);
    for (const raw of result.values) {
      const target = normalizedHost(raw);
      if (!target) continue;
      observed.add(target);
      if (expected !== null && target === expected) {
        return { reachesTarget: true, observed: [...observed], errors };
      }
      if (!visited.has(target)) pending.push(target);
    }
  }
  return { reachesTarget: false, observed: [...observed], errors };
};

class GatewayDnsTarget {
  constructor(
    readonly kind: 'hostname' | 'ipv4' | 'ipv6',
    readonly value: string,
    private readonly resolver: TrafficDnsResolver,
  ) {}

  requiredRecord(name: string): DirectDnsRecord {
    return {
      name,
      type: this.kind === 'hostname' ? 'CNAME' : this.kind === 'ipv4' ? 'A' : 'AAAA',
      value: this.kind === 'hostname' ? this.value + '.' : this.value,
    };
  }

  async recordPlan(hostname: SiteHostname): Promise<DnsRecordPlan> {
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
        detail: resolved.errors[0] ?? 'The configured destination currently has no A or AAAA answer.',
      };
    }
    return {
      state: 'ready',
      hostname: hostname.ascii,
      kind: hostname.kind,
      delegatedRootWarning: hostname.delegatedRootWarning,
      preferred: [{ name: hostname.ascii, type: 'ALIAS/ANAME', value: this.value + '.' }],
      fallback: [
        ...[...resolved.ipv4].map((value): DnsRecord => ({ name: hostname.ascii, type: 'A', value })),
        ...[...resolved.ipv6].map((value): DnsRecord => ({ name: hostname.ascii, type: 'AAAA', value })),
      ],
    };
  }

  /** Verify one exact hostname. Every published A and AAAA answer must belong to this destination. */
  async verifyHostname(hostname: string, samples = 1): Promise<DnsTrafficObservation> {
    const cname = await cnameChain(
      this.resolver,
      hostname,
      this.kind === 'hostname' ? this.value : null,
    );
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
    if (wrongAddress) return { state: 'misdirected', observedTargets };

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

type GatewayDnsTargetResolution = {
  target: GatewayDnsTarget | null;
  error: string | null;
};

export function resolveGatewayDnsTarget(
  value: unknown,
  fallbackHostname: string | null,
  resolver: TrafficDnsResolver,
): GatewayDnsTargetResolution {
  const configured = typeof value === 'string' && value.trim() !== '';
  const candidate = configured ? value.trim() : fallbackHostname?.trim() ?? '';
  if (!candidate) return { target: null, error: configured ? DNS_TARGET_ERROR : null };
  const bare = candidate.endsWith('.') ? candidate.slice(0, -1) : candidate;
  const address = canonicalDnsAddress(candidate) ?? canonicalDnsAddress(bare);
  if (address) return { target: new GatewayDnsTarget(address.kind, address.value, resolver), error: null };
  const hostname = dnsHostname(bare);
  if (hostname) return { target: new GatewayDnsTarget('hostname', hostname, resolver), error: null };
  return { target: null, error: DNS_TARGET_ERROR };
}

/** Caches the parsed target until either configured value changes. All consumers receive the same object. */
export class GatewayDnsTargetService {
  private cacheKey: string | null = null;
  private cached: GatewayDnsTargetResolution | null = null;

  constructor(private readonly deps: {
    configured(): unknown;
    fallbackHostname(): string | null;
    resolver: TrafficDnsResolver;
  }) {}

  current(): GatewayDnsTargetResolution {
    const configured = this.deps.configured();
    const fallback = this.deps.fallbackHostname();
    const key = JSON.stringify([configured, fallback]);
    if (this.cached && this.cacheKey === key) return this.cached;
    this.cacheKey = key;
    this.cached = resolveGatewayDnsTarget(configured, fallback, this.deps.resolver);
    return this.cached;
  }
}

export const ownershipTxtRecord = (hostname: string, token: string): {
  name: string;
  type: 'TXT';
  value: string;
} => ({
  name: '_elowen-site.' + normalizedHost(hostname),
  type: 'TXT',
  value: 'elowen-site-verification=' + token,
});

export async function verifyOwnershipTxt(
  hostname: string,
  token: string,
  resolver: OwnershipDnsResolver,
): Promise<{ state: 'ready' | 'missing' | 'mismatch' | 'unavailable'; observedValues: string[]; detail?: string }> {
  const record = ownershipTxtRecord(hostname, token);
  try {
    const rows = await resolver.resolveTxt(fqdn(record.name));
    const observedValues: string[] = [];
    let matches = false;
    for (const chunks of rows) {
      const value = chunks.join('');
      if (value === record.value) matches = true;
      if (observedValues.length < 8) observedValues.push(value);
    }
    return matches
      ? { state: 'ready', observedValues }
      : { state: 'mismatch', observedValues };
  } catch (error) {
    if (negativeDnsError(error)) return { state: 'missing', observedValues: [] };
    return {
      state: 'unavailable',
      observedValues: [],
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
