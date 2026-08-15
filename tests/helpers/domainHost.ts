import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync } from 'node:fs';
import type { Db } from 'elowen/dist/store/db.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import type { UserStore } from 'elowen/dist/store/userStore.js';
import { FakeTmuxDriver } from 'elowen/dist/tmux/fakeDriver.js';
import { FakeInference } from 'elowen/dist/inference/client.js';
import {
  projectHead, projectRangeDiff, projectRangeLog, projectRangeFileDiff, projectCommitFileDiff,
} from 'elowen/dist/integrations/projectFiles.js';
import { render } from 'elowen/dist/prompts/index.js';
import type { PluginHostAdvisor, PluginHostConfig, PluginHostTerminals } from 'elowen/dist/plugins/api.js';
import { TaskStore } from '../../plugins/work/dist/store/taskStore.js';
import { Readiness } from '../../plugins/work/dist/store/readiness.js';
import { TaskUsageStore } from '../../plugins/work/dist/store/taskUsageStore.js';

/** The host seam the `agents` plugin needs to get through register(): the daemon's own wiring shape with
 *  fakes for tmux, inference and push. `work` needs none of this — it only asks for a database — but agents
 *  reaches for tmux and the core stores while registering, and a plugin that throws there is SKIPPED with
 *  an error and silently contributes no tools, no routes and no migrations.
 *
 *  Everything here is assembled from the published daemon plus this repo's own plugin builds, so a suite
 *  using it exercises the same shapes a real installation runs. Note that the two task stores are the
 *  WORK plugin's — the daemon has not owned that domain since it moved out of core's schema.
 *
 *  Adopted from the Elowen package's tests/helpers/testApp.ts when agents and work moved here. */
export function domainTestHost(w: {
  db: Db;
  tasks: TaskStore;
  readiness: Readiness;
  config: ConfigStore;
  projects: ProjectStore;
  users?: UserStore;
  tmux?: FakeTmuxDriver;
  terminals?: PluginHostTerminals;
  advisorHost?: PluginHostAdvisor;
  prompts?: { render(name: string, vars?: Record<string, string>, userId?: number): string; rawTemplate(name: string): string; userOverride?(userId: number, name: string): string | null };
  /** Raw LLM output the relay path returns from `decompose` (a JSON array of phases). */
  fakePlan?: string;
  /** Answer to "does the tasks domain have an owner?" — the question agents asks before it builds
   *  anything task-shaped. Wire it false to exercise the work-plugin-absent path. */
  tasksAvailable?: boolean;
}) {
  return {
    tmux: w.tmux ?? new FakeTmuxDriver(),
    brainWorker: () => undefined,
    elowenCli: {
      cli: 'elowen', cliArgv: ['elowen'], url: 'http://localhost:0', token: 't',
      tokenForTask: () => undefined, tokenForUser: () => undefined,
    },
    stores: {
      tasks: w.tasks,
      projects: w.projects,
      homeProject: () => w.projects.list()[0] ?? { id: 1, slug: 'elowen', path: '/o', notes: '', icon: '', pr_enabled: null },
      usersRead: {
        list: () => (w.users?.list() ?? []).map((u) => ({ id: u.id, username: u.username, isAdmin: u.is_admin })),
        isAdmin: (id: number) => w.users?.isAdmin(id) ?? true,
        allowedExecs: (id: number) => w.users?.list().find((u) => u.id === id)?.allowed_execs ?? null,
      },
      readiness: w.readiness,
      taskUsage: new TaskUsageStore(w.db),
      tasksAvailable: () => w.tasksAvailable ?? true,
    },
    prompts: {
      render: (n: string, v?: Record<string, string>, userId?: number | null) => (w.prompts ? w.prompts.render(n, v, userId ?? undefined) : render(n, v)),
      rawTemplate: (n: string) => w.prompts?.rawTemplate(n) ?? '',
      userOverride: (userId: number, n: string) => w.prompts?.userOverride?.(userId, n) ?? null,
    },
    config: w.config as unknown as PluginHostConfig,
    relayClient: () => new FakeInference(w.fakePlan ?? '[{"title":"Phase A","type":"task"}]'),
    git: { projectHead, projectRangeDiff, projectRangeLog, projectRangeFileDiff, projectCommitFileDiff } as never,
    push: () => ({ sendToUsers: async () => {} }),
    terminals: () => w.terminals ?? {
      chatTerminalStop: async () => {},
      brainWorkerLive: () => false,
      brainWorkerAbort: async () => {},
      ticketIssue: () => 'test-ticket',
    },
    advisor: () => w.advisorHost ?? (w.users ? advisorHostFor(w.users) : undefined),
  };
}

/** A real PluginHostAdvisor over a test UserStore — the shape the daemon's bootstrap wires, with a tmp
 *  working dir and a fixed personality and brand. */
export function advisorHostFor(users: UserStore): PluginHostAdvisor {
  return {
    users: {
      get: (id) => {
        const u = users.get(id);
        return u
          ? { name: u.name, username: u.username, isAdmin: u.is_admin, allowedExecs: u.allowed_execs, advisorExec: u.advisor_exec ?? '', advisorAutostart: u.advisor_autostart ?? false }
          : null;
      },
      setExec: (id, exec) => { users.setAdvisorExec(id, exec); },
      setAutostart: (id, on) => { users.setAdvisorAutostart(id, on); },
      ensureToken: (id) => users.ensureAdvisorToken(id),
    },
    dir: (id) => { const p = join(tmpdir(), 'elowen-registry-test-advisor', String(id)); mkdirSync(p, { recursive: true }); return p; },
    personality: () => 'Test personality paragraph.',
    brand: () => ({ agentName: 'Elowen', productName: 'Elowen' }),
  };
}
