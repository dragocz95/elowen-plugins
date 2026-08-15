// @vitest-environment node
/** Adopted from the Elowen package: tests/api/wsTicket.test.ts. */
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
import { createTicketStore } from 'elowen/dist/terminal/ticketStore.js';
import { openPluginTablesDb } from './helpers/pluginTablesDb.js';

function setup() {
  const db = openPluginTablesDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const users = new UserStore(db);
  const admin = users.create('admin', 'pw'); // id 1, is_admin
  const amy = users.create('amy', 'pw');      // id 2
  const config = new ConfigStore(db);
  const tickets = createTicketStore();
  const tasks = new TaskStore(db);
  const readiness = new Readiness(db);
  const projects = new ProjectStore(db);
  const app = createServer({
    tasks, taskRefs: new TaskRefs(db), readiness, missions: new MissionStore(db), bus: new EventBus(),
    engine: null as never, spawn: null as never, tmux: new FakeTmuxDriver() as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config, users, projects, userProjects: new UserProjectStore(db),
    tickets,
    // '/sessions' is plugin-served now; the terminals seam hands the plugin THIS ticket store.
    plugins: domainPluginProvider({ db, tasks, readiness, config, projects, users, terminals: {
      chatTerminalStop: async () => {},
      brainWorkerLive: () => false, brainWorkerAbort: async () => {},
      ticketIssue: (session, userId) => tickets.issue({ session, userId }),
    } }),
  });
  return { app, tickets, adminTok: users.issueToken(admin.id), amyTok: users.issueToken(amy.id), amyId: amy.id };
}
const post = (t: string) => ({ method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: '{}' });

describe('POST /sessions/:name/ws-ticket', () => {
  it('issues a ticket for the caller\'s own advisor session', async () => {
    const { app, amyTok, amyId } = setup();
    const res = await app.request(`/sessions/elowen-advisor-${amyId}/ws-ticket`, post(amyTok));
    expect(res.status).toBe(200);
    expect((await res.json() as { ticket: string }).ticket).toMatch(/^[a-f0-9]+$/);
  });

  it('forbids another user\'s advisor session', async () => {
    const { app, amyTok } = setup();
    const res = await app.request('/sessions/elowen-advisor-1/ws-ticket', post(amyTok)); // admin's advisor
    expect(res.status).toBe(403);
  });

  it('binds the ticket to the requested session', async () => {
    const { app, tickets, amyTok, amyId } = setup();
    const res = await app.request(`/sessions/elowen-advisor-${amyId}/ws-ticket`, post(amyTok));
    const { ticket } = await res.json() as { ticket: string };
    expect(tickets.consume(ticket)).toMatchObject({ session: `elowen-advisor-${amyId}`, userId: amyId });
  });

  it('lets an admin open any session (e.g. a worker)', async () => {
    const { app, tickets, adminTok } = setup();
    const res = await app.request('/sessions/elowen-worker1/ws-ticket', post(adminTok));
    expect(res.status).toBe(200);
    const { ticket } = await res.json() as { ticket: string };
    expect(tickets.consume(ticket)).toMatchObject({ session: 'elowen-worker1' });
  });
});
