/** The `utils` bag the host installs on `window.ElowenUiRuntime` — formatting helpers, the web-side
 *  schedule validator, and the task/mission/date vocabulary the work and agents bundles compose.
 *
 *  Everything below the formatting block is ported FUNCTION FOR FUNCTION from the Elowen package
 *  (web/lib/{format,agentUtils,taskTree,dateRange,execPresets,usageBars,modelProvider,taskMeta,
 *  statusTone,eventMeta,fileIcon,filePath}.ts). These are pure helpers whose exact behaviour the moved
 *  suites assert on — a mission's rolled-up elapsed time, an epic's effective status, the model list a
 *  picker offers — so a plausible-looking reimplementation would quietly change what the tests measure.
 *  Only the app's `types.ts` import is replaced by the structural shapes in hostClient. */
import { Circle, Database, File, FileCode, FileCog, FileJson, FileText, Image,
  ListChecks, Palette, Radio, Rocket, ShieldCheck, Terminal, type LucideIcon } from 'lucide-react';
import type { ModelUsage } from './hostClient';

// The plugin is untyped .mjs, so the import is given the one signature this file uses.
const { parseSchedule } = await import('../../plugins/cronjob/index.mjs') as {
  parseSchedule(spec: string): unknown | null;
};

/** Normalize a SQLite ("2026-06-18 10:38:49", UTC) or ISO timestamp to epoch ms. */
export function parseTs(iso?: string | null): number | null {
  if (!iso) return null;
  const norm = iso.includes('T') ? iso : iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z');
  const ms = new Date(norm).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Single-unit elapsed ladder (ms → "12s" / "3m" / "5h" / "2d"). Negatives clamp to "0s". */
export function compactElapsed(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** In production this is the host's own copy of the grammar (web/lib/cron.ts), which the panel uses to
 *  mark a schedule field invalid before saving. Here it delegates to the plugin's parser instead of
 *  duplicating a 160-line parser into the test harness.
 *
 *  That substitution cannot hide a host/plugin drift, because nothing here is what catches drift:
 *  cronGrammar.test.ts pins the plugin to the frozen corpus and the package's cronParity.test.ts pins
 *  both web copies to a byte-identical one, each without seeing the other side. What this file feeds is
 *  the PANEL's behaviour — that an invalid schedule blocks the save and a valid one does not. */
export function isValidSchedule(spec: string): boolean {
  return parseSchedule(spec) !== null;
}

/** Copy to the clipboard, reporting whether it worked — the caller toasts either way, so it must not
 *  throw. Ported from the host's clipboard helper; jsdom exposes no clipboard, which is the `false` branch. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Elowen's Monaco themes, installed by the HOST so every editor surface (a plugin's included) shares one
 *  colour table: 'elowen-oled' for the true-black canvas, 'elowen-paper' for a light skin, picked by the
 *  document's resolved color-scheme.
 *
 *  The palettes are deliberately abridged. The app's full tables live in web/lib/monaco/oledTheme.ts and
 *  nothing on this side could keep a copy of them honest. What a panel actually depends on — and what
 *  this reproduces exactly — is the two theme NAMES and the fact that the bundle registers neither
 *  itself. */
type Monaco = { editor: { defineTheme(name: string, theme: unknown): void } };

export function defineEditorThemes(monaco: Monaco): void {
  monaco.editor.defineTheme('elowen-oled', {
    base: 'vs-dark', inherit: true, rules: [{ token: '', foreground: 'f7f3f0' }],
    colors: { 'editor.background': '#000000', 'editor.foreground': '#f7f3f0' },
  });
  monaco.editor.defineTheme('elowen-paper', {
    base: 'vs', inherit: true, rules: [{ token: '', foreground: '0f1c2e' }],
    colors: { 'editor.background': '#ffffff', 'editor.foreground': '#0f1c2e' },
  });
}

export function editorTheme(): 'elowen-oled' | 'elowen-paper' {
  if (typeof document === 'undefined') return 'elowen-oled';
  return getComputedStyle(document.documentElement).colorScheme === 'light' ? 'elowen-paper' : 'elowen-oled';
}

// ── formatting (web/lib/format.ts) ───────────────────────────────────────────────────────────────────

/** Two-unit run duration: "1h 4m" / "3m 12s" / "8s". */
export function formatDuration(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

/** Compact token count: 950 → "950", 12345 → "12.3k", 1_200_000 → "1.2M". */
function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatCost(usd: number, decimals = 4): string {
  return `$${usd.toFixed(decimals)}`;
}

function formatSpeed(tps: number | null | undefined): string {
  return tps != null && tps > 0 ? `${Math.round(tps)} tok/s` : '—';
}

// ── file paths (web/lib/filePath.ts + fileIcon.ts) ───────────────────────────────────────────────────

export const baseName = (p: string): string => p.split('/').pop() ?? p;

export const dirName = (p: string): string => {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i + 1) : '';
};

const extOf = (p: string): string => p.split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';

const EXT_ICON: Record<string, LucideIcon> = {
  ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode, mjs: FileCode, cjs: FileCode,
  go: FileCode, rs: FileCode, php: FileCode, py: FileCode, html: FileCode,
  json: FileJson,
  css: Palette, scss: Palette,
  md: FileText, markdown: FileText, txt: FileText,
  yml: FileCog, yaml: FileCog, toml: FileCog, env: FileCog, ini: FileCog,
  sh: Terminal, bash: Terminal,
  sql: Database,
  png: Image, jpg: Image, jpeg: Image, gif: Image, svg: Image, webp: Image,
};

export function fileIcon(path: string): LucideIcon {
  return EXT_ICON[extOf(path)] ?? File;
}

// ── presentation vocabulary (web/lib/{taskMeta,statusTone,eventMeta}.ts + components/ui/tone.ts) ─────

export type Tone = 'default' | 'accent' | 'muted' | 'danger' | 'success' | 'warning';

export function eventIcon(type: string): LucideIcon {
  switch (type) {
    case 'task': return ListChecks;
    case 'mission': return Rocket;
    case 'signal': return Radio;
    case 'review': return ShieldCheck;
    default: return Circle;
  }
}

/** The sentinel a menu spec uses for a separator row (web/components/ui/ContextMenu.tsx). */
export const DIVIDER = 'divider' as const;

// ── date window (web/lib/dateRange.ts) ───────────────────────────────────────────────────────────────

export type RangePreset = '7d' | '30d' | '90d' | 'today' | 'all' | 'custom';
const RANGE_PRESETS: readonly RangePreset[] = ['7d', '30d', '90d', 'today', 'all', 'custom'];

export interface DateRange { preset: RangePreset; from: string | null; to: string | null }

export const DEFAULT_RANGE: DateRange = { preset: '7d', from: null, to: null };

const DAY = 86400000;
const isDateStr = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);
const startOfDay = (ms: number): number => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const endOfDay = (ms: number): number => { const d = new Date(ms); d.setHours(23, 59, 59, 999); return d.getTime(); };
const startOfDayStr = (s: string): number => new Date(`${s}T00:00:00`).getTime();
const endOfDayStr = (s: string): number => new Date(`${s}T23:59:59.999`).getTime();

export function serializeRange(r: DateRange): string {
  return `${r.preset}|${r.from ?? ''}|${r.to ?? ''}`;
}

export function parseRange(raw: string): DateRange | null {
  const parts = raw.split('|');
  // Legacy single-preset form (the old Timeline stored just the preset string).
  if (parts.length === 1) {
    return raw !== 'custom' && (RANGE_PRESETS as readonly string[]).includes(raw) ? { preset: raw as RangePreset, from: null, to: null } : null;
  }
  if (parts.length !== 3) return null;
  const [preset, from, to] = parts;
  if (!(RANGE_PRESETS as readonly string[]).includes(preset!)) return null;
  if (from && !isDateStr(from)) return null;
  if (to && !isDateStr(to)) return null;
  return { preset: preset as RangePreset, from: from || null, to: to || null };
}

export const isStoredRange = (raw: string): boolean => parseRange(raw) !== null;

export function rangeBounds(r: DateRange, now: number): { fromMs: number; toMs: number } {
  if (r.preset === 'all') return { fromMs: -Infinity, toMs: Infinity };
  if (r.preset === 'today') return { fromMs: startOfDay(now), toMs: endOfDay(now) };
  if (r.preset === 'custom') {
    return {
      fromMs: r.from ? startOfDayStr(r.from) : -Infinity,
      toMs: r.to ? endOfDayStr(r.to) : Infinity,
    };
  }
  const days = r.preset === '7d' ? 7 : r.preset === '30d' ? 30 : 90;
  return { fromMs: startOfDay(now) - (days - 1) * DAY, toMs: Infinity };
}

// ── models (web/lib/execPresets.ts + modelProvider.ts) ───────────────────────────────────────────────

const EXEC_PRESETS: { label: string; exec: string }[] = [
  { label: 'GLM 5.2', exec: 'opencode:ollama-cloud/glm-5.2' },
  { label: 'GPT 5.5', exec: 'codex:gpt-5.5' },
  { label: 'Claude Sonnet 4.5', exec: 'sonnet' },
  { label: 'Claude Opus 4.8', exec: 'opus' },
  { label: 'DeepSeek V4 Pro', exec: 'opencode:ollama-cloud/deepseek-v4-pro' },
  { label: 'Kimi k2.7 Code', exec: 'opencode:ollama/kimi-k2.7-code' },
  { label: 'MiniMax M3', exec: 'opencode:ollama-cloud/minimax-m3' },
  { label: 'DeepSeek v4 Flash', exec: 'opencode:ollama-cloud/deepseek-v4-flash' },
  { label: 'MiniMax M2.7', exec: 'opencode:ollama-cloud/minimax-m2.7' },
  { label: 'GLM 5.1', exec: 'opencode:ollama-cloud/glm-5.1' },
  { label: 'QWEN 3.5', exec: 'opencode:ollama-cloud/qwen3.5' },
];

/** Presets (minus hidden) merged with custom models, deduped by exec; a custom entry overrides. */
export function allModels(custom: { label: string; exec: string }[] = [], hidden: string[] = []): { label: string; exec: string }[] {
  const customExecs = new Set(custom.map((m) => m.exec));
  const hiddenExecs = new Set(hidden);
  const presets = EXEC_PRESETS.filter((p) => !customExecs.has(p.exec) && !hiddenExecs.has(p.exec));
  return [...presets, ...custom];
}

/** CLI provider metadata (web/modules/settings/providers.tsx), narrowed to the fields the moved
 *  settings sections read. The asset paths belong to the app, so only the ids/labels/hints travel. */
export const PROVIDERS: { id: string; label: string; color: string; binHint: string; argsHint: string; icon: string; noBypassFlag?: boolean; embedded?: boolean }[] = [
  { id: 'claude-code', label: 'Claude Code', color: '#d97757', binHint: 'claude', argsHint: '--permission-mode acceptEdits', icon: '/providers/anthropic.png' },
  { id: 'opencode', label: 'OpenCode', color: '#7c8cff', binHint: 'opencode', argsHint: '--pure', icon: '/providers/opencode.png' },
  { id: 'codex', label: 'Codex', color: '#ededed', binHint: 'codex', argsHint: '--full-auto', icon: '/providers/openai.svg' },
  { id: 'kilo', label: 'Kilo Code', color: '#c2e812', binHint: 'kilo', argsHint: '', icon: '/providers/kilo.svg', noBypassFlag: true },
  { id: 'elowen', label: 'Elowen AI', color: '#3b82f6', binHint: '', argsHint: '', icon: '/icon.png', embedded: true },
];

// ── usage summary (web/lib/usageBars.ts) ─────────────────────────────────────────────────────────────

interface UsageRow {
  exec: string; totalTokens: number; costUsd: number | null; pct: number;
  tokensLabel: string; costLabel: string; speedLabel: string; cacheHitPct: number | null;
}

export interface UsageSummary {
  rows: UsageRow[];
  totalCost: number | null; totalCostLabel: string;
  totalTokens: number; totalTokensLabel: string;
  totalCacheTokens: number; totalCacheLabel: string;
  modelsUsed: number; avgSpeedLabel: string; hasAnyUsage: boolean;
}

const DASH = '—';

function cacheHitPct(u: { cacheRead: number; input: number }): number | null {
  const reads = u.cacheRead + u.input;
  return reads > 0 ? (u.cacheRead / reads) * 100 : null;
}

/** Sorted, pre-formatted display rows + totals for `/usage/by-model`. Bar widths are max-normalized by
 *  tokens (the metric every executor reports), so cost-less models still get a meaningful bar. */
export function buildUsageSummary(data: ModelUsage[] | undefined): UsageSummary {
  const items = data ?? [];
  const maxTokens = Math.max(1, ...items.map((m) => m.usage.total));
  const rows: UsageRow[] = items
    .map((m) => ({
      exec: m.exec,
      totalTokens: m.usage.total,
      costUsd: m.usage.costUsd,
      pct: (m.usage.total / maxTokens) * 100,
      tokensLabel: formatTokens(m.usage.total),
      costLabel: m.usage.costUsd == null ? DASH : formatCost(m.usage.costUsd),
      speedLabel: formatSpeed(m.usage.outputTps),
      cacheHitPct: cacheHitPct(m.usage),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const totalTokens = items.reduce((sum, m) => sum + m.usage.total, 0);
  const totalCacheTokens = items.reduce((sum, m) => sum + m.usage.cacheRead + m.usage.cacheWrite, 0);
  const costs = items.map((m) => m.usage.costUsd).filter((c): c is number => c != null);
  const totalCost = costs.length ? costs.reduce((sum, c) => sum + c, 0) : null;
  // Duration-weighted: an arithmetic mean of per-model tps would overweight small runs.
  let measuredOutput = 0;
  let measuredSeconds = 0;
  for (const m of items) {
    const tps = m.usage.outputTps;
    const measured = m.usage.measuredOutput ?? 0;
    if (tps != null && tps > 0 && measured > 0) { measuredOutput += measured; measuredSeconds += measured / tps; }
  }

  return {
    rows,
    totalCost,
    totalCostLabel: totalCost == null ? DASH : formatCost(totalCost),
    totalTokens,
    totalTokensLabel: formatTokens(totalTokens),
    totalCacheTokens,
    totalCacheLabel: formatTokens(totalCacheTokens),
    modelsUsed: rows.length,
    avgSpeedLabel: measuredSeconds > 0 ? formatSpeed(measuredOutput / measuredSeconds) : DASH,
    hasAnyUsage: totalTokens > 0 || costs.some((cost) => cost > 0),
  };
}
