// @vitest-environment node
// The schedule draft preview endpoint.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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

let dirs: string[] = [];
const tmpDir = (): string => { const p = mkdtempSync(join(tmpdir(), `elowen-cal-`)); dirs.push(p); return p; };
afterEach(() => {
  vi.useRealTimers();
  for (const p of dirs) rmSync(p, { recursive: true, force: true });
  dirs = [];
});

const pluginsDir = join(process.cwd(), 'plugins');
const PRAGUE = 'Europe/Prague';

function setup(opts: { config?: Record<string, Record<string, unknown>>; timezone?: () => string } = {}) {
  const dataRoot = tmpDir();
  const db = openDb(':memory:');
  const users = new UserStore(db);
  const admin = users.create('admin', 'human', 'pw');
  const amy = users.create('amy', 'human', 'pw');
  users.setGrantedPlugins(amy.id, ['cronjob']);
  const provider = new PluginRegistryProvider(() => loadPlugins({
    dirs: [pluginsDir], enabled: ['cronjob'], dataRoot, delegatedTurnsOutOfProcess: () => false,
    config: opts.config, timezone: opts.timezone ?? (() => PRAGUE),
    pluginDb: (plugin) => makePluginDb(db, plugin, { canMigrate: true }),
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
    project: { id: 1, path: '/o' },
    clock: new FakeClock(0), config: new ConfigStore(db), users, projects: new ProjectStore(db), userProjects: new UserProjectStore(db),
    pluginDataRoot: dataRoot, pluginDirs: [pluginsDir], plugins: provider,
  });
  return { app, dataRoot, amy, adminTok: users.issueToken(admin.id), amyTok: users.issueToken(amy.id) };
}
const seed = (dataRoot: string, jobs: unknown[]): void => {
  mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
  writeFileSync(join(dataRoot, 'cronjob', 'jobs.json'), JSON.stringify(jobs));
};

describe('the schedule draft preview endpoint', () => {
  const post = (tok: string, body: Record<string, unknown>) => ({
    method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  it('answers validity, kind, hours validity and forward occurrences from the server', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T10:00:00Z'));
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
