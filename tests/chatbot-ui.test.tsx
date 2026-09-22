import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import manifest from '../plugins/chatbot/elowen-plugin.json' with { type: 'json' };
import { ChatbotDeck } from '../plugins/chatbot/web-src/ChatbotDeck';
import { CHATBOT_SECTIONS } from '../plugins/chatbot/web-src/sections';
import { blockerText } from '../plugins/chatbot/web-src/BotDetail';
import { limitDraftOf, sliderRange } from '../plugins/chatbot/web-src/LimitsModal';
import { originHint } from '../plugins/chatbot/web-src/OriginsField';
import { matchingBots } from '../plugins/chatbot/web-src/search';
import { DEFAULT_LIMITS, LIMIT_FIELDS, MANDATORY_LIMITS, isUsableLimit, specOf, type LimitValues } from '../plugins/chatbot/src/limits';
import { chartPoints, statsWindow } from '../plugins/chatbot/web-src/StatsView';
import { HttpResponse, close, http, listen, resetHandlers, setDefaults, use } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
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
    nav: manifest.web.nav,
    settings: [],
    presentation: manifest.web.presentation,
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
    expect(within(drawer).queryByText(strings.columnVisitor!)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(strings.spendTitle!)).not.toBeInTheDocument();
    // What it does carry is this chatbot's own configuration.
    expect(within(drawer).getByRole('switch', { name: strings.maySubmitFormsLabel! })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: strings.limitsEdit! })).toBeInTheDocument();
  });

  it('saves the whole row on an explicit submit, and disables it only after a confirmation', async () => {
    renderSection('bots');
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');

    const submitToggle = within(drawer).getByRole('switch', { name: strings.maySubmitFormsLabel! });
    const save = within(drawer).getByRole('button', { name: strings.saveAction! }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(submitToggle);
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(asked.botPatch[0]).toMatchObject({ maySubmitForms: false }));

    fireEvent.click(within(top()).getByRole('button', { name: strings.disableAction! }));
    const confirm = top();
    expect(within(confirm).getByText(strings.disableTitle!)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: strings.disableConfirm! }));
    await waitFor(() => expect(within(top()).getByRole('button', { name: strings.enableAction! })).toBeInTheDocument());
  });

  it('asks before closing a drawer that holds unsaved changes', async () => {
    renderSection('bots');
    await settled();
    await screen.findByText('Městský úřad');
    const drawer = await openBot('Městský úřad');
    fireEvent.click(within(drawer).getByRole('switch', { name: strings.maySubmitFormsLabel! }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));

    // The drawer is still there, with the question over it: a stray click may not cost typed instructions.
    expect(within(top()).getByText(strings.discardTitle!)).toBeInTheDocument();
    fireEvent.click(within(top()).getByRole('button', { name: strings.discardConfirm! }));
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));
    expect(asked.botPatch).toHaveLength(0);
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
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
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

  it('sets the three main numbers with sliders and keeps the remaining eight behind Advanced', async () => {
    const limits = await openLimits('Městský úřad');

    expect(within(limits).getByRole('slider', { name: strings.limit_dailyTurnLimit! })).toHaveValue('200');
    expect(within(limits).getByRole('slider', { name: strings.limit_dailyCostMicrousd! }))
      .toHaveValue(String(DEFAULT_LIMITS.dailyCostMicrousd));
    expect(within(limits).getByRole('slider', { name: strings.limit_retentionDays! })).toHaveValue('30');
    expect(within(limits).queryByRole('slider', { name: strings.limit_rateIpPerMinute! })).not.toBeInTheDocument();

    fireEvent.click(within(limits).getByRole('button', { name: strings.limitsAdvanced! }));
    const rate = within(limits).getByRole('slider', { name: strings.limit_rateIpPerMinute! }) as HTMLInputElement;
    expect(rate.value).toBe('30');
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
    expect(asked.stats).toEqual([bot.chatbotUserId]);

    // The spend is ONE line, from the instance's rollup for this account, over the same window.
    expect(screen.getByText(strings.spendTitle!)).toBeInTheDocument();
    expect(await screen.findByText('9 turns · 1,234 tokens · $12.50')).toBeInTheDocument();
    const [from, to] = asked.usage[0]!.split('|');
    expect(new Date(from!).getTime()).toBeLessThan(new Date(to!).getTime());

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

  it('renders zero-valued days in the same daily register', async () => {
    use(http.get('/api/plugins/chatbot/api/stats', ({ url }) => HttpResponse.json({
      chatbotUserId: Number(url.searchParams.get('chatbotUserId')),
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      days: [],
      totals: { turns: 0, done: 0, errors: 0, queued: 0, running: 0 },
      queueWait: { samples: 0, p50Seconds: null, p95Seconds: null },
    })));
    await openStats();
    expect(await screen.findByText(strings.statsTableTitle!)).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
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

  it('adds one in the window and carries it into the summary', async () => {
    renderSection('bots');
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

  it('prefills an unset stored limit from the server default', () => {
    expect(limitDraftOf(LIMITS).dailyTurnLimit).toBe(200);
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
    const points = chartPoints([{ day: '2026-09-20', turns: 4, done: 4, errors: 0 }], '2026-09-19', '2026-09-21');
    expect(points).toEqual([
      { label: '2026-09-19', turns: 0, done: 0, errors: 0 },
      { label: '2026-09-20', turns: 4, done: 4, errors: 0 },
      { label: '2026-09-21', turns: 0, done: 0, errors: 0 },
    ]);
  });
});
