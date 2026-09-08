// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import type { SessionSource } from 'elowen/dist/plugins/api.js';

const log = { info() {}, warn() {}, error() {} };
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(repoRoot, 'plugins');

/** The cron adapter internals these tests drive directly (a manual tick, no timers). */
interface CronAdapterUnderTest {
  listen(fn: (src: SessionSource, text: string, onEvent?: (e: { type: string; sessionId?: string }) => void) => Promise<string | undefined>): void;
  tick(): Promise<void>;
}

let dirs: string[] = [];
function freshDataRoot(): string { const p = mkdtempSync(join(tmpdir(), 'elowen-pdata-')); dirs.push(p); return p; }
afterEach(() => { for (const p of dirs) rmSync(p, { recursive: true, force: true }); dirs = []; });

async function loadCron(dataRoot: string, config?: Record<string, unknown>) {
  const reg = await loadPlugins({ dirs: [pluginsDir], enabled: ['cronjob'], dataRoot, logger: log, config: config ? { cronjob: config } : undefined });
  return reg.platforms[0] as unknown as CronAdapterUnderTest;
}

function writeJobs(dataRoot: string, jobs: Record<string, unknown>[]): void {
  mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
  writeFileSync(join(dataRoot, 'cronjob/jobs.json'), JSON.stringify(jobs));
}

const dueJob = (extra: Record<string, unknown> = {}) => ({
  id: 'r1', name: 'report', schedule: 'every 15m', prompt: 'do it',
  lastRun: new Date(Date.now() - 20 * 60_000).toISOString(), createdAt: new Date().toISOString(), ...extra,
});

// The per-job "fresh-session idle threshold" knob was removed together with the host's channel idle
// rollover: a stale context is handled by the host's cold turn-start passes, on every session kind. A
// value still stored from an older version must be ignored, never forwarded as a session access hint.
describe('cron stale config tolerance', () => {
  it('ignores a stored sessionIdleMs and forwards no idle hint in access', async () => {
    const dataRoot = freshDataRoot();
    writeJobs(dataRoot, [dueJob()]);
    const adapter = await loadCron(dataRoot, { sessionIdleMs: 0 });
    let seen: SessionSource | undefined;
    adapter.listen(async (src) => { seen = src; return 'ran'; });
    await adapter.tick();
    expect(seen).toBeDefined();
    expect(seen?.access && 'sessionIdleMs' in seen.access).toBe(false);
  });
});
