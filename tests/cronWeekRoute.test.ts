// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from 'elowen/dist/api/sse.js';
import { createServer } from 'elowen/dist/api/server.js';
import { FakeClock } from './helpers/fakeClock.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { UserStore } from 'elowen/dist/store/userStore.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { UserProjectStore } from 'elowen/dist/store/userProjectStore.js';
import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import { PluginRegistryProvider } from 'elowen/dist/plugins/pluginsProvider.js';
import { stubConversationDirectory } from './helpers/conversationDirectory.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const PRAGUE = 'Europe/Prague';

function setup() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'cron-week-')); roots.push(dataRoot);
  const db = openDb(':memory:');
  const users = new UserStore(db);
  const admin = users.create('admin', 'human', 'pw');
  const amy = users.create('amy', 'human', 'pw');
  users.setGrantedPlugins(amy.id, ['cronjob']);
  const provider = new PluginRegistryProvider(() => loadPlugins({
    dirs: [join(process.cwd(), 'plugins')], enabled: ['cronjob'], dataRoot,
    timezone: () => PRAGUE,
    pluginDb: (plugin) => makePluginDb(db, plugin, { canMigrate: true }),
    host: { stores: {
      projects: new ProjectStore(db), userProjects: new UserProjectStore(db),
      usersRead: {
        list: () => users.list().map((user) => ({
          id: user.id, username: user.username, name: user.name, avatar: user.avatar,
        })),
        isAdmin: (id: number) => users.isAdmin(id),
        mayUsePlugin: (id: number, plugin: string) =>
          users.list().find((user) => user.id === id)?.granted_plugins.includes(plugin) === true,
      },
      conversationsRead: stubConversationDirectory(),
    } } as never,
    logger: { info() {}, warn() {}, error() {} },
  }));
  const app = createServer({
    bus: new EventBus(), engine: null as never, spawn: null as never, tmux: null as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config: new ConfigStore(db), users,
    projects: new ProjectStore(db), userProjects: new UserProjectStore(db),
    pluginDataRoot: dataRoot, pluginDirs: [join(process.cwd(), 'plugins')], plugins: provider,
  });
  const seed = (jobs: unknown[]) => {
    mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
    writeFileSync(join(dataRoot, 'cronjob', 'jobs.json'), JSON.stringify(jobs));
  };
  const auth = { headers: { authorization: `Bearer ${users.issueToken(admin.id)}` } };
  return { app, seed, auth };
}

describe('cron week route', () => {
  it('returns seven ordered days, one bounded card per fixed job/day and no interval cards', async () => {
    const { app, seed, auth } = setup();
    seed([
      { id: 'poll2', name: 'Two-minute poll', schedule: 'every 2m', prompt: 'p', createdAt: '2026-09-01T00:00:00Z' },
      { id: 'dense', name: 'Three times', schedule: '0 7,12,18 * * *', prompt: 'p', createdAt: '2026-09-01T00:00:00Z' },
    ]);
    const response = await app.request('/plugins/cronjob/api/week?start=2026-09-14', auth);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      days: { localDate: string; cards: { jobId: string; localTime: string; moreTimes: string[]; remaining: number }[]; dayTotal: number }[];
      intervals: { jobId: string; remainingToday: number }[];
      window: { startLocalDate: string; endLocalDateExclusive: string };
    };
    expect(body.window).toEqual({ startLocalDate: '2026-09-14', endLocalDateExclusive: '2026-09-21' });
    expect(body.days.map((day) => day.localDate)).toEqual([
      '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17',
      '2026-09-18', '2026-09-19', '2026-09-20',
    ]);
    expect(body.days.every((day) => day.cards.every((card) => card.jobId !== 'poll2'))).toBe(true);
    expect(body.intervals.map((row) => row.jobId)).toEqual(['poll2']);
    for (const day of body.days) {
      expect(day.cards).toHaveLength(1);
      expect(day.dayTotal).toBe(1);
      expect(day.cards[0]).toMatchObject({
        jobId: 'dense', localTime: '07:00', moreTimes: ['12:00', '18:00'], remaining: 3,
      });
    }
    expect(JSON.stringify(body).length).toBeLessThan(20_000);
  });

  it('reports exact dayTotal beyond the six-card render cap without expanding dense schedules', async () => {
    const { app, seed, auth } = setup();
    seed(Array.from({ length: 9 }, (_, index) => ({
      id: `daily-${index}`, name: `Daily ${index}`, schedule: `daily 0${index}:00`,
      prompt: 'p', createdAt: '2026-09-01T00:00:00Z',
    })));
    const response = await app.request('/plugins/cronjob/api/week?start=2026-09-14&days=1', auth);
    const body = await response.json() as { days: { cards: unknown[]; dayTotal: number }[]; intervals: unknown[] };
    expect(response.status).toBe(200);
    expect(body.days).toHaveLength(1);
    expect(body.days[0]).toMatchObject({ dayTotal: 9 });
    expect(body.days[0]!.cards).toHaveLength(9);
    expect(body.intervals).toEqual([]);
  });

  it('keeps local dates contiguous through the Prague DST fallback week', async () => {
    const { app, seed, auth } = setup();
    seed([{ id: 'daily', name: 'Daily', schedule: 'daily 02:30', prompt: 'p', createdAt: '2026-09-01T00:00:00Z' }]);
    const response = await app.request('/plugins/cronjob/api/week?start=2026-10-19', auth);
    const body = await response.json() as { days: { localDate: string; cards: unknown[] }[] };
    expect(body.days.map((day) => day.localDate)).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22',
      '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
    expect(body.days.every((day) => day.cards.length === 1)).toBe(true);
  });

  it('rejects invalid start and day counts', async () => {
    const { app, seed, auth } = setup();
    seed([]);
    for (const query of ['start=2026-02-30', 'days=31']) {
      const response = await app.request(`/plugins/cronjob/api/week?${query}`, auth);
      expect(response.status).toBe(400);
    }
  });
});
