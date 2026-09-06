// Filing a recurring job under a different conversation changes WHERE IT IS LISTED and nothing else.
//
// The stored-field assertions live in cronConversationGroups.test.ts; this one asks the question the
// user's decision actually turns on — what the NEXT SCHEDULED RUN does. The adapter is ticked before and
// after a regroup and the two turn sources are compared whole, so any drift in the delivery origin, the
// acting identity, the model pair, the admin flag or the prompt fails here rather than in production the
// first time a job reports into the wrong place.
//
// Nothing is delivered: the tick's handler is a local stub, no model is called and no host exists.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { register } from '../plugins/cronjob/index.mjs';

const log = { info() {}, warn() {}, error() {} };

/** Two conversations of the same account, plus one of another account — the directory core would give. */
const ROWS = [
  { id: 'brain-2', key: 'ns-brain-2', title: 'Klientský projekt', ownerUserId: 2 },
  { id: 'brain-2-b', key: 'ns-brain-2-b', title: 'CRON JOBS', ownerUserId: 2 },
  { id: 'brain-1', key: 'ns-brain-1', title: 'Provoz', ownerUserId: 1 },
];
const target = (row) => ({
  id: row.id, key: row.key, title: row.title, ownerUserId: row.ownerUserId,
  platform: null, direct: false, updatedAt: '2026-09-01T00:00:00.000Z',
});

function loadPlugin(dataRoot) {
  mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
  const tools = [];
  const platforms = [];
  const routes = [];
  register({
    logger: log,
    config: {},
    dataDir: () => join(dataRoot, 'cronjob'),
    notify: async () => {},
    timezone: () => 'Europe/Prague',
    currentIdentity: () => null,
    currentSessionId: () => undefined,
    currentDeliveryTarget: () => undefined,
    isAdminSession: () => false,
    host: { stores: () => ({
      usersRead: { isAdmin: (id) => id === 1, mayUsePlugin: () => true, list: () => [{ id: 1 }, { id: 2 }] },
      conversationsRead: {
        list: ({ ownerUserId }) => ROWS.filter((r) => ownerUserId == null || r.ownerUserId === ownerUserId).map(target),
        resolve: ({ ownerUserId, sessionId }) => {
          const row = ROWS.find((r) => r.id === sessionId);
          if (!row || (ownerUserId != null && row.ownerUserId !== ownerUserId)) return null;
          return target(row);
        },
        resolveKey: (key) => {
          const row = ROWS.find((r) => r.key === key);
          return row ? target(row) : null;
        },
      },
    }) },
    registerTool: (tool) => tools.push(tool),
    registerPlatform: (platform) => platforms.push(platform),
    registerApiRoute: (route) => routes.push(route),
    registerUserRemoved() {},
    registerBootReconcile() {},
    registerControl() {},
    registerSkill() {},
  });
  const put = routes.find((r) => r.method === 'PUT' && r.rootMount === '/plugins/cronjob/jobs');
  return { tools, adapter: platforms[0], put };
}

const jobsFile = (dataRoot) => join(dataRoot, 'cronjob/jobs.json');
const onDisk = (dataRoot) => JSON.parse(readFileSync(jobsFile(dataRoot), 'utf8'));
const writeJobs = (dataRoot, jobs) => writeFileSync(jobsFile(dataRoot), JSON.stringify(jobs));

/** A job that is due right now, bound to a conversation for DELIVERY and filed under another one. */
const dueJob = (extra = {}) => ({
  id: 'r1', name: 'Denní přehled', schedule: 'every 15m', prompt: 'Shrň den.',
  ownerUserId: 2,
  originSessionId: 'brain-ch-msteams-amy', originUserId: 2, originDeliveryTarget: 'msteams:29:room',
  model: { provider: 'anthropic', model: 'claude-opus-5' },
  hours: '0-23',
  conversationSessionId: 'brain-2', conversationKey: 'ns-brain-2',
  lastRun: new Date(Date.now() - 20 * 60_000).toISOString(),
  createdAt: '2026-08-01T00:00:00.000Z',
  ...extra,
});

/** One controlled scheduler pass; returns what the host would have been asked to run. */
async function tickOnce(plugin) {
  let seen = null;
  let turns = 0;
  plugin.adapter.listen(async (src) => { seen = src; turns += 1; return 'ran'; });
  await plugin.adapter.tick();
  return { seen, turns };
}

const save = (plugin, id, body, auth) => plugin.put.handler({
  path: id, json: async () => body, auth, query: {},
});

test('regrouping a recurring job leaves its next scheduled run byte-identical', async (t) => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'elowen-cron-regroup-'));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));
  const plugin = loadPlugin(dataRoot);

  writeJobs(dataRoot, [dueJob()]);
  const before = await tickOnce(plugin);
  assert.equal(before.turns, 1, 'the job did not run before the regroup');

  // Re-arm the schedule so the job is due again, then file it under the other conversation.
  const armed = { ...onDisk(dataRoot)[0], lastRun: new Date(Date.now() - 20 * 60_000).toISOString() };
  writeJobs(dataRoot, [armed]);
  const res = await save(plugin, 'r1', {
    id: 'r1', name: armed.name, schedule: armed.schedule, prompt: armed.prompt,
    ownerUserId: 2, model: armed.model, hours: armed.hours, enabled: armed.enabled,
    conversationSessionId: 'brain-2-b', expectedRevision: armed.revision ?? 0,
  }, { userId: 2, admin: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const stored = onDisk(dataRoot)[0];
  assert.equal(stored.conversationSessionId, 'brain-2-b');
  assert.equal(stored.conversationKey, 'ns-brain-2-b');
  // The delivery binding is a different field and must not have moved with the filing.
  assert.equal(stored.originSessionId, 'brain-ch-msteams-amy');
  assert.equal(stored.originDeliveryTarget, 'msteams:29:room');

  const after = await tickOnce(plugin);
  assert.equal(after.turns, 1, 'the job did not run after the regroup');
  assert.deepEqual(after.seen, before.seen, 'the regroup changed what the scheduler asked the host to run');
  // Stated separately so a failure names the property rather than a diff of the whole source.
  assert.deepEqual(after.seen.origin, {
    sessionId: 'brain-ch-msteams-amy', userId: 2, deliveryTarget: 'msteams:29:room',
  });
  assert.equal(after.seen.access.actAsUserId, 2);
  assert.equal(after.seen.access.admin, false);
  assert.deepEqual(after.seen.access.model, { provider: 'anthropic', model: 'claude-opus-5' });
});

test('an instance job keeps its notification routing across a regroup', async (t) => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'elowen-cron-regroup-inst-'));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));
  const plugin = loadPlugin(dataRoot);

  const job = dueJob({
    id: 'i1', name: 'Zálohy', ownerUserId: undefined,
    originSessionId: undefined, originUserId: undefined, originDeliveryTarget: undefined,
    notifyChannelId: 'discord:1234', conversationSessionId: 'brain-1', conversationKey: 'ns-brain-1',
  });
  delete job.ownerUserId;
  delete job.originSessionId;
  delete job.originUserId;
  delete job.originDeliveryTarget;
  writeJobs(dataRoot, [job]);

  const before = await tickOnce(plugin);
  assert.equal(before.turns, 1);
  assert.equal(before.seen.access.admin, true);

  writeJobs(dataRoot, [{ ...onDisk(dataRoot)[0], lastRun: new Date(Date.now() - 20 * 60_000).toISOString() }]);
  const res = await save(plugin, 'i1', {
    id: 'i1', name: 'Zálohy', schedule: job.schedule, prompt: job.prompt, ownerUserId: null,
    notifyChannelId: 'discord:1234', model: job.model, hours: job.hours,
    conversationSessionId: 'brain-2-b', expectedRevision: onDisk(dataRoot)[0].revision ?? 0,
  }, { userId: 1, admin: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(onDisk(dataRoot)[0].conversationKey, 'ns-brain-2-b');
  assert.equal(onDisk(dataRoot)[0].notifyChannelId, 'discord:1234');

  const after = await tickOnce(plugin);
  assert.equal(after.turns, 1);
  assert.deepEqual(after.seen, before.seen, 'the regroup changed an instance job\'s run');
});
