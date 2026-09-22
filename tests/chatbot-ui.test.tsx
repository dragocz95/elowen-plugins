import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import manifest from '../plugins/chatbot/elowen-plugin.json' with { type: 'json' };
import { ChatbotWorkspace } from '../plugins/chatbot/web-src/ChatbotWorkspace';
import { blockerText, limitDraftOf, readLimitDraft } from '../plugins/chatbot/web-src/BotDetail';
import { originHint } from '../plugins/chatbot/web-src/OriginsField';
import { LIMIT_FIELDS, MANDATORY_LIMITS, type LimitValues } from '../plugins/chatbot/src/limits';
import { actionRuleKey, draftRuleRefusal } from '../plugins/chatbot/web-src/SecuritySettings';
import { chartPoints, statsWindow } from '../plugins/chatbot/web-src/StatsView';
import { HttpResponse, close, http, listen, resetHandlers, setDefaults, use } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';

/** The admin workspace, rendered the way it renders in production: inside the host's own runtime fixture,
 *  reaching EVERY component and every string through `window.ElowenUiRuntime`. What this cannot prove is
 *  layout — that is a browser's job and is reported as unverified — but it does prove that the page mounts
 *  against the published component contract, reads only strings its manifest declares, renders its loading,
 *  error, empty and populated states, scopes conversations and statistics to ONE chatbot, and writes back
 *  exactly the grants and rules it showed. */

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
} = { conversations: [], conversation: [], stats: [], usage: [], userPatch: [], botPatch: [] };

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'chatbot', url: '/plugins/chatbot/web/index.js', apiVersion: 12, nav: [], settings: [], strings }])),
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
});
afterAll(() => close());

function renderPage() {
  const { wrapper: Wrapper } = createWrapper();
  return render(<Wrapper><ToastProvider><ChatbotWorkspace plugin="chatbot" /></ToastProvider></Wrapper>);
}

/** Wait until the page's own copy has arrived. The plugin's strings come from a listing query, so the
 *  first paint renders every label empty and React then REUSES those nodes with text — a control queried
 *  before that lands is a node whose events reach nothing. Awaiting the eyebrow (a string only the listing
 *  can supply) is what makes a test that touches a control honest. */
const settled = () => screen.findByText(strings.workspaceEyebrow!);

/** The register and the detail pane both name the selected chatbot, so the page shows one chatbot twice
 *  and a plain `findByText` would refuse to choose between them. */
const findBots = () => screen.findAllByText('Městský úřad');

const openTab = async (label: string) => {
  await settled();
  fireEvent.click(screen.getByRole('radio', { name: label }));
};

/** Open a managed selection from the summary row that stands for it.
 *
 *  The detail pane states its three lists — the allowed domains, the page-action rules and the account's
 *  tools — as a count with a few sample chips and ONE button, which is how the app states a managed
 *  selection everywhere. The editor for each lives in the window that button opens, so a test that means to
 *  touch a control goes through it, exactly as an administrator does. The button carries the section's own
 *  name (`manageAriaLabel`), so this also proves the three summaries are told apart. */
const manage = async (section: string): Promise<HTMLElement> => {
  fireEvent.click(screen.getByRole('button', { name: section }));
  return await screen.findByRole('dialog');
};

describe('the chatbot workspace', () => {
  it('renders the register, the hero figures and one detail pane through the host components', async () => {
    renderPage();
    await settled();
    expect((await findBots()).length).toBeGreaterThan(1);
    expect(screen.getAllByText(bot.publicId).length).toBeGreaterThan(0);
    expect(screen.getAllByText('@ured-bot').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ured').length).toBeGreaterThan(0);
    // The register is populated, so the empty state is not what the reader sees.
    expect(screen.queryByText(strings.botsEmptyTitle!)).not.toBeInTheDocument();
    expect(screen.getByText(strings.embedTitle!)).toBeInTheDocument();
  });

  it('shows what an administrator has to fix, not a chatbot that quietly answers nobody', async () => {
    renderPage();
    await settled();
    expect(screen.getAllByText(strings.statusAttention!).length).toBeGreaterThan(0);
    // The broken chatbot is a row in the register; opening it is how its reasons become readable.
    fireEvent.click(screen.getByRole('button', { name: strings.openBot!.replace('{name}', 'Škola') }));
    expect(await screen.findByText(strings.detailProjectNone!)).toBeInTheDocument();
    expect(screen.getByText(strings.accountNotChatbot!)).toBeInTheDocument();
  });

  it('narrows the register from the toolbar filter, and clears it again', async () => {
    renderPage();
    await settled();
    await findBots();
    // The filter control lives behind the toolbar's own disclosure, exactly as the host mounts it.
    fireEvent.click(screen.getByTestId('page-filters-trigger'));
    fireEvent.change(screen.getByRole('combobox', { name: strings.botsFilter! }), { target: { value: 'attention' } });
    await waitFor(() => expect(screen.queryByText('Městský úřad')).not.toBeInTheDocument());
    expect(screen.getAllByText('Škola').length).toBeGreaterThan(0);
  });

  it('saves the whole row on an explicit submit, and disables it only after a confirmation', async () => {
    renderPage();
    await settled();
    await findBots();

    const prompt = screen.getByPlaceholderText(strings.promptPlaceholder!) as HTMLTextAreaElement;
    const save = screen.getByRole('button', { name: strings.saveAction! }) as HTMLButtonElement;
    // Nothing to save until something changed: the button reflects the form's own dirty state.
    expect(save.disabled).toBe(true);
    fireEvent.change(prompt, { target: { value: 'Nové pokyny.' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect((screen.getByPlaceholderText(strings.promptPlaceholder!) as HTMLTextAreaElement).value).toBe('Nové pokyny.'));

    fireEvent.click(screen.getByRole('button', { name: strings.disableAction! }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(strings.disableTitle!)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: strings.disableConfirm! }));
    // The row comes back disabled, so the page offers the opposite action.
    await waitFor(() => expect(screen.getByRole('button', { name: strings.enableAction! })).toBeInTheDocument());
  });

  it('states the allowed domains as a summary, and refuses one the server would reject', async () => {
    renderPage();
    await settled();
    await findBots();
    // The page itself names the domains it answers on, without listing them as rows.
    expect(screen.getByText(strings.originsCount!.replace('{n}', '1'))).toBeInTheDocument();
    expect(screen.getAllByText(SITE).length).toBeGreaterThan(0);

    const dialog = await manage(strings.originsLabel!);
    const field = within(dialog).getByPlaceholderText(strings.originsPlaceholder!);
    fireEvent.change(field, { target: { value: 'www.example.cz' } });
    expect(within(dialog).getByText(strings.originsInvalid!)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: SITE } });
    expect(within(dialog).getByText(strings.originsDuplicate!)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: strings.originsAdd! })).toBeDisabled();
  });

  it('adds a domain in the window and carries it into the summary', async () => {
    renderPage();
    await settled();
    await findBots();
    const dialog = await manage(strings.originsLabel!);
    fireEvent.change(within(dialog).getByPlaceholderText(strings.originsPlaceholder!), { target: { value: 'https://www.druhy.cz' } });
    fireEvent.click(within(dialog).getByRole('button', { name: strings.originsAdd! }));
    // The window edits the DRAFT the page holds, so closing it leaves the new domain counted and the save
    // offered — nothing is stored until that explicit click.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByText(strings.originsCount!.replace('{n}', '2'))).toBeInTheDocument());
    expect(screen.getByRole('button', { name: strings.saveAction! })).toBeEnabled();
    expect(asked.botPatch).toHaveLength(0);
  });

  it('shows every limit the server reports, with the ones nobody decided left empty', async () => {
    renderPage();
    await settled();
    await findBots();
    expect(screen.getByText(strings.limitsTitle!)).toBeInTheDocument();
    // The numbers the chatbot serves under are the ones on screen, field by field.
    expect((screen.getByLabelText(strings.limit_rateIpPerMinute!) as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText(strings.limit_retentionDays!) as HTMLInputElement).value).toBe('30');
    // An optional ceiling nobody set is an EMPTY box, never a zero the owner did not choose.
    expect((screen.getByLabelText(strings.limit_dailyCostMicrousd!) as HTMLInputElement).value).toBe('');
    // Nothing is missing on a configured chatbot, so the enable path is not blocked by the numbers.
    expect(screen.queryByText(strings.limitsMissing!.replace('{fields}', ''), { exact: false })).not.toBeInTheDocument();
  });

  it('shows the sensitive-data mode as unavailable instead of offering a switch it would refuse', async () => {
    renderPage();
    await settled();
    await findBots();
    expect(screen.getByText(strings.sensitiveTitle!)).toBeInTheDocument();
    expect(screen.getByText(strings.sensitiveBody!)).toBeInTheDocument();
    // The copy explains a refusal; there is no control that could be mistaken for granting the mode.
    expect(screen.queryByRole('checkbox', { name: strings.sensitiveTitle! })).not.toBeInTheDocument();
  });

  it('will not enable a chatbot whose numbers are not all decided, and names the ones missing', async () => {
    renderPage();
    await settled();
    await findBots();
    // The broken chatbot is the draft with no Project, so its blockers already keep it from being enabled.
    // What this checks is the LIMIT half: clearing a mandatory number disables the action and says which.
    fireEvent.click(screen.getByRole('button', { name: strings.openBot!.replace('{name}', 'Škola') }));
    await screen.findByText(strings.detailProjectNone!);
    const turns = screen.getByLabelText(strings.limit_dailyTurnLimit!) as HTMLInputElement;
    expect(turns.value).toBe('200');
    fireEvent.change(turns, { target: { value: '' } });
    expect(await screen.findByText(strings.limitsMissing!.replace('{fields}', strings.limit_dailyTurnLimit!))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.enableAction! })).toBeDisabled();
  });

  it('reports a limit the server would refuse, without pretending it was stored', async () => {
    renderPage();
    await settled();
    await findBots();
    const actions = screen.getByLabelText(strings.limit_maxActionsPerTurn!) as HTMLInputElement;
    fireEvent.change(actions, { target: { value: '0' } });
    expect(screen.getByText(strings.limitsRange!.replace('{min}', '1').replace('{max}', '20'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.saveAction! })).toBeDisabled();
  });

  it('reports a failed load with a retry instead of an empty register', async () => {
    use(http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    renderPage();
    await settled();
    // The retry action is the HOST's, labelled from its own dictionary — not the plugin's copy.
    await waitFor(() => expect(screen.getByText(strings.botsLoadError!, { exact: false })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('offers creation when there is nothing registered yet', async () => {
    use(http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json(botsBody([]))));
    renderPage();
    await settled();
    expect(await screen.findByText(strings.botsEmptyTitle!)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: strings.newBot! }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(strings.createTitle!)).toBeInTheDocument();
    // One managed Project is on offer and it is preselected, so the submit is reachable straight away.
    expect(within(dialog).getByRole('button', { name: strings.createSubmit! })).toBeEnabled();
  });

  it('grants a new chatbot account this plugin and the tools its turns need, keeping its other grants', async () => {
    use(http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json(botsBody([]))));
    renderPage();
    await settled();
    fireEvent.click(screen.getByRole('button', { name: strings.newBot! }));
    const dialog = await screen.findByRole('dialog');
    // A fresh account: the dialog creates it rather than reusing one of the candidates.
    fireEvent.change(within(dialog).getByRole('combobox', { name: strings.createModeLabel! }), { target: { value: 'new' } });
    fireEvent.change(within(dialog).getAllByRole('textbox')[0]!, { target: { value: 'novy-bot' } });
    fireEvent.click(within(dialog).getByRole('button', { name: strings.createSubmit! }));

    await waitFor(() => expect(asked.userPatch).toHaveLength(1));
    // The patch replaces each list wholesale, so it carries what the account already had plus this plugin
    // and the tool the plugin's own admin route named — an account that reaches other plugins must not lose
    // them by becoming a chatbot.
    expect(asked.userPatch[0]).toEqual({
      granted_plugins: ['stats', 'chatbot'],
      allowed_tools: ['MemorySearch', REQUIRED_TOOL],
    });
  });
});

describe('one chatbot\'s conversations', () => {
  it('lists them, opens one, and shows what was said', async () => {
    renderPage();
    await openTab(strings.workspaceTabConversations!);
    expect(await screen.findByText('visitor-ured')).toBeInTheDocument();
    // The request named the chatbot the register had selected.
    expect(asked.conversations).toEqual([bot.chatbotUserId]);

    fireEvent.click(screen.getByRole('button', { name: strings.openConversation!.replace('{visitor}', 'visitor-ured') }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Dobrý den, kdy máte otevřeno?')).toBeInTheDocument();
    expect(within(dialog).getByText('V pondělí od osmi.')).toBeInTheDocument();
    // A turn that produced no answer says so rather than rendering an empty answer.
    expect(within(dialog).getByText(strings.transcriptNoReply!)).toBeInTheDocument();
    expect(asked.conversation).toEqual(['visitor-ured']);
  });

  it('never shows another chatbot\'s conversations under this chatbot\'s heading', async () => {
    renderPage();
    await settled();
    fireEvent.click(screen.getByRole('button', { name: strings.openBot!.replace('{name}', 'Gymnázium') }));
    await openTab(strings.workspaceTabConversations!);

    expect(await screen.findByText('visitor-skola')).toBeInTheDocument();
    expect(screen.queryByText('visitor-ured')).not.toBeInTheDocument();
    expect(asked.conversations).toEqual([second.chatbotUserId]);
  });

  it('says the register is empty instead of rendering an empty table', async () => {
    use(http.get('/api/plugins/chatbot/api/conversations', () => HttpResponse.json({ conversations: [], total: 0, limit: 25, offset: 0 })));
    renderPage();
    await openTab(strings.workspaceTabConversations!);
    expect(await screen.findByText(strings.conversationsEmptyTitle!)).toBeInTheDocument();
  });

  it('reports a failed read with the retry the host owns', async () => {
    use(http.get('/api/plugins/chatbot/api/conversations', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    renderPage();
    await openTab(strings.workspaceTabConversations!);
    expect(await screen.findByText(strings.conversationsLoadError!, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('one chatbot\'s statistics', () => {
  it('charts its own days and reads its own account\'s spend', async () => {
    renderPage();
    await openTab(strings.workspaceTabStatistics!);

    // The chart is the HOST's, labelled from this plugin's copy, and it carries the counters the plugin
    // admitted rather than anything derived from messages.
    await waitFor(() => expect(screen.getAllByText(strings.chartTitle!).length).toBeGreaterThan(0));
    expect(screen.getAllByText(strings.chartTurns!).length).toBeGreaterThan(0);
    expect(screen.getAllByText(strings.chartErrors!).length).toBeGreaterThan(0);
    expect(asked.stats).toEqual([bot.chatbotUserId]);

    // The spend rows come from the instance's rollup for this account and are labelled with it.
    expect(await screen.findByText(strings.spendTitle!)).toBeInTheDocument();
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    // The rollup's own start day is stated, in the reader's locale rather than as a bare day key.
    const trackingDay = new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date('2026-09-01T00:00:00.000Z'));
    expect(screen.getByText(strings.spendTrackingSince!.replace('{day}', trackingDay))).toBeInTheDocument();
    // The spend read asks for the SAME window as the counters.
    const [from, to] = asked.usage[0]!.split('|');
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(new Date(from!).getTime()).toBeLessThan(new Date(to!).getTime());
  });

  it('scopes the counters and the spend to the chatbot the reader selected', async () => {
    renderPage();
    await settled();
    fireEvent.click(screen.getByRole('button', { name: strings.openBot!.replace('{name}', 'Gymnázium') }));
    await openTab(strings.workspaceTabStatistics!);

    expect(await screen.findByText(strings.totalsTitle!)).toBeInTheDocument();
    expect(asked.stats).toEqual([second.chatbotUserId]);
    // The second chatbot has no queue waits and no spend row of its own: both say so rather than showing a
    // confident zero.
    expect(screen.getByText(strings.spendEmptyTitle!)).toBeInTheDocument();
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
    renderPage();
    await openTab(strings.workspaceTabStatistics!);
    expect(await screen.findByText(strings.statsEmptyTitle!)).toBeInTheDocument();
  });

  it('reports a failed counters read with the retry the host owns', async () => {
    use(http.get('/api/plugins/chatbot/api/stats', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    renderPage();
    await openTab(strings.workspaceTabStatistics!);
    expect(await screen.findByText(strings.statsLoadError!, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('page-action rules', () => {
  it('says on the page that there is no rule, and does not open the author for it', async () => {
    renderPage();
    await settled();
    await findBots();
    // The section states the policy as it stands and keeps the six controls that write one behind its own
    // button: no permanently open form on a page that carries seven other sections.
    expect(screen.getByText(strings.rulesEmpty!)).toBeInTheDocument();
    expect(screen.getAllByText(strings.rulesEmptyHint!).length).toBe(1);
    expect(screen.queryByRole('combobox', { name: strings.ruleOriginLabel! })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: strings.ruleAdd! })).not.toBeInTheDocument();
  });

  it('adds a rule and sends the whole policy with the save', async () => {
    renderPage();
    await settled();
    await findBots();

    const dialog = await manage(strings.securityTitle!);
    fireEvent.change(within(dialog).getByRole('combobox', { name: strings.ruleOriginLabel! }), { target: { value: SITE } });
    // The field opens holding "/", so this is what a reader typing their own path into it really sends.
    fireEvent.change(within(dialog).getByLabelText(strings.rulePathLabel!, { selector: 'input' }), { target: { value: '//kontakt' } });
    fireEvent.click(within(dialog).getByRole('button', { name: strings.ruleAdd! }));
    await waitFor(() => expect(within(dialog).getByText(`${SITE}/kontakt`)).toBeInTheDocument());
    expect(within(dialog).getByText(strings.ruleLimit!.replace('{count}', '1'))).toBeInTheDocument();

    // Closed again, the summary names the place the rule governs, so the page still says what was configured.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByText(strings.rulesCount!.replace('{n}', '1'))).toBeInTheDocument());
    expect(screen.getByText(`${SITE}/kontakt`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: strings.saveAction! }));
    // The rule travels with the rest of the editable state, and it is the one the editor showed.
    await waitFor(() => expect(asked.botPatch).toHaveLength(1));
    expect(asked.botPatch[0]!.actionRules).toEqual([
      { origin: SITE, pathPrefix: '/kontakt', action: 'read', requiresConfirmation: false, maxPerTurn: 1 },
    ]);
  });

  it('refuses the same rule twice and a limit beyond the per-turn ceiling', async () => {
    renderPage();
    await settled();
    await findBots();
    const dialog = await manage(strings.securityTitle!);
    fireEvent.change(within(dialog).getByRole('combobox', { name: strings.ruleOriginLabel! }), { target: { value: SITE } });
    fireEvent.click(within(dialog).getByRole('button', { name: strings.ruleAdd! }));
    await waitFor(() => expect(within(dialog).getByText(`${SITE}/`)).toBeInTheDocument());

    // The same domain, path and action are already listed.
    expect(within(dialog).getByText(strings.ruleDuplicate!)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: strings.ruleAdd! })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(strings.rulePathLabel!, { selector: 'input' }), { target: { value: '/kontakt' } });
    const limit = within(dialog).getByRole('spinbutton');
    fireEvent.change(limit, { target: { value: '21' } });
    expect(within(dialog).getByText(strings.ruleLimitInvalid!.replace('{max}', '20'))).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: strings.ruleAdd! })).toBeDisabled();
    fireEvent.change(limit, { target: { value: '3' } });
    expect(within(dialog).getByRole('button', { name: strings.ruleAdd! })).toBeEnabled();
  });

  it('offers the visitor\'s confirmation only where the protocol can carry one', async () => {
    renderPage();
    await settled();
    await findBots();
    const dialog = await manage(strings.securityTitle!);
    // `read` cannot be confirmed, so the control is not offered at all.
    expect(within(dialog).queryByText(strings.ruleConfirmationLabel!)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('combobox', { name: strings.ruleActionLabel! }), { target: { value: 'request_submit' } });
    expect(within(dialog).getByText(strings.ruleConfirmationLabel!)).toBeInTheDocument();
  });

  it('requires a domain, a path and a limit the server would accept before offering to add', async () => {
    renderPage();
    await settled();
    await findBots();
    const dialog = await manage(strings.securityTitle!);
    // Nothing is chosen yet, so the domain is asked for rather than silently defaulted.
    expect(within(dialog).getByText(strings.ruleOriginRequired!)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('combobox', { name: strings.ruleOriginLabel! }), { target: { value: SITE } });
    fireEvent.change(within(dialog).getByLabelText(strings.rulePathLabel!, { selector: 'input' }), { target: { value: 'kontakt' } });
    expect(within(dialog).getByText(strings.rulePathInvalid!)).toBeInTheDocument();
  });
});

describe('the account\'s tools', () => {
  it('reports what the account can reach and warns about a needed tool it cannot', async () => {
    renderPage();
    await settled();
    await findBots();
    expect(await screen.findByText(strings.toolsTitle!)).toBeInTheDocument();
    // The page states how much of the account's access is usable; the tools themselves are the list behind
    // the summary, exactly as the Users screen states the same account.
    expect(await screen.findByText(strings.toolsCount!.replace('{n}', '2').replace('{total}', '2'))).toBeInTheDocument();
    expect(screen.queryByText(strings.toolState_allowed!)).not.toBeInTheDocument();
    // Nothing is missing for the working chatbot, so no warning is shown.
    expect(screen.queryByText(strings.toolsMissing!, { exact: false })).not.toBeInTheDocument();

    // Opened, it names every tool and what state it is in — and offers nothing to change, because the
    // grants belong to the Users screen and a checkbox here would ignore the click.
    const dialog = await manage(strings.toolsTitle!);
    expect(within(dialog).getByText(REQUIRED_TOOL)).toBeInTheDocument();
    expect(within(dialog).getByText(strings.toolState_allowed!)).toBeInTheDocument();
    expect(within(dialog).getByText(strings.toolState_inherited!)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('says which needed tool is missing rather than letting the chatbot act on nothing', async () => {
    renderPage();
    await settled();
    fireEvent.click(screen.getByRole('button', { name: strings.openBot!.replace('{name}', 'Gymnázium') }));
    await waitFor(() => expect(screen.getByText(strings.toolsMissing!.replace('{names}', REQUIRED_TOOL))).toBeInTheDocument());
  });

  it('hands the administrator over to the screen that owns the grants', async () => {
    const runtime = (window as unknown as { ElowenUiRuntime: { navigate(href: string): void } }).ElowenUiRuntime;
    const original = runtime.navigate;
    const visited: string[] = [];
    runtime.navigate = (href: string) => visited.push(href);
    try {
      renderPage();
      await settled();
      await findBots();
      fireEvent.click(await screen.findByRole('button', { name: strings.toolsManage! }));
      // The HOST's own navigation, with the path this bundle means — never a window.location write.
      expect(visited).toEqual(['/users']);
    } finally {
      runtime.navigate = original;
    }
  });
});

describe('the pure helpers the detail pane reports with', () => {
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
