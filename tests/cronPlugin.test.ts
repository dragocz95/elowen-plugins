// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import { runWithPolicy } from 'elowen/dist/plugins/policyContext.js';
import type { TurnIdentity } from 'elowen/dist/plugins/policyContext.js';
import type { Policy } from 'elowen/dist/plugins/policy.js';
import { processRegistry } from 'elowen/dist/brain/processRegistry.js';

const log = { info() {}, warn() {}, error() {} };
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(repoRoot, 'plugins');
const ADMIN: Policy = { allowedProjectIds: 'all', allowedPaths: () => [] };
const LIMITED: Policy = { allowedProjectIds: new Set([1]), allowedPaths: () => [] };
const OWNER: TurnIdentity = { platform: 'elowen', userId: '1', elowenUserId: 1, admin: true, owner: true };
const asText = (r: { content: { text?: string }[] }) => (r.content[0] as { text: string }).text;

let dirs: string[] = [];
function freshDataRoot(): string { const p = mkdtempSync(join(tmpdir(), 'elowen-pdata-')); dirs.push(p); return p; }

// The process registry is a module-level singleton shared across every test in this run. Any handle a
// test registers (even fake ones) survives into later tests and other files, so clear it after each test.
// kill() is idempotent and safe on both fake and real handles. The per-test data roots are removed only
// after the kill so no still-running background process is left with its working directory deleted.
afterEach(() => {
  for (const p of processRegistry.list()) processRegistry.kill(p.id);
  for (const p of dirs) rmSync(p, { recursive: true, force: true });
  dirs = [];
});

describe('cronjob plugin', () => {
  it('parses schedules and computes due-ness', async () => {
    const { parseSchedule, isDue } = await import(join(pluginsDir, 'cronjob/index.mjs')) as {
      parseSchedule: (s: string) => { kind: string } | null;
      isDue: (j: { schedule: string; lastRun?: string }, now: number) => boolean;
    };
    expect(parseSchedule('every 15m')).toEqual({ kind: 'interval', ms: 900_000 });
    expect(parseSchedule('every 2h')).toEqual({ kind: 'interval', ms: 7_200_000 });
    expect(parseSchedule('daily 07:30')).toEqual({ kind: 'daily', hour: 7, minute: 30 });
    expect(parseSchedule('every 30s')).toBeNull(); // sub-minute refused
    expect(parseSchedule('nesmysl')).toBeNull();

    const now = new Date('2026-07-02T08:00:00Z').getTime();
    expect(isDue({ schedule: 'every 15m' }, now)).toBe(true); // never ran
    expect(isDue({ schedule: 'every 15m', lastRun: new Date(now - 60_000).toISOString() }, now)).toBe(false);
    expect(isDue({ schedule: 'every 15m', lastRun: new Date(now - 16 * 60_000).toISOString() }, now)).toBe(true);
  });

  it('parses one-shot wakeups and fires them exactly once', async () => {
    const { parseOneShot, isDue } = await import(join(pluginsDir, 'cronjob/index.mjs')) as {
      parseOneShot: (s: string, now: number) => number | null;
      isDue: (j: { schedule: string; runAt?: string; lastRun?: string }, now: number) => boolean;
    };
    const now = new Date('2026-07-02T10:00:00Z').getTime();
    expect(parseOneShot('in 20m', now)).toBe(now + 20 * 60_000);
    expect(parseOneShot('in 2h', now)).toBe(now + 2 * 3_600_000);
    expect(parseOneShot('in 10s', now)).toBe(now + 10_000);
    expect(parseOneShot('in 4s', now)).toBeNull(); // below the 5 s floor
    expect(parseOneShot('every 5m', now)).toBeNull();
    const at = parseOneShot('at 18:30', now)!;
    expect(new Date(at).getHours()).toBe(18);
    expect(at).toBeGreaterThan(now);

    const job = { schedule: 'in 20m', runAt: new Date(now + 20 * 60_000).toISOString() };
    expect(isDue(job, now)).toBe(false);
    expect(isDue(job, now + 21 * 60_000)).toBe(true);
    expect(isDue({ ...job, lastRun: new Date(now + 21 * 60_000).toISOString() }, now + 30 * 60_000)).toBe(false); // ran → never again
  });

  it('the cron platform never exposes a `notify` method (the host broadcast would recurse into itself)', async () => {
    const dataRoot = freshDataRoot();
    const reg = await loadPlugins({ dirs: [pluginsDir], enabled: ['cronjob'], dataRoot, logger: log });
    // BrainService.notify() calls every platform whose `notify` is a function; the cron adapter holds
    // the host's own notify sink, so exposing it under that name loops host → cron → host until the
    // stack blows — every cron echo then lands dozens of times on Discord.
    expect(typeof (reg.platforms[0] as { notify?: unknown }).notify).toBe('undefined');
  });

  it('CronAdd/list/remove work in an admin session and are refused otherwise', async () => {
    const dataRoot = freshDataRoot();
    const reg = await loadPlugins({ dirs: [pluginsDir], enabled: ['cronjob'], dataRoot, logger: log });
    expect(reg.platforms.map((p) => p.name)).toEqual(['cron']);
    const add = reg.tools.find((t) => t.name === 'CronAdd')!;
    const list = reg.tools.find((t) => t.name === 'CronList')!;
    const remove = reg.tools.find((t) => t.name === 'CronRemove')!;

    await runWithPolicy(LIMITED, async () => {
      // No account and no owner identity: there is neither a personal target nor instance authority.
      expect(asText(await add.execute('t', { name: 'x', scope: 'personal', schedule: 'every 15m', prompt: 'p' }, undefined as never, undefined as never))).toMatch(/needs an Elowen account/);
      expect(asText(await add.execute('t', { name: 'x', scope: 'instance', schedule: 'every 15m', prompt: 'p' }, undefined as never, undefined as never))).toMatch(/instance owner/);
    });
    await runWithPolicy(ADMIN, async () => {
      expect(asText(await add.execute('t', { name: 'ranní report', scope: 'instance', schedule: 'daily 07:30', prompt: 'shrň stav' }, undefined as never, undefined as never))).toMatch(/Scheduled/);
      expect(asText(await add.execute('t', { name: 'bad', scope: 'instance', schedule: 'every 5s', prompt: 'p' }, undefined as never, undefined as never))).toMatch(/invalid schedule/);
      const listed = asText(await list.execute('t', {}, undefined as never, undefined as never));
      expect(listed).toContain('ranní report');
      const jobs = JSON.parse(readFileSync(join(dataRoot, 'cronjob/jobs.json'), 'utf-8')) as { id: string }[];
      expect(asText(await remove.execute('t', { id: jobs[0]!.id }, undefined as never, undefined as never))).toMatch(/Removed/);
      expect(asText(await list.execute('t', {}, undefined as never, undefined as never))).toBe('No scheduled jobs.');
    }, { identity: OWNER });
  });
});
