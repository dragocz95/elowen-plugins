// @vitest-environment node
/** Adopted from the Elowen package: tests/api/taskChangedDiff.test.ts. */
import { describe, it, expect } from 'vitest';
import { TaskRefs } from 'elowen/dist/store/taskRefs.js';
import { TaskStore } from '../plugins/work/dist/store/taskStore.js';
import { Readiness } from '../plugins/work/dist/store/readiness.js';
import { MissionStore } from '../plugins/agents/dist/store/missionStore.js';
import { EventBus } from 'elowen/dist/api/sse.js';
import { createServer } from 'elowen/dist/api/server.js';
import { domainPluginProvider } from './helpers/domainApp.js';
import { FakeClock } from 'elowen/dist/shared/clock.js';
import { FakeTmuxDriver } from 'elowen/dist/tmux/fakeDriver.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { UserStore } from 'elowen/dist/store/userStore.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { UserProjectStore } from 'elowen/dist/store/userProjectStore.js';
import { openPluginTablesDb } from './helpers/pluginTablesDb.js';

function setup() {
  const db = openPluginTablesDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'home','/o')").run();
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (2,'other','/p2')").run();
  const users = new UserStore(db);
  users.create('admin', 'pw'); // claims the bootstrap-admin slot so bob is a plain member (access gate stays meaningful)
  const bob = users.create('bob', 'pw');
  const userProjects = new UserProjectStore(db);
  userProjects.assign(bob.id, 1);
  const tasks = new TaskStore(db);
  tasks.create({ id: 't1', project_id: 1, title: 'home task' });
  tasks.create({ id: 't2', project_id: 2, title: 'foreign task' });
  const readiness = new Readiness(db);
  const config = new ConfigStore(db);
  const projects = new ProjectStore(db);
  const bus = new EventBus();
  const app = createServer({
    tasks, taskRefs: new TaskRefs(db), missions: new MissionStore(db), bus,
    engine: null as never, tmux: null as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config,
    users, projects, userProjects,
    // The task HTTP surface is served by the work plugin now — load it over these very stores.
    plugins: domainPluginProvider({ db, tasks, readiness, config, projects, users, bus, tmux: new FakeTmuxDriver() }),
  });
  return { app, bobTok: users.issueToken(bob.id) };
}
const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });

describe('GET /tasks/:id/changed/diff', () => {
  it('returns an empty diff for a task with no snapshot (not yet closed)', async () => {
    const { app, bobTok } = setup();
    const r = await app.request('/tasks/t1/changed/diff?path=a.ts', auth(bobTok));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ diff: '' });
  });

  it('gates by the task project (403) and 404s an unknown task', async () => {
    const { app, bobTok } = setup();
    expect((await app.request('/tasks/t2/changed/diff?path=a.ts', auth(bobTok))).status).toBe(403);
    expect((await app.request('/tasks/nope/changed/diff?path=a.ts', auth(bobTok))).status).toBe(404);
  });
});
