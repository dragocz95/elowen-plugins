#!/usr/bin/env node
// The chatbot widget in a REAL browser, on a page that belongs to somebody else.
//
// There is no daemon in this scenario, and that is deliberate: what is verified here is the CLIENT half of
// the plugin and the protocol it speaks, and no daemon can emit page actions yet — the model-driven half
// that asks for one is not built. So this scenario stands up the two things the widget actually talks to:
//
//   * the CUSTOMER'S SITE, a second origin, serving form.html — a heading, a form, a password field and a
//     card-like field, and a submit endpoint that records what it received;
//   * a deployment STAND-IN on the hook's own origin, serving the built `embed/widget.v1.js` exactly as the
//     plugin serves it (`v1/widget.js`), the public v1 surface with CORS and a preflight, and a scripted
//     turn whose event log carries text deltas and three server-approved actions.
//
// Everything else is real: a real Chrome, real shadow DOM, real clicks and keyboard events, real
// cross-origin requests, and a real form submission. What the scenario asserts:
//
//   1. nothing at all is sent before the visitor writes, and the page state then travels with the message;
//   2. the answer streams into the panel and ends with the whole of it;
//   3. a stream cut mid-answer is resumed from the last frame the visitor saw, with no doubled text;
//   4. an approved action lands on the page (the agent filled a field);
//   5. a click on the submit button is REFUSED, and the form goes out only after a real pointer click on the
//      panel's confirm button — including a synthetic click on that very button, which must decide nothing;
//   6. a reload restores the transcript from the visitor's own conversation, with the page state stripped;
//   7. no console error, and no request anywhere except the customer's origin and the hook's.
//
// Run with: node tests/e2e/chatbot/run.mjs  (npm run test:e2e:chatbot)
// Throwaway servers only: ephemeral loopback ports, no production service, database or port involved.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.E2E_BROWSER_PATH ?? '/usr/bin/google-chrome';
const PLUGIN_ROOT = new URL('../../../plugins/chatbot/', import.meta.url);
const PUBLIC_ID = 'cbt_0123456789abcdef01234567';
const WIDGET_PATH = '/hooks/chatbot/v1/widget.js';
const PAGE_STATE_LABEL = 'Untrusted page state:\n';
const VISITOR_MESSAGE_LABEL = 'Visitor message:\n';
const VISITOR_TEXT = 'Pomozte mi prosím vyplnit formulář.';
const ANSWER = 'Dobrý den, vyplním to s vámi. E-mail jsem doplnil, odešlete prosím žádost.';
const ANSWER_PARTS = ['Dobrý den, ', 'vyplním to s vámi. '];
const FILLED_EMAIL = 'jan.novak@example.cz';
const SECRET_PASSWORD = 'TajneHeslo123';
const SECRET_CARD = '4111111111111111';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function poll(description, fn, timeoutMs = 10_000, intervalMs = 40) {
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

/** Everything the deployment stand-in saw, and everything it will say. */
const hook = {
  requests: [],
  published: [],
  turnId: 'T-1',
  snapshot: null,
  composed: null,
  eventsRequests: [],
  written: [],
  results: [],
  decisions: [],
  streamed: false,
  cutNextStream: false,
  streamWasCut: false,
};

function json(response, status, body, origin) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  });
  response.end(JSON.stringify(body));
}

const frame = (type, seq, data) => `${JSON.stringify({ schemaVersion: 1, turnId: hook.turnId, seq, type, data })}\n`;

/** The page state out of a composed visitor message: the JSON the widget appended and nothing else. */
function readPageState(message) {
  const index = message.indexOf(PAGE_STATE_LABEL);
  assert(index !== -1, 'the visitor message carried no page state');
  return JSON.parse(message.slice(index + PAGE_STATE_LABEL.length));
}

/** The events of the turn, built from the description the visitor's OWN message carried — which is what a
 *  real server would decide against, and the reason the ids below are the ones the page really issued. */
function turnScript() {
  const targets = hook.snapshot.targets;
  const email = targets.find((target) => target.name === 'email');
  const card = targets.find((target) => target.name === 'cislo_karty');
  const submit = targets.find((target) => target.tag === 'button' && target.type === 'submit');
  assert(email, 'the page description carried no e-mail field');
  assert(card, 'the page description carried no card field');
  assert(submit, 'the page description carried no submit button');
  assert(submit.caps.includes('request_submit'), 'the submit button was not described as submit-capable');
  assert(!submit.caps.includes('click'), 'the submit button was described as clickable');
  assert(card.value === undefined && card.caps.join() === 'focus', `the card field was described as ${JSON.stringify(card)}`);

  const action = (seq, kind, targetId, extra) => ({
    seq,
    type: 'action',
    data: {
      actionId: randomUUID(),
      kind,
      targetId,
      value: null,
      snapshotId: hook.snapshot.snapshotId,
      requiresConfirmation: false,
      confirmationNonce: `nonce-${seq}-0001`,
      ...extra,
    },
  });

  return [
    { seq: 1, type: 'accepted', data: {} },
    { seq: 2, type: 'text_delta', data: { text: ANSWER_PARTS[0] } },
    { seq: 3, type: 'text_delta', data: { text: ANSWER_PARTS[1] } },
    action(4, 'fill', email.id, { value: FILLED_EMAIL }),
    // A generic click on the submit button: the widget must refuse it outright.
    action(5, 'click', submit.id, {}),
    // …and the kind that does submit, which the visitor answers themselves.
    action(6, 'request_submit', submit.id, { requiresConfirmation: true }),
    { seq: 7, type: 'done', data: { text: ANSWER } },
  ];
}

/** Publish the rest of the turn off the request path, with a beat between frames so the streaming is
 *  observable rather than instantaneous. */
async function publish(script) {
  await sleep(150);
  for (const entry of script.slice(2)) {
    hook.published.push(entry);
    await sleep(entry.type === 'text_delta' ? 300 : 150);
  }
  hook.streamed = true;
}

/** One turn's NDJSON stream. Frames the caller has already rendered are never sent twice: `after` is a
 *  cursor, not a hint. */
function streamTurn(response, origin, after) {
  let cursor = after;
  const deadline = Date.now() + 15_000;
  const writeFrame = (entry) => {
    hook.written.push(`${entry.seq}:${entry.type}`);
    cursor = entry.seq;
    response.write(frame(entry.type, entry.seq, entry.data));
    return entry.type === 'done' || entry.type === 'error';
  };
  response.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': origin ?? '*',
    vary: 'Origin',
  });

  // A cut connection: the first stream of the turn ends after the first delta, so the rest of the answer is
  // only reachable by reconnecting with the cursor the visitor's panel has.
  if (hook.cutNextStream) {
    hook.cutNextStream = false;
    hook.streamWasCut = true;
    hook.written.push('1:accepted', '2:text_delta');
    response.write(frame('accepted', 1, {}));
    response.write(frame('text_delta', 2, { text: ANSWER_PARTS[0] }));
    setTimeout(() => response.end(), 80);
    return;
  }

  const tick = () => {
    if (response.writableEnded) return;
    for (const entry of hook.published) {
      if (entry.seq <= cursor) continue;
      if (writeFrame(entry)) return response.end();
    }
    const last = hook.published.at(-1)?.seq ?? 0;
    if (hook.streamed && cursor >= last) return response.end();
    if (Date.now() > deadline) return response.end();
    setTimeout(tick, 40);
  };
  tick();
}

/** A request body, read the way the sender said it was encoded: the widget posts JSON, the form posts
 *  url-encoded fields, and a stand-in that guessed one of those would silently see an empty body. */
function readBody(request) {
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      if (raw === '') return resolve({});
      const type = String(request.headers['content-type'] ?? '');
      if (type.includes('application/x-www-form-urlencoded')) {
        return resolve(Object.fromEntries(new URLSearchParams(raw)));
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

const FILE_URL = (relative) => fileURLToPath(new URL(relative, PLUGIN_ROOT));

async function hookHandler(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const origin = request.headers.origin;
  hook.requests.push({ method: request.method, path: url.pathname + url.search, origin });

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

  // The widget bundle, exactly as the plugin's public hook serves it.
  if (request.method === 'GET' && url.pathname === WIDGET_PATH) {
    response.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300, must-revalidate',
    });
    return response.end(readFileSync(FILE_URL('embed/widget.v1.js')));
  }

  const body = await readBody(request);

  if (url.pathname.endsWith('/visitors')) {
    return json(response, 200, { schemaVersion: 1, token: 'visitor-token-1', visitorId: 'visitor-1', expiresAt: '2099-01-01T00:00:00.000Z' }, origin);
  }
  if (url.pathname.endsWith('/visitors/refresh')) {
    return json(response, 200, { schemaVersion: 1, token: 'visitor-token-2', visitorId: 'visitor-1', expiresAt: '2099-01-01T00:00:00.000Z' }, origin);
  }
  if (request.method === 'POST' && url.pathname.endsWith('/turns')) {
    hook.composed = body.message;
    hook.snapshot = readPageState(body.message);
    void publish(turnScript());
    return json(response, 202, { schemaVersion: 1, turnId: hook.turnId, status: 'queued', lastSeq: 0 }, origin);
  }
  if (request.method === 'GET' && url.pathname.endsWith('/events')) {
    const after = Number(url.searchParams.get('after') ?? '0');
    hook.eventsRequests.push(after);
    return streamTurn(response, origin, after);
  }
  if (request.method === 'GET' && url.pathname.endsWith('/conversation')) {
    const turns = hook.composed === null ? [] : [{
      turnId: hook.turnId,
      clientTurnId: 'client-turn-1',
      status: hook.streamed ? 'done' : 'running',
      lastSeq: hook.streamed ? 7 : 2,
      message: hook.composed,
      reply: hook.streamed ? ANSWER : null,
      errorCode: null,
    }];
    return json(response, 200, { schemaVersion: 1, activeTurnId: null, truncated: false, turns }, origin);
  }
  if (request.method === 'POST' && url.pathname.endsWith('/result')) {
    hook.results.push(body);
    return json(response, 200, { schemaVersion: 1 }, origin);
  }
  if (request.method === 'POST' && url.pathname.endsWith('/confirmation')) {
    hook.decisions.push(body);
    return json(response, 200, { schemaVersion: 1 }, origin);
  }
  return json(response, 404, { error: 'not_found' }, origin);
}

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
    site.submissions.push({ query: url.search, ...(await readBody(request)) });
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
  consoleErrors = [];
  external = [];
  allConsole = [];
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

  await poll('the visitor message to reach the hook', () => hook.composed !== null);
  assert(hook.composed.startsWith(`${VISITOR_MESSAGE_LABEL}${VISITOR_TEXT}`), `the visitor's own words were not first in the message: ${hook.composed.slice(0, 90)}`);
  assert(hook.composed.includes(PAGE_STATE_LABEL), 'the message carried no page state');
  assert(hook.composed.includes('Jan Novák'), 'the page state did not carry the value the visitor typed into the page');
  assert(!hook.composed.includes(SECRET_PASSWORD), 'the password the visitor typed travelled to the server');
  assert(!hook.composed.includes(SECRET_CARD), 'the card number the visitor typed travelled to the server');
  assert(hook.snapshot.headings.some((heading) => heading.text === 'Kontaktní formulář'), 'the page state carried no heading');
  assert(hook.snapshot.forms.length === 1 && hook.snapshot.forms[0].action === `${siteOrigin}/odeslat`, `the form was not described by origin and path: ${JSON.stringify(hook.snapshot.forms)}`);
  assert(!hook.snapshot.url.includes('zdroj=web'), 'the page state carried the page query string');
  pass('the first message carries the page state, without the password or the card number');

  // ── flow 2: the answer streams into the panel ─────────────────────────────────────────────────────────
  const seen = new Set();
  const statuses = new Set();
  await poll('the answer to stream into the panel', async () => {
    const state = await panel();
    seen.add(answerText(state));
    if (state.status !== '') statuses.add(state.status);
    return answerText(state) === ANSWER;
  }, 15_000);
  assert(
    [...seen].some((text) => text.length > 0 && text.length < ANSWER.length),
    `the panel never showed a partial answer, so nothing streamed: ${JSON.stringify([...seen].slice(-4))}`,
  );
  pass(`the answer streams in and ends complete (${seen.size} states seen, ${[...seen].at(-1).length} characters)`);

  // ── flow 3: a stream cut mid-answer is resumed, not repeated ──────────────────────────────────────────
  await poll('the widget to reconnect', () => hook.eventsRequests.length >= 2);
  assert(hook.streamWasCut, 'the first stream was not cut, so no reconnect was exercised');
  assert(hook.eventsRequests[1] > 0, `the reconnect asked for the whole turn again (after=${hook.eventsRequests[1]})`);
  // The reconnection is said in the panel's own status line, not as a message in the transcript: the panel
  // states collected while the answer arrived are what is asserted, because the line clears itself once the
  // answer is complete.
  assert(
    [...statuses].some((status) => status.includes('připojit')),
    `the panel never announced the reconnection: ${JSON.stringify([...statuses])}`,
  );
  const afterReconnect = answerText(await panel());
  assert(afterReconnect === ANSWER, `the reconnect left the visitor with a wrong answer: ${afterReconnect}`);
  pass(`a stream cut mid-answer resumed from the last rendered frame (after=${hook.eventsRequests[1]}) with no doubled text`);

  // ── flow 4: an action the server approved lands on the page ───────────────────────────────────────────
  await poll('the agent to fill the e-mail field', async () => page.$eval('#email', (input) => input.value === 'jan.novak@example.cz'));
  const email = hook.snapshot.targets.find((target) => target.name === 'email');
  assert(email.caps.includes('fill'), `the e-mail field was not described as fillable: ${JSON.stringify(email)}`);
  await poll('the fill to be reported', () => hook.results.some((result) => result.outcome === 'done'));
  pass('the agent filled a field on the page and reported the outcome');

  // ── flow 5: a submit is refused as a click, and needs the visitor's own click ─────────────────────────
  const refusal = await poll('the refused click to be reported', () => hook.results.find((result) => result.outcome === 'denied'));
  assert(refusal.detail === 'submit_is_its_own_action', `a click on the submit button was refused for the wrong reason: ${JSON.stringify(refusal)}`);
  assert(site.submissions.length === 0, 'the form was sent by a generic click');

  await poll('the confirmation to be asked', async () => (await panel()).confirmVisible);
  const asked = await panel();
  assert(asked.confirmTitle.includes('Odeslat formulář'), `the confirmation asked nothing recognisable: ${asked.confirmTitle}`);
  assert(site.submissions.length === 0, 'the form was sent before the visitor answered');

  // A page can dispatch a click on that very button. It must decide nothing: not a submit, and not a decline
  // either, because the question belongs to the visitor.
  await page.evaluate(() => document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('.confirm-yes').click());
  await sleep(400);
  assert(hook.decisions.length === 0, 'a click the page dispatched itself answered the confirmation');
  assert(site.submissions.length === 0, 'a click the page dispatched itself sent the form');
  assert((await panel()).confirmVisible, 'a click the page dispatched itself dismissed the question');
  pass('a synthetic click on the confirm button confirmed nothing and sent nothing');

  const confirmButton = await page.evaluateHandle(() => document.querySelector('[data-elowen-chatbot]').shadowRoot.querySelector('.confirm-yes'));
  await confirmButton.asElement().click();
  await poll('the confirmation to be recorded', () => hook.decisions.length > 0);
  assert(hook.decisions[0].decision === 'confirm', `the decision recorded was not a confirmation: ${JSON.stringify(hook.decisions[0])}`);
  await poll('the form to be sent', () => site.submissions.length > 0, 10_000);
  const submitted = site.submissions[0];
  assert(submitted.jmeno === 'Jan Novák', `the submitted form lost the visitor's own value: ${JSON.stringify(submitted)}`);
  assert(submitted.email === FILLED_EMAIL, `the submitted form did not carry what the agent filled in: ${JSON.stringify(submitted)}`);
  assert(submitted.query === '?zdroj=web', `the form was not submitted through its own action: ${JSON.stringify(submitted.query)}`);
  await poll('the submit to be reported', () => hook.results.length >= 3);
  assert(hook.results.at(-1).outcome === 'done', `the submit reported ${JSON.stringify(hook.results.at(-1))}`);
  pass('the visitor\'s own click on the confirmation is what sent the form');

  // ── flow 6: a reload restores the conversation, without the page state ────────────────────────────────
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
  pass('a reload restores the conversation from the visitor\'s own projection, with the page state stripped');

  // ── the gates ─────────────────────────────────────────────────────────────────────────────────────────
  assert(consoleErrors.length === 0, `the page logged console errors: ${JSON.stringify(consoleErrors)}`);
  assert(external.length === 0, `the widget reached outside the page and the hook: ${JSON.stringify(external)}`);
  pass('no console error, and no request beyond the customer\'s origin and the hook');

  console.log(`\nchatbot widget e2e: ${passes.length}/${passes.length} flows verified in a real browser`);
} catch (error) {
  // A failing scenario has to say WHAT the widget was doing, or the only way to find out is to run it again
  // with prints added to the very code under test.
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  console.error('what the stand-in saw:', JSON.stringify({
    requests: hook.requests,
    eventsRequests: hook.eventsRequests,
    written: hook.written,
    results: hook.results,
    decisions: hook.decisions,
    streamed: hook.streamed,
    published: hook.published.map((entry) => `${entry.seq}:${entry.type}`),
    submissions: site.submissions.length,
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
