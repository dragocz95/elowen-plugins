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
export interface ResetUsageResult { ok: boolean; cleared: number; chatCleared?: number }

export interface UsageRow {
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

export type RangePreset = '7d' | '30d' | '90d' | 'today' | 'all' | 'custom';
export interface DateRange { preset: RangePreset; from: string | null; to: string | null }
