/** The script a customer pastes into their website.
 *
 *  ```html
 *  <script async src="https://elowen.example/hooks/chatbot/v1/widget.js" data-chatbot="cbt_…"></script>
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

import { capturePageSnapshot, type PageTargetHandle } from './pageSnapshot.js';
import { performAction, submitForm, type ActionReport, type PerformableAction } from './pageActions.js';
import { ChatPanel } from './chatPanel.js';
import { ChatSession, type CapturedPage, type PageBridge } from './session.js';
import { WIDGET_PROTOCOL_VERSION } from '../src/publicContract.js';
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

/** How many of a conversation's page descriptions the bridge keeps element handles for. A later message
 *  captures a new one, and an action belonging to the turn before it must still find its element: a handful
 *  of turns back is enough for that, and holding every snapshot a long conversation ever took would be a
 *  leak with no upper bound. */
const REMEMBERED_SNAPSHOTS = 4;

/** The page, as the conversation sees it: described on demand, acted on through the handles of the snapshot
 *  the action was approved against. */
class BrowserPage implements PageBridge {
  private readonly handles = new Map<string, PageTargetHandle[]>();

  capture(): CapturedPage {
    const snapshot = capturePageSnapshot();
    this.handles.set(snapshot.snapshotId, snapshot.targets);
    while (this.handles.size > REMEMBERED_SNAPSHOTS) {
      const oldest = this.handles.keys().next().value;
      if (oldest === undefined) break;
      this.handles.delete(oldest);
    }
    return {
      snapshotId: snapshot.snapshotId,
      json: snapshot.json,
      targets: snapshot.targets.map((target) => ({ id: target.id, caps: target.caps })),
    };
  }

  holds(snapshotId: string): boolean {
    return this.handles.has(snapshotId);
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
    return performAction(action, this.handles.get(snapshotId) ?? []);
  }

  submit(snapshotId: string, targetId: string): Promise<ActionReport> {
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

  panel = new ChatPanel({
    strings,
    botName: '',
    // The panel already showed the visitor's message; the conversation is told that it did.
    onVisitorMessage: (text) => void session?.send(text, { shown: true }),
    onStop: () => session?.stopWatching(),
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
  // A conversation this tab already had is restored, and nothing at all is sent when it never had one.
  void session.start();

  const api: ElowenChatbotApi = {
    version: WIDGET_PROTOCOL_VERSION,
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
