import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { register } from '../plugins/voice-bot/index.mjs';
import { WINDOW_MS } from '../plugins/voice-bot/lib/store.mjs';

const TOKEN = 'super-secret-token-value';
const URL_ = 'https://voice.example/calls';

const text = (result) => result.content[0].text;

/** The fetch double RECORDS every request, so "no HTTP happened" is an assertion rather than a hope. */
function harness(t, options = {}) {
  const rawDb = openDb(':memory:');
  const pluginDb = makePluginDb(rawDb, 'voice-bot', { canMigrate: true });
  const tools = [];
  const warnings = [];
  const requests = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (options.respond) return options.respond(url, init);
    return new Response('{"status":"queued"}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    rawDb.close();
  });

  const ctx = {
    config: { apiUrl: URL_, apiToken: TOKEN, ...options.config },
    currentIdentity: () => ({ elowenUserId: 7 }),
    currentSessionId: () => 'brain-7-a',
    db: () => pluginDb,
    logger: { info() {}, warn: (message) => warnings.push(message) },
    registerTool: (tool) => tools.push(tool),
  };
  register(ctx);

  return {
    tools,
    warnings,
    requests,
    rawDb,
    rows: () => rawDb.prepare('SELECT * FROM p_voice_bot_calls ORDER BY id').all(),
    tool: () => {
      const found = tools.find((tool) => tool.name === 'VoiceCall');
      assert.ok(found, 'VoiceCall registered');
      return found;
    },
  };
}

test('a number that is not E.164 is refused before anything is dialled', async (t) => {
  const h = harness(t);
  const call = h.tool();

  // Too short, too long, no plus, a leading zero where the country code belongs, and the two shapes a
  // model actually produces: a human-formatted number and one with letters in it.
  for (const bad of ['+4207', '+4207219097011234567', '420721909701', '+0721909701', '+420 721 909 701', '+420abc909701', '']) {
    const result = await call.execute('1', { phone_number: bad, prompt: 'Confirm the meeting.' });
    assert.match(text(result), /Error:/, `refused ${JSON.stringify(bad)}`);
  }

  assert.equal(h.requests.length, 0, 'no request may leave for a malformed number');
  assert.equal(h.rows().length, 0, 'a refused call is not recorded');
});

test('a missing or blank prompt is refused before anything is dialled', async (t) => {
  const h = harness(t);
  const call = h.tool();

  for (const bad of [undefined, '', '   ', '\n\t ']) {
    const result = await call.execute('1', { phone_number: '+420721909701', prompt: bad });
    assert.match(text(result), /Error: prompt is required/);
  }

  const long = await call.execute('1', { phone_number: '+420721909701', prompt: 'x'.repeat(4001) });
  assert.match(text(long), /longer than the 4000 allowed/);

  assert.equal(h.requests.length, 0);
});

test('the request matches the documented contract exactly', async (t) => {
  const h = harness(t);
  const result = await h.tool().execute('1', {
    phone_number: '+420721909701',
    prompt: 'Confirm tomorrow at 10:00.',
    init_message: 'Good morning, calling about tomorrow.',
  });

  assert.equal(h.requests.length, 1);
  const [{ url, init }] = h.requests;
  assert.equal(url, URL_);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), {
    phone_number: '+420721909701',
    prompt: 'Confirm tomorrow at 10:00.',
    init_message: 'Good morning, calling about tomorrow.',
  });

  assert.match(text(result), /accepted by the voice service \(HTTP 200\)/);
  const [row] = h.rows();
  assert.equal(row.status, 'accepted');
  assert.equal(row.http_status, 200);
  assert.equal(row.user_id, 7);
  assert.equal(row.session_id, 'brain-7-a');
  assert.equal(row.remote_call_id, null, 'no call id is invented before the real response shape is known');
});

test('the opening sentence falls back to the default, and is absent when there is none', async (t) => {
  const h = harness(t, { config: { defaultInitMessage: 'Hello, this is the assistant.' } });
  const call = h.tool();

  await call.execute('1', { phone_number: '+420721909701', prompt: 'Ask about the invoice.', init_message: 'Explicit opening.' });
  await call.execute('2', { phone_number: '+420721909701', prompt: 'Ask about the invoice.' });
  await call.execute('3', { phone_number: '+420721909701', prompt: 'Ask about the invoice.', init_message: '   ' });

  const bodies = h.requests.map((request) => JSON.parse(request.init.body));
  assert.equal(bodies[0].init_message, 'Explicit opening.');
  assert.equal(bodies[1].init_message, 'Hello, this is the assistant.');
  assert.equal(bodies[2].init_message, 'Hello, this is the assistant.', 'a blank argument is not an opening sentence');

  const bare = harness(t, { config: { defaultInitMessage: '' } });
  await bare.tool().execute('1', { phone_number: '+420721909701', prompt: 'Ask about the invoice.' });
  const body = JSON.parse(bare.requests[0].init.body);
  assert.deepEqual(Object.keys(body).sort(), ['phone_number', 'prompt'], 'the key is absent, not present-and-empty');
});

test('the hourly limit stops a repeating agent, and releases as calls age out', async (t) => {
  const h = harness(t, { config: { maxCallsPerHour: 2 } });
  const call = h.tool();

  await call.execute('1', { phone_number: '+420721909701', prompt: 'One.' });
  await call.execute('2', { phone_number: '+420721909702', prompt: 'Two.' });
  assert.equal(h.requests.length, 2);

  const blocked = await call.execute('3', { phone_number: '+420721909703', prompt: 'Three.' });
  assert.match(text(blocked), /Call rate limit reached: 2 of 2/);
  assert.match(text(blocked), /frees up in about \d+ minute/);
  assert.equal(h.requests.length, 2, 'a refused call sends nothing');
  assert.equal(h.rows().length, 2, 'and is not recorded');

  // Age the first call past the window: one slot comes back, and only one.
  h.rawDb.prepare('UPDATE p_voice_bot_calls SET created_at = ? WHERE id = 1').run(Date.now() - WINDOW_MS - 1000);
  const allowed = await call.execute('4', { phone_number: '+420721909704', prompt: 'Four.' });
  assert.match(text(allowed), /accepted by the voice service/);
  assert.equal(h.requests.length, 3);

  const blockedAgain = await call.execute('5', { phone_number: '+420721909705', prompt: 'Five.' });
  assert.match(text(blockedAgain), /Call rate limit reached/);
  assert.equal(h.requests.length, 3);
});

test('the token never reaches the transcript or the log, not even when the service echoes it back', async (t) => {
  const h = harness(t, {
    respond: () => new Response(`{"error":"invalid token ${TOKEN}"}`, { status: 401 }),
  });

  const result = await h.tool().execute('1', { phone_number: '+420721909701', prompt: 'Ask about the invoice.' });

  assert.match(text(result), /HTTP 401/);
  assert.match(text(result), /invalid token \*\*\*/);
  assert.doesNotMatch(text(result), new RegExp(TOKEN));
  assert.doesNotMatch(h.warnings.join('\n'), new RegExp(TOKEN));
  const [row] = h.rows();
  assert.equal(row.status, 'failed');
  assert.doesNotMatch(row.response, new RegExp(TOKEN), 'nor the stored evidence');
});

test('a refusal names the status and an excerpt, and the call is recorded as failed', async (t) => {
  const h = harness(t, {
    respond: () => new Response('the number is not permitted on this account', { status: 422 }),
  });

  const result = await h.tool().execute('1', { phone_number: '+420721909701', prompt: 'Ask about the invoice.' });

  assert.match(text(result), /HTTP 422/);
  assert.match(text(result), /the number is not permitted on this account/);
  assert.match(text(result), /No call was placed/);
  assert.equal(h.rows()[0].status, 'failed');
});

test('a timeout is reported as UNKNOWN and never as a failure', async (t) => {
  const h = harness(t, {
    respond: () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); },
  });

  const result = await h.tool().execute('1', { phone_number: '+420721909701', prompt: 'Ask about the invoice.' });

  assert.match(text(result), /^UNKNOWN:/);
  assert.match(text(result), /do NOT retry automatically/);
  assert.doesNotMatch(text(result), /Error:/);
  const [row] = h.rows();
  assert.equal(row.status, 'unknown', 'the row must never claim the call failed');
  assert.equal(h.requests.length, 1, 'and it still counts against the limit');
});

test('an unreachable service is a failure, and says no call was placed', async (t) => {
  const h = harness(t, {
    respond: () => { throw new TypeError('fetch failed'); },
  });

  const result = await h.tool().execute('1', { phone_number: '+420721909701', prompt: 'Ask about the invoice.' });

  assert.match(text(result), /Could not reach the call service/);
  assert.match(text(result), /No call was placed/);
  assert.equal(h.rows()[0].status, 'failed');
});

test('without an endpoint or a token no call tool exists at all', async (t) => {
  for (const config of [{ apiUrl: '' }, { apiToken: '' }, { apiUrl: '', apiToken: '' }]) {
    const h = harness(t, { config });
    assert.deepEqual(h.tools, [], 'an absent tool is honest; one that always errors is not');
    assert.match(h.warnings.join('\n'), /not configured — VoiceCall not registered/);
  }
});

test('the manifest and the catalog agree about the plugin', () => {
  const manifest = JSON.parse(readFileSync(new URL('../plugins/voice-bot/elowen-plugin.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'voice-bot');
  assert.deepEqual(manifest.provides.tools, ['VoiceCall']);
  assert.equal(manifest.userGrantable, true, 'an admin must be able to decide who may ring a stranger');
  assert.ok(manifest.capabilities.reads.includes('db'), 'the rate-limit window needs the database');
  assert.equal(manifest.capabilities.network, true);

  const catalog = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'));
  const entry = catalog.plugins.find((plugin) => plugin.name === 'voice-bot');
  assert.ok(entry, 'listed in the marketplace catalog');
  assert.equal(entry.version, manifest.version, 'catalog version tracks the manifest');
});
