// @vitest-environment node
/** Adopted from the Elowen package: tests/plugins/work/tools.test.ts, tests/plugins/work/toolGate.test.ts,
 *  tests/plugins/work/toolParity.test.ts. */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginContext } from 'elowen/dist/plugins/api.js';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { buildWorkTools, registerWorkTools } from '../plugins/work/dist/tools.js';

// ---- from tests/plugins/work/tools.test.ts ----

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

/** A fetch mock that returns a different response per URL suffix (most-specific key wins). */
function routedFetch(routes: { suffix: string; status: number; body: unknown }[]): typeof fetch {
  const ordered = [...routes].sort((a, b) => b.suffix.length - a.suffix.length);
  return vi.fn(async (url: string) => {
    const r = ordered.find((x) => String(url).endsWith(x.suffix)) ?? { status: 404, body: { error: 'no route' } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
}
const toolNamed = (f: typeof fetch, name: string) =>
  buildWorkTools({ url: 'http://x', token: 't', fetchImpl: f }).find((t) => t.name === name)!;

describe('the work plugin\'s task tools', () => {
  it('exposes the expected tool names (the elowen control plane, nothing else)', () => {
    const names = buildWorkTools({ url: 'http://x', token: 't' }).map((t) => t.name).sort();
    // ElowenListMissions/ElowenListSessions moved to the agents plugin, the six Lsp* tools to the lsp
    // plugin — both registered via their manifests, so this group is the control plane alone.
    expect(names).toEqual([
      'ElowenCreateTask', 'ElowenGetTask', 'ElowenListTasks',
      'ElowenPlan', 'ElowenStopTask', 'ElowenTaskOutput', 'ElowenUpdateTask',
    ]);
  });

  it('ElowenCreateTask POSTs to /tasks and returns the created task text', async () => {
    const f = fakeFetch(200, { id: 'elowen-1', title: 'Fix build' });
    const tool = buildWorkTools({ url: 'http://x', token: 't', fetchImpl: f }).find((t) => t.name === 'ElowenCreateTask')!;
    const res = await tool.execute('call-1', { title: 'Fix build', project_id: 1 });
    expect(f).toHaveBeenCalledWith('http://x/tasks', expect.objectContaining({ method: 'POST' }));
    expect(res.content[0]!.text).toContain('elowen-1');
  });

  it('ElowenListTasks GETs /tasks', async () => {
    const f = fakeFetch(200, [{ id: 'elowen-1' }]);
    const tool = buildWorkTools({ url: 'http://x', token: 't', fetchImpl: f }).find((t) => t.name === 'ElowenListTasks')!;
    await tool.execute('call-2', {});
    expect(f).toHaveBeenCalledWith('http://x/tasks', expect.objectContaining({ method: 'GET' }));
  });

  // Without this tool the brain could open a task but never move it: create was write-only.
  describe('ElowenUpdateTask', () => {
    const updateTool = (f: typeof fetch) =>
      buildWorkTools({ url: 'http://x', token: 't', fetchImpl: f }).find((t) => t.name === 'ElowenUpdateTask')!;

    it('PATCHes /tasks/:id with only the fields that were passed', async () => {
      const f = fakeFetch(200, { id: 'elowen-1', status: 'in_progress' });
      const res = await updateTool(f).execute('call-4', { task_id: 'elowen-1', status: 'in_progress' });
      expect(f).toHaveBeenCalledWith('http://x/tasks/elowen-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'in_progress' }), // title/description absent, not sent as undefined
      }));
      expect(res.content[0]!.text).toContain('in_progress');
    });

    it('carries a rename and a new description together', async () => {
      const f = fakeFetch(200, { id: 'elowen-1' });
      await updateTool(f).execute('call-5', { task_id: 'elowen-1', title: 'New title', description: 'Why' });
      expect(f).toHaveBeenCalledWith('http://x/tasks/elowen-1', expect.objectContaining({
        body: JSON.stringify({ title: 'New title', description: 'Why' }),
      }));
    });

    it('escapes the task id into the path', async () => {
      const f = fakeFetch(200, {});
      await updateTool(f).execute('call-6', { task_id: 'a/b?c', status: 'closed' });
      expect(f).toHaveBeenCalledWith('http://x/tasks/a%2Fb%3Fc', expect.anything());
    });

    it('refuses an empty update instead of firing a no-op PATCH that reads as success', async () => {
      const f = fakeFetch(200, {});
      const res = await updateTool(f).execute('call-7', { task_id: 'elowen-1' });
      expect(f).not.toHaveBeenCalled();
      expect(res.content[0]!.text).toMatch(/nothing to update/i);
    });
  });

  describe('ElowenGetTask', () => {
    it('GETs /tasks/:id', async () => {
      const f = fakeFetch(200, { id: 'elowen-9', title: 'Inspect' });
      await toolNamed(f, 'ElowenGetTask').execute('c', { task_id: 'elowen-9' });
      expect(f).toHaveBeenCalledWith('http://x/tasks/elowen-9', expect.objectContaining({ method: 'GET' }));
    });
  });

  describe('ElowenStopTask', () => {
    it('reverts a task to open by default (PATCH status=open)', async () => {
      const f = fakeFetch(200, { id: 'elowen-1', status: 'open' });
      const res = await toolNamed(f, 'ElowenStopTask').execute('c', { task_id: 'elowen-1' });
      expect(f).toHaveBeenCalledWith('http://x/tasks/elowen-1', expect.objectContaining({
        method: 'PATCH', body: JSON.stringify({ status: 'open' }),
      }));
      expect(res.content[0]!.text).toContain('open');
    });

    it('cancels the task when cancel=true (PATCH status=cancelled)', async () => {
      const f = fakeFetch(200, { id: 'elowen-1', status: 'cancelled' });
      await toolNamed(f, 'ElowenStopTask').execute('c', { task_id: 'elowen-1', cancel: true });
      expect(f).toHaveBeenCalledWith('http://x/tasks/elowen-1', expect.objectContaining({
        method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }),
      }));
    });

    it('escapes the task id into the path', async () => {
      const f = fakeFetch(200, {});
      await toolNamed(f, 'ElowenStopTask').execute('c', { task_id: 'a/b?c' });
      expect(f).toHaveBeenCalledWith('http://x/tasks/a%2Fb%3Fc', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  describe('ElowenTaskOutput', () => {
    it('composes result_summary + outcome (from /tasks/:id) with usage (from /usage)', async () => {
      const f = routedFetch([
        { suffix: '/tasks/elowen-1', status: 200, body: { id: 'elowen-1', result_summary: 'did it', outcome: 'success' } },
        { suffix: '/tasks/elowen-1/usage', status: 200, body: { input: 10, output: 5 } },
      ]);
      const res = await toolNamed(f, 'ElowenTaskOutput').execute('c', { task_id: 'elowen-1' });
      expect(f).toHaveBeenCalledWith('http://x/tasks/elowen-1', expect.objectContaining({ method: 'GET' }));
      expect(f).toHaveBeenCalledWith('http://x/tasks/elowen-1/usage', expect.objectContaining({ method: 'GET' }));
      const text = res.content[0]!.text;
      expect(text).toContain('did it');
      expect(text).toContain('success');
      expect(text).toContain('"input": 10');
    });

    it('renders a readable message when usage is null (not the literal text "null")', async () => {
      const f = routedFetch([
        { suffix: '/tasks/elowen-2', status: 200, body: { id: 'elowen-2', result_summary: 's', outcome: 'o' } },
        { suffix: '/tasks/elowen-2/usage', status: 200, body: null },
      ]);
      const res = await toolNamed(f, 'ElowenTaskOutput').execute('c', { task_id: 'elowen-2' });
      expect(res.content[0]!.text).toContain('no usage recorded');
    });

    it('escapes the task id into both endpoint paths', async () => {
      const f = routedFetch([
        { suffix: '/tasks/a%2Fb%3Fc', status: 200, body: {} },
        { suffix: '/tasks/a%2Fb%3Fc/usage', status: 200, body: null },
      ]);
      await toolNamed(f, 'ElowenTaskOutput').execute('c', { task_id: 'a/b?c' });
      expect(f).toHaveBeenCalledWith('http://x/tasks/a%2Fb%3Fc', expect.anything());
      expect(f).toHaveBeenCalledWith('http://x/tasks/a%2Fb%3Fc/usage', expect.anything());
    });
  });

  it('surfaces API errors as text instead of throwing', async () => {
    const f = fakeFetch(500, { error: 'boom' });
    const tool = buildWorkTools({ url: 'http://x', token: 't', fetchImpl: f }).find((t) => t.name === 'ElowenListTasks')!;
    const res = await tool.execute('call-3', {});
    expect(res.content[0]!.text).toContain('HTTP 500');
  });
});

// ---- from tests/plugins/work/toolGate.test.ts ----

/** The core composed these tools into `owner-chat` sessions ONLY and handed them the acting user's own
 *  advisor token. As plugin tools they are composed into EVERY session kind, so both halves of that
 *  boundary have to be reproduced at execute time — this pins them. */

type Access = { owner: boolean; admin: boolean; projectIds: number[] };
const OWNER: Access = { owner: true, admin: true, projectIds: [] };
const CHANNEL_ADMIN: Access = { owner: false, admin: true, projectIds: [] };

function harness(opts: { access?: Access; userId?: number | null; identity?: () => number | null; tokenFor?: (id: number) => string | null } = {}) {
  const tools: ToolDefinition[] = [];
  const fetches: { url: string; auth: string | null }[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    fetches.push({ url: String(url), auth: headers.get('authorization') });
    return new Response(JSON.stringify([{ id: 'elowen-1' }]), { status: 200 });
  }) as typeof fetch;
  const ctx = {
    registerTool: (t: ToolDefinition) => { tools.push(t); },
    currentAccess: () => ({ ...(opts.access ?? OWNER), permissionBoundary: null }),
    currentIdentity: () => {
      const id = opts.identity ? opts.identity() : (opts.userId === undefined ? 7 : opts.userId);
      return id === null ? null : { elowenUserId: id };
    },
    host: { elowenCli: () => ({ url: 'http://d:4400', tokenForUser: opts.tokenFor ?? (() => 'user-token') }) },
  } as unknown as PluginContext;
  registerWorkTools(ctx);
  return { tools, fetches, restore: () => { globalThis.fetch = origFetch; } };
}

const run = (t: ToolDefinition, params: unknown = {}) => t.execute('call-1', params as never, undefined as never, undefined as never, undefined as never);

describe('work plugin tool registration (owner gate + per-call credential)', () => {
  it('registers the seven task tools in their historical order', () => {
    const h = harness();
    try {
      expect(h.tools.map((t) => t.name)).toEqual([
        'ElowenListTasks', 'ElowenCreateTask', 'ElowenUpdateTask', 'ElowenPlan',
        'ElowenGetTask', 'ElowenStopTask', 'ElowenTaskOutput',
      ]);
    } finally { h.restore(); }
  });

  it('refuses a platform admin who is not the owner — and never reaches the API', async () => {
    // The Discord-moderator case: admin scope WITHOUT owner truth. These tools MUTATE, so serving them
    // here would be exactly the escalation the core prevented by composing them for owner-chat only.
    const h = harness({ access: CHANNEL_ADMIN });
    try {
      for (const t of h.tools) {
        const res = await run(t, { task_id: 'x', title: 't', project_id: 1, goal: 'g' });
        expect(res.content[0]!.text).toContain("only available in the owner's own chat session");
      }
      expect(h.fetches).toHaveLength(0);
    } finally { h.restore(); }
  });

  it("serves the owner on the ACTING user's own credential, resolved per call", async () => {
    const seen: number[] = [];
    const h = harness({ tokenFor: (id) => { seen.push(id); return `token-for-${id}`; } });
    try {
      await run(h.tools[0]!);
      expect(seen).toEqual([7]);
      expect(h.fetches[0]).toEqual({ url: 'http://d:4400/tasks', auth: 'Bearer token-for-7' });
    } finally { h.restore(); }
  });

  it('follows the acting identity between turns rather than the one present at registration', async () => {
    // A registration-time capture would let a later turn act as whoever happened to load the plugin.
    let acting: number | null = 7;
    const h = harness({ identity: () => acting, tokenFor: (id) => `token-for-${id}` });
    try {
      await run(h.tools[0]!);
      acting = 9;
      await run(h.tools[0]!);
      expect(h.fetches.map((f) => f.auth)).toEqual(['Bearer token-for-7', 'Bearer token-for-9']);
    } finally { h.restore(); }
  });

  it('says so when the turn has no linked account, instead of falling back to a shared token', async () => {
    const h = harness({ userId: null });
    try {
      const res = await run(h.tools[0]!);
      expect(res.content[0]!.text).toContain('needs a linked Elowen account');
      expect(h.fetches).toHaveLength(0);
    } finally { h.restore(); }
  });

  it('says so when no credential can be minted for the acting user', async () => {
    const h = harness({ tokenFor: () => null });
    try {
      const res = await run(h.tools[0]!);
      expect(res.content[0]!.text).toContain('could not resolve a credential');
      expect(h.fetches).toHaveLength(0);
    } finally { h.restore(); }
  });
});

// ---- from tests/plugins/work/toolParity.test.ts ----

/** PROMPT-CACHE PARITY BASELINE for the seven Elowen* task tools that moved out of the core control
 *  plane (src/brain/tools/elowenTools.ts) into this plugin. What the model sees of a tool — its name,
 *  label, description and parameter schema — is part of the cached prompt prefix, so the extraction
 *  had to move those bytes unchanged, and any later edit has to be a decision rather than a slip.
 *  Verified against the pre-extraction file at 89725b3f when this baseline was written.
 *
 *  The existing name-only assertion in tools.test.ts sorts the names, so it cannot see a reworded
 *  description or a widened schema at all. This can. */
const BASELINE = 
[
  {
    "name": "ElowenListTasks",
    "label": "List tasks",
    "description": "List tasks in the Elowen projects, with each task's id, title, status and project. Optionally narrow to one project with project_id. Use it to see what work exists or is in progress, to find the next task after finishing one, or to get an overview before planning. Call it before ElowenCreateTask so you do not create a duplicate of a task that already exists.",
    "parameters": {
      "type": "object",
      "properties": {
        "project_id": {
          "type": "number",
          "description": "Only list tasks in this project"
        }
      }
    }
  },
  {
    "name": "ElowenCreateTask",
    "label": "Create task",
    "description": "Create a task in an Elowen project. Tasks are the unit of organized work — each belongs to a project and carries a title, a description and a status that tracks it through its lifecycle. Use this when the request is genuinely multi-step, when the work needs a visible checklist to stay on track, or when the user asks for it. Do not create a task for a single trivial action — just do the work. Check ElowenListTasks first to avoid duplicating an existing task. A new task starts `open`; move it through its lifecycle with ElowenUpdateTask as the work proceeds.",
    "parameters": {
      "type": "object",
      "required": [
        "title",
        "project_id"
      ],
      "properties": {
        "title": {
          "type": "string",
          "description": "A brief, actionable imperative naming the outcome, e.g. \"Fix the auth bug in the login flow\""
        },
        "project_id": {
          "type": "number",
          "description": "The project the task belongs to — tasks never exist standalone"
        },
        "description": {
          "type": "string",
          "description": "Context for what needs doing, with enough detail to resume the work after an interruption"
        }
      }
    }
  },
  {
    "name": "ElowenUpdateTask",
    "label": "Update task",
    "description": "Update an existing Elowen task: move it through its lifecycle, rename it, or revise its description. Status values are open, in_progress, blocked, closed, cancelled — set `in_progress` when you start the work and `closed` when it is genuinely finished, `blocked` when something outside your control stops it, and `cancelled` when it is no longer wanted. Only close a task you have actually completed: a partial implementation, a failing test or an unresolved error means it stays in_progress. Get the task id from ElowenListTasks or from what ElowenCreateTask returned.",
    "parameters": {
      "type": "object",
      "required": [
        "task_id"
      ],
      "properties": {
        "task_id": {
          "type": "string",
          "description": "Id of the task to update (from ElowenListTasks or ElowenCreateTask)"
        },
        "status": {
          "anyOf": [
            {
              "type": "string",
              "const": "open"
            },
            {
              "type": "string",
              "const": "in_progress"
            },
            {
              "type": "string",
              "const": "blocked"
            },
            {
              "type": "string",
              "const": "closed"
            },
            {
              "type": "string",
              "const": "cancelled"
            }
          ],
          "description": "New lifecycle status"
        },
        "title": {
          "type": "string",
          "description": "Rename the task"
        },
        "description": {
          "type": "string",
          "description": "Replace the task description"
        }
      }
    }
  },
  {
    "name": "ElowenPlan",
    "label": "Plan a goal",
    "description": "Ask Elowen to break a goal into a task plan for a project.",
    "parameters": {
      "type": "object",
      "required": [
        "goal",
        "project_id"
      ],
      "properties": {
        "goal": {
          "type": "string"
        },
        "project_id": {
          "type": "number"
        }
      }
    }
  },
  {
    "name": "ElowenGetTask",
    "label": "Get task",
    "description": "Get a single task by its id, including its title, status, description, result summary, outcome, labels, dependencies and changed files. Use it to inspect a task's full state before updating or closing it.",
    "parameters": {
      "type": "object",
      "required": [
        "task_id"
      ],
      "properties": {
        "task_id": {
          "type": "string",
          "description": "Id of the task to retrieve"
        }
      }
    }
  },
  {
    "name": "ElowenStopTask",
    "label": "Stop task",
    "description": "Stop a running task: revert its status to open (so it can be re-spawned) or cancel it entirely. If the task has a live agent session, that session is stopped first so a second agent cannot spawn alongside it. Use this when a task is stuck, producing wrong results, or no longer needed.",
    "parameters": {
      "type": "object",
      "required": [
        "task_id"
      ],
      "properties": {
        "task_id": {
          "type": "string",
          "description": "Id of the task to stop"
        },
        "cancel": {
          "type": "boolean",
          "description": "Cancel the task permanently (default: revert to open for re-spawn)"
        }
      }
    }
  },
  {
    "name": "ElowenTaskOutput",
    "label": "Task output",
    "description": "Read a task's agent-reported result summary, outcome and token/cost usage. Returns the result_summary and outcome the agent recorded when it closed the task, plus usage statistics (or \"no usage recorded\" when none exists). Use it to review what a completed task actually did.",
    "parameters": {
      "type": "object",
      "required": [
        "task_id"
      ],
      "properties": {
        "task_id": {
          "type": "string",
          "description": "Id of the task to read output from"
        }
      }
    }
  }
];

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

describe('work plugin tool parity (prompt cache)', () => {
  const tools = buildWorkTools({ url: 'http://x', token: 't' });

  it('advertises exactly the baseline tools, in the baseline order', () => {
    // Order matters as much as content: it is the order they enter the advertised set, and the
    // plan-mode/plugin composition downstream depends on it.
    expect(tools.map((t) => t.name)).toEqual(BASELINE.map((b) => b.name));
  });

  it('advertises each of them byte-identical to what core shipped', () => {
    for (const b of BASELINE) {
      const t = tools.find((x) => x.name === b.name)!;
      expect(`${b.name}.label = ${t.label}`).toBe(`${b.name}.label = ${b.label}`);
      expect(t.description).toBe(b.description);
      // The schema reaches the model as JSON — compare the serialized form, since typebox carries
      // extra symbols that never travel on the wire.
      expect(JSON.parse(JSON.stringify(t.parameters))).toEqual(b.parameters);
    }
  });

  it('declares in the manifest exactly the tools it registers', () => {
    // A tool missing from provides.tools is refused at registration; one listed but never registered
    // is a manifest that promises what the plugin does not deliver.
    const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'plugins/work/elowen-plugin.json'), 'utf8')) as { provides: { tools: string[] }; planSafe?: string[] };
    expect([...manifest.provides.tools].sort()).toEqual(tools.map((t) => t.name).sort());
    // planSafe may only name tools that exist, and only ones that are genuinely read-only.
    for (const name of manifest.planSafe ?? []) expect(tools.map((t) => t.name)).toContain(name);
    expect(manifest.planSafe).toEqual(['ElowenListTasks']);
  });
});
