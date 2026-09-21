// @vitest-environment-options {"url": "https://example.test/formular"}
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MESSAGE_MAX_BYTES,
  PAGE_SNAPSHOT_MAX_ELEMENTS,
  VISITOR_TEXT_MAX_BYTES,
} from '../plugins/chatbot/src/publicContract.js';
import {
  actionDecisionBody,
  composeMessage,
  newClientTurnId,
  newSnapshotId,
  parseFrame,
  readActionFrame,
  readLines,
  readVisitorText,
  turnRequestBody,
  visitorRequestBody,
} from '../plugins/chatbot/embed-src/protocol.js';
import { capturePageSnapshot, isSensitiveField, wouldSubmit } from '../plugins/chatbot/embed-src/pageSnapshot.js';
import { ChatSession, type ChatView, type PageBridge } from '../plugins/chatbot/embed-src/session.js';
import { ChatPanel } from '../plugins/chatbot/embed-src/chatPanel.js';
import { widgetStrings } from '../plugins/chatbot/embed-src/strings.js';

/** The widget's own half of the protocol, and the two things it promises a customer's page: that a
 *  description of that page is bounded and free of what must not leave it, and that nothing irreversible
 *  happens to it without the visitor's own click. */

// deep-chat renders the messages; it is not what is under test here, and its bundle is a browser artifact.
vi.mock('deep-chat', () => {
  class StubChat extends HTMLElement {
    history: unknown[] = [];
    getMessages(): { role?: string; text?: string }[] { return this._messages; }
    addMessage(message: { role?: string; text?: string }): void { this._messages.push(message); }
    updateMessage(message: { text?: string }, index: number): void { this._messages[index] = { role: 'ai', ...message }; }
    submitUserMessage(content: { text?: string }): void { this._messages.push({ role: 'user', text: content.text }); }
    focusInput(): void { /* no focus in jsdom */ }
    private readonly _messages: { role?: string; text?: string }[] = [];
  }
  if (!customElements.get('deep-chat')) customElements.define('deep-chat', StubChat);
  return { DeepChat: StubChat };
});

const strings = widgetStrings('cs');

/** Give the session the turns it needs to reach its next await, without waiting on real time. */
async function flush(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
}

function frame(type: string, data: Record<string, unknown> = {}, seq = 1): string {
  return `${JSON.stringify({ schemaVersion: 1, turnId: 'T', seq, type, data })}\n`;
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** A stream that carries its chunks and then fails on the read after them, which is what a dropped
 *  connection looks like: what arrived before the drop arrived, and the connection ends instead of closing. */
function brokenStreamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]!));
        index += 1;
        return;
      }
      controller.error(new Error('connection lost'));
    },
  });
}

interface ViewLog {
  view: ChatView;
  restored: { role: string; text: string }[];
  answers: string[];
  notices: string[];
  errors: string[];
  confirmRequests: string[];
}

function makeView(confirmAnswer: boolean | (() => Promise<boolean>) = false): ViewLog {
  const log: ViewLog = {
    restored: [],
    answers: [],
    notices: [],
    errors: [],
    confirmRequests: [],
    view: undefined as unknown as ChatView,
  };
  log.view = {
    appendVisitor: () => undefined,
    beginAnswer: () => { log.answers.push(''); },
    streamAnswer: (text) => { log.answers[log.answers.length - 1] = (log.answers[log.answers.length - 1] ?? '') + text; },
    finishAnswer: (text) => { log.answers[log.answers.length - 1] = text; },
    notice: (text) => { log.notices.push(text); },
    error: (text) => { log.errors.push(text); },
    restore: (messages) => { log.restored.push(...messages); },
    confirm: (request) => {
      log.confirmRequests.push(request.title);
      return typeof confirmAnswer === 'function' ? confirmAnswer() : Promise.resolve(confirmAnswer);
    },
  };
  return log;
}

const PAGE_JSON = '{"url":"https://www.example.cz/formular","targets":[{"id":"e0","caps":["read","fill"]}]}';

interface PageLog {
  bridge: PageBridge;
  captures: number;
  performed: { snapshotId: string; kind: string; value: string | null }[];
  submitted: string[];
  holds: boolean;
}

function makePage(options: { holds?: boolean } = {}): PageLog {
  const log: PageLog = {
    captures: 0,
    performed: [],
    submitted: [],
    holds: options.holds ?? true,
    bridge: undefined as unknown as PageBridge,
  };
  const snapshotId = 's0123456789abcdef';
  log.bridge = {
    capture: () => {
      log.captures += 1;
      return {
        snapshotId,
        json: PAGE_JSON,
        targets: [
          { id: 'e0', caps: ['read', 'fill'] },
          { id: 'e1', caps: ['focus', 'request_submit'] },
        ],
      };
    },
    holds: () => log.holds,
    describeTarget: () => 'Kontaktní formulář',
    perform: (id, action) => {
      log.performed.push({ snapshotId: id, kind: action.kind, value: action.value });
      return Promise.resolve({ outcome: 'done' as const });
    },
    submit: (_id, targetId) => {
      log.submitted.push(targetId);
      return Promise.resolve({ outcome: 'done' as const });
    },
  };
  return log;
}

interface Harness {
  requests: { method: string; url: string; body: Record<string, unknown> | null }[];
  session: ChatSession;
}

function makeSession(input: {
  view: ViewLog;
  page: PageLog;
  responses: (request: { method: string; url: string; attempt: number }) => Response | Promise<Response>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}): Harness {
  const requests: Harness['requests'] = [];
  // Counted per ENDPOINT rather than per URL: a reconnect asks the same endpoint with a different cursor,
  // and a test that wants to answer the second ask differently has to see both as one endpoint.
  const attempts = new Map<string, number>();
  const fetchLike = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const key = `${method} ${String(url).split('?')[0]}`;
    const attempt = attempts.get(key) ?? 0;
    attempts.set(key, attempt + 1);
    requests.push({ method, url: String(url), body });
    return input.responses({ method, url: String(url), attempt });
  }) as unknown as typeof fetch;

  return {
    requests,
    session: new ChatSession({
      baseUrl: 'https://elowen.example/hooks/chatbot/v1',
      publicId: 'cbt_0123456789abcdef01234567',
      view: input.view.view,
      page: input.page.bridge,
      fetch: fetchLike,
      storage: input.storage ?? null,
      strings,
      sleep: () => Promise.resolve(),
    }),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('the wire protocol', () => {
  it('reads a frame and ignores anything it cannot vouch for', () => {
    expect(parseFrame(frame('text_delta', { text: 'Ahoj' }, 3))).toEqual({
      type: 'text_delta',
      turnId: 'T',
      seq: 3,
      data: { text: 'Ahoj' },
    });
    expect(parseFrame('not json')).toBeNull();
    expect(parseFrame('{"schemaVersion":2,"type":"done"}')).toBeNull();
    expect(parseFrame('{"schemaVersion":1,"type":"core_reasoning"}')).toBeNull();
    expect(parseFrame(JSON.stringify({ schemaVersion: 1, type: 'ping' }))).toMatchObject({ type: 'ping', seq: 0 });
  });

  it('keeps a frame that straddles two reads in one piece', () => {
    const first = readLines('{"schemaVersion":1,"type":"do');
    expect(first.lines).toEqual([]);
    const second = readLines(`${first.rest}ne"}\nlicence\n`);
    expect(second.lines).toEqual(['{"schemaVersion":1,"type":"done"}', 'licence']);
    expect(second.rest).toBe('');
  });

  it('composes the model input the plan fixes, and shows the visitor only their own words back', () => {
    const composed = composeMessage('Dobrý den, pomozte mi prosím.', '{"url":"https://example.cz/"}');
    expect(composed.message.startsWith('Visitor message:\nDobrý den')).toBe(true);
    expect(composed.message).toContain('\n\nUntrusted page state:\n{"url"');
    expect(readVisitorText(composed.message)).toBe('Dobrý den, pomozte mi prosím.');
    // A message that is only the visitor's text still reads back as that text.
    expect(readVisitorText('Visitor message:\njen text')).toBe('jen text');
    expect(readVisitorText('bez obalu')).toBe('bez obalu');
  });

  it('never lets a composed message exceed what the hook accepts', () => {
    const composed = composeMessage('x'.repeat(VISITOR_TEXT_MAX_BYTES), 'y'.repeat(MESSAGE_MAX_BYTES));
    expect(composed.pageStateIncluded).toBe(false);
    expect(new TextEncoder().encode(composed.message).length).toBeLessThanOrEqual(MESSAGE_MAX_BYTES);
    expect(readVisitorText(composed.message)).toBe('x'.repeat(VISITOR_TEXT_MAX_BYTES));
  });

  it('builds request bodies with exactly the fields the hook validates', () => {
    expect(visitorRequestBody('cbt_1')).toEqual({ schemaVersion: 1, bot: 'cbt_1' });
    expect(turnRequestBody('2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c34', 'ahoj')).toEqual({
      schemaVersion: 1,
      clientTurnId: '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c34',
      message: 'ahoj',
    });
    expect(actionDecisionBody('confirm', 'nonce-value-1234')).toEqual({ schemaVersion: 1, decision: 'confirm', nonce: 'nonce-value-1234' });
    expect(newClientTurnId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newSnapshotId()).toMatch(/^s[0-9a-f]{16}$/);
  });
});

describe('an action frame the server sends', () => {
  const base = {
    actionId: '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c34',
    kind: 'fill',
    targetId: 'e2',
    value: 'Jan',
    snapshotId: 's0123456789abcdef',
    requiresConfirmation: false,
    confirmationNonce: 'nonce-value-1234',
  };

  it('is accepted only in the shape the contract fixes', () => {
    expect(readActionFrame({ ...base })).toEqual({ ...base, kind: 'fill' });
    expect(readActionFrame({ ...base, actionId: 'not-a-uuid' })).toBeNull();
    expect(readActionFrame({ ...base, kind: 'run_javascript' })).toBeNull();
    expect(readActionFrame({ ...base, snapshotId: 'snapshot-1' })).toBeNull();
    expect(readActionFrame({ ...base, confirmationNonce: 'x' })).toBeNull();
    expect(readActionFrame({ ...base, requiresConfirmation: 'true' })).toBeNull();
    // A frame that claims an irreversible kind needs no confirmation contradicts the contract.
    expect(readActionFrame({ ...base, kind: 'request_submit', requiresConfirmation: false })).toBeNull();
    expect(readActionFrame({ ...base, kind: 'request_submit', requiresConfirmation: true })).not.toBeNull();
  });
});

describe('describing the page', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = 'Kontaktní formulář';
  });

  function form(html: string): void {
    document.body.innerHTML = html;
  }

  it('describes the fields a visitor is filling in, and what may be done with each', () => {
    form(`
      <h1>Kontakt</h1>
      <form name="kontakt" action="/odeslat?stav=1" method="post">
        <label for="jmeno">Jméno</label>
        <input id="jmeno" name="jmeno" value="Jan" required>
        <input id="email" name="email" type="email" value="jan@example.cz">
        <select id="obec" name="obec"><option>Praha</option><option>Brno</option></select>
        <button id="poslat" type="submit">Odeslat žádost</button>
      </form>
    `);
    const snapshot = capturePageSnapshot();
    const parsed = JSON.parse(snapshot.json) as Record<string, any>;

    expect(parsed.url).toBe('https://example.test/formular');
    expect(parsed.title).toBe('Kontaktní formulář');
    expect(parsed.headings).toEqual([{ level: 1, text: 'Kontakt' }]);
    // A form's action travels as a destination without its query string.
    expect(parsed.forms).toEqual([{ id: 'f0', name: 'kontakt', method: 'post', action: 'https://example.test/odeslat' }]);

    const byId = new Map<string, Record<string, unknown>>(parsed.targets.map((target: Record<string, unknown>) => [target.id as string, target]));
    expect(parsed.targets).toHaveLength(4);
    expect(byId.get('e0')).toMatchObject({ tag: 'input', name: 'jmeno', label: 'Jméno', value: 'Jan', required: true, form: 'f0' });
    expect(byId.get('e0')!.caps).toContain('fill');
    expect(byId.get('e1')!.caps).toContain('fill');
    expect(byId.get('e2')!.caps).toContain('select');
    // The submit button may be submitted and focused, and may NOT be clicked: a click would send the form.
    expect(byId.get('e3')!.caps).toEqual(['request_submit', 'focus']);
    // Every id the description issued has a handle behind it, so an approved action can find its element.
    expect(snapshot.targets.map((target) => target.id)).toEqual(['e0', 'e1', 'e2', 'e3']);
  });

  it('never sends the value of a password or a card field, nor lets an agent write into one', () => {
    form(`
      <form>
        <input id="a1" name="udaj_a" type="password" value="TajneHeslo123">
        <input id="a2" name="udaj_b" autocomplete="cc-number" value="4111111111111111">
        <input id="a3" name="cvv" value="123">
        <input id="a4" name="rodne_cislo" value="9001011234">
        <input id="a5" name="jmeno" value="Jan">
      </form>
    `);
    const snapshot = capturePageSnapshot();

    for (const secret of ['TajneHeslo123', '4111111111111111', '123', '9001011234']) {
      expect(snapshot.json).not.toContain(secret);
    }
    const parsed = JSON.parse(snapshot.json) as Record<string, any>;
    const byId = new Map<string, Record<string, unknown>>(parsed.targets.map((target: Record<string, unknown>) => [target.id as string, target]));
    // A password field is invisible to the agent in every way that matters: no value, no read, no write.
    // Its NAME here says nothing, so only the type it declares keeps it out.
    expect(byId.get('e0')).toMatchObject({ type: 'password' });
    expect(byId.get('e0')!.value).toBeUndefined();
    expect(byId.get('e0')!.caps).toEqual(['focus']);
    // A card number is caught by what it declares about itself, whatever it is called…
    expect(byId.get('e1')!.value).toBeUndefined();
    expect(byId.get('e1')!.caps).toEqual(['focus']);
    // …and a CVV or a birth number by its name, which is the only signal a plain browser form gives.
    expect(byId.get('e2')!.value).toBeUndefined();
    expect(byId.get('e2')!.caps).toEqual(['focus']);
    expect(byId.get('e3')!.caps).toEqual(['focus']);
    // …while the ordinary field beside them is described in full, which is what the bot is for.
    expect(byId.get('e4')).toMatchObject({ value: 'Jan' });
    expect(byId.get('e4')!.caps).toEqual(['read', 'fill', 'focus']);
  });

  it('knows the difference between a submit button and an ordinary one', () => {
    form(`
      <form>
        <button id="ano" type="submit">Odeslat</button>
        <button id="pridat" type="button">Přidat řádek</button>
        <button id="hole">Bez typu</button>
        <input id="image" type="image" alt="Odeslat">
      </form>
      <button id="mimo">Mimo formulář</button>
    `);
    expect(wouldSubmit(document.getElementById('ano')!)).toBe(true);
    expect(wouldSubmit(document.getElementById('pridat')!)).toBe(false);
    // A button with no type IS a submit button when it belongs to a form, and a plain control when it does not.
    expect(wouldSubmit(document.getElementById('hole')!)).toBe(true);
    expect(wouldSubmit(document.getElementById('mimo')!)).toBe(false);
    expect(wouldSubmit(document.getElementById('image')!)).toBe(true);
  });

  it('leaves hidden, scripted and self-referential subtrees out of the description', () => {
    form(`
      <div hidden><input name="skryty" value="1"></div>
      <div aria-hidden="true"><input name="take_skryty" value="2"></div>
      <div style="display:none"><input name="neviditelny" value="3"></div>
      <script>var tajemstvi = "4";</script>
      <template><input name="sablona" value="5"></template>
      <div data-elowen-chatbot="root"><button>Otevřít chat</button></div>
      <input name="viditelny" value="6">
    `);
    const snapshot = capturePageSnapshot();
    const parsed = JSON.parse(snapshot.json) as Record<string, any>;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0]).toMatchObject({ name: 'viditelny', value: '6' });
    expect(snapshot.json).not.toContain('tajemstvi');
    expect(snapshot.json).not.toContain('Otevřít chat');
  });

  it('describes a frame by where it points and never by what is inside it', () => {
    form(`
      <iframe src="https://platby.example.com/widget?token=tajny" title="Platební brána"></iframe>
      <iframe src="/vlastni.html" title="Vlastní"></iframe>
      <input name="jmeno" value="Jan">
    `);
    const snapshot = capturePageSnapshot();
    const parsed = JSON.parse(snapshot.json) as Record<string, any>;
    expect(parsed.iframes).toEqual([
      { srcOrigin: 'https://platby.example.com', title: 'Platební brána' },
      { srcOrigin: 'https://example.test', title: 'Vlastní' },
    ]);
    // The frame's query string, which can carry a value of its own, never travels.
    expect(snapshot.json).not.toContain('tajny');
  });

  it('cuts the description at its ceilings instead of growing past them', () => {
    const fields = Array.from({ length: PAGE_SNAPSHOT_MAX_ELEMENTS + 25 }, (_unused, index) =>
      `<input name="f${index}" value="hodnota-${index}">`).join('');
    form(`<form>${fields}</form>`);
    // The element ceiling on its own: the byte budget is lifted so this test is about ONE bound.
    const byElements = capturePageSnapshot({ maxBytes: 4 * 1024 * 1024 });
    const elementDraft = JSON.parse(byElements.json) as Record<string, any>;
    expect(elementDraft.targets).toHaveLength(PAGE_SNAPSHOT_MAX_ELEMENTS);
    expect(elementDraft.truncated).toBe(true);
    expect(byElements.targets).toHaveLength(PAGE_SNAPSHOT_MAX_ELEMENTS);

    // And the byte ceiling on its own, which is the tighter of the two when the message has to carry the
    // description: nothing past it is described, and the report says it was cut.
    const byBytes = capturePageSnapshot({ maxBytes: 900 });
    expect(new TextEncoder().encode(byBytes.json).length).toBeLessThanOrEqual(900);
    const byteDraft = JSON.parse(byBytes.json) as Record<string, any>;
    expect(byteDraft.truncated).toBe(true);
    expect(byteDraft.targets.length).toBeLessThan(PAGE_SNAPSHOT_MAX_ELEMENTS);
    // A trimmed description still parses, and every target it kept has a handle behind it.
    expect(byBytes.targets.map((target) => target.id)).toEqual(byteDraft.targets.map((target: Record<string, unknown>) => target.id));
  });

  it('recognises a sensitive field by what it declares, not only by what it is called', () => {
    form(`
      <input id="a" type="password">
      <input id="b" autocomplete="new-password">
      <input id="c" autocomplete="one-time-code">
      <input id="d" name="iban">
      <input id="e" name="jmeno">
      <textarea id="f" name="heslo_klienta"></textarea>
    `);
    expect(isSensitiveField(document.getElementById('a')!)).toBe(true);
    expect(isSensitiveField(document.getElementById('b')!)).toBe(true);
    expect(isSensitiveField(document.getElementById('c')!)).toBe(true);
    expect(isSensitiveField(document.getElementById('d')!)).toBe(true);
    expect(isSensitiveField(document.getElementById('e')!)).toBe(false);
    expect(isSensitiveField(document.getElementById('f')!)).toBe(true);
  });
});

describe('one visitor message', () => {
  it('carries the page state, streams the answer and finishes with the whole of it', async () => {
    const view = makeView();
    const page = makePage();
    const harness = makeSession({
      view,
      page,
      responses: ({ method, url }) => {
        if (method === 'POST' && url.endsWith('/visitors')) return jsonResponse(200, { token: 'token-1' });
        if (method === 'POST' && url.endsWith('/turns')) return jsonResponse(202, { turnId: 'T1' });
        return new Response(streamOf([
          frame('accepted', {}, 1),
          frame('text_delta', { text: 'Ahoj' }, 2),
          frame('text_delta', { text: ' světe' }, 3),
          frame('done', { text: 'Ahoj světe' }, 4),
        ]), { status: 200 });
      },
    });

    // Nothing at all is described before the visitor writes.
    expect(page.captures).toBe(0);
    await harness.session.send('Pomozte mi prosím s formulářem');

    expect(page.captures).toBe(1);
    const turn = harness.requests.find((request) => request.url.endsWith('/turns'));
    expect(turn?.body).toMatchObject({ schemaVersion: 1 });
    expect(String(turn?.body?.message)).toContain('Pomozte mi prosím s formulářem');
    expect(String(turn?.body?.message)).toContain('Untrusted page state:');
    expect(String(turn?.body?.message)).toContain(PAGE_JSON);
    expect(view.answers).toEqual(['Ahoj světe']);
    expect(view.errors).toEqual([]);
  });

  it('refuses a message that carries more than the hook would take', async () => {
    const view = makeView();
    const page = makePage();
    const harness = makeSession({ view, page, responses: () => jsonResponse(500, {}) });
    await harness.session.send('x'.repeat(VISITOR_TEXT_MAX_BYTES + 1));
    expect(view.errors).toEqual([strings.errorTooLong]);
    expect(harness.requests).toEqual([]);
  });

  it('says nothing to the server when the visitor never wrote', async () => {
    const view = makeView();
    const page = makePage();
    const harness = makeSession({ view, page, responses: () => jsonResponse(500, {}) });
    await harness.session.start();
    expect(harness.requests).toEqual([]);
    expect(view.restored).toEqual([]);
  });
});

describe('a dropped connection', () => {
  it('resumes from the last frame it rendered and never doubles what it already showed', async () => {
    const view = makeView();
    const page = makePage();
    const harness = makeSession({
      view,
      page,
      responses: ({ method, url, attempt }) => {
        if (method === 'POST' && url.endsWith('/visitors')) return jsonResponse(200, { token: 'token-1' });
        if (method === 'POST' && url.endsWith('/turns')) return jsonResponse(202, { turnId: 'T1' });
        if (attempt === 0) {
          return new Response(brokenStreamOf([
            frame('accepted', {}, 1),
            frame('text_delta', { text: 'Ahoj' }, 2),
          ]), { status: 200 });
        }
        return new Response(streamOf([
          frame('text_delta', { text: ' světe' }, 3),
          frame('done', { text: 'Ahoj světe' }, 4),
        ]), { status: 200 });
      },
    });

    await harness.session.send('ahoj');
    const streams = harness.requests.filter((request) => request.url.includes('/events?'));
    expect(streams.map((request) => request.url)).toEqual([
      'https://elowen.example/hooks/chatbot/v1/turns/T1/events?after=0',
      'https://elowen.example/hooks/chatbot/v1/turns/T1/events?after=2',
    ]);
    expect(view.answers).toEqual(['Ahoj světe']);
    expect(view.notices).toContain(strings.reconnecting);
  });
});

describe('acting on the page', () => {
  const SNAPSHOT = 's0123456789abcdef';
  const ACTION_ID = '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c34';

  function actionFrame(data: Record<string, unknown>): string {
    return `${JSON.stringify({
      schemaVersion: 1,
      turnId: 'T1',
      seq: 9,
      type: 'action',
      data: { actionId: ACTION_ID, snapshotId: SNAPSHOT, confirmationNonce: 'nonce-value-1234', ...data },
    })}\n`;
  }

  function withAction(action: string, view: ViewLog): Harness & { page: PageLog } {
    const page = makePage();
    const harness = makeSession({
      view,
      page,
      responses: ({ method, url }) => {
        if (method === 'POST' && url.endsWith('/visitors')) return jsonResponse(200, { token: 'token-1' });
        if (method === 'POST' && url.endsWith('/turns')) return jsonResponse(202, { turnId: 'T1' });
        if (method === 'POST') return jsonResponse(200, {});
        return new Response(streamOf([action, frame('done', { text: 'Hotovo' }, 10)]), { status: 200 });
      },
    });
    return Object.assign(harness, { page });
  }

  it('performs an approved fill and reports what happened', async () => {
    const view = makeView();
    const harness = withAction(actionFrame({ kind: 'fill', targetId: 'e0', value: 'Jan', requiresConfirmation: false }), view);
    await harness.session.send('vyplňte prosím jméno');
    await flush();

    expect(harness.page.performed).toEqual([{ snapshotId: SNAPSHOT, kind: 'fill', value: 'Jan' }]);
    const report = harness.requests.find((request) => request.url.endsWith(`/actions/${ACTION_ID}/result`));
    expect(report?.body).toEqual({ schemaVersion: 1, outcome: 'done' });
  });

  it('scrolls the page when the server approved a scroll with no target at all', async () => {
    // A page-scroll names no element, and the absence has to survive the policy: an EMPTY id would be a
    // target that resolves to nothing, which the page half reports as an element that vanished from a page
    // nothing touched. This is the seam where the two spellings meet.
    const view = makeView();
    const page = makePage();
    const targets: (string | null)[] = [];
    const bridge: PageBridge = {
      ...page.bridge,
      perform: (_snapshotId, action) => {
        targets.push(action.targetId);
        return Promise.resolve({ outcome: 'done' as const });
      },
    };
    const harness = makeSession({
      view,
      page: Object.assign(page, { bridge }),
      responses: ({ method, url }) => {
        if (method === 'POST' && url.endsWith('/visitors')) return jsonResponse(200, { token: 'token-1' });
        if (method === 'POST' && url.endsWith('/turns')) return jsonResponse(202, { turnId: 'T1' });
        return new Response(streamOf([actionFrame({ kind: 'scroll', targetId: null, value: 'down', requiresConfirmation: false }), frame('done', { text: 'Hotovo' }, 10)]), { status: 200 });
      },
    });

    await harness.session.send('posuňte prosím na konec');
    await flush();

    expect(targets).toEqual([null]);
    const report = harness.requests.find((request) => request.url.endsWith(`/actions/${ACTION_ID}/result`));
    expect(report?.body).toEqual({ schemaVersion: 1, outcome: 'done' });
  });

  it('refuses a click on a submit button, reports the refusal, and does not click at all', async () => {
    const view = makeView();
    const harness = withAction(actionFrame({ kind: 'click', targetId: 'e1', requiresConfirmation: false }), view);
    await harness.session.send('odešlete to');
    await flush();

    expect(harness.page.performed).toEqual([]);
    expect(harness.page.submitted).toEqual([]);
    const report = harness.requests.find((request) => request.url.endsWith(`/actions/${ACTION_ID}/result`));
    expect(report?.body).toEqual({ schemaVersion: 1, outcome: 'denied', detail: 'submit_is_its_own_action' });
  });

  it('never submits without a confirmation the visitor gave, and reports the decline', async () => {
    const view = makeView(false);
    const harness = withAction(actionFrame({ kind: 'request_submit', targetId: 'e1', requiresConfirmation: true }), view);
    await harness.session.send('odešlete to');
    await flush();

    expect(view.confirmRequests).toHaveLength(1);
    expect(view.confirmRequests[0]).toContain('Kontaktní formulář');
    expect(harness.page.submitted).toEqual([]);
    const decision = harness.requests.find((request) => request.url.endsWith(`/actions/${ACTION_ID}/confirmation`));
    expect(decision?.body).toEqual({ schemaVersion: 1, decision: 'decline', nonce: 'nonce-value-1234' });
    expect(harness.requests.some((request) => request.url.endsWith('/result'))).toBe(false);
    expect(view.notices).toContain(strings.confirmDeclined);
  });

  it('waits for the server to record the confirmation before the form goes out', async () => {
    const view = makeView(true);
    const page = makePage();
    let release: () => void = () => undefined;
    const recorded = new Promise<void>((resolve) => { release = resolve; });
    const harness = makeSession({
      view,
      page,
      responses: async ({ method, url }) => {
        if (method === 'POST' && url.endsWith('/visitors')) return jsonResponse(200, { token: 'token-1' });
        if (method === 'POST' && url.endsWith('/turns')) return jsonResponse(202, { turnId: 'T1' });
        // Held open until the test says so: the form must not have gone out while this is unanswered.
        if (method === 'POST' && url.endsWith('/confirmation')) {
          await recorded;
          return jsonResponse(200, {});
        }
        if (method === 'POST') return jsonResponse(200, {});
        return new Response(streamOf([
          actionFrame({ kind: 'request_submit', targetId: 'e1', requiresConfirmation: true }),
          frame('done', { text: 'Hotovo' }, 10),
        ]), { status: 200 });
      },
    });

    const sending = harness.session.send('odešlete to');
    await flush();
    expect(harness.requests.some((request) => request.url.endsWith(`/actions/${ACTION_ID}/confirmation`))).toBe(true);
    expect(page.submitted).toEqual([]);

    release();
    await sending;
    // The action finishes beside the stream, so the test lets it settle before looking.
    await flush();
    expect(page.submitted).toEqual(['e1']);
    const decisionIndex = harness.requests.findIndex((request) => request.url.endsWith(`/actions/${ACTION_ID}/confirmation`));
    const resultIndex = harness.requests.findIndex((request) => request.url.endsWith(`/actions/${ACTION_ID}/result`));
    expect(decisionIndex).toBeLessThan(resultIndex);
    expect(harness.requests[resultIndex]?.body).toEqual({ schemaVersion: 1, outcome: 'done' });
  });

  it('does not send a form whose confirmation the server did not record', async () => {
    const view = makeView(true);
    const page = makePage();
    const harness = makeSession({
      view,
      page,
      responses: ({ method, url }) => {
        if (method === 'POST' && url.endsWith('/visitors')) return jsonResponse(200, { token: 'token-1' });
        if (method === 'POST' && url.endsWith('/turns')) return jsonResponse(202, { turnId: 'T1' });
        if (method === 'POST' && url.endsWith('/confirmation')) return jsonResponse(503, { error: 'bot_unavailable' });
        if (method === 'POST') return jsonResponse(200, {});
        return new Response(streamOf([
          actionFrame({ kind: 'request_submit', targetId: 'e1', requiresConfirmation: true }),
          frame('done', { text: 'Hotovo' }, 10),
        ]), { status: 200 });
      },
    });
    await harness.session.send('odešlete to');
    await flush();

    expect(page.submitted).toEqual([]);
    expect(view.errors).toContain(strings.confirmUnavailable);
  });

  it('refuses an action from a page it no longer holds, and says so to the visitor', async () => {
    const view = makeView();
    const page = makePage({ holds: false });
    const harness = makeSession({
      view,
      page,
      responses: ({ method, url }) => {
        if (method === 'POST' && url.endsWith('/visitors')) return jsonResponse(200, { token: 'token-1' });
        if (method === 'POST' && url.endsWith('/turns')) return jsonResponse(202, { turnId: 'T1' });
        if (method === 'POST') return jsonResponse(200, {});
        return new Response(streamOf([
          actionFrame({ kind: 'fill', targetId: 'e0', value: 'Jan', requiresConfirmation: false }),
          frame('done', { text: 'Hotovo' }, 10),
        ]), { status: 200 });
      },
    });
    await harness.session.send('vyplňte jméno');
    await flush();

    expect(page.performed).toEqual([]);
    const report = harness.requests.find((request) => request.url.endsWith(`/actions/${ACTION_ID}/result`));
    expect(report?.body).toEqual({ schemaVersion: 1, outcome: 'denied', detail: 'stale_snapshot' });
    expect(view.notices).toContain(strings.actionStale);
  });

  it('stops reporting once a deployment answers that it does not serve action reports', async () => {
    const view = makeView();
    const page = makePage();
    const harness = makeSession({
      view,
      page,
      responses: ({ method, url }) => {
        if (method === 'POST' && url.endsWith('/visitors')) return jsonResponse(200, { token: 'token-1' });
        if (method === 'POST' && url.endsWith('/turns')) return jsonResponse(202, { turnId: 'T1' });
        if (method === 'POST') return jsonResponse(404, { error: 'not_found' });
        return new Response(streamOf([
          actionFrame({ kind: 'fill', targetId: 'e0', value: 'Jan', requiresConfirmation: false }),
          actionFrame({ kind: 'fill', targetId: 'e0', value: 'Jan', requiresConfirmation: false }),
          frame('done', { text: 'Hotovo' }, 10),
        ]), { status: 200 });
      },
    });
    await harness.session.send('vyplňte jméno');
    await flush();

    // The action still happens; only the reporting is given up, once, after the deployment said so.
    expect(page.performed).toHaveLength(2);
    expect(harness.requests.filter((request) => request.url.endsWith('/result'))).toHaveLength(1);
  });
});

describe('the confirmation a visitor answers', () => {
  function panel(): { panel: ChatPanel; confirmButton: HTMLButtonElement; cancelButton: HTMLButtonElement } {
    const instance = new ChatPanel({
      strings,
      botName: 'Městský úřad',
      onVisitorMessage: () => undefined,
      onStop: () => undefined,
    });
    document.body.append(instance.host);
    const shadow = instance.host.shadowRoot!;
    return {
      panel: instance,
      confirmButton: shadow.querySelector<HTMLButtonElement>('.confirm-yes')!,
      cancelButton: shadow.querySelector<HTMLButtonElement>('.confirm-no')!,
    };
  }

  it('is not answered by a click the page dispatched itself', async () => {
    const { panel: instance, confirmButton } = panel();
    let answered: boolean | null = null;
    void instance.confirm({ title: 'Odeslat formulář „Kontakt“?' }).then((value) => { answered = value; });

    // A script in the page can dispatch this click; the browser marks it untrusted, and it must decide
    // nothing at all — not a submit, and not a decline either, because the question is the visitor's.
    confirmButton.click();
    confirmButton.click();
    await Promise.resolve();
    expect(answered).toBeNull();
    expect(instance.host.shadowRoot!.querySelector('.confirm')!.hasAttribute('hidden')).toBe(false);

    // A cancel performs nothing, so any click may decline.
    instance.host.shadowRoot!.querySelector<HTMLButtonElement>('.confirm-no')!.click();
    await Promise.resolve();
    expect(answered).toBe(false);
  });

  it('says what is happening about the conversation without putting it in the transcript', () => {
    const { panel: instance } = panel();
    const shadow = instance.host.shadowRoot!;
    const chat = shadow.querySelector('deep-chat') as unknown as { getMessages(): unknown[] };

    instance.notice('Spojení se přerušilo, zkouším se znovu připojit.');
    expect(shadow.querySelector<HTMLElement>('.status')!.hidden).toBe(false);
    expect(shadow.querySelector('.status')!.textContent).toContain('připojit');
    expect(chat.getMessages()).toEqual([]);

    instance.error(strings.errorTurn);
    expect(shadow.querySelector('.status')!.classList.contains('status-error')).toBe(true);

    instance.finishAnswer('Hotovo');
    expect(shadow.querySelector<HTMLElement>('.status')!.hidden).toBe(true);
    expect(chat.getMessages()).toEqual([{ role: 'ai', text: 'Hotovo' }]);
    instance.destroy();
  });

  it('shows the panel and takes focus when a confirmation is asked for', async () => {
    const { panel: instance } = panel();
    expect(instance.isOpen()).toBe(false);
    void instance.confirm({ title: 'Odeslat?' });
    expect(instance.isOpen()).toBe(true);
    expect(instance.host.shadowRoot!.querySelector('.confirm-title')!.textContent).toBe('Odeslat?');
    instance.destroy();
  });
});
