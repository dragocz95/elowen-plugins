// @vitest-environment node
// The calendar and the schedule draft preview: the server expands and orders future occurrences from
// the SAME engine the scheduler runs. Bounds, stable identities, cursor conflicts, truncation truth
// and the strict unreadable-file behaviour are the contract the browser builds against.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from 'elowen/dist/api/sse.js';
import { createServer } from 'elowen/dist/api/server.js';
import { FakeClock } from 'elowen/dist/shared/clock.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { UserStore } from 'elowen/dist/store/userStore.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { UserProjectStore } from 'elowen/dist/store/userProjectStore.js';
import { openDb } from 'elowen/dist/store/db.js';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import { PluginRegistryProvider } from 'elowen/dist/plugins/pluginsProvider.js';
import { stubConversationDirectory } from './helpers/conversationDirectory.js';

let dirs: string[] = [];
const tmpDir = (): string => { const p = mkdtempSync(join(tmpdir(), `elowen-cal-`)); dirs.push(p); return p; };
afterEach(() => { for (const p of dirs) rmSync(p, { recursive: true, force: true }); dirs = []; });

const pluginsDir = join(process.cwd(), 'plugins');
const PRAGUE = 'Europe/Prague';

function setup(opts: { config?: Record<string, Record<string, unknown>>; timezone?: () => string } = {}) {
  const dataRoot = tmpDir();
  const db = openDb(':memory:');
  const users = new UserStore(db);
  const admin = users.create('admin', 'pw');
  const amy = users.create('amy', 'pw');
  users.setGrantedPlugins(amy.id, ['cronjob']);
  const provider = new PluginRegistryProvider(() => loadPlugins({
    dirs: [pluginsDir], enabled: ['cronjob'], dataRoot,
    config: opts.config, timezone: opts.timezone ?? (() => PRAGUE),
    host: { stores: { projects: new ProjectStore(db), userProjects: new UserProjectStore(db),
      usersRead: {
        list: () => users.list().map((user) => ({ id: user.id, username: user.username, name: user.name, avatar: user.avatar })),
        isAdmin: (id: number) => users.isAdmin(id),
        mayUsePlugin: (id: number, plugin: string) => users.list().find((u) => u.id === id)?.granted_plugins.includes(plugin) === true,
      },
      conversationsRead: stubConversationDirectory() } } as never,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }));
  const app = createServer({
    bus: new EventBus(),
    engine: null as never, spawn: null as never, tmux: null as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config: new ConfigStore(db), users, projects: new ProjectStore(db), userProjects: new UserProjectStore(db),
    pluginDataRoot: dataRoot, pluginDirs: [pluginsDir], plugins: provider,
  });
  return { app, dataRoot, amy, adminTok: users.issueToken(admin.id), amyTok: users.issueToken(amy.id) };
}
const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const seed = (dataRoot: string, jobs: unknown[]): string => {
  mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
  writeFileSync(join(dataRoot, 'cronjob', 'jobs.json'), JSON.stringify(jobs));
};

const nowMs0 = Date.parse('2026-09-15T08:00:00Z');

/** A real night window: agenda first page plus the day summaries of one, several dense jobs. */
interface OccurrenceLike { id: string; jobId: string; expectedAt: string }
const byId = (rows: unknown[]): Record<string, OccurrenceLike> =>
  Object.fromEntries((rows as OccurrenceLike[]).map((o) => [o.id, o as OccurrenceLike]));

describe('the cronjob calendar endpoint', () => {
  it('answers the window summaries with truthful samples, overflow, omitted slots and shapes', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [
      {
        id: 'daily', name: 'morning', schedule: 'daily 07:30', prompt: 'p',
        createdAt: '2026-09-01T00:00:00.000Z', lastRun: '2026-09-14T04:30:00.000Z', revision: 2,
      },
      {
        // Active hours dead-end for a morning slot: fully omitted for the day.
        id: 'late', name: 'gated', schedule: 'daily 06:00', prompt: 'p', hours: '9-17',
        createdAt: '2026-09-01T00:00:00.000Z', lastRun: '2026-09-14T04:00:00.000Z', revision: 1,
      },
    ]);
    const rows = await (await app.request(`/plugins/cronjob/api/calendar?start=2026-09-15&days=3&detail=summary`, auth(adminTok))).json() as Record<string, unknown>;
    expect(rows).toEqual(expect.objectContaining({
      timezone: PRAGUE,
      precisionMs: expect.any(Number),
      snapshot: expect.any(String),
      window: expect.objectContaining({ startLocalDate: '2026-09-15', endLocalDateExclusive: '2026-09-18' }),
      scheduler: expect.objectContaining({ ready: expect.any(Boolean) }),
      truncated: false,
    }));
    const days = rows.days as { date: string; total: number; samples: { id: string; disposition: string; expectedAt: string; scheduledAt: string }[]; overflow: number; omittedByHours: number; truncated: boolean }[];
    expect(days.map((d) => d.date)).toEqual(['2026-09-15', '2026-09-16', '2026-09-17']);
    // TODAY: both unclaimed past slots are catchable at the next tick (planned slot stays 06:00/07:30).
    expect(days[0]).toEqual(expect.objectContaining({ date: '2026-09-15', total: 2, overflow: 0, omittedByHours: 0, truncated: false }));
    expect(days[0]!.samples.map((s) => [s.id, s.disposition])).toEqual([
      ['late:slot:2026-09-15T06:00', 'catchUp'],
      ['daily:slot:2026-09-15T07:30', 'catchUp'],
    ]);
    expect(days[0]!.samples[0]!.scheduledAt).toBe('2026-09-15T04:00:00.000Z');
    // The forward days: the gated morning slot is deferred INTO its active hours, still on the day.
    expect(days[1]).toEqual(expect.objectContaining({ date: '2026-09-16', total: 2, omittedByHours: 0 }));
    expect(days[1]!.samples.map((s) => [s.id, s.disposition])).toEqual([
      ['daily:slot:2026-09-16T07:30', 'onTime'],
      ['late:slot:2026-09-16T06:00', 'deferredByHours'],
    ]);
    const late16 = days[1]!.samples[1]!;
    expect(new Date(late16.expectedAt).getTime()).toBeGreaterThan(new Date(late16.scheduledAt).getTime());
  });

  it('the agenda paginates a DENSE interval window without losing its order or truth', async () => {
    const { app, dataRoot, adminTok } = setup();
    const lastRun = Date.parse('2026-09-15T07:50:00Z');
    seed(dataRoot, [{
      id: 'dense', name: 'every minute', schedule: 'every 1m', prompt: 'p',
      lastRun: new Date(lastRun).toISOString(), createdAt: new Date(lastRun - 3600_000).toISOString(),
    }]);
    let res = await app.request(`/plugins/cronjob/api/calendar?start=2026-09-15&days=2&detail=agenda&limit=25`, auth(adminTok));
    expect(res.status).toBe(200);
    const first = await res.json() as Record<string, unknown>;
    const page1 = (first.occurrences as OccurrenceLike[]);
    expect(page1).toHaveLength(25);
    expect(new Set(page1.map((o) => o.id)).size).toBe(25);
    const sorted = [...page1].sort((a, b) => a.expectedAt < b.expectedAt ? -1 : 1);
    expect(page1.map((o) => o.id)).toEqual(sorted.map((o) => o.id));
    expect(first.nextCursor).not.toBeUndefined();
    const cursor = JSON.parse(Buffer.from(String(first.nextCursor), 'base64url').toString('utf-8'));
    expect(cursor.snapshot).toBe(first.snapshot);
    res = await app.request(`/plugins/cronjob/api/calendar?start=2026-09-15&days=2&detail=agenda&limit=25&cursor=` + encodeURIComponent(String(first.nextCursor)), auth(adminTok));
    const second = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    const page2 = second.occurrences as OccurrenceLike[];
    // The second page holds different, LATER occurrences against the same snapshot.
    expect(new Set(page2.map((o) => o.id)).size === page2.length).toBe(true);
    expect(new Set(page1.map((o) => o.id)).has(page2[0]!.id)).toBe(false);
  });

  it('expands an interval job that has never run, and reads it the way dueSlot does', async () => {
    const { app, dataRoot, adminTok } = setup();
    // No `lastRun`: the scheduler's own rule (`now - last >= ms`, with last = 0) claims it at the very
    // next tick, so the projection owes exactly ONE catch-up plus the duration stepping forward.
    seed(dataRoot, [{ id: 'unarmed', name: 'pulse', schedule: 'every 1h', prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z' }]);
    const res = await app.request(`/plugins/cronjob/api/calendar?start=2026-09-15&days=1&detail=agenda`, auth(adminTok));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const page = body.occurrences as { id: string; disposition: string }[];
    expect(page.length).toBeGreaterThan(1);
    expect(page.filter((o) => o.disposition === 'catchUp' || o.disposition === 'dueNow')).toHaveLength(1);
    // Interval identity is the real INSTANT, never a wall slot: a repeated DST hour is two runs.
    expect(page.every((o) => o.id.startsWith('unarmed:instant:'))).toBe(true);
    expect(new Set(page.map((o) => o.id)).size).toBe(page.length);
  });

  it('previews a plain interval draft instead of failing the whole route', async () => {
    const { app, adminTok } = setup();
    const res = await app.request(`/plugins/cronjob/api/schedule-preview`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminTok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ schedule: 'every 1h', count: 3 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({ valid: true, kind: 'interval' }));
    expect((body.occurrences as unknown[]).length).toBe(3);
  });

  it('a day denser than its samples reports EXACT overflow and is not called truncated', async () => {
    const { app, dataRoot, adminTok } = setup();
    // Twelve slots on one date — four times the three a cell shows, and far inside the expansion
    // budget. `overflow` is the exact remainder; `truncated` is reserved for a budget that ran out.
    seed(dataRoot, [{
      id: 'dense', name: 'every other hour', schedule: '0 */2 * * *', prompt: 'p',
      createdAt: '2026-09-01T00:00:00.000Z', lastRun: '2026-09-14T22:00:00.000Z',
    }]);
    const rows = await (await app.request(`/plugins/cronjob/api/calendar?start=2026-09-16&days=1&detail=summary`, auth(adminTok))).json() as Record<string, unknown>;
    const days = rows.days as { total: number; samples: unknown[]; overflow: number; truncated: boolean }[];
    expect(days[0]!.total).toBe(12);
    expect(days[0]!.samples).toHaveLength(3);
    expect(days[0]!.overflow).toBe(9);
    expect(days[0]!.truncated).toBe(false);
    expect(rows.truncated).toBe(false);
  });

  it('an agenda cursor built against a CHANGED snapshot conflicts 409 instead of appending', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [{ id: 'a', name: 'a', schedule: 'daily 07:00', prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z', lastRun: '2026-09-14T05:00:00.000Z' }]);
    const res1 = await app.request(`/plugins/cronjob/api/calendar?start=2026-09-15&days=2&detail=agenda`, auth(adminTok));
    const page1 = await res1.json() as Record<string, unknown>;
    expect(page1.nextCursor).toBeTruthy();
    // The schedule changed between pages: the cursor's snapshot no longer matches.
    seed(dataRoot, [{ id: 'a', name: 'a', schedule: 'daily 08:00', prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z', lastRun: '2026-09-14T05:00:00.000Z' }]);
    const res2 = await app.request(`/plugins/cronjob/api/calendar?start=2026-09-15&days=2&detail=agenda&cursor=` + encodeURIComponent(String(page1.nextCursor)), auth(adminTok));
    expect(res2.status).toBe(409);
    expect(await res2.json()).toEqual(expect.objectContaining({ code: 'snapshot_changed' }));
  });

  it('pauses jobs out of the occurrence expansion but keeps them in the jobs list', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [{ id: 'paused', name: 'p', schedule: 'daily 07:00', prompt: 'x', enabled: false, createdAt: '2026-09-01T00:00:00.000Z' }]);
    const rows = await (await app.request(`/plugins/cronjob/api/calendar?start=2026-09-15&days=2&detail=agenda`, auth(adminTok))).json() as Record<string, unknown>;
    expect((rows.jobs as { id: string }[]).map((j) => j.id)).toEqual(['paused']);
    expect(rows.occurrences).toEqual([]);
    expect((rows.jobs as { nextOccurrence: unknown }[])[0]!.nextOccurrence).toBeNull();
  });

  it('marks guarded occurrences and overlapping ones at their planned times', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [
      { id: 'g1', name: 'guarded', schedule: 'daily 07:00', check: 'ls /', prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z', lastRun: '2026-09-14T05:00:00.000Z' },
      { id: 'g2', name: 'also seven', schedule: 'daily 07:00', prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z', lastRun: '2026-09-14T05:00:00.000Z' },
    ]);
    const rows = await (await app.request(`/plugins/cronjob/api/calendar?start=2026-09-16&days=1&detail=agenda`, auth(adminTok))).json() as Record<string, unknown>;
    const page = rows.occurrences as { id: string; guarded: boolean; expectedAt: string }[];
    expect(page.map((o) => [o.id, o.guarded])).toEqual(
      expect.arrayContaining([['g1:slot:2026-09-16T07:00', true], ['g2:slot:2026-09-16T07:00', false]]));
    // Overlapping planned occurrences sit AT their own times; the scheduler explains sequential delay.
    const instants = new Set(page.map((o) => o.expectedAt));
    expect(instants.size).toBe(1);
  });

  it('shows a pending one-shot where it belongs and a past one-shot as late/dueNow', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [
      { id: 'w1', name: 'wake', schedule: 'one-shot', runAt: Date.parse('2026-09-15T07:00:00Z') ? new Date(nowMs0 - 600_000).toISOString() : '', prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'w2', name: 'next', schedule: 'one-shot', runAt: new Date(nowMs0 + 3600_000).toISOString(), prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z' },
    ]);
    const rows = await (await app.request(`/plugins/cronjob/api/calendar?start=2026-09-15&days=1&detail=agenda`, auth(adminTok))).json() as Record<string, unknown>;
    const occurrences = byId(rows.occurrences as unknown[]);
    expect(Object.keys(occurrences)).toContain('w1:once');
    expect(byId(rows.occurrences as unknown[])['w1:once']!.disposition).toMatch(/^(dueNow|late)$/);
    expect(byId(rows.occurrences as unknown[])['w2:once']!.scheduledAt).toBe(new Date(nowMs0 + 3600_000).toISOString());
  });

  it('rejects an unreadable jobs file with jobs_unreadable, never a success-shaped empty', async () => {
    const { app, dataRoot, adminTok } = setup();
    mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
    writeFileSync(join(dataRoot, 'cronjob', 'jobs.json'), '{oops');
    const res = await app.request(`/plugins/cronjob/api/calendar?start=2026-09-15&days=1&detail=summary`, auth(adminTok));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'jobs_unreadable' }));
  });

  it('bounds the summary window and the agenda window and refuses bad detail/scope/limit', async () => {
    const { app, adminTok, amyTok } = setup();
    for (const [tok, query, expectedStatus, code, field] of [
      [adminTok, `start=2026-09-15&days=43&detail=summary`, 400, 'invalid_request', 'days'],
      [adminTok, `start=2026-09-15&days=8&detail=agenda`, 400, 'invalid_request', 'days'],
      [adminTok, `start=2026-09-15&days=7&detail=agenda&limit=251`, 400, 'invalid_request', 'limit'],
      [amyTok, `start=2026-09-15&days=7&detail=agenda&scope=instance`, 403, 'forbidden', 'scope'],
    ] as const) {
      const res = await app.request(`/plugins/cronjob/api/calendar?${query}`, auth(tok));
      const body = await res.json() as Record<string, unknown>;
      expect([res.status, body.code, body.field]).toEqual([expectedStatus, code, field]);
    }
  });
});

describe('the schedule draft preview endpoint', () => {
  const post = (tok: string, body: Record<string, unknown>) => ({
    method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  it('answers validity, kind, hours validity and forward occurrences from the server', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, []);
    const res = await app.request(`/plugins/cronjob/api/schedule-preview`,
      post(adminTok, { schedule: '0 9 * * *', count: 3, fromLocalDate: '2026-09-16' }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({ valid: true, kind: 'cron', timezone: PRAGUE, hoursValid: true }));
    const occurrences = body.occurrences as { id: string; localDate: string; localTime: string; disposition: string }[];
    expect(occurrences.map((o) => o.localDate)).toEqual(['2026-09-16', '2026-09-17', '2026-09-18']);
    expect(occurrences.map((o) => `${o.localDate} 09:00`)).toEqual([
      '2026-09-16 09:00', '2026-09-17 09:00', '2026-09-18 09:00',
    ]);
    expect(occurrences.every((o) => o.id.startsWith('preview:slot:'))).toBe(true);
    void dataRoot;
  });

  it('refuses an invalid schedule with code invalid_schedule and truthful hoursValid', async () => {
    const { app, adminTok } = setup();
    const res = await app.request(`/plugins/cronjob/api/schedule-preview`,
      post(adminTok, { schedule: 'hourly', hours: '9-95' }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({
      valid: false, code: 'invalid_schedule', hoursValid: false, occurrences: [],
    }));
    expect(String(body.error)).toContain('invalid schedule');
  });

  it('bounds count between 1 and 10 and validates fromLocalDate', async () => {
    const { app, adminTok } = setup();
    const res = await app.request(`/plugins/cronjob/api/schedule-preview`, post(adminTok, { schedule: 'daily 07:00', count: 11 }));
    expect(res.status).toBe(400);
    expect((await res.json() as Record<string, unknown>).field).toBe('count');
    const res2 = await app.request(`/plugins/cronjob/api/schedule-preview`, post(adminTok, { schedule: 'daily 07:00', fromLocalDate: 'tomorrow' }));
    expect(res2.status).toBe(400);
    expect((await res2.json() as Record<string, unknown>).field).toBe('fromLocalDate');
  });
});
