import { afterEach, describe, expect, it, vi } from 'vitest';

const observed = vi.hoisted(() => ({
  code: null as string | null,
  lookPromise: null as Promise<{ name: string; appearance: { colors: { launcher: string } } } | null> | null,
  panels: [] as { host: HTMLDivElement; applyAppearance(look: { appearance: { colors: { launcher: string } } }): void }[],
  panelStorage: null as Storage | null,
  sessionStorage: null as Storage | null,
}));
vi.mock('../plugins/chatbot/embed-src/chatPanel.js', () => ({
  ChatPanel: class {
    host = document.createElement('div');
    constructor(options: { look: { appearance: { colors: { launcher: string } } }; storage: Storage | null }) {
      observed.panelStorage = options.storage;
      this.host.style.backgroundColor = options.look.appearance.colors.launcher;
      observed.panels.push(this);
    }
    applyAppearance(look: { appearance: { colors: { launcher: string } } }): void {
      this.host.style.backgroundColor = look.appearance.colors.launcher;
    }
    open(): void {}
    destroy(): void { this.host.remove(); }
  },
}));
vi.mock('../plugins/chatbot/embed-src/session.js', () => ({
  ChatSession: class {
    constructor(deps: { page: { takeHandoff(): string | null }; storage: Storage | null }) {
      observed.code = deps.page.takeHandoff();
      observed.sessionStorage = deps.storage;
    }
    hasStoredToken(): boolean { return false; }
    loadAppearance(): Promise<{ name: string; appearance: { colors: { launcher: string } } } | null> {
      return observed.lookPromise ?? Promise.resolve(null);
    }
    destroy(): void {}
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  delete window.ElowenChatbot;
  history.replaceState(null, '', '/');
  observed.lookPromise = null;
  observed.panels.length = 0;
  observed.panelStorage = null;
  observed.sessionStorage = null;
});

describe('the handoff fragment at mount', () => {
  it('keeps bot preferences across browser sessions, but keeps visitor tokens session-scoped', async () => {
    const script = document.createElement('script');
    script.src = 'https://elowen.example/hooks/chatbot/v2/widget.js';
    script.dataset.chatbot = 'cbt_0123456789abcdef01234567';
    document.body.append(script);
    const { mount } = await import('../plugins/chatbot/embed-src/index.js');
    window.ElowenChatbot?.destroy();
    mount();
    expect(observed.panelStorage).toBe(window.localStorage);
    expect(observed.sessionStorage).toBe(window.sessionStorage);
    expect(observed.panelStorage).not.toBe(observed.sessionStorage);
  });

  it('cleans a late-loaded fragment through the router public history path', async () => {
    const code = 'a'.repeat(64);
    history.replaceState({ __NA: true, tree: 'framework-private' }, '', '/target#section&elowen-handoff=' + code);
    let canonicalUrl = location.href;
    const native = history.replaceState.bind(history);
    // Next.js ignores its internally marked writes when synchronizing canonicalUrl.
    vi.spyOn(history, 'replaceState').mockImplementation((state, title, url) => {
      if (!state?.__NA && !state?._N && url) canonicalUrl = new URL(url, location.href).href;
      native(state, title, url);
    });
    const script = document.createElement('script');
    script.src = 'https://elowen.example/hooks/chatbot/v2/widget.js';
    script.dataset.chatbot = 'cbt_0123456789abcdef01234567';
    document.body.append(script);
    const { mount } = await import('../plugins/chatbot/embed-src/index.js');
    window.ElowenChatbot?.destroy();
    history.replaceState({ __NA: true }, '', '/target#section&elowen-handoff=' + code);
    canonicalUrl = location.href;
    mount();
    expect(observed.code).toBe(code);
    expect(location.hash).toBe('#section');
    expect(canonicalUrl).toBe(location.href);
  });

  it('keeps the built-in launcher out of the document until the configured look is applied', async () => {
    const script = document.createElement('script');
    script.src = 'https://elowen.example/hooks/chatbot/v2/widget.js';
    script.dataset.chatbot = 'cbt_0123456789abcdef01234567';
    document.body.append(script);
    const { mount } = await import('../plugins/chatbot/embed-src/index.js');
    let resolveLook!: (value: { name: string; appearance: { colors: { launcher: string } } }) => void;
    observed.lookPromise = new Promise((resolve) => { resolveLook = resolve; });
    mount();
    const panel = observed.panels.at(-1)!;
    const builtInColor = panel.host.style.backgroundColor;
    expect(builtInColor).not.toBe('rgb(18, 52, 86)');
    expect(panel.host.isConnected).toBe(false);

    resolveLook({ name: 'Customer', appearance: { colors: { launcher: '#123456' } } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.host.isConnected).toBe(true);
    expect(panel.host.style.backgroundColor).toBe('rgb(18, 52, 86)');
    expect(panel.host.style.backgroundColor).not.toBe(builtInColor);
  });

  it('leaves the default panel unattached when the look is refused or unreadable', async () => {
    const script = document.createElement('script');
    script.src = 'https://elowen.example/hooks/chatbot/v2/widget.js';
    script.dataset.chatbot = 'cbt_0123456789abcdef01234567';
    document.body.append(script);
    observed.lookPromise = Promise.resolve(null);
    const { mount } = await import('../plugins/chatbot/embed-src/index.js');
    mount();
    const panel = observed.panels.at(-1)!;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.host.isConnected).toBe(false);
  });
});
