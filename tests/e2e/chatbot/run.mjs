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
//   1. nothing at all is sent before the visitor writes, and the page state then travels with the message;
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
//   8. no console error, and no request anywhere except the customer's origin and the hook's.
//
// Run with: node tests/e2e/chatbot/run.mjs  (npm run test:e2e:chatbot)
// Throwaway servers only: ephemeral loopback ports, an in-memory database, no production service or port.
//
// The plugin is loaded from `dist/`, not from `src/`: the daemon loads the built artifact, so this is what an
// installed instance actually serves, and `npm run check:dist` is what keeps it matching its source.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';
import { ChatbotAdapter } from '../../../plugins/chatbot/dist/adapter.js';
import { PageActionService } from '../../../plugins/chatbot/dist/actionService.js';
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
const WIDGET_PATH = '/hooks/chatbot/v1/widget.js';
const MOUNT_PREFIX = '/hooks/chatbot/v1/';
const PAGE_STATE_LABEL = 'Untrusted page state:\n';
const VISITOR_MESSAGE_LABEL = 'Visitor message:\n';
const VISITOR_TEXT = 'Pomozte mi prosím vyplnit formulář.';
const ANSWER_PARTS = ['Dobrý den, ', 'vyplním to s vámi. ', 'E-mail jsem doplnil, odešlete prosím žádost.'];
const ANSWER = ANSWER_PARTS.join('');
const FILLED_EMAIL = 'jan.novak@example.cz';
const SECRET_PASSWORD = 'TajneHeslo123';
const SECRET_CARD = '4111111111111111';

/** The limit set this chatbot is configured with, complete because a chatbot cannot be enabled without one:
 *  the plugin has no defaults, and the scenario wants turns to run rather than to be refused. */
const SCENARIO_LIMITS = {
  rateIpPerMinute: 120,
  rateChatbotPerMinute: 120,
  rateConversationPerMinute: 60,
  dailyTurnLimit: 500,
  dailyTokenLimit: null,
  dailyCostMicrousd: null,
  maxConcurrentTurns: 4,
  maxQueueDepth: 8,
  queueTimeoutSeconds: 60,
  maxActionsPerTurn: 8,
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
  eventsRequests: [],
  cuts: 0,
  cutNextStream: false,
  /** Ends the stream that is open right now, as a lost connection would. Set while one is being piped. */
  cutOpenStream: null,
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
const accounts = [{ id: CHATBOT_ACCOUNT, username: 'ured-bot', name: 'Městský úřad', avatar: '', isAdmin: false, type: 'chatbot' }];
const projects = [{ id: PROJECT_ID, slug: 'ured', path: '/ured', executionKind: 'managed', lifecycle: 'active' }];
const stores = {
  usersRead: {
    list: () => accounts,
    isAdmin: (id) => accounts.find((account) => account.id === id)?.isAdmin === true,
    allowedExecs: () => [],
    mayUsePlugin: () => true,
  },
  projects: { get: (id) => projects.find((project) => project.id === id) ?? null, list: () => projects },
  userProjects: { canAccess: () => true, canManage: () => true },
};
const warn = (message) => { hook.warnings.push(message); console.warn(`  [plugin] ${message}`); };
const broker = new TurnEventBroker(warn);
const adapter = new ChatbotAdapter(warn);
const now = () => new Date();
const actions = new PageActionService({ store, broker, now, info: () => undefined, warn });
const queue = new ChatbotTurnQueue({ store, adapter, broker, now: () => now().toISOString(), warn });

const bot = store.createBot({
  chatbotUserId: CHATBOT_ACCOUNT,
  publicId: PUBLIC_ID,
  displayName: 'Městský úřad',
  prompt: 'Pomáhej návštěvníkům s formulářem.',
  origins: [],
  // A chatbot serves under numbers its owner decided; the plugin has none of its own, and it refuses to serve
  // without them. The scenario writes a complete set, exactly as an administrator would have.
  limits: SCENARIO_LIMITS,
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
  hook.requests.push({ method: request.method, path: url.pathname + url.search, origin });

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
    json: async () => JSON.parse(raw.toString('utf8')),
    body: async () => raw,
  });
  return writeReply(response, reply);
}

/** The turn this run recorded, which is what the scripted model decides against. */
function recordedTurn() {
  const newest = db.prepare('SELECT turn_id FROM p_chatbot_turns ORDER BY created_at DESC, turn_id DESC LIMIT 1').get();
  return newest === undefined ? null : store.turn(newest.turn_id);
}

/** The page state as the widget composed it — what the MODEL sees in the visitor's message. */
function readRawPageState(message) {
  assert(typeof message === 'string' && message.includes(PAGE_STATE_LABEL), 'the visitor message carried no page state');
  return JSON.parse(message.slice(message.indexOf(PAGE_STATE_LABEL) + PAGE_STATE_LABEL.length));
}

/** The model of this scenario: an answer that streams, and the page actions a real one would ask for. */
async function modelTurn({ src, observer }) {
  currentVisitorId = src.userId;
  const turn = store.runningTurnOf(CHATBOT_ACCOUNT, src.userId);
  const asSeenByTheModel = readRawPageState(turn.message);
  // …and the same message as the PLUGIN reads it, because that is what every action below is decided
  // against. The two must agree on the snapshot and on the targets, or nothing else here means anything.
  const page = readRecordedPageState(turn.message);
  assert(page.ok, `the plugin could not read the page state its own widget composed: ${page.ok ? '' : page.error}`);

  const target = (what, predicate) => {
    const found = asSeenByTheModel.targets.find(predicate);
    assert(found, `the page state described no ${what}`);
    assert(page.value.targets.some((candidate) => candidate.id === found.id), `the plugin did not read ${what} as a target`);
    return found.id;
  };
  const jmeno = target('jméno field', (candidate) => candidate.name === 'jmeno');
  const email = target('e-mail field', (candidate) => candidate.name === 'email');
  const obec = target('obec select', (candidate) => candidate.name === 'obec');
  const card = target('card field', (candidate) => candidate.name === 'cislo_karty');
  const submit = target('submit button', (candidate) => candidate.tag === 'button' && candidate.type === 'submit');
  assert(asSeenByTheModel.targets.length === 6, `the sample form was described as ${asSeenByTheModel.targets.length} targets`);
  assert(submit !== undefined && card !== jmeno, 'the sample form was not described the way the visitor sees it');
  assert(
    asSeenByTheModel.targets.find((candidate) => candidate.id === card).caps.join() === 'focus',
    'the card field was described as writable',
  );

  const ask = (input) => registeredTool.execute(`call-${hook.actions.length + 1}`, { snapshotId: page.value.snapshotId, ...input });
  const record = async (what, input) => {
    const answer = await ask(input);
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
  broker,
  actions,
  pingIntervalMs: 15_000,
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
  prompt: 'Pomáhej návštěvníkům s formulářem.',
  origins: [siteOrigin],
  limits: SCENARIO_LIMITS,
  now: now().toISOString(),
});
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
  page = await browser.newPage();
  page.on('console', (message) => { allConsole.push(`${message.type()}: ${message.text()}`); if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http')) return;
    if (url.startsWith(siteOrigin) || url.startsWith(hookOrigin)) return;
    external.push(url);
  });

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

  await page.goto(FORM_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ElowenChatbot !== undefined, { timeout: 10_000 });
  // The visitor fills in their OWN form before opening the chat, so the description that travels with their
  // message carries a real value — and a secret that must not travel with it.
  await page.type('#jmeno', 'Jan Novák');
  await page.type('#heslo', SECRET_PASSWORD);
  await page.type('#karta', SECRET_CARD);
  await sleep(400);

  const beforeWriting = hook.requests.filter((entry) => entry.path !== WIDGET_PATH);
  assert(beforeWriting.length === 0, `the widget called the hook before the visitor wrote: ${JSON.stringify(beforeWriting)}`);
  pass('nothing is sent to the hook before the visitor writes');

  // ── flow 1: the first message carries a bounded description of the page ───────────────────────────────
  const launcher = await page.evaluateHandle(() => document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('.launcher'));
  await launcher.asElement().click();
  assert((await panel()).open, 'the panel did not open on a click of the launcher');
  await page.evaluate(() => document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('deep-chat').focusInput());
  await page.keyboard.type(VISITOR_TEXT);
  hook.cutNextStream = true;
  await page.keyboard.press('Enter');

  const turn = await poll('the visitor message to reach the plugin', () => recordedTurn());
  hook.turnId = turn.turn_id;
  const composed = turn.message;
  const pageState = readRawPageState(composed);
  assert(composed.startsWith(`${VISITOR_MESSAGE_LABEL}${VISITOR_TEXT}`), `the visitor's own words were not first in the message: ${composed.slice(0, 90)}`);
  assert(composed.includes('Jan Novák'), 'the page state did not carry the value the visitor typed into the page');
  assert(!composed.includes(SECRET_PASSWORD), 'the password the visitor typed travelled to the server');
  assert(!composed.includes(SECRET_CARD), 'the card number the visitor typed travelled to the server');
  assert(pageState.headings.some((heading) => heading.text === 'Kontaktní formulář'), 'the page state carried no heading');
  assert(pageState.forms.length === 1 && pageState.forms[0].action === `${siteOrigin}/odeslat`, `the form was not described by origin and path: ${JSON.stringify(pageState.forms)}`);
  assert(!pageState.url.includes('zdroj=web'), 'the page state carried the page query string');
  pass('the first message carries the page state, without the password or the card number');

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
  await poll('the agent to scroll the page', async () => page.evaluate(() => window.scrollY > 0));
  assert(actionOf('scroll').status === 'done', `the scroll failed: ${JSON.stringify(actionOf('scroll'))}`);
  assert(actionOf('scroll').targetId === null, `a page scroll carried a target: ${JSON.stringify(actionOf('scroll'))}`);
  pass('read, fill, select and a target-less scroll all happened on the page, each reported done');

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
  // The only click action this run ever recorded is the one the scenario wrote as a compromised server: the
  // plugin itself approved none, which is what "a submit can never be an ordinary click" means on the wire.
  const clickRows = db.prepare('SELECT id FROM p_chatbot_actions WHERE action = ?').all('click');
  assert(
    clickRows.length === 1 && clickRows[0].id === hook.hostileActionId,
    `the plugin approved ${clickRows.length} click action(s) of its own: ${JSON.stringify(clickRows)}`,
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
  assert(hook.actions.length === 8, `the model asked for ${hook.actions.length} actions, not the eight this scenario scripts`);
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
  assert(!JSON.stringify(restored).includes('Untrusted page state'), 'the restored transcript carried the page state into the conversation');
  assert(restored.some((message) => message.role === 'ai' && message.text === ANSWER), 'the restored transcript lost the answer');
  // Drawing the transcript must not ASK for anything. Re-submitting the visitor's own restored message would
  // be a second turn of the same words — the same question asked of the model again, on every reload.
  const submittedTurns = hook.requests.filter((entry) => entry.method === 'POST' && entry.path === '/hooks/chatbot/v1/turns');
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
    await page.waitForFunction(() => window.ElowenChatbot !== undefined, { timeout: 10_000 });
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

  // ── the gates ─────────────────────────────────────────────────────────────────────────────────────────
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
}
