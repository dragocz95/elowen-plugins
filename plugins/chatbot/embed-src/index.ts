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
import { DEFAULT_APPEARANCE, type ChatbotLook } from '../src/appearanceContract.js';
import { HANDOFF_CODE_PATTERN, HANDOFF_FRAGMENT_KEY, PUBLIC_SCHEMA_VERSION } from '../src/publicContract.js';
import { detectLocale, widgetStrings } from './strings.js';

/** The one name the widget adds to the page's global scope. */
export interface ElowenChatbotApi {
  /** The protocol version of the served bundle: `v2` today. */
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
    // Do not replay a framework's private history state. Next.js treats its own marked state as an
    // internal write and skips synchronizing the router URL, which can later restore the spent fragment.
    history.replaceState(null, '', location.pathname + location.search + (offset === 1 ? '' : hash.slice(0, offset - 1)));
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
  let destroyed = false;
  let visitorEngaged = false;
  let appearanceAppliedAfterEngagement = false;
  /** The look is resolved before the panel enters the document, so even its launcher and errors cannot flash
   *  in the widget's built-in colours. A refusal leaves the panel unattached. */
  let lookAsked = false;
  let looking: Promise<ChatbotLook | null> | null = null;

  const look = (): Promise<ChatbotLook | null> => {
    if (looking !== null) return looking;
    if (lookAsked) return Promise.resolve(null);
    looking = (async () => {
      const value = await session?.loadAppearance() ?? null;
      if (value && panel && !destroyed) {
        panel.applyAppearance(value);
        (document.body ?? document.documentElement).appendChild(panel.host);
        if (visitorEngaged) appearanceAppliedAfterEngagement = true;
      }
      lookAsked = true;
      return value;
    })();
    return looking;
  };

  panel = new ChatPanel({
    strings,
    publicId: options.publicId,
    storage: safeStorage('localStorage'),
    look: { name: '', appearance: DEFAULT_APPEARANCE },
    // deep-chat draws the submitted message before this callback runs.
    onVisitorMessage: (text) => void session?.send(text),
    onStop: () => session?.stopWatching(),
    onFeedback: (turnId, rating, comment) => session!.sendFeedback(turnId, rating, comment),
    onOpen: () => {
      visitorEngaged = true;
      void look().then((value) => {
        if (value && !appearanceAppliedAfterEngagement && !destroyed) {
          appearanceAppliedAfterEngagement = true;
          panel?.applyAppearance(value);
        }
      });
    },
    // The owner's avatar travels over the visitor's own authorized connection rather than from the image
    // host the customer's page would have to allow. Absent bytes are simply a panel without an avatar.
    loadAvatar: async () => visitorEngaged ? (await session?.loadAvatar()) ?? null : null,
  });

  session = new ChatSession({
    baseUrl: options.baseUrl,
    publicId: options.publicId,
    view: panel,
    page,
    fetch: (...args) => fetch(...args),
    storage: safeStorage('sessionStorage'),
    strings,
  });

  // The bootstrap is origin-gated and names this chatbot specifically. Resolve it before attaching the
  // launcher; otherwise the visitor sees a flash of our defaults on every page load.
  const restoreConversation = session.hasStoredToken();
  visitorEngaged = restoreConversation;
  void look().then((value) => {
    if (!value) return;
    if (restoreConversation) void session?.start();
    if (page.arrivedByNavigation) panel?.open();
  });

  const api: ElowenChatbotApi = {
    version: PUBLIC_SCHEMA_VERSION,
    open: () => panel?.open(),
    close: () => panel?.close(),
    destroy: () => {
      destroyed = true;
      session?.destroy();
      panel?.destroy();
      delete window.ElowenChatbot;
    },
  };
  window.ElowenChatbot = api;
  return api;
}

/** Prefer each browser store for its own purpose: lasting appearance choices versus the session token.
 *  If a site blocks storage, the widget still works in memory for this page. */
function safeStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

if (window.ElowenChatbot === undefined) mount();