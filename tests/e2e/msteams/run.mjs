#!/usr/bin/env node
// Teams chat-adapter E2E scenario against a REAL built daemon + the REAL msteams plugin.
//
// Wiring under test (the shared shared elowen-plugin-shared cores over the Bot Framework surface — an inbound
// signed webhook + outbound Connector REST, distinct from Discord's gateway and Telegram's long-poll):
//   fake Bot Framework ──signed activity POST /hooks/msteams/messages──▶ real msteams plugin (JWT
//   verified against the fake's JWKS via the `openIdMetadataUrl` seam) ──▶ PlatformOrchestrator ──▶
//   real brain channel session ──▶ scripted OpenAI model server ──▶ the bot's Connector replies /
//   live-trace PUT edits, captured on the fake (its base = the activities' `serviceUrl`).
//
// Boots via the shared harness (the PUBLISHED elowen daemon on a throwaway port + temp DB/HOME + injected
// provider). The msteams plugin is configured over PUT /config (credentials + both fake seams + an
// admin rolePolicy) and switched on over PATCH /plugins/msteams, which persists the change and asks for a
// daemon restart — driven here by the harness, since a plugin set is only loaded by a fresh process.
//
// Scenarios:
//   1. A signed message activity is accepted (200 under Microsoft's 15s callback deadline), round-trips
//      to the brain, and the reply arrives ASYNC through the Connector as a THREADED reply — with a live
//      tool trace edited in place (PUT) along the way, Teams' equivalent of Discord's edit stream.
//   2. /stats through the shared runControlCommand core → the live model + context line.
//   3. TEETH: an activity with a garbage JWT bounces at the webhook (401) and never reaches the brain.
//   4. TEETH: a provider failure surfaces as the bot's "⚠️ …" reply.
//   5. A `ShareFile` turn reaches the shared live-message engine's FILE transport and arrives in a 1:1
//      chat as a `file.consent` card, with the answer text still posted underneath it.
//   6. The same ShareFile turn in a TEAM CHANNEL offers nothing (consent is a 1:1 protocol) while the
//      answer still lands — today's behaviour, kept.
// Every wait is deadline-bounded on the fake's captured calls — no sleep-based flakiness.
//
// SAFETY: throwaway ports (harness auto-selects; the fake binds an ephemeral loopback port), temp dirs
// under os.tmpdir(), full teardown in finally. Never touches the prod DB/config/ports/services.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startModelServer } from '../harness/model-server.mjs';
import { spawnRealDaemon } from '../harness/spawn-daemon.mjs';
import { settlePluginChange } from '../harness/plugin-change.mjs';
import { installRegistryPlugin } from '../harness/install-plugin.mjs';
import { linkPlatformAccount } from '../harness/link-account.mjs';
import { startFakeBotFramework } from './fake-botframework.mjs';

const CONV_ID = 'a:e2e-conv-1';
// The ShareFile scenarios run in conversations of their OWN, and that is not cosmetic: the scripted model
// calls its tool only on a request whose transcript carries no `tool` message yet, and the conversation
// above has one by then. A fresh conversation is also what a real person's first file request looks like.
const FILE_CONV_ID = 'a:e2e-file-1';
const CHANNEL_ID = '19:e2e-file-channel@thread.tacv2';
// A real Entra object id: the host only accepts a GUID (or a `29:…` Teams id) as an account link, and the
// rolePolicy that admits this sender is keyed on the same value.
const AAD_ID = 'e2e0aad1-0000-4000-8000-00000000e2e1';
const REPLY_MARKER = 'E2E-MSTEAMS-REPLY';
const FIRST_TEXT = 'Checking the missions. ';
const FINAL_TEXT = `${REPLY_MARKER}: hello from the Elowen brain.`;
const BOT_ID = '28:e2e-app-id';
const FILE_MARKER = 'E2E-MSTEAMS-FILE';
const FILE_NAME = 'e2e-report.txt';
const CONSENT_CARD = 'application/vnd.microsoft.teams.card.file.consent';

let idSeq = 0;
const nextId = () => `in-${Date.now()}-${(idSeq += 1)}`;

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function put(baseUrl, path, token, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function patch(baseUrl, path, token, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

/** A personal-chat message activity from our admin sender, in ONE conversation (default: the first one). */
function messageActivity(text, conversationId = CONV_ID) {
  return {
    type: 'message',
    id: nextId(),
    from: { id: '29:e2e-user', aadObjectId: AAD_ID, name: 'E2E Tester' },
    recipient: { id: '28:e2e-app-id', name: 'Elowen' },
    conversation: { id: conversationId, conversationType: 'personal', tenantId: 'e2e-tenant' },
    text,
  };
}

/** A team-channel message activity that @mentions the bot — which is what admits it there. */
function channelActivity(text) {
  return {
    type: 'message',
    id: nextId(),
    from: { id: '29:e2e-user', aadObjectId: AAD_ID, name: 'E2E Tester' },
    recipient: { id: BOT_ID, name: 'Elowen' },
    conversation: { id: CHANNEL_ID, conversationType: 'channel', tenantId: 'e2e-tenant', name: 'E2E Team' },
    entities: [{ type: 'mention', mentioned: { id: BOT_ID, name: 'Elowen' }, text: '<at>Elowen</at>' }],
    text: `<at>Elowen</at> ${text}`,
  };
}

/** The conversation a captured connector call was addressed to (ids travel url-encoded in the path). */
const conversationOf = (call) => decodeURIComponent(String(call.path).split('/')[3] ?? '');

/** Free-standing sends in ONE conversation carrying an attachment of this content type. */
const cardsIn = (fake, conversationId, contentType) => fake.sends()
  .filter((c) => conversationOf(c) === conversationId)
  .flatMap((c) => (Array.isArray(c.body?.attachments) ? c.body.attachments : []))
  .filter((a) => a?.contentType === contentType);

/** Inject a message and wait until the bot posts a reply whose text satisfies `pred`. */
async function expectReplyTo(fake, daemonBase, message, pred, label, timeoutMs = 45_000) {
  const before = fake.replies().length;
  const status = await fake.injectActivity(daemonBase, message);
  assert(status === 200, `${label}: webhook accepted the signed activity (got ${status})`);
  await fake.waitForCall(
    () => fake.replies().slice(before).some((c) => pred(String(c.body?.text ?? ''))),
    timeoutMs,
    `${label} (replies so far: ${JSON.stringify(fake.replies().map((c) => c.body?.text))})`,
  );
  return fake.replies().slice(before).find((c) => pred(String(c.body?.text ?? ''))).body;
}

/** The same, from a personal-chat activity. */
const expectReply = (fake, daemonBase, text, pred, label, timeoutMs) =>
  expectReplyTo(fake, daemonBase, messageActivity(text), pred, label, timeoutMs);

async function main() {
  // The scripted tool name is deliberately UNKNOWN to the daemon: the unknown-tool error result is the
  // one deterministic way a channel turn edits its trace bubble in place (the "needs attention" row).
  // The old default (ElowenListMissions) only produced that edit by accident — the tool was absent from
  // channel sessions pre-extraction; the agents plugin now composes it everywhere and refuses with a
  // clean text result, whose hidden output re-renders the row identically (no PUT to observe).
  const model = await startModelServer({ toolName: 'E2eProbeMissingTool', firstText: FIRST_TEXT, finalText: FINAL_TEXT });
  const fake = await startFakeBotFramework({ aadObjectId: AAD_ID });
  let daemon = null;
  try {
    // The host is the published elowen package, which does not bundle this plugin — the scenario
    // installs it the way the marketplace would, before the daemon's first boot.
    daemon = await spawnRealDaemon({
      providerBaseUrl: model.baseUrl,
      prepareDataDir: (dataDir) => installRegistryPlugin(dataDir, 'msteams'),
    });
    const { baseUrl } = daemon;
    let token = daemon.token;
    console.log(`daemon up on ${baseUrl}; model on ${model.baseUrl}; fake Bot Framework ${fake.base}`);

    // 1) Configure the msteams plugin: credentials (required), both fake seams, an admin rolePolicy for
    //    our sender's Entra object id. PUT /config stores the plugin-config slice; no reload on its own.
    const cfg = await put(baseUrl, '/config', token, {
      plugins: {
        config: {
          msteams: {
            appId: fake.appId,
            appPassword: 'e2e-secret',
            tenantId: 'e2e-tenant',
            oauthTokenUrl: fake.tokenUrl,
            openIdMetadataUrl: fake.metadataUrl,
            language: 'en',
            rolePolicies: [{ roleId: AAD_ID, name: 'Operator', admin: true, projectIds: [] }],
          },
        },
      },
    });
    assert(cfg.status === 200, `PUT /config → 200 (got ${cfg.status}: ${cfg.text})`);

    // 1b) Link the Teams sender to the bootstrapped admin account. The rolePolicy above only ADMITS them
    //     and marks the room trusted; permissions come exclusively from a linked Elowen account, and the
    //     host silently drops a human platform turn that has none — so without this the bot stays mute.
    await linkPlatformAccount(baseUrl, token, { msteamsUserId: AAD_ID });

    // 2) Enable the plugin. A plugin-SET change no longer hot-reloads the registry: on this core the write
    //    is durable and the daemon answers 202 `pending` because it means to restart itself, and a restart
    //    is what loads the new registry from disk (dist/api/routes/plugins/index.js:236-250). Under a real
    //    deployment a supervisor brings it back; this harness is the supervisor, so it drives the restart
    //    itself over the same port and data dir — which is also why the token below has to be refreshed.
    const enable = await patch(baseUrl, '/plugins/msteams', token, { enabled: true, acknowledgeGrants: ['users'] });
    token = await settlePluginChange(daemon, enable, token, 'PATCH /plugins/msteams {enabled:true}');
    // The adapter validates the credentials eagerly as it comes up, against the fake token endpoint.
    await fake.waitForCall((calls) => calls.some((c) => c.path === '/oauth/token'), 20_000, 'eager credential check (POST /oauth/token)');
    console.log('PASS wiring: msteams plugin enabled and authenticated against the fake token endpoint.');

    // ── Scenario 1: signed activity → async threaded reply, with the live trace edited in place ──────
    const reply = await expectReply(fake, baseUrl, 'Hi Elowen, are you there?', (t) => t.includes(REPLY_MARKER), 'brain reply round-trip');
    assert(reply.text.includes(FINAL_TEXT), `reply carries the model's final text; got "${reply.text}"`);
    assert(reply.textFormat === 'markdown', `reply is markdown-formatted (got ${reply.textFormat})`);
    assert(model.requests.length >= 1, `model server served the turn (>=1 request), got ${model.requests.length}`);
    // The model called a tool → the default status trace posted a progress bubble and edited it (PUT).
    assert(fake.updates().length >= 1, `the live trace edited a message in place (PUT); got ${fake.updates().length} updates`);
    console.log('PASS scenario 1: signed activity accepted fast, reply delivered async via the Connector, trace edited live.');

    // ── Scenario 2: /stats through the shared control core (a live session now exists) ───────────────
    // The daemon renamed this command from /status to /stats so one name covers every surface, and it
    // published no alias. An adapter routes only what the catalog publishes, so the old name now falls
    // through to the brain as ordinary text - which is what this suite was really asserting for a while.
    const statusReply = await expectReply(fake, baseUrl, '/stats', (t) => t.includes('mock-model') && /Context/.test(t), '/stats reply');
    assert(/🧠 .*mock-model/.test(statusReply.text) && /📊 Context \d/.test(statusReply.text),
      `/stats carries the model + context lines; got "${statusReply.text}"`);
    console.log('PASS scenario 2: /stats via runControlCommand returned the live model + context line.');

    // ── Scenario 3: TEETH — a garbage JWT bounces at the webhook and never reaches the brain ─────────
    const turnsBefore = model.requests.length;
    const badStatus = await fake.injectActivity(baseUrl, messageActivity('forged message'), { badToken: true });
    assert(badStatus === 401, `forged token → 401 at the webhook (got ${badStatus})`);
    assert(model.requests.length === turnsBefore, 'the forged activity never started a brain turn');
    console.log('PASS teeth: an unsigned activity was rejected at the webhook with 401.');

    // ── Scenario 4: TEETH — a provider failure surfaces as the bot's error reply ─────────────────────
    model.setFail(true);
    const errReply = await expectReply(fake, baseUrl, 'This turn must fail.', (t) => t.startsWith('⚠️'), 'error reply on provider failure');
    assert(errReply.text.startsWith('⚠️'), `error reply starts with the warning glyph; got "${errReply.text}"`);
    console.log('PASS teeth: an injected provider error surfaced as the bot\'s "⚠️ …" reply.');
    model.setFail(false);

    // ── Scenarios 5-6: ShareFile through the shared engine's file transport ─────────────────────────
    // Core's `ShareFile` emits a `file` brain event carrying a stored `/brain/chat-files/<sha>.bin` ref,
    // which is dead text on every chat surface. The engine hands those refs to the transport's
    // hasFiles/postFiles pair; Teams can only take a general file through its file consent handshake, so
    // "delivered" here means the consent card — the same card `TeamsSendFile` already drives in
    // production. A SECOND model server scripts that one tool call, and the config is pointed at it.
    const reportPath = join(daemon.dataDir, FILE_NAME);
    writeFileSync(reportPath, 'E2E REPORT BYTES\n');
    const fileModel = await startModelServer({
      toolName: 'ShareFile',
      toolArgs: JSON.stringify({ path: reportPath, caption: 'the quarterly report' }),
      firstText: 'Packaging the report. ',
      finalText: `${FILE_MARKER}: the report is on its way.`,
    });
    try {
      const swapped = await put(baseUrl, '/config', token, {
        brain: { providers: [{ id: daemon.providerId, label: 'E2E Model', type: 'openai', baseUrl: fileModel.baseUrl, models: [daemon.model], apiKey: 'e2e-test-key' }] },
      });
      assert(swapped.status === 200, `PUT /config (ShareFile model) → 200 (got ${swapped.status}: ${swapped.text})`);
      // A brain builds its provider clients when it starts, so a provider this process never had is only
      // picked up by a fresh start. Same port, same data dir — the session, the account link and the
      // plugin state all survive; only the token is new.
      token = await daemon.restart();

      // 5) A 1:1 chat: the offer card goes out, and the answer text still lands underneath it.
      const fileReply = await expectReplyTo(fake, baseUrl, messageActivity('Please share the report.', FILE_CONV_ID), (t) => t.includes(FILE_MARKER), 'ShareFile reply');
      // What the turn actually did, in the assertion itself: a refusal from core's ShareFile is a tool
      // RESULT, so it shows up nowhere else — the reply text looks identical either way.
      const toolResults = (fileModel.requests.at(-1)?.body?.messages ?? [])
        .filter((m) => m.role === 'tool')
        .map((m) => String(m.content));
      const why = `${JSON.stringify(fileReply.text)} | tool results: ${JSON.stringify(toolResults)} | daemon log tail:\n${daemon.logText().split('\n').slice(-12).join('\n')}`;
      assert(fileModel.requests.length >= 1, `the ShareFile model served the turn (>=1 request), got ${fileModel.requests.length}`);
      const personal = cardsIn(fake, FILE_CONV_ID, CONSENT_CARD);
      assert(personal.length === 1, `exactly one file consent card in the 1:1 chat; got ${personal.length} | ${why}`);
      assert(personal[0]?.name === FILE_NAME, `the offer carries the file's own name; got ${JSON.stringify(personal[0]?.name)}`);
      assert(personal[0]?.content?.sizeInBytes === 17, `the offer states the byte count; got ${JSON.stringify(personal[0]?.content?.sizeInBytes)}`);
      assert(fileReply.text.includes(FILE_MARKER), `the answer text still lands; got "${fileReply.text}"`);
      console.log('PASS scenario 5: ShareFile reached the 1:1 chat as a file consent card, with the answer underneath it.');

      // 6) A team channel: consent is a 1:1 protocol, so nothing is offered and the answer is unaffected.
      const channelReply = await expectReplyTo(fake, baseUrl, channelActivity('Please share the report.'), (t) => t.includes(FILE_MARKER), 'ShareFile channel reply');
      assert(channelReply.text.includes(FILE_MARKER), `the channel answer still lands; got "${channelReply.text}"`);
      // The file event really fired in the channel too — core's ShareFile answered that it shared the
      // document. Otherwise "no card" would pass for the wrong reason: an absent file, not a refused one.
      const channelToolResults = (fileModel.requests.at(-1)?.body?.messages ?? [])
        .filter((m) => m.role === 'tool')
        .map((m) => String(m.content));
      assert(channelToolResults.some((t) => t.includes(`Shared ${FILE_NAME}`)),
        `the channel turn did share the file, so the quiet is the scope decision; tool results: ${JSON.stringify(channelToolResults)}`);
      assert(cardsIn(fake, CHANNEL_ID, CONSENT_CARD).length === 0, 'a channel is offered no file consent card');
      assert(cardsIn(fake, CHANNEL_ID, 'application/vnd.microsoft.teams.card.file.info').length === 0, 'a channel receives no file card');
      console.log('PASS scenario 6: a team channel offered nothing and still answered — consent stays a 1:1 protocol.');
    } finally {
      await fileModel.close();
    }
  } finally {
    if (daemon) await daemon.stop();
    await fake.close();
    await model.close();
  }
}

main().then(() => {
  console.log('PASS test:e2e:msteams — real daemon + real msteams plugin + fake Bot Framework verified.');
  process.exit(0);
}).catch((err) => {
  console.error(`FAIL test:e2e:msteams — ${err instanceof Error ? err.stack || err.message : String(err)}`);
  process.exit(1);
});
