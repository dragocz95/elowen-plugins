import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, listen, use, setDefaults, resetHandlers, close } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { ToastProvider, createWrapper } from './ui/hostHooks';
import manifest from '../plugins/browser/elowen-plugin.json' with { type: 'json' };
import { BrowserArtifact } from '../plugins/browser/web-src/BrowserArtifact';
import { BrowserAccount } from '../plugins/browser/web-src/BrowserAccount';
import { BrowserSettings } from '../plugins/browser/web-src/BrowserSettings';
import { registerBrowserUi } from '../plugins/browser/web-src/runtime';

ensurePluginUiRuntime();
const strings = manifest.web.strings;
setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'browser', url: '/plugins/browser/web/index.js', cssUrl: '/plugins/browser/web/index.css', apiVersion: 15, nav: [], account: manifest.web.account, settings: manifest.web.settings, strings }])),
  http.get('/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'user', is_admin: true } })),
);
beforeAll(() => listen());
afterEach(() => { cleanup(); resetHandlers(); vi.restoreAllMocks(); });
afterAll(() => close());

const artifact = {
  id: 'browser:session-1', plugin: 'browser', sessionId: 'brain-1', toolCallId: 'tool-1', view: 'browser-session',
  fallback: 'Browser session', expiresAt: new Date(Date.now() + 60_000).toISOString(), status: 'open' as const,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  data: { browserSessionId: 'session-1', state: 'agent', title: 'Example', url: 'https://example.com', lastAction: null },
  media: { transport: 'sse' as const, path: '/plugins/browser/api/stream?sessionId=session-1' },
};

function wrapper() {
  const { wrapper: Wrapper } = createWrapper();
  return Wrapper;
}
type Pending = { label: string; reveal: () => void } | null;
function mountArtifact(narration?: string, pendingInput?: Pending) {
  const Wrapper = wrapper();
  const show = (text?: string, pending?: Pending) => (
    <Wrapper><ToastProvider>
      <BrowserArtifact plugin="browser" artifact={artifact} narration={text} pendingInput={pending} />
    </ToastProvider></Wrapper>
  );
  const view = render(show(narration, pendingInput));
  return Object.assign(view, {
    narrate: (text?: string) => view.rerender(show(text, pendingInput)),
    ask: (pending: Pending) => view.rerender(show(narration, pending)),
  });
}

const streamBody = [
  `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'agent', lease: null })}\n\n`,
  `event: frame\ndata: ${JSON.stringify({ data: 'ZmFrZS1qcGVn', mimeType: 'image/jpeg', width: 1280, height: 800, timestamp: 1 })}\n\n`,
  `event: cursor\ndata: ${JSON.stringify({ x: 640, y: 400, moving: false })}\n\n`,
  `event: action\ndata: ${JSON.stringify({ action: 'click', target: 'Continue', x: 640, y: 400 })}\n\n`,
].join('');
const requestedStreamBody = [
  `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'agent', lease: null })}\n\n`,
  `event: control\ndata: ${JSON.stringify({ state: 'agent', reason: 'requested' })}\n\n`,
].join('');
/** The shape production actually delivered: a click reports where it landed, but the six `cursor` frames
 *  of the approach never reached this viewer — it connected mid-move, or they were dropped. */
const actionOnlyStreamBody = [
  `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'agent', lease: null, cursor: null })}\n\n`,
  `event: frame\ndata: ${JSON.stringify({ data: 'ZmFrZS1qcGVn', mimeType: 'image/jpeg', width: 1280, height: 800, timestamp: 1 })}\n\n`,
  `event: action\ndata: ${JSON.stringify({ action: 'click', target: 'Continue', x: 320, y: 200 })}\n\n`,
].join('');
/** A viewer that opens the artifact between two agent moves: no live cursor event is coming, so the
 *  opening frame replays where the agent left the pointer. */
const lateViewerStreamBody = [
  `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'agent', lease: null, cursor: { x: 960, y: 600 } })}\n\n`,
  `event: frame\ndata: ${JSON.stringify({ data: 'ZmFrZS1qcGVn', mimeType: 'image/jpeg', width: 1280, height: 800, timestamp: 1 })}\n\n`,
].join('');

describe('browser plugin UI', () => {
  it('registers the chat artifact, settings and account surfaces on API 15', () => {
    let registration: any;
    const original = window.__elowenRegisterPluginUi;
    window.__elowenRegisterPluginUi = (name, value) => { registration = { name, value }; };
    registerBrowserUi(BrowserArtifact, BrowserSettings, BrowserAccount);
    window.__elowenRegisterPluginUi = original;
    expect(registration.name).toBe('browser');
    expect(registration.value.requiresApiVersion).toBe(15);
    expect(registration.value.chatArtifacts['browser-session']).toBe(BrowserArtifact);
    expect(registration.value.settings.runtime).toBe(BrowserSettings);
    expect(registration.value.account.profile).toBe(BrowserAccount);
  });

  it('renders the live session as one compact tile with no card chrome around it', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    await waitFor(() => expect(document.querySelector('img[src="data:image/jpeg;base64,ZmFrZS1qcGVn"]')).not.toBeNull());
    // The image IS the card: one control (the thumbnail itself) opens the canvas, and the only text
    // beside it is the site and the current action.
    expect(screen.getAllByRole('button', { name: strings.enlarge })).toHaveLength(1);
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.queryByText('https://example.com')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    // No running commentary on the thumbnail: the state is a dot, and its label is for assistive tech.
    expect(screen.queryByText('Clicking · Continue')).toBeNull();
    expect(document.querySelector('.browser-artifact__activity.has-action')).toBeNull();
    expect(document.querySelector('.browser-artifact__dot')).toHaveAttribute('data-tone');
    expect(document.querySelector('.browser-artifact__activity .sr-only')?.textContent).toBeTruthy();
    // The agent's pointer is feedback for the surface you are working on, not for a 300px thumbnail.
    expect(document.querySelector('.browser-artifact__cursor')).toBeNull();
  });

  it('expands into a borderless canvas that closes on Escape', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    const canvas = await screen.findByRole('dialog', { name: 'Example' });
    expect(canvas).toHaveAttribute('aria-modal', 'true');
    // No dialog header, body or footer: the raised surface carries the image and floating controls only.
    expect(within(canvas).queryByRole('heading')).toBeNull();
    expect(within(canvas).getByRole('button', { name: strings.closeView })).toBeInTheDocument();
    expect(within(canvas).getByRole('button', { name: strings.closeSession })).toBeInTheDocument();
    // The surface you work on is the one that gets the action copy and the agent's pointer.
    expect(await within(canvas).findByText('Clicking · Continue')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll('.browser-artifact__cursor').length).toBeGreaterThan(0));
    fireEvent.keyDown(canvas, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('draws the close control as one glass button, not a bordered square inside a disc', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    const close = await screen.findByRole('button', { name: strings.closeView });
    // ONE element is the control AND its glass: no wrapper holding a second framed button inside it.
    expect(close).toHaveClass('browser-artifact__icon', 'browser-artifact__dismiss');
    expect(close.querySelector('button')).toBeNull();
    expect(close.closest('.browser-artifact__dismiss')).toBe(close);
    // Every control on the canvas is that same round ghost button — nothing draws its own square edge.
    for (const label of [strings.closeSession, strings.closeView]) {
      expect(screen.getByRole('button', { name: label })).toHaveClass('browser-artifact__icon');
    }
  });

  it('keeps an agent-requested handoff claimable by the user', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(requestedStreamBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    // A requested handoff is a state, so it reaches the thumbnail as the dot's tone and its sr-only label.
    expect(await screen.findByText(strings.waitingForUser)).toHaveClass('sr-only');
    await waitFor(() => expect(document.querySelector('.browser-artifact__dot')).toHaveAttribute('data-tone', 'warning'));
    expect(document.querySelector('.browser-artifact__waiting .spinner')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: strings.takeControl }).at(-1)).toBeEnabled();
    expect(screen.queryByText(strings.controlledElsewhere)).toBeNull();
  });

  it('keeps takeover tokens local, sends user input and releases control', async () => {
    const calls: { path: string; body: any }[] = [];
    use(
      http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })),
      http.post('/api/plugins/browser/api/takeover', () => HttpResponse.json({ leaseId: 'lease-new', expiresAt: Date.now() + 120_000 })),
      http.post('/api/plugins/browser/api/input', async ({ request }) => { calls.push({ path: 'input', body: await request.json() }); return HttpResponse.json({ accepted: 1 }); }),
      http.post('/api/plugins/browser/api/release', async ({ request }) => { calls.push({ path: 'release', body: await request.json() }); return HttpResponse.json({ released: true }); }),
      http.post('/api/plugins/browser/api/heartbeat', () => HttpResponse.json({ expiresAt: Date.now() + 120_000 })),
    );
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    // Page navigation belongs to whoever is driving: nothing to show while the agent holds the session.
    expect(screen.queryByRole('button', { name: strings.reload })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: strings.takeControl }).at(-1)!);
    expect((await screen.findAllByText(strings.youControl)).length).toBeGreaterThan(0);
    for (const label of [strings.back, strings.forward, strings.reload]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    const viewport = screen.getAllByLabelText(strings.browserViewport).at(-1)!;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 400, width: 640, height: 400, toJSON: () => ({}) });
    fireEvent.pointerDown(viewport, { clientX: 320, clientY: 200, button: 0, pointerId: 1 });
    await waitFor(() => expect(calls.some((call) => call.path === 'input' && call.body.leaseId === 'lease-new')).toBe(true));
    fireEvent.click(screen.getAllByRole('button', { name: strings.returnToAgent }).at(-1)!);
    await waitFor(() => expect(calls.some((call) => call.path === 'release' && call.body.leaseId === 'lease-new')).toBe(true));
  });

  it('leaves the user one pointer while they drive the session', async () => {
    use(
      http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })),
      http.post('/api/plugins/browser/api/takeover', () => HttpResponse.json({ leaseId: 'lease-1', expiresAt: Date.now() + 120_000 })),
      http.post('/api/plugins/browser/api/heartbeat', () => HttpResponse.json({ expiresAt: Date.now() + 120_000 })),
    );
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    // The agent is driving: its arrow is the pointer on the canvas.
    await waitFor(() => expect(document.querySelector('.browser-artifact__cursor')).not.toBeNull());

    fireEvent.click(screen.getAllByRole('button', { name: strings.takeControl }).at(-1)!);
    expect((await screen.findAllByText(strings.youControl)).length).toBeGreaterThan(0);
    // Now YOU are: the streamed cursor reports where the agent points and stops moving, so it is
    // withdrawn rather than left beside your own system pointer.
    await waitFor(() => expect(document.querySelector('.browser-artifact__cursor')).toBeNull());
    expect(screen.getAllByLabelText(strings.browserViewport).at(-1)).toHaveAttribute('data-interactive', 'true');
  });

  it('shows what the agent is saying inside the expanded canvas only, and clears with it', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    const view = mountArtifact('Opening the booking portal.');
    await screen.findByRole('button', { name: strings.enlarge });
    // The transcript is right there under the thumbnail; repeating it in the tile would say it twice.
    expect(screen.queryByText('Opening the booking portal.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: strings.enlarge }));
    const canvas = await screen.findByRole('dialog', { name: 'Example' });
    const bubble = within(canvas).getByText('Opening the booking portal.').closest('.browser-artifact__narration');
    expect(bubble).not.toBeNull();
    // A mark, not a caption: the icon says whose words these are without spending a line on saying it.
    const icon = bubble!.querySelector('.browser-artifact__narration-icon');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(bubble).toHaveAttribute('aria-live', 'polite');
    expect(bubble).toHaveAttribute('role', 'status');
    expect(within(canvas).getByRole('button', { name: strings.closeSession })).toBeInTheDocument();

    // Streaming replaces the line in place…
    view.narrate('Opening the booking portal. The first free slot is Thursday.');
    expect(within(canvas).getByText('Opening the booking portal. The first free slot is Thursday.')).toBeInTheDocument();

    // …and an empty narration (a new user turn, or a host older than API 14) leaves no empty bubble.
    view.narrate('   ');
    expect(canvas.querySelector('.browser-artifact__narration')).toBeNull();
    view.narrate(undefined);
    expect(canvas.querySelector('.browser-artifact__narration')).toBeNull();
    // The browser's own action status is a separate, shorter thing and stays.
    expect(await within(canvas).findByText('Clicking · Continue')).toBeInTheDocument();
  });

  it('places the agent pointer from the action itself when the cursor frames never arrive', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(actionOnlyStreamBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    const cursor = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.browser-artifact__cursor');
      expect(found).not.toBeNull();
      return found!;
    });
    // The action's own coordinates are the authoritative landing point, read as a fraction of the frame.
    expect(cursor.style.left).toBe('25%');
    expect(cursor.style.top).toBe('25%');
  });

  it('starts a late viewer from the pointer the agent left behind', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(lateViewerStreamBody, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    const cursor = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.browser-artifact__cursor');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(cursor.style.left).toBe('75%');
    expect(cursor.style.top).toBe('75%');
  });

  it('withdraws the agent pointer while anyone holds the session, not just this window', async () => {
    // `control: user` with no lease of our own is the OTHER window driving. The streamed cursor still
    // reports where the agent last pointed, and drawing it beside that person's pointer is the same
    // two-pointer bug as a local takeover.
    const foreignTakeover = [
      `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'agent', lease: null, cursor: { x: 640, y: 400 } })}\n\n`,
      `event: frame\ndata: ${JSON.stringify({ data: 'ZmFrZS1qcGVn', mimeType: 'image/jpeg', width: 1280, height: 800, timestamp: 1 })}\n\n`,
      `event: control\ndata: ${JSON.stringify({ state: 'user' })}\n\n`,
    ].join('');
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(foreignTakeover, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: strings.controlledElsewhere }).length).toBeGreaterThan(0));
    expect(document.querySelector('.browser-artifact__cursor')).toBeNull();
  });

  it('drops the agent pointer when the page it was on goes away', async () => {
    const navigated = [
      `event: session\ndata: ${JSON.stringify({ id: 'session-1', state: 'agent', lease: null, cursor: { x: 640, y: 400 } })}\n\n`,
      `event: frame\ndata: ${JSON.stringify({ data: 'ZmFrZS1qcGVn', mimeType: 'image/jpeg', width: 1280, height: 800, timestamp: 1 })}\n\n`,
      `event: cursor\ndata: ${JSON.stringify({ cleared: true })}\n\n`,
    ].join('');
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(navigated, { headers: { 'content-type': 'text/event-stream' } })));
    mountArtifact();
    fireEvent.click(await screen.findByRole('button', { name: strings.enlarge }));
    await waitFor(() => expect(document.querySelector('img[src^="data:image/jpeg"]')).not.toBeNull());
    expect(document.querySelector('.browser-artifact__cursor')).toBeNull();
  });

  it('says a question is waiting only on the expanded canvas, and gets out of the way when pressed', async () => {
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    const reveal = vi.fn();
    const waiting = { label: 'The assistant is waiting for your choice', reveal };
    const view = mountArtifact(undefined, waiting);
    await screen.findByRole('button', { name: strings.enlarge });
    // The thumbnail sits in the transcript, where the real question card is already visible below it.
    expect(screen.queryByRole('button', { name: waiting.label })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: strings.enlarge }));
    const canvas = await screen.findByRole('dialog', { name: 'Example' });
    const alert = within(canvas).getByRole('button', { name: waiting.label });
    expect(alert).toHaveClass('browser-artifact__question');
    // Announced without a second copy of the words: one live region, the button's own label.
    expect(canvas.querySelector('.sr-only[role="status"]')).toHaveTextContent(waiting.label);

    // Pressing it does exactly two things: uncover the card, and put the reader in front of it.
    fireEvent.click(alert);
    expect(reveal).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Answered or withdrawn: nothing is left asking.
    fireEvent.click(screen.getByRole('button', { name: strings.enlarge }));
    view.ask(null);
    const reopened = await screen.findByRole('dialog', { name: 'Example' });
    expect(reopened.querySelector('.browser-artifact__question')).toBeNull();
    expect(reopened.querySelector('.sr-only[role="status"]')).toHaveTextContent('');
  });

  it('lets the canvas get out of the way before the host reveals the question', async () => {
    // The overlay restores focus to whatever opened it when it unmounts. Revealing the card in the same
    // breath as closing therefore focused the question and then had it yanked back to the thumbnail —
    // the reader ended up staring at the tile they had just left. The reveal has to be LAST.
    use(http.get('/api/plugins/browser/api/stream', () => new HttpResponse(streamBody, { headers: { 'content-type': 'text/event-stream' } })));
    const card = document.createElement('button');
    card.textContent = 'the real question card';
    document.body.appendChild(card);

    // What the host sees at the moment it is asked to reveal — the whole ordering contract in one record.
    const observed: { dialogStillUp: boolean; activeAtCall: Element | null }[] = [];
    const reveal = vi.fn(() => {
      observed.push({
        dialogStillUp: document.querySelector('[role="dialog"]') !== null,
        activeAtCall: document.activeElement,
      });
      card.focus();
    });
    mountArtifact(undefined, { label: 'The assistant is waiting for your choice', reveal });

    const tile = await screen.findByRole('button', { name: strings.enlarge });
    fireEvent.click(tile);
    const canvas = await screen.findByRole('dialog', { name: 'Example' });
    fireEvent.click(within(canvas).getByRole('button', { name: 'The assistant is waiting for your choice' }));

    await waitFor(() => expect(reveal).toHaveBeenCalledTimes(1));
    // By the time the host was asked to reveal, the canvas had already gone AND its own focus restore had
    // already run, so nothing is left afterwards to take focus off the question. (The restore lands on
    // whatever was focused when the overlay opened; under jsdom a click does not focus the button it hits,
    // so that is the body here — what matters is that it is not the card, and that it has already run.)
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(observed).toHaveLength(1);
    expect(observed[0]!.dialogStillUp).toBe(false);
    expect(observed[0]!.activeAtCall).not.toBe(card);
    expect(tile.isConnected).toBe(true);

    // A frame later — the earliest anything else could have interfered — the question still has it.
    await new Promise((resolve) => { requestAnimationFrame(() => resolve(null)); });
    expect(document.activeElement).toBe(card);

    card.remove();
  });

  const dependencyStatus = (dependencies: unknown) => http.get(
    '/api/plugins/browser/api/admin-status',
    () => HttpResponse.json({ activeUsers: 0, activeSessions: 0, maxActiveUsers: 4, maxSessionsPerUser: 2, artifactsAvailable: true, dependencies }),
  );
  const settings = () => {
    const Wrapper = wrapper();
    return render(<Wrapper><ToastProvider><BrowserSettings plugin="browser" params={{}} rest={[]} surface="page" /></ToastProvider></Wrapper>);
  };

  const readinessRows = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>('[data-settings-group]')][0]!.querySelectorAll<HTMLElement>('.settings-row');

  it('answers the readiness question at a glance, and stays quiet when everything is ready', async () => {
    use(dependencyStatus({
      status: 'ready',
      ready: 2,
      total: 2,
      checks: [
        { id: 'chrome', status: 'ready', label: 'Chrome or Chromium', code: 'chrome.detected', detail: 'Found a supported executable on this host.', value: 'chromium' },
        { id: 'network-proxy', status: 'ready', label: 'Enforcing network proxy', code: 'proxy.ready', detail: 'proxy-chain is loadable and pins DNS per request.' },
      ],
    }));
    const view = settings();

    // The verdict is a word, not only a colour, and the count says how far it got. It rides in the
    // section header's own actions slot, as a live region so a refresh announces a change.
    const summary = (await screen.findByText(`2 / 2 ${strings.depsCounted}`)).parentElement!;
    expect(summary).toHaveAttribute('role', 'status');
    expect(within(summary).getByText(strings.depReady)).toBeInTheDocument();
    expect(summary.closest('.settings-group__actions')).not.toBeNull();

    // A ready dependency says nothing beyond its badge, and stays on the record's single trailing line.
    const rows = readinessRows(view.container);
    expect(rows).toHaveLength(2);
    expect(screen.getByText(strings.dep_label_chrome)).toBeInTheDocument();
    expect(rows[0]).toHaveAttribute('data-trailing', 'inline');
    expect(screen.queryByText('proxy-chain is loadable and pins DNS per request.')).toBeNull();
    // …except the browser's name, which is a fact worth seeing and is never its path.
    expect(within(rows[0]!).getByText('chromium')).toBeInTheDocument();
  });

  it('names the blocked dependency and the exact fix, in the reader\'s language', async () => {
    use(dependencyStatus({
      status: 'blocked',
      ready: 1,
      total: 3,
      checks: [
        { id: 'chrome', status: 'blocked', label: 'Chrome or Chromium', code: 'chrome.missing', detail: 'No supported Chrome or Chromium executable was found on this host.', remediation: 'Install Google Chrome or Chromium, or set the executable in this plugin\u2019s settings.' },
        { id: 'chat-artifacts', status: 'warning', label: 'Live view in chat', code: 'artifacts.missing', detail: 'This host has no inline chat artifact bridge, so sessions run without a live card in chat.', remediation: 'Update Elowen to a release that publishes inline chat artifacts.' },
        { id: 'profile-storage', status: 'ready', label: 'Profile storage', code: 'storage.ready', detail: 'The profile directory is private and writable.' },
      ],
    }));
    const view = settings();

    // The worst outcome is the verdict — a warning must not be reported as ready.
    const summary = (await screen.findByText(`1 / 3 ${strings.depsCounted}`)).parentElement!;
    expect(within(summary).getByText(strings.depBlocked)).toBeInTheDocument();

    const rows = readinessRows(view.container);
    expect(within(rows[0]!).getByText(strings.depBlocked)).toBeInTheDocument();
    // Detail and remediation are READ on the row, not hidden behind a tooltip, and the record takes the
    // stacked trailing side so neither collapses into a phone's value column.
    expect(rows[0]).toHaveAttribute('data-trailing', 'stack');
    expect(within(rows[0]!).getByText(strings.dep_chrome_missing)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(strings.dep_chrome_missing_fix)).toBeInTheDocument();
    expect(within(rows[0]!).queryByRole('button', { name: 'Help' })).toBeNull();
    // A warning is its own outcome: the session still runs, so it neither blocks nor passes silently.
    expect(within(rows[1]!).getByText(strings.depAttention)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(strings.dep_artifacts_missing_fix)).toBeInTheDocument();
    expect(within(rows[2]!).getByText(strings.depReady)).toBeInTheDocument();
    expect(rows[2]).toHaveAttribute('data-trailing', 'inline');
  });

  it('claims no sandbox verdict it cannot stand behind', async () => {
    use(dependencyStatus({
      status: 'ready', ready: 1, total: 1,
      checks: [{ id: 'chrome', status: 'ready', label: 'Chrome or Chromium', code: 'chrome.detected', detail: 'Found a supported executable on this host.', value: 'chromium' }],
    }));
    const view = settings();
    await screen.findByText(`1 / 1 ${strings.depsCounted}`);

    // A host policy can still refuse the launch, so there is no sandbox row wearing a green badge —
    // the section says in words where the sandbox is actually settled.
    expect(readinessRows(view.container)).toHaveLength(1);
    expect(screen.getByText(strings.depsHint)).toBeInTheDocument();
    expect(strings.depsHint).toContain('first managed launch');
    expect(view.container.textContent).not.toContain('no-sandbox');
  });

  it('renders nothing about dependencies against a host that does not report them', async () => {
    // The panel is additive: an older daemon answers the same route without the report, and the page
    // keeps working instead of rendering an empty or half-built block.
    use(dependencyStatus(undefined));
    const view = settings();
    // The capacity, isolation and limits groups still render, so the page is intact without the report.
    expect(await screen.findByText(strings.liveCapacity)).toBeInTheDocument();
    expect(screen.queryByText(strings.depsTitle)).toBeNull();
    expect(view.container.querySelectorAll('[data-settings-group]')).toHaveLength(3);
  });

  it('shows account profile state and runtime capacity without exposing page content', async () => {
    use(
      http.get('/api/plugins/browser/api/profile', () => HttpResponse.json({ profileBytes: 2048, activeSessions: 1 })),
      http.get('/api/plugins/browser/api/sessions', () => HttpResponse.json({ live: [{ id: 'secret-session-id', state: 'agent', lease: null }], history: [] })),
      http.get('/api/plugins/browser/api/admin-status', () => HttpResponse.json({ activeUsers: 1, activeSessions: 1, maxActiveUsers: 4, maxSessionsPerUser: 2, artifactsAvailable: true })),
    );
    const Wrapper = wrapper();
    const view = render(<Wrapper><ToastProvider><BrowserAccount plugin="browser" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);
    expect(await screen.findByText('2.0 KiB')).toBeInTheDocument();
    expect(screen.getByText('secret-sessi…')).toBeInTheDocument();
    view.unmount();
    render(<Wrapper><ToastProvider><BrowserSettings plugin="browser" params={{}} rest={[]} surface="deck" /></ToastProvider></Wrapper>);
    // Capacity is a settings record too: the label names the figure, the badge carries it.
    expect(await screen.findByText(strings.activeAccounts)).toBeInTheDocument();
    expect(screen.getByText('1 / 4')).toBeInTheDocument();
    expect(screen.queryByText('https://example.com')).toBeNull();
  });
});
