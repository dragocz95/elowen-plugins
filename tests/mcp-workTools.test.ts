// @vitest-environment node
/** Adopted from the Elowen package: the work-tool half of tests/mcp/tools.test.ts.
 *
 *  These tools are thin fixed-route proxies with no logic of their own — the shared request core
 *  (makeMcpRequest, still the daemon's) is pinned there. What is pinned HERE is the route each tool
 *  maps to and the body it forwards: a spawned agent calls these by name and never sees the URL, so a
 *  wrong path fails at runtime with nothing to point at. */
import { describe, it, expect } from 'vitest';
import { makeMcpRequest } from 'elowen/dist/mcp/tools.js';
import type { CallResult } from 'elowen/dist/shared/apiClient.js';
import { WORK_MCP_TOOLS } from '../plugins/work/dist/mcpTools.js';

type Call = { m: string; p: string; b: unknown; url: string; token: string };

function spy(result: CallResult = { status: 200, ok: true, data: { ok: 1 }, text: '' }) {
  const calls: Call[] = [];
  const call = async (m: string, p: string, b: unknown, o: { url: string; token: string }): Promise<CallResult> => {
    calls.push({ m, p, b, url: o.url, token: o.token });
    return result;
  };
  return { calls, call };
}

const tool = (name: string) => {
  const t = WORK_MCP_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`missing MCP tool ${name}`);
  return t;
};

describe('work plugin MCP tools (REST proxies over makeMcpRequest)', () => {
  it('typed helpers are thin fixed-route wrappers with no own logic', async () => {
    const { calls, call } = spy();
    const req = makeMcpRequest({ url: 'http://d', token: 't', call: call as never });
    await tool('elowen_tasks').run({}, req);
    await tool('elowen_create_task').run({ title: 'x', project_id: 1 }, req);
    await tool('elowen_plan').run({ goal: 'g', project_id: 1 }, req);
    expect(calls.map((c) => `${c.m} ${c.p}`)).toEqual(['GET /tasks', 'POST /tasks', 'POST /tasks/plan']);
    expect(calls[1].b).toEqual({ title: 'x', project_id: 1 });
  });

  it('elowen_plan forwards all planning options to POST /tasks/plan', async () => {
    const { calls, call } = spy();
    const req = makeMcpRequest({ url: 'http://d', token: 't', call: call as never });
    const args = {
      goal: 'build feature',
      project_id: 2,
      name: 'my-mission',
      exec: 'sonnet',
      autoModel: true,
      autonomy: 'L2',
      maxSessions: 3,
      engage: true,
      dryRun: false,
      prompt: 'custom prompt',
      prEnabled: true,
    };
    await tool('elowen_plan').run(args, req);
    expect(calls[0].m).toBe('POST');
    expect(calls[0].p).toBe('/tasks/plan');
    expect(calls[0].b).toEqual(args);
  });

  // ---- Task lifecycle ----
  it('elowen_task_update maps to PATCH /tasks/:id with only the passed fields', async () => {
    const { calls, call } = spy();
    const req = makeMcpRequest({ url: 'http://d', token: 't', call: call as never });
    await tool('elowen_task_update').run({ id: 't-1', status: 'in_progress', title: 'new title' }, req);
    expect(calls[0]).toMatchObject({ m: 'PATCH', p: '/tasks/t-1', b: { status: 'in_progress', title: 'new title' } });
  });

  it('elowen_task_close maps to PATCH /tasks/:id with status closed + outcome', async () => {
    const { calls, call } = spy();
    const req = makeMcpRequest({ url: 'http://d', token: 't', call: call as never });
    await tool('elowen_task_close').run({ id: 't-1', result_summary: 'done', outcome: 'ok' }, req);
    expect(calls[0]).toMatchObject({ m: 'PATCH', p: '/tasks/t-1', b: { status: 'closed', result_summary: 'done', outcome: 'ok' } });
  });

  it('elowen_task_usage maps to GET /tasks/:id/usage', async () => {
    const { calls, call } = spy();
    const req = makeMcpRequest({ url: 'http://d', token: 't', call: call as never });
    await tool('elowen_task_usage').run({ id: 't-1' }, req);
    expect(calls[0]).toMatchObject({ m: 'GET', p: '/tasks/t-1/usage' });
  });
});
