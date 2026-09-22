import { afterEach, describe, expect, it, vi } from 'vitest';

const observed = vi.hoisted(() => ({ code: null as string | null }));
vi.mock('../plugins/chatbot/embed-src/chatPanel.js', () => ({
  ChatPanel: class {
    host = document.createElement('div');
    open(): void {}
    destroy(): void { this.host.remove(); }
  },
}));
vi.mock('../plugins/chatbot/embed-src/session.js', () => ({
  ChatSession: class {
    constructor(deps: { page: { takeHandoff(): string | null } }) { observed.code = deps.page.takeHandoff(); }
    hasStoredToken(): boolean { return false; }
    destroy(): void {}
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  delete window.ElowenChatbot;
  history.replaceState(null, '', '/');
});

describe('the handoff fragment at mount', () => {
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
});
