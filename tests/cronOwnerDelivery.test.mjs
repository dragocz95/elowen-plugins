import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { register } from '../plugins/cronjob/index.mjs';

const log = { info() {}, warn() {}, error() {} };
const asText = (result) => result.content[0].text;

function loadPlugin(dataRoot) {
  mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
  const tools = [];
  const platforms = [];
  const session = { identity: null, sessionId: undefined, deliveryTarget: undefined, admin: false };
  const ctx = {
    logger: log,
    config: {},
    dataDir: () => join(dataRoot, 'cronjob'),
    notify: async () => {},
    timezone: () => 'Europe/Prague',
    currentIdentity: () => session.identity,
    currentSessionId: () => session.sessionId,
    currentDeliveryTarget: () => session.deliveryTarget,
    isAdminSession: () => session.admin,
    host: { stores: () => ({ usersRead: { isAdmin: () => true, mayUsePlugin: () => true, list: () => [{ id: 1 }, { id: 2 }] } }) },
    registerTool: (tool) => tools.push(tool),
    registerPlatform: (platform) => platforms.push(platform),
    registerApiRoute() {},
    registerUserRemoved() {},
    registerBootReconcile() {},
    registerControl() {},
    registerSkill() {},
  };
  register(ctx);
  return { tools, adapter: platforms[0], session };
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

  const params = { name: 'instance-check', scope: 'instance', schedule: 'daily 08:00', prompt: 'p', check: 'echo fresh' };
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
  }, () => add.execute('t', { name: 'personal', scope: 'personal', schedule: 'every 15m', prompt: 'p' }));

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
  plugin.adapter.listen(async (src, _text, onEvent) => {
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
