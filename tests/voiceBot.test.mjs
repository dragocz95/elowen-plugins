import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { register } from '../plugins/voice-bot/index.mjs';
import { WINDOW_MS } from '../plugins/voice-bot/lib/store.mjs';
import {
  DEFAULT_CALL_TIMEOUT_S, MAX_CALL_TIMEOUT_S, MIN_CALL_TIMEOUT_S, resolveCallTimeoutMs,
} from '../plugins/voice-bot/lib/tool.mjs';

const TOKEN = 'super-secret-token-value';
const URL_ = 'https://voice.example/calls';

const text = (result) => result.content[0].text;

/** The shape the service ACTUALLY returned when this was probed with one live call, not a shape anybody
 *  guessed. The important property is that a successful POST does not merely acknowledge the request: it
 *  blocks for the entire call and comes back with the finished verdict and a transcript. Every
 *  expectation below is anchored on that, because it is what removed the need for any polling. */
const CALL_SID = 'CA1abe44d637ed02a5f87d036f14eb5607';
const ANSWERED = {
  call_sid: CALL_SID,
  status: 'completed',
  result: 'completed',
  provider_status: 'completed',
  answered: true,
  phone_number: '+420735040714',
  transcript: 'Assistant: Dobrý den.\nUser: Ano, slyším.\nAssistant: Děkuji, hezký den.',
  timed_out: false,
  elapsed_seconds: 41.649446,
  started_at: '2026-08-27T12:09:28.696770Z',
  ended_at: '2026-08-27T12:10:10.346216Z',
};

const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

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
    return jsonResponse(ANSWERED);
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

  assert.match(text(result), /was answered and has ended/);
  const [row] = h.rows();
  assert.equal(row.status, 'completed');
  assert.equal(row.http_status, 200);
  assert.equal(row.user_id, 7);
  assert.equal(row.session_id, 'brain-7-a');
  assert.equal(row.remote_call_id, CALL_SID, 'the service call id is kept, so a call can be identified later');
});

test('a finished call comes back with its verdict and its transcript', async (t) => {
  const h = harness(t);
  const result = await h.tool().execute('1', { phone_number: '+420721909701', prompt: 'Confirm tomorrow.' });

  // The whole reason there is no polling worker: the outcome is already here.
  const answer = text(result);
  assert.match(answer, /was answered and has ended/);
  assert.match(answer, /lasted 42 seconds/);
  assert.match(answer, /Service status: completed/);
  assert.match(answer, /Transcript:/);
  assert.match(answer, /User: Ano, slyším\./, 'what was actually said reaches the agent');
  assert.match(answer, new RegExp(CALL_SID));
  assert.ok(h.rows()[0].response.includes('Ano, slyším'), 'and is kept as the audit record');
});

test('the call deadline is configurable, and nonsense falls back instead of cutting calls short', () => {
  // The request is held open for the WHOLE conversation: a measured three-exchange call took 41.6 s.
  // A deadline in the tens of seconds would abort calls that were going perfectly well and report them
  // as UNKNOWN, which is the one outcome the agent is told never to retry — so the call would be lost.
  // These are floors, not pins: raise them freely, never drop back to acknowledgement scale.
  assert.ok(DEFAULT_CALL_TIMEOUT_S >= 120, `default is ${DEFAULT_CALL_TIMEOUT_S}s, too short to sit through a real call`);
  assert.ok(MIN_CALL_TIMEOUT_S > 45, 'even the floor must outlast the call that was actually measured');

  assert.equal(resolveCallTimeoutMs(600), 600_000, 'a configured value is honoured');
  assert.equal(resolveCallTimeoutMs('600'), 600_000, 'config values arrive as text from the settings form');
  assert.equal(resolveCallTimeoutMs(5), MIN_CALL_TIMEOUT_S * 1000, 'clamped up');
  assert.equal(resolveCallTimeoutMs(99_999), MAX_CALL_TIMEOUT_S * 1000, 'clamped down');
  for (const junk of [undefined, null, '', 'soon', 0, -30, NaN]) {
    assert.equal(resolveCallTimeoutMs(junk), DEFAULT_CALL_TIMEOUT_S * 1000, `falls back for ${JSON.stringify(junk)}`);
  }
});

test('the configured deadline is the one the request actually gets', async (t) => {
  // Proving the setting reaches the request path, not merely that it resolves: the timeout report names
  // the deadline it gave up after, so a configured 90 seconds has to show up as 90.
  const h = harness(t, {
    config: { callTimeoutSeconds: 90 },
    respond: () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); },
  });

  const result = await h.tool().execute('1', { phone_number: '+420721909701', prompt: 'Ask about the invoice.' });
  assert.match(text(result), /did not answer within 90 seconds/);
});

test('a call nobody picked up is reported as exactly that, not as a success', async (t) => {
  const h = harness(t, {
    respond: () => jsonResponse({ ...ANSWERED, answered: false, status: 'no-answer', result: 'no-answer', transcript: '', timed_out: true }),
  });

  const answer = text(await h.tool().execute('1', { phone_number: '+420721909701', prompt: 'Confirm tomorrow.' }));
  assert.match(answer, /was placed, but it was not answered/);
  assert.match(answer, /Service status: no-answer/);
  assert.match(answer, /ended it on its own time limit/);
  assert.doesNotMatch(answer, /Transcript:/, 'there is nothing to quote');
  assert.equal(h.rows()[0].status, 'completed', 'the REQUEST completed; whether a human answered is the service verdict');
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
  assert.match(text(allowed), /was answered and has ended/);
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

  // Every setting the code reads has to be a field an operator can actually see and change. A rename on
  // one side alone fails SILENTLY — the code reads undefined and quietly falls back to its default, so
  // the form still looks right while the value it offers does nothing.
  const declared = new Set(manifest.configSchema.map((field) => field.key));
  const source = readFileSync(new URL('../plugins/voice-bot/lib/tool.mjs', import.meta.url), 'utf8');
  const used = [...source.matchAll(/ctx\.config\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  assert.ok(used.length >= 4, `expected the tool to read its settings, found ${used.length}`);
  assert.deepEqual(used.filter((key) => !declared.has(key)), [], 'settings read by the code but absent from the form');

  const catalog = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'));
  const entry = catalog.plugins.find((plugin) => plugin.name === 'voice-bot');
  assert.ok(entry, 'listed in the marketplace catalog');
  assert.equal(entry.version, manifest.version, 'catalog version tracks the manifest');
});
