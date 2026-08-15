import { fileURLToPath } from 'node:url';
import type { Db } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { setPluginPromptSources } from 'elowen/dist/prompts/index.js';
import { setPluginPromptCatalog } from 'elowen/dist/prompts/catalog.js';
import { TaskRefs } from 'elowen/dist/store/taskRefs.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { UserStore } from 'elowen/dist/store/userStore.js';
import { EventBus } from 'elowen/dist/api/sse.js';
import { FakeTmuxDriver } from 'elowen/dist/tmux/fakeDriver.js';
import { FakeClock } from 'elowen/dist/shared/clock.js';
import { createServer } from 'elowen/dist/api/server.js';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import { PluginRegistryProvider } from 'elowen/dist/plugins/pluginsProvider.js';
import type { PluginHostAdvisor, PluginHostTerminals } from 'elowen/dist/plugins/api.js';
import { TaskStore } from '../../plugins/work/dist/store/taskStore.js';
import { Readiness } from '../../plugins/work/dist/store/readiness.js';
import type { MissionStore } from '../../plugins/agents/dist/store/missionStore.js';
import type { PlanJob, PlanJobStore } from '../../plugins/agents/dist/overseer/planJob.js';
import { openWorkDb } from './pluginTablesDb.js';
import { domainTestHost } from './domainHost.js';

/** THIS repo's plugin directory — the copy the marketplace installs, and the one these suites test.
 *  Resolved from the module URL rather than process.cwd() so the runner's working directory cannot
 *  silently point the loader at a different tree. */
export const PLUGIN_DIR = fileURLToPath(new URL('../../plugins', import.meta.url));

/** Build a PluginRegistryProvider that loads the REAL agents and work plugins (their dist builds) over
 *  the given stores — the host wiring shape the daemon's bootstrap builds, with test fakes for
 *  tmux/inference/push. Local createServer tests pass the result as `plugins` so the plugins' root
 *  mounts ('/missions', '/tasks', …) serve; loading is lazy (first dispatched request).
 *
 *  Adopted from the Elowen package's tests/helpers/testApp.ts (agentsPluginProvider) when agents and work
 *  moved here: same composition, but the loader, stores and server come from the published daemon while
 *  the plugins come from this repo's own builds. */
export function domainPluginProvider(w: {
  db: Db;
  tasks: TaskStore;
  readiness: Readiness;
  config: ConfigStore;
  projects: ProjectStore;
  users?: UserStore;
  bus?: EventBus;
  tmux?: FakeTmuxDriver;
  /** Daemon terminal controls (chat teardown, brain workers, ws tickets). Tests exercising those paths
   *  pass their real services here; the default is a no-op fake. */
  terminals?: PluginHostTerminals;
  /** Override the advisor collaborators seam (default: a real one over `users`). */
  advisorHost?: PluginHostAdvisor;
  /** Override the prompt seam (default: the daemon's file renderer, no per-user overrides). */
  prompts?: { render(name: string, vars?: Record<string, string>, userId?: number): string; rawTemplate(name: string): string; userOverride?(userId: number, name: string): string | null };
  /** Raw LLM output the relay planning path returns (see domainTestHost). */
  fakePlan?: string;
  /** Activity-log purge sink (ctx.deleteEventsForTarget) — the task DELETE route's history purge. */
  deleteEvents?: (target: string) => void;
}): PluginRegistryProvider {
  const bus = w.bus ?? new EventBus();
  return new PluginRegistryProvider(() => loadPlugins({
    dirs: [PLUGIN_DIR],
    enabled: ['agents', 'work'],
    delegatedTurnsOutOfProcess: () => false,
    pluginDb: (plugin: string) => makePluginDb(w.db, plugin, { canMigrate: true }),
    publishEvent: (e: unknown) => bus.publish(e as never),
    subscribeEvents: (fn: never) => bus.subscribe(fn),
    ...(w.deleteEvents ? { deleteEvents: w.deleteEvents } : {}),
    host: domainTestHost(w) as never,
    logger: { info() {}, warn() {}, error() {} },
  }).then((registry) => {
    // Mirror the daemon's post-load snapshot: the plugin owns the agents templates now, so the core
    // renderer needs the source overlay before the first worker/guide render.
    setPluginPromptCatalog(registry.promptEntries.map((p: { entry: unknown }) => p.entry) as never);
    setPluginPromptSources(new Map([...registry.promptSources].map(([n, s]: [string, { file: string }]) => [n, s.file])));
    return registry;
  }));
}

export interface DomainAppOpts {
  /** Raw LLM output the relay path returns from `decompose` (a JSON array of phases). */
  fakePlan?: string;
  /** Autopilot API key; set non-empty to enable the relay planning path. */
  apiKey?: string;
  /** Stub a mission's isolated worktree dir (mirrors MissionGit.worktreeFor) so launch-path tests can
   *  assert that a mission phase runs in its worktree rather than the shared project checkout. */
  worktreeFor?: (missionId: string) => string | null | undefined;
  /** Activity-log purge sink the task DELETE route calls (ctx.deleteEventsForTarget). */
  deleteEvents?: (target: string) => void;
  /** Extra ServerDeps spread over the defaults — for routes whose collaborators (themes, brain stubs…)
   *  the standard wiring does not construct. */
  extra?: Partial<Parameters<typeof createServer>[0]>;
}

/** Wire a real in-memory daemon app with a bootstrapped admin token, composed EXACTLY like the daemon:
 *  the REAL agents and work plugins are loaded from disk (their dist builds) over the shared in-memory DB,
 *  and the server reaches the subsystem through the loaded registry's 'missions' control — the same
 *  instances the plugins' root-mounted routes use. Exposes the live stores/queues so tests can arrange
 *  state and assert side effects.
 *
 *  Adopted from the Elowen package's tests/helpers/testApp.ts (makeTestApp). */
export async function makeDomainApp(opts: DomainAppOpts = {}) {
  const db = openWorkDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const tasks = new TaskStore(db);
  const readiness = new Readiness(db);
  const config = new ConfigStore(db);
  const projects = new ProjectStore(db);
  const users = new UserStore(db);
  users.create('admin', 'pw');
  const token = users.issueToken(users.list()[0]!.id);
  if (typeof opts.apiKey === 'string' && opts.apiKey) config.update({ autopilot: { apiKey: opts.apiKey } });

  const tmux = new FakeTmuxDriver();
  const bus = new EventBus();

  // The REAL plugins over this app's stores. One provider per app: each test gets its own runtime
  // generation over its own :memory: DB.
  const provider = domainPluginProvider({ db, tasks, readiness, config, projects, users, bus, tmux, ...(opts.fakePlan ? { fakePlan: opts.fakePlan } : {}), ...(opts.deleteEvents ? { deleteEvents: opts.deleteEvents } : {}) });
  const registry = await provider.get();
  const control = registry.control('missions');
  if (!control) throw new Error('agents plugin failed to load in makeDomainApp');

  // The ONE subsystem instance set — server deps and the plugins' root-mounted routes share it, exactly
  // like the daemon's live control getters.
  const missions = control.missions() as MissionStore;
  // Launch-path tests stub the mission worktree resolution — the plugin's manual-launch handler calls the
  // runtime's REAL MissionGit, so patch that exact instance (own-property assignment over the class
  // method), keeping the core-facing deps.missionGit override below in sync.
  if (opts.worktreeFor) (control.missionGit() as { worktreeFor: (id: string) => string | null | undefined }).worktreeFor = opts.worktreeFor;
  const engine = control.engine();
  const spawn = control.spawn();
  const decisionQueue = control.decisionQueue();
  const planJobs = control.planJobs() as PlanJobStore;
  // No-op pilot backend on the LIVE control the work plugin resolves: whenever the REAL flow would pick
  // the agent backend, park the job instead — it stays 'planning' until a test calls /plan/:id/submit.
  // Every other planFlow decision is real. Patched as an own property on the very instance the routes
  // reach, since they resolve planFlow() through the registry, not through deps.
  const realPlanFlow = control.planFlow();
  const realPilotBackend = realPlanFlow.pilotBackend.bind(realPlanFlow);
  (realPlanFlow as { pilotBackend: typeof realPlanFlow.pilotBackend }).pilotBackend =
    (exec: string) => realPilotBackend(exec) ? async (_job: PlanJob, _projectPath: string) => { /* parked */ } : null;

  const app = createServer({
    tasks, taskRefs: new TaskRefs(db), missions, engine, tmux, bus,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config, users, projects,
    missionGit: control.missionGit(),
    plugins: provider,
    // Mirror bootstrap: login autostart / user-deletion advisor hooks resolve through the control.
    advisor: control.advisor(),
    // Mirror bootstrap: the SSE gate consults the plugin-registered event resolvers (signal/plan tenancy).
    eventProjectResolvers: () => registry.eventProjectResolvers.map((r: { fn: unknown }) => r.fn),
    ...(opts.worktreeFor ? { missionGit: { worktreeFor: opts.worktreeFor } as never } : {}),
    ...(opts.extra ?? {}),
  } as never);

  /** Seed an epic + one in-progress child phase + an active mission `m-<epic>`. */
  const seedMissionWithChild = () => {
    const epic = tasks.create({ id: 'elowen-ep', project_id: 1, title: 'Epic', type: 'epic', description: 'epic' });
    const child = tasks.create({ id: 'elowen-c1', project_id: 1, title: 'Child phase', type: 'task', parent_id: epic.id, description: 'child' });
    tasks.setStatus(child.id, 'in_progress');
    const mission = missions.create({ id: `m-${epic.id}`, epic_id: epic.id, autonomy: 'L3', max_sessions: 1 });
    return { missionId: mission.id, epicId: epic.id, childId: child.id };
  };

  /** Seed an epic with two chained phases (P1 in_progress, P2 open depends on P1) + active mission.
   *  `autonomy` defaults to L3 so the self-heal/review tests get full autonomy; pass L1/L2 to exercise
   *  the human-in-the-loop branch (no auto self-heal). */
  const seedMissionWithChain = (autonomy = 'L3') => {
    const epic = tasks.create({ id: 'elowen-ep2', project_id: 1, title: 'Epic2', type: 'epic', description: 'epic' });
    const p1 = tasks.create({ id: 'elowen-p1', project_id: 1, title: 'Phase 1', type: 'task', parent_id: epic.id, description: 'p1' });
    const p2 = tasks.create({ id: 'elowen-p2', project_id: 1, title: 'Phase 2', type: 'task', parent_id: epic.id, description: 'p2' });
    tasks.addDep(p2.id, p1.id);
    tasks.setStatus(p1.id, 'in_progress');
    const mission = missions.create({ id: `m-${epic.id}`, epic_id: epic.id, autonomy, max_sessions: 1 });
    return { missionId: mission.id, epicId: epic.id, childId: p1.id, nextId: p2.id };
  };

  return { app, token, control, db, deps: { tasks, readiness, missions, config, users, planJobs, decisionQueue, bus, tmux, engine, spawn, seedMissionWithChild, seedMissionWithChain } };
}
