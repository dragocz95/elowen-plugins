import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import manifest from '../plugins/chatbot/elowen-plugin.json' with { type: 'json' };
import { APPEARANCE_BOUNDS, DEFAULT_APPEARANCE, DEFAULT_STORED_APPEARANCE, APPEARANCE_TEMPLATES, appearanceRamp, appearanceIcon, appearanceIconSvg, type StoredAppearance } from '../plugins/chatbot/src/appearanceContract';
import type { LimitValues } from '../plugins/chatbot/src/limits';
import { ChatbotDeck } from '../plugins/chatbot/web-src/ChatbotDeck';
import type { ChatbotBotView, ChatbotsAnswer } from '../plugins/chatbot/web-src/types';
import { detectLocale, widgetStrings } from '../plugins/chatbot/embed-src/strings';
import { ChatPanel } from '../plugins/chatbot/embed-src/chatPanel';
import { HttpResponse, close, http, listen, resetHandlers, setDefaults, use } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';

/** The appearance editor, rendered the way it renders in production: inside the host's own runtime fixture,
 *  reached from the register through the host components, with the LIVE preview mounting the widget's real
 *  client into a shadow root.
 *
 *  jsdom cannot paint, so this suite asserts the two things it CAN see honestly: which values reached the
 *  real widget client (its own deep-chat configuration and the panel's generated stylesheet) and what the
 *  editor sent to the server. That the configured look then PAINTS is a browser's question, and the browser
 *  harness answers it. */

// deep-chat is the message renderer; it is a browser artifact and not what is under test here. The stub
// keeps jsdom deterministic while the panel's own configuration — the thing the appearance decides — is
// asserted as it really is.
vi.mock('deep-chat', () => {
  class StubChat extends HTMLElement {
    onComponentRender?: (ref: unknown) => void;
    connectedCallback(): void { this.onComponentRender?.(this); }
    getMessages(): { role?: string; text?: string }[] { return this._messages; }
    addMessage(message: { role?: string; text?: string }): void { this._messages.push(message); }
    updateMessage(message: { text?: string }, index: number): void { this._messages[index] = { role: 'ai', ...message }; }
    disableSubmitButton(): void { /* renderer stub */ }
    focusInput(): void { /* no focus in jsdom */ }
    /** The panel scrolls a restored transcript to its end through this; jsdom has no layout, so it only has
     *  to exist. */
    scrollToBottom(): void { /* no layout in jsdom */ }
    private readonly _messages: { role?: string; text?: string }[] = [];
  }
  if (!customElements.get('deep-chat')) customElements.define('deep-chat', StubChat);
  return { DeepChat: StubChat };
});

ensurePluginUiRuntime();

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
/** The widget's own strings, read exactly as the preview reads them: the quick-button group's label comes from
 *  here, not from the administrator's manifest. */
const widget = widgetStrings(detectLocale(document.documentElement.getAttribute('lang'), navigator.language));
const SITE = 'https://www.example.cz';

/** The limits the server reports for the fixture chatbot. The appearance editor never touches them, but the
 *  page it is opened from draws them, and a bot without them is not a bot this API can answer with: every
 *  field is present, null where the owner has not decided. */
const LIMITS: LimitValues = {
  rateIpPerMinute: 30,
  rateChatbotPerMinute: 60,
  rateConversationPerMinute: 10,
  dailyTurnLimit: 200,
  dailyCostMicrousd: null,
  maxConcurrentTurns: 2,
  maxQueueDepth: 4,
  queueTimeoutSeconds: 60,
  maxActionsPerTurn: 8,
  retentionDays: 30,
};

/** The chatbot the editor is opened on, typed as the view the plugin's own contract declares. The type is
 *  what a reader checks the fixture against; the runtime shape is what matters to the page, and a field the
 *  page has come to read but the API does not send is a crash rather than a wrong value — which is how this
 *  fixture went stale the first time. */
const bot: ChatbotBotView = {
  chatbotUserId: 12,
  publicId: 'cbt_0123456789abcdef01234567',
  displayName: 'Městský úřad',
  status: 'enabled' as const,
  origins: [SITE],
  maySubmitForms: true,
  appearance: DEFAULT_STORED_APPEARANCE,
  embedSnippet: null,
  updatedAt: '2026-09-21T16:00:00.000Z',
  account: { username: 'ured-bot', type: 'chatbot' as const, isAdmin: false },
  projects: [{ id: 4, slug: 'ured' }],
  model: { exec: 'elowen:anthropic/claude-sonnet-4', source: 'preference' as const },
  blockers: [],
  insecureOrigins: [],
  limits: LIMITS,
  budget: { day: '2026-09-21', admittedTurns: 0, usage: { turns: 0, tokens: 0, costUsd: null, costedTurns: 0 }, verdict: { ok: true } },
  missingLimits: [],
  sensitiveMode: false,
};

/** What the PUT that saves the look carried, and what it answered with. */
const saved: { body: Record<string, unknown> | null } = { body: null };

const savedBot = (body: Record<string, unknown>): ChatbotBotView => ({
  ...bot,
  displayName: String(body.displayName ?? bot.displayName),
  appearance: body.appearance as StoredAppearance,
  updatedAt: '2026-09-21T17:00:00.000Z',
});

const botsBody = (): ChatbotsAnswer => ({ bots: [bot], candidates: [], projects: [{ id: 4, slug: 'ured' }], requiredTools: [] });

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'chatbot', url: '/plugins/chatbot/web/index.js', apiVersion: 12, nav: [], settings: [], strings }])),
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'filip', is_admin: true } })),
  http.get('/api/brain/models', () => HttpResponse.json([])),
  http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json(botsBody())),
  http.put('/api/plugins/chatbot/api/appearance', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    saved.body = body;
    return HttpResponse.json({ bot: savedBot(body) });
  }),
);

beforeAll(() => listen());
afterEach(() => { cleanup(); resetHandlers(); saved.body = null; });
afterAll(() => close());

/** Open the editor the way an administrator does: in the Chatbots modal, a row of the register opens its
 *  drawer, and the drawer's footer opens the appearance window over it. The editor is therefore the
 *  SECOND dialog on screen — the drawer it was opened from stays mounted under it. */
async function openEditor(): Promise<HTMLElement> {
  const { wrapper: Wrapper } = createWrapper();
  render(<Wrapper><ToastProvider><ChatbotDeck plugin="chatbot" rest={[]} /></ToastProvider></Wrapper>);
  await screen.findAllByRole('button', { name: strings.newBot! });
  await screen.findByText(bot.displayName);
  fireEvent.click(await screen.findByRole('button', { name: strings.openBot!.replace('{name}', bot.displayName) }));
  const drawer = await screen.findByRole('dialog');
  fireEvent.click(within(drawer).getByRole('button', { name: strings.appearanceAction! }));
  await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2));
  const dialogs = screen.getAllByRole('dialog');
  const dialog = dialogs[dialogs.length - 1]!;
  await waitFor(() => expect(dialog.querySelector('[data-elowen-chatbot]')).not.toBeNull());
  return dialog;
}

/** The live preview's panel, re-read every time: the widget client mounted in its own shadow root inside the
 *  modal. It has to be re-read rather than held, because a change of look REPLACES the message element —
 *  a reference taken before a control was touched is the panel as it was, which is the bug these tests
 *  would otherwise be blind to. */
function previewPanel(dialog: HTMLElement): { host: Element; style: HTMLStyleElement; chat: HTMLElement & Record<string, any> } {
  const host = dialog.querySelector('[data-elowen-chatbot]');
  if (host === null) throw new Error('the preview mounted no panel');
  const shadow = host.shadowRoot!;
  return {
    host,
    style: shadow.querySelector('style')!,
    chat: shadow.querySelector('deep-chat') as HTMLElement & Record<string, any>,
  };
}

/** The name field, found by the value it is showing. The host renders a field's hint as a "?" trigger INSIDE
 *  the label, and the label's first labelable element is that trigger — so a label query would hand back the
 *  hint button rather than the control it labels. */
const nameField = (dialog: HTMLElement, value: string): HTMLInputElement => within(dialog).getByDisplayValue(value) as HTMLInputElement;

const slider = (dialog: HTMLElement, name: string): HTMLInputElement =>
  within(dialog).getByRole('slider', { name }) as HTMLInputElement;

describe('visitor attention', () => {
  it('uses native deep-chat scrolling and keeps sound gated to an unseen live answer', async () => {
    const previousAudio = window.AudioContext;
    const start = vi.fn();
    const resume = vi.fn().mockResolvedValue(undefined);
    const oscillator = { type: 'sine', frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start, stop: vi.fn() };
    class AudioContextStub {
      state = 'running';
      currentTime = 0;
      destination = {};
      resume = resume;
      createOscillator = () => oscillator;
      createGain = () => ({ gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() });
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: AudioContextStub });
    const storage = new Map<string, string>();
    const panel = new ChatPanel({ look: { name: 'Help', appearance: DEFAULT_APPEARANCE }, strings: widget, publicId: 'attention-test', storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } }, onVisitorMessage: () => undefined, onStop: () => undefined });
    document.body.append(panel.host);
    const chat = panel.host.shadowRoot!.querySelector('deep-chat') as HTMLElement & Record<string, any>;
    expect(chat.scrollButton.smoothScroll).toBe(true);
    expect(chat.hiddenMessages.clickScroll).toBe('last');
    const initialTitle = document.title;
    document.title = 'Host page';
    try {
      panel.restore([{ role: 'ai', text: 'Old answer' }]);
      expect(start).not.toHaveBeenCalled();
      panel.host.shadowRoot!.querySelector<HTMLButtonElement>('.launcher')!.click();
      panel.beginAnswer();
      panel.finishAnswer('Visible answer');
      expect(start).not.toHaveBeenCalled();
      panel.close();
      panel.beginAnswer();
      panel.finishAnswer('First answer');
      expect(start).toHaveBeenCalledTimes(2);
      expect(panel.host.shadowRoot!.querySelector('.launcher-badge')?.textContent).toBe('1');
      expect(document.title).toBe('(1) Host page');
      panel.beginAnswer();
      panel.finishAnswer('Second answer');
      expect(document.title).toBe('(2) Host page');
      panel.open();
      expect(document.title).toBe('Host page');
      panel.close();
      panel.beginAnswer();
      panel.finishAnswer('Third answer');
      document.title = 'Changed by page';
      panel.open();
      expect(document.title).toBe('Changed by page');
      panel.host.shadowRoot!.querySelector<HTMLButtonElement>('.mute')!.click();
      panel.close();
      start.mockClear();
      panel.beginAnswer();
      panel.finishAnswer('Muted answer');
      expect(start).not.toHaveBeenCalled();
      expect(storage.get('elowen-chatbot:attention-test:muted')).toBe('1');
    } finally {
      panel.destroy();
      document.title = initialTitle;
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: previousAudio });
    }
  });
});

describe('the appearance editor', () => {
  it('writes effects, teaser and sound overrides and resets a gradient end to solid', async () => {
    const dialog = await openEditor();
    fireEvent.change(slider(dialog, strings.appearanceGlassBlur!), { target: { value: '22' } });
    fireEvent.click(within(dialog).getByRole('switch', { name: strings.appearanceGlass! }));
    fireEvent.change(within(dialog).getByRole('combobox', { name: strings.appearanceHover! }), { target: { value: 'shine' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: strings.appearanceEntrance! }), { target: { value: 'fade' } });
    fireEvent.change(within(dialog).getByLabelText(strings.appearanceGradientVisitor!), { target: { value: '#345678' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: strings.appearanceTeaser! }), { target: { value: 'Need a hand?' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: strings.appearanceTone! }), { target: { value: 'bell' } });
    const preview = previewPanel(dialog);
    expect(preview.chat.messageStyles.default.user.bubble.background).toContain('linear-gradient');
    expect(preview.chat.auxiliaryStyle).toContain('cb-shine');
    await waitFor(() => expect(saved.body?.appearance).toMatchObject({ overrides: {
      colors: { visitorBubbleEnd: '#345678' }, effects: { glass: false, glassBlur: 22, buttonHover: 'shine', messageEntrance: 'fade' },
      launcher: { teaser: 'Need a hand?' }, sound: { tone: 'bell' },
    } }), { timeout: 3000 });
    fireEvent.click(within(dialog).getByRole('button', { name: `${strings.appearanceGradientVisitor}: ${strings.appearanceSolid}` }));
    expect(previewPanel(dialog).chat.messageStyles.default.user.bubble.background).toBe(DEFAULT_APPEARANCE.colors.visitorBubble);
    await waitFor(() => expect(saved.body?.appearance).toMatchObject({ overrides: { colors: { visitorBubbleEnd: null } } }));
  });

  it('opens on the stored look, with the widget\'s own panel already drawn beside the controls', async () => {
    const dialog = await openEditor();
    // Every control the agreed set asks for is here, and none of them is a box of CSS.
    expect(nameField(dialog, bot.displayName)).toBeInTheDocument();
    expect(slider(dialog, strings.appearanceWidthLabel!).value).toBe(String(DEFAULT_APPEARANCE.width));
    expect(slider(dialog, strings.appearanceHeightLabel!).value).toBe(String(DEFAULT_APPEARANCE.height));
    expect(slider(dialog, strings.appearanceRadiusLabel!).value).toBe(String(DEFAULT_APPEARANCE.radius));
    expect(slider(dialog, strings.appearanceWidthLabel!).min).toBe(String(APPEARANCE_BOUNDS.width.min));
    expect(slider(dialog, strings.appearanceWidthLabel!).max).toBe(String(APPEARANCE_BOUNDS.width.max));
    expect(within(dialog).getByRole('combobox', { name: strings.appearancePositionLabel! })).toHaveValue('bottom-right');
    expect(within(dialog).getByRole('combobox', { name: strings.appearanceModeLabel! })).toHaveValue('dark');
    expect(within(dialog).getByLabelText(strings.appearanceColorPanel!)).toHaveValue(DEFAULT_APPEARANCE.colors.panel);
    expect(within(dialog).getByLabelText(strings.appearanceColorVisitor!)).toHaveValue(DEFAULT_APPEARANCE.colors.visitorBubble);
    expect(within(dialog).getByLabelText(strings.appearanceColorBot!)).toHaveValue(DEFAULT_APPEARANCE.colors.botBubble);
    expect(within(dialog).getByLabelText(strings.appearanceColorSend!)).toHaveValue(DEFAULT_APPEARANCE.colors.sendButton);
    expect(within(dialog).getByPlaceholderText(strings.appearanceIntroPlaceholder!)).toHaveValue('');
    expect(within(dialog).getByPlaceholderText(strings.appearanceAvatarPlaceholder!)).toHaveValue('');
    expect(within(dialog).queryByText('No quick button yet.')).not.toBeInTheDocument();

    // The preview is the REAL client, configured from that stored look and mounted in its own shadow root.
    const preview = previewPanel(dialog);
    expect(preview.style.textContent).toContain(`background: ${DEFAULT_APPEARANCE.colors.panel}`);
    expect(preview.chat.messageStyles.default.ai.bubble.backgroundColor).toBe(DEFAULT_APPEARANCE.colors.botBubble);
    expect(preview.chat.names.ai.text).toBe(bot.displayName);
  });

  it('follows every control into the preview and auto-saves the appearance', async () => {
    const dialog = await openEditor();
    const chat = () => previewPanel(dialog).chat;
    const css = () => previewPanel(dialog).style.textContent ?? '';

    // A colour, a size, a radius, the corner, the greeting and the name all reach the live panel.
    fireEvent.change(within(dialog).getByLabelText(strings.appearanceColorVisitor!), { target: { value: '#123456' } });
    expect(chat().messageStyles.default.user.bubble.backgroundColor).toBe('#123456');

    fireEvent.change(slider(dialog, strings.appearanceWidthLabel!), { target: { value: '520' } });
    expect(css()).toContain('width: min(520px');

    fireEvent.change(slider(dialog, strings.appearanceRadiusLabel!), { target: { value: '4' } });
    expect(css()).toContain('border-radius: 4px');

    fireEvent.change(within(dialog).getByRole('combobox', { name: strings.appearancePositionLabel! }), { target: { value: 'top-left' } });
    expect(css()).toContain('left: 20px; top: 20px;');

    fireEvent.change(within(dialog).getByPlaceholderText(strings.appearanceIntroPlaceholder!), { target: { value: 'Dobrý den, pomohu vám.' } });
    expect(chat().introMessage.html).toContain('Dobrý den, pomohu vám.');

    fireEvent.change(nameField(dialog, bot.displayName), { target: { value: 'Podatelna' } });
    expect(chat().names.ai.text).toBe('Podatelna');
    // The name is part of the look and autosaves in the same snapshot as the appearance.
    expect(previewPanel(dialog).host.shadowRoot!.querySelector('.title')!.textContent).toBe('Podatelna');
    await waitFor(() => expect(saved.body?.displayName).toBe('Podatelna'), { timeout: 3000 });
  });

  it('draws the quick buttons under the greeting, and a click on one is the visitor\'s own message', async () => {
    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByPlaceholderText(strings.appearanceQuickPlaceholder!), { target: { value: 'Chci vyplnit formulář' } });
    fireEvent.click(within(dialog).getByRole('button', { name: strings.appearanceQuickAdd! }));
    expect(within(dialog).getByText('Chci vyplnit formulář')).toBeInTheDocument();

    // The buttons are part of the greeting the widget is handed, and the widget wires their clicks itself.
    const chat = previewPanel(dialog).chat;
    expect(chat.introMessage.html).toContain('data-cb-text="Chci vyplnit formulář"');
    // …inside one labelled group, so a screen reader announces them as the suggestions they are.
    expect(chat.introMessage.html).toContain(`<div class="cb-quick" role="group" aria-label="${widget.quickButtons}"><button type="button" class="cb-quick-item"`);
    const utilities = chat.htmlClassUtilities as Record<string, { events?: Record<string, (event: unknown) => void> }>;
    expect(typeof utilities['cb-quick-item']?.events?.click).toBe('function');

    // What a click does, through the widget's own handler: the text is drawn as the visitor's message.
    expect(chat.getMessages()).toEqual([]);
    const button = document.createElement('button');
    button.setAttribute('data-cb-text', 'Chci vyplnit formulář');
    utilities['cb-quick-item']!.events!.click!({ target: button });
    expect(previewPanel(dialog).chat.getMessages()).toEqual([{ role: 'user', text: 'Chci vyplnit formulář' }]);
    await waitFor(() => expect(saved.body).not.toBeNull());
  });

  it('confirms a template replacement, dropping changes only after approval', async () => {
    const dialog = await openEditor();
    const input = within(dialog).getByLabelText(strings.appearanceColorPanel!);
    fireEvent.change(input, { target: { value: '#123456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: strings.appearanceTemplate_clean! }));
    expect(previewPanel(dialog).style.textContent).toContain('background: #123456');
    expect(await screen.findByText(strings.appearanceTemplateReplace!)).toBeInTheDocument();
    const confirmation = screen.getAllByRole('dialog').at(-1)!;
    fireEvent.click(within(confirmation).getByRole('button', { name: strings.appearanceTemplateApply! }));
    await waitFor(() => expect(previewPanel(dialog).style.textContent).toContain(`background: ${APPEARANCE_TEMPLATES.clean.colors.panel}`));
    expect(within(dialog).queryByRole('button', { name: strings.appearanceReset!.replace('{value}', strings.appearanceColorPanel!) })).not.toBeInTheDocument();
    await waitFor(() => expect(saved.body?.appearance).toEqual({ schemaVersion: 2, template: 'clean', overrides: {} }));
  });

  it('previews, saves and resets an independent Indigo header', async () => {
    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('button', { name: strings.appearanceTemplate_indigo! }));
    fireEvent.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: strings.appearanceTemplateApply! }));
    const header = within(dialog).getByLabelText(strings.appearanceColorHeader!);
    const templateRamp = appearanceRamp(APPEARANCE_TEMPLATES.indigo);
    expect(header).toHaveValue(templateRamp.header);
    const preview = previewPanel(dialog);
    expect(preview.style.textContent).toContain(`background: linear-gradient(135deg, ${templateRamp.header}, ${APPEARANCE_TEMPLATES.indigo.colors.headerEnd}); color: ${templateRamp.headerInk}`);
    expect(preview.host.shadowRoot!.querySelector('.header-avatar')).toHaveAttribute('hidden');
    expect(preview.host.shadowRoot!.querySelector('.subtitle')).toHaveAttribute('hidden');
    fireEvent.change(header, { target: { value: '#442255' } });
    expect(previewPanel(dialog).style.textContent).toContain(`background: linear-gradient(135deg, #442255, ${APPEARANCE_TEMPLATES.indigo.colors.headerEnd})`);
    await waitFor(() => expect(saved.body?.appearance).toEqual({ schemaVersion: 2, template: 'indigo', overrides: { colors: { header: '#442255' } } }));
    fireEvent.click(within(dialog).getByRole('button', { name: strings.appearanceReset!.replace('{value}', strings.appearanceColorHeader!) }));
    expect(header).toHaveValue(templateRamp.header);
    expect(previewPanel(dialog).style.textContent).toContain(`background: linear-gradient(135deg, ${templateRamp.header}, ${APPEARANCE_TEMPLATES.indigo.colors.headerEnd}); color: ${templateRamp.headerInk}`);
    await waitFor(() => expect(saved.body?.appearance).toEqual({ schemaVersion: 2, template: 'indigo', overrides: {} }));
  });

  it('resets a single override without resetting the other choices', async () => {
    const dialog = await openEditor();
    fireEvent.change(slider(dialog, strings.appearanceWidthLabel!), { target: { value: '500' } });
    fireEvent.change(slider(dialog, strings.appearanceHeightLabel!), { target: { value: '640' } });
    fireEvent.click(within(dialog).getByRole('button', { name: strings.appearanceReset!.replace('{value}', strings.appearanceWidthLabel!) }));
    expect(slider(dialog, strings.appearanceWidthLabel!)).toHaveValue(String(DEFAULT_APPEARANCE.width));
    expect(slider(dialog, strings.appearanceHeightLabel!)).toHaveValue('640');
    await waitFor(() => expect(saved.body?.appearance).toEqual({ schemaVersion: 2, template: 'elowen', overrides: { height: 640 } }));
  });

  it('renders the launcher label, curated send icon and independent colours in the actual preview', async () => {
    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByRole('textbox', { name: strings.appearanceLauncherLabel! }), { target: { value: 'Ask us' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: strings.appearanceSendIcon! }), { target: { value: 'calendar' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: strings.appearanceLauncherIcon! }), { target: { value: 'phone' } });
    fireEvent.change(within(dialog).getByLabelText(strings.appearanceColorSendIcon!), { target: { value: '#abcdef' } });
    fireEvent.change(within(dialog).getByLabelText(strings.appearanceColorLauncher!), { target: { value: '#123456' } });
    const preview = previewPanel(dialog);
    const launcher = preview.host.shadowRoot!.querySelector('.launcher') as HTMLButtonElement;
    expect(launcher).not.toHaveAttribute('hidden');
    expect(launcher.textContent).toBe('Ask us');
    expect(launcher.innerHTML).toContain('launcher-label');
    expect(launcher.querySelector('svg')).not.toBeNull();
    expect(preview.chat.submitButtonStyles.submit.svg.content).toBe(appearanceIconSvg('calendar'));
    expect(preview.chat.submitButtonStyles.disabled.svg.content).toBe(appearanceIconSvg('calendar'));
    expect(preview.chat.submitButtonStyles.submit.svg.styles.default.color).toBe('#abcdef');
    expect(preview.style.textContent).toContain(`background: linear-gradient(135deg, #123456, ${DEFAULT_APPEARANCE.colors.launcherEnd})`);
    expect(preview.chat.submitButtonStyles.submit.container.default.backgroundColor).toBe(DEFAULT_APPEARANCE.colors.sendButton);
    await waitFor(() => expect(saved.body).not.toBeNull());
  });

  it('cancels a template change without losing manual values', async () => {
    const dialog = await openEditor();
    fireEvent.change(slider(dialog, strings.appearanceWidthLabel!), { target: { value: '500' } });
    fireEvent.click(within(dialog).getByRole('button', { name: strings.appearanceTemplate_warm! }));
    const confirmation = screen.getAllByRole('dialog').at(-1)!;
    const cancel = within(confirmation).getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancel);
    expect(slider(dialog, strings.appearanceWidthLabel!)).toHaveValue('500');
    expect(within(dialog).getByRole('button', { name: strings.appearanceTemplate_elowen! })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(saved.body).not.toBeNull());
  });

  it('previews header, typography, shape, launcher geometry and local fonts', async () => {
    const dialog = await openEditor();
    const change = (label: string, value: string, role = 'textbox') => fireEvent.change(within(dialog).getByRole(role, { name: label }), { target: { value } });
    change(strings.appearanceSubtitle!, 'At your service');
    change(strings.appearancePlaceholder!, 'Your question');
    change(strings.appearanceFontFamily!, 'serif', 'combobox');
    change(strings.appearanceFontSize!, '18', 'slider');
    change(strings.appearanceShadow!, 'none', 'combobox');
    change(strings.appearanceSendShape!, 'rounded-square', 'combobox');
    change(strings.appearanceLauncherSize!, '72', 'slider');
    change(strings.appearanceLauncherOffset!, '40', 'slider');
    fireEvent.click(within(dialog).getByRole('switch', { name: strings.appearanceShowMessageName! }));
    const preview = previewPanel(dialog);
    expect(preview.host.shadowRoot!.querySelector('.subtitle')?.textContent).toBe('At your service');
    expect(preview.chat.textInput.placeholder.text).toBe('Your question');
    expect(preview.chat.chatStyle.fontFamily).toContain('Georgia');
    expect(preview.chat.chatStyle.fontSize).toBe('18px');
    expect(preview.chat.names).toBeUndefined();
    expect(preview.chat.submitButtonStyles.submit.container.default.borderRadius).toBe('8px');
    expect(preview.style.textContent).toContain('box-shadow: none');
    expect(preview.style.textContent).toContain('right: 40px; bottom: 40px;');
    expect(preview.style.textContent).toContain('min-height: 72px');
    expect(preview.style.textContent).not.toContain('@import');
    await waitFor(() => expect(saved.body).not.toBeNull());
  });

  it('adds an icon chip with Enter, removes it and saves the object shape', async () => {
    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByRole('combobox', { name: strings.appearanceQuickIcon! }), { target: { value: 'calendar' } });
    const input = within(dialog).getByPlaceholderText(strings.appearanceQuickPlaceholder!);
    fireEvent.change(input, { target: { value: 'Book' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(previewPanel(dialog).chat.introMessage.html).toContain(appearanceIconSvg('calendar'));
    await waitFor(() => expect((saved.body?.appearance as StoredAppearance).overrides.quickButtons).toEqual([{ text: 'Book', icon: 'calendar' }]));
    fireEvent.click(within(dialog).getByRole('button', { name: strings.appearanceQuickRemove!.replace('{value}', 'Book') }));
    expect(within(dialog).queryByText('Book')).not.toBeInTheDocument();
    await waitFor(() => expect((saved.body?.appearance as StoredAppearance).overrides.quickButtons).toEqual([]));
  });

  it('shows an avatar once one is given, and keeps an obviously wrong address out of a save', async () => {
    const dialog = await openEditor();
    expect(previewPanel(dialog).chat.avatars).toBeUndefined();

    const avatar = within(dialog).getByPlaceholderText(strings.appearanceAvatarPlaceholder!);
    fireEvent.change(avatar, { target: { value: 'https://www.example.cz/logo.svg' } });
    expect(previewPanel(dialog).chat.avatars).toEqual({ ai: { src: 'https://www.example.cz/logo.svg' } });

    fireEvent.change(avatar, { target: { value: 'logo.svg' } });
    expect(within(dialog).getByText(strings.appearanceInvalid!)).toBeInTheDocument();
    expect(saved.body).toBeNull();
  });

  it('keeps a message the preview already drew when the look changes under it', async () => {
    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByPlaceholderText(strings.appearanceQuickPlaceholder!), { target: { value: 'Kde je podatelna?' } });
    fireEvent.click(within(dialog).getByRole('button', { name: strings.appearanceQuickAdd! }));
    const before = previewPanel(dialog).chat;
    const utilities = before.htmlClassUtilities as Record<string, { events?: Record<string, (event: unknown) => void> }>;
    const button = document.createElement('button');
    button.setAttribute('data-cb-text', 'Kde je podatelna?');
    utilities['cb-quick-item']!.events!.click!({ target: button });
    expect(before.getMessages()).toHaveLength(1);

    // The look cannot be changed in place — the renderer rebuilds its message list — so the panel replaces
    // its message element and carries what it was showing across.
    fireEvent.change(slider(dialog, strings.appearanceRadiusLabel!), { target: { value: '24' } });
    const after = previewPanel(dialog).chat;
    expect(after).not.toBe(before);
    expect(after.messageStyles.default.ai.bubble.borderRadius).toBe('24px');
    expect(after.getMessages()).toEqual([{ role: 'user', text: 'Kde je podatelna?' }]);
    await waitFor(() => expect(saved.body).not.toBeNull());
  });

  it('auto-saves the whole look and the name together', async () => {
    const dialog = await openEditor();
    fireEvent.change(slider(dialog, strings.appearanceHeightLabel!), { target: { value: '640' } });
    fireEvent.change(within(dialog).getByPlaceholderText(strings.appearanceIntroPlaceholder!), { target: { value: 'Dobrý den.' } });
    fireEvent.change(nameField(dialog, bot.displayName), { target: { value: 'Podatelna města' } });

    await waitFor(() => expect(saved.body).not.toBeNull());
    expect(saved.body!.chatbotUserId).toBe(bot.chatbotUserId);
    // The row the editor read is the concurrency token, exactly as every other write of a bot is.
    expect(saved.body!.expectedUpdatedAt).toBe(bot.updatedAt);
    expect(saved.body!.displayName).toBe('Podatelna města');
    expect((saved.body!.appearance as StoredAppearance).overrides.height).toBe(640);
    expect((saved.body!.appearance as StoredAppearance).overrides.intro).toBe('Dobrý den.');
    expect((saved.body!.appearance as StoredAppearance).overrides.colors).toBeUndefined();
    // The saved row is what the register now shows.
    expect(await screen.findAllByText('Podatelna města')).not.toHaveLength(0);

    // …and a second save compares against the row the first one wrote, so an editor is never left holding a
    // token the server has already moved past.
    fireEvent.change(slider(dialog, strings.appearanceRadiusLabel!), { target: { value: '9' } });
    await waitFor(() => expect((saved.body!.appearance as StoredAppearance).overrides.radius).toBe(9));
    expect(saved.body!.expectedUpdatedAt).toBe('2026-09-21T17:00:00.000Z');
  });

  it('reports a failed save instead of pretending the look was stored', async () => {
    use(http.put('/api/plugins/chatbot/api/appearance', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    const dialog = await openEditor();
    fireEvent.change(slider(dialog, strings.appearanceRadiusLabel!), { target: { value: '2' } });
    expect(await within(dialog).findByText('boom')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('refuses a second identical quick button, and stops at the ceiling', async () => {
    const dialog = await openEditor();
    const field = within(dialog).getByPlaceholderText(strings.appearanceQuickPlaceholder!);
    for (const text of ['Dotaz 1', 'Dotaz 2', 'Dotaz 3', 'Dotaz 4', 'Dotaz 5', 'Dotaz 6']) {
      fireEvent.change(field, { target: { value: text } });
      fireEvent.click(within(dialog).getByRole('button', { name: strings.appearanceQuickAdd! }));
    }
    expect(within(dialog).getByText(strings.appearanceQuickFull!)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'Dotaz 7' } });
    expect(within(dialog).getByRole('button', { name: strings.appearanceQuickAdd! })).toBeDisabled();

    fireEvent.change(field, { target: { value: 'Dotaz 1' } });
    expect(within(dialog).getByText(strings.appearanceQuickDuplicate!)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: strings.appearanceQuickAdd! })).toBeDisabled();
  });

  it('offers a friendly launcher icon and a decorative presence dot, and carries both into the preview', async () => {
    const dialog = await openEditor();
    const launcher = () => previewPanel(dialog).host.shadowRoot!.querySelector('.launcher')!;
    const css = () => previewPanel(dialog).style.textContent ?? '';

    // A face is offered beside the speech bubble, and the same catalog feeds quick buttons: an icon added for
    // the launcher is a quick-button icon by construction, so it is listed wherever icons are chosen.
    const icons = within(dialog).getByRole('combobox', { name: strings.appearanceLauncherIcon! });
    for (const icon of ['smile', 'heart', 'thumb-up'] as const) {
      expect(within(icons).getByRole('option', { name: strings[`appearanceIcon_${icon}`]! })).toBeInTheDocument();
    }
    fireEvent.change(icons, { target: { value: 'smile' } });
    expect(launcher().querySelector('path')!.getAttribute('d')).toBe(appearanceIcon('smile').path);

    // The dot is off until the owner asks for it, and the settings name it as the ornament it is rather than
    // as a claim about anybody being available.
    const dot = () => launcher().querySelector('.launcher-dot');
    const toggle = within(dialog).getByRole('switch', { name: strings.appearancePresenceLabel! });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(dot()).toBeNull();
    expect(css()).not.toContain('.launcher-dot');
    expect(within(dialog).getByTitle(strings.appearancePresenceHint!)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(dot()).not.toBeNull();
    expect(dot()!.getAttribute('aria-hidden')).toBe('true');
    expect(css()).toContain(`background: ${DEFAULT_APPEARANCE.launcher.presenceDotColor}`);
    // Ringed in the launcher's own colour, so the mark stays visible on whatever page it lands on.
    expect(css()).toContain(`solid ${DEFAULT_APPEARANCE.colors.launcher}`);

    fireEvent.change(within(dialog).getByLabelText(strings.appearanceColorPresence!), { target: { value: '#abcdef' } });
    expect(css()).toContain('background: #abcdef');

    await waitFor(() => expect((saved.body?.appearance as StoredAppearance).overrides.launcher)
      .toEqual({ icon: 'smile', presenceDot: true, presenceDotColor: '#abcdef' }));
  });
});
