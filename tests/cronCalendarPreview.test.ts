// @vitest-environment node
// The day board endpoint and the schedule draft preview.
//
// The day board's whole contract is that it is BOUNDED: one row per visible job for one local date,
// with counts computed from the same engine the scheduler runs rather than from an expansion. These
// tests hold it to the case that broke the month view — real polling jobs, which produced 455 to 1253
// occurrences for a single day — plus the day-length, placement and refusal behaviour around it.
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
void nowMs0;

/** The scheduler's own today, derived the same way the endpoint derives it. Dates are computed rather
 *  than written down, so these tests keep meaning something the day after they were written. */
const todayIn = (timezone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shiftDate = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
};

interface DayRow {
  jobId: string;
  section: 'next' | 'recurring' | 'oneShot';
  kind: string | null;
  schedule: string | null;
  enabled: boolean;
  remaining: number;
  next: { localTime: string; disposition: string; guarded: boolean } | null;
  moreTimes: string[];
  truncated: boolean;
}
interface DayBody {
  todayLocalDate: string;
  nowLocalTime: string;
  localDate: string;
  timezone: string;
  rows: DayRow[];
  jobs: { id: string; nextOccurrence: unknown }[];
  truncated: boolean;
}
const getDay = async (app: { request: (path: string, init?: unknown) => Promise<Response> }, tok: string, query = ''): Promise<DayBody> => {
  const res = await app.request(`/plugins/cronjob/api/day${query}`, auth(tok));
  expect(res.status).toBe(200);
  return await res.json() as DayBody;
};

describe('the cronjob day endpoint', () => {
  it('answers a real polling instance with ONE row per job and a COUNT, never an occurrence list', async () => {
    const { app, dataRoot, adminTok } = setup();
    // The acceptance fixture: the shape of the instance that broke the month view. Two-minute and
    // fifteen-minute polls are 720 and 96 runs a day EACH; the old surface drew every one of them.
    const jobs = [
      { id: 'poll2', name: 'inbox poll', schedule: 'every 2m', prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'poll15', name: 'feed poll', schedule: 'every 15m', prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'digest', name: 'digest', schedule: 'daily 07:30', prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z' },
    ];
    seed(dataRoot, jobs);
    const body = await getDay(app, adminTok);

    // One row per job. This is the invariant the redesign exists for.
    expect(body.rows).toHaveLength(3);
    expect(body.rows.map((r) => r.jobId).sort()).toEqual(['digest', 'poll15', 'poll2']);
    expect(new Set(body.rows.map((r) => r.jobId)).size).toBe(body.rows.length);

    const poll2 = body.rows.find((r) => r.jobId === 'poll2')!;
    expect(poll2.section).toBe('recurring');
    expect(poll2.kind).toBe('interval');
    // A rate, not a list: the count is real and large, and nothing was built to produce it.
    expect(poll2.remaining).toBeGreaterThan(50);
    expect(poll2.moreTimes).toEqual([]);
    expect(poll2.next).not.toBeNull();

    // Nothing anywhere in the response is proportional to the number of runs.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('"occurrences"');
    expect(serialized).not.toContain('"samples"');
    const total = body.rows.reduce((sum, row) => sum + 1 + row.moreTimes.length, 0);
    expect(total).toBeLessThan(20);
  });

  it('opens on the scheduler own today when the request names no date at all', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, []);
    const body = await getDay(app, adminTok);
    // The initial load carries NO range: no start, no days, no detail, no cursor. There is nothing in
    // the contract a browser could accidentally turn into a month or a week.
    expect(body.localDate).toBe(todayIn(PRAGUE));
    expect(body.todayLocalDate).toBe(body.localDate);
    expect(body.nowLocalTime).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
  });

  it('names a fixed-time job several times in ONE row and counts the rest exactly', async () => {
    const { app, dataRoot, adminTok } = setup();
    // Every other hour: twelve slots on a full day, far more than one row shows inline.
    const target = shiftDate(todayIn(PRAGUE), 1);
    seed(dataRoot, [{
      id: 'dense', name: 'every other hour', schedule: '0 */2 * * *', prompt: 'p',
      createdAt: '2026-09-01T00:00:00.000Z',
    }]);
    const body = await getDay(app, adminTok, `?date=${target}`);
    expect(body.rows).toHaveLength(1);
    const row = body.rows[0]!;
    expect(row.section).toBe('next');
    expect(row.remaining).toBe(12);
    // The head names a bounded few; `remaining` stays the whole truth about the day.
    expect(row.next!.localTime).toBe('00:00');
    expect(row.moreTimes).toEqual(['02:00', '04:00', '06:00']);
    expect(row.truncated).toBe(false);
  });

  it('measures the day the calendar says it is, not a fixed 24 hours', async () => {
    const { app, dataRoot, adminTok } = setup();
    // 25 October 2026 is Prague's fall-back day: 25 hours long, so an hourly job runs 25 times.
    seed(dataRoot, [{ id: 'hourly', name: 'hourly', schedule: 'every 1h', prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z' }]);
    const dstDay = await getDay(app, adminTok, '?date=2026-10-25');
    const plainDay = await getDay(app, adminTok, '?date=2026-10-26');
    expect(dstDay.rows[0]!.remaining).toBe(25);
    expect(plainDay.rows[0]!.remaining).toBe(24);
  });

  it('keeps today a full inventory: a paused job stays, and leaves another day alone', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [{ id: 'paused', name: 'p', schedule: 'daily 07:00', prompt: 'x', enabled: false, createdAt: '2026-09-01T00:00:00.000Z' }]);
    const today = await getDay(app, adminTok);
    expect(today.rows).toHaveLength(1);
    expect(today.rows[0]).toEqual(expect.objectContaining({
      jobId: 'paused', section: 'recurring', enabled: false, remaining: 0, next: null,
    }));
    expect(today.jobs[0]!.nextOccurrence).toBeNull();
    // A different day is only what is SCHEDULED on it; a paused job is not.
    const later = await getDay(app, adminTok, `?date=${shiftDate(todayIn(PRAGUE), 3)}`);
    expect(later.rows).toEqual([]);
  });

  it('places a pending one-shot on its own day and a missed one on today', async () => {
    const { app, dataRoot, adminTok } = setup();
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    seed(dataRoot, [
      { id: 'late', name: 'wake', schedule: 'one-shot', runAt: new Date(Date.now() - 6 * 3_600_000).toISOString(), prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'soon', name: 'next', schedule: 'one-shot', runAt: soon, prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z' },
    ]);
    const body = await getDay(app, adminTok);
    const late = body.rows.find((r) => r.jobId === 'late')!;
    // A one-shot whose time has passed is claimed on the NEXT tick, so it belongs to today — showing
    // it only on the day it was meant for would hide the one thing still waiting to happen.
    expect(late.section).toBe('oneShot');
    expect(late.next!.disposition).toMatch(/^(dueNow|late)$/);
    expect(body.rows.find((r) => r.jobId === 'soon')!.section).toBe('oneShot');
  });

  it('marks a guarded job and reads active hours as a deferral, not a disappearance', async () => {
    const { app, dataRoot, adminTok } = setup();
    const target = shiftDate(todayIn(PRAGUE), 1);
    seed(dataRoot, [
      { id: 'g1', name: 'guarded', schedule: 'daily 07:00', check: 'ls /', prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'gated', name: 'gated', schedule: 'daily 06:00', hours: '9-17', prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z' },
    ]);
    const body = await getDay(app, adminTok, `?date=${target}`);
    expect(body.rows.find((r) => r.jobId === 'g1')!.next!.guarded).toBe(true);
    const gated = body.rows.find((r) => r.jobId === 'gated')!;
    expect(gated.remaining).toBe(1);
    expect(gated.next!.disposition).toBe('deferredByHours');
  });

  it('rejects an unreadable jobs file with jobs_unreadable, never a success-shaped empty', async () => {
    const { app, dataRoot, adminTok } = setup();
    mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
    writeFileSync(join(dataRoot, 'cronjob', 'jobs.json'), '{oops');
    const res = await app.request(`/plugins/cronjob/api/day`, auth(adminTok));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'jobs_unreadable' }));
  });

  it('refuses a date that is not a real local calendar date', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, []);
    for (const bad of ['tomorrow', '2026-9-1', '2026-02-30']) {
      const res = await app.request(`/plugins/cronjob/api/day?date=${encodeURIComponent(bad)}`, auth(adminTok));
      const body = await res.json() as Record<string, unknown>;
      expect([res.status, body.code, body.field]).toEqual([400, 'invalid_request', 'date']);
    }
  });

  it('ships exactly the jobs the reader may address, so the browser can filter without a request', async () => {
    const { app, dataRoot, adminTok, amyTok, amy } = setup();
    seed(dataRoot, [
      { id: 'hers', name: 'hers', schedule: 'daily 07:00', prompt: 'p', ownerUserId: amy.id, createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'instance', name: 'instance', schedule: 'daily 08:00', prompt: 'p', createdAt: '2026-09-01T00:00:00.000Z' },
    ]);
    // Another account's personal job is nobody else's to see — not even an administrator's. That rule
    // is the scheduler's, unchanged, and it is WHY the board can hand the whole visible set to the
    // browser: the owner filter narrows what is already authorized instead of asking the server again.
    const asAdmin = await getDay(app, adminTok);
    expect(asAdmin.jobs.map((j) => j.id)).toEqual(['instance']);
    // And an instance job is the administrator's: Amy holds her own row and nothing else.
    const asAmy = await getDay(app, amyTok);
    expect(asAmy.jobs.map((j) => j.id)).toEqual(['hers']);
    expect(asAmy.rows.map((r) => r.jobId)).toEqual(['hers']);
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
