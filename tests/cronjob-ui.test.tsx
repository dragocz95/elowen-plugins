import type { ComponentType } from 'react';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { http, HttpResponse, listen, use, setDefaults, resetHandlers, close } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { JobsSettings } from '../plugins/cronjob/web-src/JobsSettings';
import manifest from '../plugins/cronjob/elowen-plugin.json' with { type: 'json' };
import { ToastProvider, createWrapper } from './ui/hostHooks';
import type { BrainModelOption, CronJob, NotificationDestinationOption } from '../plugins/cronjob/web-src/runtime';

// The moved editor resolves everything through window.ElowenUiRuntime — install the REAL runtime,
// so this exercises the production contract the bundle runs against.
ensurePluginUiRuntime();

// View copy is served per-plugin by /plugins/ui; serving the REAL manifest en fallback keeps the
// assertions in lockstep with what production users see.
const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
const manifestApiVersion = (manifest as { web: { requiresApiVersion: number } }).web.requiresApiVersion;

type PluginSectionComponent = ComponentType<{ plugin: string; params: Record<string, string>; rest: string[]; surface: 'page' | 'deck' }>;
interface BundleRegistration {
  requiresApiVersion: number;
  settings?: Record<string, PluginSectionComponent>;
  ownsPageFrame?: string[];
}

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

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'cronjob', url: '/plugins/cronjob/web/index.js', apiVersion: 1, nav: [], settings: [], strings }])),
  // The owner column is the admin's view of who scheduled what, so the page reads the signed-in account.
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 7, username: 'filip', is_admin: true } })),
  // The core repo served these from its app-wide msw setup; here the file owns its whole surface.
  // Individual tests still shadow them — the 503 destinations case is the point of that.
  http.get('/api/plugins/destinations', () => HttpResponse.json(DESTINATIONS)),
  http.get('/api/brain/models', () => HttpResponse.json(MODELS)),
);
beforeAll(() => listen()); afterEach(() => { cleanup(); resetHandlers(); }); afterAll(() => close());

async function mountWith(jobs: CronJob[]) {
  use(
    http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json(jobs)),
    http.get('/api/plugins/destinations', () => HttpResponse.json(DESTINATIONS)),
    http.get('/api/brain/models', () => HttpResponse.json(MODELS)),
    http.put('/api/plugins/cronjob/jobs/:id', () => HttpResponse.json({ ok: true })),
  );
  const { wrapper: Wrapper } = createWrapper();
  render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
  // Open the job's drawer so the channel/model fields render.
  await openRow('digest');
}

describe('cronjob JobsSettings — error state', () => {
  // An admin is the one person who sees more than his own jobs, so he gets the owner column and the scope
  // filter; everyone else's list is already only theirs and the column would say the same thing on every row.
  it('shows the admin who owns each job and filters by scope', async () => {
    use(http.get('/api/plugins/cronjob/jobs', () => HttpResponse.json([
      job({ id: 'shared', name: 'instance digest' }),
      job({ id: 'mine', name: 'my digest', ownerUserId: 7 }),
      job({ id: 'hers', name: 'her digest', ownerUserId: 9 }),
    ])));
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><JobsSettings surface="deck" /></ToastProvider></Wrapper>);
    await screen.findByText('instance digest');
    expect(screen.getAllByText(strings.ownerInstance).length).toBeGreaterThan(0);
    expect(screen.getAllByText(strings.ownerMine).length).toBeGreaterThan(0);
    expect(screen.getByText('#9')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: strings.filterInstance }));
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

    // Scoped to the DRAWER: the scope filter above the table is also a radiogroup, also labelled
    // "Owner", and also spells one of its options "Mine" — searched globally, it answers for the drawer.
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
    mount([job({}), job({ id: 'j2', name: 'other' })], writes, []);
    await openRow('digest');
    fireEvent.change(screen.getByPlaceholderText('morning-digest'), { target: { value: 'renamed' } });
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 3000 });
    expect(writes[0]?.id).toBe('j1');
    expect(writes[0]?.body).toMatchObject({ id: 'j1', name: 'renamed' });
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

  // A new row is invalid until it has both a name and a prompt, so the edit that finally makes it valid is
  // the one that must be saved — and it was the one being eaten.
  it('saves a newly added job once the user has filled it in', async () => {
    const calls = { writes: [] as { id: string; body: unknown }[], deletes: [] as string[] };
    mount([], calls);
    fireEvent.click((await screen.findAllByText('Add job'))[0]!);
    fireEvent.change(nameBox(), { target: { value: 'nightly' } });
    fireEvent.change(promptBox(), { target: { value: 'Summarize the day.' } });
    await waitFor(() => expect(calls.writes).toHaveLength(1), { timeout: 3000 });
    expect(calls.writes[0]?.body).toMatchObject({ name: 'nightly', prompt: 'Summarize the day.' });
  });

  it('deletes a brand-new job that has already reached the server, so it cannot come back', async () => {
    const calls = { writes: [] as { id: string; body: unknown }[], deletes: [] as string[] };
    mount([job({})], calls);
    await screen.findByText('digest');
    fireEvent.click(screen.getAllByText('Add job')[0]!);
    fireEvent.change(nameBox(), { target: { value: 'oops' } }); // the added row is the only expanded one
    fireEvent.change(promptBox(), { target: { value: 'created by mistake' } });
    await waitFor(() => expect(calls.writes).toHaveLength(1), { timeout: 3000 }); // it reached the server…
    await deleteJob('oops');
    // …so it must be deleted there too, or the refetch brings it back and it starts running on schedule.
    await waitFor(() => expect(calls.deletes).toEqual([calls.writes[0]?.id]));
    await waitFor(() => expect(screen.queryByDisplayValue('oops')).toBeNull());
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
