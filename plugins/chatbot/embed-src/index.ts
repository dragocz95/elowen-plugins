/** The script a customer pastes into their website.
 *
 *  ```html
 *  <script async src="https://elowen.example/hooks/chatbot/v2/widget.js" data-chatbot="cbt_…"></script>
 *  ```
 *
 *  Everything it needs is on that one tag: the chatbot's public id, which is an identifier rather than a
 *  secret, and its own `src`, which is where its conversation lives. It appends ONE element to the page,
 *  keeps its UI inside that element's shadow root, and exposes one global — `window.ElowenChatbot` — for a
 *  site that wants to open the panel from its own button.
 *
 *  Including the tag twice is safe: the second script finds the first one's global and returns. So is
 *  including it on a page that has no form, no heading and nothing interactive: a widget with nothing to
 *  describe still answers, it just cannot do anything to the page. */

import { capturePageSnapshot, pageMetadata, type PageTargetHandle } from './pageSnapshot.js';
import { performAction, submitForm, type ActionReport, type PerformableAction } from './pageActions.js';
import { ChatPanel } from './chatPanel.js';
import { ChatSession, type CapturedPage, type PageBridge } from './session.js';
import { DEFAULT_APPEARANCE } from '../src/appearanceContract.js';
import { HANDOFF_CODE_PATTERN, HANDOFF_FRAGMENT_KEY, PUBLIC_SCHEMA_VERSION } from '../src/publicContract.js';
import { detectLocale, widgetStrings } from './strings.js';

/** The one name the widget adds to the page's global scope. */
export interface ElowenChatbotApi {
  /** The protocol version of the served bundle: `v1` today. */
  version: number;
  open(): void;
  close(): void;
  /** Remove the widget from the page entirely, as if the tag had never run. */
  destroy(): void;
}

declare global {
  interface Window {
    ElowenChatbot?: ElowenChatbotApi;
  }
}

/** The page, as the conversation sees it: described on demand, acted on through the handles of the snapshot
 *  the action was approved against. */
class BrowserPage implements PageBridge {
  private readonly handles = new Map<string, PageTargetHandle[]>();
  private snapshotUrl = '';
  arrivedByNavigation = false;

  metadata(): { url: string; title: string } { return pageMetadata(); }

  takeHandoff(): string | null {
    const hash = location.hash;
    const prefix = HANDOFF_FRAGMENT_KEY + '=';
    const position = hash.lastIndexOf('&' + prefix);
    const offset = position >= 0 ? position + 1 : hash.startsWith('#' + prefix) ? 1 : -1;
    if (offset < 0) return null;
    const code = hash.slice(offset + prefix.length);
    // Remove the secret before any request or further page action, preserving the site's original fragment.
    history.replaceState(history.state, '', location.pathname + location.search + (offset === 1 ? '' : hash.slice(0, offset - 1)));
    this.arrivedByNavigation = HANDOFF_CODE_PATTERN.test(code);
    return this.arrivedByNavigation ? code : null;
  }

  navigate(url: string): void {
    const target = new URL(url);
    const sameDocument = target.origin === location.origin && target.pathname === location.pathname && target.search === location.search;
    this.handles.clear();
    location.assign(url);
    if (sameDocument) location.reload();
  }

  capture(): CapturedPage {
    const snapshot = capturePageSnapshot();
    this.handles.clear();
    this.handles.set(snapshot.snapshotId, snapshot.targets);
    this.snapshotUrl = location.href;
    return {
      snapshotId: snapshot.snapshotId,
      json: snapshot.json,
      targets: snapshot.targets.map((target) => ({ id: target.id, caps: target.caps })),
    };
  }

  holds(snapshotId: string): boolean {
    return this.snapshotUrl === location.href && this.handles.has(snapshotId);
  }

  describeTarget(snapshotId: string, targetId: string): string {
    const handle = this.handles.get(snapshotId)?.find((candidate) => candidate.id === targetId);
    if (!handle) return '';
    const element = handle.element;
    const labelled = element.getAttribute('aria-label') ?? element.textContent ?? '';
    const text = labelled.replace(/\s+/g, ' ').trim();
    if (text !== '') return text.slice(0, 80);
    const form = element.closest('form');
    const name = form?.getAttribute('name') ?? form?.getAttribute('id') ?? '';
    return name.trim().slice(0, 80);
  }

  perform(snapshotId: string, action: PerformableAction): Promise<ActionReport> {
    if (!this.holds(snapshotId)) return Promise.resolve({ outcome: 'error', detail: 'stale_snapshot' });
    return performAction(action, this.handles.get(snapshotId) ?? []);
  }

  submit(snapshotId: string, targetId: string): Promise<ActionReport> {
    if (!this.holds(snapshotId)) return Promise.resolve({ outcome: 'error', detail: 'stale_snapshot' });
    const handle = this.handles.get(snapshotId)?.find((candidate) => candidate.id === targetId);
    if (!handle || !handle.element.isConnected) return Promise.resolve({ outcome: 'error', detail: 'target_gone' });
    return submitForm(handle.element);
  }
}

/** What the script tag says. A tag without a chatbot id, or whose `src` cannot be turned into a base URL, is
 *  not something to guess about: the widget does nothing and says why, once, in the console the site's own
 *  developer is already watching. */
export function readMountOptions(script: HTMLScriptElement | null): { baseUrl: string; publicId: string } | null {
  const publicId = script?.getAttribute('data-chatbot')?.trim() ?? '';
  const src = script?.src ?? '';
  if (publicId === '' || src === '') return null;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  // The asset path is everything up to the script's own name; the conversation lives beside it on the same
  // public surface, which is also why no second endpoint has to be configured anywhere.
  const base = url.pathname.replace(/\/[^/]*$/, '');
  return { baseUrl: `${url.origin}${base}`, publicId };
}

/** The tag that loaded this script. `currentScript` is set while an async script runs, and the fallback
 *  covers a bundler or a tag manager that moved the script after the fact. */
function ownScript(): HTMLScriptElement | null {
  const current = document.currentScript as HTMLScriptElement | null;
  if (current && current.hasAttribute('data-chatbot')) return current;
  const tagged = document.querySelectorAll<HTMLScriptElement>('script[data-chatbot]');
  return tagged.length === 0 ? null : tagged[tagged.length - 1]!;
}

/** Boot the widget. Called once per page, by the tag the customer pasted. */
export function mount(): ElowenChatbotApi | null {
  const script = ownScript();
  const options = readMountOptions(script);
  if (!options) {
    console.warn('[elowen-chatbot] the script tag needs a src and a data-chatbot id');
    return null;
  }

  const strings = widgetStrings(detectLocale(document.documentElement.getAttribute('lang'), navigator.language));
  const page = new BrowserPage();
  let panel: ChatPanel | null = null;
  let session: ChatSession | null = null;
  /** Whether this chatbot's look has been asked for, and the answer if one is on its way: the read happens
   *  at most once per page however often the panel is opened. */
  let lookAsked = false;
  let looking: Promise<void> | null = null;

  /** Read the chatbot's own name and appearance and draw the panel with them.
   *
   *  Deliberately NOT on page load. A visitor this browser has already seen is read just before their
   *  transcript is restored, and a first-time visitor when they OPEN the panel — a click they make. A page
   *  whose panel is never opened therefore sends nothing at all, which is the promise the widget makes about
   *  an untouched page. Every refusal inside is answered with `null`, so this never rejects. */
  const look = (): Promise<void> => {
    if (looking !== null) return looking;
    if (lookAsked) return Promise.resolve();
    looking = (async () => {
      const value = await session?.loadAppearance() ?? null;
      if (value) panel?.applyAppearance(value);
      lookAsked = true;
    })();
    return looking;
  };

  panel = new ChatPanel({
    strings,
    look: { name: '', appearance: DEFAULT_APPEARANCE },
    // The panel already showed the visitor's message; the conversation is told that it did.
    onVisitorMessage: (text) => void session?.send(text, { shown: true }),
    onStop: () => session?.stopWatching(),
    onOpen: () => void look(),
  });

  session = new ChatSession({
    baseUrl: options.baseUrl,
    publicId: options.publicId,
    view: panel,
    page,
    fetch: (...args) => fetch(...args),
    storage: safeStorage(),
    strings,
  });

  (document.body ?? document.documentElement).appendChild(panel.host);
  // A conversation this tab already had is restored, and nothing at all is sent when it never had one. The
  // look is read FIRST, because a panel that has to be built with it cannot restore a transcript into a
  // panel that would then be replaced under it.
  if (session.hasStoredToken()) void look().then(() => session.start());
  if (page.arrivedByNavigation) panel.open();

  const api: ElowenChatbotApi = {
    version: PUBLIC_SCHEMA_VERSION,
    open: () => panel?.open(),
    close: () => panel?.close(),
    destroy: () => {
      session?.destroy();
      panel?.destroy();
      delete window.ElowenChatbot;
    },
  };
  window.ElowenChatbot = api;
  return api;
}

/** Session storage, when the browser offers it. A browser that refuses it (private mode, a site that blocks
 *  storage) still gets a working conversation for as long as the page lives. */
function safeStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

if (window.ElowenChatbot === undefined) mount();