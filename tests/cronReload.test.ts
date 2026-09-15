// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import type { SessionSource } from 'elowen/dist/plugins/api.js';
import { pluginDbFor } from './helpers/pluginDb.js';
import { openRunJournal } from '../plugins/cronjob/lib/runJournal.mjs';

// A plugin reload (stopAll + startAll) replaces the cron adapter while a tick may still be parked on a
// slow brain turn. The torn-down generation and its replacement share one jobs.json and one delivery
// sink, and the in-memory `running` guard covers only a single adapter — so both the hand-over and the
// due-slot claim have to hold across generations.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(repoRoot, 'plugins');

interface CronAdapterUnderTest {
  listen(fn: (src: SessionSource, text: string, onEvent?: (event: {
    type: string;
    sessionId?: string;
    messageId?: string;
    model?: string;
    usage?: { totalTokens?: number; cost?: number };
    completedAt?: string;
  }) => void) => Promise<string | undefined>): void;
  connect(): Promise<void>;
  tick(): Promise<void>;
  runClaim(job: Record<string, unknown>, details: { manual?: boolean; slot: string; now: number; timezone: string; skipReason?: string | null }): { id: string; created: boolean };
  disconnect(): void;
}

let dirs: string[] = [];
function freshDataRoot(): string { const p = mkdtempSync(join(tmpdir(), 'elowen-pdata-')); dirs.push(p); return p; }
afterEach(() => {
  vi.useRealTimers();
  for (const p of dirs) rmSync(p, { recursive: true, force: true });
  dirs = [];
});

async function loadCron(dataRoot: string, notify: (text: string, channelId?: string) => Promise<void>) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const reg = await loadPlugins({ dirs: [pluginsDir], enabled: ['cronjob'], dataRoot, logger, notify, pluginDb: pluginDbFor(dataRoot), delegatedTurnsOutOfProcess: () => false });
  return reg.platforms[0] as unknown as CronAdapterUnderTest;
}

/** Two recurring jobs, both due right now, in the order the tick walks them. */
function writeTwoDueJobs(dataRoot: string): void {
  mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
  const lastRun = new Date(Date.now() - 10 * 60_000).toISOString();
  writeFileSync(join(dataRoot, 'cronjob/jobs.json'), JSON.stringify([
    { id: 'r1', name: 'first', schedule: 'every 5m', prompt: 'do it', lastRun, createdAt: lastRun },
    { id: 'r2', name: 'second', schedule: 'every 5m', prompt: 'do it', lastRun, createdAt: lastRun },
  ]));
}

/** A handler that parks on job r1 until released, recording every job it is asked to run. */
function parkingHandler(tag: string, calls: string[]) {
  let release: () => void = () => {};
  let reachedR1: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const running = new Promise<void>((r) => { reachedR1 = r; });
  const handler = async (src: SessionSource) => {
    calls.push(`${tag}:${src.channelId}`);
    if (src.channelId === 'job-r1') { reachedR1(); await gate; }
    return 'done';
  };
  return { handler, gate: { release: () => release() }, running };
}

describe('cron scheduler across a plugin reload', () => {
  it('uses one deterministic journal claim for the same interval slot across generations', async () => {
    const dataRoot = freshDataRoot();
    const oldAdapter = await loadCron(dataRoot, async () => {});
    const newAdapter = await loadCron(dataRoot, async () => {});
    const now = Date.parse('2026-09-15T17:27:15.000Z');
    const job = {
      id: 'poll', name: 'poll', schedule: 'every 5m', prompt: 'poll',
      createdAt: new Date(now - 60_000).toISOString(),
    };
    const details = { slot: '2026-09-15T19:27', now, timezone: 'Europe/Prague' };

    const first = oldAdapter.runClaim(job, details);
    expect(first.created).toBe(true);
    expect(newAdapter.runClaim(job, details)).toEqual({ id: first.id, created: false });
  });

  it('schedules daily journal retention and disposes both timers with the adapter', async () => {
    vi.useFakeTimers();
    const dataRoot = freshDataRoot();
    const interval = vi.spyOn(globalThis, 'setInterval');
    const adapter = await loadCron(dataRoot, async () => {});
    await adapter.connect();

    expect(interval.mock.calls.map((call) => call[1])).toContain(24 * 60 * 60_000);
    expect(vi.getTimerCount()).toBe(2);
    adapter.disconnect();
    expect(vi.getTimerCount()).toBe(0);
    interval.mockRestore();
  });

  it('runs a durable manual request immediately without rewriting its future schedule', async () => {
    const dataRoot = freshDataRoot();
    mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
    const createdAt = new Date().toISOString();
    writeFileSync(join(dataRoot, 'cronjob/jobs.json'), JSON.stringify([
      { id: 'manual', name: 'manual report', schedule: 'daily 23:59', prompt: 'do it', createdAt, lastRun: createdAt,
        manualRequest: { id: 'm1', requestedAt: new Date().toISOString() } },
    ]));
    const adapter = await loadCron(dataRoot, async () => {});
    const calls: string[] = [];
    adapter.listen(async (src: SessionSource, _text, onEvent) => {
      calls.push(src.channelId);
      onEvent?.({ type: 'session', sessionId: 'brain-manual' });
      onEvent?.({
        type: 'idle',
        messageId: 'assistant-manual-exact',
        model: 'openai/gpt-test',
        usage: { totalTokens: 42, cost: 0.01 },
        completedAt: new Date().toISOString(),
      });
      return 'manual result';
    });

    // The tick consumes the OLDEST durable manual request before the natural due work; the request is
    // cleared from the job, the dedupe token survives, and the future natural slot stays armed.
    await adapter.tick();
    expect(calls).toEqual(['job-manual']);
    const [stored] = JSON.parse(readFileSync(join(dataRoot, 'cronjob/jobs.json'), 'utf-8')) as Record<string, unknown>[];
    expect(stored.schedule).toBe('daily 23:59');
    expect(stored.lastSlot).toBeUndefined(); // the future natural slot remains armed
    expect(stored.lastResult).toBe('manual result');
    expect(stored.manualRequest).toBeUndefined();
    expect(stored.lastManualRequestId).toBe('m1'); // a retried run request finds its answer here
    const [receipt] = openRunJournal(pluginDbFor(dataRoot)('cronjob'))
      .list({ userId: null, admin: true }, { limit: 10 }).runs;
    expect(receipt).toMatchObject({
      jobId: 'manual',
      trigger: 'manual',
      outcome: 'ok',
      sessionId: 'brain-manual',
      messageId: 'assistant-manual-exact',
      model: 'openai/gpt-test',
      tokensTotal: 42,
      costUsd: 0.01,
      delivered: true,
      preview: 'manual result',
    });
  });

  // The manual request lives in jobs.json, so it survives a reload: a request written by the old
  // generation is claimed and run by the new one exactly once.
  it('a durable manual run request survives an adapter reload and is claimed exactly once', async () => {
    const dataRoot = freshDataRoot();
    mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
    const createdAt = new Date().toISOString();
    writeFileSync(join(dataRoot, 'cronjob/jobs.json'), JSON.stringify([
      { id: 'manual', name: 'manual report', schedule: 'daily 23:59', prompt: 'do it', createdAt, lastRun: createdAt,
        manualRequest: { id: 'm2', requestedAt: new Date().toISOString() } },
    ]));
    const oldAdapter = await loadCron(dataRoot, async () => {});
    oldAdapter.disconnect(); // the host replaces this generation before any of its work ran

    const calls: string[] = [];
    const newAdapter = await loadCron(dataRoot, async () => {});
    newAdapter.listen(async (src: SessionSource) => { calls.push(src.channelId); return 'manual result'; });
    await newAdapter.tick();
    await newAdapter.tick(); // a second tick may NOT run the same manual request again

    expect(calls).toEqual(['job-manual']);
    const [stored] = JSON.parse(readFileSync(join(dataRoot, 'cronjob/jobs.json'), 'utf-8')) as Record<string, unknown>[];
    expect(stored.lastManualRequestId).toBe('m2');
    expect(stored.lastResult).toBe('manual result');
  });

  it('an adapter torn down mid-tick hands the remaining jobs over instead of running them itself', async () => {
    const dataRoot = freshDataRoot();
    writeTwoDueJobs(dataRoot);
    const delivered: string[] = [];
    const adapter = await loadCron(dataRoot, async (t: string) => { delivered.push(t); });
    const calls: string[] = [];
    const parked = parkingHandler('A', calls);
    adapter.listen(parked.handler);

    const tick = adapter.tick();
    await parked.running; // the tick is inside r1's turn — exactly where a reload lands
    adapter.disconnect(); // the host replaces this generation with a fresh one
    parked.gate.release();
    await tick;

    expect(calls).toEqual(['A:job-r1']); // r2 was left to the live adapter, not run by the orphan
    // The result the orphan already paid for is still delivered — the hand-over must not drop it.
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toContain('done');
  });

  it('does not double-fire a job when the old and new adapter generations overlap', async () => {
    const dataRoot = freshDataRoot();
    writeTwoDueJobs(dataRoot);
    const delivered: string[] = [];
    const notify = async (t: string) => { delivered.push(t); };
    const calls: string[] = [];

    const oldAdapter = await loadCron(dataRoot, notify);
    const parked = parkingHandler('old', calls);
    oldAdapter.listen(parked.handler);
    const oldTick = oldAdapter.tick();
    await parked.running; // parked on r1's turn, holding a snapshot of jobs.json that is about to go stale

    // The reloaded registry's adapter connects and ticks while the old one is still mid-turn.
    const newAdapter = await loadCron(dataRoot, notify);
    newAdapter.listen(async (src: SessionSource) => { calls.push(`new:${src.channelId}`); return 'done'; });
    await newAdapter.tick();

    parked.gate.release();
    await oldTick;

    // r1 was claimed (stamped) by the old generation before its turn, so the new one skipped it; r2 was
    // claimed by the new one, so the old generation's stale snapshot must not fire it a second time.
    expect(calls.filter((c) => c.endsWith('job-r1'))).toEqual(['old:job-r1']);
    expect(calls.filter((c) => c.endsWith('job-r2'))).toEqual(['new:job-r2']);
    expect(delivered).toHaveLength(2);
  });

  // The result is queued BEFORE it is sent (so a failed send never loses it), which leaves it visible to
  // the reloaded generation's flush for the whole duration of a slow deliver() — without a lease the user
  // reads the same report twice.
  it('does not send a queued result twice when the reloaded generation flushes mid-delivery', async () => {
    const dataRoot = freshDataRoot();
    mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
    const lastRun = new Date(Date.now() - 10 * 60_000).toISOString();
    writeFileSync(join(dataRoot, 'cronjob/jobs.json'), JSON.stringify([
      { id: 'r1', name: 'report', schedule: 'every 5m', prompt: 'do it', lastRun, createdAt: lastRun },
    ]));

    // The sink records every attempt and parks on the first one — a Discord push that has not returned yet.
    const attempts: string[] = [];
    let release: () => void = () => {};
    let arrived: () => void = () => {};
    const parked = new Promise<void>((r) => { release = r; });
    const inFlight = new Promise<void>((r) => { arrived = r; });
    const notify = async (text: string) => {
      attempts.push(text);
      if (attempts.length === 1) { arrived(); await parked; }
    };

    const oldAdapter = await loadCron(dataRoot, notify);
    oldAdapter.listen(async () => 'the report');
    const oldTick = oldAdapter.tick();
    await inFlight; // parked inside deliver(), with the result still queued on disk
    oldAdapter.disconnect(); // the host tears this generation down and builds a fresh one

    const newAdapter = await loadCron(dataRoot, notify);
    newAdapter.listen(async () => 'the report');
    await newAdapter.tick(); // its flush sees the queued entry — and must leave it to its in-flight owner

    release();
    await oldTick;

    expect(attempts).toHaveLength(1); // exactly one send, not two
    expect(attempts[0]).toContain('the report');
    expect(JSON.parse(readFileSync(join(dataRoot, 'cronjob/pending-deliveries.json'), 'utf-8'))).toEqual([]);
  });

  // The claim protects an IN-FLIGHT send, so a send that already failed must free it right away: waiting
  // the lease out would leave a produced result undelivered for minutes after the reload that follows.
  it('hands a failed delivery to the next generation immediately, not once the claim expires', async () => {
    const dataRoot = freshDataRoot();
    mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
    const lastRun = new Date(Date.now() - 10 * 60_000).toISOString();
    writeFileSync(join(dataRoot, 'cronjob/jobs.json'), JSON.stringify([
      { id: 'r1', name: 'report', schedule: 'every 5m', prompt: 'do it', lastRun, createdAt: lastRun },
    ]));
    let sinkDown = true;
    const delivered: string[] = [];
    const notify = async (t: string) => { if (sinkDown) throw new Error('discord 500'); delivered.push(t); };

    const oldAdapter = await loadCron(dataRoot, notify);
    oldAdapter.listen(async () => 'the report');
    await oldAdapter.tick(); // produces the result, fails to send it, and is then torn down
    oldAdapter.disconnect();

    sinkDown = false;
    const newAdapter = await loadCron(dataRoot, notify);
    newAdapter.listen(async () => 'the report');
    await newAdapter.tick();

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toContain('the report');
  });
});
