// @vitest-environment node
/** Adopted from the Elowen package: the `/sessions`-facing half of tests/api/brainTerminalRoutes.test.ts.
 *
 *  The daemon owns BrainTerminalService and the `POST /brain/terminal` RBAC around it, and those tests
 *  stayed there. What moved here is everything observed THROUGH `/sessions`: this plugin root-mounts that
 *  surface, derives a chat terminal's running state into the listing, and routes a DELETE of one back to
 *  the daemon through the `terminals.chatTerminalStop` host seam. */
import { describe, it, expect } from 'vitest';
import { TaskRefs } from 'elowen/dist/store/taskRefs.js';
import { EventBus } from 'elowen/dist/api/sse.js';
import { createServer } from 'elowen/dist/api/server.js';
import { FakeClock } from 'elowen/dist/shared/clock.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { UserStore } from 'elowen/dist/store/userStore.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { UserProjectStore } from 'elowen/dist/store/userProjectStore.js';
import { BrainStore } from 'elowen/dist/store/brainStore.js';
import { FakeTmuxDriver } from 'elowen/dist/tmux/fakeDriver.js';
import { BrainTerminalService } from 'elowen/dist/brain/terminalService.js';
import { freshUserSessionId, brainTerminalName } from 'elowen/dist/brain/sessionId.js';
import { TaskStore } from '../plugins/work/dist/store/taskStore.js';
import { Readiness } from '../plugins/work/dist/store/readiness.js';
import { MissionStore } from '../plugins/agents/dist/store/missionStore.js';
import { openPluginTablesDb } from './helpers/pluginTablesDb.js';
import { domainPluginProvider } from './helpers/domainApp.js';

function setup() {
  const db = openPluginTablesDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'home','/o')").run();
  const users = new UserStore(db);
  const admin = users.create('admin', 'pw'); // id 1, is_admin
  const admin2 = users.create('admin2', 'pw'); // id 2
  users.setAdmin(admin2.id, true);            // a SECOND admin (foreign to admin's session)
  const bob = users.create('bob', 'pw');       // id 3, ordinary full-scope non-admin
  const userProjects = new UserProjectStore(db);
  userProjects.assign(bob.id, 1);
  const brainStore = new BrainStore(db);
  // An admin-owned continuable conversation.
  const sessionId = freshUserSessionId(admin.id);
  brainStore.createSession({ id: sessionId, userId: admin.id, model: 'm' });
  const tmux = new FakeTmuxDriver();
  const brainTerminal = new BrainTerminalService({
    tmux, users, store: brainStore, url: 'http://localhost:4400', cliArgv: ['elowen'],
    terminalDir: (id: number | string) => `/tmp/terminal/${id}`,
  } as never);
  const tasks = new TaskStore(db);
  const readiness = new Readiness(db);
  const config = new ConfigStore(db);
  const projects = new ProjectStore(db);
  const app = createServer({
    tasks, taskRefs: new TaskRefs(db), readiness, missions: new MissionStore(db), bus: new EventBus(),
    engine: null as never, spawn: null as never, tmux: tmux as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config,
    users, projects, userProjects,
    brain: {} as never, brainTerminal, brainStore,
    // '/sessions' is plugin-served — DELETE of a chat terminal routes back to THIS daemon service.
    plugins: domainPluginProvider({ db, tasks, readiness, config, projects, users, tmux, terminals: {
      chatTerminalStop: (userId: number, session: string) => brainTerminal.stop(userId, session),
      brainWorkerLive: () => false, brainWorkerAbort: async () => {},
      ticketIssue: () => 'test-ticket',
    } as never }),
  } as never);
  return {
    app, brainTerminal, tmux, users, brainStore, sessionId,
    adminTok: users.issueToken(admin.id),
    admin2Tok: users.issueToken(admin2.id),
    bobTok: users.issueToken(bob.id),
    adminId: admin.id,
  };
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (app: ReturnType<typeof setup>['app'], tok: string, body: unknown) =>
  app.request('/brain/terminal', { method: 'POST', headers: { ...auth(tok), 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('derived running state via GET /sessions', () => {
  const names = async (app: ReturnType<typeof setup>['app'], tok: string) =>
    ((await (await app.request('/sessions', { headers: auth(tok) })).json()) as { name: string }[]).map((s) => s.name);

  it('shows the chat terminal to its owner admin and hides it from a foreign admin / non-admin', async () => {
    const { app, adminTok, admin2Tok, bobTok, sessionId, adminId } = setup();
    await post(app, adminTok, { session: sessionId });
    const terminal = brainTerminalName(adminId, sessionId);
    expect(await names(app, adminTok)).toContain(terminal);
    expect(await names(app, admin2Tok)).not.toContain(terminal); // invariant 4: no admin bypass on chat
    expect(await names(app, bobTok)).not.toContain(terminal);
  });
});

describe('DELETE /sessions/:name tears the chat terminal down', () => {
  const del = (app: ReturnType<typeof setup>['app'], tok: string, name: string) =>
    app.request(`/sessions/${name}`, { method: 'DELETE', headers: auth(tok) });

  it('refuses a non-owner (403) and, for the owner, revokes the token + drops the binding', async () => {
    const { app, adminTok, admin2Tok, tmux, users, brainStore, sessionId, adminId } = setup();
    await post(app, adminTok, { session: sessionId });
    const terminal = brainTerminalName(adminId, sessionId);
    const token = tmux.argvSpawnFor(terminal)!.env.ELOWEN_TOKEN;

    expect((await del(app, admin2Tok, terminal)).status).toBe(403); // foreign admin refused
    expect(brainStore.getBrainTerminal(terminal)).toBeDefined();     // still intact

    expect((await del(app, adminTok, terminal)).status).toBe(200);   // owner tears it down
    expect(await tmux.list()).not.toContain(terminal);
    expect(users.principalForToken(token)).toBeNull();
    expect(brainStore.getBrainTerminal(terminal)).toBeUndefined();
  });
});
