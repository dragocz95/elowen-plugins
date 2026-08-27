export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  reasoning?: number;
  costUsd: number | null;
  currency?: string | null;
  costSource?: string;
  outputTps?: number | null;
  measuredOutput?: number;
}

export interface ModelUsage { exec: string; usage: TokenUsage }
export interface DayUsage { day: string; tokens: number; cost: number | null }
export interface ResetUsageResult { ok: boolean; cleared: number; chatCleared?: number; originsCleared?: number }

/** Which axis the admin origin view collapses. Mirrors the daemon's GET /usage/by-origin `group`. */
export type UsageOriginGroup = 'user' | 'origin' | 'pair';

/** One row of the admin origin view. `userId`/`origin` is null on whichever axis was collapsed.
 *  `trusted` is false when any turn in the bucket arrived with an address the daemon could not verify —
 *  the row is marked, never hidden. `cost` null means "no price reported", not zero. */
export interface UsageOriginRow {
  userId: number | null;
  username: string | null;
  origin: string | null;
  originKind: 'ip' | 'local' | 'internal' | 'platform' | 'redacted' | null;
  trusted: boolean;
  origins: number;
  turns: number;
  tokens: number;
  cost: number | null;
  costedTurns: number;
  firstAt: number;
  lastAt: number;
}

/** GET /usage/by-origin. `trackingSince` is the first day the rollup holds; everything the instance
 *  spent before it has no recorded origin and never will. */
export interface UsageByOriginResult {
  rows: UsageOriginRow[];
  group: UsageOriginGroup;
  trackingSince: string | null;
}

interface UsageRow {
  exec: string;
  totalTokens: number;
  costUsd: number | null;
  pct: number;
  tokensLabel: string;
  costLabel: string;
  speedLabel: string;
  cacheHitPct: number | null;
}

export interface UsageSummary {
  rows: UsageRow[];
  totalCost: number | null;
  totalCostLabel: string;
  totalTokens: number;
  totalTokensLabel: string;
  totalCacheTokens: number;
  totalCacheLabel: string;
  modelsUsed: number;
  avgSpeedLabel: string;
  hasAnyUsage: boolean;
}

type RangePreset = '7d' | '30d' | '90d' | 'today' | 'all' | 'custom';
export interface DateRange { preset: RangePreset; from: string | null; to: string | null }
