import type { PluginUiRegistration } from 'elowen-plugin-ui-kit';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { http, HttpResponse, listen, use, setDefaults, resetHandlers, close } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { JobsSettings } from '../plugins/cronjob/web-src/JobsSettings';
import manifest from '../plugins/cronjob/elowen-plugin.json' with { type: 'json' };
import { ToastProvider, createWrapper } from './ui/hostHooks';
import type { BrainModelOption, CronJob, NotificationDestinationOption } from '../plugins/cronjob/web-src/runtime';
import {
  parseActiveHours, parseBuilderSchedule, renderActiveHours, renderBuilderSchedule,
} from '../plugins/cronjob/web-src/scheduleBuilder';

// The moved editor resolves everything through window.ElowenUiRuntime — install the REAL runtime,
// so this exercises the production contract the bundle runs against.
ensurePluginUiRuntime();

// View copy is served per-plugin by /plugins/ui; serving the REAL manifest en fallback keeps the
// assertions in lockstep with what production users see.
const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
const manifestApiVersion = (manifest as { web: { requiresApiVersion: number } }).web.requiresApiVersion;

type BundleRegistration = Pick<PluginUiRegistration, 'requiresApiVersion' | 'settings' | 'ownsPageFrame'>;

/** Load the bundle entry the way the host does — it registers itself on import — and hand back what it
 *  registered. The entry is what carries `ownsPageFrame`, so nothing short of importing it proves the
 *  declaration is really there. */
const loadBundleRegistration = async (): Promise<BundleRegistration> => {
  let captured: BundleRegistration | undefined;
  (window as unknown as { __elowenRegisterPluginUi?: (plugin: string, registration: BundleRegistration) => void })
    .__elowenRegisterPluginUi = (_plugin, registration) => { captured = registration; };
  await import('../plugins/cronjob/web-src/index');
  if (!captured) throw new Error('the cronjob bundle registered no UI');
  return captured;
};

/** A row is opened through its own control now — one tab stop with a short accessible name — not by
 *  clicking whichever text happens to sit in the row. */
const openRow = async (name: string) =>
  fireEvent.click(await screen.findByRole('button', { name: strings.openJob.replace('{name}', name) }));

/** The enable switch on a collapsed row, named after the job it belongs to. The editor's own switch
 *  carries the same name inside the drawer, so this deliberately queries the register only. */
const rowSwitch = (name: string) =>
  within(screen.getByRole('table')).getByRole('switch', { name: `${name}: ${strings.enabled}` });

/** File the open job under a conversation, through its own summary — named apart from the channel and
 *  model summaries beside it. A new recurring job cannot be saved before this happens. */
const fileUnder = async (title: string) => {
  fireEvent.click(await screen.findByRole('button', { name: strings.conversationManage }));
  fireEvent.click(await screen.findByRole('button', { name: title }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
};


const chooseExecution = async () => {
  fireEvent.click(await screen.findByRole('button', { name: strings.executionProject }));
  fireEvent.click(await screen.findByRole('button', { name: 'Scheduled work' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
};

const job = (over: Partial<CronJob>): CronJob =>
  ({ id: 'j1', name: 'digest', schedule: 'daily 06:00', prompt: 'do it', enabled: true, createdAt: '2026-01-01T00:00:00Z', ...over });

const DESTINATIONS: NotificationDestinationOption[] = [
  { value: 'destination:discord:100', id: '100', platform: 'discord', kind: 'channel', label: '#general', group: 'Discord' },
  { value: 'destination:discord:200', id: '200', platform: 'discord', kind: 'thread', label: 'bug-hunt', group: 'Discord · general' },
  { value: 'destination:msteams:a%3Afilip', id: 'a:filip', platform: 'msteams', kind: 'person', label: 'Filip', group: 'Microsoft Teams · Direct chats' },
];
const MODELS: BrainModelOption[] = [
  { provider: 'anthropic', providerLabel: 'Anthropic', model: 'claude-sonnet-4-5', exec: 'brain', source: 'api-key', contextWindow: 200000, contextWindowSet: false },
];

/** What the plugin's own picker endpoint answers with — metadata only, never a message and never the
 *  server-side immutable key. */
const CONVERSATIONS = [
  { id: 'conv-a', title: 'Morning planning', ownerUserId: 7, platform: null, direct: false, updatedAt: '2026-09-01T08:00:00.000Z' },
  { id: 'conv-b', title: 'CRON JOBS', ownerUserId: 7, platform: null, direct: false, updatedAt: '2026-09-02T08:00:00.000Z' },
  { id: 'conv-x', title: 'Amy planning', ownerUserId: 9, platform: null, direct: false, updatedAt: '2026-09-02T09:00:00.000Z' },
];

/** The picker route, recording the SCOPE each request asked for: a personal job may only be filed under
 *  its own account's conversations, and the daemon decides that from the scope the editor asks in. */
const conversationRoute = (asked: string[]) =>
  http.get('/api/plugins/cronjob/api/conversations', ({ url }) => {
    asked.push(url.search);
    const owner = url.searchParams.get('owner');
    const conversations = url.searchParams.get('scope') === 'instance'
      ? CONVERSATIONS
      : CONVERSATIONS.filter((c) => c.ownerUserId === Number(owner ?? 7));
    return HttpResponse.json({ status: 'available', conversations });
  });

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'cronjob', url: '/plugins/cronjob/web/index.js', apiVersion: 1, nav: [], settings: [], strings }])),
  // The owner column is the admin's view of who scheduled what, so the page reads the signed-in account.
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 7, username: 'filip', is_admin: true } })),
  // The core repo served these from its app-wide msw setup; here the file owns its whole surface.
  // Individual tests still shadow them — the 503 destinations case is the point of that.
  http.get('/api/plugins/destinations', () => HttpResponse.json(DESTINATIONS)),
  http.get('/api/brain/models', () => HttpResponse.json(MODELS)),
  http.get('/api/projects', () => HttpResponse.json([{ id: 17, slug: 'Scheduled work', executionKind: 'host' }, { id: 18, slug: 'Shared managed work', executionKind: 'managed' }])),
);
beforeAll(() => listen()); afterEach(() => { cleanup(); resetHandlers(); }); afterAll(() => close());

async function mountWith(jobs: CronJob[]) {
  use(
    http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json(jobs)),
    http.get('/api/plugins/destinations', () => HttpResponse.json(DESTINATIONS)),
    http.get('/api/brain/models', () => HttpResponse.json(MODELS)),
    http.put('/api/plugins/cronjob/jobs/:id', () => HttpResponse.json({ ok: true })),
    http.post('/api/plugins/cronjob/jobs/:id/run', () => HttpResponse.json({ ok: true }, { status: 202 })),
  );
  const { wrapper: Wrapper } = createWrapper();
  render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
  // Open the job's drawer so the channel/model fields render.
  await openRow('digest');
}

describe('cronjob schedule builder', () => {
  it.each(['every 15m', 'every 2h', 'daily 07:30', 'weekly sun 20:00'])(
    'parses and renders %s through the scheduler grammar',
    (schedule) => {
      const parsed = parseBuilderSchedule(schedule);
      expect(parsed).not.toBeNull();
      expect(renderBuilderSchedule(parsed!)).toBe(schedule);
    },
  );

  it('accepts only whole-hour active windows within 0-23', () => {
    expect(parseActiveHours('0-23')).toEqual({ start: 0, end: 23 });
    expect(parseActiveHours('22-5')).toEqual({ start: 22, end: 5 });
    expect(parseActiveHours('24-5')).toBeNull();
    expect(parseActiveHours('5:30-21')).toBeNull();
    expect(renderActiveHours(0, 23)).toBe('0-23');
    expect(renderActiveHours(-1, 23)).toBeNull();
    expect(renderActiveHours(0, 24)).toBeNull();
  });
});

describe('cronjob JobsSettings — status indicator', () => {
  // The row's state is a control now, not a coloured dot beside one: a switch and a read-only copy of
  // its own value are two truths waiting to disagree. An absent `enabled` still reads as active.
  it('states active and paused on the row itself, without relying on colour', async () => {
    use(http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([
      job({ id: 'implicit', name: 'implicit active', enabled: undefined }),
      job({ id: 'paused', name: 'paused job', enabled: false }),
    ])));
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);

    await screen.findByText('implicit active');
    expect(rowSwitch('implicit active')).toHaveAttribute('aria-checked', 'true');
    expect(rowSwitch('paused job')).toHaveAttribute('aria-checked', 'false');
    // The compact fold drops the switch's track, so the state also travels inside the name cell — as the
    // badge a sighted reader sees and as the text a screen reader hears with the row.
    expect(screen.getAllByText(strings.paused)).toHaveLength(2);
  });
});

describe('cronjob JobsSettings — row enable switch', () => {
  it('pauses a job straight from the row through the job update route', async () => {
    const writes: Record<string, unknown>[] = [];
    use(
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([job({ revision: 4 })])),
      http.put('/api/plugins/cronjob/jobs/:id', async ({ request }) => {
        writes.push(await request.json() as Record<string, unknown>);
        return HttpResponse.json({ ok: true });
      }),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
    await screen.findByText('digest');

    fireEvent.click(rowSwitch('digest'));
    // Optimistic: the switch answers the click rather than the round-trip.
    expect(rowSwitch('digest')).toHaveAttribute('aria-checked', 'false');
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ id: 'j1', enabled: false, expectedRevision: 4 });
    // The daemon's own projections are never handed back to it as if they were client state.
    expect(writes[0]).not.toHaveProperty('runLocation');
    expect(writes[0]).not.toHaveProperty('conversation');
  });

  it('puts the job back as it was, with the daemon\'s reason, when the write is refused', async () => {
    use(
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([job({})])),
      http.put('/api/plugins/cronjob/jobs/:id', () => HttpResponse.json({ error: 'job changed on the server' }, { status: 409 })),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
    await screen.findByText('digest');

    fireEvent.click(rowSwitch('digest'));
    await waitFor(() => expect(rowSwitch('digest')).toHaveAttribute('aria-checked', 'true'));
    expect(await screen.findByText(`${strings.saveError} — job changed on the server`)).toBeInTheDocument();
  });

  // The daemon refuses a foreign job to a non-admin, so the row shows the state and offers no write.
  it('does not offer a non-admin the switch on a job that is not theirs', async () => {
    use(
      http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 9, username: 'amy', is_admin: false } })),
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([
        job({ id: 'mine', name: 'my digest', ownerUserId: 9 }),
        job({ id: 'theirs', name: 'their digest', ownerUserId: 7 }),
      ])),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
    await screen.findByText('their digest');

    expect(rowSwitch('my digest')).toBeEnabled();
    expect(rowSwitch('their digest')).toBeDisabled();
  });
});

describe('cronjob JobsSettings — row owner and conversation', () => {
  // Both facts used to live only in the editor or in a column an admin alone saw, so a reader of the
  // list could not tell whose job it was or where its runs land without opening it.
  it('names the owner, the conversation it is filed under and where it runs', async () => {
    use(http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([
      job({
        id: 'owned', name: 'her digest', ownerUserId: 9,
        owner: { id: 9, username: 'amy', name: 'Amy Adams', avatar: '9.png' },
        conversationSessionId: 'conv-x',
        conversation: { id: 'conv-x', title: 'Amy planning', ownerUserId: 9, platform: null, direct: false },
        runLocation: { kind: 'dedicated', sessionId: 'brain-9-job-owned' },
      }),
      job({
        id: 'shared', name: 'instance digest',
        conversationSessionId: 'conv-a',
        conversation: { id: 'conv-a', title: 'Morning planning', ownerUserId: 7, platform: null, direct: false },
        runLocation: { kind: 'channel', channelId: 'job-shared' },
      }),
    ])));
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
    await screen.findByText('her digest');

    expect(screen.getByText('Amy Adams')).toBeInTheDocument();
    expect(screen.getByText('#9')).toBeInTheDocument();
    // An instance job belongs to nobody in particular, and says so rather than showing an empty cell.
    expect(screen.getByText(strings.ownerInstance)).toBeInTheDocument();
    // Filed HERE, running THERE: two different facts, both on the collapsed row.
    expect(screen.getByText(`Amy planning · ${strings.runInOwnConversation}`)).toBeInTheDocument();
    expect(screen.getByText(`Morning planning · ${strings.runInChannel}`)).toBeInTheDocument();
  });

  it('says a filing is unassigned, gone or unreadable rather than showing nothing', async () => {
    use(http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([
      job({ id: 'legacy', name: 'legacy job', runLocation: { kind: 'channel', channelId: 'job-legacy' } }),
      job({ id: 'gone', name: 'gone filing', conversationSessionId: 'conv-dead', conversation: null, runLocation: { kind: 'channel', channelId: 'job-gone' } }),
      job({
        id: 'unread', name: 'unreadable filing', conversationSessionId: 'conv-a', conversation: null,
        conversationUnresolved: true, runLocation: { kind: 'channel', channelId: 'job-unread' },
      }),
    ])));
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
    await screen.findByText('legacy job');

    expect(screen.getByText(`${strings.conversationUnassigned} · ${strings.runInChannel}`)).toBeInTheDocument();
    expect(screen.getByText(`${strings.conversationUnavailable} · ${strings.runInChannel}`)).toBeInTheDocument();
    // "Could not be read" is not "deleted", and the row must not tell the reader it was.
    expect(screen.getByText(`${strings.conversationUnknown} · ${strings.runInChannel}`)).toBeInTheDocument();
  });

  it('leaves the owner out of a non-admin\'s rows, where it is implied', async () => {
    use(
      http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 9, username: 'amy', is_admin: false } })),
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([
        job({
          id: 'mine', name: 'my digest', ownerUserId: 9,
          owner: { id: 9, username: 'amy', name: 'Amy Adams', avatar: '9.png' },
          runLocation: { kind: 'dedicated', sessionId: 'brain-9-job-mine' },
        }),
      ])),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
    await screen.findByText('my digest');

    expect(screen.queryByText('Amy Adams')).toBeNull();
    expect(screen.getByText(`${strings.conversationUnassigned} · ${strings.runInOwnConversation}`)).toBeInTheDocument();
  });
});

describe('cronjob JobsSettings — manual run', () => {
  it('starts the persisted recurring job from the shared Play button', async () => {
    let runId: string | null = null;
    use(
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([job({})])),
      http.post('/api/plugins/cronjob/jobs/:id/run', ({ params }) => {
        runId = String(params.id);
        return HttpResponse.json({ ok: true }, { status: 202 });
      }),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
    await openRow('digest');

    fireEvent.click(screen.getByRole('button', { name: strings.runNow }));
    await waitFor(() => expect(runId).toBe('j1'));
    expect(await screen.findByText(strings.runQueued)).toBeInTheDocument();
  });

  it('does not autosave scheduler state refreshed after a manual run', async () => {
    let serverJob = job({ revision: 4, lastResult: 'previous result' });
    const writes: unknown[] = [];
    use(
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([serverJob])),
      http.post('/api/plugins/cronjob/jobs/:id/run', () => {
        serverJob = { ...serverJob, revision: 5, lastRun: '2026-09-03T09:04:47.891Z', lastResult: 'manual run started' };
        return HttpResponse.json({ ok: true }, { status: 202 });
      }),
      http.put('/api/plugins/cronjob/jobs/:id', async ({ request }) => {
        writes.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
    await openRow('digest');

    fireEvent.click(screen.getByRole('button', { name: strings.runNow }));
    expect(await screen.findByText('manual run started', {}, { timeout: 2000 })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(writes).toEqual([]);
  });

  it('does not offer a manual run for a one-shot wake-up', async () => {
    await mountWith([job({ runAt: '2026-09-01T12:00:00.000Z' })]);
    expect(screen.getByRole('button', { name: strings.runNow })).toBeDisabled();
  });
});

describe('cronjob JobsSettings — error state', () => {
  // An admin is the one person who sees more than his own jobs, so he gets the owner column and the scope
  // filter; everyone else's list is already only theirs and the column would say the same thing on every row.
  it('shows the admin who owns each job and filters by scope', async () => {
    use(http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([
      job({ id: 'shared', name: 'instance digest' }),
      job({ id: 'mine', name: 'my digest', ownerUserId: 7, owner: { id: 7, username: 'filip', name: 'Filip Džudža', avatar: '7.png' } }),
      job({ id: 'hers', name: 'her digest', ownerUserId: 9, owner: { id: 9, username: 'amy', name: 'Amy Adams', avatar: '9.png' } }),
    ])));
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
    await screen.findByText('instance digest');
    expect(screen.getAllByText(strings.ownerInstance).length).toBeGreaterThan(0);
    expect(screen.getByText('Filip Džudža')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(screen.getByText('Amy Adams')).toBeInTheDocument();
    expect(screen.getByText('#9')).toBeInTheDocument();
    expect(screen.getByTitle('Amy Adams (#9)')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('page-filters-trigger'));
    const filters = screen.getByRole('dialog', { name: 'Filters' });
    fireEvent.click(within(filters).getByRole('radio', { name: strings.filterInstance }));
    expect(screen.getByTestId('page-filter-chips')).toHaveTextContent(`${strings.ownerColumn}: ${strings.filterInstance}`);
    await waitFor(() => expect(screen.queryByText('my digest')).toBeNull());
    expect(screen.getByText('instance digest')).toBeInTheDocument();
    expect(screen.queryByText('her digest')).toBeNull();
  });

  // Handing a job over is the admin's alone, and only on a job that is instance-wide or already his:
  // on somebody else's, "Mine" would read as a label while acting as taking it from them.
  it('lets the admin take an instance job, but not someone else\'s', async () => {
    let saved: Record<string, unknown> | undefined;
    use(
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([
        job({ id: 'shared', name: 'instance digest' }),
        job({ id: 'hers', name: 'her digest', ownerUserId: 9 }),
      ])),
      http.put('/api/plugins/cronjob/jobs/:id', async ({ request }) => {
        saved = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);

    // Scoped to the DRAWER: the page-level owner filter lives behind the condensed Filters trigger,
    // while this radiogroup belongs to the selected job itself.
    const ownerSwitch = () => within(screen.getByRole('dialog')).queryByRole('radiogroup', { name: strings.ownerColumn });

    await openRow('her digest');
    await screen.findByText(strings.prompt);
    expect(ownerSwitch()).toBeNull();

    await openRow('instance digest');
    await screen.findByText(strings.prompt);
    fireEvent.click(within(ownerSwitch()!).getByRole('radio', { name: strings.ownerMine }));

    // It travels as the signed-in account; the daemon then re-derives where the job reports.
    await waitFor(() => expect(saved?.ownerUserId).toBe(7));
  });

  // The server refuses a shell guard and a destination channel on an owned job, so the form must not
  // offer either: a field whose save always comes back 400 is worse than no field.
  it('offers a non-admin none of the fields only an instance job may carry', async () => {
    use(
      http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 9, username: 'amy', is_admin: false } })),
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([job({ id: 'mine', name: 'my digest', ownerUserId: 9 })])),
      http.get('/api/plugins/destinations', () => HttpResponse.json(DESTINATIONS)),
      http.get('/api/brain/models', () => HttpResponse.json(MODELS)),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
    await openRow('my digest');

    await screen.findByText(strings.prompt);
    expect(screen.queryByText(strings.check)).toBeNull();
    expect(screen.queryByText(strings.channel)).toBeNull();
    // The owner column belongs to the admin too — hers is the only list she can see.
    expect(screen.queryByText(strings.ownerColumn)).toBeNull();
    // The model picker is hers to set, so it stays.
    expect(screen.getAllByText(strings.model).length).toBeGreaterThan(0);
  });

  it('shows a retryable error instead of an infinite skeleton', async () => {
    let attempts = 0;
    use(
      http.get('/api/plugins/cronjob/jobs', () => {
        attempts += 1;
        return attempts === 1 ? HttpResponse.json({ error: 'boom' }, { status: 500 }) : HttpResponse.json([job({})]);
      }),
      http.get('/api/plugins/destinations', () => HttpResponse.json(DESTINATIONS)),
      http.get('/api/brain/models', () => HttpResponse.json(MODELS)),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('digest')).toBeInTheDocument();
  });

  // A disabled provider simply contributes no rows to the core aggregate. The editor must keep a saved
  // opaque destination visible instead of treating the empty catalog as a page-level failure.
  it('stays usable when the selected platform provider is disabled', async () => {
    use(
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([job({ notifyChannelId: 'destination:discord:100' })])),
      http.get('/api/plugins/destinations', () => HttpResponse.json([])),
      http.get('/api/brain/models', () => HttpResponse.json(MODELS)),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);

    await openRow('digest');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull(); // no error state for the section
    // The configured destination is still shown — as its raw id, since nothing can resolve the name.
    expect(screen.getAllByText('destination:discord:100').length).toBeGreaterThan(0);
    // And the picker still opens, with the guild default and that id pinned, so the job stays editable.
    fireEvent.click(screen.getAllByRole('button', { name: 'Manage' })[0]!);
    expect(await screen.findByRole('button', { name: '(default)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'destination:discord:100' })).toHaveAttribute('aria-pressed', 'true');
  });
});

/** Open the named job's drawer, hit its Delete, then the dialog's confirm (both are labelled
 *  "Delete job"). Deleting lives in the drawer, so the row it belongs to has to be opened first. */
const deleteJob = async (name: string) => {
  await openRow(name);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Delete job' }))[0]!);
  const buttons = await screen.findAllByRole('button', { name: 'Delete job' });
  fireEvent.click(buttons[buttons.length - 1]!);
};

/** The two SelectionSummary Manage buttons of an expanded job: [channel, model]. */
const manageButtons = () => screen.getAllByRole('button', { name: 'Manage' });

describe('cronjob JobsSettings destination channel', () => {
  it('picking a channel in the single-select modal replaces the destination', async () => {
    await mountWith([job({ notifyChannelId: 'destination:discord:100' })]);
    fireEvent.click(manageButtons()[0]);
    expect(await screen.findByRole('heading', { name: 'Discord' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Discord · general' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Microsoft Teams · Direct chats' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '(default)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '#general' })).toHaveAttribute('aria-pressed', 'true');
    // Single-select: picking the Teams target replaces the Discord pick.
    fireEvent.click(screen.getByRole('button', { name: 'Filip' }));
    expect(screen.getByRole('button', { name: '#general' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    // Modal closed; the summary chip (and the row-header badge) now show the new destination.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull());
    expect(screen.getAllByText('Filip').length).toBeGreaterThan(0);
  });

  it('a saved channel id the guild no longer lists stays visible and selected', async () => {
    await mountWith([job({ notifyChannelId: '999' })]);
    // The summary chip falls back to the raw id (as does the row-header badge).
    expect(screen.getAllByText('999').length).toBeGreaterThan(0);
    fireEvent.click(manageButtons()[0]);
    expect(await screen.findByRole('button', { name: '999' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('picking the pinned default clears the destination', async () => {
    await mountWith([job({ notifyChannelId: 'destination:discord:100' })]);
    fireEvent.click(manageButtons()[0]);
    fireEvent.click(await screen.findByRole('button', { name: '(default)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull());
    // No channel chip anymore — the summary shows the "—" default marker.
    expect(within(screen.getByRole('dialog', { name: 'digest' })).getByText('—')).toBeInTheDocument();
  });
});

/** jobs.json is shared: the scheduler stamps runs into it and the brain's CronAdd tool writes it. A page
 *  that sent the whole list back would delete every job it had not seen — which is exactly how jobs went
 *  missing. So a write must name ONE job, and the rest of the list must be none of this page's business. */
describe('cronjob JobsSettings writes', () => {
  const mount = (jobs: CronJob[], writes: { id: string; body: unknown }[], deletes: string[]) => {
    use(
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json(jobs)),
      http.get('/api/plugins/destinations', () => HttpResponse.json(DESTINATIONS)),
      http.get('/api/brain/models', () => HttpResponse.json(MODELS)),
      http.put('/api/plugins/cronjob/jobs/:id', async ({ request, params }) => {
        writes.push({ id: String(params.id), body: await request.json() });
        return HttpResponse.json({ ok: true });
      }),
      http.delete('/api/plugins/cronjob/jobs/:id', ({ params }) => {
        deletes.push(String(params.id));
        return HttpResponse.json({ ok: true });
      }),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
  };

  it('saves only the job that was edited', async () => {
    const writes: { id: string; body: unknown }[] = [];
    mount([
      job({ ownerUserId: 7, owner: { id: 7, username: 'filip', name: 'Filip Džudža', avatar: '7.png' } }),
      job({ id: 'j2', name: 'other' }),
    ], writes, []);
    await openRow('digest');
    fireEvent.change(screen.getByPlaceholderText('morning-digest'), { target: { value: 'renamed' } });
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 3000 });
    expect(writes[0]?.id).toBe('j1');
    expect(writes[0]?.body).toMatchObject({ id: 'j1', name: 'renamed', ownerUserId: 7 });
    expect(writes[0]?.body).not.toHaveProperty('owner');
  });

  it('changes builder modes with standard segmented keyboard semantics', async () => {
    const writes: { id: string; body: unknown }[] = [];
    mount([job({ schedule: 'daily 06:00' })], writes, []);
    await openRow('digest');
    const dialog = screen.getByRole('dialog', { name: 'digest' });
    const modes = within(dialog).getByRole('radiogroup', { name: strings.scheduleMode });
    const daily = within(modes).getByRole('radio', { name: strings.scheduleDaily });
    const weekly = within(modes).getByRole('radio', { name: strings.scheduleWeekly });

    daily.focus();
    fireEvent.keyDown(daily, { key: 'ArrowRight' });

    expect(weekly).toHaveFocus();
    expect(weekly).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByText('weekly mon 06:00')).toBeInTheDocument();
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 3000 });
    expect(writes[0]?.body).toMatchObject({ schedule: 'weekly mon 06:00' });
  });

  it('preserves a raw cron schedule while another field is edited', async () => {
    const writes: { id: string; body: unknown }[] = [];
    const raw = '0 9 * * 1-5';
    mount([job({ schedule: raw })], writes, []);
    await openRow('digest');
    const dialog = screen.getByRole('dialog', { name: 'digest' });
    const modes = within(dialog).getByRole('radiogroup', { name: strings.scheduleMode });
    expect(within(modes).getByRole('radio', { name: strings.scheduleAdvanced })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByRole('textbox', { name: strings.scheduleAdvancedValue })).toHaveValue(raw);

    fireEvent.change(screen.getByPlaceholderText('morning-digest'), { target: { value: 'renamed' } });
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 3000 });
    expect(writes[0]?.body).toMatchObject({ name: 'renamed', schedule: raw });
  });

  it('deletes a job by id and asks for nothing else', async () => {
    const deletes: string[] = [];
    mount([job({}), job({ id: 'j2', name: 'other' })], [], deletes);
    await screen.findByText('digest');
    await deleteJob('digest');
    await waitFor(() => expect(deletes).toEqual(['j1']));
  });

  it('never writes away a job that appeared while the page was open — and then shows it', async () => {
    const writes: { id: string; body: unknown }[] = [];
    const jobs = [job({})];
    mount(jobs, writes, []);
    await openRow('digest');
    // Someone else adds a job to the shared file (the scheduler, CronAdd, a hand edit)…
    jobs.push(job({ id: 'j2', name: 'added-elsewhere' }));
    // …and this page saves the row it happened to be editing.
    fireEvent.change(screen.getByPlaceholderText('morning-digest'), { target: { value: 'renamed' } });
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 3000 });
    expect(writes.map((w) => w.id)).toEqual(['j1']); // its own row, and nothing else
    // The save refreshes the list from the server, so the new job simply appears.
    await waitFor(() => expect(screen.getByText('added-elsewhere')).toBeInTheDocument());
  });
});

/** A row owns one job's lifecycle — created, changed under it, deleted. Every case below is a way that
 *  lifecycle used to lose an edit or bring a deleted job back. */
describe('a cron job row', () => {
  const mount = (jobs: CronJob[], calls: { writes: { id: string; body: unknown }[]; deletes: string[] }, deleteStatus = 200) => {
    use(
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json(jobs)),
      http.get('/api/plugins/destinations', () => HttpResponse.json(DESTINATIONS)),
      http.get('/api/brain/models', () => HttpResponse.json(MODELS)),
      conversationRoute([]),
      http.put('/api/plugins/cronjob/jobs/:id', async ({ request, params }) => {
        const body = (await request.json()) as CronJob;
        calls.writes.push({ id: String(params.id), body });
        // The server now has it — the way it would on the next refetch.
        if (!jobs.some((j) => j.id === body.id)) jobs.push(body);
        return HttpResponse.json({ ok: true });
      }),
      http.delete('/api/plugins/cronjob/jobs/:id', ({ params }) => {
        calls.deletes.push(String(params.id));
        if (deleteStatus !== 200) return HttpResponse.json({ error: 'nope' }, { status: deleteStatus });
        const at = jobs.findIndex((j) => j.id === String(params.id));
        if (at >= 0) jobs.splice(at, 1);
        return HttpResponse.json({ ok: true });
      }),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
  };
  /** The name input / prompt textarea of the open drawer — one job is editable at a time. */
  const nameBox = () => screen.getByPlaceholderText('morning-digest');
  const promptBox = () => document.querySelector<HTMLTextAreaElement>('textarea[rows="8"]')!;

  // A new row is invalid until it has a name, a prompt and the conversation it is filed under, so the
  // edit that finally makes it valid is the one that must be saved — and it was the one being eaten.
  it('saves a newly added job once the user has filled it in', async () => {
    const calls = { writes: [] as { id: string; body: unknown }[], deletes: [] as string[] };
    mount([], calls);
    fireEvent.click((await screen.findAllByText('Add job'))[0]!);
    fireEvent.change(nameBox(), { target: { value: 'nightly' } });
    fireEvent.change(promptBox(), { target: { value: 'Summarize the day.' } });
    await chooseExecution();
    await fileUnder('CRON JOBS');
    await waitFor(() => expect(calls.writes).toHaveLength(1), { timeout: 3000 });
    expect(calls.writes[0]?.body).toMatchObject({ name: 'nightly', prompt: 'Summarize the day.', conversationSessionId: 'conv-b' });
  });

  it('deletes a brand-new job that has already reached the server, so it cannot come back', async () => {
    const calls = { writes: [] as { id: string; body: unknown }[], deletes: [] as string[] };
    mount([job({})], calls);
    await screen.findByText('digest');
    fireEvent.click(screen.getAllByText('Add job')[0]!);
    fireEvent.change(nameBox(), { target: { value: 'oops' } }); // the added row is the only expanded one
    fireEvent.change(promptBox(), { target: { value: 'created by mistake' } });
    await chooseExecution();
    await fileUnder('CRON JOBS');
    await waitFor(() => expect(calls.writes).toHaveLength(1), { timeout: 3000 }); // it reached the server…
    await deleteJob('oops');
    // …so it must be deleted there too, or the refetch brings it back and it starts running on schedule.
    await waitFor(() => expect(calls.deletes).toEqual([calls.writes[0]?.id]));
    await waitFor(() => expect(screen.queryByDisplayValue('oops')).toBeNull());
  });

  it('keeps a failed save and Retry visible on the row after the drawer closes', async () => {
    const calls = { writes: [] as { id: string; body: unknown }[], deletes: [] as string[] };
    let attempts = 0;
    mount([job({})], calls);
    use(http.put('/api/plugins/cronjob/jobs/:id', async ({ request, params }) => {
      attempts += 1;
      calls.writes.push({ id: String(params.id), body: await request.json() });
      return attempts === 1 ? HttpResponse.json({ error: 'temporary' }, { status: 500 }) : HttpResponse.json({ ok: true });
    }));
    await openRow('digest');
    fireEvent.change(nameBox(), { target: { value: 'retry me' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));

    const retry = await screen.findByRole('button', { name: 'Retry' }, { timeout: 3000 });
    expect(screen.queryByRole('dialog', { name: 'digest' })).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(attempts).toBe(2));
    expect(calls.writes[1]?.body).toMatchObject({ id: 'j1', name: 'retry me' });
  });

  it('keeps saving a job whose delete failed, instead of silently dropping every later edit', async () => {
    const calls = { writes: [] as { id: string; body: unknown }[], deletes: [] as string[] };
    mount([job({})], calls, 500);
    await deleteJob('digest');
    await waitFor(() => expect(calls.deletes).toEqual(['j1']));
    // The job is still there. An edit to it must still be persisted — not swallowed under a "saved" chip.
    await openRow('digest');
    fireEvent.change(nameBox(), { target: { value: 'still here' } });
    await waitFor(() => expect(calls.writes).toHaveLength(1), { timeout: 3000 });
    expect(calls.writes[0]?.body).toMatchObject({ id: 'j1', name: 'still here' });
  });

  it('adopts a job the server changed under it, rather than overwriting it from a stale draft', async () => {
    const calls = { writes: [] as { id: string; body: unknown }[], deletes: [] as string[] };
    const jobs = [job({}), job({ id: 'j2', name: 'other' })];
    mount(jobs, calls);
    await openRow('other'); // edit the row we are NOT watching
    // The brain's cron tooling rewrites the first job's prompt while the page sits open…
    jobs[0] = job({ prompt: 'Rewritten by the agent.' });
    // …and an edit to the OTHER row refreshes the list.
    fireEvent.change(nameBox(), { target: { value: 'other renamed' } });
    await waitFor(() => expect(calls.writes.map((w) => w.id)).toEqual(['j2']), { timeout: 3000 });
    // The untouched row adopted what the server actually holds — the next save cannot revert it.
    await openRow('digest');
    await waitFor(() => expect(screen.getByDisplayValue('Rewritten by the agent.')).toBeInTheDocument());
  });
});

describe('cronjob JobsSettings model', () => {
  it('groups the catalog by provider with a pinned Default and picking a model updates the chip', async () => {
    await mountWith([job({})]);
    fireEvent.click(manageButtons()[1]);
    const heading = await screen.findByRole('heading', { name: 'Anthropic' });
    // The provider group header carries its brand logo, and each model row its own model icon.
    expect(heading.querySelector('img')).toBeTruthy();
    const modelRow = screen.getByRole('button', { name: 'claude-sonnet-4-5' });
    expect(modelRow.querySelector('img')).toBeTruthy();
    // No model saved → the pinned Default row is the current pick.
    expect(screen.getByRole('button', { name: 'default' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(modelRow);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull());
    expect(screen.getByText('claude-sonnet-4-5')).toBeInTheDocument();
  });

  it('shows the saved model as the selected row when reopening', async () => {
    await mountWith([job({ model: { provider: 'anthropic', model: 'claude-sonnet-4-5' } })]);
    expect(screen.getByText('claude-sonnet-4-5')).toBeInTheDocument(); // summary chip
    fireEvent.click(manageButtons()[1]);
    expect(await screen.findByRole('button', { name: 'claude-sonnet-4-5' })).toHaveAttribute('aria-pressed', 'true');
  });
});

/** The conversation a recurring job is FILED under. Organization only: every assertion below is about
 *  which conversation the job is grouped in, and none of them may move its context, model, owner or the
 *  place its result is delivered — the payloads are checked for exactly that. */
describe('cronjob JobsSettings conversation filing', () => {
  const mount = (jobs: CronJob[], writes: { id: string; body: Record<string, unknown> }[], asked: string[] = []) => {
    use(
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json(jobs)),
      http.get('/api/plugins/destinations', () => HttpResponse.json(DESTINATIONS)),
      http.get('/api/brain/models', () => HttpResponse.json(MODELS)),
      conversationRoute(asked),
      http.put('/api/plugins/cronjob/jobs/:id', async ({ request, params }) => {
        writes.push({ id: String(params.id), body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json({ ok: true });
      }),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
  };
  const nameBox = () => screen.getByPlaceholderText('morning-digest');
  const promptBox = () => document.querySelector<HTMLTextAreaElement>('textarea[rows="8"]')!;

  // The daemon refuses a new recurring job that names no conversation. Firing that 400 at the user
  // mid-typing is what the readiness gate exists to prevent — the row simply waits.
  it('holds a new recurring job\'s autosave until it names a conversation', async () => {
    const writes: { id: string; body: Record<string, unknown> }[] = [];
    const asked: string[] = [];
    mount([], writes, asked);
    fireEvent.click((await screen.findAllByText('Add job'))[0]!);
    fireEvent.change(nameBox(), { target: { value: 'nightly' } });
    fireEvent.change(promptBox(), { target: { value: 'Summarize the day.' } });

    expect(await screen.findByText(strings.conversationRequired)).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1400)); });
    expect(writes).toEqual([]);

    await fileUnder('CRON JOBS');
    expect(writes).toEqual([]);
    await chooseExecution();
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 3000 });
    expect(writes[0]?.body).toMatchObject({ name: 'nightly', prompt: 'Summarize the day.', conversationSessionId: 'conv-b', projectRef: { kind: 'host', projectId: 17 } });
    // An admin's new job is instance-wide until he takes it, so the picker asks in the instance scope.
    expect(asked).toEqual(['?scope=instance']);
  });

  // A job created before filing existed stays runnable and editable, and its ordinary edits must not
  // suddenly demand a conversation — the field is simply absent from the payload.
  it('labels a legacy job unassigned and leaves the field out of an ordinary edit', async () => {
    const writes: { id: string; body: Record<string, unknown> }[] = [];
    mount([job({})], writes);
    await openRow('digest');
    // Scoped to the EDITOR: the collapsed row states the filing too, so the page carries it twice.
    expect(within(await screen.findByRole('dialog')).getByText(strings.conversationUnassigned)).toBeInTheDocument();

    fireEvent.change(nameBox(), { target: { value: 'renamed' } });
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 3000 });
    expect(writes[0]?.body).toMatchObject({ name: 'renamed' });
    expect(writes[0]?.body).not.toHaveProperty('conversationSessionId');
  });

  // A deleted conversation is an explicit state, not a silent detach: the job keeps running, the editor
  // says so, and an edit elsewhere in the form round-trips the reference exactly as stored.
  it('reports an unavailable conversation and preserves the reference through an unrelated edit', async () => {
    const writes: { id: string; body: Record<string, unknown> }[] = [];
    mount([job({ conversationSessionId: 'gone', conversation: null })], writes);
    await openRow('digest');
    expect(within(await screen.findByRole('dialog')).getByText(strings.conversationUnavailable)).toBeInTheDocument();

    fireEvent.change(nameBox(), { target: { value: 'renamed' } });
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 3000 });
    expect(writes[0]?.body).toMatchObject({ conversationSessionId: 'gone' });
    // The live projection is the server's to compute; sending it back would ask the daemon to trust it.
    expect(writes[0]?.body).not.toHaveProperty('conversation');
  });

  // "Gone" and "could not be read" are different answers, and only the first is the reader's to solve.
  // Telling them to refile a job whose filing is almost certainly intact is a wrong instruction.
  it('says an unresolved filing is unknown rather than telling the reader it was deleted', async () => {
    const writes: { id: string; body: Record<string, unknown> }[] = [];
    mount([job({ conversationSessionId: 'conv-a', conversation: null, conversationUnresolved: true })], writes);
    await openRow('digest');

    expect(await screen.findByText(strings.conversationUnresolvedHint)).toBeInTheDocument();
    expect(screen.queryByText(strings.conversationUnavailable)).toBeNull();
    expect(screen.queryByText(strings.conversationUnavailableHint)).toBeNull();

    // The reference still round-trips untouched, and the server's own projection never goes back.
    fireEvent.change(nameBox(), { target: { value: 'renamed' } });
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 3000 });
    expect(writes[0]?.body).toMatchObject({ conversationSessionId: 'conv-a' });
    expect(writes[0]?.body).not.toHaveProperty('conversation');
    expect(writes[0]?.body).not.toHaveProperty('conversationUnresolved');
  });

  // An empty picker reads as "you have no conversations", which is the one thing a list that failed to
  // load does not know.
  it('says the conversation list failed instead of showing an empty picker', async () => {
    use(
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([job({})])),
      http.get('/api/plugins/cronjob/api/conversations', () => HttpResponse.json({ error: 'nope' }, { status: 500 })),
      http.put('/api/plugins/cronjob/jobs/:id', () => HttpResponse.json({ ok: true })),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
    await openRow('digest');

    fireEvent.click(await screen.findByRole('button', { name: strings.conversationManage }));
    expect(await screen.findByText(strings.conversationListError)).toBeInTheDocument();
  });

  it('files an owned job under another conversation and changes nothing else', async () => {
    const writes: { id: string; body: Record<string, unknown> }[] = [];
    const asked: string[] = [];
    mount([job({
      ownerUserId: 7, notifyChannelId: undefined, model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      conversationSessionId: 'conv-a',
      conversation: { id: 'conv-a', title: 'Morning planning', ownerUserId: 7, platform: null, direct: false },
    })], writes, asked);
    await openRow('digest');
    expect(within(await screen.findByRole('dialog')).getByText('Morning planning')).toBeInTheDocument();

    await fileUnder('CRON JOBS');
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 3000 });
    expect(writes[0]?.body).toMatchObject({
      id: 'j1', conversationSessionId: 'conv-b',
      // Organization only: ownership, schedule and model selection travel unchanged.
      ownerUserId: 7, schedule: 'daily 06:00', model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    });
    // A personal job may only be filed under its own account's conversations — asked in the owner's scope.
    expect(asked).toEqual(['']);
  });

  // The daemon refuses to carry a foreign conversation across an ownership change. The editor asks for a
  // compatible one instead of letting the autosave collect that 400.
  it('holds the save when the new owner cannot keep the filed conversation', async () => {
    const writes: { id: string; body: Record<string, unknown> }[] = [];
    mount([job({
      id: 'shared', name: 'instance digest', conversationSessionId: 'conv-x',
      conversation: { id: 'conv-x', title: 'Amy planning', ownerUserId: 9, platform: null, direct: false },
    })], writes);
    await openRow('instance digest');
    const owners = within(screen.getByRole('dialog')).getByRole('radiogroup', { name: strings.ownerColumn });
    fireEvent.click(within(owners).getByRole('radio', { name: strings.ownerMine }));

    expect(await screen.findByText(strings.conversationOwnerHint)).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1400)); });
    expect(writes).toEqual([]);

    await fileUnder('CRON JOBS');
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 3000 });
    expect(writes[0]?.body).toMatchObject({ ownerUserId: 7, conversationSessionId: 'conv-b' });
  });

  // A one-shot wake-up is never filed anywhere: it fires once and deletes itself.
  it('offers no filing for a one-shot wake-up', async () => {
    mount([job({ runAt: '2026-09-01T12:00:00.000Z' })], []);
    await openRow('digest');
    await screen.findByText(strings.prompt);
    expect(screen.queryByRole('button', { name: strings.conversationManage })).toBeNull();
  });
});

/** `/p/cronjob?job=<id>` — the address a conversation's collapsed jobs branch links to. It selects an
 *  EXISTING job in the existing editor: it creates nothing, enables nothing and saves nothing. */
describe('cronjob JobsSettings deep link', () => {
  const address = () => `${window.location.pathname}${window.location.search}`;
  const goTo = (url: string) => window.history.replaceState(null, '', url);
  afterEach(() => goTo('/'));

  const mountPage = (jobs: CronJob[], calls: { writes: unknown[]; deletes: string[] } = { writes: [], deletes: [] }) => {
    use(
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json(jobs)),
      http.get('/api/plugins/destinations', () => HttpResponse.json(DESTINATIONS)),
      http.get('/api/brain/models', () => HttpResponse.json(MODELS)),
      conversationRoute([]),
      http.put('/api/plugins/cronjob/jobs/:id', async ({ request }) => {
        calls.writes.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
      http.delete('/api/plugins/cronjob/jobs/:id', ({ params }) => {
        calls.deletes.push(String(params.id));
        const at = jobs.findIndex((j) => j.id === String(params.id));
        if (at >= 0) jobs.splice(at, 1);
        return HttpResponse.json({ ok: true });
      }),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="page" /></ToastProvider></Wrapper>);
  };

  const many = (count: number) => Array.from({ length: count }, (_, i) =>
    job({ id: `j${i + 1}`, name: `job ${String(i + 1).padStart(2, '0')}` }));

  it('opens the linked job on the register page it actually sits on', async () => {
    goTo('/p/cronjob?cat=plugins&job=j22');
    const calls = { writes: [] as unknown[], deletes: [] as string[] };
    mountPage(many(25), calls);

    expect(await screen.findByRole('dialog', { name: 'job 22' })).toBeInTheDocument();
    // The second page, not the first: the linked row has to be among the rendered ones.
    expect(within(screen.getByRole('table')).getByText('job 22')).toBeInTheDocument();
    expect(screen.queryByText('job 01')).toBeNull();
    // Navigating to a job neither creates nor writes one.
    expect(calls.writes).toEqual([]);
    expect(address()).toBe('/p/cronjob?cat=plugins&job=j22');
  });

  it('removes only the job parameter when the detail is closed', async () => {
    goTo('/p/cronjob?cat=plugins&job=j1');
    mountPage([job({}), job({ id: 'j2', name: 'other' })]);
    const dialog = await screen.findByRole('dialog', { name: 'digest' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'digest' })).toBeNull());
    expect(address()).toBe('/p/cronjob?cat=plugins');
  });

  it('follows the browser back button to the previously open job', async () => {
    goTo('/p/cronjob');
    mountPage([job({}), job({ id: 'j2', name: 'other' })]);
    await openRow('digest');
    await waitFor(() => expect(address()).toBe('/p/cronjob?job=j1'));
    await openRow('other');
    await waitFor(() => expect(address()).toBe('/p/cronjob?job=j2'));

    window.history.back();
    await waitFor(() => expect(address()).toBe('/p/cronjob?job=j1'));
    expect(await screen.findByRole('dialog', { name: 'digest' })).toBeInTheDocument();
  });

  it('clears the parameter when the selected job is deleted', async () => {
    goTo('/p/cronjob?job=j1');
    const calls = { writes: [] as unknown[], deletes: [] as string[] };
    mountPage([job({}), job({ id: 'j2', name: 'other' })], calls);
    await screen.findByRole('dialog', { name: 'digest' });

    fireEvent.click((await screen.findAllByRole('button', { name: 'Delete job' }))[0]!);
    const buttons = await screen.findAllByRole('button', { name: 'Delete job' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() => expect(calls.deletes).toEqual(['j1']));
    await waitFor(() => expect(address()).toBe('/p/cronjob'));
  });

  // An id that does not exist and one belonging to another account are the SAME answer here: the list
  // this page loaded is already the authorized one, so a foreign job is simply not in it.
  it('answers an unknown or foreign job id with the same unavailable notice', async () => {
    goTo('/p/cronjob?job=someone-elses');
    mountPage([job({})]);

    expect(await screen.findByText(strings.linkUnavailable)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    // The rest of the register still works.
    expect(screen.getByText('digest')).toBeInTheDocument();
  });
});

describe('cronjob bundle registration', () => {
  // The host wraps a settings section in its own page column and module header. This section brings a
  // whole workspace shell of its own, so that wrapper nested two page frames: the gutter and the bottom
  // padding were spent twice and the page came out narrower than every sibling register. The bundle
  // declares the section id it frames itself — and the section really does frame itself, which is what
  // makes the declaration true.
  it('claims the page frame for the section that draws its own', async () => {
    use(
      http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([job({})])),
      http.get('/api/plugins/destinations', () => HttpResponse.json(DESTINATIONS)),
      http.get('/api/brain/models', () => HttpResponse.json(MODELS)),
    );
    const registration = await loadBundleRegistration();

    expect(registration.ownsPageFrame).toContain('jobs');
    // The two places the ceiling is written must agree, or the host loads a bundle built against a
    // contract it does not serve — or refuses one it does.
    expect(registration.requiresApiVersion).toBe(manifestApiVersion);
    // Every id it claims must be a section it actually registers, or the host drops a frame nobody draws.
    const sections = registration.settings ?? {};
    for (const id of registration.ownsPageFrame ?? []) expect(Object.keys(sections)).toContain(id);

    const Section = sections.jobs;
    if (!Section) throw new Error('the bundle registered no jobs section');
    const { wrapper: Wrapper } = createWrapper();
    const page = render(
      <Wrapper><ToastProvider><Section plugin="cronjob" params={{ id: 'jobs' }} rest={[]} surface="page" /></ToastProvider></Wrapper>,
    );
    await waitFor(() => expect(page.container.querySelector('[data-control-surface]')).not.toBeNull());
    expect(page.container.querySelectorAll('.workspace-page, .workspace-shell')).toHaveLength(1);
  });
});
