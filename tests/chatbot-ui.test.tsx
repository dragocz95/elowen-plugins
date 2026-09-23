import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../plugins/chatbot/web-src/AppearancePreview', () => ({ AppearancePreview: () => null }));
import manifest from '../plugins/chatbot/elowen-plugin.json' with { type: 'json' };
import { ChatbotDeck } from '../plugins/chatbot/web-src/ChatbotDeck';
import { CHATBOT_SECTIONS } from '../plugins/chatbot/web-src/sections';
import { blockerText, modelSourceText } from '../plugins/chatbot/web-src/BotDetail';
import { AUTH_TRANSITION_EVENT } from '../plugins/chatbot/web-src/accountSwitch';
import { limitDraftOf, sliderRange } from '../plugins/chatbot/web-src/LimitsModal';
import { originHint } from '../plugins/chatbot/web-src/OriginsField';
import { matchingBots } from '../plugins/chatbot/web-src/search';
import { DEFAULT_LIMITS, LIMIT_FIELDS, MANDATORY_LIMITS, isUsableLimit, specOf, type LimitValues } from '../plugins/chatbot/src/limits';
import { DEFAULT_STORED_APPEARANCE } from '../plugins/chatbot/src/appearanceContract';
import { chartPoints, statsWindow } from '../plugins/chatbot/web-src/StatsView';
import { HttpResponse, close, http, listen, resetHandlers, setDefaults, use } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { openBrainSessionWindow } from './ui/hostUtils';
import { ensurePluginUiRuntime, pluginNavigations, resetPluginNavigations } from './ui/hostRuntime';

/** The chatbot admin surface — ONE entry in the primary navigation, opened in the host's reading modal,
 *  with four sections switching inside the host's own `SectionDeck` — rendered the way the host renders
 *  it: the deck at one of its four addresses, inside the host's own runtime fixture, reaching every
 *  component and every string through `window.ElowenUiRuntime`.
 *
 *  What this cannot prove is what the modal and the deck LOOK like — a browser's judgement, reported as
 *  unverified. What it does prove is that the deck offers every section, that activating one asks the
 *  host for that section's own address, that each address renders its own section and nothing of its
 *  siblings, that the surface reads only strings the manifest declares, that its loading, error, empty
 *  and populated states are all drawn, that conversations and statistics are scoped to ONE chatbot, and
 *  that it writes back exactly the grants, rules and numbers it showed. */

ensurePluginUiRuntime();

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
const SITE = 'https://www.example.cz';
const REQUIRED_TOOL = 'ChatbotPageAction';

/** The model each fixture chatbot is answered by, and what decided it. The three sources get three unlike
 *  values on purpose: a row that showed one where another belongs, or that called the allow-list case
 *  inheritance, cannot pass against them. */
const PICKED_MODEL = 'elowen:anthropic/claude-sonnet-4';
const DEFAULT_MODEL = 'anthropic/claude-haiku-4';
const FORCED_MODEL = 'relay/kimi-k2';

/** The limits the server reports for the fixture chatbot: every field, null where the owner has not decided.
 *  Written the way the API reports it, so the form is exercised against the shape it really receives. */
const LIMITS: LimitValues = { ...DEFAULT_LIMITS };

const bot = {
  chatbotUserId: 12,
  publicId: 'cbt_0123456789abcdef01234567',
  displayName: 'Městský úřad',
  status: 'enabled' as const,
  origins: [SITE],
  maySubmitForms: true,
  appearance: DEFAULT_STORED_APPEARANCE,
  embedSnippet: `<script src="https://elowen.example.com/hooks/chatbot/v2/widget.js" data-chatbot="cbt_0123456789abcdef01234567" async></script>`,
  updatedAt: '2026-09-21T16:00:00.000Z',
  account: { username: 'ured-bot', type: 'chatbot' as const, isAdmin: false },
  projects: [{ id: 4, slug: 'ured' }],
  model: { exec: PICKED_MODEL, source: 'preference' as const },
  blockers: [] as string[],
  insecureOrigins: [] as string[],
  limits: LIMITS,
  budget: { day: '2026-09-21', admittedTurns: 9, usage: { turns: 9, tokens: 1_090_000, costUsd: 0.0737, costedTurns: 9 }, verdict: { ok: true } },
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
  model: { exec: DEFAULT_MODEL, source: 'instance' as const },
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
  model: { exec: FORCED_MODEL, source: 'allowed' as const },
};

const botsBody = (bots = [bot, broken, second]) => ({
  bots,
  candidates: [{ id: 15, username: 'novy-bot', type: 'chatbot' }],
  projects: [{ id: 4, slug: 'ured' }],
  requiredTools: [REQUIRED_TOOL],
});

/** The last address the host vouched for, per fixture visitor. `visitor-untitled` has none: its
 *  conversation is from before addresses were kept. */
const VISITOR_IPS: Record<string, string | null> = {
  'visitor-ured': '203.0.113.9',
  'visitor-other': '198.51.100.20',
  'visitor-untitled': null,
  'visitor-skola': '192.0.2.44',
};

const conversationOf = (visitorId: string, turns: number, title: string | null) => ({
  visitorId,
  ip: VISITOR_IPS[visitorId] ?? null,
  sessionId: `session-${visitorId}`,
  title,
  turns,
  errors: 0,
  firstAt: '2026-09-20T09:00:00.000Z',
  lastAt: '2026-09-20T09:04:00.000Z',
  lastStatus: 'done',
});

/** Each fixture chatbot's conversations, newest activity first. */
const conversationsOf = (chatbotUserId: number) => chatbotUserId === second.chatbotUserId
  ? [conversationOf('visitor-skola', 1, 'Admissions')]
  : [conversationOf('visitor-ured', 4, 'Office hours'), conversationOf('visitor-other', 3, 'Payment question'), conversationOf('visitor-untitled', 1, null)];

/** What each request the page makes last asked for, so a test can prove the SCOPE that travelled rather
 *  than only what the screen happened to render. */
const asked: {
  conversations: number[];
  visitorQueries: (string | null)[];
  visitors: number[];
  stats: number[];
  usage: string[];
  userPatch: Record<string, unknown>[];
  botPatch: Record<string, unknown>[];
  configPatch: Record<string, unknown>[];
  impersonate: number[];
} = { conversations: [], visitorQueries: [], visitors: [], stats: [], usage: [], userPatch: [], botPatch: [], configPatch: [], impersonate: [] };

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{
    name: 'chatbot',
    url: '/plugins/chatbot/web/index.js',
    apiVersion: 12,
    nav: manifest.web.nav,
    settings: [],
    presentation: manifest.web.presentation,
    strings,
  }])),
  // The plugin's OWN instance configuration, as the host's admin route answers it: the manifest's schema,
  // what is stored against it, and the manifest's own translations for its fields.
  http.get('/api/plugins/chatbot', () => HttpResponse.json({
    name: 'chatbot',
    config: { visitorTokenTtlDays: 45 },
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
    return HttpResponse.json({
      bot: {
        ...bot,
        chatbotUserId: Number(body.chatbotUserId),
        displayName: String(body.displayName ?? ''),
        origins: Array.isArray(body.origins) ? body.origins as string[] : bot.origins,
        limits: (body.limits ?? bot.limits) as LimitValues,
        missingLimits: LIMIT_FIELDS.filter((field) => field in MANDATORY_LIMITS && (body.limits as LimitValues)[field] === null),
        maySubmitForms: typeof body.maySubmitForms === 'boolean' ? body.maySubmitForms : bot.maySubmitForms,
        status: body.action === 'disable' ? 'disabled' : body.action === 'enable' ? 'enabled' : bot.status,
        updatedAt: '2026-09-21T17:00:00.000Z',
      },
    });
  }),
  http.post('/api/plugins/chatbot/api/bots', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ bot: { ...bot, chatbotUserId: Number(body.chatbotUserId), displayName: String(body.displayName ?? ''), updatedAt: '2026-09-21T18:00:00.000Z' } });
  }),
  http.get('/api/plugins/chatbot/api/conversations', ({ url }) => {
    const chatbotUserId = Number(url.searchParams.get('chatbotUserId'));
    const visitor = url.searchParams.get('visitor');
    asked.conversations.push(chatbotUserId);
    asked.visitorQueries.push(visitor);
    const matching = conversationsOf(chatbotUserId).filter((conversation) => visitor === null || conversation.visitorId === visitor);
    const limit = Number(url.searchParams.get('limit') ?? 25);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const conversations = matching.slice(offset, offset + limit);
    return HttpResponse.json({ conversations, total: matching.length, limit, offset });
  }),
  http.get('/api/plugins/chatbot/api/visitors', ({ url }) => {
    const chatbotUserId = Number(url.searchParams.get('chatbotUserId'));
    asked.visitors.push(chatbotUserId);
    return HttpResponse.json({
      visitors: conversationsOf(chatbotUserId).map(({ visitorId, ip, lastAt }) => ({ visitorId, ip, lastAt })),
      truncated: false,
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
      spend: [{ day: to, usage: chatbotUserId === second.chatbotUserId ? { turns: 0, tokens: 0, costUsd: null, costedTurns: 0 } : { turns: 9, tokens: 1234, costUsd: 12.5, costedTurns: 9 } }],
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
  // Core's own account directory, which only the creation dialog reads — for the grants an account already
  // holds, so that creating a chatbot adds to them rather than replacing them. The model row is NOT read
  // from here: core resolves a model on the plugin's own server side.
  http.get('/api/users', () => HttpResponse.json([
    { id: 15, username: 'novy-bot', granted_plugins: ['stats'], allowed_tools: ['MemorySearch'] },
  ])),
  // The host's own switch-to-account route, which is what the model row's action calls.
  http.post('/api/auth/impersonate', async ({ request }) => {
    const body = await request.json() as { userId?: number };
    asked.impersonate.push(Number(body.userId));
    return HttpResponse.json({ ok: true });
  }),
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
  asked.visitorQueries = [];
  asked.visitors = [];
  asked.stats = [];
  openBrainSessionWindow.mockReset();
  asked.usage = [];
  asked.userPatch = [];
  asked.botPatch = [];
  asked.configPatch = [];
  asked.impersonate = [];
});
afterAll(() => close());

/** Mount the deck at one section's own address, exactly as the host mounts it: the modal's `rest` is the
 *  address inside the plugin, and `surface` is `deck` because the host owns the frame around it.
 *
 *  ONE wrapper builds the tree, so `at` can hand the same deck a new address the way the host does: the
 *  overlay rewrites its own history entry and re-renders the frame it already has mounted. Everything the
 *  deck is holding therefore survives the move — which is exactly what a suite about the column's search
 *  has to be able to observe, and what the fixture's `navigate` alone (an address, recorded) cannot show. */
type SectionId = 'bots' | 'conversations' | 'statistics' | 'shared';

const restOf = (id: SectionId): string[] => {
  const route = CHATBOT_SECTIONS.find((section) => section.id === id)!.route;
  return route === '' ? [] : route.split('/');
};

function renderSection(id: SectionId) {
  const { wrapper: Wrapper } = createWrapper();
  const tree = (at: SectionId) => (
    <Wrapper>
      <ToastProvider>
        <ChatbotDeck plugin="chatbot" rest={restOf(at)} />
      </ToastProvider>
    </Wrapper>
  );
  const view = render(tree(id));
  return { ...view, at: (next: SectionId) => view.rerender(tree(next)) };
}

/** Every destination is in the document TWICE — the column and the phone's strip are both rendered, and
 *  which one a reader sees is the deck's CSS decision. A test therefore asks for all of them. */
const destinations = (label: string) => screen.getAllByRole('button', { name: label });

/** How many destinations carry one label, asked without throwing: a query that names nothing leaves the
 *  column empty, and that is an answer this suite has to be able to state. */
const destinationsNamed = (label: string) => screen.queryAllByRole('button', { name: label }).length;

/** Wait until the page's own copy has arrived. The plugin's strings come from a listing query, so the
 *  first paint renders every label empty and React then REUSES those nodes with text — a control queried
 *  before that lands is a node whose events reach nothing. */
const settled = () => screen.findAllByRole('button', { name: strings.newBot! });

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

describe('the chatbot modal deck', () => {
  it('offers every section the bundle declares, in both of the deck\'s shapes', async () => {
    renderSection('bots');
    await settled();
    // The frame is the host's, not a second one written here.
    expect(screen.getByTestId('chatbot-deck')).toBeInTheDocument();
    expect(screen.getByTestId('chatbot-navigation-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('chatbot-navigation-tabs')).toBeInTheDocument();
    // Four destinations, each of them drawn once in the column and once on the strip.
    for (const section of CHATBOT_SECTIONS) {
      expect(destinations(section.label(strings))).toHaveLength(2);
    }
  });

  it('marks the section the address names, in the column and on the strip alike', async () => {
    renderSection('statistics');
    await screen.findByRole('combobox', { name: strings.pickerLabel! });
    expect(destinations(strings.sectionStatistics!).every((button) => button.getAttribute('aria-current') === 'page')).toBe(true);
    expect(destinations(strings.sectionBots!).some((button) => button.getAttribute('aria-current') === 'page')).toBe(false);
    // The content pane is named after what is in it, so a screen reader lands somewhere named.
    expect(screen.getByRole('region', { name: strings.sectionStatistics! })).toBeInTheDocument();
  });

  it('renders the section its address names and nothing of its siblings', async () => {
    renderSection('shared');
    expect(await screen.findByText(strings.sharedRequirementsTitle!)).toBeInTheDocument();
    // The register belongs to another address: its search and its creation action are not on this one.
    expect(screen.queryByRole('button', { name: strings.newBot! })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: strings.botsSearch! })).not.toBeInTheDocument();
  });

  it('activates a section by asking the host for that section\'s own address', async () => {
    renderSection('bots');
    await settled();
    resetPluginNavigations();

    // Clicking the column's record is the reader's move; inside the overlay the host turns that address
    // into the modal's own history step, so a section is deep-linkable without the modal closing.
    fireEvent.click(destinations(strings.sectionConversations!)[0]!);
    expect(pluginNavigations).toEqual(['/p/chatbot/conversations']);

    // …and the register keeps the bare address the navigation entry itself opens.
    fireEvent.click(destinations(strings.sectionBots!)[1]!);
    expect(pluginNavigations).toEqual(['/p/chatbot/conversations', '/p/chatbot']);
  });

  it('answers the column\'s search with the chatbot a match names, and opens it', async () => {
    renderSection('bots');
    await settled();
    // The account a chatbot runs as is one of the four things it is found by, and the register's own filter
    // reads the same haystack — so a name typed in either place finds the same chatbot.
    fireEvent.change(screen.getByRole('searchbox', { name: strings.sectionsSearch! }), { target: { value: 'skola-bot' } });

    // A query narrows the column to what answers it: the three sections that hold nothing about a chatbot
    // are not destinations for one.
    await waitFor(() => expect(destinationsNamed(strings.sectionStatistics!)).toBe(0));
    expect(destinations(strings.sectionBots!)).toHaveLength(2);

    // The match IS the register's own row action: the reader who searched for a chatbot lands in its
    // drawer, which is the only thing this plugin can do with one.
    fireEvent.click(screen.getByRole('button', { name: 'Gymnázium' }));
    expect(within(await screen.findByRole('dialog')).getByText(strings.detailName!)).toBeInTheDocument();
    expect(within(top()).getByRole('heading', { name: 'Gymnázium' })).toBeInTheDocument();
  });

  it('takes a match from another section to the register, which is where that chatbot is a row', async () => {
    const deck = renderSection('conversations');
    await screen.findByRole('combobox', { name: strings.pickerLabel! });
    fireEvent.change(screen.getByRole('searchbox', { name: strings.sectionsSearch! }), { target: { value: 'Gymnázium' } });
    resetPluginNavigations();

    fireEvent.click(await screen.findByRole('button', { name: 'Gymnázium' }));
    // A chatbot is a record of the register, so the column asks the host for THAT section's address rather
    // than growing a second way to open a drawer.
    expect(pluginNavigations).toEqual(['/p/chatbot']);

    // The overlay rewrites its own history entry and re-renders the frame it already has mounted, so what
    // the match set is still set when the register arrives: the drawer is open on that chatbot.
    deck.at('bots');
    expect(within(await screen.findByRole('dialog')).getByRole('heading', { name: 'Gymnázium' })).toBeInTheDocument();
  });

  it('says in the host\'s own words when nothing answers the query', async () => {
    renderSection('bots');
    await settled();
    fireEvent.change(screen.getByRole('searchbox', { name: strings.sectionsSearch! }), { target: { value: 'nikdo' } });

    // Every record answered nothing, so the column keeps none of them — and the deck's own line says why,
    // instead of a column of four destinations offered for a query that names none.
    expect(await screen.findByText(strings.sectionsNoMatches!)).toBeInTheDocument();
    for (const section of CHATBOT_SECTIONS) expect(destinationsNamed(section.label(strings))).toBe(0);
  });
});

describe('what a chatbot is found by', () => {
  it('reads the four fields a reader recognizes one by, and nothing else', () => {
    expect(matchingBots([bot, broken, second], 'Gymnázium').map((found) => found.chatbotUserId)).toEqual([second.chatbotUserId]);
    // The account it runs as, its public id, and the Project it works in.
    expect(matchingBots([bot, second], 'skola-bot').map((found) => found.chatbotUserId)).toEqual([second.chatbotUserId]);
    expect(matchingBots([bot, second], 'cbt_ffff').map((found) => found.chatbotUserId)).toEqual([second.chatbotUserId]);
    expect(matchingBots([bot, second], 'skola').map((found) => found.chatbotUserId)).toEqual([second.chatbotUserId]);
    // NOT its state, its domains or its instructions: those are read once the reader is looking at the
    // chatbot, and a column that answered "enabled" would be filtering somebody else's question.
    expect(matchingBots([bot, second], 'enabled')).toEqual([]);
    expect(matchingBots([bot, second], 'www.skola.cz')).toEqual([]);
    // An empty query is not a filter: it is what the register shows with nothing typed.
    expect(matchingBots([bot, second], '  ')).toHaveLength(2);
  });
});

describe('the heading each section wears', () => {
  it.each([
    ['conversations', 'sectionConversations', 'sectionConversationsHint'],
    ['statistics', 'sectionStatistics', 'sectionStatisticsHint'],
    ['shared', 'sectionShared', 'sectionSharedHint'],
  ] as const)('names the %s section and says in one line what it holds', async (id, name, hint) => {
    renderSection(id);
    // The name comes from the same key the column's record reads, so the heading and the record cannot
    // drift; the line under it is what tells the reader where the surface begins.
    expect(await screen.findByRole('heading', { name: strings[name]! })).toBeInTheDocument();
    expect(screen.getByText(strings[hint]!)).toBeInTheDocument();
  });
});

describe('the chatbots section', () => {
  it('lists one row per chatbot and narrows them from the card\'s own search', async () => {
    renderSection('bots');
    await settled();
    expect(await screen.findByText('Městský úřad')).toBeInTheDocument();
    expect(screen.getByText('Škola')).toBeInTheDocument();
    expect(screen.getAllByText(strings.statusAttention!).length).toBeGreaterThan(0);
    expect(screen.getByRole('list').querySelectorAll('[role="listitem"]')).toHaveLength(3);
    expect(screen.queryByRole('heading', { name: strings.sectionBots! })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: strings.botsSearch! }), { target: { value: 'Škola' } });
    await waitFor(() => expect(screen.queryByText('Městský úřad')).not.toBeInTheDocument());
    expect(screen.getByText('Škola')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: strings.botsSearch! }), { target: { value: 'nic' } });
    expect(await screen.findByText(strings.botsNoResults!)).toBeInTheDocument();
  });

  it('shows what an administrator has to fix, in the drawer of the chatbot it is wrong about', async () => {
    renderSection('bots');
    await settled();
    await screen.findByText('Škola');
    const drawer = await openBot('Škola');
    expect(within(drawer).getByText(strings.detailProjectNone!)).toBeInTheDocument();
    expect(within(drawer).getByText(strings.accountNotChatbot!)).toBeInTheDocument();
  });

  it('keeps what a chatbot DID out of its drawer', async () => {
    renderSection('bots');
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');
    // Conversations and statistics are sections of their own, each with a picker over the same register,
    // so the drawer offers no second way into them.
    expect(within(drawer).queryByText(strings.columnTitle!)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(strings.spendTitle!)).not.toBeInTheDocument();
    // What it does carry is this chatbot's own configuration.
    expect(within(drawer).getByRole('switch', { name: strings.maySubmitFormsLabel! })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: strings.limitsEdit! })).toBeInTheDocument();
  });

  it('states the account\'s own pick as the model, and as what decided it', async () => {
    renderSection('bots');
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');

    expect(within(drawer).getByText(strings.detailModel!)).toBeInTheDocument();
    // The model core resolves for this account, carried in the plugin's own payload: the one its turns run on.
    expect(within(drawer).getByText(PICKED_MODEL)).toBeInTheDocument();
    // …and where that came from. The account stored this pick itself, so neither of the other two sources is
    // named anywhere in this row.
    expect(within(drawer).getByText(strings.detailModelSourcePreference!)).toBeInTheDocument();
    expect(within(drawer).queryByText(strings.detailModelSourceInstance!)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(strings.detailModelSourceAllowed!)).not.toBeInTheDocument();
    // No other chatbot's model is anywhere near this drawer either.
    expect(within(drawer).queryByText(DEFAULT_MODEL)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(FORCED_MODEL)).not.toBeInTheDocument();
    // The row reports; it does not edit. The model is not a control on this surface, and the only way to
    // change it is the account that owns it.
    expect(within(drawer).queryByRole('combobox', { name: strings.detailModel! })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('textbox', { name: strings.detailModel! })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('switch', { name: strings.detailModel! })).not.toBeInTheDocument();
  });

  it('states the instance default as inherited when the account chose nothing', async () => {
    renderSection('bots');
    await settled();
    await screen.findByText('Škola');
    const drawer = await openBot('Škola');

    expect(within(drawer).getByText(strings.detailModel!)).toBeInTheDocument();
    // The account chose nothing, so the row names the model that answers instead AND says it came from the
    // instance rather than from this account.
    expect(within(drawer).getByText(DEFAULT_MODEL)).toBeInTheDocument();
    expect(within(drawer).getByText(strings.detailModelSourceInstance!)).toBeInTheDocument();
    expect(within(drawer).queryByText(strings.detailModelSourcePreference!)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(PICKED_MODEL)).not.toBeInTheDocument();
  });

  it('states the allow-list as the source, and never calls that inheritance', async () => {
    renderSection('bots');
    await settled();
    await screen.findByText('Gymnázium');
    const drawer = await openBot('Gymnázium');

    // The instance default is not permitted to this account, so a model from its own allow-list answers.
    // That is not a default the account inherited, and the row must not report it as one.
    expect(within(drawer).getByText(FORCED_MODEL)).toBeInTheDocument();
    expect(within(drawer).getByText(strings.detailModelSourceAllowed!)).toBeInTheDocument();
    expect(within(drawer).queryByText(strings.detailModelSourceInstance!)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(strings.detailModelSourcePreference!)).not.toBeInTheDocument();
  });

  it('states no model when core names none, rather than a default nobody read', async () => {
    // An account core cannot answer for. The payload carries no model, and the row says that instead of
    // showing the instance default, which would be a confident claim about a fact no one read.
    use(http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json(botsBody([
      { ...bot, account: null, model: null, blockers: ['account_unknown'] },
    ]))));
    renderSection('bots');
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');

    expect(within(drawer).getByText(strings.detailModel!)).toBeInTheDocument();
    expect(within(drawer).getByText(strings.detailModelUnnamed!)).toBeInTheDocument();
    expect(within(drawer).queryByText(PICKED_MODEL)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(DEFAULT_MODEL)).not.toBeInTheDocument();
    // The action still belongs to the account, which is where a model is set whether or not one is named.
    expect(within(drawer).getByRole('button', { name: strings.detailModelChange! })).toBeInTheDocument();
  });

  it('hands the administrator to the account whose model it states, through the host\'s own switch', async () => {
    const phases: string[] = [];
    const watch = (event: Event) => { phases.push((event as CustomEvent<{ phase: string }>).detail.phase); };
    window.addEventListener(AUTH_TRANSITION_EVENT, watch);
    try {
      renderSection('bots');
      await settled();
      await screen.findByText('Gymnázium');
      const drawer = await openBot('Gymnázium');

      fireEvent.click(within(drawer).getByRole('button', { name: strings.detailModelChange! }));
      // The account the row is about, entered through the host's own route — core decides who may enter it.
      await waitFor(() => expect(asked.impersonate).toEqual([second.chatbotUserId]));
      // …and announced the way every account-scoped surface expects: the previous account is torn down
      // BEFORE the session changes, and the tab is told when the new identity is the one in the cookie.
      expect(phases).toEqual(['start', 'commit']);
    } finally {
      window.removeEventListener(AUTH_TRANSITION_EVENT, watch);
    }
  });

  it('reports a refused switch and keeps the account the reader was in', async () => {
    const phases: string[] = [];
    const watch = (event: Event) => { phases.push((event as CustomEvent<{ phase: string }>).detail.phase); };
    window.addEventListener(AUTH_TRANSITION_EVENT, watch);
    use(http.post('/api/auth/impersonate', () => HttpResponse.json({ error: 'forbidden' }, { status: 403 })));
    try {
      renderSection('bots');
      await settled();
      await screen.findByText('Městský úřad');
      const drawer = await openBot('Městský úřad');

      fireEvent.click(within(drawer).getByRole('button', { name: strings.detailModelChange! }));
      // The server's own word for it, in the drawer's own error line, and the transition rolled back so a
      // sibling tab is not left waiting for an identity that never arrived.
      expect(await within(drawer).findByText('forbidden')).toBeInTheDocument();
      expect(phases).toEqual(['start', 'rollback']);
      expect(within(drawer).getByText(PICKED_MODEL)).toBeInTheDocument();
    } finally {
      window.removeEventListener(AUTH_TRANSITION_EVENT, watch);
    }
  });

  it('auto-saves settings and preserves confirmed status actions', async () => {
    renderSection('bots');
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');

    fireEvent.click(within(drawer).getByRole('switch', { name: strings.maySubmitFormsLabel! }));
    await waitFor(() => expect(asked.botPatch[0]).toMatchObject({ maySubmitForms: false }), { timeout: 3000 });

    fireEvent.click(within(top()).getByRole('button', { name: strings.disableAction! }));
    expect(within(top()).getByText(strings.disableTitle!)).toBeInTheDocument();
    fireEvent.click(within(top()).getByRole('button', { name: strings.disableConfirm! }));
    await waitFor(() => expect(asked.botPatch.at(-1)).toMatchObject({ action: 'disable' }), { timeout: 3000 });

    fireEvent.click(within(top()).getByRole('button', { name: strings.enableAction! }));
    expect(within(top()).getByText(strings.enableTitle!)).toBeInTheDocument();
    fireEvent.click(within(top()).getByRole('button', { name: strings.enableConfirm! }));
    await waitFor(() => expect(asked.botPatch.at(-1)).toMatchObject({ action: 'enable' }), { timeout: 3000 });
  });

  it('states the sensitive-data mode as unavailable instead of offering a switch it would refuse', async () => {
    renderSection('bots');
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

  it('keeps a card\'s reasoning behind its own help mark instead of under its heading', async () => {
    renderSection('bots');
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');

    // Every card in the drawer is a heading and rows that name a value; what used to be a sentence under
    // the heading waits behind the `?` the host draws for it, which is where this app keeps long-form copy.
    expect(within(drawer).getByTitle(strings.limitsHint!)).toBeInTheDocument();
    expect(within(drawer).queryByText(strings.limitsHint!)).not.toBeInTheDocument();
    // The value itself stays on the surface: what the reader opened the drawer for costs no click.
    expect(within(drawer).getByText(strings.detailAccount!)).toBeInTheDocument();
    expect(within(drawer).getByText('@ured-bot')).toBeInTheDocument();
  });

  it('states an empty domain list as a value, and what that costs behind the help mark', async () => {
    use(http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json(botsBody([{ ...bot, origins: [] }]))));
    renderSection('bots');
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');

    expect(within(drawer).getByText(strings.originsEmpty!)).toBeInTheDocument();
    // "answers nobody" is reasoning about a mechanism, so it reads behind the card's own mark rather than
    // in the place a value belongs.
    expect(within(drawer).getByTitle(strings.originsHint!)).toBeInTheDocument();
  });

  it('reports a failed load with a retry instead of an empty register', async () => {
    use(http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    renderSection('bots');
    await settled();
    // The retry action is the HOST's, labelled from its own dictionary — not the plugin's copy.
    await waitFor(() => expect(screen.getByText(strings.botsLoadError!, { exact: false })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('offers creation when there is nothing registered yet, and lists what it created', async () => {
    use(http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json(botsBody([]))));
    renderSection('bots');
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
    renderSection('bots');
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
    renderSection('bots');
    await settled();
    await screen.findByText(name);
    await openBot(name);
    return await openWindow(strings.limitsEdit!);
  };

  it('sets the three main numbers with sliders and keeps the remaining seven behind Advanced', async () => {
    const limits = await openLimits('Městský úřad');

    expect(within(limits).getByRole('slider', { name: strings.limit_dailyTurnLimit! })).toHaveValue('500');
    expect(within(limits).getByRole('slider', { name: strings.limit_dailyCostMicrousd! }))
      .toHaveValue(String(DEFAULT_LIMITS.dailyCostMicrousd));
    expect(within(limits).getByRole('slider', { name: strings.limit_retentionDays! })).toHaveValue('30');
    expect(within(limits).queryByRole('slider', { name: strings.limit_rateIpPerMinute! })).not.toBeInTheDocument();

    fireEvent.click(within(limits).getByRole('button', { name: strings.limitsAdvanced! }));
    const rate = within(limits).getByRole('slider', { name: strings.limit_rateIpPerMinute! }) as HTMLInputElement;
    expect(rate.value).toBe('75');
    fireEvent.change(rate, { target: { value: '60' } });
    expect((within(limits).getByRole('slider', { name: strings.limit_rateIpPerMinute! }) as HTMLInputElement).value)
      .toBe('60');
  });

  it('states every number in the unit the reader thinks in, not the one it is stored in', async () => {
    const limits = await openLimits('Městský úřad');
    // The ceiling is stored in microdollars, and nobody has ever decided to spend one.
    expect(within(limits).getByText('$10.00')).toBeInTheDocument();
    expect(within(limits).getByText(`30 ${strings.limitUnit_retentionDays}`)).toBeInTheDocument();
  });
});

describe('the conversations section', () => {
  /** The conversations section, mounted on its own and settled on the control it owns. */
  const openConversations = async () => {
    renderSection('conversations');
    await screen.findByRole('combobox', { name: strings.pickerLabel! });
  };

  it('names each row by its core session title, with the visitor and their address one hover away, and switches chatbots', async () => {
    await openConversations();
    // The title core gave the session is the row's name; the visitor and their last address are the row's
    // tooltip, not its text.
    expect((await screen.findByText('Office hours')).closest('[role="row"]')).toHaveAttribute('title', '203.0.113.9 · visitor-ured');
    expect(screen.getByText('Payment question').closest('[role="row"]')).toHaveAttribute('title', '198.51.100.20 · visitor-other');
    expect(screen.queryByText('visitor-ured')).not.toBeInTheDocument();
    // A session core has not named yet still reads as a conversation, never as an empty cell, and an address
    // that was never kept is said to be unknown rather than left blank.
    expect(screen.getByText(strings.conversationUntitled!).closest('[role="row"]'))
      .toHaveAttribute('title', `${strings.visitorIpUnknown!} · visitor-untitled`);
    // The first chatbot of the register until somebody says otherwise, and the requests named it.
    expect(asked.conversations).toEqual([bot.chatbotUserId]);
    await waitFor(() => expect(asked.visitors).toEqual([bot.chatbotUserId]));

    fireEvent.change(screen.getByRole('combobox', { name: strings.pickerLabel! }), { target: { value: String(second.chatbotUserId) } });
    expect(await screen.findByText('Admissions')).toBeInTheDocument();
    // Nothing of the previous chatbot is left under the new one's name.
    expect(screen.queryByText('Office hours')).not.toBeInTheDocument();
    expect(asked.conversations).toEqual([bot.chatbotUserId, second.chatbotUserId]);
    await waitFor(() => expect(asked.visitors).toEqual([bot.chatbotUserId, second.chatbotUserId]));
  });

  /** Open the visitor picker, type into its search, pick the one option whose label is given, and save. */
  const pickVisitor = async (search: string, label: string) => {
    fireEvent.click(await screen.findByRole('button', { name: strings.visitorFilter! }));
    const picker = top();
    fireEvent.change(within(picker).getByRole('searchbox'), { target: { value: search } });
    fireEvent.click(within(picker).getByRole('button', { name: label }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Save changes' }));
  };

  it('offers each visitor by address and id, searchable, and narrows the register to the one picked', async () => {
    await openConversations();
    await screen.findByText('Office hours');
    fireEvent.click(await screen.findByRole('button', { name: strings.visitorFilter! }));
    const picker = top();
    // Every visitor of THIS chatbot, address first, and the one with no kept address says so.
    for (const label of [strings.visitorAll!, '203.0.113.9 · visitor-ured', '198.51.100.20 · visitor-other', `${strings.visitorIpUnknown!} · visitor-untitled`]) {
      expect(within(picker).getByRole('button', { name: label })).toBeInTheDocument();
    }
    // Typing a fragment of the address narrows the offer to that visitor.
    fireEvent.change(within(picker).getByRole('searchbox'), { target: { value: '198.51' } });
    expect(within(picker).queryByRole('button', { name: '203.0.113.9 · visitor-ured' })).not.toBeInTheDocument();
    fireEvent.click(within(picker).getByRole('button', { name: '198.51.100.20 · visitor-other' }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Payment question')).toBeInTheDocument();
    expect(screen.queryByText('Office hours')).not.toBeInTheDocument();
    // The server was asked for exactly that visitor, never for a fragment.
    expect(asked.visitorQueries.at(-1)).toBe('visitor-other');

    // Picking every visitor again restores the whole register, and the request names no visitor at all.
    await pickVisitor('', strings.visitorAll!);
    expect(await screen.findByText('Office hours')).toBeInTheDocument();
    expect(screen.getByText('Payment question')).toBeInTheDocument();
    expect(asked.visitorQueries.at(-1)).toBeNull();
  });

  it('finds a visitor by a fragment of the id as well', async () => {
    await openConversations();
    await screen.findByText('Office hours');
    await pickVisitor('ured', '203.0.113.9 · visitor-ured');
    await waitFor(() => expect(asked.visitorQueries.at(-1)).toBe('visitor-ured'));
    expect(await screen.findByText('Office hours')).toBeInTheDocument();
    expect(screen.queryByText('Payment question')).not.toBeInTheDocument();
  });

  it('says so when the picked visitor has no conversation any more', async () => {
    use(http.get('/api/plugins/chatbot/api/conversations', ({ url }) => {
      const visitor = url.searchParams.get('visitor');
      const all = conversationsOf(bot.chatbotUserId);
      // The picked visitor's conversation was deleted after the picker was filled.
      const matching = visitor === null ? all : [];
      return HttpResponse.json({ conversations: matching, total: matching.length, limit: 25, offset: 0 });
    }));
    await openConversations();
    await screen.findByText('Office hours');
    await pickVisitor('198.51', '198.51.100.20 · visitor-other');
    expect(await screen.findByText(strings.conversationsVisitorGone!)).toBeInTheDocument();
    expect(screen.queryByText(strings.conversationsEmptyTitle!)).not.toBeInTheDocument();
  });

  it('says when the picker offers only the most recently active visitors, and when it could not be read', async () => {
    use(http.get('/api/plugins/chatbot/api/visitors', () => HttpResponse.json({
      visitors: conversationsOf(bot.chatbotUserId).map(({ visitorId, ip, lastAt }) => ({ visitorId, ip, lastAt })),
      truncated: true,
    })));
    await openConversations();
    expect(await screen.findByText(strings.visitorsTruncated!.replace('{n}', '3'))).toBeInTheDocument();

    cleanup();
    use(http.get('/api/plugins/chatbot/api/visitors', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    await openConversations();
    expect(await screen.findByText(new RegExp(strings.visitorsLoadError!))).toBeInTheDocument();
    // The register itself still reads: the picker is a narrowing, not a precondition.
    expect(await screen.findByText('Office hours')).toBeInTheDocument();
  });

  // Erasing removes every conversation of the chatbot, while a narrowed answer counts only one visitor's, so
  // the confirmation would name the wrong number. It is offered on the whole register only.
  it('offers erasing only on the whole register', async () => {
    await openConversations();
    await screen.findByText('Office hours');
    const erase = () => screen.getByRole('button', { name: 'Delete all conversations' });
    expect(erase()).toBeEnabled();
    await pickVisitor('198.51', '198.51.100.20 · visitor-other');
    await waitFor(() => expect(screen.queryByText('Office hours')).not.toBeInTheDocument());
    expect(erase()).toBeDisabled();
    await pickVisitor('', strings.visitorAll!);
    expect(await screen.findByText('Office hours')).toBeInTheDocument();
    expect(erase()).toBeEnabled();
  });

  it('confirms the selected chatbot and erases every batch before resetting to the empty first page', async () => {
    let total = 27;
    const readOffsets: number[] = [];
    const deleted: number[] = [];
    use(
      http.get('/api/plugins/chatbot/api/conversations', ({ url }) => {
        readOffsets.push(Number(url.searchParams.get('offset')));
        return HttpResponse.json({ conversations: total ? [conversationOf('visitor-skola', 1, 'Admissions')] : [], total,
          limit: 25, offset: Number(url.searchParams.get('offset')) });
      }),
      http.delete('/api/plugins/chatbot/api/conversations', ({ url }) => {
        deleted.push(Number(url.searchParams.get('chatbotUserId')));
        const count = Math.min(total, 25);
        total -= count;
        return HttpResponse.json({ deleted: count, kept: 0, remaining: total });
      }),
    );
    await openConversations();
    fireEvent.change(screen.getByRole('combobox', { name: strings.pickerLabel! }), { target: { value: String(second.chatbotUserId) } });
    await screen.findByText('Admissions');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(readOffsets.at(-1)).toBe(25));
    fireEvent.click(screen.getByRole('button', { name: 'Delete all conversations' }));
    expect(within(top()).getByText(/27 conversations of Gymnázium/)).toBeInTheDocument();
    expect(deleted).toEqual([]);
    fireEvent.click(within(top()).getByRole('button', { name: 'Cancel' }));
    expect(deleted).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete all conversations' }));
    fireEvent.click(within(top()).getByRole('button', { name: 'Delete conversations' }));
    await waitFor(() => expect(deleted).toEqual([second.chatbotUserId, second.chatbotUserId]));
    expect(await screen.findByText(strings.conversationsEmptyTitle!)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete all conversations' })).toBeDisabled();
    expect(readOffsets.at(-1)).toBe(0);
    expect(screen.getByRole('status')).toHaveTextContent('27 conversations deleted');
  });

  it('reports conversations kept during an answer and stops when no deletion is possible', async () => {
    const deleted: number[] = [];
    use(http.delete('/api/plugins/chatbot/api/conversations', ({ url }) => {
      deleted.push(Number(url.searchParams.get('chatbotUserId')));
      return HttpResponse.json({ deleted: 0, kept: 1, remaining: 1 });
    }));
    await openConversations();
    await screen.findByText('Office hours');
    fireEvent.click(screen.getByRole('button', { name: 'Delete all conversations' }));
    fireEvent.click(within(top()).getByRole('button', { name: 'Delete conversations' }));
    await waitFor(() => expect(deleted).toEqual([bot.chatbotUserId]));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Kept while an answer is in progress: 1'));
    expect(await screen.findByText('Office hours')).toBeInTheDocument();
  });

  it('reports a failed erase without claiming success or clearing the register', async () => {
    use(http.delete('/api/plugins/chatbot/api/conversations', () => HttpResponse.json({ detail: 'Erase failed' }, { status: 500 })));
    await openConversations();
    await screen.findByText('Office hours');
    fireEvent.click(screen.getByRole('button', { name: 'Delete all conversations' }));
    fireEvent.click(within(top()).getByRole('button', { name: 'Delete conversations' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('api 500');
    expect(await screen.findByText('Office hours')).toBeInTheDocument();
  });

  it('opens the stored core session in a new host chat window without a transcript drawer', async () => {
    await openConversations();
    fireEvent.click(await screen.findByRole('button', { name: strings.openConversation!.replace('{visitor}', 'visitor-ured') }));

    expect(openBrainSessionWindow).toHaveBeenCalledWith('session-visitor-ured');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Office hours')).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.conversationsEraseAction! })).toBeDisabled();
  });

  it('says there is nothing to read when no chatbot is registered', async () => {
    use(http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json(botsBody([]))));
    renderSection('conversations');
    // A picker over nothing is not offered at all: the section says what has to happen first.
    expect(await screen.findByText(strings.pickerNoBots!)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: strings.pickerLabel! })).not.toBeInTheDocument();
  });

  it('reports a failed REGISTER read rather than claiming there is no chatbot', async () => {
    use(http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    renderSection('conversations');
    // The section cannot know which chatbot to read without the register, and "could not be read" is a
    // different answer from "none registered" — one of them is a thing to fix.
    expect(await screen.findByText(strings.botsLoadError!, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(strings.pickerNoBots!)).not.toBeInTheDocument();
  });
});

describe('daily ceiling visibility', () => {
  it.each([
    { verdict: { ok: true }, label: strings.budgetAvailable },
    { verdict: { ok: false, reason: 'budget_exhausted', ceiling: 'turns' }, label: strings.budgetTurnsExhausted },
    { verdict: { ok: false, reason: 'budget_exhausted', ceiling: 'cost' }, label: strings.budgetCostExhausted },
    { verdict: { ok: false, reason: 'budget_unverifiable', ceiling: 'cost' }, label: strings.budgetUnknown },
  ])('shows the server verdict in the register: $label', async ({ verdict, label }) => {
    use(http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json({
      ...botsBody(), bots: [{ ...bot, budget: { ...bot.budget, verdict } }],
    })));
    renderSection('bots');
    expect(await screen.findByText(label!)).toBeInTheDocument();
    expect(screen.getByText('9 / 500')).toBeInTheDocument();
    expect(screen.getByText('$0.07 / $10.00')).toBeInTheDocument();
    expect(screen.queryByText('Tokens per day')).not.toBeInTheDocument();
  });
});

describe('the statistics section', () => {
  const openStats = async () => {
    renderSection('statistics');
    await screen.findByRole('combobox', { name: strings.pickerLabel! });
  };

  it('is a chatbot, a window, a chart and one line of spend', async () => {
    await openStats();

    expect(await screen.findByRole('button', { name: 'Filters' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const filters = screen.getByRole('dialog', { name: 'Filters' });
    const rangeTrigger = within(filters).getByRole('button', { name: /Last (7|30) days/ });
    expect(rangeTrigger).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(strings.chartTurns!).length).toBeGreaterThan(0));
    expect(screen.getAllByText(strings.chartErrors!).length).toBeGreaterThan(0);
    const figures = screen.getAllByRole('figure');
    expect(figures).toHaveLength(1);
    const legend = figures[0]!.querySelector('figcaption')!;
    expect(legend.textContent).toBe(`${strings.chartTurns}${strings.statsColumnDone}${strings.chartErrors}${strings.spendTitle}`);
    expect(legend.querySelectorAll('span.inline-flex')).toHaveLength(4);
    expect(within(figures[0]!).getAllByText(new RegExp(`${strings.chartTurns} 9, ${strings.statsColumnDone} 8, ${strings.chartErrors} 1, ${strings.spendTitle} \\$12\\.50`)).length).toBeGreaterThan(0);
    expect(asked.stats).toEqual([bot.chatbotUserId]);

    // The spend is ONE line, from the instance's rollup for this account, over the same window.
    expect(screen.getAllByText(strings.spendTitle!).length).toBeGreaterThan(0);
    expect(await screen.findByText('9 turns · 1,234 tokens · $12.50')).toBeInTheDocument();
    expect(asked.usage).toEqual([]);

    // Another window is another read, over a range the reader chose.
    fireEvent.click(rangeTrigger);
    const range = screen.getByRole('dialog', { name: 'Date range' });
    fireEvent.click(within(range).getByRole('button', { name: 'Today' }));
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

  it('draws the series that coincide as marks that cannot cover each other', async () => {
    // Answered equals turns on every day without a failure, and the spend runs in step with the turns on
    // its own axis, so all three land on the same pixels. Two of them drawn as lines is one line painted
    // over the other, and the legend then names a series nobody can see.
    const components = (window as unknown as { ElowenUiRuntime: { components: { TimeSeriesChart: (props: { series: { key: string; colour: string; variant?: string }[] }) => unknown } } }).ElowenUiRuntime.components;
    const chart = vi.spyOn(components, 'TimeSeriesChart');
    try {
      await openStats();
      await waitFor(() => expect(chart).toHaveBeenCalled());
      const series = chart.mock.lastCall![0].series;
      const coinciding = series.filter((entry) => ['turns', 'done', 'cost'].includes(entry.key));
      expect(coinciding).toHaveLength(3);
      expect(coinciding.filter((entry) => entry.variant !== 'bar')).toHaveLength(1);
      expect(new Set(series.map((entry) => entry.colour)).size).toBe(series.length);
    } finally {
      chart.mockRestore();
    }
  });

  it('renders zero-valued days in the merged chart', async () => {
    use(http.get('/api/plugins/chatbot/api/stats', ({ url }) => HttpResponse.json({
      chatbotUserId: Number(url.searchParams.get('chatbotUserId')),
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      days: [],
      spend: [],
      totals: { turns: 0, done: 0, errors: 0, queued: 0, running: 0 },
      queueWait: { samples: 0, p50Seconds: null, p95Seconds: null },
    })));
    await openStats();
    expect(await screen.findByText(strings.chartTitle!)).toBeInTheDocument();
    const chart = screen.getByRole('figure');
    expect(within(chart).getAllByText(new RegExp(`${strings.chartTurns} 0, ${strings.statsColumnDone} 0, ${strings.chartErrors} 0, ${strings.spendTitle} —`)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('keeps incomplete daily pricing unknown in the chart and total', async () => {
    use(http.get('/api/plugins/chatbot/api/stats', ({ url }) => HttpResponse.json({
      chatbotUserId: bot.chatbotUserId,
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      days: [],
      spend: [{ day: url.searchParams.get('to'), usage: { turns: 2, tokens: 1090000, costUsd: 0.07, costedTurns: 1 } }],
      totals: { turns: 0, done: 0, errors: 0, queued: 0, running: 0 },
      queueWait: { samples: 0, p50Seconds: null, p95Seconds: null },
    })));
    await openStats();
    expect(await screen.findByText(strings.costUnknownHint!)).toBeInTheDocument();
    expect(screen.getByText('2 turns · 1,090,000 tokens · Unknown')).toBeInTheDocument();
    expect(screen.queryByText('$0.07')).not.toBeInTheDocument();
  });

  it('reports a failed counters read with the retry the host owns', async () => {
    use(http.get('/api/plugins/chatbot/api/stats', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    await openStats();
    expect(await screen.findByText(strings.statsLoadError!, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('the shared settings section', () => {
  const openShared = async () => {
    renderSection('shared');
    await screen.findByText(strings.sharedRequirementsTitle!);
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
    // The stored value survives the asynchronous detail load instead of being replaced with the manifest default.
    expect(box.value).toBe('45');
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
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('the allowed domains', () => {
  it('states them as a summary, and refuses one the server would reject', async () => {
    renderSection('bots');
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

  it('adds one in the window, carries it into the summary and auto-saves it', async () => {
    renderSection('bots');
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');
    const domains = await openWindow(strings.originsLabel!);
    fireEvent.change(within(domains).getByPlaceholderText(strings.originsPlaceholder!), { target: { value: 'https://www.druhy.cz' } });
    fireEvent.click(within(domains).getByRole('button', { name: strings.originsAdd! }));
    // Closing the editor window leaves the change visible and the host auto-saves the detail draft.
    fireEvent.click(within(domains).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(within(drawer).getByText(strings.originsCount!.replace('{n}', '2'))).toBeInTheDocument();
    await waitFor(() => expect(asked.botPatch[0]).toMatchObject({ origins: [SITE, 'https://www.druhy.cz'] }), { timeout: 3000 });
  });

  it('saves pending detail changes before opening the appearance editor', async () => {
    renderSection('bots');
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');
    fireEvent.click(within(drawer).getByRole('switch', { name: strings.maySubmitFormsLabel! }));

    const appearance = await openWindow(strings.appearanceAction!);
    expect(within(appearance).getByText(strings.appearanceTitle!)).toBeInTheDocument();
    expect(asked.botPatch[0]).toMatchObject({ maySubmitForms: false });
  });
});

describe('the pure helpers the drawer reports with', () => {
  it('names the source of a model in three distinct ways, and never as inheritance for the allow-list', () => {
    const copy = {
      detailModelSourcePreference: 'picked',
      detailModelSourceInstance: 'inherited',
      detailModelSourceAllowed: 'allowed',
    };
    expect(modelSourceText({ exec: PICKED_MODEL, source: 'preference' }, copy)).toBe('picked');
    expect(modelSourceText({ exec: DEFAULT_MODEL, source: 'instance' }, copy)).toBe('inherited');
    // The allow-list case is a model the account MAY run, not a default it fell back to: the two must not
    // share a word, because only one of them is inheritance.
    expect(modelSourceText({ exec: FORCED_MODEL, source: 'allowed' }, copy)).toBe('allowed');
  });

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

  it('prefills an unset stored limit from the server default', () => {
    expect(limitDraftOf(LIMITS).dailyTurnLimit).toBe(500);
    expect(limitDraftOf({ ...LIMITS, dailyCostMicrousd: null }).dailyCostMicrousd)
      .toBe(DEFAULT_LIMITS.dailyCostMicrousd);
  });

  it('keeps a stored value the slider would not have offered, and widens that slider to reach it', () => {
    // A retention of ten years is inside the server's bounds and far outside the span the window offers.
    // Opening the window must not quietly propose a different number than the one the row holds.
    const far = limitDraftOf({ ...LIMITS, retentionDays: 3_650, rateIpPerMinute: 1 });
    expect(far.retentionDays).toBe(3_650);
    expect(far.rateIpPerMinute).toBe(1);
    expect(sliderRange('retentionDays', far.retentionDays).max).toBe(3_650);
    expect(sliderRange('rateIpPerMinute', far.rateIpPerMinute).min).toBe(1);
    // An ordinary row is served by the practical span, not by the validity bounds.
    const usual = limitDraftOf(LIMITS);
    expect(sliderRange('retentionDays', usual.retentionDays))
      .toEqual(specOf('retentionDays').slider);
    for (const field of LIMIT_FIELDS) expect(isUsableLimit(usual[field], specOf(field))).toBe(true);
  });

  it('bounds the all preset to the 366-day window the chatbot route accepts', () => {
    const now = Date.parse('2026-09-21T23:30:00.000Z');
    const window = statsWindow({ preset: 'all' }, now, { fromMs: Number.NEGATIVE_INFINITY, toMs: Number.POSITIVE_INFINITY });
    expect(window.to).toBe('2026-09-21');
    expect(window.from).toBe('2025-09-21');
    expect(new Date(window.fromMs).toISOString()).toBe('2025-09-21T00:00:00.000Z');
    expect(new Date(window.toMs).toISOString()).toBe('2026-09-21T23:59:59.999Z');
  });

  it('draws every day of the window, including the ones nobody wrote on', () => {
    const points = chartPoints([{ day: '2026-09-20', turns: 4, done: 4, errors: 0 }], [{ day: '2026-09-20', usage: { turns: 4, tokens: 500, costUsd: 1.25, costedTurns: 4 } }], '2026-09-19', '2026-09-21');
    expect(points).toEqual([
      { label: '2026-09-19', turns: 0, done: 0, errors: 0, cost: null },
      { label: '2026-09-20', turns: 4, done: 4, errors: 0, cost: 1.25 },
      { label: '2026-09-21', turns: 0, done: 0, errors: 0, cost: null },
    ]);
  });
});
