// @vitest-environment node
// Re-homed from the Elowen package together with the agents plugin. Carries, verbatim:
//   tests/plugins/agents/guideRoute.test.ts
//   tests/plugins/agents/missionDetail.test.ts
//   tests/plugins/agents/integrationsRoutes.test.ts
// The route suites boot a real daemon-shaped app over this repo's own plugin builds.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskRefs } from 'elowen/dist/store/taskRefs.js';
import { EventBus } from 'elowen/dist/api/sse.js';
import { createServer } from 'elowen/dist/api/server.js';
import { FakeClock } from 'elowen/dist/shared/clock.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { UserStore } from 'elowen/dist/store/userStore.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { FakeTmuxDriver } from 'elowen/dist/tmux/fakeDriver.js';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import { PluginRegistryProvider } from 'elowen/dist/plugins/pluginsProvider.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { TaskStore } from '../plugins/work/dist/store/taskStore.js';
import { Readiness } from '../plugins/work/dist/store/readiness.js';
import { MissionStore } from '../plugins/agents/dist/store/missionStore.js';
import { assembleMissionDetail } from '../plugins/agents/dist/api/missionDetail.js';
import { openPluginTablesDb, openWorkDb } from './helpers/pluginTablesDb.js';
import { domainTestHost } from './helpers/domainHost.js';
import { domainPluginProvider, makeDomainApp, PLUGIN_DIR } from './helpers/domainApp.js';

// `/integrations/cli-status` probes nine real binaries with --version (one of them boots a daemon to
// answer), the same cost the detector's own unit tests carry — the work is slow, not stuck.
vi.setConfig({ testTimeout: 30_000 });

// ---- from tests/plugins/agents/guideRoute.test.ts ----

/** GET /tasks/:id/guide is served by the agents plugin (pattern root mount). With no prompts override
 *  the provider renders the real `agent-guide*.md` files from disk — so these tests also guard the
 *  shipped template content, exactly as the old guideService unit tests did. */
function setup(opts: { withMission?: boolean; prompts?: { render(name: string, vars?: Record<string, string>, userId?: number): string; rawTemplate(name: string): string }; createdBy?: number } = {}) {
  const db = openPluginTablesDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const users = new UserStore(db);
  const admin = users.create('admin', 'pw');
  const tasks = new TaskStore(db);
  tasks.create({ id: 'e1', project_id: 1, title: 'E', type: 'epic' });
  const t1 = tasks.create({ id: 't1', project_id: 1, title: 'T', parent_id: opts.withMission !== undefined ? 'e1' : undefined });
  if (opts.createdBy) db.prepare('UPDATE tasks SET created_by = ? WHERE id = ?').run(opts.createdBy, t1.id);
  const missions = new MissionStore(db);
  if (opts.withMission) missions.create({ id: 'm-e1', epic_id: 'e1', autonomy: 'L3', max_sessions: 1 });
  const readiness = new Readiness(db);
  const config = new ConfigStore(db);
  const projects = new ProjectStore(db);
  const app = createServer({
    tasks, taskRefs: new TaskRefs(db), readiness, missions, bus: new EventBus(),
    engine: null as never, spawn: null as never, tmux: new FakeTmuxDriver() as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config, users, projects,
    plugins: domainPluginProvider({ db, tasks, readiness, config, projects, users, ...(opts.prompts ? { prompts: opts.prompts } : {}) }),
  } as never);
  const tok = users.issueToken(admin.id);
  const guide = async (id: string) => app.request(`/tasks/${id}/guide`, { headers: { authorization: `Bearer ${tok}` } });
  return { guide };
}

describe('GET /tasks/:id/guide (plugin-served)', () => {
  it('renders the base control guide for a standalone task (no phase appendix)', async () => {
    const res = await setup().guide('t1');
    expect(res.status).toBe(200);
    const { text } = await res.json() as { text: string };
    expect(text).toContain('First read the project context'); // base how-to-work
    expect(text).toContain('elowen ask'); // the open-question channel, rendered with the resolved cli
    expect(text).toContain('elowen close t1 --summary'); // the close command embeds this task's id
    expect(text).not.toContain('ONE phase of mission'); // no phase appendix for a standalone task
  });

  it('appends the mission-phase guide when the task is a phase of an ACTIVE mission', async () => {
    const res = await setup({ withMission: true }).guide('t1');
    const { text } = await res.json() as { text: string };
    expect(text).toContain('ONE phase of mission e1');
    expect(text).toContain('elowen note ls e1'); // handoff notes, with the epic id
    expect(text).toContain('elowen close e1 --summary'); // the final phase closes the epic
    expect(text).toContain('do NOT run `git commit`'); // VCS is mission-managed
  });

  it('omits the phase appendix when the phase has no active mission', async () => {
    const res = await setup({ withMission: false }).guide('t1');
    const { text } = await res.json() as { text: string };
    expect(text).not.toContain('ONE phase of mission');
  });

  it('returns 404 for an unknown task', async () => {
    expect((await setup().guide('nope')).status).toBe(404);
  });

  it("renders through the owning user's prompt override (passes the resolved ownerId)", async () => {
    const prompts = {
      render: (name: string, vars?: Record<string, string>, userId?: number) =>
        (userId === 1 && name === 'agent-guide' ? `OVERRIDDEN ${vars?.closeCommand}` : `DEFAULT ${name}`),
      rawTemplate: () => '',
    };
    // created_by = 1 (the admin) → the guide renders with that owner's overrides.
    const res = await setup({ prompts, createdBy: 1 }).guide('t1');
    expect(((await res.json()) as { text: string }).text).toBe('OVERRIDDEN elowen close t1');
  });
});

// ---- from tests/plugins/agents/missionDetail.test.ts ----

let tasks: TaskStore; let missions: MissionStore;
beforeEach(() => {
  const db = openPluginTablesDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/var/www/elowen')").run();
  tasks = new TaskStore(db); missions = new MissionStore(db);
});

describe('assembleMissionDetail', () => {
  it('returns null for an unknown mission', () => {
    expect(assembleMissionDetail({ missions, tasks }, 'nope')).toBeNull();
  });

  it('assembles epic, descendant tasks, deps and progress', () => {
    tasks.create({ id: 'epic', project_id: 1, title: 'Epic', type: 'epic' });
    tasks.create({ id: 'a', project_id: 1, title: 'A', parent_id: 'epic' });
    tasks.create({ id: 'b', project_id: 1, title: 'B', parent_id: 'epic' });
    tasks.addDep('b', 'a');
    tasks.setStatus('a', 'closed');
    missions.create({ id: 'm1', epic_id: 'epic', autonomy: 'low', max_sessions: 1 });
    const d = assembleMissionDetail({ missions, tasks }, 'm1')!;
    expect(d.epic?.id).toBe('epic');
    expect(d.tasks.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(d.deps).toEqual([{ taskId: 'b', dependsOnId: 'a' }]);
    expect(d.progress).toEqual({ total: 2, open: 1, inProgress: 0, blocked: 0, closed: 1, cancelled: 0 });
  });
});

// ---- from tests/plugins/agents/integrationsRoutes.test.ts ----

const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });

/** A daemon that DISCOVERS the agents plugin on disk but runs with it disabled — the production shape
 *  on this instance. Its manifest-declared mounts must degrade to the explicit 503. */
function discoveredButDisabled() {
  const db = openPluginTablesDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const users = new UserStore(db);
  const admin = users.create('admin', 'pw');
  const app = createServer({
    missions: new MissionStore(db), bus: new EventBus(), tmux: null as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config: new ConfigStore(db), users, projects: new ProjectStore(db),
    plugins: new PluginRegistryProvider(() => loadPlugins({
      dirs: [PLUGIN_DIR], enabled: [], logger: { info() {}, warn() {}, error() {} },
    })),
    pluginDirs: [PLUGIN_DIR],
  } as never);
  return { app, token: users.issueToken(admin.id) };
}

/** A daemon whose agents plugin is LOADED with `slice` as its own config (plugins.config.agents). The
 *  slice is handed to a plugin at load — a config PATCH reloads the plugin, which is how an edit
 *  applies live — so seeing a slice value means loading with it, exactly as the daemon does. */
function appWithPluginConfig(slice: Record<string, unknown>) {
  const db = openWorkDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const config = new ConfigStore(db);
  config.update({ plugins: { config: { agents: slice } } });
  const users = new UserStore(db);
  const admin = users.create('admin', 'pw');
  const tasks = new TaskStore(db);
  const readiness = new Readiness(db);
  const projects = new ProjectStore(db);
  const bus = new EventBus();
  const app = createServer({
    tasks, missions: new MissionStore(db), bus, tmux: null as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config, users, projects,
    plugins: new PluginRegistryProvider(() => loadPlugins({
      dirs: [PLUGIN_DIR], enabled: ['agents', 'work'],
      logger: { info() {}, warn() {}, error() {} },
      delegatedTurnsOutOfProcess: () => false,
      pluginDb: (plugin: string) => makePluginDb(db, plugin, { canMigrate: true }),
      publishEvent: (e: never) => bus.publish(e),
      subscribeEvents: (fn: never) => bus.subscribe(fn),
      // The daemon reads these from the settings row; the harness passes the same slices through.
      config: config.get().plugins?.config ?? { agents: slice },
      host: domainTestHost({ db, tasks, readiness, config, projects, users }) as never,
    })),
  } as never);
  return { app, token: users.issueToken(admin.id) };
}

describe('GET /integrations/cli-status (agents plugin root mount)', () => {
  it('serves the detector payload while the plugin is loaded', async () => {
    const { app, token } = await makeDomainApp();
    const res = await app.request('/integrations/cli-status', auth(token));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      tools: { name: string; installed: boolean; functional: boolean; version: string | null }[];
      summary: { allInstalled: boolean; allFunctional: boolean };
      freshInstall: { noConfigPersisted: boolean; noApiKey: boolean; noCustomSetup: boolean };
    };
    expect(body.tools).toHaveLength(9);
    expect(typeof body.summary.allInstalled).toBe('boolean');
    // node is what this suite runs on, so it is installed and functional by construction.
    const node = body.tools.find((t) => t.name === 'node')!;
    expect(node).toMatchObject({ installed: true, functional: true });
    expect(typeof node.version).toBe('string');
  });

  it('reads the fresh-install signals through the host config seam', async () => {
    // No settings row was ever written by this app → a fresh install in every signal.
    const fresh = await makeDomainApp();
    const before = await (await fresh.app.request('/integrations/cli-status', auth(fresh.token))).json() as {
      freshInstall: { noConfigPersisted: boolean; noApiKey: boolean; noCustomSetup: boolean };
    };
    expect(before.freshInstall).toEqual({ noConfigPersisted: true, noApiKey: true, noCustomSetup: true });

    // A persisted relay key flips both the config-row and the api-key signal.
    const configured = await makeDomainApp({ apiKey: 'sk-set' });
    const after = await (await configured.app.request('/integrations/cli-status', auth(configured.token))).json() as {
      freshInstall: { noConfigPersisted: boolean; noApiKey: boolean };
    };
    expect(after.freshInstall.noConfigPersisted).toBe(false);
    expect(after.freshInstall.noApiKey).toBe(false);
  });

  it('answers the declared-inactive 503 when the plugin is disabled', async () => {
    const { app, token } = discoveredButDisabled();
    const res = await app.request('/integrations/cli-status', auth(token));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'agents plugin is disabled' });
  });
});

describe('GET /integrations/github-status (agents plugin root mount)', () => {
  it('reports no token when the plugin has none configured', async () => {
    const { app, token } = await makeDomainApp();
    const res = await app.request('/integrations/github-status', auth(token));
    expect(res.status).toBe(200);
    const body = await res.json() as { tokenSet: boolean; method: string; ready: boolean };
    expect(body.tokenSet).toBe(false);
    // Without a token the posture is whatever gh says on this machine — never the token method.
    expect(body.method).not.toBe('token');
  });

  it('reads the token from the plugin config slice and never returns its value', async () => {
    const { app, token } = appWithPluginConfig({ ghToken: 'ghp_slice_secret' });
    const res = await app.request('/integrations/github-status', auth(token));
    const body = await res.json() as { tokenSet: boolean; ready: boolean; method: string };
    expect(body).toMatchObject({ tokenSet: true, ready: true, method: 'token' });
    expect(JSON.stringify(body)).not.toContain('ghp_slice_secret');
  });

  it('still honours the legacy top-level token (pre-migration rollback path)', async () => {
    const { app, token, deps } = await makeDomainApp();
    deps.config.update({ autopilot: { ghToken: 'ghp_legacy_secret' } });
    const body = await (await app.request('/integrations/github-status', auth(token))).json() as { tokenSet: boolean; method: string };
    expect(body).toMatchObject({ tokenSet: true, method: 'token' });
  });

  it('answers the declared-inactive 503 when the plugin is disabled', async () => {
    const { app, token } = discoveredButDisabled();
    const res = await app.request('/integrations/github-status', auth(token));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'agents plugin is disabled' });
  });
});
