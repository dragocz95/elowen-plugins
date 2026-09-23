import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { register } from '../plugins/cronjob/index.mjs';
import { pluginDb } from './helpers/pluginDb.mjs';
import { wireCronHost } from './helpers/cronAdapter.mjs';

const log = { info() {}, warn() {}, error() {} };
const asText = (result) => result.content[0].text;

function loadPlugin(dataRoot) {
  mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
  const tools = [];
  const platforms = [];
  const session = { identity: null, sessionId: undefined, deliveryTarget: undefined, admin: false };
  const db = pluginDb();
  // What the plugin asked the host's bell for, in order: `{ raise: input }` or `{ clear: key }`.
  const alerts = [];
  const ctx = {
    db: () => db,
    alerts: {
      raise: async (input) => { alerts.push({ raise: input }); return { recipients: 1 }; },
      clear: async (key) => { alerts.push({ clear: key }); return 0; },
    },
    logger: log,
    config: {},
    dataDir: () => join(dataRoot, 'cronjob'),
    notify: async () => {},
    timezone: () => 'Europe/Prague',
    currentIdentity: () => session.identity,
    currentSessionId: () => session.sessionId,
    // The trusted per-turn access state a schedule reads its executable project reference from. No
    // managed `projectRef` here, so these schedules stay bound to the host project.
    currentAccess: () => ({ projectIds: [], admin: session.admin, owner: false, permissionBoundary: null }),
    currentDeliveryTarget: () => session.deliveryTarget,
    isAdminSession: () => session.admin,
    host: { stores: () => ({
      usersRead: { isAdmin: () => true, mayUsePlugin: () => true, list: () => [{ id: 1 }, { id: 2 }] },
    // A recurring job names the conversation it is filed under; the directory only has to answer here.
    conversationsRead: {
      list: () => [],
      resolve: ({ sessionId }) => ({
        id: sessionId, key: `ns-${sessionId}`, title: 'Chat', ownerUserId: 1,
        platform: null, direct: false, updatedAt: '2026-07-01T00:00:00.000Z',
      }),
      resolveKey: (key) => ({
        id: key.replace(/^ns-/, ''), key, title: 'Chat', ownerUserId: 1,
        platform: null, direct: false, updatedAt: '2026-07-01T00:00:00.000Z',
      }),
    },
    }) },
    registerTool: (tool) => tools.push(tool),
    registerPlatform: (platform) => platforms.push(platform),
    registerApiRoute() {},
    registerUserRemoved() {},
    registerBootReconcile() {},
    registerControl() {},
    registerSkill() {},
  };
  register(ctx);
  return { tools, adapter: platforms[0], session, alerts };
}

async function asTurn(plugin, state, fn) {
  Object.assign(plugin.session, state);
  try { return await fn(); }
  finally { Object.assign(plugin.session, { identity: null, sessionId: undefined, deliveryTarget: undefined, admin: false }); }
}

test('cron instance scope requires the instance owner, not a foreign admin session', async (t) => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'elowen-cron-owner-'));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));
  const plugin = loadPlugin(dataRoot);
  const add = plugin.tools.find((tool) => tool.name === 'CronAdd');

  const params = { name: 'instance-check', scope: 'instance', schedule: 'daily 08:00', prompt: 'p', check: 'echo fresh', conversationSessionId: 'conv-main' };
  const jobsFile = join(dataRoot, 'cronjob/jobs.json');
  const foreignAdmin = { platform: 'discord', userId: '2', elowenUserId: 2, admin: true, owner: false, conversation: 'direct' };
  const refused = await asTurn(plugin, { identity: foreignAdmin, admin: true }, () => add.execute('t', params));
  assert.match(asText(refused), /only the instance owner/);
  assert.equal(existsSync(jobsFile), false);

  const owner = { ...foreignAdmin, userId: '1', elowenUserId: 1, owner: true };
  const accepted = await asTurn(plugin, { identity: owner, admin: true }, () => add.execute('t', params));
  assert.match(asText(accepted), /Scheduled/);
  assert.match(asText(accepted), /notification channel/);
  assert.equal(JSON.parse(readFileSync(jobsFile, 'utf8')).length, 1);
});

test('cron persists direct delivery targets and suppresses generic notify after host delivery', async (t) => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'elowen-cron-delivery-'));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));
  const plugin = loadPlugin(dataRoot);
  const add = plugin.tools.find((tool) => tool.name === 'CronAdd');
  const directOwner = { platform: 'whatsapp', userId: '4201', elowenUserId: 1, admin: true, owner: true, conversation: 'direct' };

  await asTurn(plugin, {
    identity: directOwner,
    sessionId: 'brain-ch-whatsapp-4201',
    deliveryTarget: 'destination:whatsapp:4201@s.whatsapp.net',
    admin: true,
  }, () => add.execute('t', { name: 'personal', scope: 'personal', schedule: 'every 15m', prompt: 'p', conversationSessionId: 'conv-main' }));

  const jobsFile = join(dataRoot, 'cronjob/jobs.json');
  const [captured] = JSON.parse(readFileSync(jobsFile, 'utf8'));
  assert.equal(captured.ownerUserId, 1);
  assert.equal(captured.originDeliveryTarget, 'destination:whatsapp:4201@s.whatsapp.net');

  const due = {
    ...captured,
    lastRun: new Date(Date.now() - 20 * 60_000).toISOString(),
  };
  writeFileSync(jobsFile, JSON.stringify([due]));

  const notified = [];
  plugin.adapter.deliver = async (text) => { notified.push(text); };
  let seenOrigin;
  let hostDeliveries = 0;
  let turns = 0;
  wireCronHost(plugin.adapter, async (src, _text, onEvent) => {
    turns += 1;
    seenOrigin = src.origin;
    onEvent({ type: 'session', sessionId: 'brain-ch-whatsapp-4201' });
    hostDeliveries += 1;
    onEvent({ type: 'delivery' });
    return 'delivered once';
  });
  await plugin.adapter.tick();

  assert.equal(turns, 1);
  assert.equal(hostDeliveries, 1);
  assert.deepEqual(seenOrigin, {
    sessionId: 'brain-ch-whatsapp-4201', userId: 1,
    deliveryTarget: 'destination:whatsapp:4201@s.whatsapp.net',
  });
  assert.deepEqual(notified, []);
});

// ── An owned run that fails or cannot reach its owner tells the owner on the bell ──────────────────
// Production, 2026-09-23: a one-shot wake-up fired at 03:00, the send into its origin conversation threw
// at once, and the only trace was a daemon log line. The owner had been told "It will reply in this
// conversation" and never learnt that it did not.

function ownedPlugin(t, jobs) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'elowen-cron-alert-'));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));
  mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
  writeFileSync(join(dataRoot, 'cronjob/jobs.json'), JSON.stringify(jobs));
  const plugin = loadPlugin(dataRoot);
  const notified = [];
  plugin.adapter.deliver = async (text) => { notified.push(text); };
  return { ...plugin, notified, jobsFile: join(dataRoot, 'cronjob/jobs.json') };
}

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const dueWakeup = (extra = {}) => ({
  id: 'w1', name: 'ping', schedule: 'in 30m', prompt: 'say hi', ownerUserId: 1,
  originSessionId: 'brain-1-abc', originUserId: 1,
  runAt: new Date(Date.now() - 1_000).toISOString(), createdAt: minutesAgo(30), ...extra,
});
const dueRecurring = (extra = {}) => ({
  id: 'r1', name: 'digest', schedule: 'every 15m', prompt: 'digest', ownerUserId: 1,
  createdAt: minutesAgo(60), lastRun: minutesAgo(20), ...extra,
});
/** Make every stored job due again, as the next interval slot would. */
const makeDue = (jobsFile) => {
  const jobs = JSON.parse(readFileSync(jobsFile, 'utf8'));
  writeFileSync(jobsFile, JSON.stringify(jobs.map((job) => ({ ...job, lastRun: minutesAgo(20) }))));
};

test('a failed owned wake-up raises a bell alert for its owner naming the job and the error', async (t) => {
  const plugin = ownedPlugin(t, [dueWakeup()]);
  wireCronHost(plugin.adapter, async () => { throw new Error('brain not started for user 1'); });
  await plugin.adapter.tick();

  assert.deepEqual(plugin.alerts, [{
    raise: {
      key: 'run:w1',
      scope: { user: 1 },
      severity: 'warning',
      message: { titleKey: 'runFailed.title', bodyKey: 'runFailed.body', params: { job: 'ping', error: 'brain not started for user 1' } },
      url: '/p/cronjob/settings/jobs',
    },
  }]);
  // The operator's catch-all channel still does not receive somebody else's result.
  assert.deepEqual(plugin.notified, []);
});

test('an owned result that never reached the owner conversation raises a bell alert', async (t) => {
  const plugin = ownedPlugin(t, [dueRecurring()]);
  // The turn completed, but the host never confirmed the owner's conversation as its route.
  wireCronHost(plugin.adapter, async () => 'the digest');
  await plugin.adapter.tick();

  assert.deepEqual(plugin.alerts, [{
    raise: {
      key: 'run:r1',
      scope: { user: 1 },
      severity: 'warning',
      message: { titleKey: 'runUndelivered.title', bodyKey: 'runUndelivered.body', params: { job: 'digest' } },
      url: '/p/cronjob/settings/jobs?job=r1',
    },
  }]);
  assert.deepEqual(plugin.notified, []);
});

test('a recurring failure keeps one alert key and a delivered run clears it', async (t) => {
  const plugin = ownedPlugin(t, [dueRecurring()]);
  let reply = async () => { throw new Error('provider down'); };
  wireCronHost(plugin.adapter, (src, text, onEvent) => reply(src, text, onEvent));
  // One attempt per run keeps the retry backoff out of the test.
  plugin.adapter.turnAttempts = 1;
  await plugin.adapter.tick();
  makeDue(plugin.jobsFile);
  await plugin.adapter.tick();
  // Same key every time: the host's alert store keeps ONE row per key, so a standing failure updates it
  // in place instead of ringing the owner's phone on every run.
  assert.deepEqual(plugin.alerts.map((entry) => entry.raise?.key), ['run:r1', 'run:r1']);

  reply = async (src, _text, onEvent) => { onEvent({ type: 'session', sessionId: src.origin.sessionId }); return 'all good'; };
  makeDue(plugin.jobsFile);
  await plugin.adapter.tick();
  assert.deepEqual(plugin.alerts.at(-1), { clear: 'run:r1' });
});

test('a quiet owned reply and an instance job failure raise nothing', async (t) => {
  const plugin = ownedPlugin(t, [
    dueWakeup({ originDeliveryTarget: 'destination:whatsapp:4201@s.whatsapp.net' }),
    { id: 'i1', name: 'instance', schedule: 'every 15m', prompt: 'p', createdAt: minutesAgo(60), lastRun: minutesAgo(20) },
  ]);
  plugin.adapter.turnAttempts = 1;
  // A quiet reply is never delivered to a platform chat, so no delivery confirmation arrives for it.
  wireCronHost(plugin.adapter, async (src) => {
    if (src.origin) return 'NOTHING_TO_REPORT';
    throw new Error('provider down');
  });
  await plugin.adapter.tick();

  assert.equal(plugin.alerts.some((entry) => entry.raise), false);
  assert.match(plugin.notified.join('\n'), /provider down/);
});
