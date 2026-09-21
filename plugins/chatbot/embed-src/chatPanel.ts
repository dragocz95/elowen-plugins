/** The chat panel: a launcher, a header, `deep-chat`'s message view, and the confirmation a visitor answers
 *  in person.
 *
 *  Everything lives in an OPEN shadow root on one element the widget appends to the page. That is the whole
 *  isolation story: a customer's stylesheet cannot reach in and break the panel, and the panel's styles
 *  cannot leak out into the page it is helping with. `deep-chat` renders its own shadow root inside this
 *  one, and it RENDERS messages only — the network, the protocol and the model are all elsewhere, which is
 *  exactly the split the plan asks for.
 *
 *  The visitor's own words reach the conversation through `connect.handler`, so the widget answers with its
 *  own transport instead of any of deep-chat's built-in service clients. None of those clients is
 *  configured: the `connect` object carries no url, so nothing in this panel can call a model provider. */

import 'deep-chat';
import type { DeepChat } from 'deep-chat';
import type { ChatView } from './session.js';
import type { WidgetStrings } from './strings.js';

/** The host's design system, declared here because the widget is the one surface that cannot read the host's
 *  stylesheet: it runs on a third party's page, inside a shadow root, with no build step that could resolve
 *  a token. The values are the plugin UI kit's mirror of the host tokens, so the widget still reads as the
 *  same product on a page that has never heard of it. */
const PALETTE = {
  background: '#070707',
  surface: '#151515',
  border: '#242424',
  foreground: '#f7f3f0',
  muted: '#9d948e',
  primary: '#ff5236',
  primaryHot: '#ff735c',
  ember: '#ff9a62',
  radius: '16px',
} as const;

/** The widget's own type stack. One home for it: the panel's stylesheet and the chat element both read it,
 *  and it is deliberately not deep-chat's default (see `chatStyle.fontFamily` below). */
const FONT_STACK = "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const WIDGET_STYLE = `
.root {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  display: flex; flex-direction: column; align-items: flex-end; gap: 12px;
  color: ${PALETTE.foreground}; line-height: 1.4; letter-spacing: normal; text-align: left; direction: ltr;
  font-family: ${FONT_STACK};
  font-size: 14px; font-style: normal; font-weight: 400; text-transform: none; white-space: normal;
}
*, *::before, *::after { box-sizing: border-box; }
.launcher {
  border: 1px solid ${PALETTE.border}; background: ${PALETTE.primary}; color: ${PALETTE.background};
  font: inherit; font-size: 14px; font-weight: 600; padding: 12px 18px; border-radius: 999px; cursor: pointer;
  box-shadow: 0 14px 40px rgb(0 0 0 / 0.35);
}
.launcher:hover { background: ${PALETTE.primaryHot}; }
.launcher:focus-visible { outline: 2px solid ${PALETTE.ember}; outline-offset: 2px; }
.launcher[hidden] { display: none; }
.panel {
  display: flex; flex-direction: column;
  width: min(380px, calc(100vw - 32px)); height: min(560px, calc(100vh - 140px));
  background: ${PALETTE.background}; border: 1px solid ${PALETTE.border}; border-radius: ${PALETTE.radius};
  box-shadow: 0 24px 64px rgb(0 0 0 / 0.5); overflow: hidden;
}
.panel[hidden] { display: none; }
.header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 16px; border-bottom: 1px solid ${PALETTE.border}; background: ${PALETTE.surface};
}
.title { margin: 0; font-size: 15px; font-weight: 600; color: ${PALETTE.foreground}; }
.close {
  border: 1px solid transparent; background: transparent; color: ${PALETTE.muted};
  font: inherit; font-size: 14px; padding: 6px 10px; border-radius: 8px; cursor: pointer;
}
.close:hover { color: ${PALETTE.foreground}; border-color: ${PALETTE.border}; }
.close:focus-visible { outline: 2px solid ${PALETTE.ember}; outline-offset: 1px; }
.status { margin: 0; padding: 10px 16px; border-bottom: 1px solid ${PALETTE.border}; background: ${PALETTE.background}; color: ${PALETTE.muted}; font-size: 13px; line-height: 1.45; }
.status[hidden] { display: none; }
.status-error { color: ${PALETTE.ember}; }
.messages { flex: 1 1 auto; min-height: 0; display: flex; }
.messages > deep-chat { flex: 1 1 auto; min-height: 0; }
.confirm {
  border-top: 1px solid ${PALETTE.border}; background: ${PALETTE.surface}; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 10px;
}
.confirm[hidden] { display: none; }
.confirm-title { margin: 0; font-size: 14px; font-weight: 600; color: ${PALETTE.foreground}; }
.confirm-body { margin: 0; font-size: 13px; line-height: 1.5; color: ${PALETTE.muted}; }
.confirm-actions { display: flex; gap: 8px; }
.confirm-actions button { font: inherit; font-size: 14px; font-weight: 600; padding: 10px 14px; border-radius: 10px; cursor: pointer; }
.confirm-yes { flex: 1 1 auto; border: 1px solid ${PALETTE.primary}; background: ${PALETTE.primary}; color: ${PALETTE.background}; }
.confirm-yes:hover { background: ${PALETTE.primaryHot}; }
.confirm-no { border: 1px solid ${PALETTE.border}; background: transparent; color: ${PALETTE.foreground}; }
.confirm-no:hover { border-color: ${PALETTE.muted}; }
.confirm-actions button:focus-visible { outline: 2px solid ${PALETTE.ember}; outline-offset: 2px; }
`;

/** The little the panel uses of a chat element's streaming signals. Named here rather than imported from the
 *  library's internals, because this is the whole of the shape the widget relies on. */
interface StreamSignals {
  onResponse(response: { text?: string; overwrite?: boolean }): Promise<void>;
  onOpen(): void;
  onClose(): void;
  stopClicked: { listener: () => void };
}

type ChatElement = DeepChat & HTMLElement;

export interface ChatPanelOptions {
  strings: WidgetStrings;
  /** The chatbot's display name; the panel falls back to a generic title when it has none. */
  botName: string;
  /** Where the visitor's own message goes. The panel never sends anything itself. */
  onVisitorMessage: (text: string) => void;
  /** What the stop button does: stop watching the answer. The turn itself keeps running. */
  onStop: () => void;
}

export class ChatPanel implements ChatView {
  /** The element the widget appended. It carries the attribute the page snapshot excludes, so the panel is
   *  never described to the agent as part of the customer's page. */
  readonly host: HTMLDivElement;
  private readonly strings: WidgetStrings;
  private readonly chat: ChatElement;
  private readonly panel: HTMLElement;
  private readonly launcher: HTMLButtonElement;
  private readonly confirmBox: HTMLElement;
  private readonly confirmTitle: HTMLElement;
  private readonly status: HTMLElement;
  private readonly confirmYes: HTMLButtonElement;
  private readonly onVisitorMessage: (text: string) => void;
  private readonly onStop: () => void;
  /** The answer as it stands, accumulated here so every later piece replaces one message rather than adding
   *  another, whether the pieces came from a live stream, a reconnect or a restored turn. */
  private answer = '';
  private answerIndex: number | null = null;
  private signals: StreamSignals | null = null;
  private pendingConfirmation: ((confirmed: boolean) => void) | null = null;

  constructor(options: ChatPanelOptions) {
    this.strings = options.strings;
    this.onVisitorMessage = options.onVisitorMessage;
    this.onStop = options.onStop;

    this.host = document.createElement('div');
    this.host.setAttribute('data-elowen-chatbot', 'root');
    // Inline styles on the host element are the one thing a page's own stylesheet cannot reach without
    // `!important`, which is what keeps the launcher where it belongs on a page that styles every `div`.
    this.host.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;z-index:2147483000;';
    const shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = WIDGET_STYLE;
    const root = document.createElement('div');
    root.className = 'root';

    this.launcher = document.createElement('button');
    this.launcher.type = 'button';
    this.launcher.className = 'launcher';
    this.launcher.setAttribute('aria-haspopup', 'dialog');
    this.launcher.setAttribute('aria-expanded', 'false');
    this.launcher.textContent = this.strings.launcher;

    this.panel = document.createElement('section');
    this.panel.className = 'panel';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', this.title(options.botName));
    this.panel.hidden = true;

    const header = document.createElement('header');
    header.className = 'header';
    const title = document.createElement('h2');
    title.className = 'title';
    title.textContent = this.title(options.botName);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.textContent = this.strings.close;
    header.append(title, close);

    this.status = document.createElement('p');
    this.status.className = 'status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.hidden = true;

    const messages = document.createElement('div');
    messages.className = 'messages';
    this.chat = document.createElement('deep-chat') as ChatElement;
    this.chat.connect = { stream: true, handler: (body, signals) => this.handleSubmit(body, signals as unknown as StreamSignals) };
    this.chat.textInput = {
      placeholder: { text: this.strings.placeholder, style: { color: PALETTE.muted } },
      styles: {
        text: { color: PALETTE.foreground },
        container: { backgroundColor: PALETTE.background, border: 'none', padding: '10px 12px' },
      },
    };
    this.chat.introMessage = { text: this.strings.intro };
    this.chat.names = { ai: { text: this.title(options.botName), position: 'start' } };
    // `fontFamily` is set here for a reason beyond typography: deep-chat appends a Google Fonts stylesheet to
    // the page's <head> unless the chat carries a family of its own, and a widget on a customer's site may not
    // call out to a font host. A family of our own is the supported way to say so — and it means a page that
    // already has Inter keeps it, while every other page falls back to the system stack.
    this.chat.chatStyle = {
      backgroundColor: PALETTE.background,
      border: 'none',
      width: '100%',
      height: '100%',
      fontSize: '14px',
      fontFamily: FONT_STACK,
    };
    this.chat.messageStyles = {
      default: {
        shared: { outerContainer: { padding: '4px 12px' }, bubble: { fontFamily: FONT_STACK } },
        ai: { innerContainer: { backgroundColor: PALETTE.surface, color: PALETTE.foreground, border: `1px solid ${PALETTE.border}` } },
        user: { innerContainer: { backgroundColor: PALETTE.primary, color: PALETTE.background } },
      },
    };
    this.chat.errorMessages = { displayServiceErrorMessages: false };
    // Deep-chat renders inside its own shadow root, which our stylesheet cannot reach; this is the hook the
    // library provides for exactly that.
    this.chat.auxiliaryStyle = `
      .message-bubble { border-radius: 14px; }
      .error-message-text { color: ${PALETTE.ember}; }
      .intro-panel { color: ${PALETTE.foreground}; }
    `;
    messages.append(this.chat);

    this.confirmBox = document.createElement('div');
    this.confirmBox.className = 'confirm';
    this.confirmBox.hidden = true;
    this.confirmTitle = document.createElement('p');
    this.confirmTitle.className = 'confirm-title';
    const confirmBody = document.createElement('p');
    confirmBody.className = 'confirm-body';
    confirmBody.textContent = this.strings.confirmBody;
    const actions = document.createElement('div');
    actions.className = 'confirm-actions';
    this.confirmYes = document.createElement('button');
    this.confirmYes.type = 'button';
    this.confirmYes.className = 'confirm-yes';
    this.confirmYes.textContent = this.strings.confirmSubmit;
    const confirmNo = document.createElement('button');
    confirmNo.type = 'button';
    confirmNo.className = 'confirm-no';
    confirmNo.textContent = this.strings.confirmCancel;
    actions.append(this.confirmYes, confirmNo);
    this.confirmBox.append(this.confirmTitle, confirmBody, actions);

    this.panel.append(header, this.status, messages, this.confirmBox);
    root.append(this.panel, this.launcher);
    shadow.append(style, root);

    this.launcher.addEventListener('click', () => this.toggle(true));
    close.addEventListener('click', () => this.toggle(false));
    // The two answers are wired to REAL clicks. A page can dispatch a click on this button as often as it
    // likes and `isTrusted` is false for every one of them: a submit that could be triggered that way would
    // be a submit the visitor never confirmed, which is the single thing this panel exists to prevent. A
    // cancel needs no such check — it performs nothing.
    this.confirmYes.addEventListener('click', (event) => {
      // An untrusted click is not an answer: the page dispatched it, so it decides nothing and the question
      // stays open. Only a click the visitor made can confirm.
      if (event.isTrusted) this.answerConfirmation(true);
    });
    confirmNo.addEventListener('click', () => this.answerConfirmation(false));
    this.host.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape' && !this.panel.hidden) this.toggle(false);
    });
  }

  open(): void {
    this.toggle(true);
  }

  close(): void {
    this.toggle(false);
  }

  isOpen(): boolean {
    return !this.panel.hidden;
  }

  // ── the view contract the conversation uses ────────────────────────────────────────────────────────

  /** Show a message the visitor sent on a path that is not the panel's own submit — one restored from the
   *  server's projection, or one a site sends with `window.ElowenChatbot`.
   *
   *  Deliberately NOT deep-chat's `submitUserMessage`: that one goes through the submit path, which is what
   *  ASKS for a turn. A restored message rendered with it would become a second turn of its own — the same
   *  words asked of the model again, on every reload — and a message shown on the visitor's behalf would
   *  loop straight back into this widget. `addMessage` only draws it. */
  appendVisitor(text: string): void {
    this.chat.addMessage({ role: 'user', text });
  }

  beginAnswer(): void {
    this.answer = '';
    this.answerIndex = null;
    this.clearStatus();
    this.signals?.onOpen();
  }

  streamAnswer(text: string): void {
    this.answer += text;
    if (this.signals) return void this.signals.onResponse({ text });
    // An answer that arrives with no panel submission behind it — a turn resumed after a reload — is written
    // through the panel's own message list instead, which is the same path a notice would take.
    this.writeAnswer(this.answer, false);
  }

  finishAnswer(text: string): void {
    // The terminal frame carries the WHOLE answer, and it is rendered as an overwrite: a delta lost on the
    // way, or replayed by a reconnect, cannot leave the visitor reading a message that never existed.
    this.answer = text === '' ? this.answer : text;
    const signals = this.signals;
    this.signals = null;
    this.answerIndex = null;
    this.clearStatus();
    if (signals === null) {
      this.writeAnswer(this.answer, true);
      return;
    }
    // The overwrite is what the visitor ends up reading, so the response is only closed once it has been
    // taken: a response closed first keeps whatever the last delta left behind.
    const written = signals.onResponse({ text: this.answer, overwrite: true });
    void Promise.resolve(written).then(() => signals.onClose(), () => signals.onClose());
  }

  /** What the panel has to say about the CONVERSATION rather than in it: a reconnection, a declined
   *  confirmation, a failure. It is a status line above the messages, never a message of its own — the
   *  transcript holds what the visitor said and what the chatbot answered, and nothing else. */
  notice(text: string): void {
    this.setStatus(text, false);
  }

  error(text: string): void {
    this.setStatus(text, true);
    this.signals?.onClose();
    this.signals = null;
    this.answerIndex = null;
  }

  /** A transcript rebuilt from the server's projection, message by message, through the same path everything
   *  else takes — which draws each one and asks the server for nothing. */
  restore(messages: { role: 'user' | 'ai'; text: string }[]): void {
    for (const message of messages) {
      if (message.role === 'user') this.appendVisitor(message.text);
      else this.chat.addMessage({ role: 'ai', text: message.text });
    }
  }

  /** Ask the visitor. Resolves true only for a click the visitor made themselves. */
  confirm(request: { title: string }): Promise<boolean> {
    this.toggle(true);
    this.confirmTitle.textContent = request.title;
    this.confirmBox.hidden = false;
    this.confirmYes.focus();
    return new Promise<boolean>((resolve) => {
      // A confirmation already waiting is refused rather than queued: two irreversible steps at once is a
      // state this widget never puts a visitor in.
      this.pendingConfirmation?.(false);
      this.pendingConfirmation = resolve;
    });
  }

  destroy(): void {
    this.pendingConfirmation?.(false);
    this.pendingConfirmation = null;
    this.host.remove();
  }

  private setStatus(text: string, failed: boolean): void {
    this.status.textContent = text;
    this.status.classList.toggle('status-error', failed);
    this.status.hidden = false;
  }

  private clearStatus(): void {
    this.status.hidden = true;
    this.status.textContent = '';
    this.status.classList.remove('status-error');
  }

  private title(botName: string): string {
    return botName === '' ? this.strings.title : botName;
  }

  private toggle(open: boolean): void {
    this.panel.hidden = !open;
    this.launcher.hidden = open;
    this.launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) this.chat.focusInput();
  }

  private answerConfirmation(confirmed: boolean): void {
    this.confirmBox.hidden = true;
    const resolve = this.pendingConfirmation;
    this.pendingConfirmation = null;
    resolve?.(confirmed);
  }

  /** Deep-chat hands the visitor's message to the widget's own transport. Its body is what it would have
   *  posted to a service; the widget reads the visitor's last words out of it and nothing else. */
  private handleSubmit(body: unknown, signals: StreamSignals): void {
    const text = lastUserText(body);
    if (text === '') {
      signals.onClose();
      return;
    }
    this.signals = signals;
    this.answerIndex = null;
    signals.stopClicked.listener = () => this.onStop();
    this.onVisitorMessage(text);
  }

  /** A message written through the panel's own message list, for content that arrives outside a submit: a
   *  restored turn, a notice, an answer resumed after a reload. */
  private writeAnswer(text: string, update: boolean): void {
    const message = { role: 'ai', text };
    if (!update || this.answerIndex === null) {
      this.chat.addMessage(message);
      this.answerIndex = this.chat.getMessages().length - 1;
      return;
    }
    this.chat.updateMessage({ text }, this.answerIndex);
  }
}

/** The visitor's last message out of a chat body, whatever shape the library chose for it. */
function lastUserText(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as { role?: unknown; text?: unknown };
    if (record.role !== undefined && record.role !== 'user') continue;
    if (typeof record.text === 'string' && record.text.trim() !== '') return record.text;
  }
  return '';
}
