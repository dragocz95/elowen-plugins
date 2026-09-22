import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import manifest from '../plugins/chatbot/elowen-plugin.json' with { type: 'json' };
import { ChatbotPage } from '../plugins/chatbot/web-src/ChatbotPage';
import { blockerText } from '../plugins/chatbot/web-src/BotDetail';
import { limitDraftOf, readLimitDraft, sliderRange } from '../plugins/chatbot/web-src/LimitsModal';
import { originHint } from '../plugins/chatbot/web-src/OriginsField';
import { LIMIT_FIELDS, MANDATORY_LIMITS, OPTIONAL_LIMITS, specOf, type LimitValues } from '../plugins/chatbot/src/limits';
import { actionRuleKey, draftRuleRefusal } from '../plugins/chatbot/web-src/SecuritySettings';
import { chartPoints, statsWindow } from '../plugins/chatbot/web-src/StatsView';
import { HttpResponse, close, http, listen, resetHandlers, setDefaults, use } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';

/** The chatbot page — the plugin's own entry in the main navigation, a deck of four sections — rendered
 *  the way it renders in production: inside the host's own runtime fixture, reaching EVERY component and
 *  every string through `window.ElowenUiRuntime`.
 *
 *  What this cannot prove is layout: whether the sections read as a column beside the content and as one
 *  scrollable line on a phone is a browser's judgement and is reported as unverified. What it does prove
 *  is that every section is reachable and mounts against the published component contract, that the page
 *  reads only strings its manifest declares, that its loading, error, empty and populated states are all
 *  drawn, that conversations and statistics are scoped to ONE chatbot, and that the page writes back
 *  exactly the grants, rules and numbers it showed. */

ensurePluginUiRuntime();

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
const SITE = 'https://www.example.cz';
const REQUIRED_TOOL = 'ChatbotPageAction';

/** The limits the server reports for the fixture chatbot: every field, null where the owner has not decided.
 *  Written the way the API reports it, so the form is exercised against the shape it really receives. */
const LIMITS: LimitValues = {
  rateIpPerMinute: 30,
  rateChatbotPerMinute: 60,
  rateConversationPerMinute: 10,
  dailyTurnLimit: 200,
  dailyTokenLimit: null,
  dailyCostMicrousd: null,
  maxConcurrentTurns: 2,
  maxQueueDepth: 4,
  queueTimeoutSeconds: 60,
  maxActionsPerTurn: 8,
  retentionDays: 30,
};

const bot = {
  chatbotUserId: 12,
  publicId: 'cbt_0123456789abcdef01234567',
  displayName: 'Městský úřad',
  prompt: 'Pomáhej s formuláři.',
  status: 'enabled' as const,
  origins: [SITE],
  actionRules: [] as { origin: string; pathPrefix: string; action: string; requiresConfirmation: boolean; maxPerTurn: number }[],
  embedSnippet: `<script src="https://elowen.example.com/hooks/chatbot/v1/widget.js" data-chatbot="cbt_0123456789abcdef01234567" async></script>`,
  updatedAt: '2026-09-21T16:00:00.000Z',
  account: { username: 'ured-bot', type: 'chatbot' as const, isAdmin: false },
  projects: [{ id: 4, slug: 'ured' }],
  blockers: [] as string[],
  insecureOrigins: [] as string[],
  limits: LIMITS,
  missingLimits: [] as string[],
  sensitiveMode: false,
};

const broken = {
  ...bot,
  chatbotUserId: 13,
  publicId: 'cbt_abcdefabcdefabcdefabcdef',
  displayName: 'Škola',
  status: 'draft' as const,
  projects: [],
  blockers: ['no_project', 'account_not_chatbot'],
};

/** A second chatbot that is fine in every way: the two-chatbot cases below are about which of them a view
 *  is showing, so nothing else may be wrong with either of them. */
const second = {
  ...bot,
  chatbotUserId: 14,
  publicId: 'cbt_ffffffffffffffffffffffff',
  displayName: 'Gymnázium',
  origins: ['https://www.skola.cz'],
  projects: [{ id: 5, slug: 'skola' }],
  account: { username: 'skola-bot', type: 'chatbot' as const, isAdmin: false },
};

const botsBody = (bots = [bot, broken, second]) => ({
  bots,
  candidates: [{ id: 15, username: 'novy-bot', type: 'chatbot' }],
  projects: [{ id: 4, slug: 'ured' }],
  requiredTools: [REQUIRED_TOOL],
});

const conversationOf = (visitorId: string, turns: number) => ({
  visitorId,
  turns,
  errors: 0,
  firstAt: '2026-09-20T09:00:00.000Z',
  lastAt: '2026-09-20T09:04:00.000Z',
  lastStatus: 'done',
});

/** What each request the page makes last asked for, so a test can prove the SCOPE that travelled rather
 *  than only what the screen happened to render. */
const asked: {
  conversations: number[];
  conversation: string[];
  stats: number[];
  usage: string[];
  userPatch: Record<string, unknown>[];
  botPatch: Record<string, unknown>[];
  configPatch: Record<string, unknown>[];
} = { conversations: [], conversation: [], stats: [], usage: [], userPatch: [], botPatch: [], configPatch: [] };

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{
    name: 'chatbot',
    url: '/plugins/chatbot/web/index.js',
    apiVersion: 12,
    nav: [{ label: 'Chatbots', icon: 'MessagesSquare', route: '' }],
    settings: [],
    strings,
  }])),
  // The plugin's OWN instance configuration, as the host's admin route answers it: the manifest's schema,
  // what is stored against it, and the manifest's own translations for its fields.
  http.get('/api/plugins/chatbot', () => HttpResponse.json({
    name: 'chatbot',
    config: {},
    configSchema: manifest.configSchema,
    secretsSet: [],
    // The manifest's OWN translations, which is where a plugin's config labels are localized. The value
    // here is deliberately not the manifest's English label, so a test can tell the two apart.
    i18n: { en: { fields: { visitorTokenTtlDays: { label: 'Visitor token lifetime, localized' } } } },
  })),
  http.patch('/api/plugins/chatbot/config', async ({ request }) => {
    asked.configPatch.push((await request.json() as { values: Record<string, unknown> }).values);
    return HttpResponse.json({ ok: true });
  }),
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'filip', is_admin: true } })),
  http.get('/api/brain/models', () => HttpResponse.json([])),
  http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json(botsBody())),
  http.patch('/api/plugins/chatbot/api/bots', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    asked.botPatch.push(body);
    const rules = Array.isArray(body.actionRules) ? body.actionRules as typeof bot.actionRules : bot.actionRules;
    return HttpResponse.json({
      bot: {
        ...bot,
        chatbotUserId: Number(body.chatbotUserId),
        displayName: String(body.displayName ?? ''),
        prompt: String(body.prompt ?? ''),
        origins: Array.isArray(body.origins) ? body.origins as string[] : bot.origins,
        limits: (body.limits ?? bot.limits) as LimitValues,
        missingLimits: LIMIT_FIELDS.filter((field) => field in MANDATORY_LIMITS && (body.limits as LimitValues)[field] === null),
        actionRules: rules,
        status: body.action === 'disable' ? 'disabled' : body.action === 'enable' ? 'enabled' : bot.status,
        updatedAt: `2026-09-21T17:0${rules.length}:00.000Z`,
      },
    });
  }),
  http.post('/api/plugins/chatbot/api/bots', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ bot: { ...bot, chatbotUserId: Number(body.chatbotUserId), displayName: String(body.displayName ?? ''), updatedAt: '2026-09-21T18:00:00.000Z' } });
  }),
  http.get('/api/plugins/chatbot/api/conversations', ({ url }) => {
    const chatbotUserId = Number(url.searchParams.get('chatbotUserId'));
    asked.conversations.push(chatbotUserId);
    const conversations = chatbotUserId === second.chatbotUserId
      ? [conversationOf('visitor-skola', 1)]
      : [conversationOf('visitor-ured', 4)];
    return HttpResponse.json({ conversations, total: conversations.length, limit: 25, offset: 0 });
  }),
  http.get('/api/plugins/chatbot/api/conversation', ({ url }) => {
    const visitorId = url.searchParams.get('visitorId') ?? '';
    asked.conversation.push(visitorId);
    return HttpResponse.json({
      chatbotUserId: Number(url.searchParams.get('chatbotUserId')),
      visitorId,
      turns: [
        { turnId: 'turn-1', visitorText: 'Dobrý den, kdy máte otevřeno?', reply: 'V pondělí od osmi.', status: 'done', errorCode: null, at: '2026-09-20T09:00:00.000Z' },
        { turnId: 'turn-2', visitorText: 'Děkuji.', reply: null, status: 'running', errorCode: null, at: '2026-09-20T09:04:00.000Z' },
      ],
    });
  }),
  http.get('/api/plugins/chatbot/api/stats', ({ url }) => {
    const chatbotUserId = Number(url.searchParams.get('chatbotUserId'));
    const from = url.searchParams.get('from') ?? '2026-09-01';
    const to = url.searchParams.get('to') ?? '2026-09-21';
    asked.stats.push(chatbotUserId);
    return HttpResponse.json({
      chatbotUserId,
      from,
      to,
      days: chatbotUserId === second.chatbotUserId
        ? [{ day: to, turns: 1, done: 1, errors: 0 }]
        : [{ day: to, turns: 9, done: 8, errors: 1 }],
      totals: chatbotUserId === second.chatbotUserId
        ? { turns: 1, done: 1, errors: 0, queued: 0, running: 0 }
        : { turns: 9, done: 8, errors: 1, queued: 2, running: 1 },
      queueWait: chatbotUserId === second.chatbotUserId
        ? { samples: 0, p50Seconds: null, p95Seconds: null }
        : { samples: 7, p50Seconds: 0.4, p95Seconds: 2.6 },
    });
  }),
  http.get('/api/users/:id/tools', ({ params }) => HttpResponse.json([
    { name: REQUIRED_TOOL, label: 'Act on the visitor page', icon: null, plugin: 'chatbot', group: 'plugin', state: 'allowed', toggleable: true },
    { name: 'MemorySearch', label: 'Search memory', icon: null, plugin: null, group: 'memory', state: 'inherited', toggleable: false },
  ].map((tool) => Number(params.id) === bot.chatbotUserId ? tool : { ...tool, state: 'unavailable', toggleable: false }))),
  http.get('/api/users', () => HttpResponse.json([
    { id: 15, username: 'novy-bot', granted_plugins: ['stats'], allowed_tools: ['MemorySearch'] },
  ])),
  http.post('/api/users', () => HttpResponse.json({ id: 15, username: 'novy-bot' }, { status: 201 })),
  http.post('/api/users/:id/projects', () => HttpResponse.json({ ok: true })),
  http.patch('/api/users/:id', async ({ request }) => {
    asked.userPatch.push(await request.json() as Record<string, unknown>);
    return HttpResponse.json({ id: 15 });
  }),
  http.get('/api/usage/by-origin', ({ url }) => {
    asked.usage.push(`${url.searchParams.get('from')}|${url.searchParams.get('to')}`);
    return HttpResponse.json({
      group: 'pair',
      trackingSince: '2026-09-01',
      rows: [{
        userId: bot.chatbotUserId,
        username: 'ured-bot',
        origin: 'platform:chatbot',
        originKind: 'platform',
        trusted: true,
        origins: 1,
        turns: 9,
        tokens: 1234,
        cost: 12.5,
        costedTurns: 9,
        firstAt: Date.parse('2026-09-01T10:00:00.000Z'),
        lastAt: Date.parse('2026-09-20T10:00:00.000Z'),
      }],
    });
  }),
);

beforeAll(() => listen());
afterEach(() => {
  cleanup();
  resetHandlers();
  asked.conversations = [];
  asked.conversation = [];
  asked.stats = [];
  asked.usage = [];
  asked.userPatch = [];
  asked.botPatch = [];
  asked.configPatch = [];
});
afterAll(() => close());

function renderPage() {
  const { wrapper: Wrapper } = createWrapper();
  return render(<Wrapper><ToastProvider><ChatbotPage plugin="chatbot" params={{}} rest={[]} surface="page" /></ToastProvider></Wrapper>);
}

/** Wait until the page's own copy has arrived. The plugin's strings come from a listing query, so the
 *  first paint renders every label empty and React then REUSES those nodes with text — a control queried
 *  before that lands is a node whose events reach nothing. */
const settled = () => screen.findAllByRole('button', { name: strings.newBot! });

/** Move to a section the way a reader does. The sections are drawn TWICE — the column beside the content
 *  and the phone's scrollable line — because which of the two is visible is a viewport's decision, made in
 *  CSS. Both carry the same destinations, so a test clicks the first and asserts on both. */
const openSection = async (label: string): Promise<void> => {
  fireEvent.click(screen.getAllByRole('button', { name: label })[0]!);
  await waitFor(() => expect(screen.getAllByRole('button', { name: label })[0]!).toHaveAttribute('aria-current', 'page'));
};

/** The window on top. A drawer's own rows open further windows, so "the dialog" is always the last one
 *  mounted — every overlay the host draws is portaled to the body in mount order. */
const top = (): HTMLElement => {
  const dialogs = screen.getAllByRole('dialog');
  return dialogs[dialogs.length - 1]!;
};

/** Open one chatbot's drawer from its row, exactly as an administrator does. */
const openBot = async (name: string): Promise<HTMLElement> => {
  fireEvent.click(screen.getByRole('button', { name: strings.openBot!.replace('{name}', name) }));
  await screen.findByRole('dialog');
  return top();
};

/** Open a window from a row of the drawer, by the accessible name that row's action carries. */
const openWindow = async (label: string): Promise<HTMLElement> => {
  const before = screen.getAllByRole('dialog').length;
  fireEvent.click(within(top()).getByRole('button', { name: label }));
  await waitFor(() => expect(screen.getAllByRole('dialog').length).toBe(before + 1));
  return top();
};

describe('the chatbots page', () => {
  it('offers its four sections in both navigations, with the register open first', async () => {
    renderPage();
    await settled();
    // The page names itself, and every section is a destination on screen rather than an entry hidden
    // behind a menu: the column has them and so does the phone's line, which is why each is found twice.
    expect(screen.getByRole('heading', { name: strings.title! })).toBeInTheDocument();
    for (const label of [strings.sectionBots!, strings.sectionConversations!, strings.sectionStatistics!, strings.sectionShared!]) {
      expect(screen.getAllByRole('button', { name: label })).toHaveLength(2);
    }
    // Exactly one destination is marked, in each of the two navigations, and it is the register.
    const current = screen.getAllByRole('button', { name: strings.sectionBots! });
    expect(current.every((button) => button.getAttribute('aria-current') === 'page')).toBe(true);
    expect(screen.getAllByRole('button', { name: strings.sectionConversations! }).some((b) => b.getAttribute('aria-current') === 'page')).toBe(false);
    expect(await screen.findByText('Městský úřad')).toBeInTheDocument();
  });

  it('shows ONE section at a time', async () => {
    renderPage();
    await settled();
    expect(await screen.findByText('Městský úřad')).toBeInTheDocument();

    await openSection(strings.sectionShared!);
    // The register is gone with its section, not merely scrolled past: a deck reads one section at a time.
    await waitFor(() => expect(screen.queryByRole('button', { name: strings.openBot!.replace('{name}', 'Městský úřad') })).not.toBeInTheDocument());
    expect(screen.getByText(strings.sharedRequirementsTitle!)).toBeInTheDocument();

    await openSection(strings.sectionBots!);
    expect(await screen.findByText('Městský úřad')).toBeInTheDocument();
  });
});

describe('the chatbots section', () => {
  it('lists one row per chatbot and narrows them from the card\'s own search', async () => {
    renderPage();
    await settled();
    expect(await screen.findByText('Městský úřad')).toBeInTheDocument();
    expect(screen.getByText('Škola')).toBeInTheDocument();
    expect(screen.getAllByText(strings.statusAttention!).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole('searchbox', { name: strings.botsSearch! }), { target: { value: 'Škola' } });
    await waitFor(() => expect(screen.queryByText('Městský úřad')).not.toBeInTheDocument());
    expect(screen.getByText('Škola')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: strings.botsSearch! }), { target: { value: 'nic' } });
    expect(await screen.findByText(strings.botsNoResults!)).toBeInTheDocument();
  });

  it('shows what an administrator has to fix, in the drawer of the chatbot it is wrong about', async () => {
    renderPage();
    await settled();
    await screen.findByText('Škola');
    const drawer = await openBot('Škola');
    expect(within(drawer).getByText(strings.detailProjectNone!)).toBeInTheDocument();
    expect(within(drawer).getByText(strings.accountNotChatbot!)).toBeInTheDocument();
  });

  it('warns that a needed tool is missing instead of listing the account\'s whole tool set', async () => {
    renderPage();
    await settled();
    await screen.findByText('Městský úřad');
    // The working chatbot reaches the tool its turns need, so nothing is said about tools at all — the
    // grants belong to the Users screen and a read-only copy of them here would only repeat it.
    const good = await openBot('Městský úřad');
    await waitFor(() => expect(within(good).queryByText(strings.toolsMissing!, { exact: false })).not.toBeInTheDocument());
    fireEvent.click(within(good).getByRole('button', { name: 'Close' }));

    // The other account cannot reach it, and that is the one fact this surface owes the reader: a chatbot
    // without it answers visitors and can touch nothing on their page.
    const bad = await openBot('Gymnázium');
    expect(await within(bad).findByText(strings.toolsMissing!.replace('{names}', REQUIRED_TOOL))).toBeInTheDocument();
  });

  it('keeps what a chatbot DID out of its drawer', async () => {
    renderPage();
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');
    // Conversations and statistics are sections of the page, each with a picker over the same register,
    // so the drawer offers no second way into them.
    expect(within(drawer).queryByRole('button', { name: strings.sectionConversations! })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: strings.sectionStatistics! })).not.toBeInTheDocument();
    // What it does carry is this chatbot's own configuration.
    expect(within(drawer).getByPlaceholderText(strings.promptPlaceholder!)).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: strings.limitsEdit! })).toBeInTheDocument();
  });

  it('saves the whole row on an explicit submit, and disables it only after a confirmation', async () => {
    renderPage();
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');

    const prompt = within(drawer).getByPlaceholderText(strings.promptPlaceholder!) as HTMLTextAreaElement;
    const save = within(drawer).getByRole('button', { name: strings.saveAction! }) as HTMLButtonElement;
    // Nothing to save until something changed: the button reflects the form's own dirty state.
    expect(save.disabled).toBe(true);
    fireEvent.change(prompt, { target: { value: 'Nové pokyny.' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect((within(top()).getByPlaceholderText(strings.promptPlaceholder!) as HTMLTextAreaElement).value).toBe('Nové pokyny.'));

    fireEvent.click(within(top()).getByRole('button', { name: strings.disableAction! }));
    const confirm = top();
    expect(within(confirm).getByText(strings.disableTitle!)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: strings.disableConfirm! }));
    await waitFor(() => expect(within(top()).getByRole('button', { name: strings.enableAction! })).toBeInTheDocument());
  });

  it('asks before closing a drawer that holds unsaved changes', async () => {
    renderPage();
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');
    fireEvent.change(within(drawer).getByPlaceholderText(strings.promptPlaceholder!), { target: { value: 'Rozepsáno.' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));

    // The drawer is still there, with the question over it: a stray click may not cost typed instructions.
    expect(within(top()).getByText(strings.discardTitle!)).toBeInTheDocument();
    fireEvent.click(within(top()).getByRole('button', { name: strings.discardConfirm! }));
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));
    expect(asked.botPatch).toHaveLength(0);
  });

  it('states the sensitive-data mode as unavailable instead of offering a switch it would refuse', async () => {
    renderPage();
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');
    expect(within(drawer).getByText(strings.sensitiveTitle!)).toBeInTheDocument();
    expect(within(drawer).getByText(strings.sensitiveUnavailable!)).toBeInTheDocument();
    // There is no control that could be mistaken for granting the mode: the refusal is a STATE, not an
    // option somebody can try to turn on.
    expect(within(drawer).queryByRole('switch', { name: strings.sensitiveTitle! })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('checkbox', { name: strings.sensitiveTitle! })).not.toBeInTheDocument();
  });

  it('reports a failed load with a retry instead of an empty register', async () => {
    use(http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    renderPage();
    await settled();
    // The retry action is the HOST's, labelled from its own dictionary — not the plugin's copy.
    await waitFor(() => expect(screen.getByText(strings.botsLoadError!, { exact: false })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('offers creation when there is nothing registered yet, and lists what it created', async () => {
    use(http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json(botsBody([]))));
    renderPage();
    await settled();
    expect(await screen.findByText(strings.botsEmptyTitle!)).toBeInTheDocument();
    // ONE way in, in the card's header, where it also is when the register is full.
    expect(screen.getAllByRole('button', { name: strings.newBot! })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: strings.newBot! }));
    const dialog = top();
    expect(within(dialog).getByText(strings.createTitle!)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: strings.createSubmit! })).toBeEnabled();
  });

  it('grants a new chatbot account this plugin and the tools its turns need, keeping its other grants', async () => {
    use(http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json(botsBody([]))));
    renderPage();
    await settled();
    await screen.findByText(strings.botsEmptyTitle!);
    fireEvent.click(screen.getByRole('button', { name: strings.newBot! }));
    const dialog = top();
    // A fresh account: the dialog creates it rather than reusing one of the candidates.
    fireEvent.change(within(dialog).getByRole('combobox', { name: strings.createModeLabel! }), { target: { value: 'new' } });
    fireEvent.change(within(dialog).getAllByRole('textbox')[0]!, { target: { value: 'novy-bot' } });
    fireEvent.click(within(dialog).getByRole('button', { name: strings.createSubmit! }));

    await waitFor(() => expect(asked.userPatch).toHaveLength(1));
    // The patch replaces each list wholesale, so it carries what the account already had plus this plugin
    // and the tool the plugin's own admin route named.
    expect(asked.userPatch[0]).toEqual({
      granted_plugins: ['stats', 'chatbot'],
      allowed_tools: ['MemorySearch', REQUIRED_TOOL],
    });
    // …and the chatbot it created is in the register it was created from, without a reload. It was given
    // no display name, so the register calls it what an unnamed chatbot is called.
    await waitFor(() => expect(screen.getAllByRole('button', { name: strings.openBot!.replace('{name}', strings.botFallback!) }).length).toBe(1));
  });
});

describe('one chatbot\'s limits', () => {
  const openLimits = async (name: string) => {
    renderPage();
    await settled();
    await screen.findByText(name);
    await openBot(name);
    return await openWindow(strings.limitsEdit!);
  };

  it('sets every limit with a slider and a box that are one value', async () => {
    const limits = await openLimits('Městský úřad');

    const box = within(limits).getByRole('textbox', { name: strings.limit_rateIpPerMinute! }) as HTMLInputElement;
    const slider = within(limits).getByRole('slider', { name: strings.limit_rateIpPerMinute! }) as HTMLInputElement;
    expect(box.value).toBe('30');
    expect(slider.value).toBe('30');
    // The slider's range is the SERVER's floor and a reach this bundle chooses, never past what the
    // server accepts.
    expect(Number(slider.min)).toBe(MANDATORY_LIMITS.rateIpPerMinute.min);
    expect(Number(slider.max)).toBeLessThanOrEqual(MANDATORY_LIMITS.rateIpPerMinute.max);

    // One setter behind both: moving the slider writes the box, and typing writes the slider.
    fireEvent.change(slider, { target: { value: '45' } });
    expect((within(top()).getByRole('textbox', { name: strings.limit_rateIpPerMinute! }) as HTMLInputElement).value).toBe('45');
    fireEvent.change(within(top()).getByRole('textbox', { name: strings.limit_rateIpPerMinute! }), { target: { value: '60' } });
    expect((within(top()).getByRole('slider', { name: strings.limit_rateIpPerMinute! }) as HTMLInputElement).value).toBe('60');

    // An optional ceiling nobody set is an EMPTY box, never a zero the owner did not choose.
    expect((within(top()).getByRole('textbox', { name: strings.limit_dailyCostMicrousd! }) as HTMLInputElement).value).toBe('');
  });

  it('will not enable a chatbot whose numbers are not all decided, and names the ones missing', async () => {
    // The broken chatbot is the draft with no Project, so its blockers already keep it from being enabled.
    // What this checks is the LIMIT half: clearing a mandatory number disables the action and says which.
    const limits = await openLimits('Škola');
    fireEvent.change(within(limits).getByRole('textbox', { name: strings.limit_dailyTurnLimit! }), { target: { value: '' } });
    expect(await within(top()).findByText(strings.limitsMissing!.replace('{fields}', strings.limit_dailyTurnLimit!))).toBeInTheDocument();

    fireEvent.click(within(top()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(within(top()).getByRole('button', { name: strings.enableAction! })).toBeDisabled();
  });

  it('reports a limit the server would refuse, without pretending it was stored', async () => {
    const limits = await openLimits('Městský úřad');
    fireEvent.change(within(limits).getByRole('textbox', { name: strings.limit_maxActionsPerTurn! }), { target: { value: '0' } });
    expect(within(top()).getByText(`${strings.limit_maxActionsPerTurn}: ${strings.limitsRange!.replace('{min}', '1').replace('{max}', '20')}`)).toBeInTheDocument();

    fireEvent.click(within(top()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(within(top()).getByRole('button', { name: strings.saveAction! })).toBeDisabled();
  });
});

describe('the conversations section', () => {
  const openConversations = async () => {
    renderPage();
    await settled();
    await screen.findByText('Městský úřad');
    await openSection(strings.sectionConversations!);
  };

  it('reads one chatbot at a time, and switches with the picker', async () => {
    await openConversations();
    expect(await screen.findByText('visitor-ured')).toBeInTheDocument();
    // The first chatbot of the register until somebody says otherwise, and the request named it.
    expect(asked.conversations).toEqual([bot.chatbotUserId]);

    fireEvent.change(screen.getByRole('combobox', { name: strings.pickerLabel! }), { target: { value: String(second.chatbotUserId) } });
    expect(await screen.findByText('visitor-skola')).toBeInTheDocument();
    // Nothing of the previous chatbot is left under the new one's name.
    expect(screen.queryByText('visitor-ured')).not.toBeInTheDocument();
    expect(asked.conversations).toEqual([bot.chatbotUserId, second.chatbotUserId]);
  });

  it('opens one conversation in the host\'s inspection rail and shows what was said', async () => {
    await openConversations();
    fireEvent.click(await screen.findByRole('button', { name: strings.openConversation!.replace('{visitor}', 'visitor-ured') }));

    const rail = await screen.findByRole('dialog');
    expect(await within(rail).findByText('Dobrý den, kdy máte otevřeno?')).toBeInTheDocument();
    expect(within(rail).getByText('V pondělí od osmi.')).toBeInTheDocument();
    // A turn that produced no answer says so rather than rendering an empty answer.
    expect(within(rail).getByText(strings.transcriptNoReply!)).toBeInTheDocument();
    expect(asked.conversation).toEqual(['visitor-ured']);

    fireEvent.click(within(rail).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));
    // The register it was opened from is still there, unchanged.
    expect(screen.getByText('visitor-ured')).toBeInTheDocument();
  });

  it('says the register is empty instead of rendering an empty table', async () => {
    use(http.get('/api/plugins/chatbot/api/conversations', () => HttpResponse.json({ conversations: [], total: 0, limit: 25, offset: 0 })));
    await openConversations();
    expect(await screen.findByText(strings.conversationsEmptyTitle!)).toBeInTheDocument();
  });

  it('reports a failed read with the retry the host owns', async () => {
    use(http.get('/api/plugins/chatbot/api/conversations', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    await openConversations();
    expect(await screen.findByText(strings.conversationsLoadError!, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says there is nothing to read when no chatbot is registered', async () => {
    use(http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json(botsBody([]))));
    renderPage();
    await settled();
    await screen.findByText(strings.botsEmptyTitle!);
    await openSection(strings.sectionConversations!);
    // A picker over nothing is not offered at all: the section says what has to happen first.
    expect(await screen.findByText(strings.pickerNoBots!)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: strings.pickerLabel! })).not.toBeInTheDocument();
  });
});

describe('the statistics section', () => {
  const openStats = async () => {
    renderPage();
    await settled();
    await screen.findByText('Městský úřad');
    await openSection(strings.sectionStatistics!);
  };

  it('is a chatbot, a window, a chart and one line of spend', async () => {
    await openStats();

    // Three windows, all of them visible: a list would hide two of the three choices.
    expect(await screen.findByRole('radio', { name: strings.statsWindowDays!.replace('{count}', '30') })).toBeChecked();
    await waitFor(() => expect(screen.getAllByText(strings.chartTurns!).length).toBeGreaterThan(0));
    expect(screen.getAllByText(strings.chartErrors!).length).toBeGreaterThan(0);
    expect(asked.stats).toEqual([bot.chatbotUserId]);

    // The spend is ONE line, from the instance's rollup for this account, over the same window.
    expect(screen.getByText(strings.spendTitle!)).toBeInTheDocument();
    expect(await screen.findByText('9 turns · 1,234 tokens · $12.50')).toBeInTheDocument();
    const [from, to] = asked.usage[0]!.split('|');
    expect(new Date(from!).getTime()).toBeLessThan(new Date(to!).getTime());

    // Another window is another read, over a range the reader chose.
    fireEvent.click(screen.getByRole('radio', { name: strings.statsWindowDays!.replace('{count}', '7') }));
    await waitFor(() => expect(asked.stats).toHaveLength(2));
  });

  it('scopes the chart and the spend to the chatbot the picker names', async () => {
    await openStats();
    await waitFor(() => expect(asked.stats).toEqual([bot.chatbotUserId]));

    fireEvent.change(screen.getByRole('combobox', { name: strings.pickerLabel! }), { target: { value: String(second.chatbotUserId) } });
    await waitFor(() => expect(asked.stats).toEqual([bot.chatbotUserId, second.chatbotUserId]));
    // The second chatbot has no spend row of its own: it says so rather than showing a confident zero.
    expect(await screen.findByText(strings.spendEmptyTitle!)).toBeInTheDocument();
  });

  it('says there were no turns instead of drawing an empty chart', async () => {
    use(http.get('/api/plugins/chatbot/api/stats', ({ url }) => HttpResponse.json({
      chatbotUserId: Number(url.searchParams.get('chatbotUserId')),
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      days: [],
      totals: { turns: 0, done: 0, errors: 0, queued: 0, running: 0 },
      queueWait: { samples: 0, p50Seconds: null, p95Seconds: null },
    })));
    await openStats();
    expect(await screen.findByText(strings.statsEmptyTitle!)).toBeInTheDocument();
  });

  it('reports a failed counters read with the retry the host owns', async () => {
    use(http.get('/api/plugins/chatbot/api/stats', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    await openStats();
    expect(await screen.findByText(strings.statsLoadError!, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('the shared settings section', () => {
  const openShared = async () => {
    renderPage();
    await settled();
    await screen.findByText('Městský úřad');
    await openSection(strings.sectionShared!);
  };

  /** The manifest's one instance-wide field, read from the manifest itself so this test cannot drift from
   *  what the plugin actually declares. */
  const field = manifest.configSchema.find((entry) => entry.key === 'visitorTokenTtlDays')!;

  it('edits the plugin\'s own configuration through the host\'s form, with a slider beside the number', async () => {
    await openShared();
    // The label is the MANIFEST's, in the reader's locale, not a second copy kept as this page's copy:
    // what is on screen is the translation the listing carried, not the English in the schema.
    const label = 'Visitor token lifetime, localized';
    expect(screen.queryByText(field.label)).not.toBeInTheDocument();
    const box = await screen.findByRole('textbox', { name: label }) as HTMLInputElement;
    const slider = screen.getByRole('slider', { name: label }) as HTMLInputElement;
    // Nothing is stored yet, so the field holds the manifest's own default.
    expect(box.value).toBe(String(field.default));
    expect(Number(slider.min)).toBe(field.min);
    expect(Number(slider.max)).toBe(field.max);

    fireEvent.change(slider, { target: { value: '60' } });
    // The save carries the whole record, keyed the way the manifest keys it.
    await waitFor(() => expect(asked.configPatch).toHaveLength(1));
    expect(asked.configPatch[0]).toEqual({ visitorTokenTtlDays: 60 });
    expect((screen.getByRole('textbox', { name: label }) as HTMLInputElement).value).toBe('60');
  });

  it('states what every chatbot account needs, without offering to grant it here', async () => {
    await openShared();
    expect(screen.getByText(strings.sharedRequirementsTitle!)).toBeInTheDocument();
    expect(screen.getByText(strings.toolsRequiredLabel!)).toBeInTheDocument();
    expect(screen.getByText(REQUIRED_TOOL)).toBeInTheDocument();
    // A grant belongs to one account and the Users screen owns it, so this row is a fact and not a form.
    expect(screen.queryByRole('switch', { name: REQUIRED_TOOL })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: REQUIRED_TOOL })).not.toBeInTheDocument();
  });

  it('reports a failed configuration read with a retry', async () => {
    use(http.get('/api/plugins/chatbot', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    await openShared();
    expect(await screen.findByText(strings.sharedLoadError!, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('page-action rules', () => {
  const openRules = async () => {
    renderPage();
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');
    const rules = await openWindow(strings.securityTitle!);
    return { drawer, rules };
  };

  it('says on the drawer that there is no rule, and keeps the author behind its own window', async () => {
    renderPage();
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');
    expect(within(drawer).getByText(strings.rulesEmpty!)).toBeInTheDocument();
    expect(within(drawer).queryByRole('combobox', { name: strings.ruleOriginLabel! })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: strings.ruleAdd! })).not.toBeInTheDocument();
  });

  it('adds a rule and sends the whole policy with the save', async () => {
    const { drawer, rules } = await openRules();

    fireEvent.change(within(rules).getByRole('combobox', { name: strings.ruleOriginLabel! }), { target: { value: SITE } });
    // The field opens holding "/", so this is what a reader typing their own path into it really sends.
    fireEvent.change(within(rules).getByLabelText(strings.rulePathLabel!, { selector: 'input' }), { target: { value: '//kontakt' } });
    fireEvent.click(within(rules).getByRole('button', { name: strings.ruleAdd! }));
    await waitFor(() => expect(within(rules).getByText(`${SITE}/kontakt`)).toBeInTheDocument());
    expect(within(rules).getByText(strings.ruleLimit!.replace('{count}', '1'))).toBeInTheDocument();

    // Closed again, the summary names the place the rule governs, so the drawer still says what was set.
    fireEvent.click(within(rules).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(within(drawer).getByText(strings.rulesCount!.replace('{n}', '1'))).toBeInTheDocument();
    expect(within(drawer).getByText(`${SITE}/kontakt`)).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole('button', { name: strings.saveAction! }));
    // The rule travels with the rest of the editable state, and it is the one the editor showed.
    await waitFor(() => expect(asked.botPatch).toHaveLength(1));
    expect(asked.botPatch[0]!.actionRules).toEqual([
      { origin: SITE, pathPrefix: '/kontakt', action: 'read', requiresConfirmation: false, maxPerTurn: 1 },
    ]);
  });

  it('refuses the same rule twice and a limit beyond the per-turn ceiling', async () => {
    const { rules } = await openRules();
    fireEvent.change(within(rules).getByRole('combobox', { name: strings.ruleOriginLabel! }), { target: { value: SITE } });
    fireEvent.click(within(rules).getByRole('button', { name: strings.ruleAdd! }));
    await waitFor(() => expect(within(rules).getByText(`${SITE}/`)).toBeInTheDocument());

    // The same domain, path and action are already listed.
    expect(within(rules).getByText(strings.ruleDuplicate!)).toBeInTheDocument();
    expect(within(rules).getByRole('button', { name: strings.ruleAdd! })).toBeDisabled();

    fireEvent.change(within(rules).getByLabelText(strings.rulePathLabel!, { selector: 'input' }), { target: { value: '/kontakt' } });
    const limit = within(rules).getByRole('spinbutton');
    fireEvent.change(limit, { target: { value: '21' } });
    expect(within(rules).getByText(strings.ruleLimitInvalid!.replace('{max}', '20'))).toBeInTheDocument();
    expect(within(rules).getByRole('button', { name: strings.ruleAdd! })).toBeDisabled();
    fireEvent.change(limit, { target: { value: '3' } });
    expect(within(rules).getByRole('button', { name: strings.ruleAdd! })).toBeEnabled();
  });

  it('offers the visitor\'s confirmation only where the protocol can carry one', async () => {
    const { rules } = await openRules();
    // `read` cannot be confirmed, so the control is not offered at all.
    expect(within(rules).queryByText(strings.ruleConfirmationLabel!)).not.toBeInTheDocument();
    fireEvent.change(within(rules).getByRole('combobox', { name: strings.ruleActionLabel! }), { target: { value: 'request_submit' } });
    expect(within(rules).getByText(strings.ruleConfirmationLabel!)).toBeInTheDocument();
  });

  it('requires a domain, a path and a limit the server would accept before offering to add', async () => {
    const { rules } = await openRules();
    // Nothing is chosen yet, so the domain is asked for rather than silently defaulted.
    expect(within(rules).getByText(strings.ruleOriginRequired!)).toBeInTheDocument();
    fireEvent.change(within(rules).getByRole('combobox', { name: strings.ruleOriginLabel! }), { target: { value: SITE } });
    fireEvent.change(within(rules).getByLabelText(strings.rulePathLabel!, { selector: 'input' }), { target: { value: 'kontakt' } });
    expect(within(rules).getByText(strings.rulePathInvalid!)).toBeInTheDocument();
  });
});

describe('the allowed domains', () => {
  it('states them as a summary, and refuses one the server would reject', async () => {
    renderPage();
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');
    // The drawer itself names the domains it answers on, without listing them as rows.
    expect(within(drawer).getByText(strings.originsCount!.replace('{n}', '1'))).toBeInTheDocument();
    expect(within(drawer).getByText(SITE)).toBeInTheDocument();

    const domains = await openWindow(strings.originsLabel!);
    const field = within(domains).getByPlaceholderText(strings.originsPlaceholder!);
    fireEvent.change(field, { target: { value: 'www.example.cz' } });
    expect(within(domains).getByText(strings.originsInvalid!)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: SITE } });
    expect(within(domains).getByText(strings.originsDuplicate!)).toBeInTheDocument();
    expect(within(domains).getByRole('button', { name: strings.originsAdd! })).toBeDisabled();
  });

  it('adds one in the window and carries it into the summary', async () => {
    renderPage();
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');
    const domains = await openWindow(strings.originsLabel!);
    fireEvent.change(within(domains).getByPlaceholderText(strings.originsPlaceholder!), { target: { value: 'https://www.druhy.cz' } });
    fireEvent.click(within(domains).getByRole('button', { name: strings.originsAdd! }));
    // The window edits the DRAFT the drawer holds, so closing it leaves the new domain counted and the
    // save offered — nothing is stored until that explicit click.
    fireEvent.click(within(domains).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(within(drawer).getByText(strings.originsCount!.replace('{n}', '2'))).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: strings.saveAction! })).toBeEnabled();
    expect(asked.botPatch).toHaveLength(0);
  });
});

describe('the pure helpers the drawer reports with', () => {
  it('turns blocker codes into the copy an administrator acts on', () => {
    expect(blockerText(['several_projects'], 3, { detailProjectSeveral: '{count} projects' })).toEqual(['3 projects']);
    expect(blockerText(['project_being_deleted'], 1, { detailProjectNone: 'none' })).toEqual(['none']);
  });

  it('hints at a domain the server would refuse, without pretending to be the rule', () => {
    expect(originHint('', [])).toBeNull();
    expect(originHint('www.example.cz', [])).toBe('invalid');
    expect(originHint('https://www.example.cz/x', [])).toBe('invalid');
    expect(originHint(SITE, [SITE])).toBe('duplicate');
    expect(originHint(SITE, [])).toBeNull();
  });

  it('reads an unset limit as an empty box and a stored one as its number', () => {
    expect(limitDraftOf(LIMITS).dailyTurnLimit).toBe('200');
    expect(limitDraftOf({ ...LIMITS, dailyCostMicrousd: null }).dailyCostMicrousd).toBe('');
  });

  it('judges a box by the server\'s own bounds, and separates "not decided" from "not a number"', () => {
    const draft = limitDraftOf(LIMITS);
    expect(readLimitDraft(draft).invalid).toEqual([]);
    expect(readLimitDraft(draft).missing).toEqual([]);
    // Cleared mandatory numbers are MISSING — the state that keeps a chatbot from being enabled...
    const cleared = readLimitDraft({ ...draft, rateIpPerMinute: '', dailyCostMicrousd: '' });
    expect(cleared.missing).toEqual(['rateIpPerMinute']);
    expect(cleared.limits.rateIpPerMinute).toBeNull();
    expect(cleared.limits.dailyCostMicrousd).toBeNull();
    // ...while a number the server would refuse is INVALID, and never travels as if it were valid.
    const wrong = readLimitDraft({ ...draft, maxActionsPerTurn: '500' });
    expect(wrong.invalid).toEqual(['maxActionsPerTurn']);
    expect(wrong.limits.maxActionsPerTurn).toBeNull();
    expect(readLimitDraft({ ...draft, retentionDays: '1.5' }).invalid).toEqual(['retentionDays']);
  });

  it('gives every limit a slider the server would accept, wide enough for the number already stored', () => {
    // A slider is a presentation choice, so the reach it offers is this bundle's. What it may never do is
    // offer a value the server would refuse, or refuse to show a value the server already holds: the
    // maximum is the limit's own spec at most, and the stored number at least.
    for (const field of LIMIT_FIELDS) {
      const spec = specOf(field);
      const range = sliderRange(field, null);
      expect(range.min).toBe(spec.min);
      expect(range.max).toBeLessThanOrEqual(spec.max);
      expect(range.max).toBeGreaterThan(range.min);
      expect(sliderRange(field, spec.max).max).toBe(spec.max);
    }
    // The cost ceiling is stored in millionths of a dollar and its spec reaches the largest safe integer,
    // which is not a distance a hand can travel: the reach is what a reader can actually aim within.
    expect(OPTIONAL_LIMITS.dailyCostMicrousd.max).toBe(Number.MAX_SAFE_INTEGER);
    expect(sliderRange('dailyCostMicrousd', null).max).toBeLessThan(Number.MAX_SAFE_INTEGER);
    // …and a stored number beyond that reach widens the slider to hold it rather than clamping it down.
    expect(sliderRange('dailyCostMicrousd', 900_000_000).max).toBeGreaterThanOrEqual(900_000_000);
  });

  it('keys a rule by the place and the action the server keys it by', () => {
    expect(actionRuleKey({ origin: SITE, pathPrefix: '/kontakt', action: 'fill' })).toBe(`${SITE}/kontakt fill`);
  });

  it('refuses a draft rule the server would refuse, and lets a good one through', () => {
    const allowed = [SITE];
    const existing = [{ origin: SITE, pathPrefix: '/', action: 'read', requiresConfirmation: false, maxPerTurn: 1 }];
    expect(draftRuleRefusal({ origin: '', pathPrefix: '/', action: 'read', maxPerTurn: '1' }, [], existing)).toBe('no_origin');
    expect(draftRuleRefusal({ origin: '', pathPrefix: '/', action: 'read', maxPerTurn: '1' }, allowed, existing)).toBe('pick_origin');
    expect(draftRuleRefusal({ origin: SITE, pathPrefix: 'kontakt', action: 'read', maxPerTurn: '1' }, allowed, existing)).toBe('bad_path');
    expect(draftRuleRefusal({ origin: SITE, pathPrefix: '/x?y', action: 'read', maxPerTurn: '1' }, allowed, existing)).toBe('bad_path');
    expect(draftRuleRefusal({ origin: SITE, pathPrefix: '/a', action: 'read', maxPerTurn: '0' }, allowed, existing)).toBe('bad_limit');
    expect(draftRuleRefusal({ origin: SITE, pathPrefix: '/a', action: 'read', maxPerTurn: '21' }, allowed, existing)).toBe('bad_limit');
    expect(draftRuleRefusal({ origin: SITE, pathPrefix: '/', action: 'read', maxPerTurn: '2' }, allowed, existing)).toBe('duplicate');
    expect(draftRuleRefusal({ origin: SITE, pathPrefix: '/a', action: 'click', maxPerTurn: '2' }, allowed, existing)).toBeNull();
    // The field opens with a "/", so a reader typing their path over it sends "//kontakt": that is the same
    // place as "/kontakt" and must be accepted as it, and refused as a duplicate of it.
    expect(draftRuleRefusal({ origin: SITE, pathPrefix: '//kontakt', action: 'read', maxPerTurn: '2' }, allowed, [])).toBeNull();
    // ... and as the SAME place as the rule already written without the extra slash.
    expect(draftRuleRefusal({ origin: SITE, pathPrefix: '//kontakt', action: 'read', maxPerTurn: '2' }, allowed, [{ origin: SITE, pathPrefix: '/kontakt', action: 'read', requiresConfirmation: false, maxPerTurn: 1 }])).toBe('duplicate');
  });

  it('reads the statistics window as the same range of UTC days for both requests', () => {
    const window = statsWindow(7, new Date('2026-09-21T23:30:00.000Z'));
    expect(window.to).toBe('2026-09-21');
    expect(window.from).toBe('2026-09-15');
    expect(new Date(window.fromMs).toISOString()).toBe('2026-09-15T00:00:00.000Z');
    expect(new Date(window.toMs).toISOString()).toBe('2026-09-21T23:59:59.999Z');
  });

  it('draws every day of the window, including the ones nobody wrote on', () => {
    const points = chartPoints([{ day: '2026-09-20', turns: 4, done: 4, errors: 0 }], '2026-09-19', '2026-09-21');
    expect(points).toEqual([
      { label: '2026-09-19', turns: 0, errors: 0 },
      { label: '2026-09-20', turns: 4, errors: 0 },
      { label: '2026-09-21', turns: 0, errors: 0 },
    ]);
  });
});
