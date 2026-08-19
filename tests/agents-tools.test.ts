// @vitest-environment node
// Adopted from the Elowen package when the agents plugin moved into this registry. Carries, verbatim:
//   tests/plugins/agents/toolParity.test.ts
//   tests/plugins/agents/mcpTools.test.ts
// The tool registrations come from THIS repo's agents and work builds; composeSessionTools is the
// published daemon's own session composer.
import { describe, it, expect } from 'vitest';
import { composeSessionTools } from 'elowen/dist/brain/session/capabilities.js';
import type { PluginContext, PluginMcpRequest } from 'elowen/dist/plugins/api.js';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { registerAgentsTools } from '../plugins/agents/dist/tools.js';
import { AGENTS_MCP_TOOLS } from '../plugins/agents/dist/mcpTools.js';
import { registerWorkTools } from '../plugins/work/dist/tools.js';

// ---- from tests/plugins/agents/toolParity.test.ts ----

/** PROMPT-CACHE BASELINE for the brain tools that moved into the agents plugin (F2 step 6).
 *  The advertised bytes of a tool (name, description, parameter schema) feed the model's cached prompt
 *  prefix, so they are pinned here and any change invalidates every cached prompt. These began as the
 *  core built-ins' exact bytes; they were rewritten deliberately once hosted tool search made the
 *  description the retrieval index rather than documentation, so the baseline now records the plugin's
 *  own advertised bytes. It still exists to keep the NEXT change deliberate — if a diff here is
 *  intended, update the baseline consciously; if it is not, it just cost every user a cache miss.
 *  The advertised ORDER did change once with the extraction (plugin tools compose after the core
 *  groups); the ordered-set test below makes that position visible and locked. */

const BASELINE = [
  {
    name: 'ElowenListMissions',
    label: 'List missions',
    description: 'List the Elowen autopilot missions in the control plane: the autonomous multi-agent runs that drive an epic\'s tasks to completion, each with its id, epic, state and — for a PR-native mission — the pull request currently attached to it. Use it to see what autopilot work is under way before engaging another mission, pausing or disengaging one, or reporting progress on a goal you planned earlier. Missions are the mission-level view: for the individual agent processes running right now call ElowenListSessions, and for the underlying task records call ElowenListTasks. It takes no parameters and is read-only — nothing is engaged, paused or disengaged by calling it. The result covers live missions plus disengaged ones whose pull request is still pending, filtered to the projects you may see, so an empty list means no mission is running rather than that missions are unavailable. It works only in the owner\'s own chat session and only while the task subsystem is loaded; otherwise it answers with a plain refusal.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'ElowenListSessions',
    label: 'List sessions',
    description: 'List the Elowen agent sessions running right now in the control plane — the background worker, pilot and overseer agents launched in tmux for your projects — each with its session name, role, task and project. Use it to see what agent work is actually live before spawning another agent, before stopping one with ElowenStopTask, or when someone asks what the agents are doing at the moment. For the mission-level view above these processes call ElowenListMissions, and for the task records themselves call ElowenListTasks. This is NOT a list of CLI chat clients, connected users or brain conversations: an empty result means no agent is currently running, not that nobody is connected. It takes no parameters, is read-only, and never starts or stops anything. Results are limited to the projects you may see. It works only in the owner\'s own chat session and only while the task subsystem is loaded; otherwise it answers with a plain refusal rather than an empty list.',
    parameters: { type: 'object', properties: {} },
  },
];

type FakeAccess = { owner: boolean; admin: boolean; projectIds: number[] };
const CHANNEL_ADMIN: FakeAccess = { owner: false, admin: true, projectIds: [] };

function capturedAgentsTools(access: FakeAccess = CHANNEL_ADMIN, rt?: () => unknown): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const ctx = {
    registerTool: (t: ToolDefinition) => { tools.push(t); },
    // Present but deliberately UNUSED by the gate: admin scope is not owner truth (see below).
    isAdminSession: () => access.admin,
    currentAccess: () => ({ ...access, permissionBoundary: null }),
    currentIdentity: () => null,
    host: { stores: () => ({ tasks: { get: () => ({ project_id: 1 }) }, tasksAvailable: () => true }), tmux: () => ({ list: async () => [] }) },
  } as unknown as PluginContext;
  registerAgentsTools(ctx, (rt ?? (() => { throw new Error('runtime must not be touched at registration'); })) as never);
  return tools;
}

/** Minimal runtime the mission listing reads: two missions in different projects, no PRs. */
function fakeRuntime(): unknown {
  return {
    missions: {
      live: () => [{ id: 'm-a', epic_id: 'a' }, { id: 'm-b', epic_id: 'b' }],
      get: () => null,
    },
    missionGit: { pendingPrMissionIds: () => [], prInfo: () => null },
  };
}

describe('agents plugin tool parity (prompt cache)', () => {
  it('registers the moved tools byte-identical to the core originals', () => {
    const tools = capturedAgentsTools();
    expect(tools.map((t) => t.name)).toEqual(BASELINE.map((b) => b.name));
    for (const b of BASELINE) {
      const t = tools.find((x) => x.name === b.name)!;
      expect(t.label).toBe(b.label);
      expect(t.description).toBe(b.description);
      // The parameter schema reaches the model as JSON — compare the serialized form, additional
      // typebox symbols/metadata do not travel on the wire.
      expect(JSON.parse(JSON.stringify(t.parameters))).toMatchObject(b.parameters);
    }
  });

  it('refuses a platform admin who is not the owner instead of serving control-plane data', async () => {
    // The Discord-moderator case: admin project scope WITHOUT owner truth. Gating on isAdminSession()
    // would serve them the operator's missions; the owner gate refuses.
    for (const t of capturedAgentsTools(CHANNEL_ADMIN, fakeRuntime)) {
      const res = await t.execute('call-1', {}, undefined as never, undefined as never);
      expect(res.content[0]!.text).toContain("only available in the owner's own chat session");
    }
  });

  it("admits the owner's own sub-agent, which READ_ONLY_AGENT_TOOLS lists these tools for", async () => {
    // A read-only child inherits owner but is not an admin chat session — the case the isAdminSession()
    // gate advertised two permanently-refusing tools to.
    const owned = { owner: true, admin: true, projectIds: [] };
    const [missions] = capturedAgentsTools(owned, fakeRuntime);
    const res = await missions!.execute('call-1', {}, undefined as never, undefined as never);
    expect(res.content[0]!.text).not.toContain('only available');
    expect(JSON.parse(res.content[0]!.text as string)).toHaveLength(2);
  });

  it('scopes the listing to a project-restricted owner child rather than the whole estate', async () => {
    // tasks.get() answers project_id 1 for every epic, so a child scoped to project 2 must see none.
    const scoped = { owner: true, admin: false, projectIds: [2] };
    const [missions] = capturedAgentsTools(scoped, fakeRuntime);
    const res = await missions!.execute('call-1', {}, undefined as never, undefined as never);
    expect(JSON.parse(res.content[0]!.text as string)).toEqual([]);
  });

  it('locks the ordered advertised owner-chat tool set (plugins load alphabetically: agents, then work)', () => {
    // The whole Elowen* control plane is plugin-owned now, so this order is the LOAD order of the
    // plugins rather than a core group boundary — pinned here because it is what a cached prompt
    // prefix sees.
    const workTools: ToolDefinition[] = [];
    registerWorkTools({
      registerTool: (t: ToolDefinition) => { workTools.push(t); },
      currentAccess: () => ({ owner: true, admin: true, projectIds: [], permissionBoundary: null }),
      currentIdentity: () => ({ elowenUserId: 1 }),
      host: { elowenCli: () => ({ url: 'http://x', tokenForUser: () => 't' }) },
    } as unknown as PluginContext);
    const composed = composeSessionTools({
      kind: 'owner-chat',
      pluginTools: [...capturedAgentsTools(), ...workTools],
    } as never);
    expect(composed.map((t) => t.name)).toEqual([
      // The agents plugin's tools.
      'ElowenListMissions', 'ElowenListSessions',
      // The work plugin's task control plane.
      'ElowenListTasks', 'ElowenCreateTask', 'ElowenUpdateTask', 'ElowenPlan',
      'ElowenGetTask', 'ElowenStopTask', 'ElowenTaskOutput',
      // Owner-chat always carries the plan-mode exit tool last.
      'ExitPlanMode',
    ]);
  });
});

// ---- from tests/plugins/agents/mcpTools.test.ts ----

/** The agents MCP tools are pure REST proxies — each maps its arguments onto exactly the plugin's
 *  root-mounted route (moved from core src/mcp/tools.ts with batch 3b, mappings unchanged). */
function spy() {
  const calls: { m: string; p: string; b: unknown }[] = [];
  const req: PluginMcpRequest = async (m, p, b) => { calls.push({ m, p, b }); return { ok: 1 }; };
  return { calls, req };
}

const tool = (name: string) => {
  const t = AGENTS_MCP_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`missing agents MCP tool ${name}`);
  return t;
};

describe('agents plugin MCP tools (REST-proxy mappings)', () => {
  it('elowen_sessions maps to GET /sessions', async () => {
    const { calls, req } = spy();
    await tool('elowen_sessions').run({}, req);
    expect(calls[0]).toMatchObject({ m: 'GET', p: '/sessions' });
  });

  // ---- Notes ----
  it('elowen_note_add maps to POST /notes', async () => {
    const { calls, req } = spy();
    await tool('elowen_note_add').run({ target: 'epic-1', body: 'hello' }, req);
    expect(calls[0]).toMatchObject({ m: 'POST', p: '/notes', b: { scope: 'mission', target: 'epic-1', body: 'hello' } });
  });

  it('elowen_notes maps to GET /notes with query', async () => {
    const { calls, req } = spy();
    await tool('elowen_notes').run({ target: 'epic-1' }, req);
    expect(calls[0]).toMatchObject({ m: 'GET', p: '/notes?scope=mission&target=epic-1' });
  });

  // ---- Mission lifecycle ----
  it('elowen_missions maps to GET /missions', async () => {
    const { calls, req } = spy();
    await tool('elowen_missions').run({}, req);
    expect(calls[0]).toMatchObject({ m: 'GET', p: '/missions' });
  });

  it('elowen_mission_engage maps to POST /missions', async () => {
    const { calls, req } = spy();
    await tool('elowen_mission_engage').run({ epicId: 'e-1', autonomy: 'L2', maxSessions: 3 }, req);
    expect(calls[0]).toMatchObject({ m: 'POST', p: '/missions', b: { epicId: 'e-1', autonomy: 'L2', maxSessions: 3 } });
  });

  it('elowen_mission_pause maps to PATCH /missions/:id with action pause', async () => {
    const { calls, req } = spy();
    await tool('elowen_mission_pause').run({ id: 'm-1' }, req);
    expect(calls[0]).toMatchObject({ m: 'PATCH', p: '/missions/m-1', b: { action: 'pause' } });
  });

  it('elowen_mission_resume maps to PATCH /missions/:id with action resume', async () => {
    const { calls, req } = spy();
    await tool('elowen_mission_resume').run({ id: 'm-1' }, req);
    expect(calls[0]).toMatchObject({ m: 'PATCH', p: '/missions/m-1', b: { action: 'resume' } });
  });

  it('elowen_mission_disengage maps to DELETE /missions/:id', async () => {
    const { calls, req } = spy();
    await tool('elowen_mission_disengage').run({ id: 'm-1' }, req);
    expect(calls[0]).toMatchObject({ m: 'DELETE', p: '/missions/m-1' });
  });

  // ---- Session control ----
  it('elowen_session_spawn maps to POST /sessions', async () => {
    const { calls, req } = spy();
    await tool('elowen_session_spawn').run({ taskId: 't-1', exec: 'sonnet' }, req);
    expect(calls[0]).toMatchObject({ m: 'POST', p: '/sessions', b: { taskId: 't-1', exec: 'sonnet' } });
  });

  it('elowen_session_kill maps to DELETE /sessions/:name', async () => {
    const { calls, req } = spy();
    await tool('elowen_session_kill').run({ name: 'elowen-t-1' }, req);
    expect(calls[0]).toMatchObject({ m: 'DELETE', p: '/sessions/elowen-t-1' });
  });

  it('elowen_session_send_keys maps to POST /sessions/:name/keys', async () => {
    const { calls, req } = spy();
    await tool('elowen_session_send_keys').run({ name: 'elowen-t-1', keys: ['Enter'] }, req);
    expect(calls[0]).toMatchObject({ m: 'POST', p: '/sessions/elowen-t-1/keys', b: { keys: ['Enter'] } });
  });

  it('elowen_session_read_pane maps to GET /sessions/:name/pane (ansi=true adds ?ansi=1)', async () => {
    const { calls, req } = spy();
    await tool('elowen_session_read_pane').run({ name: 'elowen-t-1' }, req);
    expect(calls[0]).toMatchObject({ m: 'GET', p: '/sessions/elowen-t-1/pane' });
    await tool('elowen_session_read_pane').run({ name: 'elowen-t-1', ansi: true }, req);
    expect(calls[1]).toMatchObject({ m: 'GET', p: '/sessions/elowen-t-1/pane?ansi=1' });
  });
});
