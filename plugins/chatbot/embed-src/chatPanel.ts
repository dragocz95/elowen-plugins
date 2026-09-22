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
 *  configured: the `connect` object carries no url, so nothing in this panel can call a model provider.
 *
 *  The panel is drawn from ONE value, the chatbot's appearance (appearanceContract.ts), and so is the panel
 *  CHROME that deep-chat does not own: the header, the status line and the confirmation are this file's own
 *  stylesheet, generated from the same appearance. Nothing here decides a colour of its own. */

import 'deep-chat';
import type { DeepChat } from 'deep-chat';
import {
  appearanceRamp,
  APPEARANCE_SHADOWS,
  appearanceFontStack,
  appearanceInk,
  appearanceIconSvg,
  appearanceShade,
  type ChatbotAppearance,
  type ChatbotLook,
} from '../src/appearanceContract.js';
import type { ChatView } from './session.js';
import type { WidgetStrings } from './strings.js';

/** How much vertical room the panel leaves for the launcher and for a browser's own chrome. The visitor's
 *  viewport is the only thing that can force a panel to be smaller than the customer configured, so the
 *  clamp below is the one place that happens. */
const LAUNCHER_GAP_PX = 12;

export function appearanceViewportInset(appearance: ChatbotAppearance): { width: number; height: number } {
  return { width: appearance.launcher.offset * 2, height: appearance.launcher.offset * 2 + appearance.launcher.size + LAUNCHER_GAP_PX };
}

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
  look: ChatbotLook;
  /** Where the visitor's own message goes. The panel never sends anything itself. */
  onVisitorMessage: (text: string) => void;
  /** What the stop button does: stop watching the answer. The turn itself keeps running. */
  onStop: () => void;
  /** The panel was opened — a click the visitor made, and therefore the first thing the widget may ask the
   *  server for. See `mount()`. */
  onOpen?: () => void;
}

/** Text that cannot become markup. The greeting and every quick button come from a configuration, and they
 *  are drawn as the intro message's HTML so the buttons can live inside it; escaping is what keeps that
 *  from being an injection into the customer's own page. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character] ?? character));
}

/** The greeting, and the quick buttons under it.
 *
 *  The buttons are part of the INTRO message rather than a row of this panel's own, because "under the
 *  greeting" is exactly where the intro is, and because deep-chat already hides the intro the moment a
 *  message arrives — a suggestion belongs to a visitor who has not started, and nothing here has to decide
 *  when it stops being useful. `htmlClassUtilities` is the library's own hook for wiring and styling the
 *  markup it is handed; `chatConfig` below is the only caller. */
function introHtml(input: { greeting: string; appearance: ChatbotAppearance; strings: WidgetStrings }): string {
  const { greeting, appearance, strings } = input;
  const text = `<div class="cb-intro-text">${escapeHtml(greeting)}</div>`;
  if (appearance.quickButtons.length === 0) return text;
  const buttons = appearance.quickButtons
    .map((button) => `<button type="button" class="cb-quick-item" data-cb-text="${escapeHtml(button.text)}">${button.icon === null ? '' : appearanceIconSvg(button.icon)}<span>${escapeHtml(button.text)}</span></button>`)
    .join('');
  return `${text}<div class="cb-quick" role="group" aria-label="${escapeHtml(strings.quickButtons)}">${buttons}</div>`;
}

/** Styling and behaviour for the markup `introHtml` produces. One entry per class it emits, and the click
 *  handler reads the button's own text back out of the DOM rather than closing over a list that could drift
 *  from what was rendered. */
function introUtilities(
  appearance: ChatbotAppearance,
  onQuickButton: (text: string) => void,
): Record<string, { events?: Record<string, (event: { target: EventTarget | null }) => void>; styles?: Record<string, Record<string, string>> }> {
  const ramp = appearanceRamp(appearance);
  return {
    'cb-quick': {
      styles: { default: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px', justifyContent: 'center' } },
    },
    'cb-quick-item': {
      events: {
        click: (event) => {
          const target = event.target instanceof Element ? event.target.closest('[data-cb-text]') : null;
          const text = target?.getAttribute('data-cb-text') ?? '';
          if (text !== '') onQuickButton(text);
        },
      },
      styles: {
        default: {
          border: `1px solid ${ramp.border}`,
          background: ramp.raised,
          color: ramp.foreground,
          borderRadius: `${appearance.radius}px`,
          padding: '6px 10px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          font: 'inherit',
          fontSize: '13px',
          cursor: 'pointer',
          textAlign: 'center',
        },
        hover: { background: ramp.field },
      },
    },
  };
}

/** Everything the panel hands to the chat element. ONE function, so the look a visitor sees and the look the
 *  administrator previews cannot be two different sets of properties.
 *
 *  Deliberately unused from the library's own surface: `attachmentContainerStyle` and `dropupStyles` style an
 *  attachment rail and a button menu this widget does not have (no files, no dropup), and `customButtons`
 *  places buttons in the input row, which is not where a quick button belongs. `maxVisibleMessages` is left
 *  at the library's own bound: how many messages a conversation keeps in the DOM is not a property of how it
 *  looks. */
function chatConfig(input: {
  look: ChatbotLook;
  strings: WidgetStrings;
  onQuickButton: (text: string) => void;
}): Record<string, unknown> {
  const { look, strings } = input;
  const appearance = look.appearance;
  const ramp = appearanceRamp(appearance);
  const sendRadius = appearance.send.shape === 'circle' ? '50%' : '8px';
  const sendHover = appearanceShade(appearance.colors.sendButton, appearance.mode === 'dark' ? 'lighter' : 'darker');
  return {
    chatStyle: {
      // The GROUND is painted by the panel's own `.messages` element, not here. deep-chat reads `chatStyle`
      // when it first renders and keeps it: reconfiguring an existing element updates the bubbles and the
      // input area but leaves this background at whatever the panel was built with, so switching a template
      // left a white panel with a black conversation. What this element owns has to be transparent for the
      // colour underneath to be the one in force.
      backgroundColor: 'transparent',
      color: ramp.foreground,
      border: 'none',
      width: '100%',
      height: '100%',
      fontSize: `${appearance.typography.fontSize}px`,
      // `fontFamily` is set here for a reason beyond typography: deep-chat appends a Google Fonts stylesheet
      // to the page's <head> unless the chat carries a family of its own, and a widget on a customer's site
      // may not call out to a font host. A family of our own is the supported way to say so — and it means a
      // page that already has Inter keeps it, while every other page falls back to the system stack.
      fontFamily: appearanceFontStack(appearance.typography.fontFamily),
    },
    inputAreaStyle: { backgroundColor: appearance.colors.panel },
    textInput: {
      placeholder: { text: appearance.typography.placeholder || strings.placeholder, style: { color: ramp.muted } },
      styles: {
        text: { color: ramp.foreground },
        container: {
          backgroundColor: ramp.field,
          border: `1px solid ${ramp.border}`,
          padding: '10px 12px',
          borderRadius: `${Math.round(appearance.radius / 2)}px`,
        },
      },
    },
    submitButtonStyles: {
      submit: {
        container: {
          default: { backgroundColor: appearance.colors.sendButton, color: appearance.colors.sendIcon, borderRadius: sendRadius },
          hover: { backgroundColor: sendHover, color: appearance.colors.sendIcon, borderRadius: sendRadius },
          click: { backgroundColor: sendHover, color: appearance.colors.sendIcon, borderRadius: sendRadius },
        },
        svg: {
          content: appearanceIconSvg(appearance.send.icon),
          styles: { default: { color: appearance.colors.sendIcon, width: '20px', height: '20px' } },
        },
      },
      // The send button rests in its DISABLED state until the visitor types something. That state is what a
      // visitor actually looks at, so the configured colour has to reach it — held back a little, because a
      // send button that looks ready when it is not is a button somebody presses for nothing.
      disabled: {
        container: { default: { backgroundColor: appearance.colors.sendButton, color: appearance.colors.sendIcon, borderRadius: sendRadius, opacity: '0.5' } },
        svg: { content: appearanceIconSvg(appearance.send.icon), styles: { default: { color: appearance.colors.sendIcon, width: '20px', height: '20px' } } },
      },
    },
    // The bubble's FILL is the customer's and its INK is not: whichever of the two inks reads better on that
    // fill is the one used, so a white bubble and a black one are both legible without a second control.
    messageStyles: {
      default: {
        shared: { outerContainer: { padding: '4px 12px' } },
        ai: {
          bubble: {
            backgroundColor: appearance.colors.botBubble,
            color: appearanceInk(appearance.colors.botBubble),
            borderRadius: `${appearance.radius}px`,
          },
        },
        user: {
          bubble: {
            backgroundColor: appearance.colors.visitorBubble,
            color: appearanceInk(appearance.colors.visitorBubble),
            borderRadius: `${appearance.radius}px`,
          },
        },
      },
    },
    // Deep-chat renders inside its own shadow root, which our stylesheet cannot reach; this is the hook the
    // library provides for exactly that.
    auxiliaryStyle: `.input-button { top: 50%; bottom: auto; margin-top: 0; margin-bottom: 0; transform: translateY(-50%); display: flex; align-items: center; justify-content: center; } .error-message-text { color: ${ramp.ember}; } .cb-quick-item svg { width: 14px; height: 14px; flex: 0 0 auto; }`,
    errorMessages: { displayServiceErrorMessages: false },
    introMessage: {
      html: introHtml({
        greeting: appearance.intro ?? strings.intro,
        appearance,
        strings,
      }),
    },
    htmlClassUtilities: introUtilities(appearance, input.onQuickButton),
    avatars: !appearance.header.showAvatar || appearance.avatarUrl === '' ? undefined : { ai: { src: appearance.avatarUrl } },
    names: appearance.header.showMessageName ? { ai: { text: look.name === '' ? strings.title : look.name, position: 'start' } } : undefined,
  };
}

/** The panel's own stylesheet, generated from the appearance. The chrome deep-chat does not own — the
 *  header, the status line, the confirmation, the launcher — is drawn here, and every colour in it comes
 *  from the appearance or from the mode's neutral ramp.
 *
 *  `--cb-avail-w` and `--cb-avail-h` are the room the panel has. Their default is the visitor's viewport;
 *  the administrator's preview sets them to the stage it mounts the panel in, which is the whole reason a
 *  preview can show a panel at its real size instead of at the size of a modal. */
function styleText(appearance: ChatbotAppearance): string {
  const GUTTER_PX = appearance.launcher.offset;
  const inset = appearanceViewportInset(appearance);
  const launcherHover = appearanceShade(appearance.colors.launcher, appearance.mode === 'dark' ? 'lighter' : 'darker');
  const ramp = appearanceRamp(appearance);
  const sendInk = appearanceInk(appearance.colors.sendButton);
  const sendHover = appearanceShade(appearance.colors.sendButton, appearance.mode === 'dark' ? 'lighter' : 'darker');
  const corner: Record<typeof appearance.position, string> = {
    'bottom-right': `right: ${GUTTER_PX}px; bottom: ${GUTTER_PX}px;`,
    'bottom-left': `left: ${GUTTER_PX}px; bottom: ${GUTTER_PX}px;`,
    'top-right': `right: ${GUTTER_PX}px; top: ${GUTTER_PX}px;`,
    'top-left': `left: ${GUTTER_PX}px; top: ${GUTTER_PX}px;`,
  };
  // A panel in a top corner hangs from the top, so its launcher is drawn ABOVE it and its edge is the one it
  // is anchored to.
  const fromTop = appearance.position.startsWith('top');
  const fromLeft = appearance.position.endsWith('left');
  return `
:host {
  --cb-avail-w: calc(100vw - ${inset.width}px);
  --cb-avail-h: calc(100vh - ${inset.height}px);
}
.root {
  position: fixed; ${corner[appearance.position]} z-index: 2147483000;
  display: flex; flex-direction: ${fromTop ? 'column-reverse' : 'column'}; align-items: ${fromLeft ? 'flex-start' : 'flex-end'}; gap: ${LAUNCHER_GAP_PX}px;
  max-width: var(--cb-avail-w);
  color: ${ramp.foreground}; line-height: 1.4; letter-spacing: normal; text-align: left; direction: ltr;
  font-family: ${appearanceFontStack(appearance.typography.fontFamily)};
  font-size: ${appearance.typography.fontSize}px; font-style: normal; font-weight: 400; text-transform: none; white-space: normal;
}
*, *::before, *::after { box-sizing: border-box; }
.launcher {
  display: inline-flex; align-items: center; gap: 10px; max-width: 100%;
  border: 1px solid ${ramp.launcherBorder}; background: ${appearance.colors.launcher}; color: ${appearanceInk(appearance.colors.launcher)};
  font: inherit; font-weight: 600; padding: 0; border-radius: 999px; cursor: pointer;
  min-height: ${appearance.launcher.size}px; flex: 0 0 auto;
  box-shadow: ${APPEARANCE_SHADOWS[appearance.typography.shadow]};
}
.launcher svg { width: ${appearance.launcher.size - 2}px; height: ${appearance.launcher.size - 2}px; padding: ${Math.round(appearance.launcher.size * .28)}px; flex: 0 0 auto; }
.launcher-label { padding-right: 18px; overflow-wrap: anywhere; }
.launcher:hover { background: ${launcherHover}; }
.launcher:focus-visible { outline: 2px solid ${ramp.ember}; outline-offset: 2px; }
.panel {
  display: flex; flex-direction: column;
  width: min(${appearance.width}px, var(--cb-avail-w)); height: min(${appearance.height}px, var(--cb-avail-h));
  background: ${appearance.colors.panel}; border: 1px solid ${ramp.border}; border-radius: ${appearance.radius}px;
  box-shadow: ${APPEARANCE_SHADOWS[appearance.typography.shadow]}; overflow: hidden;
}
.panel[hidden] { display: none; }
.header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 16px; border-bottom: 1px solid ${ramp.border}; background: ${ramp.header}; color: ${ramp.headerInk};
}
.identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
.header-avatar { width: 32px; height: 32px; object-fit: cover; border-radius: 50%; flex: 0 0 auto; }
.header-avatar[hidden], .subtitle[hidden] { display: none; }
.subtitle { margin: 3px 0 0; color: ${ramp.headerInk}; font-size: .85em; overflow-wrap: anywhere; }
.title { margin: 0; overflow-wrap: anywhere; font-size: 1.07em; font-weight: 600; color: ${ramp.headerInk}; }
.close {
  border: 1px solid transparent; background: transparent; color: ${ramp.headerInk};
  font: inherit; font-size: 14px; padding: 6px 10px; border-radius: 8px; cursor: pointer;
}
.close:hover { border-color: ${ramp.headerInk}; }
.close:focus-visible { outline: 2px solid ${ramp.headerInk}; outline-offset: 1px; }
.status { margin: 0; padding: 10px 16px; border-bottom: 1px solid ${ramp.border}; background: ${appearance.colors.panel}; color: ${ramp.muted}; font-size: 13px; line-height: 1.45; }
.status[hidden] { display: none; }
.status-error { color: ${ramp.ember}; }
.messages { flex: 1 1 auto; min-height: 0; display: flex; background: ${appearance.colors.panel}; }
.messages > deep-chat { flex: 1 1 auto; min-height: 0; }
.confirm {
  border-top: 1px solid ${ramp.border}; background: ${ramp.raised}; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 10px;
}
.confirm[hidden] { display: none; }
.confirm-title { margin: 0; font-size: 14px; font-weight: 600; color: ${ramp.foreground}; }
.confirm-body { margin: 0; font-size: 13px; line-height: 1.5; color: ${ramp.muted}; }
.confirm-actions { display: flex; gap: 8px; }
.confirm-actions button { font: inherit; font-size: 14px; font-weight: 600; padding: 10px 14px; border-radius: 10px; cursor: pointer; }
.confirm-yes { flex: 1 1 auto; border: 1px solid ${appearance.colors.sendButton}; background: ${appearance.colors.sendButton}; color: ${sendInk}; }
.confirm-yes:hover { background: ${sendHover}; border-color: ${sendHover}; }
.confirm-no { border: 1px solid ${ramp.border}; background: transparent; color: ${ramp.foreground}; }
.confirm-no:hover { border-color: ${ramp.muted}; }
.confirm-actions button:focus-visible { outline: 2px solid ${ramp.ember}; outline-offset: 2px; }
`;
}

export class ChatPanel implements ChatView {
  /** The element the widget appended. It carries the attribute the page snapshot excludes, so the panel is
   *  never described to the agent as part of the customer's page. */
  readonly host: HTMLDivElement;
  private readonly strings: WidgetStrings;
  private readonly onVisitorMessage: (text: string) => void;
  private readonly onStop: () => void;
  private readonly onOpen: (() => void) | undefined;
  private readonly style: HTMLStyleElement;
  private readonly panel: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly avatar: HTMLImageElement;
  private readonly launcher: HTMLButtonElement;
  private readonly messages: HTMLElement;
  private readonly confirmBox: HTMLElement;
  private readonly confirmTitle: HTMLElement;
  private readonly status: HTMLElement;
  private readonly confirmYes: HTMLButtonElement;
  private look: ChatbotLook;
  private chat: ChatElement;
  /** Whether the chat element has rendered for the first time. A message drawn before that is DROPPED by the
   *  library, so anything the panel wants to show is queued until it is ready — which is what lets a rebuilt
   *  panel replay a conversation instead of losing it. */
  private ready = false;
  private scrollPending = false;
  private readonly layoutObserver = new ResizeObserver(() => this.flushScroll());
  private readonly queued: { role: string; text: string }[] = [];
  /** A look that arrived while an answer was streaming. Replacing the chat element mid-answer would take the
   *  answer with it, so the redraw waits for the stream to end. */
  private redrawPending = false;
  /** The answer as it stands, accumulated here so every later piece replaces one message rather than adding
   *  another, whether the pieces came from a live stream, a reconnect or a restored turn. */
  private answer = '';
  private answerIndex: number | null = null;
  private signals: StreamSignals | null = null;
  private pendingConfirmation: ((confirmed: boolean) => void) | null = null;

  constructor(options: ChatPanelOptions) {
    this.strings = options.strings;
    this.look = options.look;
    this.onVisitorMessage = options.onVisitorMessage;
    this.onStop = options.onStop;
    this.onOpen = options.onOpen;

    this.host = document.createElement('div');
    this.host.setAttribute('data-elowen-chatbot', 'root');
    // Inline styles on the host element are the one thing a page's own stylesheet cannot reach without
    // `!important`, which is what keeps the launcher where it belongs on a page that styles every `div`.
    this.host.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;z-index:2147483000;';
    const shadow = this.host.attachShadow({ mode: 'open' });

    this.style = document.createElement('style');
    const root = document.createElement('div');
    root.className = 'root';

    this.launcher = document.createElement('button');
    this.launcher.type = 'button';
    this.launcher.className = 'launcher';
    this.launcher.setAttribute('aria-haspopup', 'dialog');
    this.launcher.setAttribute('aria-expanded', 'false');

    this.panel = document.createElement('section');
    this.panel.className = 'panel';
    this.panel.setAttribute('role', 'dialog');
    this.panel.hidden = true;

    const header = document.createElement('header');
    header.className = 'header';
    this.title = document.createElement('h2');
    this.title.className = 'title';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.textContent = this.strings.close;
    this.subtitle = document.createElement('p');
    this.subtitle.className = 'subtitle';
    this.avatar = document.createElement('img');
    this.avatar.className = 'header-avatar';
    this.avatar.alt = '';
    const identity = document.createElement('div');
    identity.className = 'identity';
    const headings = document.createElement('div');
    headings.append(this.title, this.subtitle);
    identity.append(this.avatar, headings);
    header.append(identity, close);

    this.status = document.createElement('p');
    this.status.className = 'status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.hidden = true;

    this.messages = document.createElement('div');
    this.messages.className = 'messages';
    this.chat = this.createChat();

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

    this.panel.append(header, this.status, this.messages, this.confirmBox);
    root.append(this.panel, this.launcher);
    shadow.append(this.style, root);

    this.applyChrome();
    this.messages.append(this.chat);
    this.layoutObserver.observe(this.chat);

    this.launcher.addEventListener('click', () => this.toggle(!this.isOpen()));
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

  /** Draw the panel with a different look, and with the chatbot's own name.
   *
   *  A chat element cannot be restyled in place: setting any of its properties rebuilds its message list, so
   *  the element is REPLACED and everything it was showing is carried over. There is one case where replacing
   *  it would throw away something the visitor cannot get back — an element that has drawn no message yet
   *  holds the message they are half-way through typing, and a first visit applies the look exactly then, one
   *  round trip after the panel was opened. So an empty message element is reconfigured instead: its own
   *  re-render draws the new look, and the visitor's draft stays where it is. */
  applyAppearance(look: ChatbotLook): void {
    this.look = look;
    this.applyChrome();
    if (this.signals !== null) {
      // An answer is streaming. Replacing the element would take the answer with it, and reconfiguring it
      // would rebuild the very list the stream is writing into, so the redraw waits for the frame that ends
      // the answer.
      this.redrawPending = true;
      return;
    }
    if (this.pristineChat()) this.reconfigureChat();
    else this.redrawChat();
  }

  // ── the view contract the conversation uses ────────────────────────────────────────────────────────

  /** Show a message the visitor sent on a path that is not the panel's own submit — one restored from the
   *  server's projection, one a quick button sent, or one a site sends with `window.ElowenChatbot`.
   *
   *  Deliberately NOT deep-chat's `submitUserMessage`: that one goes through the submit path, which is what
   *  ASKS for a turn. A restored message rendered with it would become a second turn of its own — the same
   *  words asked of the model again, on every reload — and a message shown on the visitor's behalf would
   *  loop straight back into this widget. `addMessage` only draws it. */
  appendVisitor(text: string): void {
    this.draw({ role: 'user', text });
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
    this.writeAnswer(this.answer);
  }

  finishAnswer(text: string): void {
    // The terminal frame carries the WHOLE answer, and it is rendered as an overwrite: a delta lost on the
    // way, or replayed by a reconnect, cannot leave the visitor reading a message that never existed.
    this.answer = text === '' ? this.answer : text;
    const signals = this.signals;
    this.signals = null;
    this.clearStatus();
    if (signals === null) {
      this.writeAnswer(this.answer);
    } else {
      // The overwrite is what the visitor ends up reading, so the response is only closed once it has been
      // taken: a response closed first keeps whatever the last delta left behind.
      const written = signals.onResponse({ text: this.answer, overwrite: true });
      void Promise.resolve(written).then(() => signals.onClose(), () => signals.onClose());
    }
    this.answerIndex = null;
    this.flushRedraw();
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
    this.flushRedraw();
  }

  /** A transcript rebuilt from the server's projection, message by message, through the same path everything
   *  else takes — which draws each one and asks the server for nothing. */
  restore(messages: { role: 'user' | 'ai'; text: string }[]): void {
    for (const message of messages) this.draw(message);
    // A restored transcript opens where the visitor left off, which is its END: a reload that lands on the
    // first message hides the answer the visitor came back for. `addMessage` only follows a LIVE message.
    this.scrollToLatest();
  }

  /** Rendering messages is not layout: a hidden panel has zero scroll height. Keep the request until the
   *  chat has a visible box, then consume it once so later resizes never override the visitor's scrolling. */
  private scrollToLatest(): void {
    this.scrollPending = true;
    this.flushScroll();
  }

  private flushScroll(): void {
    if (!this.scrollPending || !this.ready || this.chat.clientHeight === 0) return;
    this.chat.scrollToBottom();
    this.scrollPending = false;
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
    this.layoutObserver.disconnect();
    this.host.remove();
  }

  // ── the panel's own drawing ───────────────────────────────────────────────────────────────────────

  /** Everything the look decides about the chat element, from ONE place: the element built at mount and the
   *  one reconfigured for a new look are configured identically, or the panel a visitor sees and the panel an
   *  administrator previews would be two different things. */
  private chatConfig(): Record<string, unknown> {
    return chatConfig({ look: this.look, strings: this.strings, onQuickButton: (text) => this.sendQuick(text) });
  }

  /** One chat element, configured from the current look. `connect` is what makes this widget answer with its
   *  own transport instead of a service client, and `onComponentRender` is the one moment the library says
   *  the element is ready to be given messages. */
  private createChat(): ChatElement {
    const chat = document.createElement('deep-chat') as ChatElement;
    Object.assign(chat, this.chatConfig());
    chat.connect = {
      stream: true,
      handler: (body, signals) => this.handleSubmit(body, signals as unknown as StreamSignals),
    };
    chat.onComponentRender = () => {
      this.ready = true;
      for (const message of this.queued.splice(0, this.queued.length)) chat.addMessage({ role: message.role, text: message.text });
      this.scrollToLatest();
    };
    return chat;
  }

  /** Whether the message element has nothing to lose: it has rendered, it has drawn no message, and nothing
   *  is waiting to be drawn into it. An element that has not rendered yet cannot take a reconfiguration at
   *  all — there is nothing to re-render — so it is replaced, which is free because it is empty. */
  private pristineChat(): boolean {
    return this.ready && this.queued.length === 0 && this.chat.getMessages().length === 0;
  }

  /** The same element, configured from the new look. Only ever done with an empty conversation: what an empty
   *  element holds besides its (empty) message list is the visitor's half-written message. */
  private reconfigureChat(): void {
    Object.assign(this.chat, this.chatConfig());
  }

  /** Replace the message element, carrying over whatever it was showing. The library rebuilds a chat's whole
   *  message list whenever one of its properties is set, so this is the only way to change the look of a
   *  panel that already has a conversation in it. */
  private redrawChat(): void {
    const carried = this.ready
      ? this.chat.getMessages()
        .map((message) => ({ role: typeof message.role === 'string' ? message.role : 'ai', text: typeof message.text === 'string' ? message.text : '' }))
        .filter((message) => message.text !== '')
      : [];
    this.layoutObserver.disconnect();
    this.chat.remove();
    this.ready = false;
    this.answerIndex = null;
    this.queued.push(...carried);
    this.chat = this.createChat();
    this.messages.append(this.chat);
    this.layoutObserver.observe(this.chat);
  }

  private flushRedraw(): void {
    if (!this.redrawPending) return;
    this.redrawPending = false;
    this.redrawChat();
  }

  /** Draw one message, or hold it until the element can take it: `addMessage` on an element that has not
   *  rendered yet is dropped by the library with a warning, which would silently lose a restored
   *  conversation. */
  private draw(message: { role: string; text: string }): void {
    if (!this.ready) {
      this.queued.push(message);
      return;
    }
    this.chat.addMessage(message);
  }

  /** A quick button is the visitor's own message: it is drawn in the transcript and then handed to the
   *  conversation exactly as a message typed into the panel is. Deep-chat hides the intro — and with it the
   *  buttons — as soon as a message arrives, which is when a suggestion stops being useful. */
  private sendQuick(text: string): void {
    this.appendVisitor(text);
    this.onVisitorMessage(text);
  }

  /** Rewrite the stylesheet and the headings the panel draws itself. Safe at any time: none of it belongs to
   *  the chat element, and none of it touches the conversation. */
  private applyChrome(): void {
    this.style.textContent = styleText(this.look.appearance);
    const title = this.titleText();
    this.title.textContent = title;
    const { appearance } = this.look;
    this.subtitle.textContent = appearance.header.subtitle;
    this.subtitle.hidden = appearance.header.subtitle === '';
    this.avatar.hidden = !appearance.header.showAvatar || appearance.avatarUrl === '';
    if (this.avatar.hidden) this.avatar.removeAttribute('src');
    else this.avatar.src = appearance.avatarUrl;
    this.launcher.innerHTML = appearanceIconSvg(appearance.launcher.icon);
    if (appearance.launcher.label !== '') {
      const label = document.createElement('span');
      label.className = 'launcher-label';
      label.textContent = appearance.launcher.label;
      this.launcher.append(label);
    }
    this.launcher.setAttribute('aria-label', appearance.launcher.label || this.strings.launcher);
    this.panel.setAttribute('aria-label', title);
  }

  private titleText(): string {
    return this.look.name === '' ? this.strings.title : this.look.name;
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

  private toggle(open: boolean): void {
    this.panel.hidden = !open;
    this.launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) return;
    this.chat.focusInput();
    this.flushScroll();
    // Opening is the visitor's own act, and the first moment the widget may ask the server for anything: a
    // page whose panel is never opened is never touched.
    this.onOpen?.();
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
  private writeAnswer(text: string): void {
    const message = { role: 'ai', text };
    if (this.answerIndex === null) {
      this.draw(message);
      this.answerIndex = (this.ready ? this.chat.getMessages().length : this.queued.length) - 1;
      return;
    }
    if (this.ready) this.chat.updateMessage({ text }, this.answerIndex);
    else this.queued[this.answerIndex] = message;
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
