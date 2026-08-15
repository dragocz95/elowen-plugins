// @vitest-environment node
/** Adopted from the Elowen package: the `missions` rows of tests/api/systemReadiness.test.ts.
 *
 *  GET /system/readiness is the daemon's route and the daemon still owns the report's shape — that a
 *  plugin's contributed row slots between its own, and that a missing or throwing contributor costs
 *  only that row. What is pinned HERE is the row this plugin contributes: the planner and overseer need
 *  either the OpenAI-compatible relay or a configured pilot CLI, and the answer an operator reads on
 *  first run must say which one is missing. */
import { describe, it, expect } from 'vitest';
import { TaskRefs } from 'elowen/dist/store/taskRefs.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { EventBus } from 'elowen/dist/api/sse.js';
import { createServer } from 'elowen/dist/api/server.js';
import { FakeClock } from 'elowen/dist/shared/clock.js';
import { ConfigStore, type ConfigPatch } from 'elowen/dist/store/configStore.js';
import { TaskStore } from '../plugins/work/dist/store/taskStore.js';
import { Readiness } from '../plugins/work/dist/store/readiness.js';
import { MissionStore } from '../plugins/agents/dist/store/missionStore.js';
import { openPluginTablesDb } from './helpers/pluginTablesDb.js';
import { domainPluginProvider } from './helpers/domainApp.js';

interface ReadinessCheck { id: string; label: string; ok: boolean; detail: string; hint?: string }
interface ReadinessResponse { checks: ReadinessCheck[] }

function makeApp(over: { model?: string | null; patch?: ConfigPatch } = {}) {
  const db = openPluginTablesDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const config = new ConfigStore(db);
  if (over.patch) config.update(over.patch);
  // Only resolvableModel() is exercised by the route — a minimal fake stands in for BrainService.
  const brain = { resolvableModel: () => (over.model === undefined ? null : over.model) };
  const tasks = new TaskStore(db);
  const readiness = new Readiness(db);
  const projects = new ProjectStore(db);
  const app = createServer({
    tasks, taskRefs: new TaskRefs(db), readiness, missions: new MissionStore(db),
    bus: new EventBus(), engine: null as never, spawn: null as never, tmux: null as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config, projects,
    plugins: domainPluginProvider({ db, tasks, readiness, config, projects }),
    brain: brain as never,
  } as never);
  return { app };
}

async function getChecks(app: ReturnType<typeof makeApp>['app']): Promise<{ status: number; body: ReadinessResponse }> {
  const res = await app.request('/system/readiness');
  return { status: res.status, body: await res.json() as ReadinessResponse };
}

describe('GET /system/readiness — the agents plugin\'s contributed row', () => {
  it('sits between the daemon\'s own tasks and memory rows', async () => {
    const { app } = makeApp({ model: 'm' });
    const { status, body } = await getChecks(app);
    expect(status).toBe(200);
    expect(body.checks.map((c) => c.id)).toEqual(['chat', 'tasks', 'missions', 'memory', 'platforms', 'plugins']);
  });

  it('missions: ok via the autopilot relay (legacy top-level key)', async () => {
    const { app } = makeApp({ model: 'm', patch: { autopilot: { apiKey: 'sk-test' } } });
    const { body } = await getChecks(app);
    expect(body.checks[2]).toEqual({ id: 'missions', label: 'Missions', ok: true, detail: 'relay configured' });
  });

  it('missions: ok via a configured pilot CLI exec when no relay is set', async () => {
    const { app } = makeApp({ model: 'm', patch: { autopilot: { pilotExec: 'claude:sonnet' } } });
    const { body } = await getChecks(app);
    expect(body.checks[2]).toEqual({ id: 'missions', label: 'Missions', ok: true, detail: 'claude:sonnet' });
  });

  it('missions: not ok when neither the relay nor a pilot exec is configured', async () => {
    const { app } = makeApp({ model: 'm' });
    const { body } = await getChecks(app);
    expect(body.checks[2]).toEqual({
      id: 'missions', label: 'Missions', ok: false, detail: 'not set',
      hint: 'Missions need an OpenAI-compatible key or an installed agent CLI.',
    });
  });
});
