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
import { effectsCss, buttonStyles, chatEffectsCss, gradient, gradientInk } from './effects.js';
import { playTone, unlockSound } from './sound.js';
import type { ChatView } from './session.js';
import { allowedOfferUrl, type Offer } from '../src/offerContract.js';
import { escapeHtml, offerHtml, offerStyles, disableOffers } from './offer.js';
import { feedbackHtml, feedbackStyles } from './feedback.js';
import { FEEDBACK_COMMENT_MAX_CHARS, FEEDBACK_RATINGS, type FeedbackRating, type FeedbackSelection } from '../src/publicContract.js';
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
  onFeedback?: (turnId: string, rating: FeedbackRating, comment: string | null) => Promise<FeedbackSelection | null>;
  /** The panel was opened — a click the visitor made, and therefore the first thing the widget may ask the
   *  server for. See `mount()`. */
  onOpen?: () => void;
  /** The chatbot's avatar as bytes, fetched over the connection this widget already owns, because the
   *  customer's page has no reason to allow the owner's image host. Absent on a panel that holds no visitor
   *  credential — the administrator's preview — which has no route to ask and therefore shows the configured
   *  address directly. */
  loadAvatar?: () => Promise<Blob | null>;
  publicId?: string;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
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
  onOfferLink: (url: string) => void,
  onFeedbackRate: (turnId: string, rating: FeedbackRating) => void,
  onFeedbackSend: (turnId: string, comment: string) => void,
  onFeedbackSkip: (turnId: string) => void,
): Record<string, { events?: Record<string, (event: { target: EventTarget | null }) => void>; styles?: Record<string, Record<string, string>> }> {
  const ramp = appearanceRamp(appearance);
  return {
    'cb-quick': {
      styles: { default: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px', justifyContent: 'center' } },
    },
    'cb-feedback-thumb': {
      events: { click: (event) => {
        const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-cb-rating]') : null;
        const group = button?.closest<HTMLElement>('[data-cb-feedback-turn]');
        if (button && group && FEEDBACK_RATINGS.some((rating) => rating === button.dataset.cbRating)) {
          onFeedbackRate(group.dataset.cbFeedbackTurn!, button.dataset.cbRating as FeedbackRating);
        }
      } },
      styles: { default: { padding: '5px' }, ...buttonStyles(appearance) },
    },
    'cb-feedback-send': {
      events: { click: (event) => {
        const group = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-cb-feedback-turn]') : null;
        if (group) onFeedbackSend(group.dataset.cbFeedbackTurn!, group.querySelector('textarea')?.value ?? '');
      } },
      styles: { default: { fontWeight: '600' }, ...buttonStyles(appearance) },
    },
    'cb-feedback-skip': {
      events: { click: (event) => {
        const group = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-cb-feedback-turn]') : null;
        if (group) onFeedbackSkip(group.dataset.cbFeedbackTurn!);
      } },
      styles: { default: { opacity: '.8' }, ...buttonStyles(appearance) },
    },
    'cb-offer-link': {
      events: {
        click: (event) => {
          const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-cb-url]') : null;
          if (button && !button.disabled) onOfferLink(button.getAttribute('data-cb-url') ?? '');
        },
      },
      styles: { default: { textDecoration: 'underline' }, hover: { textDecoration: 'none' }, click: { opacity: '.75' } },
    },
    'cb-offer-button': {
      styles: { default: { maxWidth: '100%' }, hover: { opacity: '.9' }, click: { opacity: '.75' } },
    },
    'cb-quick-item': {
      events: {
        click: (event) => {
          const target = event.target instanceof Element ? event.target.closest('[data-cb-text]') : null;
          const text = target?.getAttribute('data-cb-text') ?? '';
          if (text !== '' && target instanceof HTMLButtonElement && !target.disabled) {
            disableOffers(target.getRootNode() as ShadowRoot);
            onQuickButton(text);
          }
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
          transition: 'transform .2s ease, box-shadow .2s ease, filter .2s ease, background .2s ease',
        },
        ...buttonStyles(appearance),
      },
    },
  };
}

/** Everything the panel hands to the chat element. ONE function, so the look a visitor sees and the look the
 *  administrator previews cannot be two different sets of properties.
 *
 *  Deliberately unused from the library's own surface: `attachmentContainerStyle` and `dropupStyles` style an
 *  attachment rail and a button menu this widget does not have (no files, no dropup), while `customButtons`
 *  provides the session-owned stop control. Quick buttons belong in the greeting. `maxVisibleMessages` is left
 *  at the library's own bound: how many messages a conversation keeps in the DOM is not a property of how it
 *  looks. */
function chatConfig(input: {
  look: ChatbotLook;
  strings: WidgetStrings;
  /** The avatar the message list draws beside the chatbot's answers: the SAME resolved source the header
   *  shows, or `null` when the look names no avatar or the panel has nothing to show. */
  avatar: string | null;
  onQuickButton: (text: string) => void;
  onOfferLink: (url: string) => void;
  onFeedbackRate: (turnId: string, rating: FeedbackRating) => void;
  onFeedbackSend: (turnId: string, comment: string) => void;
  onFeedbackSkip: (turnId: string) => void;
  onStop: () => void;
}): Record<string, unknown> {
  const { look, strings } = input;
  const appearance = look.appearance;
  const ramp = appearanceRamp(appearance);
  const sendRadius = appearance.send.shape === 'circle' ? '50%' : '8px';
  const sendHover = appearanceShade(appearance.colors.sendButton, appearance.mode === 'dark' ? 'lighter' : 'darker');
  const sendContainer = {
    default: { backgroundColor: appearance.colors.sendButton, color: appearance.colors.sendIcon, borderRadius: sendRadius },
    hover: { backgroundColor: sendHover, color: appearance.colors.sendIcon, borderRadius: sendRadius },
    click: { backgroundColor: sendHover, color: appearance.colors.sendIcon, borderRadius: sendRadius },
  };
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
    inputAreaStyle: { backgroundColor: appearance.effects.glass ? 'transparent' : appearance.colors.panel },
    scrollButton: { smoothScroll: true, styles: { default: { backgroundColor: ramp.raised, color: ramp.foreground, border: `1px solid ${ramp.border}` } } },
    hiddenMessages: { smoothScroll: true, clickScroll: 'last', styles: { default: { backgroundColor: ramp.raised, color: ramp.foreground, border: `1px solid ${ramp.border}` } } },
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
      position: 'inside-end',
      submit: {
        container: sendContainer,
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
    customButtons: [{
      position: 'inside-end',
      styles: { button: { default: {
        container: sendContainer,
        svg: {
          content: '<svg xmlns="http://www.w3.org/2000/svg" data-cb-stop-icon="" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
          styles: { default: { color: appearance.colors.sendIcon, filter: 'none', width: '20px', height: '20px' } },
        },
      } } },
      onClick: input.onStop,
    }],
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
            background: gradient(appearance.colors.visitorBubble, appearance.colors.visitorBubbleEnd),
            color: gradientInk(appearance.colors.visitorBubble, appearance.colors.visitorBubbleEnd),
            borderRadius: `${appearance.radius}px`,
          },
        },
      },
      loading: { message: { styles: { bubble: { backgroundColor: appearance.colors.botBubble, color: appearanceInk(appearance.colors.botBubble) } } } },
    },
    // Deep-chat renders inside its own shadow root, which our stylesheet cannot reach; this is the hook the
    // library provides for exactly that. Pulse values match the host's web/app/styles/animations.css;
    // only the primary color source changes to the widget appearance's send color.
    auxiliaryStyle: `
:host { --cb-stop-color: ${appearance.colors.sendButton}; --cb-feedback-accent: ${appearance.colors.sendButton}; --cb-feedback-ink: ${appearanceInk(appearance.colors.sendButton)}; }
:host(:not([data-answer-active])) .input-button:has([data-cb-stop-icon]),
:host([data-answer-active]) .input-button:not(:has([data-cb-stop-icon])) { display: none !important; }
.input-button:has([data-cb-stop-icon]) { right: .33em !important; }
:host([data-answer-active]) .input-button:has([data-cb-stop-icon]) { animation: stop-pulse 1.6s ease-out infinite; }
:host([data-answer-active]) [data-cb-stop-icon] { animation: stop-pulse-icon 1.6s ease-in-out infinite; }
@keyframes stop-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--cb-stop-color) 85%, transparent); }
  70% { box-shadow: 0 0 0 12px color-mix(in oklab, var(--cb-stop-color) 30%, transparent); }
  100% { box-shadow: 0 0 0 16px color-mix(in oklab, var(--cb-stop-color) 0%, transparent); }
}
@keyframes stop-pulse-icon {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.12); }
}
@media (prefers-reduced-motion: reduce) {
  :host([data-answer-active]) .input-button:has([data-cb-stop-icon]),
  :host([data-answer-active]) [data-cb-stop-icon] { animation: none; }
}
${chatEffectsCss(appearance)}
.input-button { top: 50%; bottom: auto; margin-top: 0; margin-bottom: 0; transform: translateY(-50%); display: flex; align-items: center; justify-content: center; } .error-message-text { color: ${ramp.ember}; } .cb-quick-item svg { width: 14px; height: 14px; flex: 0 0 auto; } ${offerStyles()} ${feedbackStyles()}`,
    errorMessages: { displayServiceErrorMessages: false },
    introMessage: {
      html: introHtml({
        greeting: appearance.intro ?? strings.intro,
        appearance,
        strings,
      }),
    },
    htmlClassUtilities: introUtilities(appearance, input.onQuickButton, input.onOfferLink, input.onFeedbackRate, input.onFeedbackSend, input.onFeedbackSkip),
    avatars: input.avatar === null ? undefined : { ai: { src: input.avatar } },
    names: appearance.header.showMessageName ? { ai: { text: look.name === '' ? strings.title : look.name, position: 'start' }, user: { style: { display: 'none' } } } : undefined,
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
  const headerInk = gradientInk(ramp.header, appearance.colors.headerEnd);
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
  // The presence dot is measured from the launcher rather than from a number of its own, so it keeps the same
  // place on the corner and the same weight at every size the bounds allow. Its ring is the launcher's own
  // colour, which is what keeps it apart from whatever the page underneath happens to be.
  const dotSize = Math.max(8, Math.round(appearance.launcher.size * .32));
  const dotRing = Math.max(2, Math.round(appearance.launcher.size * .04));
  const presenceDot = appearance.launcher.presenceDot ? `
.launcher-dot {
  position: absolute; top: 0; right: 0; width: ${dotSize}px; height: ${dotSize}px; border-radius: 50%;
  background: ${appearance.launcher.presenceDotColor}; border: ${dotRing}px solid ${appearance.colors.launcher};
  animation: cb-presence-pulse 2.6s ease-in-out infinite;
}
@keyframes cb-presence-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(.85); }
}
@media (prefers-reduced-motion: reduce) {
  .launcher-dot { animation: none; }
}
` : '';
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
  position: relative;
  display: inline-flex; align-items: center; gap: 10px; max-width: 100%;
  border: 1px solid ${ramp.launcherBorder}; background: ${gradient(appearance.colors.launcher, appearance.colors.launcherEnd)}; color: ${gradientInk(appearance.colors.launcher, appearance.colors.launcherEnd)};
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
  padding: 14px 16px; border-bottom: 1px solid ${ramp.border}; background: ${gradient(ramp.header, appearance.colors.headerEnd)}; color: ${headerInk};
}
.identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
.header-avatar { width: 32px; height: 32px; object-fit: cover; border-radius: 50%; flex: 0 0 auto; }
.header-avatar[hidden], .subtitle[hidden] { display: none; }
.subtitle { margin: 3px 0 0; color: ${headerInk}; font-size: .85em; overflow-wrap: anywhere; }
.title { margin: 0; overflow-wrap: anywhere; font-size: 1.07em; font-weight: 600; color: ${headerInk}; }
.close {
  border: 1px solid transparent; background: transparent; color: ${headerInk};
  font: inherit; font-size: 14px; padding: 6px 10px; border-radius: 8px; cursor: pointer;
}
.close:hover { border-color: ${headerInk}; }
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
${presenceDot}
${effectsCss(appearance)}
.launcher-badge { position: absolute; top: -8px; left: -8px; min-width: 22px; padding: 2px 5px; border-radius: 999px; background: ${ramp.ember}; color: ${appearanceInk(ramp.ember)}; font-size: 12px; line-height: 18px; text-align: center; font-weight: 700; }
.launcher-teaser { display: flex; align-items: center; gap: 8px; max-width: min(280px, var(--cb-avail-w)); padding: 10px 12px; overflow-wrap: anywhere; border: 1px solid ${ramp.border}; border-radius: 12px; background: ${ramp.raised}; color: ${ramp.foreground}; box-shadow: ${APPEARANCE_SHADOWS[appearance.typography.shadow]}; }
.launcher-teaser[hidden], .launcher-badge[hidden] { display: none; }
.launcher-teaser button { cursor: pointer; border: 0; background: transparent; color: inherit; font: inherit; font-size: 20px; line-height: 1; }
.header-actions { display: flex; align-items: center; gap: 4px; }
.mute { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex: 0 0 44px; border: 1px solid transparent; background: transparent; color: ${headerInk}; padding: 0; border-radius: 8px; cursor: pointer; font: inherit; }
.mute svg { display: block; width: 20px; height: 20px; }
.mute:hover, .mute:focus-visible { border-color: ${headerInk}; }
.mute[hidden] { display: none; }
`;
}

const SPEAKER_SHAPE = '<path d="M11 5 6 9H3v6h3l5 4V5Z"/>';
const SPEAKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${SPEAKER_SHAPE}<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;
const SPEAKER_OFF_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${SPEAKER_SHAPE}<path d="m16 9 5 6 M21 9l-5 6"/></svg>`;

export class ChatPanel implements ChatView {
  /** The element the widget appended. It carries the attribute the page snapshot excludes, so the panel is
   *  never described to the agent as part of the customer's page. */
  readonly host: HTMLDivElement;
  private readonly strings: WidgetStrings;
  private readonly onVisitorMessage: (text: string) => void;
  private readonly onStop: () => void;
  private readonly onOpen: (() => void) | undefined;
  private readonly loadAvatar: (() => Promise<Blob | null>) | undefined;
  private readonly style: HTMLStyleElement;
  private readonly panel: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly avatar: HTMLImageElement;
  private readonly launcher: HTMLButtonElement;
  private readonly teaser: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly mute: HTMLButtonElement;
  private readonly storage: ChatPanelOptions['storage'];
  private readonly key: string | null;
  private muted = false;
  private teaserDismissed = false;
  private openedEver = false;
  private unread = 0;
  private titleBase: string | null = null;
  private titleWritten: string | null = null;
  private teaserTimer: ReturnType<typeof setTimeout> | null = null;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private nudgeCount = 0;
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
  private drawScrollFrame: number | null = null;
  private readonly layoutObserver = new ResizeObserver(() => this.flushScroll());
  private readonly queued: ({ role: string; text: string } | { role: string; html: string })[] = [];
  private offerOrigins: string[] = [];
  private offerActive = false;
  private readonly feedbackState = new Map<string, { selection: FeedbackSelection | null; commentOpen: boolean; index: number }>();
  private readonly feedbackBusy = new Set<string>();
  private readonly onFeedback: ChatPanelOptions['onFeedback'];
  /** A look that arrived while an answer was streaming. Replacing the chat element mid-answer would take the
   *  answer with it, so the redraw waits for the stream to end. */
  private redrawPending = false;
  /** The answer as it stands, accumulated here so every later piece replaces one message rather than adding
   *  another, whether the pieces came from a live stream, a reconnect or a restored turn. */
  private answer = '';
  private answerIndex: number | null = null;
  private signals: StreamSignals | null = null;
  private answerActive = false;
  private pendingConfirmation: ((confirmed: boolean) => void) | null = null;
  /** The object URL the panel created for the avatar's bytes, and the ONLY URL it may release. `null` until
   *  those bytes arrive, and again once they have been replaced or the panel has gone away. */
  private avatarObjectUrl: string | null = null;
  /** Whether the widget has gone away, so a late answer never creates a URL nobody would release. */
  private destroyed = false;

  constructor(options: ChatPanelOptions) {
    this.strings = options.strings;
    this.look = options.look;
    this.onVisitorMessage = options.onVisitorMessage;
    this.onStop = options.onStop;
    this.onFeedback = options.onFeedback;
    this.onOpen = options.onOpen;
    this.loadAvatar = options.loadAvatar;
    this.storage = options.storage;
    this.key = options.publicId === undefined ? null : `elowen-chatbot:${options.publicId}`;
    this.muted = this.readPreference('muted');
    this.teaserDismissed = this.readPreference('teaser');
    document.addEventListener('visibilitychange', this.visibilityChanged);

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
    const headerActions = document.createElement('div');
    headerActions.className = 'header-actions';
    this.mute = document.createElement('button');
    this.mute.type = 'button';
    this.mute.className = 'mute';
    this.mute.addEventListener('click', () => {
      this.muted = !this.muted;
      this.writePreference('muted', this.muted);
      this.syncMute();
    });
    headerActions.append(this.mute, close);
    header.append(identity, headerActions);

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
    this.badge = document.createElement('span');
    this.badge.className = 'launcher-badge';
    this.badge.hidden = true;
    this.teaser = document.createElement('div');
    this.teaser.className = 'launcher-teaser';
    this.teaser.hidden = true;
    const teaserText = document.createElement('span');
    const dismissTeaser = document.createElement('button');
    dismissTeaser.type = 'button';
    dismissTeaser.textContent = '×';
    dismissTeaser.setAttribute('aria-label', this.strings.teaserClose);
    dismissTeaser.addEventListener('click', () => this.dismissTeaser());
    this.teaser.append(teaserText, dismissTeaser);
    root.append(this.panel, this.teaser, this.launcher);
    shadow.append(this.style, root);

    this.applyChrome();
    this.messages.append(this.chat);
    this.layoutObserver.observe(this.chat);

    this.launcher.addEventListener('click', () => { unlockSound(); this.toggle(!this.isOpen()); });
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
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
      this.messages.addEventListener(event, () => this.cancelDrawScroll(), { passive: true });
    }
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

  /** Apply a changed look and chatbot name. A populated chat element is replaced with its messages carried
   *  over; an empty one is reconfigured in place. Reapplying the SAME look after the visitor opens the panel
   *  must leave the chat configuration alone, since deep-chat rebuilds its input when a property is assigned. */
  applyAppearance(look: ChatbotLook): void {
    if (this.look === look) {
      // A remote avatar can now be requested with the visitor's credential, without redrawing the chat.
      this.requestAvatar();
      return;
    }
    this.look = look;
    this.applyChrome();
    this.scheduleAttention();
    // Asked for here and NOT waited for: the panel is drawn from the look alone, so a slow or dead image host
    // cannot hold up a panel a visitor is trying to use. Until the bytes arrive the avatar stays hidden,
    // which is exactly what it did before this route existed.
    this.requestAvatar();
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

  /** Show delayed launcher effects immediately only in the administrator's sandboxed preview. */
  previewEffects(): void {
    if (this.key !== null) return;
    this.teaser.hidden = this.look.appearance.launcher.teaser === '';
    this.launcher.classList.remove('launcher-nudge-bounce', 'launcher-nudge-wiggle');
    if (this.look.appearance.launcher.nudge !== 'none' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      void this.launcher.offsetWidth;
      this.launcher.classList.add(`launcher-nudge-${this.look.appearance.launcher.nudge}`);
    }
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
    this.offerActive = false;
    disableOffers(this.chat.shadowRoot);
    this.answer = '';
    this.answerIndex = null;
    this.clearStatus();
    this.answerActive = true;
    this.syncAnswerControl();
    this.signals?.onOpen();
  }

  streamAnswer(text: string): void {
    this.answer += text;
    if (this.signals) return void this.signals.onResponse({ text });
    // An answer that arrives with no panel submission behind it — a turn resumed after a reload — is written
    // through the panel's own message list instead, which is the same path a notice would take.
    this.writeAnswer(this.answer);
  }

  finishAnswer(text: string): Promise<void> | void {
    // The terminal frame carries the WHOLE answer, and it is rendered as an overwrite: a delta lost on the
    // way, or replayed by a reconnect, cannot leave the visitor reading a message that never existed.
    this.answerActive = false;
    this.syncAnswerControl();
    this.answer = text === '' ? this.answer : text;
    const signals = this.signals;
    this.signals = null;
    this.clearStatus();
    if (!this.isOpen() || document.hidden) this.markUnread();
    if (signals === null) {
      this.writeAnswer(this.answer);
      this.answerIndex = null;
      this.flushRedraw();
      return;
    }
    // The overwrite is what the visitor ends up reading, so the response is only closed once it has been
    // taken. An offer can only follow after the library has finished this message.
    const written = signals.onResponse({ text: this.answer, overwrite: true });
    return Promise.resolve(written).finally(() => {
      signals.onClose();
      this.answerIndex = null;
      this.flushRedraw();
    });
  }

  /** What the panel has to say about the CONVERSATION rather than in it: a reconnection, a declined
   *  confirmation, a failure. It is a status line above the messages, never a message of its own — the
   *  transcript holds what the visitor said and what the chatbot answered, and nothing else. */
  notice(text: string): void {
    this.setStatus(text, false);
  }

  error(text: string): void {
    this.answerActive = false;
    this.syncAnswerControl();
    this.setStatus(text, true);
    this.signals?.onClose();
    this.signals = null;
    this.answerIndex = null;
    this.flushRedraw();
  }

  setAllowedOrigins(origins: string[]): void {
    this.offerOrigins = origins;
  }

  /** Deep-chat owns the markup message and its quick-button event utilities. */
  showOffer(offer: Offer, active: boolean): void {
    if (active) disableOffers(this.chat.shadowRoot);
    this.offerActive = active;
    this.draw({ role: 'ai', html: offerHtml(offer, this.offerOrigins, this.strings, active) });
  }

  /** A finished answer has one native deep-chat HTML message for its own feedback controls. */
  showFeedback(turnId: string, selection: FeedbackSelection | null): void {
    const index = this.ready ? this.chat.getMessages().length : this.queued.length;
    this.feedbackState.set(turnId, { selection, commentOpen: false, index });
    this.draw({ role: 'ai', html: feedbackHtml({ turnId, selection, commentOpen: false, strings: this.strings }) });
  }

  private updateFeedback(turnId: string): void {
    const state = this.feedbackState.get(turnId);
    if (!state) return;
    const html = feedbackHtml({ turnId, ...state, strings: this.strings });
    if (!this.ready) this.queued[state.index] = { role: 'ai', html };
    else {
      this.chat.updateMessage({ html }, state.index);
      requestAnimationFrame(() => this.scrollToLatest());
    }
  }

  private async rateFeedback(turnId: string, rating: FeedbackRating): Promise<void> {
    const state = this.feedbackState.get(turnId);
    if (!state || !this.onFeedback || this.feedbackBusy.has(turnId)) return;
    this.feedbackBusy.add(turnId);
    try {
      const saved = await this.onFeedback(turnId, rating, state.selection?.comment ?? null);
      if (!saved) { this.notice(this.strings.feedbackError); return; }
      state.selection = saved;
      state.commentOpen = true;
      this.updateFeedback(turnId);
    } catch {
      this.notice(this.strings.feedbackError);
    } finally {
      this.feedbackBusy.delete(turnId);
    }
  }

  private async sendFeedbackComment(turnId: string, comment: string): Promise<void> {
    const state = this.feedbackState.get(turnId);
    if (!state?.selection || !this.onFeedback || this.feedbackBusy.has(turnId)) return;
    if (comment.length > FEEDBACK_COMMENT_MAX_CHARS) { this.notice(this.strings.feedbackError); return; }
    this.feedbackBusy.add(turnId);
    try {
      const saved = await this.onFeedback(turnId, state.selection.rating, comment.trim() || null);
      if (!saved) { this.notice(this.strings.feedbackError); return; }
      state.selection = saved;
      state.commentOpen = false;
      this.updateFeedback(turnId);
    } catch {
      this.notice(this.strings.feedbackError);
    } finally {
      this.feedbackBusy.delete(turnId);
    }
  }

  private skipFeedbackComment(turnId: string): void {
    const state = this.feedbackState.get(turnId);
    if (!state || this.feedbackBusy.has(turnId)) return;
    state.commentOpen = false;
    this.updateFeedback(turnId);
  }

  /** A transcript rebuilt from the server's projection, message by message, through the same path everything
   *  else takes — which draws each one and asks the server for nothing. */
  restore(messages: { role: 'user' | 'ai'; text: string; offer?: Offer; offerActive?: boolean; turnId?: string; feedback?: FeedbackSelection | null }[]): void {
    for (const message of messages) {
      this.draw(message);
      if (message.role === 'ai' && message.turnId) this.showFeedback(message.turnId, message.feedback ?? null);
      if (message.offer) this.showOffer(message.offer, message.offerActive === true);
    }
    // A restored transcript opens where the visitor left off, which is its END: a reload that lands on the
    // first message hides the answer the visitor came back for. `addMessage` only follows a LIVE message.
    this.cancelDrawScroll();
    this.scrollToLatest();
  }

  /** Rendering messages is not layout: a hidden panel has zero scroll height. Keep the request until the
   *  chat has a visible box, then consume it once so later resizes never override the visitor's scrolling. */
  private scrollToLatest(): void {
    this.scrollPending = true;
    this.flushScroll();
  }

  private flushScroll(): void {
    if (!this.scrollPending || this.drawScrollFrame !== null || !this.ready || this.chat.clientHeight === 0) return;
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
    this.destroyed = true;
    this.clearAttentionTimers();
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.resetUnread();
    this.releaseAvatarObjectUrl();
    this.pendingConfirmation?.(false);
    this.pendingConfirmation = null;
    this.layoutObserver.disconnect();
    this.cancelDrawScroll();
    this.host.remove();
  }

  // ── the panel's own drawing ───────────────────────────────────────────────────────────────────────

  /** Everything the look decides about the chat element, from ONE place: the element built at mount and the
   *  one reconfigured for a new look are configured identically, or the panel a visitor sees and the panel an
   *  administrator previews would be two different things. */
  private chatConfig(): Record<string, unknown> {
    return chatConfig({
      look: this.look,
      strings: this.strings,
      avatar: this.avatarSource(),
      onQuickButton: (text) => this.sendQuick(text),
      onOfferLink: (url) => { if (allowedOfferUrl(url, this.offerOrigins)) location.assign(url); },
      onFeedbackRate: (turnId, rating) => { void this.rateFeedback(turnId, rating); },
      onFeedbackSend: (turnId, comment) => { void this.sendFeedbackComment(turnId, comment); },
      onFeedbackSkip: (turnId) => this.skipFeedbackComment(turnId),
      onStop: () => this.stopAnswer(),
    });
  }

  /** One chat element, configured from the current look. `connect` is what makes this widget answer with its
   *  own transport instead of a service client, and `onComponentRender` is the one moment the library says
   *  the element is ready to be given messages. */
  private createChat(): ChatElement {
    const chat = document.createElement('deep-chat') as ChatElement;
    Object.assign(chat, this.chatConfig());
    chat.validateInput = (text) => !this.answerActive && !!text?.trim();
    chat.connect = {
      stream: true,
      handler: (body, signals) => this.handleSubmit(body, signals as unknown as StreamSignals),
    };
    chat.onComponentRender = () => {
      this.ready = true;
      this.syncAnswerControl();
      for (const message of this.queued.splice(0, this.queued.length)) chat.addMessage(message);
      const groups = chat.shadowRoot?.querySelectorAll('.cb-offer') ?? [];
      groups.forEach((group, index) => {
        if (index < groups.length - 1 || !this.offerActive) group.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      });
      this.scrollToLatest();
    };
    return chat;
  }

  /** Session begin/end signals, not a local submit, own whether stopping is possible. The custom stop
   *  occupies the native send slot without reaching into deep-chat's private submit/validation state. */
  private syncAnswerControl(): void {
    this.chat.toggleAttribute('data-answer-active', this.answerActive);
    const stop = this.chat.shadowRoot?.querySelector<HTMLElement>('.input-button:has([data-cb-stop-icon])');
    stop?.setAttribute('aria-label', this.strings.stop);
    stop?.setAttribute('title', this.strings.stop);
    if (!this.answerActive && this.ready) this.chat.disableSubmitButton(false);
  }

  private stopAnswer(): void {
    if (!this.answerActive) return;
    this.onStop();
    this.answerActive = false;
    this.signals?.onClose();
    this.signals = null;
    this.answerIndex = null;
    this.syncAnswerControl();
    this.flushRedraw();
  }

  /** Only a rendered, empty element can be reconfigured without losing messages. */
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
    const carryingAnswer = this.answerIndex !== null;
    const carried = this.ready
      ? this.chat.getMessages()
        .map((message) => typeof message.html === 'string'
          ? { role: typeof message.role === 'string' ? message.role : 'ai', html: message.html }
          : { role: typeof message.role === 'string' ? message.role : 'ai', text: typeof message.text === 'string' ? message.text : '' })
        .filter((message) => 'html' in message || message.text !== '')
      : [];
    this.layoutObserver.disconnect();
    this.cancelDrawScroll();
    this.chat.remove();
    this.ready = false;
    this.queued.push(...carried);
    this.answerIndex = carryingAnswer ? this.queued.length - 1 : null;
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
  private draw(message: { role: string; text: string } | { role: string; html: string }): void {
    if (!this.ready) {
      this.queued.push(message);
      return;
    }
    const follow = this.atLatest();
    this.chat.addMessage(message);
    if (follow) {
      this.scrollPending = true;
      // addMessage schedules its own scroll to the START of the new bubble. Finish at the END only after
      // that render has passed through layout. A visitor interaction cancels this pending follow.
      if (this.drawScrollFrame !== null) cancelAnimationFrame(this.drawScrollFrame);
      this.drawScrollFrame = requestAnimationFrame(() => {
        this.drawScrollFrame = requestAnimationFrame(() => {
          this.drawScrollFrame = null;
          this.flushScroll();
        });
      });
    }
  }

  private cancelDrawScroll(): void {
    if (this.drawScrollFrame === null) return;
    cancelAnimationFrame(this.drawScrollFrame);
    this.drawScrollFrame = null;
    this.scrollPending = false;
  }

  /** Read BEFORE changing content: growing an answer is not a visitor scrolling away. */
  private atLatest(): boolean {
    const list = this.chat.shadowRoot?.querySelector<HTMLElement>('#messages');
    return this.scrollPending || !!list && list.clientHeight > 0 && list.scrollHeight - list.clientHeight - list.scrollTop <= 1;
  }

  /** A quick button is the visitor's own message: it is drawn in the transcript and then handed to the
   *  conversation exactly as a message typed into the panel is. Deep-chat hides the intro — and with it the
   *  buttons — as soon as a message arrives, which is when a suggestion stops being useful. */
  private sendQuick(text: string): void {
    this.offerActive = false;
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
    this.showAvatar(this.avatarSource());
    this.launcher.innerHTML = appearanceIconSvg(appearance.launcher.icon);
    if (appearance.launcher.ring) {
      const ring = document.createElement('span');
      ring.className = 'launcher-ring';
      ring.setAttribute('aria-hidden', 'true');
      this.launcher.append(ring);
    }
    this.launcher.append(this.badge);
    this.teaser.firstElementChild!.textContent = appearance.launcher.teaser;
    this.teaser.hidden = this.teaserDismissed || this.isOpen() || appearance.launcher.teaser === '';
    this.syncBadge();
    this.syncMute();
    if (appearance.launcher.presenceDot) {
      const dot = document.createElement('span');
      dot.className = 'launcher-dot';
      // An ornament, not a claim: it says nothing about whether anybody is there to answer, so nothing about
      // it reaches a screen reader or a page that inspects the button.
      dot.setAttribute('aria-hidden', 'true');
      this.launcher.append(dot);
    }
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

  /** The address this look names, when it names one and the switch that shows it is on. `null` when the
   *  avatar is off, and the ONE place both the fetch and the drawing read that decision. */
  private configuredAvatar(): string | null {
    const { appearance } = this.look;
    if (!appearance.header.showAvatar || appearance.avatarUrl === '') return null;
    return appearance.avatarUrl;
  }

  /** The src the look's avatar resolves to for THIS panel.
   *
   *  One function, because the header and the message list draw the same image: a second answer here is how
   *  the two would come to disagree about what the owner configured. */
  private avatarSource(): string | null {
    const configured = this.configuredAvatar();
    if (configured === null) return null;
    // An image that carries its own bytes needs no network at all: it is drawn exactly as it stands.
    if (configured.startsWith('data:')) return configured;
    // A remote address is drawn from the bytes fetched over this widget's own connection — and while those
    // are on their way, or if they never come, it is not drawn at all. Asking a customer's page to allow the
    // owner's image host is the one thing this route exists to avoid.
    if (this.loadAvatar !== undefined) return this.avatarObjectUrl;
    // Nothing to ask with: the administrator's preview, which holds no visitor credential and therefore has
    // no route to call, so the configured address is what it shows.
    return configured;
  }

  /** Ask for the avatar's bytes, whenever the look names an address that has to travel. Once per applied
   *  look: the widget applies one look per page, and a look that needs no image asks for nothing at all. */
  private requestAvatar(): void {
    const loader = this.loadAvatar;
    const configured = this.configuredAvatar();
    if (loader === undefined || this.destroyed) return;
    if (configured === null || configured.startsWith('data:')) return;
    loader().then(
      (bytes) => { if (bytes !== null) this.showAvatarBytes(bytes); },
      // A refused or failed fetch is a panel WITHOUT an avatar: never a broken image, and never a retry.
      () => undefined,
    );
  }

  /** The avatar's bytes, as the object URL an `<img>` can carry. */
  private showAvatarBytes(bytes: Blob): void {
    // A panel that has already gone away must not create a URL nobody would ever release.
    if (this.destroyed) return;
    this.releaseAvatarObjectUrl();
    this.avatarObjectUrl = URL.createObjectURL(bytes);
    this.applyAvatar();
  }

  /** Put the avatar wherever the look's own image goes, now that its bytes are here. The message element is
   *  rebuilt through the panel's existing path, so the avatars beside the answers take the new source exactly
   *  the way they take a new look. */
  private applyAvatar(): void {
    this.showAvatar(this.avatarSource());
    if (this.signals !== null) {
      // An answer is streaming: replacing or reconfiguring the message element would take it with it, so the
      // rebuild waits for the frame that ends the answer, exactly as a look change does.
      this.redrawPending = true;
      return;
    }
    if (this.pristineChat()) this.reconfigureChat();
    else this.redrawChat();
  }

  /** Show one source in the header avatar, releasing the object URL the panel created for the previous one.
   *  `null` is a panel with no avatar, which is a panel that works. */
  private showAvatar(src: string | null): void {
    if (src !== this.avatarObjectUrl) this.releaseAvatarObjectUrl();
    this.avatar.hidden = src === null;
    if (src === null) this.avatar.removeAttribute('src');
    else this.avatar.src = src;
  }

  /** Give back the one URL this panel owns. Called whenever it is replaced and when the widget goes away, so
   *  the bytes of an image a panel no longer shows are never held on to. */
  private releaseAvatarObjectUrl(): void {
    if (this.avatarObjectUrl === null) return;
    URL.revokeObjectURL(this.avatarObjectUrl);
    this.avatarObjectUrl = null;
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

  private readPreference(suffix: string): boolean {
    if (this.key === null || !this.storage) return false;
    try { return this.storage.getItem(`${this.key}:${suffix}`) === '1'; }
    catch { return false; }
  }

  private writePreference(suffix: string, value: boolean): void {
    if (this.key === null || !this.storage) return;
    try { this.storage.setItem(`${this.key}:${suffix}`, value ? '1' : '0'); }
    catch { /* Storage is optional; the current page still works. */ }
  }

  private syncMute(): void {
    this.mute.hidden = this.look.appearance.sound.tone === 'none';
    this.mute.innerHTML = this.muted ? SPEAKER_OFF_SVG : SPEAKER_SVG;
    this.mute.setAttribute('aria-label', this.muted ? this.strings.unmute : this.strings.mute);
    this.mute.setAttribute('aria-pressed', this.muted ? 'true' : 'false');
  }

  private dismissTeaser(): void {
    this.teaser.hidden = true;
    this.teaserDismissed = true;
    this.writePreference('teaser', true);
  }

  private clearAttentionTimers(): void {
    if (this.teaserTimer !== null) clearTimeout(this.teaserTimer);
    if (this.nudgeTimer !== null) clearTimeout(this.nudgeTimer);
    this.teaserTimer = null;
    this.nudgeTimer = null;
  }

  private scheduleAttention(): void {
    this.clearAttentionTimers();
    const { launcher } = this.look.appearance;
    this.teaser.hidden = true;
    if (this.isOpen() || this.openedEver) return;
    if (launcher.teaser !== '' && !this.teaserDismissed) {
      this.teaserTimer = setTimeout(() => { if (!this.isOpen() && !this.destroyed) this.teaser.hidden = false; }, this.key === null ? 0 : launcher.teaserDelay * 1000);
    }
    if (launcher.nudge === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const nudge = () => {
      if (this.isOpen() || this.openedEver || this.destroyed) return;
      this.launcher.classList.remove('launcher-nudge-bounce', 'launcher-nudge-wiggle');
      void this.launcher.offsetWidth;
      this.launcher.classList.add(`launcher-nudge-${launcher.nudge}`);
      this.nudgeCount++;
      if (this.nudgeCount < 2) this.nudgeTimer = setTimeout(nudge, launcher.nudgeDelay * 1000);
    };
    this.nudgeTimer = setTimeout(nudge, this.key === null ? 0 : launcher.nudgeDelay * 1000);
  }

  private readonly visibilityChanged = (): void => {
    if (!document.hidden) this.resetUnread();
  };

  private markUnread(): void {
    const { launcher, sound } = this.look.appearance;
    if (sound.tone !== 'none' && !this.muted) playTone(sound.tone, sound.volume);
    if (!launcher.unreadBadge || this.key === null) return;
    if (this.unread === 0 || document.title !== this.titleWritten) this.titleBase = document.title;
    this.unread++;
    this.syncBadge();
    this.titleWritten = this.titleBase === '' ? `(${this.unread})` : `(${this.unread}) ${this.titleBase}`;
    document.title = this.titleWritten;
  }

  private syncBadge(): void {
    this.badge.hidden = !this.look.appearance.launcher.unreadBadge || this.unread === 0;
    this.badge.textContent = this.unread === 0 ? '' : this.unread > 99 ? '99+' : String(this.unread);
  }

  private resetUnread(): void {
    if (this.titleWritten !== null && document.title === this.titleWritten && this.titleBase !== null) document.title = this.titleBase;
    this.titleWritten = null;
    this.titleBase = null;
    this.unread = 0;
    this.syncBadge();
  }

  private toggle(open: boolean): void {
    this.panel.hidden = !open;
    this.launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) return;
    this.openedEver = true;
    this.dismissTeaser();
    this.clearAttentionTimers();
    this.resetUnread();
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
    unlockSound();
    this.signals = signals;
    this.answerIndex = null;
    signals.stopClicked.listener = () => this.stopAnswer();
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
    if (this.ready) {
      const follow = this.atLatest();
      this.chat.updateMessage({ text }, this.answerIndex);
      if (follow) this.scrollToLatest();
    } else this.queued[this.answerIndex] = message;
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
