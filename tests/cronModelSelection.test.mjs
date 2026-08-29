// A job pinned to a model must RUN on that model.
//
// Core resolves the PROVIDER before the model id, and model ids are not globally unique, so a selection
// naming only one half is silently completed upstream: the run lands on the provider's default model, or
// on the first configured provider's credentials, and then truthfully reports the substitute it used.
// Nothing about that looks broken from the outside — the job still says Opus while every run says
// something else. So both ends of the pair are pinned here: what the write boundary accepts, and what the
// scheduler hands the host.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { register } from '../plugins/cronjob/index.mjs';

const log = { info() {}, warn() {}, error() {} };
const asText = (result) => result.content[0].text;
const OWNER = { platform: 'elowen', userId: '1', elowenUserId: 1, admin: true, owner: true, conversation: 'own' };

function loadPlugin(dataRoot) {
  mkdirSync(join(dataRoot, 'cronjob'), { recursive: true });
  const tools = [];
  const platforms = [];
  const session = { identity: null, sessionId: undefined, deliveryTarget: undefined, admin: false };
  register({
    logger: log,
    config: {},
    dataDir: () => join(dataRoot, 'cronjob'),
    notify: async () => {},
    timezone: () => 'Europe/Prague',
    currentIdentity: () => session.identity,
    currentSessionId: () => session.sessionId,
    currentDeliveryTarget: () => session.deliveryTarget,
    isAdminSession: () => session.admin,
    host: { stores: () => ({ usersRead: { isAdmin: () => true, mayUsePlugin: () => true, list: () => [{ id: 1 }] } }) },
    registerTool: (tool) => tools.push(tool),
    registerPlatform: (platform) => platforms.push(platform),
    registerApiRoute() {},
    registerUserRemoved() {},
    registerBootReconcile() {},
    registerControl() {},
    registerSkill() {},
  });
  return { tools, adapter: platforms[0], session };
}

async function asOwner(plugin, fn) {
  Object.assign(plugin.session, { identity: OWNER, sessionId: undefined, admin: true });
  try { return await fn(); }
  finally { Object.assign(plugin.session, { identity: null, sessionId: undefined, admin: false }); }
}

const jobsFile = (dataRoot) => join(dataRoot, 'cronjob/jobs.json');
const onDisk = (dataRoot) => (existsSync(jobsFile(dataRoot)) ? JSON.parse(readFileSync(jobsFile(dataRoot), 'utf8')) : []);
const writeJobs = (dataRoot, jobs) => writeFileSync(jobsFile(dataRoot), JSON.stringify(jobs));

/** A recurring job that is due right now. */
const dueJob = (extra = {}) => ({
  id: 'r1', name: 'report', schedule: 'every 15m', prompt: 'do it',
  lastRun: new Date(Date.now() - 20 * 60_000).toISOString(), createdAt: new Date().toISOString(), ...extra,
});

/** Run the due jobs once and report what the host was actually asked to run. */
async function tickOnce(plugin) {
  let seen;
  let turns = 0;
  plugin.adapter.listen(async (src) => { seen = src; turns += 1; return 'ran'; });
  await plugin.adapter.tick();
  return { seen, turns };
}

function freshRoot(t) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'elowen-cron-model-'));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));
  return dataRoot;
}

test('cron forwards a job\'s exact provider/model pair, and nothing when it names no model', async (t) => {
  const dataRoot = freshRoot(t);
  const plugin = loadPlugin(dataRoot);

  writeJobs(dataRoot, [dueJob({ model: { provider: 'anthropic', model: 'claude-opus-5' } })]);
  const pinned = await tickOnce(plugin);
  assert.equal(pinned.turns, 1);
  assert.deepEqual(pinned.seen.access.model, { provider: 'anthropic', model: 'claude-opus-5' });

  // No selection is a real answer — "no preference" — and still resolves to the server default.
  writeJobs(dataRoot, [dueJob()]);
  const plain = await tickOnce(plugin);
  assert.equal(plain.turns, 1);
  assert.equal(plain.seen.access.model, undefined);
});

// THE production bug. A half-written selection used to be dropped on the way out, so the job ran anyway —
// on whatever core resolved the missing half to — and only the run's footer showed it. Skipping costs one
// slot and is recoverable; running costs a real turn on a model nobody chose.
test('cron skips a job whose stored selection names half a pair instead of running it on the default', async (t) => {
  for (const model of [{ provider: 'anthropic' }, { model: 'claude-opus-5' }, { provider: 'anthropic', model: '' }]) {
    const dataRoot = freshRoot(t);
    const plugin = loadPlugin(dataRoot);
    writeJobs(dataRoot, [dueJob({ model })]);

    const { turns } = await tickOnce(plugin);
    assert.equal(turns, 0, `ran anyway on ${JSON.stringify(model)}`);
    const [stored] = onDisk(dataRoot);
    // Skipped, never deleted: the schedule survives so completing the model runs it on the next slot.
    assert.equal(stored.id, 'r1');
    assert.match(stored.lastResult, /incomplete model/);
  }
});

test('cron runs the skipped job once its selection is completed', async (t) => {
  const dataRoot = freshRoot(t);
  const plugin = loadPlugin(dataRoot);
  writeJobs(dataRoot, [dueJob({ model: { provider: 'anthropic' } })]);
  assert.equal((await tickOnce(plugin)).turns, 0);

  writeJobs(dataRoot, [dueJob({ model: { provider: 'anthropic', model: 'claude-opus-5' } })]);
  const { seen, turns } = await tickOnce(plugin);
  assert.equal(turns, 1);
  assert.deepEqual(seen.access.model, { provider: 'anthropic', model: 'claude-opus-5' });
});

test('CronAdd refuses a model that does not name both halves, and stores one that does', async (t) => {
  const dataRoot = freshRoot(t);
  const plugin = loadPlugin(dataRoot);
  const add = plugin.tools.find((tool) => tool.name === 'CronAdd');
  const call = (model) => add.execute('t', {
    name: 'digest', scope: 'instance', schedule: 'daily 07:30', prompt: 'p',
    ...(model !== undefined ? { model } : {}),
  });

  await asOwner(plugin, async () => {
    // A bare model id is what a caller reaches for first, and it used to be dropped in silence: "Scheduled"
    // came back and every run went to the server default instead.
    for (const bad of ['claude-opus-5', '/claude-opus-5', 'anthropic/']) {
      assert.match(asText(await call(bad)), /must name a provider AND a model/, `accepted ${JSON.stringify(bad)}`);
    }
    assert.deepEqual(onDisk(dataRoot), []); // nothing was scheduled behind a refused selection

    assert.match(asText(await call('anthropic/claude-opus-5')), /Scheduled/);
    assert.deepEqual(onDisk(dataRoot)[0].model, { provider: 'anthropic', model: 'claude-opus-5' });

    // An absent or blank value is not a partial — it is "no preference", and stays the server default.
    assert.match(asText(await call()), /Scheduled/);
    assert.equal(onDisk(dataRoot)[1].model, undefined);
    assert.match(asText(await call('  ')), /Scheduled/);
    assert.equal(onDisk(dataRoot)[2].model, undefined);
  });
});

test('CronList names the pinned model so a run\'s reported model can be checked against it', async (t) => {
  const dataRoot = freshRoot(t);
  const plugin = loadPlugin(dataRoot);
  const list = plugin.tools.find((tool) => tool.name === 'CronList');
  writeJobs(dataRoot, [
    dueJob({ model: { provider: 'anthropic', model: 'claude-opus-5' } }),
    dueJob({ id: 'r2', name: 'plain' }),
  ]);

  const listed = await asOwner(plugin, async () => asText(await list.execute('t', {})));
  assert.match(listed, /model: anthropic\/claude-opus-5/);
  assert.doesNotMatch(listed.split('"plain"')[1], /model:/); // a job with no pick claims none
});
