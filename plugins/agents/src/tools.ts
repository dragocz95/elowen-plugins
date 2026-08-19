import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { missionsListPayload } from './api/missions.js';
import { sessionsListPayload } from './api/sessions.js';
import type { ApiAuth } from './api/http.js';
import { MISSIONS_WITHOUT_TASKS } from './lib/taskDomain.js';
import type { PluginContext } from 'elowen/dist/plugins/api.js';
import type { AgentsRuntime } from './runtime.js';

/** The subsystem's brain tools — ElowenListMissions + ElowenListSessions, moved out of the core
 *  Elowen* control plane (src/brain/tools) with the same names, labels and parameter schemas. The
 *  descriptions have since been rewritten for hosted tool search (the provider retrieves a deferred
 *  tool by BM25 over name/description/argument text), so they no longer match the core originals
 *  byte for byte.
 *
 *  Two deliberate differences from the core originals:
 *  - They execute IN-PROCESS against the plugin runtime instead of a localhost REST round-trip (the
 *    host's service token is agent-scoped and may not read '/missions'), serving the exact payload the
 *    corresponding GET routes return.
 *  - As plugin tools they are COMPOSED into every session kind (the platform composes plugin tools
 *    everywhere and gates at execute time), where the core built-ins were owner-chat-only by
 *    construction. The execute-time gate below restores that boundary: a channel or task-worker turn
 *    gets a refusal, never the owner's control-plane data.
 *
 *  The gate reads `currentAccess().owner`, NOT isAdminSession(). Owner truth is what the core
 *  built-ins were scoped by, and it is independent from admin project scope: a platform admin (a
 *  Discord moderator) is admin-but-not-owner and stays refused, while the owner's own sub-agents
 *  inherit owner and are admitted — which READ_ONLY_AGENT_TOOLS (src/brain/agents/agentRegistry.ts)
 *  explicitly intends by listing both tools as control-plane reads for explore/plan children. Gating
 *  on isAdminSession() instead advertised two tools to every read-only sub-agent that could only ever
 *  refuse. Tenancy follows the same descriptor, so a project-scoped child sees only its own projects
 *  rather than the operator's whole estate. */
export function registerAgentsTools(ctx: PluginContext, rt: () => AgentsRuntime): void {
  // The caller's own view, keyed to the operator's account when the turn resolves one. An admin turn
  // (the owner's chat) reads unrestricted, exactly as the owner-chat REST calls did; a project-scoped
  // owner child carries its own set, so the listing never widens what the turn may already see.
  const auth = (): ApiAuth => {
    const access = ctx.currentAccess();
    return {
      userId: ctx.currentIdentity()?.elowenUserId ?? null,
      admin: access.admin,
      tokenScope: 'user',
      agentTask: null,
      accessibleProjects: access.admin ? null : access.projectIds,
    };
  };
  const refusal = { content: [{ type: 'text' as const, text: 'This tool is only available in the owner\'s own chat session.' }], details: {} };
  const denied = (): boolean => !ctx.currentAccess().owner;
  // Both listings are made of the task domain a sibling plugin owns. Whether to ADVERTISE a tool is
  // decided at load time and cannot depend on that (the owner may load after this plugin), so the
  // refusal happens at execute time — and it says why. Returning an empty list instead would tell the
  // model "no missions, no agents are running", which it would then act on.
  const unavailable = { content: [{ type: 'text' as const, text: MISSIONS_WITHOUT_TASKS }], details: {} };
  const withoutTasks = (): boolean => !ctx.host.stores().tasksAvailable();

  ctx.registerTool(defineTool({
    name: 'ElowenListMissions', label: 'List missions',
    description: [
      'List the Elowen autopilot missions in the control plane: the autonomous multi-agent runs that drive an',
      'epic\'s tasks to completion, each with its id, epic, state and — for a PR-native mission — the pull',
      'request currently attached to it.',
      'Use it to see what autopilot work is under way before engaging another mission, pausing or disengaging',
      'one, or reporting progress on a goal you planned earlier. Missions are the mission-level view: for the',
      'individual agent processes running right now call ElowenListSessions, and for the underlying task records',
      'call ElowenListTasks.',
      'It takes no parameters and is read-only — nothing is engaged, paused or disengaged by calling it. The',
      'result covers live missions plus disengaged ones whose pull request is still pending, filtered to the',
      'projects you may see, so an empty list means no mission is running rather than that missions are',
      'unavailable. It works only in the owner\'s own chat session and only while the task subsystem is loaded;',
      'otherwise it answers with a plain refusal.',
    ].join(' '),
    parameters: Type.Object({}),
    execute: async () => {
      if (denied()) return refusal;
      if (withoutTasks()) return unavailable;
      return { content: [{ type: 'text' as const, text: JSON.stringify(missionsListPayload(rt(), ctx.host.stores().tasks, auth())) }], details: {} };
    },
  }));

  ctx.registerTool(defineTool({
    name: 'ElowenListSessions', label: 'List sessions',
    description: [
      'List the Elowen agent sessions running right now in the control plane — the background worker, pilot and',
      'overseer agents launched in tmux for your projects — each with its session name, role, task and project.',
      'Use it to see what agent work is actually live before spawning another agent, before stopping one with',
      'ElowenStopTask, or when someone asks what the agents are doing at the moment. For the mission-level view',
      'above these processes call ElowenListMissions, and for the task records themselves call ElowenListTasks.',
      'This is NOT a list of CLI chat clients, connected users or brain conversations: an empty result means no',
      'agent is currently running, not that nobody is connected.',
      'It takes no parameters, is read-only, and never starts or stops anything. Results are limited to the',
      'projects you may see. It works only in the owner\'s own chat session and only while the task subsystem is',
      'loaded; otherwise it answers with a plain refusal rather than an empty list.',
    ].join(' '),
    parameters: Type.Object({}),
    execute: async () => {
      if (denied()) return refusal;
      if (withoutTasks()) return unavailable;
      return { content: [{ type: 'text' as const, text: JSON.stringify(await sessionsListPayload(ctx.host.tmux(), rt, auth())) }], details: {} };
    },
  }));
}
