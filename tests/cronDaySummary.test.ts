// @vitest-environment node
//
// The day board's counts are ARITHMETIC: a two-minute poll is 720 runs a day and the board must
// answer "720" without building 720 of anything. That speed is only worth having if the fast answer
// is the SAME answer the slow one gives, so these tests hold `summarizeJobDay` against
// `planOccurrences` — the authoritative expansion the scheduler's own next-run query uses — across
// intervals, fixed times, active hours, catch-up and a DST day.
//
// If these ever disagree, the board is quietly lying about a schedule, which is worse than being slow.
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const schedulePath = resolve(dirname(fileURLToPath(import.meta.url)), '../plugins/cronjob/schedule.mjs');
interface Occurrence { id: string; localDate: string; localTime: string; disposition: string }
interface DaySummary { kind: string | null; remaining: number; head: Occurrence[]; truncated: boolean }
const mod = await import(schedulePath) as {
  summarizeJobDay(job: unknown, opts: Record<string, unknown>): DaySummary;
  planOccurrences(job: unknown, opts: Record<string, unknown>): { occurrences: Occurrence[]; truncated: boolean };
  zonedTimeToMs(tz: string, y: number, mo: number, d: number, h: number, mi: number): number;
};

const PRAGUE = 'Europe/Prague';
/** The inclusive instant bounds of one local date, the way the route resolves them. */
const dayBounds = (date: string, timezone = PRAGUE) => {
  const [y, m, d] = date.split('-').map(Number);
  const dayStartMs = mod.zonedTimeToMs(timezone, y!, m!, d!, 0, 0);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
  const dayEndMs = mod.zonedTimeToMs(timezone, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0) - 1;
  return { dayStartMs, dayEndMs };
};

/** What the authoritative expansion says the same job does on the same date. */
const expandedCount = (job: unknown, date: string, nowMs: number): number => {
  const { dayStartMs, dayEndMs } = dayBounds(date);
  const planned = mod.planOccurrences(job, {
    timezone: PRAGUE, nowMs, fromMs: dayStartMs, untilMs: dayEndMs, budgetCap: 100_000,
  });
  expect(planned.truncated).toBe(false); // the comparison is only meaningful under a full expansion
  return planned.occurrences.length;
};

const summarize = (job: unknown, date: string, nowMs: number): DaySummary => {
  const { dayStartMs, dayEndMs } = dayBounds(date);
  return mod.summarizeJobDay(job, { timezone: PRAGUE, nowMs, dayStartMs, dayEndMs });
};

describe('the bounded day summary agrees with the authoritative expansion', () => {
  // A weekday well clear of any DST boundary, mid-morning.
  const nowMs = Date.parse('2026-09-15T08:17:23Z');
  const today = '2026-09-15';
  const tomorrow = '2026-09-16';

  it.each([
    ['a two-minute poll that has never run', { id: 'p2', schedule: 'every 2m', prompt: 'p' }],
    ['a two-minute poll mid-cycle', { id: 'p2b', schedule: 'every 2m', prompt: 'p', lastRun: '2026-09-15T08:16:11Z' }],
    ['a fifteen-minute poll', { id: 'p15', schedule: 'every 15m', prompt: 'p', lastRun: '2026-09-15T08:05:00Z' }],
    ['an hourly poll inside active hours', { id: 'ph', schedule: 'every 1h', prompt: 'p', hours: '9-17' }],
    ['a daily job whose time has passed', { id: 'd1', schedule: 'daily 07:30', prompt: 'p' }],
    ['a daily job still ahead', { id: 'd2', schedule: 'daily 21:00', prompt: 'p' }],
    ['a dense cron', { id: 'c1', schedule: '*/5 * * * *', prompt: 'p' }],
    ['a cron with several hours', { id: 'c2', schedule: '0 */2 * * *', prompt: 'p' }],
    ['a gated cron deferred by active hours', { id: 'c3', schedule: '0 * * * *', prompt: 'p', hours: '9-17' }],
    ['a weekly job', { id: 'w1', schedule: 'weekly tue 10:00', prompt: 'p' }],
  ])('counts %s exactly as the expansion does', (_label, job) => {
    for (const date of [today, tomorrow]) {
      expect(summarize(job, date, nowMs).remaining).toBe(expandedCount(job, date, nowMs));
    }
  });

  it('counts a DST day by its real length, on both sides of the change', () => {
    const job = { id: 'h', schedule: 'every 1h', prompt: 'p' };
    const at = Date.parse('2026-10-20T08:00:00Z');
    // Prague falls back on 25 October 2026: that date is 25 hours long, the next is an ordinary 24.
    expect(summarize(job, '2026-10-25', at).remaining).toBe(25);
    expect(summarize(job, '2026-10-26', at).remaining).toBe(24);
    expect(summarize(job, '2026-10-25', at).remaining).toBe(expandedCount(job, '2026-10-25', at));
  });

  it('never builds more than a short head, whatever the count is', () => {
    const summary = summarize({ id: 'p', schedule: 'every 1m', prompt: 'p' }, tomorrow, nowMs);
    expect(summary.remaining).toBe(1440);
    expect(summary.head.length).toBeLessThanOrEqual(4);
  });

  it('reads a date already behind the scheduler as empty rather than as invented history', () => {
    const summary = summarize({ id: 'd', schedule: 'daily 07:00', prompt: 'p' }, '2026-09-14', nowMs);
    expect(summary).toEqual(expect.objectContaining({ remaining: 0, head: [], truncated: false }));
  });

  it('bounds one pathological schedule instead of letting it bound the request', () => {
    // A cron matching every minute of every hour is 1440 slots: exactly the cap, so it is counted in
    // full. The cap exists so that no single job can ever ask for more work than one day of minutes.
    const summary = summarize({ id: 'every-minute', schedule: '* * * * *', prompt: 'p' }, tomorrow, nowMs);
    // 1440 is the per-job cap AND a full day of wall-clock minutes, so the densest cron a five-field
    // expression can name is counted exactly rather than trimmed. Nothing denser can be expressed.
    expect(summary.remaining).toBe(1440);
    expect(summary.truncated).toBe(false);
  });

  it('counts an interval window inclusively at both ends, and an inverted one as empty', () => {
    // The arithmetic the whole board rests on, read through the summary that uses it.
    const midnight = { id: 'm', schedule: 'every 1m', prompt: 'p' };
    const { dayStartMs, dayEndMs } = dayBounds(tomorrow);
    expect(mod.summarizeJobDay(midnight, { timezone: PRAGUE, nowMs, dayStartMs, dayEndMs }).remaining).toBe(1440);
    // A window that ends before it starts holds nothing at all — never a negative or an off-by-one.
    expect(mod.summarizeJobDay(midnight, { timezone: PRAGUE, nowMs, dayStartMs: dayEndMs, dayEndMs: dayStartMs }).remaining).toBe(0);
  });
});
