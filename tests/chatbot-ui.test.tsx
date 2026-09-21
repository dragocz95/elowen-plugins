import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import manifest from '../plugins/chatbot/elowen-plugin.json' with { type: 'json' };
import { ChatbotWorkspace } from '../plugins/chatbot/web-src/ChatbotWorkspace';
import { blockerText, limitDraftOf, originHint, readLimitDraft } from '../plugins/chatbot/web-src/BotDetail';
import { LIMIT_FIELDS, MANDATORY_LIMITS, type LimitValues } from '../plugins/chatbot/src/limits';
import { HttpResponse, close, http, listen, resetHandlers, setDefaults, use } from './ui/http';
import { createWrapper, ToastProvider } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';

/** The admin workspace, rendered the way it renders in production: inside the host's own runtime fixture,
 *  reaching EVERY component and every string through `window.ElowenUiRuntime`. What this cannot prove is
 *  layout — that is a browser's job and is reported as unverified — but it does prove that the page mounts
 *  against the published component contract, reads only strings its manifest declares, and renders its
 *  loading, error, empty and populated states with the actions each one owes the reader. */

ensurePluginUiRuntime();

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
const SITE = 'https://www.example.cz';

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

const botsBody = (bots = [bot, broken]) => ({
  bots,
  candidates: [{ id: 14, username: 'novy-bot', type: 'chatbot' }],
  projects: [{ id: 4, slug: 'ured' }],
});

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'chatbot', url: '/plugins/chatbot/web/index.js', apiVersion: 12, nav: [], settings: [], strings }])),
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'filip', is_admin: true } })),
  http.get('/api/brain/models', () => HttpResponse.json([])),
  http.get('/api/plugins/chatbot/api/bots', () => HttpResponse.json(botsBody())),
  http.patch('/api/plugins/chatbot/api/bots', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({
      bot: {
        ...bot,
        chatbotUserId: Number(body.chatbotUserId),
        displayName: String(body.displayName ?? ''),
        prompt: String(body.prompt ?? ''),
        origins: Array.isArray(body.origins) ? body.origins as string[] : bot.origins,
        limits: (body.limits ?? bot.limits) as LimitValues,
        missingLimits: LIMIT_FIELDS.filter((field) => field in MANDATORY_LIMITS && (body.limits as LimitValues)[field] === null),
        status: body.action === 'disable' ? 'disabled' : body.action === 'enable' ? 'enabled' : bot.status,
        updatedAt: '2026-09-21T17:00:00.000Z',
      },
    });
  }),
);

beforeAll(() => listen());
afterEach(() => { cleanup(); resetHandlers(); });
afterAll(() => close());

function renderPage() {
  const { wrapper: Wrapper } = createWrapper();
  return render(<Wrapper><ToastProvider><ChatbotWorkspace /></ToastProvider></Wrapper>);
}

/** Wait until the page's own copy has arrived. The plugin's strings come from a listing query, so the
 *  first paint renders every label empty and React then REUSES those nodes with text — a control queried
 *  before that lands is a node whose events reach nothing. Awaiting the eyebrow (a string only the listing
 *  can supply) is what makes a test that touches a control honest. */
const settled = () => screen.findByText(strings.workspaceEyebrow!);

/** The register and the detail pane both name the selected chatbot, so the page shows one chatbot twice
 *  and a plain `findByText` would refuse to choose between them. */
const findBots = () => screen.findAllByText('Městský úřad');

describe('the chatbot workspace', () => {
  it('renders the register, the hero figures and one detail pane through the host components', async () => {
    renderPage();
    await settled();
    expect((await findBots()).length).toBeGreaterThan(1);
    expect(screen.getByText(bot.publicId)).toBeInTheDocument();
    expect(screen.getAllByText(`@${bot.account.username}`).length).toBeGreaterThan(0);
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

  it('refuses to add a domain the server would reject, and says why', async () => {
    renderPage();
    await settled();
    await findBots();
    const field = screen.getByPlaceholderText(strings.originsPlaceholder!);
    fireEvent.change(field, { target: { value: 'www.example.cz' } });
    expect(screen.getByText(strings.originsInvalid!)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: SITE } });
    expect(screen.getByText(strings.originsDuplicate!)).toBeInTheDocument();
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
});
