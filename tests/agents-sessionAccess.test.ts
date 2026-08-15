// @vitest-environment node
/** Adopted from the Elowen package: tests/api/sessionAccess.test.ts. */
import { MissionStore } from '../plugins/agents/dist/store/missionStore.js';
import { Readiness } from '../plugins/work/dist/store/readiness.js';
import { TaskStore } from '../plugins/work/dist/store/taskStore.js';
import { describe, it, expect } from 'vitest';
import { TaskRefs } from 'elowen/dist/store/taskRefs.js';
import { EventBus } from 'elowen/dist/api/sse.js';
import { createServer } from 'elowen/dist/api/server.js';
import { domainPluginProvider } from './helpers/domainApp.js';
import { FakeClock } from 'elowen/dist/shared/clock.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { UserStore } from 'elowen/dist/store/userStore.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { UserProjectStore } from 'elowen/dist/store/userProjectStore.js';
import { FakeTmuxDriver } from 'elowen/dist/tmux/fakeDriver.js';
import { openPluginTablesDb } from './helpers/pluginTablesDb.js';

// Two projects; bob is assigned to #1 only. A worker session belongs to its task's project, so the
// /sessions list (visibility) must mirror the per-session control gate (operability), not leak globally.
function setup() {
  const db = openPluginTablesDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'home','/o')").run();
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (2,'other','/p2')").run();
  const users = new UserStore(db);
  const admin = users.create('admin', 'pw'); // id 1, is_admin
  const bob = users.create('bob', 'pw');      // id 2
  const userProjects = new UserProjectStore(db);
  userProjects.assign(bob.id, 1);
  const tasks = new TaskStore(db);
  tasks.create({ id: 't1', project_id: 1, title: 'home task' });
  tasks.create({ id: 't2', project_id: 2, title: 'foreign task' });
  tasks.setAgent('t1', 'Nova'); // session elowen-Nova → t1 (project 1)
  tasks.setAgent('t2', 'Zar');  // session elowen-Zar  → t2 (project 2)
  const tmux = new FakeTmuxDriver();
  for (const s of ['elowen-Nova', 'elowen-Zar', `elowen-advisor-${bob.id}`, `elowen-advisor-${admin.id}`]) tmux.setPane(s, '');
  const readiness = new Readiness(db);
  const config = new ConfigStore(db);
  const projects = new ProjectStore(db);
  const app = createServer({
    tasks, taskRefs: new TaskRefs(db), readiness, missions: new MissionStore(db), bus: new EventBus(),
    engine: null as never, spawn: null as never, tmux: tmux as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config,
    users, projects, userProjects,
    // '/sessions' is plugin-served now (same fake tmux, so the list sees the seeded panes).
    plugins: domainPluginProvider({ db, tasks, readiness, config, projects, users, tmux }),
  });
  return { app, adminTok: users.issueToken(admin.id), bobTok: users.issueToken(bob.id), bobId: bob.id, adminId: admin.id };
}
const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const names = async (app: ReturnType<typeof setup>['app'], tok: string) =>
  ((await (await app.request('/sessions', auth(tok))).json()) as { name: string }[]).map((s) => s.name).sort();

describe('GET /sessions tenancy filtering', () => {
  it('shows a non-admin only sessions in their projects plus their own advisor', async () => {
    const { app, bobTok, bobId } = setup();
    expect(await names(app, bobTok)).toEqual(['elowen-Nova', `elowen-advisor-${bobId}`].sort());
  });

  it('shows an admin every running session', async () => {
    const { app, adminTok, bobId, adminId } = setup();
    expect(await names(app, adminTok)).toEqual(['elowen-Nova', 'elowen-Zar', `elowen-advisor-${bobId}`, `elowen-advisor-${adminId}`].sort());
  });
});
