// @vitest-environment node
//
// Organization-only conversation grouping for recurring cron jobs.
//
// The whole point of these cases is that grouping a job under a conversation is FILING and nothing else:
// it never moves where the job runs, whose rights it runs with, which model it uses or where its result
// is delivered. The identity that survives is the host-minted immutable key, never the session id — ids
// are re-keyed by a channel rollover and the freed id is handed to the next conversation on that channel.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventBus } from 'elowen/dist/api/sse.js';
import { createServer } from 'elowen/dist/api/server.js';
import { FakeClock } from 'elowen/dist/shared/clock.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { UserStore } from 'elowen/dist/store/userStore.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { UserProjectStore } from 'elowen/dist/store/userProjectStore.js';
import { openDb } from 'elowen/dist/store/db.js';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import { PluginRegistryProvider } from 'elowen/dist/plugins/pluginsProvider.js';
import { runWithPolicy } from 'elowen/dist/plugins/policyContext.js';
import type { TurnIdentity } from 'elowen/dist/plugins/policyContext.js';
import type { Policy } from 'elowen/dist/plugins/policy.js';
import type { PluginHostWiring } from 'elowen/dist/plugins/api.js';
import { conversationDirectory, type FakeConversationRow } from './helpers/conversationDirectory.js';

const log = { info: () => {}, warn: () => {}, error: () => {} };
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(repoRoot, 'plugins');
const ADMIN: Policy = { allowedProjectIds: 'all', allowedPaths: () => [] };
const LIMITED: Policy = { allowedProjectIds: new Set([1]), allowedPaths: () => [] };

let dirs: string[] = [];
const tmpDir = (tag: string): string => { const p = mkdtempSync(join(tmpdir(), `elowen-${tag}-`)); dirs.push(p); return p; };
afterEach(() => { for (const p of dirs) rmSync(p, { recursive: true, force: true }); dirs = []; });

const jobsFile = (dataRoot: string) => join(dataRoot, 'cronjob', 'jobs.json');
const seedJobs = (dataRoot: string, jobs: unknown[]): void => {
  mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
  writeFileSync(jobsFile(dataRoot), JSON.stringify(jobs));
};
const onDisk = (dataRoot: string): Record<string, unknown>[] =>
  (existsSync(jobsFile(dataRoot)) ? JSON.parse(readFileSync(jobsFile(dataRoot), 'utf-8')) : []);
const asText = (r: { content: { text?: string }[] }) => (r.content[0] as { text: string }).text;

/** Amy owns two ordinary conversations; the operator owns one plus a shared Discord room. The worker run
 *  and the untouched shell are the two shapes core reports as not offerable. */
const baseRows = (amyId: number, adminId: number): FakeConversationRow[] => [
  { id: 'brain-amy', key: 'ns-amy-1', title: 'Amy morning chat', ownerUserId: amyId, updatedAt: '2026-09-05T10:00:00.000Z' },
  { id: 'brain-amy-2', key: 'ns-amy-2', title: 'Amy second chat', ownerUserId: amyId, updatedAt: '2026-09-04T10:00:00.000Z' },
  { id: 'brain-admin', key: 'ns-admin-1', title: 'Operator chat', ownerUserId: adminId, updatedAt: '2026-09-06T10:00:00.000Z' },
  { id: 'brain-ch-discord-team', key: 'ns-room', title: 'Team room', ownerUserId: adminId, platform: 'discord', updatedAt: '2026-09-03T10:00:00.000Z' },
  { id: 'brain-ch-cron-job-w1', key: 'ns-worker', title: 'cron run', ownerUserId: amyId, platform: 'cron', eligible: false },
  { id: 'brain-amy-shell', key: 'ns-shell', title: '', ownerUserId: amyId, empty: true },
];

// ── HTTP harness: the real daemon server serving the plugin's own root mounts ────────────────────────

/** `directory` is how the HOST answers about conversations: normally, not at all (a core without the
 *  projection), or by failing (the read itself threw). The last two are different answers and the plugin
 *  must not merge them into "your conversation is gone". */
function setupRoutes(
  rows?: (amyId: number, adminId: number) => FakeConversationRow[],
  opts: { directory?: 'ok' | 'missing' | 'broken' } = {},
) {
  const dataRoot = tmpDir('cron-groups');
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const users = new UserStore(db);
  const admin = users.create('admin', 'pw');
  const amy = users.create('amy', 'pw');
  const bob = users.create('bob', 'pw');
  // cronjob is user-grantable: without the grant the core gate answers 403 before the plugin is reached.
  for (const account of [amy, bob]) users.setGrantedPlugins(account.id, ['cronjob']);
  const table = (rows ?? baseRows)(amy.id, admin.id);
  table.push({ id: 'brain-bob', key: 'ns-bob-1', title: 'Bob chat', ownerUserId: bob.id });
  const directory = conversationDirectory(table, { admins: [admin.id] });
  const wiredDirectory = opts.directory === 'broken'
    ? { ...directory, resolveKey: () => { throw new Error('the conversation store is unavailable'); } }
    : directory;
  const provider = new PluginRegistryProvider(() => loadPlugins({
    dirs: [pluginsDir], enabled: ['cronjob'], dataRoot, logger: log,
    host: {
      stores: {
        usersRead: {
          list: () => users.list().map((user) => ({ id: user.id, username: user.username, name: user.name, avatar: user.avatar })),
          isAdmin: (id: number) => users.isAdmin(id),
          allowedExecs: () => null,
          mayUsePlugin: () => true,
        },
        ...(opts.directory === 'missing' ? {} : { conversationsRead: wiredDirectory }),
      },
    } as never,
  }));
  const app = createServer({
    bus: new EventBus(),
    engine: null as never, spawn: null as never, tmux: null as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config: new ConfigStore(db), users, projects: new ProjectStore(db),
    userProjects: new UserProjectStore(db), pluginDataRoot: dataRoot, pluginDirs: [pluginsDir], plugins: provider,
  });
  return {
    app, dataRoot, table, directory, admin, amy, bob,
    adminTok: users.issueToken(admin.id), amyTok: users.issueToken(amy.id), bobTok: users.issueToken(bob.id),
  };
}

const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const put = (t: string, body: unknown) => ({
  method: 'PUT',
  headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
type TestApp = { request: (path: string, init?: unknown) => Promise<Response> };
const save = (app: TestApp, tok: string, job: Record<string, unknown>) =>
  app.request(`/plugins/cronjob/jobs/${encodeURIComponent(String(job.id))}`, put(tok, job));

/** A stored recurring job carrying every runtime field an organization-only edit must leave alone. */
const storedJob = (extra: Record<string, unknown> = {}) => ({
  id: 'j1', name: 'digest', schedule: 'daily 06:00', prompt: 'Summarize the day.', enabled: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  lastRun: '2026-09-05T06:00:03.000Z', lastSlot: '2026-09-05T06:00', lastResult: 'ok',
  revision: 3, ...extra,
});
/** What a client may send back: the editable half of a stored job. */
const editable = (job: Record<string, unknown>): Record<string, unknown> => {
  const { lastRun: _lr, lastSlot: _ls, lastResult: _lres, revision: _rev,
    originSessionId: _os, originUserId: _ou, originDeliveryTarget: _od,
    conversationKey: _ck, conversationSessionId: _cs, ...rest } = job;
  return rest;
};

// ── Tool / control harness: the plugin loaded on its own ─────────────────────────────────────────────

async function loadCron(opts: {
  dataRoot: string;
  rows: FakeConversationRow[];
  admins?: number[];
  accounts?: number[];
  directory?: boolean;
}) {
  const directory = conversationDirectory(opts.rows, { admins: opts.admins ?? [] });
  const reg = await loadPlugins({
    dirs: [pluginsDir], enabled: ['cronjob'], dataRoot: opts.dataRoot, logger: log,
    host: {
      stores: {
        usersRead: {
          isAdmin: (id: number) => (opts.admins ?? []).includes(id),
          mayUsePlugin: () => true,
          list: () => (opts.accounts ?? [1, 4, 5]).map((id) => ({ id })),
        },
        ...(opts.directory === false ? {} : { conversationsRead: directory }),
      },
    } as unknown as PluginHostWiring,
  });
  const tool = (name: string) => reg.tools.find((t) => t.name === name)!;
  return { reg, directory, tool };
}
const run = (tool: { execute: (id: string, p: unknown, a: never, b: never) => Promise<{ content: { text?: string }[] }> }, params: unknown) =>
  tool.execute('t', params, undefined as never, undefined as never);
const speaking = (id: TurnIdentity, where: 'own' | 'direct' | 'shared'): TurnIdentity => ({ ...id, conversation: where }) as TurnIdentity;
const AMY: TurnIdentity = { platform: 'elowen', userId: '4', elowenUserId: 4, admin: false, owner: false };
const OPERATOR: TurnIdentity = { platform: 'elowen', userId: '1', elowenUserId: 1, admin: true, owner: true };

// ── Persistence and validation ───────────────────────────────────────────────────────────────────────

describe('cron HTTP save — the organizational association', () => {
  it('refuses a NEW recurring job that names no conversation, and writes nothing', async () => {
    const { app, dataRoot, adminTok } = setupRoutes();
    const res = await save(app, adminTok, { id: 'new1', name: 'digest', schedule: 'daily 06:00', prompt: 'p' });
    expect(res.status).toBe(400);
    expect(String((await res.json() as { error: string }).error)).toMatch(/conversation/i);
    expect(onDisk(dataRoot)).toEqual([]);
  });

  it('still creates a one-shot wake-up, which is never grouped', async () => {
    const { app, dataRoot, adminTok } = setupRoutes();
    const res = await save(app, adminTok, {
      id: 'w1', name: 'check-deploy', schedule: 'in 20m', prompt: 'p', runAt: '2026-09-06T18:00:00.000Z',
    });
    expect(res.status).toBe(200);
    expect(onDisk(dataRoot)[0]).not.toHaveProperty('conversationKey');
  });

  it('stores the pair the HOST resolved and ignores a client-supplied key', async () => {
    const { app, dataRoot, amyTok, amy } = setupRoutes();
    const res = await save(app, amyTok, {
      id: 'a1', name: 'digest', schedule: 'daily 06:00', prompt: 'p',
      conversationSessionId: 'brain-amy', conversationKey: 'ns-forged',
    });
    expect(res.status).toBe(200);
    const [saved] = onDisk(dataRoot);
    expect(saved).toMatchObject({ conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1', ownerUserId: amy.id });
    // The immutable key is the daemon's own identity value and never leaves it.
    expect(await res.json()).toMatchObject({ ok: true });
    expect(JSON.stringify(await (await app.request('/plugins/cronjob/jobs', auth(amyTok))).json())).not.toContain('ns-amy-1');
  });

  it('projects the current conversation for the editor without exposing the key', async () => {
    const { app, dataRoot, amyTok, amy } = setupRoutes();
    seedJobs(dataRoot, [storedJob({ ownerUserId: amy.id, conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1' })]);
    const listed = await (await app.request('/plugins/cronjob/jobs', auth(amyTok))).json() as Record<string, unknown>[];
    expect(listed[0]).toMatchObject({
      conversationSessionId: 'brain-amy',
      conversation: { id: 'brain-amy', title: 'Amy morning chat' },
    });
    expect(listed[0]).not.toHaveProperty('conversationKey');
  });

  it('preserves the saved pair when an older editor omits the field entirely', async () => {
    const { app, dataRoot, amyTok, amy } = setupRoutes();
    const job = storedJob({ ownerUserId: amy.id, conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1' });
    seedJobs(dataRoot, [job]);
    const res = await save(app, amyTok, { ...editable(job), prompt: 'Edited.' });
    expect(res.status).toBe(200);
    expect(onDisk(dataRoot)[0]).toMatchObject({
      prompt: 'Edited.', conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1',
    });
  });

  it('refuses a blank replacement instead of silently detaching a valid binding', async () => {
    const { app, dataRoot, amyTok, amy } = setupRoutes();
    const job = storedJob({ ownerUserId: amy.id, conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1' });
    seedJobs(dataRoot, [job]);
    const res = await save(app, amyTok, { ...editable(job), conversationSessionId: '   ' });
    expect(res.status).toBe(400);
    expect(onDisk(dataRoot)[0]).toMatchObject({ conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1', revision: 3 });
  });

  it('refuses a conversation the caller may not organize under, and keeps the previous one', async () => {
    const { app, dataRoot, amyTok, amy } = setupRoutes();
    const job = storedJob({ ownerUserId: amy.id, conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1' });
    seedJobs(dataRoot, [job]);
    for (const wanted of ['brain-bob', 'brain-ch-cron-job-w1', 'brain-amy-shell', 'brain-nope']) {
      const res = await save(app, amyTok, { ...editable(job), conversationSessionId: wanted });
      expect(res.status, wanted).toBe(400);
    }
    expect(onDisk(dataRoot)[0]).toMatchObject({ conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1', revision: 3 });
  });

  it('changes ONLY the association and the revision when a job is regrouped', async () => {
    const { app, dataRoot, amyTok, amy } = setupRoutes();
    const job = storedJob({
      ownerUserId: amy.id, hours: '5-21', model: { provider: 'anthropic', model: 'claude-opus-5' },
      originSessionId: 'brain-ch-msteams-amy', originUserId: amy.id, originDeliveryTarget: 'msteams:29:x',
      conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1',
    });
    seedJobs(dataRoot, [job]);
    const res = await save(app, amyTok, { ...editable(job), conversationSessionId: 'brain-amy-2' });
    expect(res.status).toBe(200);
    expect(onDisk(dataRoot)[0]).toEqual({
      ...job, conversationSessionId: 'brain-amy-2', conversationKey: 'ns-amy-2', revision: 4,
    });
  });

  it('revalidates the association when the job changes hands', async () => {
    const { app, dataRoot, adminTok, amy, bob } = setupRoutes();
    const job = storedJob({ ownerUserId: amy.id, conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1' });
    seedJobs(dataRoot, [job]);
    // Carrying Amy's conversation onto Bob's job would file his automation under her chat.
    const refused = await save(app, adminTok, { ...editable(job), ownerUserId: bob.id });
    expect(refused.status).toBe(400);
    expect(onDisk(dataRoot)[0]).toMatchObject({ ownerUserId: amy.id, conversationKey: 'ns-amy-1' });

    const accepted = await save(app, adminTok, { ...editable(job), ownerUserId: bob.id, conversationSessionId: 'brain-bob' });
    expect(accepted.status).toBe(200);
    expect(onDisk(dataRoot)[0]).toMatchObject({ ownerUserId: bob.id, conversationSessionId: 'brain-bob', conversationKey: 'ns-bob-1' });
  });

  it('lets a legacy job without any association go on being edited', async () => {
    const { app, dataRoot, amyTok, amy } = setupRoutes();
    const job = storedJob({ ownerUserId: amy.id });
    seedJobs(dataRoot, [job]);
    const res = await save(app, amyTok, { ...editable(job), prompt: 'Edited.' });
    expect(res.status).toBe(200);
    expect(onDisk(dataRoot)[0]).not.toHaveProperty('conversationKey');
  });

  it('keeps an unavailable target as an explicit missing reference, and allows reassignment', async () => {
    const { app, dataRoot, amyTok, amy } = setupRoutes();
    const job = storedJob({ ownerUserId: amy.id, conversationSessionId: 'brain-gone', conversationKey: 'ns-gone' });
    seedJobs(dataRoot, [job]);
    const listed = await (await app.request('/plugins/cronjob/jobs', auth(amyTok))).json() as Record<string, unknown>[];
    expect(listed[0]).toMatchObject({ conversationSessionId: 'brain-gone', conversation: null });

    const kept = await save(app, amyTok, { ...editable(job), conversationSessionId: 'brain-gone', prompt: 'Edited.' });
    expect(kept.status).toBe(200);
    expect(onDisk(dataRoot)[0]).toMatchObject({ conversationKey: 'ns-gone', prompt: 'Edited.' });

    const moved = await save(app, amyTok, { ...editable(job), conversationSessionId: 'brain-amy' });
    expect(moved.status).toBe(200);
    expect(onDisk(dataRoot)[0]).toMatchObject({ conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1' });
  });

  // A host that cannot answer about conversations at all. The save must FAIL CLOSED rather than store an
  // association nothing verified — and it must not write half a job on the way out.
  it('refuses to create or file a job on a core with no conversation directory', async () => {
    const { app, dataRoot, adminTok, amy, amyTok } = setupRoutes(undefined, { directory: 'missing' });
    const created = await save(app, adminTok, {
      id: 'new1', name: 'digest', schedule: 'daily 06:00', prompt: 'p', conversationSessionId: 'brain-admin',
    });
    expect(created.status).toBe(400);
    expect(onDisk(dataRoot)).toEqual([]);

    // An existing job cannot be refiled either, and the pair on disk is left exactly as it was.
    const job = storedJob({ ownerUserId: amy.id, conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1' });
    seedJobs(dataRoot, [job]);
    const moved = await save(app, amyTok, { ...editable(job), conversationSessionId: 'brain-amy-2' });
    expect(moved.status).toBe(400);
    expect(onDisk(dataRoot)[0]).toMatchObject({ conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1', revision: 3 });
  });

  // A read that FAILED is not an answer about the conversation. Reporting it as `conversation: null` told
  // the editor the conversation had been deleted, which is a wrong answer rather than an unknown one: the
  // reader is asked to refile a job whose filing is very probably still perfectly good.
  it('reports an unresolved filing as unknown rather than as a deleted conversation', async () => {
    const { app, dataRoot, amyTok, amy } = setupRoutes(undefined, { directory: 'broken' });
    seedJobs(dataRoot, [storedJob({ ownerUserId: amy.id, conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1' })]);

    const listed = await (await app.request('/plugins/cronjob/jobs', auth(amyTok))).json() as Record<string, unknown>[];
    expect(listed[0]).toMatchObject({ conversationSessionId: 'brain-amy', conversation: null, conversationUnresolved: true });
    // Still no key on the wire, whatever the host did.
    expect(listed[0]).not.toHaveProperty('conversationKey');

    // And a job whose conversation really is gone stays the definite answer it was.
    const gone = setupRoutes();
    seedJobs(gone.dataRoot, [storedJob({ ownerUserId: gone.amy.id, conversationSessionId: 'brain-gone', conversationKey: 'ns-gone' })]);
    const goneListed = await (await gone.app.request('/plugins/cronjob/jobs', auth(gone.amyTok))).json() as Record<string, unknown>[];
    expect(goneListed[0]).toMatchObject({ conversation: null });
    expect(goneListed[0]).not.toHaveProperty('conversationUnresolved');
  });

  // The conflict payload carries the whole previous job — prompt, schedule, last result. Answering it
  // before the ownership check told anyone with a job id what somebody else had scheduled.
  it('answers a foreign job with 403 before any revision-conflict payload', async () => {
    const { app, dataRoot, bobTok, amy } = setupRoutes();
    seedJobs(dataRoot, [storedJob({
      ownerUserId: amy.id, prompt: 'Amy private plan.', revision: 7,
      conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1',
    })]);
    const res = await save(app, bobTok, { id: 'j1', name: 'x', schedule: 'daily 06:00', prompt: 'p', expectedRevision: 2 });
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).not.toContain('Amy private plan.');
    expect(body).not.toContain('conflict');
    expect(onDisk(dataRoot)[0]).toMatchObject({ prompt: 'Amy private plan.', revision: 7 });
  });
});

// ── Stable identity across a channel rollover ────────────────────────────────────────────────────────

describe('cron association — identity survives a channel rollover', () => {
  it('follows the original conversation and never the account that reuses its id', async () => {
    const { app, dataRoot, table, amyTok, amy, bob } = setupRoutes();
    table.push({ id: 'brain-ch-discord-amy', key: 'ns-roll', title: 'Amy direct', ownerUserId: amy.id, platform: 'discord', direct: true });
    seedJobs(dataRoot, [storedJob({ ownerUserId: amy.id, conversationSessionId: 'brain-ch-discord-amy', conversationKey: 'ns-roll' })]);

    // The rollover re-keys the original row to an archived id and frees the channel id, which the next
    // conversation on that channel takes — here a different account entirely.
    const rolled = table.find((row) => row.key === 'ns-roll')!;
    rolled.id = 'brain-ch-discord-amy-archived-1';
    rolled.eligible = false;
    table.push({ id: 'brain-ch-discord-amy', key: 'ns-fresh', title: 'Bob direct', ownerUserId: bob.id, platform: 'discord', direct: true });

    const listed = await (await app.request('/plugins/cronjob/jobs', auth(amyTok))).json() as Record<string, unknown>[];
    expect(listed[0]).toMatchObject({
      conversationSessionId: 'brain-ch-discord-amy-archived-1',
      conversation: { id: 'brain-ch-discord-amy-archived-1', title: 'Amy direct' },
    });
  });
});

// ── The navigation control core reads once per listing ───────────────────────────────────────────────

describe('cron control — conversationLinks', () => {
  const links = (reg: { control: (k: string) => unknown }, input: unknown) =>
    (reg.control('cron') as { conversationLinks: (i: unknown) => unknown[] }).conversationLinks(input);

  it('keeps the required wake-up method and adds the optional navigation one', async () => {
    const dataRoot = tmpDir('cron-ctl');
    const { reg } = await loadCron({ dataRoot, rows: baseRows(4, 1), admins: [1] });
    const control = reg.control('cron') as Record<string, unknown>;
    expect(typeof control.pendingWakeupOriginSessionIds).toBe('function');
    expect(typeof control.conversationLinks).toBe('function');
  });

  it('returns only recurring jobs inside the authorized ids, with the plugin ownership rule applied', async () => {
    const dataRoot = tmpDir('cron-ctl');
    seedJobs(dataRoot, [
      storedJob({ id: 'mine', name: 'Amy digest', ownerUserId: 4, conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1' }),
      storedJob({ id: 'paused', name: 'Amy paused', ownerUserId: 4, enabled: false, conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1' }),
      storedJob({ id: 'elsewhere', name: 'Amy elsewhere', ownerUserId: 4, conversationSessionId: 'brain-amy-2', conversationKey: 'ns-amy-2' }),
      storedJob({ id: 'instance', name: 'Instance digest', conversationSessionId: 'brain-admin', conversationKey: 'ns-admin-1' }),
      storedJob({ id: 'wake', name: 'wake', ownerUserId: 4, runAt: '2026-09-09T10:00:00.000Z', conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1' }),
      storedJob({ id: 'unlinked', name: 'Legacy', ownerUserId: 4 }),
    ]);
    const { reg } = await loadCron({ dataRoot, rows: baseRows(4, 1), admins: [1] });

    const amy = links(reg, { requesterUserId: 4, requesterIsAdmin: false, conversationIds: ['brain-amy'] });
    expect(amy).toEqual([
      { jobId: 'mine', conversationId: 'brain-amy', name: 'Amy digest', enabled: true, ownerUserId: 4 },
      { jobId: 'paused', conversationId: 'brain-amy', name: 'Amy paused', enabled: false, ownerUserId: 4 },
    ]);

    // An ordinary account never receives an instance job, whatever ids it was authorized for.
    expect(links(reg, { requesterUserId: 4, requesterIsAdmin: false, conversationIds: ['brain-admin'] })).toEqual([]);
    // The operator's register sees the instance branch on the same read.
    expect(links(reg, { requesterUserId: 1, requesterIsAdmin: true, conversationIds: ['brain-admin'] }))
      .toEqual([{ jobId: 'instance', conversationId: 'brain-admin', name: 'Instance digest', enabled: true, ownerUserId: null }]);
  });

  it('throws on an unreadable jobs file rather than reporting an empty job list', async () => {
    const dataRoot = tmpDir('cron-ctl');
    mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
    writeFileSync(jobsFile(dataRoot), '{not json');
    const { reg } = await loadCron({ dataRoot, rows: baseRows(4, 1), admins: [1] });
    expect(() => links(reg, { requesterUserId: 4, requesterIsAdmin: false, conversationIds: ['brain-amy'] })).toThrow();
  });
});

// ── Tools ────────────────────────────────────────────────────────────────────────────────────────────

describe('CronAdd — the organizational conversation is explicit', () => {
  it('refuses to create a recurring job without one, and stores nothing', async () => {
    const dataRoot = tmpDir('cron-add');
    const { tool } = await loadCron({ dataRoot, rows: baseRows(4, 1), admins: [1] });
    await runWithPolicy(LIMITED, async () => {
      const out = asText(await run(tool('CronAdd'), { name: 'mine', scope: 'personal', schedule: 'daily 07:30', prompt: 'p' }));
      expect(out).toMatch(/conversation/i);
    }, { identity: speaking(AMY, 'own'), sessionId: 'brain-amy' });
    expect(onDisk(dataRoot)).toEqual([]);
  });

  it('refuses a target the caller may not use, and never says whose it is', async () => {
    const dataRoot = tmpDir('cron-add');
    const { tool } = await loadCron({ dataRoot, rows: baseRows(4, 1), admins: [1] });
    await runWithPolicy(LIMITED, async () => {
      for (const wanted of ['brain-admin', 'brain-ch-cron-job-w1', 'brain-amy-shell', 'brain-nope']) {
        const out = asText(await run(tool('CronAdd'), {
          name: 'mine', scope: 'personal', schedule: 'daily 07:30', prompt: 'p', conversationSessionId: wanted,
        }));
        expect(out, wanted).toMatch(/^Error:/);
        expect(out).not.toContain('Operator chat');
      }
    }, { identity: speaking(AMY, 'own'), sessionId: 'brain-amy' });
    expect(onDisk(dataRoot)).toEqual([]);
  });

  it('stores the host-resolved pair and leaves the origin binding exactly as it was', async () => {
    const dataRoot = tmpDir('cron-add');
    const { tool } = await loadCron({ dataRoot, rows: baseRows(4, 1), admins: [1] });
    await runWithPolicy(LIMITED, async () => {
      const out = asText(await run(tool('CronAdd'), {
        name: 'mine', scope: 'personal', schedule: 'daily 07:30', prompt: 'p', conversationSessionId: 'brain-amy-2',
      }));
      expect(out).toContain('Scheduled');
      // Grouping is not delivery: the reply still lands in the conversation that asked.
      expect(out).toContain('report here');
      expect(out).not.toContain('Amy second chat');
    }, { identity: speaking(AMY, 'own'), sessionId: 'brain-amy' });
    expect(onDisk(dataRoot)[0]).toMatchObject({
      ownerUserId: 4, originSessionId: 'brain-amy', originUserId: 4,
      conversationSessionId: 'brain-amy-2', conversationKey: 'ns-amy-2',
    });
  });

  it('refuses a delegated turn that carries no account', async () => {
    const dataRoot = tmpDir('cron-add');
    const { tool } = await loadCron({ dataRoot, rows: baseRows(4, 1), admins: [1] });
    await runWithPolicy(LIMITED, async () => {
      const out = asText(await run(tool('CronAdd'), {
        name: 'mine', scope: 'personal', schedule: 'daily 07:30', prompt: 'p', conversationSessionId: 'brain-amy',
      }));
      expect(out).toMatch(/^Error:/);
    }, { identity: { platform: 'subagent', userId: 'subagent', admin: false, owner: false } as TurnIdentity });
    expect(onDisk(dataRoot)).toEqual([]);
  });
});

describe('CronConversations — discovery that respects the room', () => {
  it('lists the account\'s own eligible conversations in a private chat', async () => {
    const dataRoot = tmpDir('cron-disc');
    const { tool } = await loadCron({ dataRoot, rows: baseRows(4, 1), admins: [1] });
    await runWithPolicy(LIMITED, async () => {
      const out = asText(await run(tool('CronConversations'), {}));
      expect(out).toContain('brain-amy');
      expect(out).toContain('Amy morning chat');
      expect(out).not.toContain('Operator chat');
      expect(out).not.toContain('brain-ch-cron-job-w1');
      expect(out).not.toContain('brain-amy-shell');
    }, { identity: speaking(AMY, 'own'), sessionId: 'brain-amy' });
  });

  it('never enumerates private conversations in a shared room, not even for an operator', async () => {
    const dataRoot = tmpDir('cron-disc');
    const { tool } = await loadCron({ dataRoot, rows: baseRows(4, 1), admins: [1] });
    await runWithPolicy(ADMIN, async () => {
      const out = asText(await run(tool('CronConversations'), {}));
      expect(out).not.toContain('Amy morning chat');
      expect(out).not.toContain('brain-amy');
      expect(out).not.toContain('Operator chat');
      // Only the room everyone here is already in.
      expect(out).toContain('brain-ch-discord-team');
    }, { identity: speaking(OPERATOR, 'shared'), sessionId: 'brain-ch-discord-team' });
  });

  it('requires the operator for the instance scope', async () => {
    const dataRoot = tmpDir('cron-disc');
    const { tool } = await loadCron({ dataRoot, rows: baseRows(4, 1), admins: [1] });
    await runWithPolicy(LIMITED, async () => {
      const out = asText(await run(tool('CronConversations'), { scope: 'instance' }));
      expect(out).toMatch(/^Error:/);
      expect(out).not.toContain('Operator chat');
    }, { identity: speaking(AMY, 'own'), sessionId: 'brain-amy' });

    await runWithPolicy(ADMIN, async () => {
      const out = asText(await run(tool('CronConversations'), { scope: 'instance' }));
      expect(out).toContain('Amy morning chat');
      expect(out).toContain('Operator chat');
    }, { identity: speaking(OPERATOR, 'own'), sessionId: 'brain-admin' });
  });

  it('refuses a turn with no account behind it', async () => {
    const dataRoot = tmpDir('cron-disc');
    const { tool } = await loadCron({ dataRoot, rows: baseRows(4, 1), admins: [1] });
    await runWithPolicy(LIMITED, async () => {
      expect(asText(await run(tool('CronConversations'), {}))).toMatch(/^Error:/);
    }, { identity: { platform: 'subagent', userId: 'subagent', admin: false, owner: false } as TurnIdentity });
  });
});

describe('CronList — the grouping label follows the audience', () => {
  it('names the conversation in a private chat and never in a shared room', async () => {
    const dataRoot = tmpDir('cron-list');
    seedJobs(dataRoot, [
      storedJob({ id: 'j1', name: 'digest', ownerUserId: 4, conversationSessionId: 'brain-amy', conversationKey: 'ns-amy-1' }),
      storedJob({ id: 'j2', name: 'orphan', ownerUserId: 4, conversationSessionId: 'brain-gone', conversationKey: 'ns-gone' }),
    ]);
    const { tool } = await loadCron({ dataRoot, rows: baseRows(4, 1), admins: [1] });

    // Read from ANOTHER of her conversations, so the label has to name the one the job is filed under.
    await runWithPolicy(LIMITED, async () => {
      const out = asText(await run(tool('CronList'), {}));
      expect(out).toContain('Amy morning chat');
      expect(out).toMatch(/unavailable/i);
    }, { identity: speaking(AMY, 'own'), sessionId: 'brain-amy-2' });

    // Read from the conversation it is filed under, it says so without repeating the title.
    await runWithPolicy(LIMITED, async () => {
      expect(asText(await run(tool('CronList'), {}))).toContain('grouped: this conversation');
    }, { identity: speaking(AMY, 'own'), sessionId: 'brain-amy' });

    await runWithPolicy(LIMITED, async () => {
      const out = asText(await run(tool('CronList'), {}));
      expect(out).not.toContain('Amy morning chat');
      expect(out).not.toContain('brain-amy');
      expect(out).toMatch(/grouped/i);
    }, { identity: speaking({ ...AMY, platform: 'discord' }, 'shared'), sessionId: 'brain-ch-discord-team' });
  });
});

// ── The authenticated picker endpoint ────────────────────────────────────────────────────────────────

describe('cron picker endpoint', () => {
  it('lists the caller\'s own eligible conversations', async () => {
    const { app, amyTok } = setupRoutes();
    const res = await app.request('/plugins/cronjob/api/conversations', auth(amyTok));
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; conversations: { id: string; title: string }[] };
    expect(body.status).toBe('available');
    expect(body.conversations.map((c) => c.id)).toEqual(['brain-amy', 'brain-amy-2']);
    expect(JSON.stringify(body)).not.toContain('ns-amy-1');
  });

  it('refuses a foreign owner scope to a non-admin and serves it to an operator', async () => {
    const { app, amyTok, adminTok, amy } = setupRoutes();
    const denied = await app.request(`/plugins/cronjob/api/conversations?owner=${amy.id + 1}`, auth(amyTok));
    expect(denied.status).toBe(403);

    const allowed = await app.request(`/plugins/cronjob/api/conversations?owner=${amy.id}`, auth(adminTok));
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as { conversations: { id: string }[] }).conversations.map((c) => c.id))
      .toEqual(['brain-amy', 'brain-amy-2']);
  });

  it('serves the instance scope to an operator only', async () => {
    const { app, amyTok, adminTok } = setupRoutes();
    expect((await app.request('/plugins/cronjob/api/conversations?scope=instance', auth(amyTok))).status).toBe(403);
    const res = await app.request('/plugins/cronjob/api/conversations?scope=instance', auth(adminTok));
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { conversations: { id: string }[] }).conversations.map((c) => c.id);
    expect(ids).toContain('brain-amy');
    expect(ids).toContain('brain-ch-discord-team');
    expect(ids).not.toContain('brain-ch-cron-job-w1');
  });
});
