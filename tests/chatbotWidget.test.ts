// @vitest-environment-options {"url": "https://example.test/formular"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MESSAGE_MAX_BYTES,
  PAGE_SNAPSHOT_MAX_ELEMENTS,
} from '../plugins/chatbot/src/publicContract.js';
import {
  actionDecisionBody,
  newClientTurnId,
  newSnapshotId,
  parseFrame,
  readActionFrame,
  readLines,
  turnRequestBody,
  publicBotRequestBody,
} from '../plugins/chatbot/embed-src/protocol.js';
import { capturePageSnapshot, isSensitiveField, wouldSubmit } from '../plugins/chatbot/embed-src/pageSnapshot.js';
import { ChatSession, type ChatView, type PageBridge } from '../plugins/chatbot/embed-src/session.js';
import { ChatPanel } from '../plugins/chatbot/embed-src/chatPanel.js';
import { APPEARANCE_BOUNDS, APPEARANCE_TEMPLATES, DEFAULT_APPEARANCE, type ChatbotLook } from '../plugins/chatbot/src/appearanceContract.js';
import { widgetStrings } from '../plugins/chatbot/embed-src/strings.js';
import { CHATBOT_SITE, createChatbotHost, postRequest, registerBot } from './helpers/chatbotHost.js';

/** The widget's own half of the protocol, and the two things it promises a customer's page: that a
 *  description of that page is bounded and free of what must not leave it, and that nothing irreversible
 *  happens to it without the visitor's own click. */

// deep-chat renders the messages; it is not what is under test here, and its bundle is a browser artifact.
vi.mock('deep-chat', () => {
  class StubChat extends HTMLElement {
    history: unknown[] = [];
    /** The real element calls this once its first render is done, which is what makes it able to take
     *  messages. The stub renders the moment it reaches the document, so that is when it calls back. */
    onComponentRender?: (ref: unknown) => void;
    connectedCallback(): void {
      if (!this.shadowRoot) {
        const root = this.attachShadow({ mode: 'open' });
        const list = document.createElement('div');
        list.id = 'messages';
        root.append(list);
      }
      this.onComponentRender?.(this);
    }
    getMessages(): { role?: string; text?: string; html?: string }[] { return this._messages; }
    addMessage(message: { role?: string; text?: string; html?: string }): void {
      this._messages.push(message);
      const outer = document.createElement('div');
      outer.className = `outer-message-container deep-chat-outer-container-role-${message.role ?? 'ai'}`;
      const inner = document.createElement('div');
      inner.className = 'inner-message-container';
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble text-message';
      bubble.textContent = message.text ?? '';
      inner.append(bubble);
      outer.append(inner);
      this.shadowRoot?.querySelector('#messages')?.append(outer);
    }
    updateMessage(message: { text?: string }, index: number): void {
      this._messages[index] = { role: 'ai', ...message };
      const bubble = this.shadowRoot?.querySelectorAll('.message-bubble')[index];
      if (bubble) bubble.textContent = message.text ?? '';
    }
    /** Like the real element: the submit path draws the message and hands it to the configured transport,
     *  whose signals are what put up the typing indicator. */
    submitUserMessage(content: { text?: string }): void {
      this.addMessage({ role: 'user', text: content.text });
      this.submitted.push(content.text ?? '');
      const connect = (this as unknown as { connect?: { handler?(body: unknown, signals: unknown): void } }).connect;
      connect?.handler?.({ messages: [{ role: 'user', text: content.text }] }, {
        onOpen: () => undefined, onResponse: () => undefined, onClose: () => undefined, stopClicked: {},
      });
    }
    submitted: string[] = [];
    focusInput(): void { /* no focus in jsdom */ }
    disableSubmitButton(): void { /* no input validation in the renderer stub */ }
    /** Unit tests cover the visibility gate; the browser regression measures actual scroll geometry. */
    get clientHeight(): number { return this.closest('section')?.hidden ? 0 : 400; }
    scrollToBottom(): void { this.scrolledToBottom += 1; }
    scrolledToBottom = 0;
    private readonly _messages: { role?: string; text?: string; html?: string }[] = [];
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
  return `${JSON.stringify({ schemaVersion: 2, turnId: 'T', seq, type, data })}\n`;
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
  offered: { offer: import('../plugins/chatbot/src/offerContract.js').Offer; active: boolean }[];
}

function makeView(confirmAnswer: boolean | (() => Promise<boolean>) = false): ViewLog {
  const log: ViewLog = {
    restored: [],
    answers: [],
    notices: [],
    errors: [],
    confirmRequests: [],
    offered: [],
    view: undefined as unknown as ChatView,
  };
  log.view = {
    beginAnswer: () => { log.answers.push(''); },
    streamAnswer: (text) => { log.answers[log.answers.length - 1] = (log.answers[log.answers.length - 1] ?? '') + text; },
    finishAnswer: (text) => { log.answers[log.answers.length - 1] = text; },
    notice: (text) => { log.notices.push(text); },
    error: (text) => { log.errors.push(text); },
    restore: (messages) => { log.restored.push(...messages.map(({ role, text }) => ({ role, text }))); },
    setAllowedOrigins: () => undefined,
    showOffer: (offer, active) => { log.offered.push({ offer, active }); },
    showFeedback: () => undefined,
    showAttachment: () => undefined,
    uploadProgress: () => undefined,
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
    metadata: () => ({ url: 'https://www.example.cz/formular', title: 'Form' }),
    takeHandoff: () => null,
    navigate: () => undefined,
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
  requests: { method: string; url: string; body: Record<string, unknown> | null; headers: Record<string, string> }[];
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
    requests.push({ method, url: String(url), body, headers: (init.headers ?? {}) as Record<string, string> });
    return input.responses({ method, url: String(url), attempt });
  }) as unknown as typeof fetch;

  return {
    requests,
    session: new ChatSession({
      baseUrl: 'https://elowen.example/hooks/chatbot/v2',
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
    expect(parseFrame('{"schemaVersion":99,"type":"done"}')).toBeNull();
    expect(parseFrame('{"schemaVersion":1,"type":"core_reasoning"}')).toBeNull();
    expect(parseFrame(JSON.stringify({ schemaVersion: 2, type: 'ping' }))).toMatchObject({ type: 'ping', seq: 0 });
  });

  it('keeps a frame that straddles two reads in one piece', () => {
    const first = readLines('{"schemaVersion":1,"type":"do');
    expect(first.lines).toEqual([]);
    const second = readLines(`${first.rest}ne"}\nlicence\n`);
    expect(second.lines).toEqual(['{"schemaVersion":1,"type":"done"}', 'licence']);
    expect(second.rest).toBe('');
  });

  it('builds request bodies with exactly the fields the hook validates', () => {
    expect(publicBotRequestBody('cbt_1')).toEqual({ schemaVersion: 2, bot: 'cbt_1' });
    const page = { url: 'https://example.cz/', title: 'Example' };
    expect(turnRequestBody('2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c34', 'ahoj', page)).toEqual({
      schemaVersion: 2,
      clientTurnId: '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c34',
      message: 'ahoj',
      page,
    });
    expect(actionDecisionBody('confirm', 'nonce-value-1234')).toEqual({ schemaVersion: 2, decision: 'confirm', nonce: 'nonce-value-1234' });
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
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    const nativeStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => nativeStyle(element));
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
    expect(parsed.aria).toContain('heading "Kontakt"');
    // A form's action travels as a destination without its query string.
    expect(parsed.aria).toContain('Jméno [e0]');

    const byId = new Map<string, Record<string, unknown>>(parsed.targets.map((target: Record<string, unknown>) => [target.id as string, target]));
    expect(parsed.targets).toHaveLength(4);
    expect(parsed.aria).toContain('Jan');
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
    expect(parsed.aria).toContain('Jan');
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
    expect(parsed.aria).toContain('6');
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
    expect(parsed.aria).not.toContain('iframe');
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
  it('sends only the visitor\'s words with the page beside them, streams the answer and finishes with the whole of it', async () => {
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

    expect(page.captures).toBe(0);
    const turn = harness.requests.find((request) => request.url.endsWith('/turns'));
    // The message is exactly what the visitor wrote; the page's address and title travel as their own field,
    // and nothing of its structure travels at all until a snapshot is asked for.
    expect(turn?.body).toEqual({
      schemaVersion: 2,
      clientTurnId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      message: 'Pomozte mi prosím s formulářem',
      page: { url: 'https://www.example.cz/formular', title: 'Form' },
    });
    expect(view.answers).toEqual(['Ahoj světe']);
    expect(view.errors).toEqual([]);
  });

  it('uploads an image-only turn before admission and binds the receipt to its client turn id', async () => {
    const view = makeView();
    const page = makePage();
    const image = new File([new Uint8Array(12)], 'photo.png', { type: 'image/png' });
    Object.defineProperty(image, 'stream', { value: () => new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(12)); controller.close(); },
    }) });
    const harness = makeSession({ view, page, responses: ({ method, url }) => {
      if (url.endsWith('/visitors')) return jsonResponse(200, { token: 'token-1' });
      if (method === 'POST' && url.includes('/uploads?')) return jsonResponse(201, { uploadId: 'receipt-id', name: 'photo.png' });
      if (url.endsWith('/turns')) return jsonResponse(202, { turnId: 'T1' });
      return new Response(streamOf([frame('done', { text: 'Vidím obrázek.' }, 1)]), { status: 200 });
    } });
    await harness.session.send('', image);
    const upload = harness.requests.find((request) => request.url.includes('/uploads?'))!;
    const turn = harness.requests.find((request) => request.url.endsWith('/turns'))!;
    expect(harness.requests.indexOf(upload)).toBeLessThan(harness.requests.indexOf(turn));
    expect(new URL(upload.url).searchParams.get('clientTurnId')).toBe(turn.body?.clientTurnId);
    expect(turn.body).toMatchObject({ message: '', uploadId: 'receipt-id' });
    expect(view.answers).toEqual(['Vidím obrázek.']);
  });

  it('waits for the terminal frame before loading a live shared file', async () => {
    const view = makeView();
    const shown: string[] = [];
    view.view.showAttachment = (_turnId, attachment) => { shown.push(attachment.storedName); };
    const storedName = `${'a'.repeat(64)}.bin`;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) {
      controller = value;
      value.enqueue(new TextEncoder().encode(frame('attachment', { kind: 'file', storedName, name: 'report.pdf', size: 4 }, 1)));
    } });
    const harness = makeSession({ view, page: makePage(), responses: ({ url }) => {
      if (url.endsWith('/visitors')) return jsonResponse(200, { token: 'token-1' });
      if (url.endsWith('/turns')) return jsonResponse(202, { turnId: 'T' });
      return new Response(stream, { status: 200 });
    } });
    const sending = harness.session.send('report');
    await flush();
    expect(shown).toEqual([]);
    controller.enqueue(new TextEncoder().encode(frame('done', { text: '' }, 2)));
    controller.close();
    await sending;
    expect(shown).toEqual([storedName]);
  });

  it('refuses a message that carries more than the hook would take', async () => {
    const view = makeView();
    const page = makePage();
    const harness = makeSession({ view, page, responses: () => jsonResponse(500, {}) });
    await harness.session.send('x'.repeat(MESSAGE_MAX_BYTES + 1));
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
      'https://elowen.example/hooks/chatbot/v2/turns/T1/events?after=0',
      'https://elowen.example/hooks/chatbot/v2/turns/T1/events?after=2',
    ]);
    expect(view.answers).toEqual(['Ahoj světe']);
    expect(view.notices).toContain(strings.reconnecting);
  });
});

describe('preserving visitor credentials during failures', () => {
  function stored() {
    let token: string | null = 'original';
    return { getItem: () => token, setItem: (_key: string, value: string) => { token = value; }, removeItem: () => { token = null; } };
  }
  const failures: [string, () => Response][] = [
    ['network', () => { throw new TypeError('offline'); }],
    ['server', () => jsonResponse(503, { error: 'unavailable' })],
    ['forbidden', () => jsonResponse(403, { error: 'origin_not_allowed' })],
    ['misleading server error', () => jsonResponse(503, { error: 'invalid_token' })],
    ['unknown unauthorized', () => jsonResponse(401, { error: 'daemon_refused' })],
    ['unreadable unauthorized', () => new Response('<html>down</html>', { status: 401 })],
    ['malformed success', () => jsonResponse(200, { unexpected: true })],
  ];
  it.each(failures)('keeps identity and restores on retry after %s', async (_name, failure) => {
    const storage = stored();
    const view = makeView();
    let failed = true;
    const harness = makeSession({ storage, view, page: makePage(), responses: ({ url }) => {
      if (url.endsWith('/conversation')) return failed ? failure() : jsonResponse(200, { turns: [{ turnId: 'T1', message: 'Earlier', reply: 'Kept', lastSeq: 2, pendingActions: [] }], activeTurnId: null });
      return jsonResponse(200, { token: 'replacement' });
    } });
    await harness.session.start();
    expect(storage.getItem()).toBe('original');
    expect(harness.requests).toHaveLength(1);
    expect(view.errors).toContain(strings.errorUnavailable);
    failed = false;
    await harness.session.start();
    expect(view.restored).toEqual([{ role: 'user', text: 'Earlier' }, { role: 'ai', text: 'Kept' }]);
  });
  it('restores each stored message exactly as the visitor wrote it', async () => {
    const view = makeView();
    // Text that merely looks like a label or a page block is still the visitor's own words: the stored
    // message holds nothing else, so nothing is cut out of it.
    const written = 'Visitor message:\nCo znamená "\n\nUntrusted page address and title:\n{}"?';
    const harness = makeSession({ storage: stored(), view, page: makePage(), responses: ({ url }) => url.endsWith('/conversation')
      ? jsonResponse(200, { activeTurnId: null, turns: [{ turnId: 'T1', message: written, reply: 'Nic.', lastSeq: 2, pendingActions: [] }] })
      : jsonResponse(500, {}) });
    await harness.session.start();
    expect(view.restored).toEqual([{ role: 'user', text: written }, { role: 'ai', text: 'Nic.' }]);
  });
  it.each(failures)('keeps identity when token refresh encounters %s', async (_name, failure) => {
    const storage = stored();
    const harness = makeSession({ storage, view: makeView(), page: makePage(), responses: ({ url }) => {
      if (url.endsWith('/conversation')) return jsonResponse(401, { error: 'invalid_token' });
      if (url.endsWith('/refresh')) return failure();
      return jsonResponse(200, { token: 'replacement' });
    } });
    await harness.session.start();
    expect(storage.getItem()).toBe('original');
    expect(harness.requests.some(r => r.url.endsWith('/visitors'))).toBe(false);
  });
  it.each(['token_required', 'invalid_token'])('replaces identity only after explicit %s rejection', async error => {
    const storage = stored();
    const harness = makeSession({ storage, view: makeView(), page: makePage(), responses: ({ url, attempt }) => {
      if (url.endsWith('/conversation') && attempt > 0) return jsonResponse(200, { turns: [], activeTurnId: null });
      if (url.endsWith('/visitors')) return jsonResponse(200, { token: 'replacement' });
      return jsonResponse(401, { error });
    } });
    await harness.session.start();
    expect(storage.getItem()).toBe('replacement');
    expect(harness.requests.filter(r => r.url.endsWith('/visitors'))).toHaveLength(1);
  });
  it.each(failures.slice(0, -1))('keeps identity on send failure: %s', async (_name, failure) => {
    const storage = stored();
    const harness = makeSession({ storage, view: makeView(), page: makePage(), responses: () => failure() });
    await harness.session.send('Hello');
    expect(storage.getItem()).toBe('original');
    expect(harness.requests).toHaveLength(1);
  });
  it.each(failures.slice(0, -1))('keeps identity and resumes a dropped stream after %s', async (_name, failure) => {
    const storage = stored();
    const view = makeView();
    const harness = makeSession({ storage, view, page: makePage(), responses: ({ url, attempt }) => {
      if (url.endsWith('/turns')) return jsonResponse(202, { turnId: 'T1' });
      if (url.includes('/events?')) return attempt === 0 ? failure() : new Response(streamOf([frame('done', { text: 'Recovered' }, 1)]));
      return jsonResponse(200, { token: 'wrong replacement' });
    } });
    await harness.session.send('Hello');
    expect(storage.getItem()).toBe('original');
    expect(harness.requests.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(view.answers).toEqual(['Recovered']);
  });
  it('does not follow an old turn under a newly minted visitor', async () => {
    const storage = stored();
    const harness = makeSession({ storage, view: makeView(), page: makePage(), responses: ({ url, attempt }) => {
      if (url.endsWith('/turns')) return jsonResponse(202, { turnId: 'T1' });
      if (url.includes('/events?') && attempt > 0) return new Response(streamOf([frame('done', { text: 'Wrong visitor' }, 1)]));
      if (url.endsWith('/visitors')) return jsonResponse(200, { token: 'replacement' });
      return jsonResponse(401, { error: 'invalid_token' });
    } });
    await harness.session.send('Hello');
    expect(harness.requests.filter(r => r.url.includes('/events?'))).toHaveLength(1);
  });
  it('preserves a stored identity when navigation handoff is unavailable', async () => {
    const storage = stored();
    const page = makePage();
    page.bridge.takeHandoff = () => 'a'.repeat(64);
    const harness = makeSession({ storage, view: makeView(), page, responses: () => jsonResponse(503, { error: 'unavailable' }) });
    await harness.session.start();
    expect(storage.getItem()).toBe('original');
  });
});

describe('acting on the page', () => {
  const SNAPSHOT = 's0123456789abcdef';
  const ACTION_ID = '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c34';

  function actionFrame(data: Record<string, unknown>): string {
    return frame('action', { actionId: '0f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c34', kind: 'snapshot', snapshotId: '', targetId: null, value: null, confirmationNonce: 'nonce-value-1234', requiresConfirmation: false }, 8) + `${JSON.stringify({
      schemaVersion: 2,
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
    expect(report?.body).toEqual({ schemaVersion: 2, outcome: 'done' });
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
    expect(report?.body).toEqual({ schemaVersion: 2, outcome: 'done' });
  });

  it('refuses a click on a submit button, reports the refusal, and does not click at all', async () => {
    const view = makeView();
    const harness = withAction(actionFrame({ kind: 'click', targetId: 'e1', requiresConfirmation: false }), view);
    await harness.session.send('odešlete to');
    await flush();

    expect(harness.page.performed).toEqual([]);
    expect(harness.page.submitted).toEqual([]);
    const report = harness.requests.find((request) => request.url.endsWith(`/actions/${ACTION_ID}/result`));
    expect(report?.body).toEqual({ schemaVersion: 2, outcome: 'denied', detail: 'submit_is_its_own_action' });
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
    expect(decision?.body).toEqual({ schemaVersion: 2, decision: 'decline', nonce: 'nonce-value-1234' });
    expect(harness.requests.some((request) => request.url.endsWith(`/actions/${ACTION_ID}/result`))).toBe(false);
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
    expect(harness.requests[resultIndex]?.body).toEqual({ schemaVersion: 2, outcome: 'done' });
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
    expect(report?.body).toEqual({ schemaVersion: 2, outcome: 'denied', detail: 'stale_snapshot' });
    expect(view.notices).toContain(strings.actionStale);
  });

  it('reports unavailable action reporting and deduplicates replayed frames', async () => {
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
    expect(page.performed).toHaveLength(1);
    expect(harness.requests.filter((request) => request.url.endsWith('/result'))).toHaveLength(2);
  });
});

describe('navigation and active-turn restoration', () => {
  it.each([true, false])('waits for avatar-initiated handoff before restore, stored token: %s', async hasToken => {
    const values = new Map(hasToken ? [['elowen.chatbot.cbt_0123456789abcdef01234567.token', 'old-token']] : []);
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); } };
    const view = makeView(), page = makePage();
    page.bridge.takeHandoff = () => 'a'.repeat(64);
    let redeem!: (response: Response) => void;
    const handoff = new Promise<Response>(resolve => { redeem = resolve; });
    const actionId = '11111111-1111-4111-8111-111111111111';
    const harness = makeSession({ view, page, storage, responses: ({ url }) => {
      if (url.endsWith('/handoff')) return handoff;
      if (url.endsWith('/avatar')) return new Response(new Blob(['image'], { type: 'image/png' }));
      if (url.endsWith('/conversation')) return jsonResponse(200, { activeTurnId: 'T', turns: [
        { turnId: 'T', message: 'Hello', lastSeq: 3, pendingActions: [] },
      ] });
      if (url.includes('/events?')) return new Response(streamOf([
        frame('text_delta', { text: 'Before. ' }, 1),
        frame('action', { actionId, kind: 'navigate', snapshotId: 's0123456789abcdef',
          targetId: null, value: 'https://www.example.cz/next', requiresConfirmation: false }, 2),
        frame('text_delta', { text: 'After.' }, 3), frame('done', { text: 'Before. After.' }, 4),
      ]));
      return jsonResponse(409, { error: 'action_closed' });
    } });
    const avatar = harness.session.loadAvatar();
    const starting = harness.session.start();
    await flush();
    expect(harness.requests.map(request => new URL(request.url).pathname.split('/').at(-1))).toEqual(['handoff']);
    redeem(jsonResponse(200, { token: 'new-token' }));
    await Promise.all([avatar, starting]);
    await flush();
    expect(harness.requests.filter(request => request.url.endsWith('/handoff'))).toHaveLength(1);
    expect(harness.requests.filter(request => request.url.endsWith('/conversation') || request.url.includes('/events?'))
      .map(request => request.headers.authorization)).toEqual(['ChatbotVisitor new-token', 'ChatbotVisitor new-token']);
    expect(harness.requests.filter(request => request.url.endsWith('/result'))).toHaveLength(0);
    expect(view.answers).toEqual(['Before. After.']);
    expect(view.errors).toEqual([]);
  });

  it.each([403, 503, 200])('restores the stored conversation after a refused or malformed handoff (%s)', async status => {
    const storage = new Map<string, string>([['elowen.chatbot.cbt_0123456789abcdef01234567.token', 'original']]);
    const view = makeView(), page = makePage();
    page.bridge.takeHandoff = () => 'a'.repeat(64);
    const harness = makeSession({ view, page, storage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); },
      removeItem: key => { storage.delete(key); },
    }, responses: ({url}) => url.endsWith('/handoff')
      ? jsonResponse(status, {error:'invalid_handoff'})
      : jsonResponse(200, {turns:[{turnId:'T',message:'Hello',reply:'Still here',lastSeq:2,pendingActions:[]}],activeTurnId:null}) });
    await harness.session.loadAppearance();
    await harness.session.start();
    expect(view.restored).toEqual([{role:'user',text:'Hello'},{role:'ai',text:'Still here'}]);
    expect(view.errors).toEqual([]);
    expect(harness.requests.some(r => r.url.endsWith('/visitors'))).toBe(false);
  });

  it('does not redeem a successful handoff again when the site restores its fragment', async () => {
    const values = new Map<string, string>();
    const storage = {getItem:(key:string) => values.get(key) ?? null,
      setItem:(key:string,value:string) => { values.set(key,value); },
      removeItem:(key:string) => { values.delete(key); }};
    for (const reload of [false,true]) {
      const view = makeView(), page = makePage();
      page.bridge.takeHandoff = () => 'b'.repeat(64);
      const harness = makeSession({view,page,storage,responses:({url}) => url.endsWith('/handoff')
        ? jsonResponse(200,{token:'restored'})
        : jsonResponse(200,{turns:[],activeTurnId:null})});
      await harness.session.start();
      expect(harness.requests.filter(r => r.url.endsWith('/handoff'))).toHaveLength(reload ? 0 : 1);
      expect(view.errors).toEqual([]);
      harness.session.destroy();
    }
  });

  it('restores partial text and refuses an approved old-page action without replaying settled actions', async () => {
    const view = makeView();
    const page = makePage();
    page.bridge.takeHandoff = () => 'a'.repeat(64);
    const settled = '11111111-1111-4111-8111-111111111111';
    const pending = '22222222-2222-4222-8222-222222222222';
    const action = (actionId: string) => ({ actionId, kind: 'fill', targetId: 'e0', value: 'Jan',
      snapshotId: 's0123456789abcdef', requiresConfirmation: false, confirmationNonce: 'nonce-value-1234' });
    const harness = makeSession({ view, page, responses: ({ url }) => {
      if (url.endsWith('/handoff')) return jsonResponse(200, { token: 'restored-token' });
      if (url.endsWith('/conversation')) return jsonResponse(200, { schemaVersion: 2, activeTurnId: 'T',
        turns: [{ turnId: 'T', message: 'ahoj', reply: null, lastSeq: 3, pendingActions: [pending] }] });
      if (url.endsWith('/result')) return jsonResponse(200, {});
      return new Response(streamOf([frame('text_delta', { text: 'Before. ' }, 1),
        frame('action', action(settled), 2), frame('action', action(pending), 3),
        frame('text_delta', { text: 'After.' }, 4), frame('done', { text: 'Before. After.' }, 5)]));
    } });
    await harness.session.start();
    await flush();
    expect(view.answers).toEqual(['Before. After.']);
    expect(page.captures).toBe(0);
    expect(page.performed).toEqual([]);
    const reports = harness.requests.filter(request => request.url.endsWith('/result'));
    expect(reports).toHaveLength(1);
    expect(reports[0]?.url).toContain(pending);
    expect(reports[0]?.body).toMatchObject({ outcome: 'denied', detail: 'stale_snapshot' });
    expect(harness.requests.some(request => request.url.endsWith('/visitors'))).toBe(false);
  });

  it('does not replace a rejected handoff with a fresh unrelated conversation', async () => {
    const view = makeView();
    const page = makePage();
    page.bridge.takeHandoff = () => 'a'.repeat(64);
    const harness = makeSession({ view, page, responses: () => jsonResponse(403, { error: 'invalid_handoff' }) });
    await harness.session.start();
    await harness.session.send('Continue');
    expect(harness.requests).toHaveLength(1);
    expect(view.errors).toContain(strings.navigationFailed);
  });
});

describe('read-only appearance bootstrap on widget mount', () => {
  it('mounts the configured launcher without creating a visitor or token, even when an avatar is configured', async () => {
    const host = createChatbotHost();
    registerBot(host);
    await host.adapter.connect();
    const bot = host.store.listBots()[0]!;
    host.store.updateAppearance({
      chatbotUserId: bot.chatbot_user_id,
      expectedUpdatedAt: bot.updated_at,
      displayName: bot.display_name,
      appearance: JSON.stringify({ schemaVersion: 2, template: 'elowen', overrides: { avatarUrl: 'https://images.example.test/logo.png' } }),
      now: new Date().toISOString(),
    });
    const counts = () => ({
      visitors: (host.db.prepare('SELECT COUNT(*) AS count FROM p_chatbot_visitors').get() as { count: number }).count,
      tokens: (host.db.prepare('SELECT COUNT(*) AS count FROM p_chatbot_tokens').get() as { count: number }).count,
    });
    expect(counts()).toEqual({ visitors: 0, tokens: 0 });
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const path = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
      requests.push(path);
      const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
      const answer = await host.handler(postRequest({
        path,
        headers: { origin: CHATBOT_SITE },
        body,
      }));
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(answer.headers ?? {})) {
        for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name, item);
      }
      return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status, headers: responseHeaders });
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { mount } = await import('../plugins/chatbot/embed-src/index.js');
    const script = document.createElement('script');
    script.src = 'https://elowen.example/hooks/chatbot/v2/widget.js';
    script.dataset.chatbot = bot.public_id;
    document.body.append(script);
    const api = mount();
    try {
      await flush();
      expect(counts()).toEqual({ visitors: 0, tokens: 0 });
      expect(requests).toEqual(['bootstrap']);
      expect(document.querySelector('[data-elowen-chatbot="root"]')).not.toBeNull();
    } finally {
      api?.destroy();
      script.remove();
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('the confirmation a visitor answers', () => {
  function panel(): { panel: ChatPanel; confirmButton: HTMLButtonElement; cancelButton: HTMLButtonElement } {
    const instance = new ChatPanel({
      strings,
      look: { name: 'Městský úřad', appearance: DEFAULT_APPEARANCE },
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

  it.each([true, false])('keeps one answer outside a submission, including before render: mounted=%s', (mounted) => {
    const instance = new ChatPanel({
      strings,
      look: { name: 'Městský úřad', appearance: DEFAULT_APPEARANCE },
      onVisitorMessage: () => undefined,
      onStop: () => undefined,
    });
    if (mounted) document.body.append(instance.host);
    instance.beginAnswer();
    instance.streamAnswer('První část. ');
    instance.streamAnswer('Druhá část.');
    if (!mounted) document.body.append(instance.host);
    instance.finishAnswer('První část. Druhá část. Hotovo.');
    const chat = instance.host.shadowRoot!.querySelector('deep-chat') as unknown as { getMessages(): unknown[] };
    expect(chat.getMessages()).toEqual([
      { role: 'ai', text: 'První část. Druhá část. Hotovo.' },
    ]);
    instance.beginAnswer();
    instance.finishAnswer('Další odpověď.');
    expect(chat.getMessages()).toHaveLength(2);
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

describe('running control independent of local submission', () => {
  it.each(['finish', 'error', 'stop'] as const)('restores and clears running state on %s', end => {
    let stopped = 0;
    const panel = new ChatPanel({strings,look:{name:'Advisor',appearance:DEFAULT_APPEARANCE},onVisitorMessage(){},onStop(){stopped++;}});
    panel.beginAnswer();
    document.body.append(panel.host);
    let chat = panel.host.shadowRoot!.querySelector('deep-chat')!;
    expect(chat.hasAttribute('data-answer-active')).toBe(true);
    panel.streamAnswer('Resumed answer');
    panel.applyAppearance({name:'Updated',appearance:APPEARANCE_TEMPLATES.clean});
    chat = panel.host.shadowRoot!.querySelector('deep-chat')!;
    expect(chat.hasAttribute('data-answer-active')).toBe(true);
    panel.streamAnswer(' continued');
    expect((chat as unknown as {getMessages():unknown[]}).getMessages()).toEqual([{role:'ai',text:'Resumed answer continued'}]);
    if (end === 'finish') panel.finishAnswer('Complete');
    if (end === 'error') panel.error('Unavailable');
    if (end === 'stop') (chat as unknown as {customButtons:{onClick():void}[]}).customButtons[0]!.onClick();
    expect(chat.hasAttribute('data-answer-active')).toBe(false);
    expect(stopped).toBe(end === 'stop' ? 1 : 0);
    panel.destroy();
  });
});

describe('the look a panel is given', () => {
  it('repaints offers and feedback when a look arrives after the chat has rendered', () => {
    // The live widget always renders with the default look first and receives the chatbot's look later.
    // deep-chat applies `auxiliaryStyle` only on first render, so what the visitor sees must come from the
    // stylesheet the panel keeps in the chat's shadow root.
    const panel = new ChatPanel({ strings, look: { name: 'Advisor', appearance: DEFAULT_APPEARANCE },
      onVisitorMessage: () => undefined, onStop: () => undefined });
    document.body.append(panel.host);
    const salon = { ...APPEARANCE_TEMPLATES.clean, colors: { ...APPEARANCE_TEMPLATES.clean.colors, sendButton: '#ad5462' } };
    panel.applyAppearance({ name: 'Salon', appearance: salon });
    const chat = panel.host.shadowRoot!.querySelector('deep-chat')!;
    const looks = chat.shadowRoot!.querySelectorAll('style[data-cb-look]');
    expect(looks).toHaveLength(1);
    expect(looks[0]!.textContent).toContain('--cb-feedback-accent: #ad5462');
    expect(looks[0]!.textContent).not.toContain(`--cb-feedback-accent: ${DEFAULT_APPEARANCE.colors.sendButton}`);
    panel.destroy();
  });

  const panelWith = (look: ChatbotLook): ChatPanel => {
    const instance = new ChatPanel({ strings, look, onVisitorMessage: () => undefined, onStop: () => undefined });
    document.body.append(instance.host);
    return instance;
  };
  /** The message element as the panel configured it: what the visitor ends up looking at. */
  const chatOf = (instance: ChatPanel) => instance.host.shadowRoot!.querySelector('deep-chat') as unknown as {
    chatStyle: { backgroundColor: string };
    introMessage: { html: string };
    names: { ai: { text: string } };
    getMessages(): { role?: string; text?: string }[];
  };
  const look = (appearance = DEFAULT_APPEARANCE): ChatbotLook => ({ name: 'Městský úřad', appearance });
  /** The colour the conversation actually SITS ON.
   *
   *  Deliberately read from the panel's own stylesheet rather than from the message element's `chatStyle`:
   *  deep-chat reads that property when it first renders and keeps it, so an assertion on it passes for a
   *  ground the visitor never sees. That is exactly how a white template with a black conversation shipped. */
  const groundOf = (instance: ChatPanel): string | undefined =>
    /\.messages \{[^}]*background: (#[0-9a-f]{6})/i.exec(instance.host.shadowRoot!.querySelector('style')!.textContent ?? '')?.[1];

  it('reconfigures an empty message element in place when the look changes', () => {
    const instance = panelWith(look());
    const before = chatOf(instance);

    // An empty element can take a changed look in place; a populated one has its messages carried below.
    instance.applyAppearance({ name: 'Podatelna', appearance: { ...APPEARANCE_TEMPLATES.clean, header: { ...APPEARANCE_TEMPLATES.clean.header, showMessageName: true } } });

    const after = chatOf(instance);
    expect(after).toBe(before);
    expect(groundOf(instance)).toBe(APPEARANCE_TEMPLATES.clean.colors.panel);
    expect(after.chatStyle.backgroundColor).toBe('transparent');
    expect(after.names.ai.text).toBe('Podatelna');
    expect(instance.host.shadowRoot!.querySelector('.title')!.textContent).toBe('Podatelna');
    instance.destroy();
  });

  it('does not reconfigure the message input when the already-painted look is applied again', () => {
    const instance = panelWith(look());
    const configured = look(APPEARANCE_TEMPLATES.clean);
    instance.applyAppearance(configured);
    const chat = chatOf(instance);
    let reconfigurations = 0;
    Object.defineProperty(chat, 'introMessage', {
      configurable: true,
      set: () => { reconfigurations += 1; },
    });

    instance.applyAppearance(configured);
    expect(chatOf(instance)).toBe(chat);
    expect(reconfigurations).toBe(0);
    instance.destroy();
  });

  it('replaces the element and carries the conversation once there is one to lose', () => {
    const instance = panelWith(look());
    instance.finishAnswer('Hotovo');
    const before = chatOf(instance);
    expect(before.getMessages()).toEqual([{ role: 'ai', text: 'Hotovo' }]);

    instance.applyAppearance({ name: 'Městský úřad', appearance: APPEARANCE_TEMPLATES.clean });
    const after = chatOf(instance);
    expect(after).not.toBe(before);
    expect(after.getMessages()).toEqual([{ role: 'ai', text: 'Hotovo' }]);
    expect(groundOf(instance)).toBe(APPEARANCE_TEMPLATES.clean.colors.panel);
    instance.destroy();
  });

  it('draws the presence dot on the launcher corner only when the look asks for one', () => {
    const instance = panelWith(look());
    const shadow = () => instance.host.shadowRoot!;
    const css = () => shadow().querySelector('style')!.textContent ?? '';
    const dot = () => shadow().querySelector('.launcher-dot');
    const dotRule = () => /\.launcher-dot \{[^}]*\}/.exec(css())![0];

    // Off by default: the launcher stays the plain button it has always been, and nothing is left on the
    // stylesheet for a decoration nobody asked for.
    expect(dot()).toBeNull();
    expect(css()).not.toContain('.launcher-dot');

    const dotColour = '#22c55e';
    const dotted = (size: number): ChatbotLook => ({
      name: 'Městský úřad',
      appearance: { ...DEFAULT_APPEARANCE, launcher: { ...DEFAULT_APPEARANCE.launcher, presenceDot: true, presenceDotColor: dotColour, size } },
    });
    instance.applyAppearance(dotted(DEFAULT_APPEARANCE.launcher.size));

    const mark = dot();
    expect(mark).not.toBeNull();
    expect(shadow().querySelector('.launcher')!.contains(mark!)).toBe(true);
    // A decoration, and nothing else: no text, and nothing about it is read out or inspected as a statement
    // about whether anybody is available to answer.
    expect(mark!.getAttribute('aria-hidden')).toBe('true');
    expect(mark!.textContent).toBe('');

    // The colour the owner chose, ringed in the launcher's own colour so the mark stays visible on any page.
    expect(dotRule()).toContain(`background: ${dotColour}`);
    expect(dotRule()).toContain(`solid ${DEFAULT_APPEARANCE.colors.launcher}`);

    // Anchored to the corner of the launcher and measured from it, so every size the bounds allow keeps the
    // same place on the corner and the same weight.
    const geometry = [APPEARANCE_BOUNDS.launcherSize.min, APPEARANCE_BOUNDS.launcherSize.max].map((size) => {
      instance.applyAppearance(dotted(size));
      const rule = dotRule();
      expect(rule).toContain('position: absolute; top: 0; right: 0;');
      return { width: Number(/width: (\d+)px/.exec(rule)![1]), ring: Number(/border: (\d+)px solid/.exec(rule)![1]) };
    });
    expect(geometry[0]!.ring).toBeGreaterThanOrEqual(2);
    expect(geometry[1]!.width).toBeGreaterThan(geometry[0]!.width);

    // The gentle pulse follows the panel's own motion convention: a keyframe of its own, and the reader's own
    // preference switches it off.
    expect(css()).toContain('@keyframes cb-presence-pulse');
    expect(/@media \(prefers-reduced-motion: reduce\) \{\s*\.launcher-dot \{ animation: none; \}/.test(css())).toBe(true);

    // Turning it off takes the mark off the button rather than leaving it behind.
    instance.applyAppearance(look());
    expect(dot()).toBeNull();
    expect(css()).not.toContain('.launcher-dot');
    instance.destroy();
  });
});
describe('a transcript restored after the page was loaded again', () => {
  function mountedPanel(): ChatPanel {
    const instance = new ChatPanel({
      strings,
      look: { name: 'Městský úřad', appearance: DEFAULT_APPEARANCE },
      onVisitorMessage: () => undefined,
      onStop: () => undefined,
    });
    document.body.append(instance.host);
    return instance;
  }

  /** The stub element the panel drew into, with the scroll counter this assertion reads. */
  function chatOf(instance: ChatPanel): { getMessages(): unknown[]; scrolledToBottom: number } {
    return instance.host.shadowRoot!.querySelector('deep-chat') as unknown as
      { getMessages(): unknown[]; scrolledToBottom: number };
  }

  it('opens at the end, not at the first message', () => {
    const instance = mountedPanel();
    const chat = chatOf(instance);
    const before = chat.scrolledToBottom;

    instance.restore([
      { role: 'user', text: 'Dobrý den' },
      { role: 'ai', text: 'Dobrý den, jak mohu pomoci?' },
      { role: 'user', text: 'Chci se objednat' },
    ]);

    expect(chat.getMessages()).toHaveLength(3);
    expect(chat.scrolledToBottom).toBe(before);
    instance.open();
    expect(chat.scrolledToBottom).toBeGreaterThan(before);
    const settled = chat.scrolledToBottom;
    instance.close();
    instance.open();
    expect(chat.scrolledToBottom).toBe(settled);
    instance.destroy();
  });

  it('still opens at the end when the transcript arrives before the element has rendered', () => {
    const instance = new ChatPanel({
      strings,
      look: { name: 'Městský úřad', appearance: DEFAULT_APPEARANCE },
      onVisitorMessage: () => undefined,
      onStop: () => undefined,
    });
    instance.restore([{ role: 'user', text: 'Dobrý den' }, { role: 'ai', text: 'Dobrý den.' }]);
    document.body.append(instance.host);

    const chat = chatOf(instance);
    expect(chat.getMessages()).toHaveLength(2);
    expect(chat.scrolledToBottom).toBe(0);
    instance.open();
    expect(chat.scrolledToBottom).toBe(1);
    instance.destroy();
  });
});

describe('the avatar a customer\'s page is not asked to allow', () => {
  /** jsdom implements neither object URL call, and what the panel does with them is most of what this block
   *  is about, so they are recorded rather than emulated: what a real browser does with a `blob:` src is not
   *  something this environment could observe anyway. */
  function objectUrls(): { created: string[]; revoked: string[] } {
    const log = { created: [] as string[], revoked: [] as string[] };
    class StubbedUrl extends URL {}
    StubbedUrl.createObjectURL = () => {
      const url = `blob:https://example.test/${log.created.length + 1}`;
      log.created.push(url);
      return url;
    };
    StubbedUrl.revokeObjectURL = (url: string) => { log.revoked.push(url); };
    vi.stubGlobal('URL', StubbedUrl);
    return log;
  }
  afterEach(() => vi.unstubAllGlobals());

  const REMOTE = 'https://elowen.run/favicon.ico';
  const DATA = 'data:image/png;base64,iVBORw0KGgo=';
  const bytes = (): Blob => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  const lookWithAvatar = (avatarUrl: string, showAvatar = true): ChatbotLook => ({
    name: 'Městský úřad',
    appearance: { ...DEFAULT_APPEARANCE, avatarUrl, header: { ...DEFAULT_APPEARANCE.header, showAvatar } },
  });

  /** A panel mounted the way the widget mounts one: the built-in look first, the chatbot's own look applied
   *  when it arrives. That ordering is what makes the avatar a separate input rather than part of the look. */
  function mounted(loader?: () => Promise<Blob | null>): ChatPanel {
    const instance = new ChatPanel({
      strings,
      look: { name: '', appearance: DEFAULT_APPEARANCE },
      onVisitorMessage: () => undefined,
      onStop: () => undefined,
      ...(loader === undefined ? {} : { loadAvatar: loader }),
    });
    document.body.append(instance.host);
    return instance;
  }
  const avatarOf = (instance: ChatPanel): HTMLImageElement => instance.host.shadowRoot!.querySelector('img.header-avatar')!;
  const messageAvatarOf = (instance: ChatPanel): string | undefined =>
    (instance.host.shadowRoot!.querySelector('deep-chat') as unknown as { avatars?: { ai?: { src?: string } } }).avatars?.ai?.src;

  it('asks the public surface for the avatar over the visitor\'s own authorized connection', async () => {
    const harness = makeSession({
      view: makeView(),
      page: makePage(),
      responses: ({ url }) => url.endsWith('/avatar')
        ? new Response(new Uint8Array([9, 9]), { status: 200, headers: { 'content-type': 'image/png' } })
        : jsonResponse(200, { token: 'token-1' }),
    });
    const blob = await harness.session.loadAvatar();
    expect(blob).not.toBeNull();
    expect(blob!.size).toBe(2);
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([9, 9]));

    const asked = harness.requests.at(-1)!;
    expect(asked.url).toBe('https://elowen.example/hooks/chatbot/v2/avatar');
    expect(asked.method).toBe('GET');
    expect(asked.headers.authorization).toBe('ChatbotVisitor token-1');
    // The answer is an image, and the request says so rather than claiming a JSON body it will never read.
    expect(asked.headers.accept).toBe('image/*');
  });

  it('answers null for a deployment with no avatar, and asks exactly once', async () => {
    const harness = makeSession({
      view: makeView(),
      page: makePage(),
      responses: ({ url }) => url.endsWith('/avatar') ? jsonResponse(404, { error: 'no_avatar' }) : jsonResponse(200, { token: 'token-1' }),
    });
    expect(await harness.session.loadAvatar()).toBeNull();
    expect(harness.requests.filter((request) => request.url.endsWith('/avatar'))).toHaveLength(1);
  });

  it('can request a remote avatar after opening without resetting the unchanged chat input', async () => {
    let asked = 0;
    const instance = mounted(() => { asked += 1; return Promise.resolve(null); });
    const configured = lookWithAvatar(REMOTE);
    instance.applyAppearance(configured);
    expect(asked).toBe(1);
    const chat = instance.host.shadowRoot!.querySelector('deep-chat')!;
    let reconfigurations = 0;
    Object.defineProperty(chat, 'introMessage', { configurable: true, set: () => { reconfigurations += 1; } });

    instance.applyAppearance(configured);
    expect(asked).toBe(2);
    expect(instance.host.shadowRoot!.querySelector('deep-chat')).toBe(chat);
    expect(reconfigurations).toBe(0);
    instance.destroy();
  });

  it('shows the owner\'s image from bytes the widget fetched, in the header and beside the answers', async () => {
    const urls = objectUrls();
    let asked = 0;
    const instance = mounted(() => { asked += 1; return Promise.resolve(bytes()); });
    instance.applyAppearance(lookWithAvatar(REMOTE));
    await flush();

    expect(asked).toBe(1);
    expect(urls.created).toHaveLength(1);
    // ONE resolved source for both places the look's own image goes, so the header and the answers cannot
    // come to disagree about what the owner configured.
    expect(avatarOf(instance).hidden).toBe(false);
    expect(avatarOf(instance).getAttribute('src')).toBe(urls.created[0]);
    expect(messageAvatarOf(instance)).toBe(urls.created[0]);
    // Deliberately NOT the owner's address: that is the request a customer's `img-src` would have to allow.
    expect(avatarOf(instance).getAttribute('src')).not.toBe(REMOTE);
    instance.destroy();
  });

  it('releases the object URL it made when the look replaces it, and when the widget goes away', async () => {
    const urls = objectUrls();
    const instance = mounted(() => Promise.resolve(bytes()));
    instance.applyAppearance(lookWithAvatar(REMOTE));
    await flush();
    const [first] = urls.created;

    // A look whose avatar carries its own bytes needs no URL of ours, so the one we made is given back.
    instance.applyAppearance(lookWithAvatar(DATA));
    expect(urls.revoked).toEqual([first]);
    expect(avatarOf(instance).getAttribute('src')).toBe(DATA);

    // And a panel that goes away holds nothing either.
    instance.applyAppearance(lookWithAvatar(REMOTE));
    await flush();
    const second = urls.created[1];
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    instance.destroy();
    expect(urls.revoked).toEqual([first, second]);
  });

  it('uses an image that carries its own bytes exactly as it stands, and asks for nothing', async () => {
    const urls = objectUrls();
    let asked = 0;
    const instance = mounted(() => { asked += 1; return Promise.resolve(bytes()); });
    instance.applyAppearance(lookWithAvatar(DATA));
    await flush();

    expect(asked).toBe(0);
    expect(urls.created).toEqual([]);
    expect(avatarOf(instance).getAttribute('src')).toBe(DATA);
    expect(messageAvatarOf(instance)).toBe(DATA);
    instance.destroy();
  });

  it('shows the configured address directly when the panel has no way to ask for bytes', async () => {
    // The administrator's preview: no visitor credential, therefore no route to ask. It draws what the owner
    // typed, which is exactly what it previewed before the route existed.
    const instance = mounted();
    instance.applyAppearance(lookWithAvatar(REMOTE));
    await flush();
    expect(avatarOf(instance).getAttribute('src')).toBe(REMOTE);
    expect(messageAvatarOf(instance)).toBe(REMOTE);
    instance.destroy();
  });

  it('keeps the avatar hidden, and asks for nothing, when the look turns it off', async () => {
    let asked = 0;
    const instance = mounted(() => { asked += 1; return Promise.resolve(bytes()); });
    instance.applyAppearance(lookWithAvatar(REMOTE, false));
    await flush();

    expect(asked).toBe(0);
    expect(avatarOf(instance).hidden).toBe(true);
    expect(avatarOf(instance).hasAttribute('src')).toBe(false);
    expect(messageAvatarOf(instance)).toBeUndefined();
    instance.destroy();
  });

  it('leaves the avatar hidden, with no src at all, when the deployment has none to give', async () => {
    const urls = objectUrls();
    // Every refusal is the same to a visitor: a panel WITHOUT an avatar, never a broken image and never a
    // retry. The second panel is the same story for a fetch that fails outright.
    const empty = mounted(() => Promise.resolve(null));
    empty.applyAppearance(lookWithAvatar(REMOTE));
    await flush();
    const failing = mounted(() => Promise.reject(new Error('refused')));
    failing.applyAppearance(lookWithAvatar(REMOTE));
    await flush();

    for (const instance of [empty, failing]) {
      expect(avatarOf(instance).hidden).toBe(true);
      expect(avatarOf(instance).hasAttribute('src')).toBe(false);
      expect(messageAvatarOf(instance)).toBeUndefined();
      instance.destroy();
    }
    expect(urls.created).toEqual([]);
  });

  it('creates no object URL for a panel that has already gone away', async () => {
    const urls = objectUrls();
    const pending: { resolve: (blob: Blob | null) => void } = { resolve: () => undefined };
    const instance = mounted(() => new Promise<Blob | null>((resolve) => { pending.resolve = resolve; }));
    instance.applyAppearance(lookWithAvatar(REMOTE));
    instance.destroy();

    // The bytes arrive after the widget was removed: nothing may hold them, because nothing would release
    // them again.
    pending.resolve(bytes());
    await flush();
    expect(urls.created).toEqual([]);
  });
});

describe('shared attachments in deep-chat', () => {
  it('sends the selected file from deep-chat’s FormData transport with its latest message', () => {
    const submitted: { text: string; image: File | null }[] = [];
    const panel = new ChatPanel({ strings, look: { name: 'Advisor', appearance: DEFAULT_APPEARANCE },
      onVisitorMessage: (text, image) => { submitted.push({ text, image }); }, onStop: () => undefined });
    document.body.append(panel.host);
    const chat = panel.host.shadowRoot!.querySelector('deep-chat') as HTMLElement & {
      connect: { handler: (body: unknown, signals: unknown) => void };
      addMessage(message: { role: string; text: string }): void;
    };
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'picture.png', { type: 'image/png' });
    const body = new FormData();
    body.append('files', image);
    body.append('message1', JSON.stringify({ role: 'user', text: 'Older text' }));
    body.append('message2', JSON.stringify({ role: 'user', text: 'What is this?' }));
    chat.addMessage({ role: 'user', text: 'What is this?' });
    chat.connect.handler(body, { onOpen() {}, onResponse() {}, onClose() {}, stopClicked: {} });
    expect(submitted).toEqual([{ text: 'What is this?', image }]);
    panel.destroy();
  });

  it('accepts an image-only FormData submission after earlier messages without reusing their text', () => {
    const submitted: { text: string; image: File | null }[] = [];
    const panel = new ChatPanel({ strings, look: { name: 'Advisor', appearance: DEFAULT_APPEARANCE },
      onVisitorMessage: (text, image) => { submitted.push({ text, image }); }, onStop: () => undefined });
    document.body.append(panel.host);
    const chat = panel.host.shadowRoot!.querySelector('deep-chat') as HTMLElement & {
      connect: { handler: (body: unknown, signals: unknown) => void };
      addMessage(message: { role: string; text: string }): void;
    };
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'picture.png', { type: 'image/png' });
    const body = new FormData();
    body.append('files', image);
    body.append('message1', JSON.stringify({ role: 'user', text: 'Older text' }));
    chat.addMessage({ role: 'user', text: 'Older text' });
    chat.addMessage({ role: 'user', text: '' });
    chat.connect.handler(body, { onOpen() {}, onResponse() {}, onClose() {}, stopClicked: {} });
    expect(submitted).toEqual([{ text: '', image }]);
    panel.destroy();
  });
  it('creates Blob links only after guarded download, then revokes them on teardown', async () => {
    const revoked: string[] = [];
    class BlobUrls extends URL {}
    BlobUrls.createObjectURL = () => 'blob:https://example.test/shared';
    BlobUrls.revokeObjectURL = (url: string) => { revoked.push(url); };
    vi.stubGlobal('URL', BlobUrls);
    try {
      const panel = new ChatPanel({ strings, look: { name: 'Advisor', appearance: DEFAULT_APPEARANCE },
        onVisitorMessage: () => undefined, onStop: () => undefined });
      document.body.append(panel.host);
      const imageFile = { kind: 'image' as const, storedName: `${'b'.repeat(64)}.png` };
      panel.restore([{ role: 'ai', text: '', turnId: 'T', attachments: [imageFile] }]);
      panel.showAttachment('T', imageFile,
        async () => new Blob([new Uint8Array(12)], { type: 'image/png' }));
      await flush();
      const image = panel.host.shadowRoot!.querySelector('deep-chat')!.shadowRoot!.querySelector<HTMLImageElement>('.cb-shared-file img');
      expect(image?.src).toBe('blob:https://example.test/shared');
      expect(image?.alt).toBe('');
      // The thumbnail opens the image over the page; it never navigates away from the customer's site.
      expect(image?.closest('a')).toBeNull();
      const open = image!.closest<HTMLButtonElement>('button')!;
      expect(open.type).toBe('button');
      expect(open.getAttribute('aria-label')).toBe(strings.attachmentImage);
      expect(open.textContent).toBe('');

      panel.open();
      const shell = panel.host.shadowRoot!;
      const lightbox = shell.querySelector<HTMLElement>('.cb-lightbox')!;
      const close = lightbox.querySelector<HTMLButtonElement>('.cb-lightbox-close')!;
      expect(lightbox.hidden).toBe(true);
      open.click();
      expect(lightbox.hidden).toBe(false);
      expect(lightbox.getAttribute('role')).toBe('dialog');
      expect(lightbox.querySelector('img')?.src).toBe('blob:https://example.test/shared');
      expect(close.getAttribute('aria-label')).toBe(strings.imageClose);
      expect(shell.activeElement).toBe(close);
      // A click on the image itself keeps it open; a click beside it closes it.
      lightbox.querySelector('img')!.click();
      expect(lightbox.hidden).toBe(false);
      lightbox.click();
      expect(lightbox.hidden).toBe(true);
      // Escape closes the image first and leaves the chat open.
      open.click();
      panel.host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(lightbox.hidden).toBe(true);
      expect(panel.isOpen()).toBe(true);
      open.click();
      close.click();
      expect(lightbox.hidden).toBe(true);
      expect(lightbox.querySelector('img')?.hasAttribute('src')).toBe(false);
      panel.destroy();
      expect(revoked).toEqual(['blob:https://example.test/shared']);
    } finally { vi.unstubAllGlobals(); }
  });
  it('keeps a file-only restored answer and deduplicates a replayed attachment', async () => {
    const panel = new ChatPanel({ strings, look: { name: 'Advisor', appearance: DEFAULT_APPEARANCE },
      onVisitorMessage: () => undefined, onStop: () => undefined });
    document.body.append(panel.host);
    const turnId = 'turn-image';
    const file = { kind: 'file' as const, storedName: `${'a'.repeat(64)}.bin`, name: 'report.pdf', size: 12 };
    panel.restore([{ role: 'user', text: '', uploadName: 'photo.png' },
      { role: 'ai', text: '', turnId, attachments: [file] }]);
    panel.showAttachment(turnId, file, async () => null);
    panel.showAttachment(turnId, file, async () => null);
    await flush();
    const chat = panel.host.shadowRoot!.querySelector('deep-chat')!;
    expect(chat.shadowRoot!.querySelector('.cb-upload-name')?.textContent).toBe('photo.png');
    expect(chat.shadowRoot!.querySelectorAll('.cb-shared-file')).toHaveLength(1);
    expect(chat.shadowRoot!.querySelector('.cb-shared-file')?.textContent).toBe('report.pdf');
    expect(chat.shadowRoot!.querySelector('.cb-shared-file-chip .cb-shared-file-name')?.textContent).toBe('report.pdf');
    expect(chat.shadowRoot!.querySelectorAll('.cb-shared-file-chip svg')).toHaveLength(2);
    panel.destroy();
  });
  it('uses the visitor locale for the picker and image action, never an agent caption', async () => {
    for (const locale of ['cs', 'sk', 'en'] as const) {
      const translated = widgetStrings(locale);
      const panel = new ChatPanel({ strings: translated, look: { name: 'Advisor', appearance: DEFAULT_APPEARANCE },
        onVisitorMessage: () => undefined, onStop: () => undefined });
      document.body.append(panel.host);
      const chat = panel.host.shadowRoot!.querySelector('deep-chat') as HTMLElement & { images?: {
        button?: { position?: string; tooltip?: { text?: string } };
      } };
      expect(chat.images?.button).toMatchObject({ position: 'inside-start', tooltip: { text: translated.attachImage } });
      const file = { kind: 'image' as const, storedName: `${'c'.repeat(64)}.png`, caption: 'Preview' };
      panel.restore([{ role: 'ai', text: '', turnId: 'T', attachments: [file] }]);
      panel.showAttachment('T', file, async () => new Blob([new Uint8Array(12)], { type: 'image/png' }));
      await flush();
      const root = chat.shadowRoot!;
      expect(root.querySelector('.cb-shared-image button')?.getAttribute('aria-label')).toBe(translated.attachmentImage);
      expect(panel.host.shadowRoot!.querySelector('.cb-lightbox-close')?.getAttribute('aria-label')).toBe(translated.imageClose);
      expect(root.querySelector('.cb-shared-image')?.textContent).not.toContain('Preview');
      panel.destroy();
    }
  });
});

describe('offer messages in deep-chat', () => {
  it('draws escaped card text, keeps old choices disabled and sends a clicked active reply once', () => {
    const sent: string[] = [];
    const panel = new ChatPanel({
      strings,
      look: { name: 'Advisor', appearance: DEFAULT_APPEARANCE },
      onVisitorMessage: (text) => { sent.push(text); },
      onStop: () => undefined,
    });
    document.body.append(panel.host);
    panel.setAllowedOrigins(['https://example.test']);
    panel.restore([
      { role: 'ai', text: 'Earlier', offer: { choices: [{ label: 'Old' }] }, offerActive: false },
      { role: 'ai', text: 'Latest', offer: {
        choices: [{ label: 'Select', reply: 'Sent reply' }],
        cards: [{ title: '<b>markup</b>', action: { label: 'Details', url: 'https://example.test/details' } }],
      }, offerActive: true },
    ]);
    const chat = panel.host.shadowRoot!.querySelector('deep-chat') as HTMLElement & { getMessages(): { html?: string; text?: string }[] };
    const messages = chat.getMessages();
    expect(messages.map(message => message.text)).toEqual(['Earlier', 'Latest']);
    const answers = chat.shadowRoot!.querySelectorAll<HTMLElement>('[data-cb-answer-index]');
    expect(answers).toHaveLength(2);
    expect(answers[0]!.querySelector('.cb-offer button')?.hasAttribute('disabled')).toBe(true);
    expect(answers[1]!.textContent).toContain('<b>markup</b>');
    expect(answers[1]!.querySelector('b')).toBeNull();
    const button = answers[1]!.querySelector<HTMLButtonElement>('[data-cb-text="Sent reply"]')!;
    button.click();
    expect(sent).toEqual(['Sent reply']);
    // Through the panel's own submit, which is what shows the typing indicator, and drawn once.
    expect((chat as unknown as { submitted: string[] }).submitted).toEqual(['Sent reply']);
    expect(chat.getMessages().map(message => message.text)).toEqual(['Earlier', 'Latest', 'Sent reply']);
    button.click();
    expect(sent).toEqual(['Sent reply']);
    panel.destroy();
  });

  it('keeps live attachments with their answer across an appearance redraw and disables old offers', () => {
    const panel = new ChatPanel({ strings, look: { name: 'Advisor', appearance: DEFAULT_APPEARANCE },
      onVisitorMessage: () => undefined, onStop: () => undefined });
    document.body.append(panel.host);
    panel.beginAnswer();
    panel.streamAnswer('Live **answer**');
    panel.finishAnswer('Live **answer**');
    panel.showOffer({ choices: [{ label: 'First' }] }, true);
    panel.showFeedback('live-turn', null);
    let chat = panel.host.shadowRoot!.querySelector('deep-chat')!;
    expect(chat.shadowRoot!.querySelectorAll('[data-cb-answer-index]')).toHaveLength(1);
    expect(chat.shadowRoot!.querySelector('.text-message .cb-feedback-votes')).not.toBeNull();
    // The offer sits INSIDE the answer bubble, like the greeting's quick buttons; nothing is added beside it.
    expect(chat.shadowRoot!.querySelector('.text-message .cb-offer')).not.toBeNull();
    expect(chat.shadowRoot!.querySelector('.inner-message-container > .cb-attachments')).toBeNull();
    expect(chat.shadowRoot!.querySelector('.cb-offer button')?.hasAttribute('disabled')).toBe(false);
    panel.beginAnswer();
    expect(chat.shadowRoot!.querySelector('.cb-offer button')?.hasAttribute('disabled')).toBe(true);
    panel.finishAnswer('Another answer');
    panel.applyAppearance({ name: 'Advisor', appearance: APPEARANCE_TEMPLATES.indigo });
    chat = panel.host.shadowRoot!.querySelector('deep-chat')!;
    expect(chat.getMessages().map(message => message.text)).toEqual(['Live **answer**', 'Another answer']);
    expect(chat.shadowRoot!.querySelector('[data-cb-answer-index="0"] .cb-offer button')?.hasAttribute('disabled')).toBe(true);
    expect(chat.shadowRoot!.querySelector('[data-cb-answer-index="0"] .text-message .cb-feedback-votes')).not.toBeNull();
    panel.destroy();
  });

  it('keeps only the second live offer frame and renders it after the answer', async () => {
    const view = makeView();
    const first = { choices: [{ label: 'First' }] };
    const last = { choices: [{ label: 'Last', reply: 'Last reply' }] };
    const harness = makeSession({ view, page: makePage(), responses: ({ method, url }) => {
      if (url.endsWith('/bootstrap')) return jsonResponse(200, {
        name: 'Bot', appearance: DEFAULT_APPEARANCE, allowedOrigins: ['https://example.test'],
      });
      if (method === 'POST' && url.endsWith('/visitors')) return jsonResponse(200, { token: 'token-1' });
      if (method === 'POST' && url.endsWith('/turns')) return jsonResponse(202, { turnId: 'T' });
      return new Response(streamOf([frame('offer', first, 1), frame('offer', last, 2),
        frame('done', { text: 'Pick one.' }, 3)]), { status: 200 });
    } });
    await harness.session.loadAppearance();
    await harness.session.send('Choose');
    expect(view.offered).toEqual([{ offer: last, active: true }]);
    expect(view.answers.at(-1)).toBe('Pick one.');
  });
});

describe('visitor feedback controls', () => {
  it('posts a thumb, skips or sends a comment, changes the vote and restores its selected icon', async () => {
    const saved: { rating: 'up' | 'down'; comment: string | null }[] = [];
    const turnId = '550e8400-e29b-41d4-a716-446655440000';
    const panel = new ChatPanel({
      strings, look: { name: 'Advisor', appearance: DEFAULT_APPEARANCE },
      onVisitorMessage: () => undefined, onStop: () => undefined,
      onFeedback: async (_turn, rating, comment) => {
        saved.push({ rating, comment });
        return { rating, comment };
      },
    });
    document.body.append(panel.host);
    panel.restore([{ role: 'ai', text: 'An answer', turnId, feedback: null }]);
    const chat = panel.host.shadowRoot!.querySelector('deep-chat') as HTMLElement & { getMessages(): { text?: string }[] };
    const group = () => chat.shadowRoot!.querySelector<HTMLElement>('[data-cb-answer-index]')!;
    const click = (selector: string) => group().querySelector<HTMLButtonElement>(selector)!.click();
    expect(chat.getMessages().map(message => message.text)).toEqual(['An answer']);
    expect(group().querySelectorAll('[aria-pressed="false"]')).toHaveLength(2);
    click('[data-cb-rating="down"]');
    await flush();
    expect(saved).toEqual([{ rating: 'down', comment: null }]);
    expect(group().querySelector('[data-cb-rating="down"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(group().querySelector('textarea')).not.toBeNull();
    click('.cb-feedback-skip');
    expect(group().querySelector('textarea')).toBeNull();
    click('[data-cb-rating="down"]');
    expect(group().querySelector('.cb-feedback')?.classList.contains('cb-feedback-editing')).toBe(true);
    click('[data-cb-rating="up"]');
    await flush();
    group().querySelector('textarea')!.value = 'Useful detail';
    click('.cb-feedback-send');
    await flush();
    expect(saved).toEqual([{ rating: 'down', comment: null }, { rating: 'up', comment: null }, { rating: 'up', comment: 'Useful detail' }]);
    expect(group().querySelector('textarea')).toBeNull();
    panel.destroy();

    const restored = new ChatPanel({ strings, look: { name: 'Advisor', appearance: DEFAULT_APPEARANCE },
      onVisitorMessage: () => undefined, onStop: () => undefined });
    document.body.append(restored.host);
    restored.restore([{ role: 'ai', text: 'An answer', turnId, feedback: { rating: 'up', comment: 'Useful detail' } }]);
    const again = restored.host.shadowRoot!.querySelector('deep-chat')!.shadowRoot!.querySelector<HTMLElement>('[data-cb-answer-index]')!;
    expect(again.querySelector('[data-cb-rating="up"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(again.querySelector('.text-message')?.textContent).toContain('An answer');
    restored.destroy();
  });
});
