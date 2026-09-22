// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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
import { openRunJournal } from '../plugins/cronjob/lib/runJournal.mjs';
import { stubConversationDirectory } from './helpers/conversationDirectory.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
// Keep run fixtures inside the journal's detail-retention window.
const BASE = Date.now() - 60 * 60 * 1_000;
const LOCAL_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(BASE);

function setup() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'cron-runs-')); roots.push(dataRoot);
  const db = openDb(':memory:');
  const users = new UserStore(db);
  const admin = users.create('admin', 'human', 'pw');
  const amy = users.create('amy', 'human', 'pw');
  const bob = users.create('bob', 'human', 'pw');
  users.setGrantedPlugins(amy.id, ['cronjob']);
  users.setGrantedPlugins(bob.id, ['cronjob']);
  const journal = openRunJournal(makePluginDb(db, 'cronjob', { canMigrate: true }), { now: () => BASE });
  const provider = new PluginRegistryProvider(() => loadPlugins({
    dirs: [join(process.cwd(), 'plugins')], enabled: ['cronjob'], dataRoot,
    timezone: () => 'Europe/Prague',
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
  const add = (patch: Record<string, unknown> = {}) => {
    const claim = journal.claim({
      claimKey: String(patch.claimKey ?? Math.random()),
      jobId: String(patch.jobId ?? 'job'),
      jobName: String(patch.jobName ?? 'Morning report'),
      ownerUserId: patch.ownerUserId === undefined ? amy.id : patch.ownerUserId,
      lifecycle: 'recurring',
      schedule: 'daily 10:00',
      trigger: patch.trigger ?? 'schedule',
      slotMs: patch.slotMs ?? BASE,
      localDate: patch.localDate ?? LOCAL_DATE,
      localTime: patch.localTime ?? '10:00',
      timezone: 'Europe/Prague',
      startedMs: patch.startedMs ?? BASE,
    });
    journal.start(claim.id, Number(patch.startedMs ?? BASE));
    journal.note(claim.id, {
      sessionId: patch.sessionId ?? 'brain-amy',
      messageId: patch.messageId ?? 'assistant-exact',
    });
    journal.close(claim.id, {
      outcome: patch.outcome ?? 'ok',
      preview: patch.preview ?? 'complete preview',
      errorMessage: patch.errorMessage,
      skipReason: patch.skipReason,
      finishedMs: Number(patch.finishedMs ?? BASE + 1_000),
    });
    return claim.id;
  };
  const auth = (id: number) => ({ headers: { authorization: `Bearer ${users.issueToken(id)}` } });
  return { app, add, auth, admin, amy, bob };
}

describe('cron runs route', () => {
  it('filters by day, outcome and substring with bounded server pagination', async () => {
    const { app, add, auth, amy } = setup();
    for (let index = 0; index < 130; index += 1) {
      add({
        claimKey: `run-${index}`,
        jobId: `job-${index % 2}`,
        jobName: index % 2 ? 'Inventory check' : 'Morning report',
        outcome: index % 3 === 0 ? 'error' : 'ok',
        preview: index % 2 ? 'warehouse result' : 'daily result',
        startedMs: BASE + index,
        finishedMs: BASE + index + 10,
      });
    }
    const response = await app.request(
      `/plugins/cronjob/api/runs?date=${LOCAL_DATE}&outcome=ok&q=morning&limit=100&offset=0`,
      auth(amy.id),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { runs: { outcome: string; jobName: string }[]; total: number };
    expect(body.total).toBeGreaterThan(20);
    expect(body.runs.length).toBeLessThanOrEqual(100);
    expect(body.runs.every((run) => run.outcome === 'ok' && run.jobName === 'Morning report')).toBe(true);
  });

  it('uses a stable keyset cursor when a newer row arrives between selected-day pages', async () => {
    const { app, add, auth, amy } = setup();
    for (let index = 0; index < 55; index += 1) {
      add({ claimKey: `page-${index}`, startedMs: BASE + index, finishedMs: BASE + index + 1 });
    }
    const firstResponse = await app.request(`/plugins/cronjob/api/runs?date=${LOCAL_DATE}&limit=50`, auth(amy.id));
    const first = await firstResponse.json() as { runs: { id: string }[]; nextCursor: string };
    add({ claimKey: 'newer', startedMs: BASE + 10_000, finishedMs: BASE + 10_001 });
    const secondResponse = await app.request(
      `/plugins/cronjob/api/runs?date=${LOCAL_DATE}&limit=50&cursor=${encodeURIComponent(first.nextCursor)}`,
      auth(amy.id),
    );
    const second = await secondResponse.json() as { runs: { id: string }[] };
    expect(new Set([...first.runs, ...second.runs].map((run) => run.id)).size)
      .toBe(first.runs.length + second.runs.length);
  });

  it('reapplies ACL to list and detail, while deleted jobs retain their bounded identity snapshot', async () => {
    const { app, add, auth, admin, amy, bob } = setup();
    const mine = add({ claimKey: 'mine', jobId: 'deleted-job', jobName: 'Deleted identity' });
    const foreign = add({ claimKey: 'foreign', jobId: 'foreign', ownerUserId: bob.id });
    const instance = add({ claimKey: 'instance', jobId: 'instance', ownerUserId: null });

    const mineList = await (await app.request('/plugins/cronjob/api/runs', auth(amy.id))).json() as { runs: { id: string }[] };
    expect(mineList.runs.map((run) => run.id)).toEqual([mine]);
    const adminList = await (await app.request('/plugins/cronjob/api/runs', auth(admin.id))).json() as { runs: { id: string }[] };
    expect(adminList.runs.map((run) => run.id)).toEqual([instance]);
    expect((await app.request(`/plugins/cronjob/api/runs/${foreign}`, auth(admin.id))).status).toBe(404);

    const detail = await (await app.request(`/plugins/cronjob/api/runs/${mine}`, auth(amy.id))).json() as {
      jobId: string; jobName: string; sessionId: string; messageId: string;
    };
    expect(detail).toMatchObject({
      jobId: 'deleted-job', jobName: 'Deleted identity',
      sessionId: 'brain-amy', messageId: 'assistant-exact',
    });
  });

  it('validates cursors and clamps oversized pages to one hundred rows', async () => {
    const { app, add, auth, amy } = setup();
    for (let index = 0; index < 120; index += 1) add({ claimKey: `bound-${index}`, startedMs: BASE + index });
    const bounded = await (await app.request('/plugins/cronjob/api/runs?limit=1000', auth(amy.id))).json() as { runs: unknown[] };
    expect(bounded.runs).toHaveLength(100);
    expect((await app.request('/plugins/cronjob/api/runs?cursor=broken', auth(amy.id))).status).toBe(400);
  });
});
