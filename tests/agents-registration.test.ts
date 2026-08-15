// @vitest-environment node
// Adopted from the Elowen package when the agents plugin moved into this registry. Carries, verbatim:
//   tests/plugins/agents/register.test.ts
//   tests/plugins/agents/config.test.ts
//   tests/plugins/agents/runtime.test.ts
// The loader, stores and log sink come from the published daemon; the plugin under test is THIS repo's
// own build, loaded from PLUGIN_DIR rather than process.cwd().
import { describe, it, expect } from 'vitest';
import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { TaskRefs } from 'elowen/dist/store/taskRefs.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { FakeTmuxDriver } from 'elowen/dist/tmux/fakeDriver.js';
import { EventBus } from 'elowen/dist/api/sse.js';
import type { ElowenEvent } from 'elowen/dist/api/sse.js';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import { logger as coreLogger, setLogSink } from 'elowen/dist/shared/logger.js';
import { PluginLogBuffer } from 'elowen/dist/shared/logBuffer.js';
import type { PluginHostConfig, PluginLogger } from 'elowen/dist/plugins/api.js';
import { TaskStore } from '../plugins/work/dist/store/taskStore.js';
import { Readiness } from '../plugins/work/dist/store/readiness.js';
import { TaskUsageStore } from '../plugins/work/dist/store/taskUsageStore.js';
import { agentsPluginConfig } from '../plugins/agents/dist/config.js';
import { AGENTS_MIGRATIONS } from '../plugins/agents/dist/store/migrations.js';
import { buildAgentsRuntime, type AgentsRuntimeDeps } from '../plugins/agents/dist/runtime.js';
import { DECISION_SWEEP_MS } from '../plugins/agents/dist/overseer/livenessSweep.js';
import { openPluginTablesDb } from './helpers/pluginTablesDb.js';
import { PLUGIN_DIR } from './helpers/domainApp.js';

// ---- from tests/plugins/agents/register.test.ts ----

/** Load the REAL on-disk agents plugin (plugins/agents → dist/index.js, so `npm run build:ts` must have
 *  built it) against a full fake host wiring. This is the B2b activation proof: the daemon reaches the
 *  subsystem exclusively through what register() registers. */
async function loadAgentsPlugin(logger?: PluginLogger) {
  const db = openPluginTablesDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const tasks = new TaskStore(db);
  const projects = new ProjectStore(db);
  const bus = new EventBus();
  const tmux = new FakeTmuxDriver();
  const published: ElowenEvent[] = [];
  bus.subscribe((e) => published.push(e));
  const config = {
    get: () => ({ autopilot: { overseerExec: '', pilotExec: '', model: 'm', overseerModel: '', tddMode: false, prEnabled: false, prBaseBranch: '', prVerifyCommand: '', prAutoOpen: false, prompt: '' }, allowedExecs: [], modelNotes: {}, defaults: {}, providers: {} }),
    autopilotRelay: () => null,
    hasSettings: () => true,
    legacyGhToken: () => null,
  } as unknown as PluginHostConfig;
  const registry = await loadPlugins({
    dirs: [PLUGIN_DIR],
    // The plugin under test declares that its control is built on the `tasks` domain, so the generation
    // must contain that domain's OWNER for the control to resolve — the same composition the daemon has.
    enabled: ['agents', 'work'],
    delegatedTurnsOutOfProcess: () => false,
    pluginDb: (plugin) => makePluginDb(db, plugin, { canMigrate: true }),
    publishEvent: (e) => bus.publish(e),
    subscribeEvents: (fn) => bus.subscribe(fn),
    host: {
      tmux,
      brainWorker: () => undefined,
      elowenCli: { cli: 'elowen', cliArgv: ['elowen'], url: 'http://localhost:0', token: 't', tokenForTask: () => undefined },
      stores: {
        tasks, taskRefs: new TaskRefs(db),
        projects,
        homeProject: () => ({ id: 1, slug: 'elowen', path: '/o' }),
        usersRead: { list: () => [{ id: 1, username: 'admin', isAdmin: true }], isAdmin: () => true, allowedExecs: () => [] },
        readiness: new Readiness(db),
        taskUsage: new TaskUsageStore(db),
        // The domain has an owner in this wiring — what the plugin asks before it builds anything.
        tasksAvailable: () => true,
      },
      prompts: { render: (name: string) => `[${name}]`, rawTemplate: (name: string) => `[raw:${name}]` },
      config,
      relayClient: () => ({ decide: async () => ({ text: '' }) }) as never,
      git: { projectHead: async () => '', projectRangeDiff: async () => [] } as never,
      push: () => ({ sendToUsers: async () => {} }),
    },
    logger: logger ?? { info() {}, warn() {}, error() {} },
  });
  return { registry, db, tasks, tmux, bus, published };
}

describe('agents plugin register() (B2b activation)', () => {
  it('loads from disk and registers the full host lifecycle: services, intervals, reconciles, resolver', async () => {
    const { registry } = await loadAgentsPlugin();
    const services = registry.services.filter((s) => s.plugin === 'agents').map((s) => s.service.name);
    // runtime-teardown FIRST: PluginServiceRunner.stopAll stops newest-first, so registering the
    // teardown first makes it run LAST — after the deriver loop and every interval has stopped.
    expect(services[0]).toBe('runtime-teardown');
    expect(services).toContain('deriver');
    // The interval sweeps land as services too (registerInterval wraps them) — original core periods.
    for (const name of ['engine-tick', 'scheduler-tick', 'janitor', 'stuck-detector', 'overseer-watchdog', 'decision-sweep', 'pr-feedback']) {
      expect(services).toContain(name);
    }
    expect(services).toHaveLength(9);
    expect(registry.bootReconciles.filter((r) => r.plugin === 'agents')).toHaveLength(3); // zombies + overseers + skill self-heal
    expect(registry.eventProjectResolvers.filter((r) => r.plugin === 'agents')).toHaveLength(1);
    // The persistence side too: mission/review/decision/message/signal rows come from the plugin now.
    const rowResolver = registry.eventRowResolvers.find((r) => r.plugin === 'agents')!.fn;
    expect(rowResolver({ type: 'mission', missionId: 'm-e1', state: 'active' } as ElowenEvent))
      .toEqual({ type: 'mission', target: 'm-e1', detail: 'active', labelTitleId: 'e1' });
    expect(rowResolver({ type: 'task', taskId: 't1', status: 'open' } as ElowenEvent)).toBeUndefined(); // core's
  });

  it("control('missions') passes the registry's typed narrowing and exposes every accessor", async () => {
    const { registry } = await loadAgentsPlugin();
    const control = registry.control('missions');
    expect(control).toBeDefined();
    // The control is keyed by the DOMAIN it implements, never by the plugin that happens to implement it:
    // a consumer asking for a capability must not have to know the package's name (and must keep working
    // if this plugin is renamed or replaced). The registry must therefore hold NO 'agents' key at all.
    expect(registry.controls.has('missions')).toBe(true);
    expect(registry.controls.has('agents')).toBe(false);
    expect(registry.controlOwner.get('missions')).toBe('agents');
    // Accessors build the runtime lazily and return the live services.
    expect(typeof control!.engine().tick).toBe('function');
    expect(typeof control!.spawn().launch).toBe('function');
    expect(typeof control!.planFlow().planEngage).toBe('function');
    expect(typeof control!.planJobs().create).toBe('function');
    expect(typeof control!.decisionQueue().enqueue).toBe('function');
    expect(typeof control!.missionGit().worktreeFor).toBe('function');
    expect(typeof control!.agents().programFor).toBe('function');
    expect(typeof control!.gitLock().run).toBe('function');
    // Repeated access returns the SAME runtime (lazy singleton, not a rebuild per call).
    expect(control!.engine()).toBe(control!.engine());
  });

  it('e2e smoke: engage → tick drives a phase to in_progress with a live fake-tmux session', async () => {
    const { registry, tasks, tmux, published } = await loadAgentsPlugin();
    tasks.create({ id: 'epic', project_id: 1, title: 'E', type: 'epic' });
    tasks.create({ id: 't1', project_id: 1, title: 'phase one', parent_id: 'epic' });
    const control = registry.control('missions')!;
    const mission = await control.engine().engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
    expect(mission.state).toBe('active');
    expect(control.engine().isActive(mission.id)).toBe(true);
    // Engage dispatched the dependency-cleared phase through the plugin's own SpawnService.
    expect(tasks.get('t1')!.status).toBe('in_progress');
    const agent = tasks.get('t1')!.labels.find((l) => l.startsWith('agent:'))!.slice('agent:'.length);
    expect(await tmux.list()).toContain(`elowen-${agent}`);
    expect(published.some((e) => e.type === 'task' && e.taskId === 't1' && e.status === 'in_progress')).toBe(true);
    // A further tick is a no-op (the only phase already runs) — it must not double-spawn.
    await control.engine().tick(mission.id);
    expect((await tmux.list()).filter((s) => s.startsWith('elowen-')).length).toBe(1);
  });

  it('event resolver: a signal event resolves tenancy WITHOUT building the runtime; plan without it is null', async () => {
    const { registry, tasks } = await loadAgentsPlugin();
    tasks.create({ id: 'e1', project_id: 1, title: 'E', type: 'epic' });
    tasks.create({ id: 't1', project_id: 1, title: 'T', parent_id: 'e1', labels: ['agent:Nova'] });
    const resolver = registry.eventProjectResolvers.find((r) => r.plugin === 'agents')!.fn;
    expect(resolver({ type: 'signal', session: 'elowen-Nova', signal: 'question' } as ElowenEvent)).toBe(1);
    // No runtime yet (no control access happened) → plan jobs cannot exist → null, not a crash.
    expect(resolver({ type: 'plan', jobId: 'pj-1', status: 'planning' } as ElowenEvent)).toBeNull();
  });

  it('subsystem log lines reach the process-wide sink — the admin per-plugin log ring sees them', async () => {
    // The old lib/logger copy was a separate module instance, so setLogSink (the PluginLogBuffer
    // behind /plugins/:name log/health) never saw a subsystem line. This drives the REAL chain:
    // plugin lib logger → ctx.logger (registry `[plugin:agents]` prefix) → core emit() → sink.
    const buffer = new PluginLogBuffer();
    setLogSink(buffer);
    try {
      const { registry, tasks } = await loadAgentsPlugin(coreLogger('daemon'));
      tasks.create({ id: 'epic', project_id: 1, title: 'E', type: 'epic' });
      tasks.create({ id: 't1', project_id: 1, title: 'phase one', parent_id: 'epic' });
      await registry.control('missions')!.engine().engage({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
      const lines = buffer.forPlugin('agents').map((e) => e.message);
      // A runtime-service line, with the subsystem scope tag preserved inside the plugin prefix.
      expect(lines.some((m) => m.includes('[spawn] spawned '))).toBe(true);
      expect(buffer.health('agents')).toBe('ok');
    } finally {
      setLogSink(undefined);
    }
  });

  it('plugin stores land in the shared DB via the plugin db seam (missions table usable through the control)', async () => {
    const { registry } = await loadAgentsPlugin();
    const control = registry.control('missions')!;
    control.agents().upsert({ project_id: 1, name: 'Nova', program: 'claude', model: 'opus' });
    expect(control.agents().programFor('Nova')).toBe('claude');
  });
});

// ---- from tests/plugins/agents/config.test.ts ----

const AUTOPILOT_DEFAULTS = {
  overseerModel: '', prBaseBranch: '', prAutoOpen: false, prVerifyCommand: '',
  pilotExec: '', overseerExec: '', reviewOnDone: false, tddMode: false, prEnabled: false,
};

const hostWith = (autopilot: Partial<typeof AUTOPILOT_DEFAULTS>, ghToken: string | null = null): PluginHostConfig => ({
  get: () => ({ autopilot: { ...AUTOPILOT_DEFAULTS, ...autopilot } }) as never,
  autopilotRelay: () => null,
  hasSettings: () => true,
  legacyGhToken: () => ghToken,
});

describe('agentsPluginConfig resolution', () => {
  it('the plugin config slice wins over the autopilot fallback', () => {
    const c = agentsPluginConfig(
      { overseerModel: 'slice-model', prAutoOpen: true },
      hostWith({ overseerModel: 'ap-model', prBaseBranch: 'main' }),
    );
    expect(c.overseerModel).toBe('slice-model');
    expect(c.prAutoOpen).toBe(true);
    // Keys the slice does not carry fall back to the LIVE autopilot values.
    expect(c.prBaseBranch).toBe('main');
    expect(c.prVerifyCommand).toBe('');
  });

  it('fresh install (empty slice) → the autopilot defaults', () => {
    const c = agentsPluginConfig({}, hostWith({}));
    expect(c).toEqual({ ...AUTOPILOT_DEFAULTS, ghToken: '' });
  });

  it('wave-2 keys resolve slice-first with the autopilot/ghToken fallback', () => {
    const c = agentsPluginConfig(
      { pilotExec: 'codex:gpt', tddMode: true },
      hostWith({ pilotExec: 'claude:opus', overseerExec: 'claude:sonnet', prEnabled: true }, 'legacy-token'),
    );
    expect(c.pilotExec).toBe('codex:gpt'); // slice wins
    expect(c.tddMode).toBe(true);
    expect(c.overseerExec).toBe('claude:sonnet'); // absent in slice → live autopilot value
    expect(c.prEnabled).toBe(true);
    expect(c.ghToken).toBe('legacy-token'); // absent/empty in slice → host ghToken()
  });

  it('a malformed slice degrades to the fallback instead of throwing', () => {
    const c = agentsPluginConfig({ prAutoOpen: 'yes' as never }, hostWith({ prAutoOpen: true }));
    expect(c.prAutoOpen).toBe(true);
  });

  it('old DB with autopilot values → migration → the plugin reads the same effective values', () => {
    const db = openDb(':memory:');
    db.prepare('INSERT INTO settings (id, data) VALUES (1, ?)').run(JSON.stringify({
      autopilot: { model: 'm', apiUrl: 'u', overseerModel: 'ov', prBaseBranch: 'main', prAutoOpen: true, prVerifyCommand: 'npm test' },
      plugins: { enabled: ['agents'], removed: [], config: {} },
      agentsConfigMigrated: true,
    }));
    const store = new ConfigStore(db);
    store.migrateAgentsPluginConfig();
    store.migrateAgentsPluginConfigWave2();
    const c = agentsPluginConfig(store.pluginConfig('agents'), store as unknown as PluginHostConfig);
    expect(c).toEqual({ ...AUTOPILOT_DEFAULTS, overseerModel: 'ov', prBaseBranch: 'main', prAutoOpen: true, prVerifyCommand: 'npm test', ghToken: '' });
  });
});

// ---- from tests/plugins/agents/runtime.test.ts ----

/** Fake host deps: the same seams B2 will fill from ctx, here as plain no-op fakes — the smoke proof
 *  that the composition root builds the whole subsystem without a PluginContext. */
function fakeDeps() {
  const db = makePluginDb(openDb(':memory:'), 'agents', { canMigrate: true });
  db.migrate(AGENTS_MIGRATIONS);
  const published: ElowenEvent[] = [];
  const disposed: string[] = [];
  let subs = 0;
  const deps: AgentsRuntimeDeps = {
    tmux: new FakeTmuxDriver(),
    db,
    stores: {
      tasks: { list: () => [], get: () => null, setStatus: () => {} } as unknown as TaskStore,
      projects: { get: () => null, list: () => [] } as unknown as ProjectStore,
      readiness: { ready: () => [], readyForEpic: () => [] } as unknown as Readiness,
      taskUsage: { record: () => {}, get: () => null } as unknown as TaskUsageStore,
      users: { list: () => [{ id: 1, is_admin: true }], allowedExecs: () => null },
    },
    prompts: { render: (name) => `[${name}]`, rawTemplate: (name) => `[raw:${name}]` },
    config: {
      get: () => ({ autopilot: { overseerExec: '', pilotExec: '', model: 'm', overseerModel: '', tddMode: false, prEnabled: false, prBaseBranch: '', prVerifyCommand: '', prAutoOpen: false, prompt: '' }, allowedExecs: [], modelNotes: {}, defaults: {}, providers: {} }),
      autopilotRelay: () => null,
      hasSettings: () => true,
      legacyGhToken: () => null,
    } as unknown as PluginHostConfig,
    pluginConfig: () => ({ overseerModel: '', prBaseBranch: '', prAutoOpen: false, prVerifyCommand: '', pilotExec: '', overseerExec: '', reviewOnDone: false, tddMode: false, prEnabled: false, ghToken: '' }),
    relayClient: () => ({ decide: async () => ({ text: '' }) }),
    git: { projectHead: async () => '', projectRangeDiff: async () => [] },
    elowenCli: { cli: 'elowen', cliArgv: ['elowen'], url: 'http://localhost:0', token: 't', tokenForTask: () => undefined },
    brainWorker: () => undefined,
    publishEvent: (e) => { published.push(e); },
    subscribeEvents: () => { const id = `sub-${subs++}`; return () => { disposed.push(id); }; },
    push: { sendToUsers: async () => {} },
    homeProjectPath: '/tmp',
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  };
  return { deps, published, disposed, subscribed: () => subs };
}

describe('agents plugin runtime composition root (extraction B1)', () => {
  it('builds every service from fake deps without touching a PluginContext', () => {
    const { deps, subscribed } = fakeDeps();
    const rt = buildAgentsRuntime(deps);
    // The full service graph exists…
    expect(typeof rt.spawn.launch).toBe('function');
    expect(typeof rt.deriver.start).toBe('function');
    expect(typeof rt.deriver.tick).toBe('function');
    expect(typeof rt.engine.tick).toBe('function');
    expect(typeof rt.engine.engage).toBe('function');
    expect(typeof rt.scheduler.tick).toBe('function');
    expect(typeof rt.pilot).toBe('function');
    expect(typeof rt.overseer.start).toBe('function');
    expect(typeof rt.missionGit.worktreeFor).toBe('function');
    expect(typeof rt.overseerClient).toBe('function');
    expect(rt.overseerClient()).toBeNull(); // no relay key configured → pre-relay behaviour
    expect(typeof rt.taskForSession).toBe('function');
    expect(typeof rt.missionIdForSession).toBe('function');
    expect(typeof rt.decisionRenderer('t-1')).toBe('function');
    expect(rt.resumeFallback).toEqual({ program: 'claude-code', model: 'sonnet' });
    // …and the two bus subscribers (push dispatch + usage recorder) attached through the host seam.
    expect(subscribed()).toBe(2);
  });

  it('owns the plugin stores over the shared DB handle', () => {
    const { deps } = fakeDeps();
    const rt = buildAgentsRuntime(deps);
    rt.missions.create({ id: 'm-e1', epic_id: 'e1', autonomy: 'L2', max_sessions: 1 });
    expect(rt.missions.get('m-e1')?.state).toBe('active');
    expect(rt.missionIdForSession('elowen-ghost')).toBeNull(); // no task rows in the fake task store
    rt.agents.upsert({ project_id: 1, name: 'Nova', program: 'claude', model: 'opus' });
    expect(rt.agents.programFor('Nova')).toBe('claude');
  });

  it('exposes the bootstrap interval set with the exact core periods', () => {
    const { deps } = fakeDeps();
    const rt = buildAgentsRuntime(deps);
    const byName = Object.fromEntries(rt.intervals.map((i) => [i.name, i.ms]));
    expect(byName).toEqual({
      'engine-tick': 90000,
      'scheduler-tick': 30000,
      'janitor': 60000,
      'stuck-detector': 60000,
      'overseer-watchdog': 60000,
      'decision-sweep': DECISION_SWEEP_MS,
      'pr-feedback': 60000,
    });
    for (const i of rt.intervals) expect(typeof i.fn).toBe('function');
  });

  it('boot reconciles run against the fake host without throwing', async () => {
    const { deps } = fakeDeps();
    const rt = buildAgentsRuntime(deps);
    await expect(rt.reconcileZombies()).resolves.toBeUndefined();
    await expect(rt.reconcileOverseers()).resolves.toBeUndefined();
  });

  // The BEHAVIOUR of the zombie reconcile, not merely that it runs. A daemon restart leaves every task
  // its agents were working on stuck at 'in_progress' with the tmux session that owned it gone, and
  // nothing re-picks such a task — so without this the work is silently abandoned. It used to be proven
  // end to end by the Elowen package's migration E2E (an upgraded pre-plugin database whose zombie phase
  // had to come back as 'open'), which cannot run there now that this plugin is not in that package.
  // The assertion therefore lives here, against the plugin that actually owns the reconcile.
  it('reconcileZombies re-opens a task whose agent session died, and leaves a live agent alone', async () => {
    const { deps, published } = fakeDeps();
    const task = (id: string, agent: string) => ({
      id, project_id: 1, title: id, type: 'task', status: 'in_progress', labels: [`agent:${agent}`],
    });
    const setStatusCalls: [string, string][] = [];
    deps.stores.tasks = {
      list: ({ status }: { status?: string }) => (status === 'in_progress' ? [task('ph1', 'Nova'), task('ph2', 'Kilo')] : []),
      get: () => null,
      setStatus: (id: string, status: string) => { setStatusCalls.push([id, status]); },
    } as unknown as TaskStore;
    // Kilo's pane survived the restart; Nova's died with the previous daemon.
    (deps.tmux as FakeTmuxDriver).setPane('elowen-Kilo', '');

    const rt = buildAgentsRuntime(deps);
    await rt.reconcileZombies();

    expect(setStatusCalls).toEqual([['ph1', 'open']]);
    expect(published).toContainEqual({ type: 'task', taskId: 'ph1', status: 'open' });
  });

  it('dispose tears down exactly the two bus subscriptions', () => {
    const { deps, disposed } = fakeDeps();
    const rt = buildAgentsRuntime(deps);
    rt.dispose();
    expect(disposed).toEqual(['sub-0', 'sub-1']);
  });

  it('spawn refuses an elowen: exec while the brain worker is not yet wired (late binding)', async () => {
    const { deps } = fakeDeps();
    const rt = buildAgentsRuntime(deps);
    await expect(rt.spawn.launch({
      projectId: 1, projectPath: '/tmp', taskId: 't-1', agentName: 'Nova',
      spec: { program: 'elowen', model: 'anthropic/claude' },
    })).rejects.toThrow('elowen exec engine not available');
  });
});
