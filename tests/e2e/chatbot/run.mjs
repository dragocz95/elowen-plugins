#!/usr/bin/env node
// The chatbot widget AND the server half of page actions, in a real browser, on a page that belongs to
// somebody else.
//
// There is still no daemon here, and there does not need to be one: every piece of this plugin that decides
// anything is a value in, a value out. So this scenario runs the plugin's OWN code in this process — the
// real public route, the real store over a throwaway in-memory database, the real turn queue, the real
// page-action service, and the real tool the model calls — and fakes only the three things a plugin cannot
// decide for itself:
//
//   * the CUSTOMER'S SITE, a second origin, serving form.html — a heading, a form with a text, e-mail,
//     select, password and card-like field, a submit button, and enough copy below to make the page scroll;
//   * the MODEL, a scripted relay: what a real turn would ask the page to do, in the order it would ask;
//   * the HOST's account and Project facts, and core's request origin.
//
// Everything else is real: a real Chrome, real shadow DOM, real clicks and keyboard events, real
// cross-origin requests, a real form submission, real SQLite rows, and the plugin's real decisions.
//
// What the scenario asserts:
//
//   1. page load only reads the chatbot's look through bootstrap, without sending page data or creating a
//      visitor/token/turn; an explicit snapshot action returns page structure;
//   2. the answer streams into the panel as it arrives and ends with the whole of it;
//   3. a stream cut mid-answer is resumed from the last frame the visitor saw, with no doubled text;
//   4. read, fill, select, click and scroll all reach the page, each approved by the tool first;
//   5. a click on the submit button is REFUSED BY THE SERVER and cannot be performed; a frame the server
//      would never send is refused by the widget in the browser; and the form goes out only after a real
//      pointer click on the panel's confirm button — including a synthetic click on that very button, which
//      must decide nothing, and a decline, which must answer the waiting tool with a cancellation;
//   6. an action asked while the widget was disconnected is picked up from the turn's own log once it
//      reconnects, and answered;
//   7. a reload restores the transcript from the visitor's own conversation, with the page state stripped;
//   8. no console error, and no request anywhere except the customer's origin and the hook's;
//   9. the look an administrator saves reaches the panel: a page whose panel nobody opened sends nothing, and
//      once it IS opened the panel paints the saved colour, corners, size, corner of the page, greeting and
//      quick buttons at both a phone and a desktop width — and a press on a quick button is sent as the
//      visitor's own message;
//  10. an appearance its own row can no longer produce is refused, and the widget keeps its own panel.
//
// Run with: node tests/e2e/chatbot/run.mjs  (npm run test:e2e:chatbot)
// Throwaway servers only: ephemeral loopback ports, an in-memory database, no production service or port.
//
// The plugin is loaded from `dist/`, not from `src/`: the daemon loads the built artifact, so this is what an
// installed instance actually serves, and `npm run check:dist` is what keeps it matching its source.

import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { ChatbotAdapter } from '../../../plugins/chatbot/dist/adapter.js';
import { selectAppearanceTemplate } from '../../../plugins/chatbot/dist/appearanceContract.js';
import { PUBLIC_SCHEMA_VERSION } from '../../../plugins/chatbot/dist/publicContract.js';
import { PageActionService } from '../../../plugins/chatbot/dist/actionService.js';
import { createAdminApi } from '../../../plugins/chatbot/dist/adminApi.js';
import { registerPageActionTool } from '../../../plugins/chatbot/dist/actionsTool.js';
import { TurnEventBroker } from '../../../plugins/chatbot/dist/broker.js';
import { migrate } from '../../../plugins/chatbot/dist/db.js';
import { readRecordedPageState } from '../../../plugins/chatbot/dist/pageState.js';
import { createPublicRoute } from '../../../plugins/chatbot/dist/publicRoutes.js';
import { ChatbotTurnQueue } from '../../../plugins/chatbot/dist/queue.js';
import { ChatbotStore } from '../../../plugins/chatbot/dist/store.js';
import { hashToken } from '../../../plugins/chatbot/dist/token.js';

const CHROME = process.env.E2E_BROWSER_PATH ?? '/usr/bin/google-chrome';
const PUBLIC_ID = 'cbt_0123456789abcdef01234567';
const CHATBOT_ACCOUNT = 12;
const PROJECT_ID = 4;
const WIDGET_PATH = '/hooks/chatbot/v2/widget.js';
const BOOTSTRAP_PATH = '/hooks/chatbot/v2/bootstrap';
const MOUNT_PREFIX = '/hooks/chatbot/v2/';
const VISITOR_TEXT = 'Pomozte mi prosím vyplnit formulář.';
const ANSWER_PARTS = ['Dobrý den, ', 'vyplním to s vámi. ', 'E-mail jsem doplnil, odešlete prosím žádost.'];
const ANSWER = ANSWER_PARTS.join('');
const FILLED_EMAIL = 'jan.novak@example.cz';
const SECRET_PASSWORD = 'TajneHeslo123';
const SECRET_CARD = '4111111111111111';
/** The look an administrator configures in the last chapters, and the name they save with it. */
const CONFIGURED_NAME = 'Městský úřad Kolín';
const QUICK_TEXT = 'Chci vyplnit formulář';
const QUICK_ANSWER = 'Rozumím, projdeme to spolu.';
const LOOK = {
  ...selectAppearanceTemplate('elowen'),
  overrides: {
    mode: 'light',
    position: 'top-left',
    width: 420,
    height: 560,
    radius: 4,
    colors: { panel: '#101820', visitorBubble: '#ffd166', botBubble: '#ffffff', sendButton: '#0b6e4f', launcher: '#0b6e4f', launcherEnd: null },
    effects: { glass: false },
    intro: 'Dobrý den, pomohu vám s formulářem.',
    // An embedded image, deliberately: an avatar URL would be a request to a host the customer's page never
    // agreed to talk to, and this scenario refuses every request that leaves the page and the hook.
    avatarUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="%230b6e4f"/></svg>',
    quickButtons: [{ text: QUICK_TEXT, icon: null }, { text: 'Kde je podatelna?', icon: null }],
  },
};

/** The limit set this chatbot is configured with, complete because a chatbot cannot be enabled without one:
 *  the plugin has no defaults, and the scenario wants turns to run rather than to be refused. */
const SCENARIO_LIMITS = {
  rateIpPerMinute: 120,
  rateChatbotPerMinute: 120,
  rateConversationPerMinute: 60,
  dailyTurnLimit: 500,
  dailyCostMicrousd: null,
  maxConcurrentTurns: 4,
  maxQueueDepth: 8,
  queueTimeoutSeconds: 60,
  // Above what the scenario sends: it drives several action kinds and both submission outcomes, so a
  // ceiling low enough to refuse one of them would test the budget here instead of the action lifecycle.
  // 20 is the maximum the plugin accepts, and the budget has its own tests.
  maxActionsPerTurn: 20,
  retentionDays: 30,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function poll(description, fn, timeoutMs = 15_000, intervalMs = 40) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`TIMEOUT waiting for ${description}`);
    await sleep(intervalMs);
  }
}

/** Everything the customer's site saw. It is the OTHER origin in this scenario. */
const site = { submissions: [], requests: [] };

/** Everything this scenario observed about the conversation, for the assertions and for the failure dump. */
const hook = {
  requests: [],
  allRequests: [],
  eventsRequests: [],
  cuts: 0,
  cutNextStream: false,
  /** Ends the stream that is open right now, as a lost connection would. Set while one is being piped. */
  cutOpenStream: null,
  /** Hold bootstrap briefly so the page can finish loading before its first-painted launcher attaches. */
  slowBootstrapMs: 400,
  /** What happened, in the order it happened: the ordering of a cut against an action is the whole point of
   *  the last flow, and two booleans cannot express it. */
  sequence: [],
  turnId: null,
  hostileActionId: null,
  actions: [],
  warnings: [],
};

// ── the plugin itself, in this process ────────────────────────────────────────────────────────────────
//
// One chatbot account bound to one managed Project, exactly as the admin API would register it, and the host
// facts the plugin re-checks before it will run or act at all.

const db = makePluginDb(openDb(':memory:'), 'chatbot', { canMigrate: true });
migrate(db);
const store = new ChatbotStore(db);
const visitorRows = () => ({
  visitors: db.prepare('SELECT COUNT(*) AS count FROM p_chatbot_visitors').get().count,
  tokens: db.prepare('SELECT COUNT(*) AS count FROM p_chatbot_tokens').get().count,
  turns: db.prepare('SELECT COUNT(*) AS count FROM p_chatbot_turns').get().count,
});
const accounts = [{ id: CHATBOT_ACCOUNT, username: 'ured-bot', name: 'Městský úřad', avatar: '', isAdmin: false, type: 'chatbot' }];
const projects = [{ id: PROJECT_ID, slug: 'ured', path: '/ured', executionKind: 'managed', lifecycle: 'active' }];
const stores = {
  usersRead: {
    list: () => accounts,
    isAdmin: (id) => accounts.find((account) => account.id === id)?.isAdmin === true,
    allowedExecs: () => [],
    mayUsePlugin: () => true,
    effectiveChatExec: () => null,
  },
  projects: { get: (id) => projects.find((project) => project.id === id) ?? null, list: () => projects },
  userProjects: { canAccess: () => true, canManage: () => true },
};
const warn = (message) => { hook.warnings.push(message); console.warn(`  [plugin] ${message}`); };
const broker = new TurnEventBroker(warn);
const adapter = new ChatbotAdapter(warn);
const now = () => new Date();
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const fixtureDirectory = mkdtempSync(resolve(tmpdir(), 'chatbot-route-e2e-'));
const imagePath = resolve(fixtureDirectory, 'visitor.png');
writeFileSync(imagePath, imageBytes);
const sharedImageName = `${'a'.repeat(64)}.png`;
const sharedFileName = `${'b'.repeat(64)}.bin`;
const coreSessionId = 'brain-ch-chatbot-attachment-scenario';
const savedImages = new Map();
const files = {
  async uploadProjectImage({ visitorScope, name, size, body }) {
    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    assert(bytes.length === size && bytes.equals(imageBytes), 'The uploaded image was modified during transport');
    const path = `/managed/${visitorScope}/${name}`;
    savedImages.set(path, bytes);
    return { path, relative: `${visitorScope}/${name}`, name, size, visitorScope, project: { id: PROJECT_ID, slug: 'ured' } };
  },
  async readProjectImage({ receipt }) {
    const bytes = savedImages.get(receipt.path);
    return bytes ? { bytes, mimeType: 'image/png' } : null;
  },
  readShared({ sessionId, kind, storedName }) {
    if (sessionId !== coreSessionId) return null;
    if (kind === 'image' && storedName === sharedImageName) return { bytes: imageBytes, mimeType: 'image/png' };
    if (kind === 'file' && storedName === sharedFileName) return { bytes: Buffer.from('file'), mimeType: 'application/octet-stream', disposition: 'attachment; filename="document.pdf"' };
    return null;
  },
};
const actions = new PageActionService({ store, broker, now, info: () => undefined, warn });
const queue = new ChatbotTurnQueue({ store, adapter, files, broker, now: () => now().toISOString(), warn });

const bot = store.createBot({
  chatbotUserId: CHATBOT_ACCOUNT,
  publicId: PUBLIC_ID,
  displayName: 'Městský úřad',
  origins: [],
  // A chatbot serves under numbers its owner decided; the plugin has none of its own, and it refuses to serve
  // without them. The scenario writes a complete set, exactly as an administrator would have.
  limits: SCENARIO_LIMITS,
  maySubmitForms: true,
  now: now().toISOString(),
});
adapter.listen(async () => undefined);

/** The tool the model calls, registered through the real registration path against a context that reports the
 *  turn being scripted. Nothing about it is stubbed: it is the shipped tool with its own guards, and every
 *  answer asserted below is the answer a real model would receive. */
let registeredTool = null;
let currentVisitorId = '';
registerPageActionTool({
  ctx: {
    currentIdentity: () => ({ platform: 'chatbot', userId: currentVisitorId, elowenUserId: CHATBOT_ACCOUNT, admin: false, owner: false, conversation: 'direct' }),
    currentSessionId: () => `brain-ch-chatbot-${CHATBOT_ACCOUNT}:${currentVisitorId}`,
    host: { stores: () => stores },
    registerTool: (tool) => { registeredTool = tool; },
  },
  store,
  service: actions,
});

/** What the plugin answers a public request with, as an HTTP response. */
async function writeReply(response, reply) {
  for (const [key, value] of Object.entries(reply.headers ?? {})) response.setHeader(key, value);
  const body = reply.body;
  if (body === undefined) {
    response.writeHead(reply.status);
    return response.end();
  }
  if (typeof body === 'string' || body instanceof Uint8Array) {
    if (!response.getHeader('content-type')) response.setHeader('content-type', 'application/json');
    response.writeHead(reply.status);
    return response.end(body);
  }
  if (typeof body.getReader === 'function') return writeStream(response, reply, body);
  if (!response.getHeader('content-type')) response.setHeader('content-type', 'application/json');
  response.writeHead(reply.status);
  return response.end(JSON.stringify(body));
}

/** One turn's event stream, piped to the browser. The first stream of a run is cut after two frames ON
 *  purpose: a connection that dies mid-answer is what the widget's cursor exists for, and a cut performed by
 *  the transport is the only way to watch the reconnect against the real route. A later cut is asked for by
 *  the scripted model, which needs the widget AWAY at a moment it chooses.
 *
 *  Each frame is awaited before the next, and the body is closed cleanly: a destroyed socket would drop the
 *  very frames the widget is supposed to resume from, and an abruptly broken connection would also put a
 *  network error in the customer's console — which the gate below refuses. A body that ends without a
 *  terminal frame is a stream this client lost, which is exactly what is being exercised. */
async function writeStream(response, reply, stream) {
  response.writeHead(reply.status);
  const reader = stream.getReader();
  let frames = hook.cutNextStream ? 2 : Number.POSITIVE_INFINITY;
  hook.cutNextStream = false;
  hook.cutOpenStream = () => {
    hook.cuts += 1;
    return reader.cancel();
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return response.end();
      await new Promise((resolve) => response.write(value, resolve));
      frames -= 1;
      if (frames === 0) {
        hook.cuts += 1;
        return response.end();
      }
    }
  } finally {
    hook.cutOpenStream = null;
    await reader.cancel().catch(() => undefined);
  }
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function hookHandler(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const origin = request.headers.origin;
  const observed = { method: request.method, path: url.pathname + url.search, origin, hasAuthorization: Boolean(request.headers.authorization) };
  hook.requests.push(observed);
  hook.allRequests.push(observed);
  if (hook.slowBootstrapMs > 0 && url.pathname === BOOTSTRAP_PATH) await sleep(hook.slowBootstrapMs);

  // The daemon answers a preflight with its permissive CORS middleware before any plugin handler runs. This
  // stand-in does the same, and nothing more: what ADMITS a request is the plugin's own decision.
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': origin ?? '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-max-age': '600',
      vary: 'Origin',
    });
    return response.end();
  }

  const raw = await readBody(request);
  if (url.pathname === BOOTSTRAP_PATH) observed.body = raw.toString('utf8');
  if (url.pathname.endsWith('/events')) {
    const after = Number(url.searchParams.get('after') ?? '0');
    hook.eventsRequests.push(after);
    hook.sequence.push(`stream:${after}`);
  }
  const reply = await publicRoute({
    method: request.method,
    // The daemon strips the plugin's own mount before the handler sees the path.
    path: url.pathname.startsWith(MOUNT_PREFIX) ? url.pathname.slice(MOUNT_PREFIX.length) : url.pathname.replace(/^\/hooks\/chatbot\//, ''),
    query: Object.fromEntries(url.searchParams),
    headers: request.headers,
    // Core resolves where a request came from (C1). A loopback address the deployment trusts is what the
    // plugin's own gate requires, and it is the only thing faked about the transport.
    origin: { value: '127.0.0.1', kind: 'ip', trusted: true },
    acceptsStreamBody: true,
    stream: () => new ReadableStream({ start(controller) { controller.enqueue(raw); controller.close(); } }),
    json: async () => JSON.parse(raw.toString('utf8')),
    body: async () => raw,
  });
  if (url.pathname === BOOTSTRAP_PATH) observed.status = reply.status;
  return writeReply(response, reply);
}

/** The turn this run recorded, which is what the scripted model decides against. */
function recordedTurn() {
  const newest = db.prepare('SELECT turn_id FROM p_chatbot_turns ORDER BY created_at DESC, turn_id DESC LIMIT 1').get();
  return newest === undefined ? null : store.turn(newest.turn_id);
}

/** The same settled snapshot result the tool returned to the model. */
function readRawPageState() {
  const row = store.latestPageAction(recordedTurn().turn_id);
  return row?.status === 'done' && row.action === 'snapshot' ? JSON.parse(JSON.parse(row.result_json).detail) : null;
}

/** The model of this scenario: an answer that streams, and the page actions a real one would ask for.
 *
 *  A message a visitor sent by pressing one of the panel's own quick buttons is answered plainly: the
 *  page-action flow below is scripted once, and a suggestion is a message like any other as far as the
 *  plugin is concerned, so it must reach the model through exactly the same turn path. */
async function modelTurn({ src, observer }) {
  currentVisitorId = src.userId;
  const turn = store.runningTurnOf(CHATBOT_ACCOUNT, src.userId);
  if (src.images?.length) {
    assert(src.images.length === 1 && Buffer.from(src.images[0].data, 'base64').equals(imageBytes), 'The relay did not receive the visitor image');
    observer?.onEvent({ type: 'session', sessionId: coreSessionId });
    observer?.onEvent({ type: 'image', ref: `/api/brain/chat-images/${sharedImageName}`, caption: 'Preview' });
    observer?.onEvent({ type: 'file', ref: `/api/brain/chat-files/${sharedFileName}`, name: 'document.pdf', size: 4 });
    return undefined;
  }
  if (turn.message.includes(QUICK_TEXT)) {
    observer?.onEvent({ type: 'text', delta: QUICK_ANSWER });
    return QUICK_ANSWER;
  }
  assert(turn.page_url !== null, 'the visitor message carried no page address');
  assert(!turn.message.includes('"targets"'), 'the visitor message carried a snapshot');
  const snapshot = await registeredTool.execute('call-snapshot', { action: 'snapshot' });
  assert(snapshot.details?.status === 'done', 'the requested snapshot did not complete');
  const asSeenByTheModel = JSON.parse(snapshot.details.detail);
  const page = readRecordedPageState(snapshot.details.detail);
  assert(page.ok, `the plugin could not read the page state its own widget composed: ${page.ok ? '' : page.error}`);

  const target = (what, predicate) => {
    const found = asSeenByTheModel.targets.find(predicate);
    assert(found, `the page state described no ${what}`);
    assert(page.value.targets.some((candidate) => candidate.id === found.id), `the plugin did not read ${what} as a target`);
    return found.id;
  };
  const named = (label) => (candidate) => asSeenByTheModel.aria.includes(label + ' [' + candidate.id + ']');
  const jmeno = target('jméno field', named('Jméno a příjmení'));
  const email = target('e-mail field', named('E-mail'));
  const obec = target('obec select', named('Obec'));
  const card = target('card field', named('Číslo platební karty'));
  const submit = target('submit button', (candidate) => candidate.caps.includes('request_submit'));
  const souhlas = target('consent checkbox', named('Souhlasím se zpracováním údajů'));
  assert(asSeenByTheModel.targets.length === 7, `the sample form was described as ${asSeenByTheModel.targets.length} targets`);
  assert(submit !== undefined && card !== jmeno, 'the sample form was not described the way the visitor sees it');
  assert(
    asSeenByTheModel.targets.find((candidate) => candidate.id === card).caps.join() === 'focus',
    'the card field was described as writable',
  );

  const ask = (input) => registeredTool.execute(`call-${hook.actions.length + 1}`, { snapshotId: page.value.snapshotId, ...input });
  const record = async (what, input) => {
    const answer = await ask(input);
    // An action that answered without an outcome is a refusal this scenario cannot read as a decision: it is
    // reported with what the tool said, rather than crashing on the shape it did not have.
    if (answer?.details === null || answer?.details === undefined) {
      throw new Error(`the ${what} action answered without an outcome: ${JSON.stringify(answer?.content?.[0]?.text ?? answer)}`);
    }
    hook.actions.push({ what, status: answer.details.status, targetId: answer.details.targetId, text: answer.content[0].text });
    return answer;
  };

  observer?.onEvent({ type: 'session', sessionId: `brain-ch-chatbot-${CHATBOT_ACCOUNT}:${src.userId}` });
  // Reasoning and tool traffic are what a public log must never carry; the queue's allowlist drops them.
  observer?.onEvent({ type: 'reasoning', delta: 'internal thinking' });
  observer?.onEvent({ type: 'text', delta: ANSWER_PARTS[0] });

  // Flow 3: the transport cut the first stream after two frames, so the widget has to reconnect and read the
  // rest out of the turn's own log before anything else happens.
  await poll('the widget to reconnect after the cut', () => hook.cuts >= 1 && hook.eventsRequests.length >= 2);
  observer?.onEvent({ type: 'text', delta: ANSWER_PARTS[1] });

  // Flow 4: every kind a page description supports, against the sample form.
  await record('read', { action: 'read', targetId: jmeno });
  await record('fill', { action: 'fill', targetId: email, value: FILLED_EMAIL });
  await record('select', { action: 'select', targetId: obec, value: 'Praha' });
  // An ordinary click: the visitor's own consent box, which nothing depends on except the page itself. It is
  // the kind that must reach the page and change it — unlike a click on the submit button, refused below.
  await record('click', { action: 'click', targetId: souhlas });
  await record('scroll', { action: 'scroll', value: 'down' });

  // Flow 5: a click on the submit button never happens — the server refuses it before any page is asked.
  await record('click-submit', { action: 'click', targetId: submit });
  // …and a frame the server would never send is refused by the widget itself in the browser. The row is
  // written first so the widget's denial has somewhere to land: a denial of an action that does not exist is
  // a 404, and a widget that met one would stop reporting for the rest of the session.
  hook.hostileActionId = randomUUID();
  store.createAction({
    actionId: hook.hostileActionId,
    turnId: turn.turn_id,
    snapshotId: page.value.snapshotId,
    kind: 'click',
    targetId: submit,
    value: null,
    requiresConfirmation: false,
    nonceHash: hashToken('hostile-nonce-0001'),
    expiresAt: new Date(now().getTime() + 60_000).toISOString(),
    frame: {
      actionId: hook.hostileActionId,
      kind: 'click',
      targetId: submit,
      value: null,
      snapshotId: page.value.snapshotId,
      requiresConfirmation: false,
      confirmationNonce: 'hostile-nonce-0001',
    },
    now: now().toISOString(),
  });
  broker.publish(turn.turn_id);

  // Flow 6: an action asked while the widget is AWAY. The stream that is open is ended, and the frame written
  // in the meantime is one the widget only ever sees by reconnecting and reading the turn's log. This happens
  // BEFORE the submission below, because sending the form navigates the page away from the widget's own page.
  await poll('the widget to be connected', () => hook.cutOpenStream !== null);
  await hook.cutOpenStream();
  hook.sequence.push('ask-while-away');
  await record('read-after-reconnect', { action: 'read', targetId: jmeno });

  // The visitor declines a submission, and then confirms one.
  await record('submit-declined', { action: 'request_submit', targetId: submit });
  await record('submit-confirmed', { action: 'request_submit', targetId: submit });

  observer?.onEvent({ type: 'text', delta: ANSWER_PARTS[2] });
  return ANSWER;
}

adapter.control({ relay: (src, _text, observer) => modelTurn({ src, observer }) });

const publicRoute = createPublicRoute({
  store,
  queue,
  adapter,
  stores,
  files,
  broker,
  actions,
  pingIntervalMs: 15_000,
  // Nothing leaves this scenario: the customer's page and the hook are the only two origins it talks to, and
  // the look it configures carries its avatar as bytes rather than as an address. So this refusal is never
  // reached — and if a later chapter names a remote avatar, the panel simply has none.
  avatar: () => Promise.resolve({ ok: false, reason: 'unreachable' }),
  // The signing key of a throwaway instance. A real deployment keeps it in the instance secret bag, created
  // once, and never logs or returns it.
  secret: () => 'e2e-visitor-token-secret-0123456789',
  tokenTtlSeconds: () => 30 * 86_400,
  now,
  warn,
});

// ── the customer's own site, the OTHER origin ─────────────────────────────────────────────────────────

async function siteHandler(request, response) {
  const url = new URL(request.url, 'http://localhost');
  site.requests.push({ method: request.method, path: url.pathname });
  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/form.html')) {
    const html = readFileSync(fileURLToPath(new URL('./form.html', import.meta.url)), 'utf8')
      .replaceAll('__HOOK_ORIGIN__', hookOrigin)
      .replaceAll('__PUBLIC_ID__', PUBLIC_ID);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return response.end(html);
  }
  if (request.method === 'POST' && url.pathname === '/odeslat') {
    const raw = (await readBody(request)).toString('utf8');
    site.submissions.push({ query: url.search, ...Object.fromEntries(new URLSearchParams(raw)) });
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return response.end('<!doctype html><title>Odesláno</title><p id="odeslano">Žádost byla odeslána.</p>');
  }
  if (url.pathname === '/favicon.ico') {
    response.writeHead(204);
    return response.end();
  }
  response.writeHead(404);
  return response.end('not found');
}

function listen(handler) {
  const server = createServer((request, response) => {
    handler(request, response).catch((error) => {
      response.writeHead(500);
      response.end(String(error));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

let hookOrigin = '';
const passes = [];
const pass = (description) => {
  passes.push(description);
  console.log(`  ok  ${description}`);
};

/** The script may load, but no conversation request or page data may leave before a message. */
const assertBootstrapOnly = (requests) => {
  assert(requests.filter((entry) => entry.path === WIDGET_PATH).every((entry) => entry.method === 'GET'),
    `the widget asset received a non-GET request: ${JSON.stringify(requests)}`);
  const reads = requests.filter((entry) => entry.path !== WIDGET_PATH);
  const bootstraps = reads.filter((entry) => entry.method === 'POST' && entry.path === BOOTSTRAP_PATH);
  const preflights = reads.filter((entry) => entry.method === 'OPTIONS' && entry.path === BOOTSTRAP_PATH);
  assert(bootstraps.length === 1 && preflights.length <= 1 && reads.length === bootstraps.length + preflights.length,
    `an untouched widget made a request other than bootstrap: ${JSON.stringify(requests)}`);
  assert(reads.every((entry) => entry.origin === siteOrigin && !entry.hasAuthorization),
    `bootstrap sent a credential or used a different origin: ${JSON.stringify(reads)}`);
  assert(bootstraps[0].status === 200, `bootstrap did not return a look: ${JSON.stringify(bootstraps[0])}`);
  const body = JSON.parse(bootstraps[0].body);
  assert(body !== null && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).sort().join(',') === 'bot,schemaVersion'
    && body.schemaVersion === PUBLIC_SCHEMA_VERSION && body.bot === PUBLIC_ID,
    `bootstrap carried page data instead of only the chatbot id: ${bootstraps[0].body}`);
};

const assertNoNewVisitorState = async (before) => {
  const after = visitorRows();
  assert(JSON.stringify(after) === JSON.stringify(before), `bootstrap created visitor state: ${JSON.stringify({ before, after })}`);
  const storage = await page.evaluate((publicId) => ({
    entries: sessionStorage.length,
    hasToken: sessionStorage.getItem(`elowen.chatbot.${publicId}.token`) !== null,
  }), PUBLIC_ID);
  assert(storage.entries === 0 && !storage.hasToken, `bootstrap stored a visitor credential: ${JSON.stringify(storage)}`);
};

const { server: hookServer, port: hookPort } = await listen(hookHandler);
hookOrigin = `http://127.0.0.1:${hookPort}`;
const { server: siteServer, port: sitePort } = await listen(siteHandler);
const siteOrigin = `http://127.0.0.1:${sitePort}`;
const FORM_URL = `${siteOrigin}/form.html`;
// The chatbot answers on the customer's own site, and only there.
store.updateBot({
  chatbotUserId: CHATBOT_ACCOUNT,
  expectedUpdatedAt: bot.updated_at,
  displayName: 'Městský úřad',
  origins: [siteOrigin],
  limits: SCENARIO_LIMITS,
  maySubmitForms: true,
  now: now().toISOString(),
});
assert(store.botByUserId(CHATBOT_ACCOUNT)?.may_submit_forms === 1, 'the scenario chatbot cannot submit forms');
store.setBotStatus({ chatbotUserId: CHATBOT_ACCOUNT, status: 'enabled', now: now().toISOString() });
await adapter.connect();

/** One action the scripted model asked for, by the name the scenario knows it under. */
const actionOf = (what) => hook.actions.find((entry) => entry.what === what) ?? null;

let browser = null;
// Declared out here so a failure can still report what the page was showing.
let page = null;
let consoleErrors = [];
let allConsole = [];
let external = [];
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const observePage = (tab) => {
    tab.on('console', (message) => { allConsole.push(`${message.type()}: ${message.text()}`); if (message.type() === 'error') consoleErrors.push(message.text()); });
    tab.on('pageerror', (error) => consoleErrors.push(String(error)));
    tab.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('http')) return;
      if (url.startsWith(siteOrigin) || url.startsWith(hookOrigin)) return;
      external.push(url);
    });
  };
  page = await browser.newPage();
  observePage(page);

  /** What the panel currently shows. One evaluate per read, reading through the OPEN shadow root exactly as
   *  the site's own script would. */
  const panel = () => page.evaluate(() => {
    const root = document.querySelector('[data-elowen-chatbot]')?.shadowRoot ?? null;
    const chat = root?.querySelector('deep-chat') ?? null;
    return {
      mounted: root !== null,
      open: root?.querySelector('.panel')?.hidden === false,
      confirmVisible: root?.querySelector('.confirm')?.hidden === false,
      confirmTitle: root?.querySelector('.confirm-title')?.textContent ?? '',
      status: root?.querySelector('.status')?.hidden === false ? root.querySelector('.status').textContent : '',
      messages: chat ? chat.getMessages().map((message) => ({ role: message.role, text: message.text })) : [],
    };
  });
  const answerText = (state) => state.messages.filter((message) => message.role === 'ai').map((message) => message.text).join('');
  // Every state the panel was seen in: a partial answer is a state nothing else records, and the answer's
  // completeness is only meaningful next to the states that were not complete yet.
  const seen = new Set();
  const statuses = new Set();
  const observe = async () => {
    const state = await panel();
    seen.add(answerText(state));
    if (state.status !== '') statuses.add(state.status);
    return state;
  };

  const emptyVisitorRows = visitorRows();
  assert(JSON.stringify(emptyVisitorRows) === JSON.stringify({ visitors: 0, tokens: 0, turns: 0 }),
    `the scenario started with visitor state: ${JSON.stringify(emptyVisitorRows)}`);
  await page.goto(FORM_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ElowenChatbot !== undefined, { timeout: 10_000 });
  // The visitor fills in their OWN form before opening the chat, so the description that travels with their
  // message carries a real value — and a secret that must not travel with it.
  await page.type('#jmeno', 'Jan Novák');
  await page.type('#heslo', SECRET_PASSWORD);
  await page.type('#karta', SECRET_CARD);
  await sleep(400);

  await poll('the initial bootstrap to finish', () => hook.requests.find((entry) => entry.path === BOOTSTRAP_PATH && entry.status === 200));
  await page.waitForFunction(() => document.querySelector('[data-elowen-chatbot]') !== null, { timeout: 10_000 });
  assertBootstrapOnly(hook.requests);
  await assertNoNewVisitorState(emptyVisitorRows);
  assert((await panel()).mounted, 'the successful bootstrap did not attach the first-painted launcher');
  pass('before a message, only bootstrap reads the look, with no page data or visitor state');

  // ── flow 1: the first message carries a bounded description of the page ───────────────────────────────
  const launcher = await page.evaluateHandle(() => document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('.launcher'));
  await launcher.asElement().click();
  assert((await panel()).open, 'the panel did not open on a click of the launcher');
  await page.waitForFunction(() => Boolean(document.querySelector('[data-elowen-chatbot]')?.shadowRoot.querySelector('deep-chat')?.shadowRoot?.querySelector('#text-input')),
    { timeout: 10_000 });
  await page.evaluate(() => document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('deep-chat').focusInput());
  await page.keyboard.type(VISITOR_TEXT);
  const typed = await page.evaluate(() => document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('deep-chat').shadowRoot.querySelector('#text-input').textContent);
  assert(typed === VISITOR_TEXT, `the visitor's text was lost before submission: ${JSON.stringify(typed)}`);
  hook.cutNextStream = true;
  await page.keyboard.press('Enter');

  const turn = await poll('the visitor message to reach the plugin', () => recordedTurn());
  hook.turnId = turn.turn_id;
  const composed = turn.message;
  const pageState = await poll('the on-demand snapshot result', () => readRawPageState());
  assert(composed === VISITOR_TEXT, `the stored message is not exactly the visitor's own words: ${composed.slice(0, 90)}`);
  assert(turn.page_url === FORM_URL, `the page address beside the message is not the page's origin and path: ${turn.page_url}`);
  assert(turn.page_title !== null && turn.page_title !== '', 'the page title did not travel beside the message');
  assert(!composed.includes('Jan Novák'), 'a field value travelled with the visitor message');
  assert(pageState.aria.includes('Jan Novák'), 'the snapshot did not carry the field value');
  assert(!composed.includes(SECRET_PASSWORD), 'the password the visitor typed travelled to the server');
  assert(!composed.includes(SECRET_CARD), 'the card number the visitor typed travelled to the server');
  assert(pageState.aria.includes('heading "Kontaktní formulář"'), 'the snapshot carried no heading');
  assert(!JSON.stringify(pageState).includes(SECRET_PASSWORD), 'the snapshot disclosed the password');
  assert(!JSON.stringify(pageState).includes(SECRET_CARD), 'the snapshot disclosed the card');
  assert(!pageState.url.includes('zdroj=web'), 'the page state carried the page query string');
  pass('the first message is the visitor\'s words with the page address and title beside it, and the snapshot tool result omits sensitive values');

  // ── flow 2: the answer streams into the panel as it arrives ───────────────────────────────────────────
  await poll('the first part of the answer to arrive', async () => answerText(await observe()).includes(ANSWER_PARTS[0]));
  pass('the answer starts arriving in the panel');

  // ── flow 3: a stream cut mid-answer is resumed, not repeated ──────────────────────────────────────────
  await poll('the widget to reconnect', () => hook.cuts >= 1 && hook.eventsRequests.length >= 2);
  assert(hook.eventsRequests[1] > 0, `the reconnect asked for the whole turn again (after=${hook.eventsRequests[1]})`);
  await poll('the rest of the answer to arrive after the reconnect', async () => answerText(await observe()).includes(ANSWER_PARTS[1]));
  // The reconnection is said in the panel's own status line, not as a message in the transcript: the states
  // collected while the answer arrived are what is asserted, because the line clears once the answer is done.
  assert(
    [...statuses].some((status) => status.includes('připojit')),
    `the panel never announced the reconnection: ${JSON.stringify([...statuses])}`,
  );
  assert(
    [...seen].some((text) => text.includes(ANSWER_PARTS[0]) && !text.includes(ANSWER_PARTS[2])),
    `the panel never showed a partial answer, so nothing streamed: ${JSON.stringify([...seen].slice(-4))}`,
  );
  pass(`a stream cut mid-answer resumed from the last rendered frame (after=${hook.eventsRequests[1]}) with no doubled text`);

  // ── flow 4: every kind of action the server approved lands on the page ────────────────────────────────
  const read = await poll('the agent to read the field the visitor filled in', () => actionOf('read'));
  assert(read.status === 'done' && read.text.includes('Jan Novák'), `the read answered ${read.text}`);
  await poll('the agent to fill the e-mail field', async () => page.$eval('#email', (input, expected) => input.value === expected, FILLED_EMAIL));
  assert((await poll('the fill to be answered', () => actionOf('fill'))).status === 'done', `the fill failed: ${JSON.stringify(actionOf('fill'))}`);
  await poll('the agent to choose an option', async () => page.$eval('#obec', (select) => select.value === 'Praha'));
  assert((await poll('the select to be answered', () => actionOf('select'))).status === 'done', `the select failed: ${JSON.stringify(actionOf('select'))}`);
  await poll('the agent to click the consent box', async () => page.$eval('#souhlas', (box) => box.checked));
  const clicked = await poll('the click to be answered', () => actionOf('click'));
  assert(clicked.status === 'done', `the click failed: ${JSON.stringify(clicked)}`);
  await poll('the agent to scroll the page', async () => page.evaluate(() => window.scrollY > 0));
  // The page scrolls as part of PERFORMING the action, so the report can land after the page moved: the
  // assertion waits for the answer rather than assuming it is already here.
  const scrolled = await poll('the scroll to be answered', () => actionOf('scroll'));
  assert(scrolled.status === 'done', `the scroll failed: ${JSON.stringify(scrolled)}`);
  assert(scrolled.targetId === null, `a page scroll carried a target: ${JSON.stringify(scrolled)}`);
  pass('read, fill, select, a real click and a target-less scroll all happened on the page, each reported done');

  // ── flow 5: a submit needs the visitor, and a click can never be one ──────────────────────────────────
  const refusedClick = await poll('the server to refuse a click on the submit button', () => actionOf('click-submit'));
  assert(refusedClick.status === 'refused', `a click on the submit button was not refused: ${JSON.stringify(refusedClick)}`);
  assert(refusedClick.text.includes('request_submit'), `the refusal did not say what to ask for instead: ${refusedClick.text}`);
  assert(site.submissions.length === 0, 'the form was sent by a generic click');

  // A frame the server would never send, refused by the widget itself in a real browser.
  const hostile = await poll('the widget to refuse the frame the server should never have sent', () => {
    const row = store.action(hook.hostileActionId);
    return row !== null && row.status === 'error' ? row : null;
  });
  assert(JSON.parse(hostile.result_json).outcome === 'denied', `the widget did not deny the hostile frame: ${hostile.result_json}`);
  assert(JSON.parse(hostile.result_json).detail === 'submit_is_its_own_action', `the widget denied the hostile frame for the wrong reason: ${hostile.result_json}`);
  assert(site.submissions.length === 0, 'a click the widget refused still sent the form');
  // What "a submit can never be an ordinary click" means on the wire: NO click the plugin approved targets
  // the element that sends the form. The one click row on it is the scenario's own frame, written as a
  // compromised server would; the only other click this run asked for is the ordinary consent box.
  const submitTarget = pageState.targets.find((candidate) => candidate.caps.includes('request_submit'));
  assert(submitTarget, 'the sample form described no submit button');
  const clickRows = db.prepare('SELECT id, request_json FROM p_chatbot_actions WHERE action = ?').all('click');
  const scenarioRow = clickRows.find((row) => row.id === hook.hostileActionId);
  assert(scenarioRow && JSON.parse(scenarioRow.request_json).targetId === submitTarget.id, `the scenario's own click row did not target the submit button: ${JSON.stringify(clickRows)}`);
  const approvedClicks = clickRows.filter((row) => row.id !== hook.hostileActionId);
  assert(
    approvedClicks.length === 1 && JSON.parse(approvedClicks[0].request_json).targetId !== submitTarget.id,
    `the plugin approved a click it may not have: ${JSON.stringify(approvedClicks)}`,
  );
  pass('the server refused a click on a submit button, and the widget refused a hostile frame of the same kind');

  // ── flow 6: an action asked while the widget was away is answered after it reconnects ─────────────────
  assert(hook.cuts >= 2, 'the second stream was never cut, so the outage was not exercised');
  const replayed = await poll('the action asked during the outage to be answered', () => actionOf('read-after-reconnect'));
  assert(replayed.status === 'done', `the action was not performed after the reconnect: ${JSON.stringify(replayed)}`);
  assert(replayed.text.includes('Jan Novák'), `the replayed read answered ${replayed.text}`);
  // It was asked while the widget was away, and the widget was only told about it by reconnecting: the ask
  // comes before the last stream the browser opened, and never after it.
  assert(
    hook.sequence.indexOf('ask-while-away') !== -1
      && hook.sequence.indexOf('ask-while-away') < hook.sequence.findLastIndex((entry) => entry.startsWith('stream:')),
    `the action was not asked during the outage: ${JSON.stringify(hook.sequence)}`,
  );
  pass('an action asked while the widget was disconnected was picked up from the log and answered');

  await poll('the confirmation to be asked', async () => (await panel()).confirmVisible);
  const asked = await panel();
  assert(asked.confirmTitle.includes('Odeslat formulář'), `the confirmation asked nothing recognisable: ${asked.confirmTitle}`);
  assert(site.submissions.length === 0, 'the form was sent before the visitor answered');

  // A page can dispatch a click on that very button. It must decide nothing: not a submit, and not a decline
  // either, because the question belongs to the visitor.
  await page.evaluate(() => document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('.confirm-yes').click());
  await sleep(400);
  assert(site.submissions.length === 0, 'a click the page dispatched itself sent the form');
  assert((await panel()).confirmVisible, 'a click the page dispatched itself dismissed the question');
  pass('a synthetic click on the confirm button confirmed nothing and sent nothing');

  const declineButton = await page.evaluateHandle(() => document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('.confirm-no'));
  await declineButton.asElement().click();
  const declined = await poll('the declined submission to be answered', () => actionOf('submit-declined'));
  assert(declined.status === 'cancelled', `the decline answered ${JSON.stringify(declined)}`);
  assert(site.submissions.length === 0, 'the form was sent although the visitor declined');
  pass('the visitor\'s decline answered the waiting tool with a cancellation, and sent nothing');

  await poll('the confirmation to be asked again', async () => (await panel()).confirmVisible);
  const confirmButton = await page.evaluateHandle(() => document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('.confirm-yes'));
  await confirmButton.asElement().click();
  await poll('the form to be sent', () => site.submissions.length > 0, 10_000);
  const submitted = site.submissions[0];
  assert(submitted.jmeno === 'Jan Novák', `the submitted form lost the visitor's own value: ${JSON.stringify(submitted)}`);
  assert(submitted.email === FILLED_EMAIL, `the submitted form did not carry what the agent filled in: ${JSON.stringify(submitted)}`);
  assert(submitted.obec === 'Praha', `the submitted form did not carry the option the agent chose: ${JSON.stringify(submitted)}`);
  assert(submitted.query === '?zdroj=web', `the form was not submitted through its own action: ${JSON.stringify(submitted.query)}`);
  const confirmed = await poll('the submit to be answered', () => actionOf('submit-confirmed'));
  assert(['done', 'submitted'].includes(confirmed.status), `the confirmed submit answered ${JSON.stringify(confirmed)}`);
  pass('the visitor\'s own click on the confirmation is what sent the form');

  // ── flow 7: the answer ends whole, and a reload restores the conversation ─────────────────────────────
  assert(hook.actions.length === 9, `the model asked for ${hook.actions.length} actions, not the nine this scenario scripts`);
  // Sending the form navigated the page to the office's own confirmation, where the widget is not embedded.
  // Coming back is what a visitor does, and it also puts the last part of the answer to the test: the widget
  // resumes the turn that is still running from the visitor's own conversation and streams what is left.
  await page.goto(FORM_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ElowenChatbot !== undefined, { timeout: 10_000 });
  await poll('the answer to finish', async () => answerText(await observe()) === ANSWER, 20_000);
  await poll('the turn to finish', () => store.turn(hook.turnId)?.status === 'done');
  await page.goto(FORM_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ElowenChatbot !== undefined, { timeout: 10_000 });
  const restored = await poll('the transcript to be restored', async () => {
    const state = await panel();
    return state.messages.length >= 2 ? state.messages : null;
  });
  const restoredVisitor = restored.find((message) => message.role === 'user');
  assert(restoredVisitor?.text === VISITOR_TEXT, `the restored transcript did not show the visitor's own words: ${JSON.stringify(restoredVisitor)}`);
  assert(restored.some((message) => message.role === 'ai' && message.text === ANSWER), 'the restored transcript lost the answer');
  // Drawing the transcript must not ASK for anything. Re-submitting the visitor's own restored message would
  // be a second turn of the same words — the same question asked of the model again, on every reload.
  const submittedTurns = hook.requests.filter((entry) => entry.method === 'POST' && entry.path === '/hooks/chatbot/v2/turns');
  assert(submittedTurns.length === 1, `the visitor's message was submitted ${submittedTurns.length} times: ${JSON.stringify(submittedTurns)}`);
  assert(
    db.prepare('SELECT COUNT(*) AS count FROM p_chatbot_turns WHERE turn_id != ?').get('').count === 1,
    'restoring the conversation recorded another turn',
  );
  pass('the answer ended whole, and a reload restores it from the visitor\'s own projection without asking anything again');

  // ── the panel at the widths a customer's visitors actually use ───────────────────────────────────────
  for (const [width, height, mobile] of [[320, 844, true], [1440, 900, false]]) {
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile });
    await page.goto(FORM_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('[data-elowen-chatbot]') !== null, { timeout: 10_000 });
    const launcherAt = await page.evaluateHandle(() => document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('.launcher'));
    await launcherAt.asElement().click();
    const geometry = await page.evaluate(() => {
      const root = document.querySelector('[data-elowen-chatbot]').shadowRoot;
      const box = root.querySelector('.panel').getBoundingClientRect();
      const button = root.querySelector('.launcher').getBoundingClientRect();
      return {
        panel: { top: box.top, left: box.left, right: box.right, bottom: box.bottom },
        launcher: { right: button.right, bottom: button.bottom },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    assert(geometry.panel.left >= 0 && geometry.panel.top >= 0, `the panel hangs off the top-left at ${width}px: ${JSON.stringify(geometry.panel)}`);
    assert(geometry.panel.right <= geometry.viewport.width + 1, `the panel hangs off the right edge at ${width}px: ${JSON.stringify(geometry.panel)}`);
    assert(geometry.panel.bottom <= geometry.viewport.height + 1, `the panel hangs off the bottom at ${width}px: ${JSON.stringify(geometry.panel)}`);
    assert(
      geometry.launcher.right <= geometry.viewport.width + 1 && geometry.launcher.bottom <= geometry.viewport.height + 1,
      `the launcher is not reachable at ${width}px: ${JSON.stringify(geometry.launcher)}`,
    );
    // The panel must not be what makes the customer's own page scroll sideways.
    assert(geometry.scrollWidth <= geometry.viewport.width, `the widget widened the page at ${width}px: ${geometry.scrollWidth} > ${geometry.viewport.width}`);
    pass(`the launcher and the panel fit inside a ${width}x${height} viewport without widening the page`);
  }

  // ── the look an administrator saves, as the customer's visitors receive it ─────────────────────────────
  //
  // The save goes through the SAME handler the appearance editor's PUT reaches, over the real store and the
  // real contract, so this is the customer-facing half of a real save rather than a row poked into the
  // database. The panel is then looked at in a real browser, because what it PAINTS is the only thing that
  // proves the look arrived — and because a panel that paints is what an administrator's preview promises.
  const admin = createAdminApi({ store, stores, publicBaseUrl: () => hookOrigin, now, warn });
  const saved = await admin.updateAppearance(
    { userId: 1, admin: true, tokenScope: 'user', accessibleProjects: null },
    {
      chatbotUserId: CHATBOT_ACCOUNT,
      expectedUpdatedAt: store.botByUserId(CHATBOT_ACCOUNT).updated_at,
      displayName: CONFIGURED_NAME,
      appearance: LOOK,
    },
  );
  assert(saved.status === 200, `the appearance save was refused: ${JSON.stringify(saved)}`);
  pass('an administrator\'s save of the look and the chatbot\'s name is accepted by the real route');

  /** A fresh browser tab has no previous visitor credential. Its only page load is the one observed:
   *  bootstrap paints the configured launcher before anything is attached or a conversation is read. */
  const freshVisit = async (width, height, mobile) => {
    await page.close();
    page = await browser.newPage();
    observePage(page);
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile });
    hook.requests.length = 0;
    await page.goto(FORM_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => window.ElowenChatbot !== undefined, { timeout: 10_000 });
  };

  const openPanel = async () => {
    const opener = await page.evaluateHandle(() => document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('.launcher'));
    await opener.asElement().click();
  };

  /** What the panel is showing, read out of the real shadow roots after the library has drawn it. */
  const panelLook = () => page.evaluate(() => {
    const root = document.querySelector('[data-elowen-chatbot]').shadowRoot;
    const panel = root.querySelector('.panel');
    const box = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    const chat = root.querySelector('deep-chat');
    const chatRoot = chat.shadowRoot;
    const bubble = (role) => {
      const element = chatRoot.querySelector(`.message-bubble.${role}-message`);
      return element === null ? null : getComputedStyle(element).backgroundColor;
    };
    return {
      open: panel.hidden === false,
      title: root.querySelector('.title').textContent,
      background: style.backgroundColor,
      radius: style.borderRadius,
      box: { left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) },
      intro: chatRoot.textContent,
      quick: [...chatRoot.querySelectorAll('.cb-quick-item')].map((button) => button.textContent),
      aiBubble: bubble('ai'),
      userBubble: bubble('user'),
      messages: chat.getMessages().map((message) => ({ role: message.role, text: message.text })),
    };
  });
  const drawnWithTheLook = async () => {
    const state = await panelLook();
    return state.open && state.title === CONFIGURED_NAME ? state : null;
  };

  const launcherColour = () => page.evaluate(() => {
    const root = document.querySelector('[data-elowen-chatbot]').shadowRoot;
    return getComputedStyle(root.querySelector('.launcher')).backgroundColor;
  });
  const bootstrapReads = () => hook.requests.filter((entry) => entry.method === 'POST' && entry.path === BOOTSTRAP_PATH);

  // A fresh visitor gets the owner's colours before the launcher first appears, without a visitor token.
  const beforeFresh = visitorRows();
  await freshVisit(320, 844, true);
  await poll('the fresh bootstrap to finish', () => bootstrapReads().length === 1 && bootstrapReads()[0].status === 200);
  await page.waitForFunction(() => document.querySelector('[data-elowen-chatbot]') !== null, { timeout: 10_000 });
  assertBootstrapOnly(hook.requests);
  await assertNoNewVisitorState(beforeFresh);
  assert(!(await panelLook()).open, 'a fresh visit opened the panel before the visitor did');
  assert((await panelLook()).title === CONFIGURED_NAME, 'the launcher appeared before the saved name arrived');
  assert(await launcherColour() === 'rgb(11, 110, 79)', `the launcher flashed an unconfigured colour: ${await launcherColour()}`);
  await openPanel();
  assertBootstrapOnly(hook.requests);
  await assertNoNewVisitorState(beforeFresh);

  const mobile = await poll('the panel to be drawn with the configured look', drawnWithTheLook);
  await page.mouse.move(0, 0);
  assert(await launcherColour() === 'rgb(11, 110, 79)', `the launcher was not repainted in the configured colour: ${await launcherColour()}`);
  assert(mobile.background === 'rgb(16, 24, 32)', `the panel was not painted the configured colour: ${mobile.background}`);
  assert(mobile.radius === '4px', `the panel corners were not the configured radius: ${mobile.radius}`);
  // The configured size, clamped to the room a 320px viewport leaves: 320 - 40 across, 844 - 140 down.
  assert(mobile.box.width === 280 && mobile.box.height === 560, `the panel is not the configured size clamped to this viewport: ${JSON.stringify(mobile.box)}`);
  // In a top corner, the launcher sits above the panel with a 12 px gap.
  assert(mobile.box.left === 20 && mobile.box.top === 88, `the panel is not in the configured top-left corner: ${JSON.stringify(mobile.box)}`);
  assert(mobile.intro.includes(LOOK.overrides.intro), `the greeting was not the configured one: ${JSON.stringify(mobile.intro.slice(0, 120))}`);
  assert(mobile.quick.join('|') === LOOK.overrides.quickButtons.map((button) => button.text).join('|'), `the quick buttons were not the configured ones: ${JSON.stringify(mobile.quick)}`);
  pass('a 320x844 visit paints the saved look: colour, corners, clamped size, top-left corner, greeting and quick buttons');

  // A quick button is the visitor's own message: a real click on it, and the plugin records the turn with
  // exactly the button's text as what the visitor said.
  const quickButton = await page.evaluateHandle((text) => {
    const chatRoot = document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('deep-chat').shadowRoot;
    return [...chatRoot.querySelectorAll('.cb-quick-item')].find((button) => button.textContent === text) ?? null;
  }, QUICK_TEXT);
  await quickButton.asElement().click();
  const quickTurn = await poll('the quick button to become the visitor\'s own message', () => {
    const newest = recordedTurn();
    return newest !== null && newest.message === QUICK_TEXT ? newest : null;
  });
  assert(quickTurn !== null, 'the quick button sent nothing');
  const answered = await poll('the answer to the quick button', async () => {
    const state = await panelLook();
    return state.messages.some((message) => message.role === 'ai' && message.text === QUICK_ANSWER) ? state : null;
  });
  assert(answered.messages[0]?.role === 'user' && answered.messages[0].text === QUICK_TEXT, `the panel did not show the visitor's own words first: ${JSON.stringify(answered.messages)}`);
  assert(answered.userBubble === 'rgb(255, 209, 102)', `the visitor's bubble is not the configured colour: ${answered.userBubble}`);
  assert(answered.aiBubble === 'rgb(255, 255, 255)', `the chatbot's bubble is not the configured colour: ${answered.aiBubble}`);
  pass('a press on a quick button is sent as the visitor\'s own message, and both bubbles are the configured colours');

  // The mechanism the administrator's preview sizes the panel with: the panel clamps itself to the room it is
  // TOLD it has, which is what lets a preview show a real panel at its real size inside a modal.
  const staged = await page.evaluate(() => {
    const host = document.querySelector('[data-elowen-chatbot]');
    host.style.setProperty('--cb-avail-w', '300px');
    host.style.setProperty('--cb-avail-h', '260px');
    const box = host.shadowRoot.querySelector('.panel').getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  });
  assert(staged.width === 300 && staged.height === 260, `the panel did not clamp itself to the room it was given: ${JSON.stringify(staged)}`);
  pass('the panel clamps itself to the room it is given, which is how the administrator\'s preview sizes it');

  // A returning visitor also receives the saved look through bootstrap before the launcher appears;
  // only their already-held token is used to restore the transcript.
  await page.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false });
  const beforeReturn = visitorRows();
  hook.requests.length = 0;
  await page.reload({ waitUntil: 'load' });
  await poll('a returning bootstrap to finish', () => bootstrapReads().length === 1 && bootstrapReads()[0].status === 200);
  await page.waitForFunction(() => document.querySelector('[data-elowen-chatbot]') !== null, { timeout: 10_000 });
  assertBootstrapOnly(hook.requests.filter((entry) => entry.path !== '/hooks/chatbot/v2/conversation'));
  assert(hook.requests.every((entry) => [WIDGET_PATH, BOOTSTRAP_PATH, '/hooks/chatbot/v2/conversation'].includes(entry.path)),
    `a returning visit read an unexpected route: ${JSON.stringify(hook.requests)}`);
  assert(JSON.stringify(visitorRows()) === JSON.stringify(beforeReturn), 'returning bootstrap issued a visitor token or created a turn');
  assert(await launcherColour() === 'rgb(11, 110, 79)', `a returning launcher flashed an unconfigured colour: ${await launcherColour()}`);
  assert(!(await panelLook()).open, 'the returning visit opened the panel on its own');
  await openPanel();
  const desktop = await poll('the transcript to come back into the configured panel', async () => {
    const state = await panelLook();
    return state.messages.length >= 2 ? state : null;
  });
  assert(desktop.box.width === 420 && desktop.box.height === 560, `the panel is not its configured size on a desktop viewport: ${JSON.stringify(desktop.box)}`);
  assert(desktop.box.left === 20 && desktop.box.top === 88, `the panel is not anchored in the configured corner: ${JSON.stringify(desktop.box)}`);
  assert(desktop.background === 'rgb(16, 24, 32)', `the restored panel was not painted the configured colour: ${desktop.background}`);
  assert(desktop.messages.some((message) => message.text === QUICK_TEXT), `the returning visit lost the visitor's own message: ${JSON.stringify(desktop.messages)}`);
  pass('a returning visitor at 1440x900 gets the look before the panel is opened, at its configured 420x560, with the transcript restored into it');

  // The real file picker sends an image-only turn through the streamed upload route, the durable event log,
  // authenticated downloads and the panel. This follows a conversation with earlier visitor text.
  // The throwaway hook is HTTP/1. Chrome only transports streaming fetch over HTTP/2, so model a browser
  // without request-stream support and exercise the widget's single-attempt File upload path here.
  await page.evaluate(() => {
    const BrowserRequest = window.Request;
    window.Request = class extends BrowserRequest {
      constructor(url, options) {
        if (options?.body instanceof ReadableStream && options?.duplex === 'half') throw new TypeError('request streaming unavailable');
        super(url, options);
      }
    };
  });
  const attachmentPicker = await page.evaluateHandle(() => document.querySelector('[data-elowen-chatbot]').shadowRoot
    .querySelector('deep-chat').shadowRoot.querySelector('.input-button:has(#upload-images-icon)'));
  const choosingImage = page.waitForFileChooser();
  await attachmentPicker.asElement().click();
  await (await choosingImage).accept([imagePath]);
  await page.waitForFunction(() => document.querySelector('[data-elowen-chatbot]').shadowRoot
    .querySelector('deep-chat').shadowRoot.querySelector('.input-button.inside-end:not(.custom-button):not(.disabled-button)'));
  const sendImage = await page.evaluateHandle(() => document.querySelector('[data-elowen-chatbot]').shadowRoot
    .querySelector('deep-chat').shadowRoot.querySelector('.input-button.inside-end:not(.custom-button):not(.disabled-button)'));
  await sendImage.asElement().click();
  const attachmentTurnId = await poll('the image-only turn to finish', () => {
    const receipt = db.prepare('SELECT turn_id FROM p_chatbot_upload_receipts WHERE turn_id IS NOT NULL LIMIT 1').get();
    const turn = receipt ? store.turn(receipt.turn_id) : null;
    return turn?.status === 'done' ? turn.turn_id : null;
  });
  const attachmentTurn = store.turn(attachmentTurnId);
  assert(attachmentTurn.message === '' && attachmentTurn.core_session_id === coreSessionId,
    `the uploaded image was not an image-only turn bound to its session: ${JSON.stringify(attachmentTurn)}`);
  assert(store.attachmentEventsOf(attachmentTurnId).length === 2, 'the two shared attachments were not durable');
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('deep-chat').shadowRoot;
    return root.querySelectorAll('.cb-shared-file a[href^="blob:"]').length === 2
      && root.querySelector('.cb-shared-file img')?.naturalWidth === 1;
  });
  await page.screenshot({ path: '/tmp/chatbot-live-attachments-1440.png' });
  assert(hook.requests.some(entry => entry.path.startsWith('/hooks/chatbot/v2/uploads?') && entry.method === 'POST'), 'the picker never called the upload route');
  assert(hook.requests.filter(entry => entry.path.includes(`/turns/${attachmentTurnId}/files/`) && entry.method === 'GET').length === 2,
    'the widget did not fetch both attachments using its visitor token');
  pass('the browser uploads an image-only turn after history and fetches both shared attachments with its visitor token');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('[data-elowen-chatbot]')?.shadowRoot?.querySelector('.launcher'));
  await page.evaluate(() => document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('.launcher').click());
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('deep-chat').shadowRoot;
    return root.querySelectorAll('.cb-shared-file a[href^="blob:"]').length === 2;
  });
  pass('a reload restores the visitor upload and both authorized shared downloads');

  // An unreadable stored look is a refusal, not permission to flash a default launcher or create a visitor.
  // The failed bootstrap produces one expected browser error; no panel is attached.
  const errorsBefore = consoleErrors.length;
  db.prepare('UPDATE p_chatbot_bots SET appearance = ? WHERE chatbot_user_id = ?')
    .run(JSON.stringify({ ...selectAppearanceTemplate('elowen'), schemaVersion: 9 }), CHATBOT_ACCOUNT);
  const beforeRefusal = visitorRows();
  await freshVisit(1440, 900, false);
  await poll('the refusal of a look its own row could not produce', () => hook.warnings.some((warning) => warning.includes('unreadable appearance')));
  await poll('the refused bootstrap response', () => bootstrapReads().length === 1 && bootstrapReads()[0].status === 503);
  assert(hook.requests.every((entry) => [WIDGET_PATH, BOOTSTRAP_PATH].includes(entry.path)),
    `the refused look made another public request: ${JSON.stringify(hook.requests)}`);
  await assertNoNewVisitorState(beforeRefusal);
  assert(!(await panel()).mounted, 'a refused look attached a default panel or launcher');
  await poll('the browser to report the refused bootstrap', () => consoleErrors.slice(errorsBefore).some((message) => message.includes('503')));
  const added = consoleErrors.slice(errorsBefore);
  assert(added.length === 1 && added[0].includes('503'), `the refusal put something other than itself in the console: ${JSON.stringify(added)}`);
  consoleErrors.length = errorsBefore;
  pass('an unreadable look is refused at bootstrap without attaching a panel or issuing visitor state');

  // ── the gates ─────────────────────────────────────────────────────────────────────────────────────────
  assert(hook.allRequests.every((entry) => entry.path !== '/hooks/chatbot/v2/appearance'),
    'the widget read the removed appearance route');
  assert(consoleErrors.length === 0, `the page logged console errors: ${JSON.stringify(consoleErrors)}`);
  assert(external.length === 0, `the widget reached outside the page and the hook: ${JSON.stringify(external)}`);
  pass('no console error, and no request beyond the customer\'s origin and the hook');

  console.log(`\nchatbot page-action e2e: ${passes.length}/${passes.length} flows verified in a real browser`);
} catch (error) {
  // A failing scenario has to say WHAT the plugin and the widget were doing, or the only way to find out is
  // to run it again with prints added to the very code under test.
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  console.error('what the run saw:', JSON.stringify({
    requests: hook.requests,
    eventsRequests: hook.eventsRequests,
    sequence: hook.sequence,
    cuts: hook.cuts,
    actions: hook.actions,
    warnings: hook.warnings,
    submissions: site.submissions.length,
    storedActions: db.prepare('SELECT action, status, result_json FROM p_chatbot_actions').all(),
  }, null, 2));
  const state = page === null ? null : await page.evaluate(() => {
    const root = document.querySelector('[data-elowen-chatbot]')?.shadowRoot ?? null;
    const chat = root?.querySelector('deep-chat') ?? null;
    return {
      panelOpen: root?.querySelector('.panel')?.hidden === false,
      confirm: root?.querySelector('.confirm')?.hidden === false,
      messages: chat ? chat.getMessages() : null,
      panelText: root?.textContent?.slice(0, 400) ?? null,
      chatText: chat?.shadowRoot?.textContent?.slice(0, 400) ?? null,
    };
  });
  console.error('what the panel showed:', JSON.stringify(state, null, 2));
  console.error('console errors:', JSON.stringify(consoleErrors, null, 2));
  console.error('console log:', JSON.stringify(allConsole.slice(-30), null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close();
  hookServer.close();
  siteServer.close();
  unlinkSync(imagePath);
  rmdirSync(fixtureDirectory);
}
