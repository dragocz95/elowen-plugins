/** One visitor's conversation: the token, the turn, the stream, and the actions the server approved.
 *
 *  This module is the widget's brain and holds no DOM of its own. It talks to two seams — a view (the panel
 *  that shows and asks) and a page bridge (the visitor's page, described and acted on) — so that the whole
 *  conversation can be exercised without a browser, and so that nothing in the panel decides anything the
 *  protocol already decided.
 *
 *  The three properties this file exists to keep:
 *
 *  - page structure is captured only for an explicit snapshot action;
 *  - an answer survives a lost connection: the stream resumes from the last sequence number that was
 *    rendered, so a reconnect shows the missing part and never a doubled one;
 *  - nothing is done to the page that the server did not approve for THIS turn's snapshot, and a submit
 *    happens only after the visitor confirmed it in person. */

import {
  EVENTS_AFTER_QUERY,
  MESSAGE_MAX_BYTES,
  PUBLIC_PATHS,
  PUBLIC_SCHEMA_VERSION,
  VISITOR_CREDENTIAL_ERRORS,
  VISITOR_AUTHORIZATION_SCHEME,
  WIDGET_MAX_ACTIONS_PER_TURN,
  type ActionOutcome,
  type PageFailureDetail,
} from '../src/publicContract.js';
import { readOffer, type Offer } from '../src/offerContract.js';
import { parseAppearance, type ChatbotLook } from '../src/appearanceContract.js';
import { decideAction, type ActionRefusal, type ActionTarget, type ApprovedAction } from '../src/actions.js';
import {
  actionDecisionBody,
  actionResultBody,
  byteLength,
  newClientTurnId,
  parseFrame,
  readActionFrame,
  readLines,
  schemaVersionBody,
  turnRequestBody,
  publicBotRequestBody,
  type ActionFrame,
} from './protocol.js';
import { FORM_INVALID, TARGET_GONE, type ActionReport, type PerformableAction } from './pageActions.js';
import { fillTemplate, type WidgetStrings } from './strings.js';

/** The panel, as the conversation needs it: it shows, it asks, and it never decides. */
export interface ChatView {
  /** A message the visitor sent, when the panel did not show it itself. */
  appendVisitor(text: string): void;
  /** The moment the visitor's message went out: show that an answer is coming. */
  beginAnswer(): void;
  /** One delta of an answer still arriving. */
  streamAnswer(text: string): void;
  /** The answer as it finally stands. Used for the terminal frame and for a restored transcript. */
  finishAnswer(text: string): Promise<void> | void;
  /** Something the visitor should know that is not an answer: a decline, a reconnection. */
  notice(text: string): void;
  error(text: string): void;
  /** A transcript rebuilt from the server's projection. */
  restore(messages: { role: 'user' | 'ai'; text: string; offer?: Offer; offerActive?: boolean }[]): void;
  setAllowedOrigins(origins: string[]): void;
  showOffer(offer: Offer, active: boolean): void;
  /** Ask the visitor to confirm an irreversible action. Resolves true ONLY for a click the visitor
   *  themselves made; anything the page can call on its own resolves false. */
  confirm(request: { title: string }): Promise<boolean>;
}

/** The visitor's page, as the conversation needs it. */
export interface PageBridge {
  /** Describe the page now and keep the handles the ids refer to. */
  capture(): CapturedPage;
  metadata(): { url: string; title: string };
  takeHandoff(): string | null;
  navigate(url: string): void;
  /** Whether the handles of this snapshot are still the ones the bridge holds. */
  holds(snapshotId: string): boolean;
  /** A short, human label for one target, for the confirmation the visitor reads. */
  describeTarget(snapshotId: string, targetId: string): string;
  perform(snapshotId: string, action: PerformableAction): Promise<ActionReport>;
  submit(snapshotId: string, targetId: string): Promise<ActionReport>;
}

export interface CapturedPage {
  snapshotId: string;
  json: string;
  targets: ActionTarget[];
}

export interface SessionDeps {
  /** The public surface, without a trailing slash: `https://host/hooks/chatbot/v2`. */
  baseUrl: string;
  publicId: string;
  view: ChatView;
  page: PageBridge;
  fetch: typeof fetch;
  /** Where the visitor token waits between page loads. `null` keeps everything in memory, which is what a
   *  browser that refuses storage gets. */
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  strings: WidgetStrings;
  /** Injected so a test does not wait in real time for a reconnect. */
  sleep?: (ms: number) => Promise<void>;
}

/** How many times a dropped stream is picked up again before the visitor is told. A stream that keeps
 *  failing is a fact about the deployment, not something to keep retrying behind a spinner. */
const RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 400;

export class ChatSession {
  private token: string | null = null;
  private readonly strings: WidgetStrings;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Last sequence number rendered per turn: what a reconnect resumes from. */
  private readonly cursors = new Map<string, number>();
  /** The snapshot each turn's targets belong to, kept in memory ONLY: a reload has no business acting on
   *  a page it never described. */
  private readonly snapshots = new Map<string, CapturedPage>();
  private readonly performed = new Map<string, number>();
  private aborter: AbortController | null = null;
  private destroyed = false;
  /** Replay earlier text but only actions still pending in the durable conversation. */
  private readonly restoring = new Map<string, { through: number; pending: Set<string> }>();
  private readonly handling = new Set<string>();
  private handoff: string | null;
  private handoffFailed = false;
  private acquiringToken: Promise<string> | null = null;
  private allowedOrigins: string[] = [];
  private readonly offers = new Map<string, Offer>();

  constructor(private readonly deps: SessionDeps) {
    this.strings = deps.strings;
    this.sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); }));
    this.token = this.readStoredToken();
    this.handoff = deps.page.takeHandoff();
    // A framework or an early reload can restore the navigation fragment. A receipt is only useful
    // alongside a token: without credentials, redemption is still the only possible way in.
    if (this.token !== null && this.handoff === this.readHandoffReceipt()) this.handoff = null;
  }

  /** Whether this browser already holds a visitor token, which is the same question as "has this visitor
   *  engaged with the panel before". A page whose panel has never been opened answers NO, and that is what
   *  keeps such a page from reaching the hook at all. */
  hasStoredToken(): boolean {
    return this.token !== null || this.handoff !== null;
  }

  /** Pick the conversation up where the visitor left it, if this browser ever had one. Nothing is sent to
   *  the server when it did not: a page load with an untouched panel makes no request at all. */
  async start(): Promise<void> {
    if (this.handoff !== null) {
      try { await this.ensureToken(); } catch { this.deps.view.error(this.strings.errorUnavailable); return; }
    }
    if (this.token === null) return;
    const conversation = await this.getConversation();
    if (!conversation) { this.deps.view.error(this.strings.errorUnavailable); return; }
    const messages: { role: 'user' | 'ai'; text: string; offer?: Offer; offerActive?: boolean }[] = [];
    for (const [index, turn] of conversation.turns.entries()) {
      if (typeof turn.message !== 'string') continue;
      messages.push({ role: 'user', text: turn.message });
      if (turn.turnId === conversation.activeTurnId) {
        this.cursors.set(turn.turnId, 0);
        this.restoring.set(turn.turnId, { through: turn.lastSeq, pending: new Set(turn.pendingActions) });
      } else {
        if (typeof turn.reply === 'string' && turn.reply !== '') {
          const offer = readOffer(turn.offer, this.allowedOrigins);
          messages.push({ role: 'ai', text: turn.reply, ...(offer ? { offer, offerActive: index === conversation.turns.length - 1 && conversation.activeTurnId === null } : {}) });
        }
        this.cursors.set(turn.turnId, turn.lastSeq);
      }
    }
    if (messages.length > 0) this.deps.view.restore(messages);
    if (conversation.activeTurnId !== null) {
      // A turn was still running when the visitor reloaded: its answer is in the durable log, and the feed
      // picks it up from what was already rendered.
      this.deps.view.beginAnswer();
      void this.follow(conversation.activeTurnId);
    }
  }

  /** How this chatbot's panel looks, and the name that goes with it.
   *
   *  The read-only, origin-gated bootstrap is the single look path for new and returning visitors. Every
   *  refusal answers `null`; the caller keeps the panel unattached rather than showing the built-in look. */
  async loadAppearance(): Promise<ChatbotLook | null> {
    const response = await this.request(null, 'POST', PUBLIC_PATHS.bootstrap, publicBotRequestBody(this.deps.publicId));
    if (!response || !response.ok) return null;
    const body = await readJson(response);
    if (!body) return null;
    const parsed = parseAppearance(body.appearance);
    if (!parsed.ok) {
      console.warn(`[elowen-chatbot] the appearance this deployment served is not one this widget reads: ${parsed.error}`);
      return null;
    }
    this.allowedOrigins = Array.isArray(body.allowedOrigins)
      ? body.allowedOrigins.filter((value): value is string => typeof value === 'string' && value.length <= 4096)
      : [];
    this.deps.view.setAllowedOrigins(this.allowedOrigins);
    return { name: typeof body.name === 'string' ? body.name : '', appearance: parsed.value };
  }

  /** The chatbot's avatar as BYTES, over the connection the widget already owns.
   *
   *  The panel cannot load the owner's image address itself. A customer's Content-Security-Policy decides
   *  which image hosts their page may reach, and a widget that asked them to add an arbitrary address to it
   *  would be asking a customer to widen their own security policy on our behalf. What their page already
   *  allows is this widget's origin on `connect-src`, so the image comes from the public surface — which is
   *  the same connection, the same credential and the same origin gate as every other read here — and the
   *  panel renders the bytes from memory.
   *
   *  Every refusal answers `null`: no avatar configured, an address this deployment will not fetch, a
   *  deployment that cannot reach it, an answer that is not an image. `null` is a panel WITHOUT an avatar,
   *  which is a panel that works, and it is never retried — one ask per page load, and no request at all for
   *  a look that needs none. */
  async loadAvatar(): Promise<Blob | null> {
    let token: string;
    try {
      token = await this.ensureToken();
    } catch {
      return null;
    }
    // The answer is an image rather than a JSON body, which is the one thing about this request that differs
    // from every other one the widget makes.
    const response = await this.request(token, 'GET', PUBLIC_PATHS.avatar, null, undefined, false, 'image/*');
    if (!response || !response.ok) return null;
    try {
      return await response.blob();
    } catch {
      return null;
    }
  }

  /** Send one message. `shown` says the panel already displayed it — a submit through the panel's own input
   *  is shown by the panel itself, while a message sent on the visitor's behalf is not. */
  async send(text: string, options: { shown?: boolean } = {}): Promise<void> {
    if (this.destroyed) return;
    const message = text.trim();
    if (message === '') return;
    // An overlong message is refused here rather than by the hook, where it would surface as a failure of
    // the whole turn.
    if (byteLength(message) > MESSAGE_MAX_BYTES) {
      this.deps.view.error(this.strings.errorTooLong);
      return;
    }
    if (!options.shown) this.deps.view.appendVisitor(message);
    this.deps.view.beginAnswer();

    let token: string;
    try {
      token = await this.ensureToken();
    } catch {
      this.deps.view.error(this.strings.errorUnavailable);
      return;
    }

    // Only the address and title travel with the message, beside it. Page structure requires an explicit
    // snapshot action.
    const clientTurnId = newClientTurnId();
    const reply = await this.request(token, 'POST', PUBLIC_PATHS.turns, turnRequestBody(clientTurnId, message, this.deps.page.metadata()));
    if (!reply || reply.status !== 202) {
      await this.handleSendFailure(reply);
      return;
    }
    const body = await readJson(reply);
    const turnId = typeof body?.turnId === 'string' ? body.turnId : null;
    if (!turnId) {
      this.deps.view.error(this.strings.errorTurn);
      return;
    }
    this.cursors.set(turnId, 0);
    await this.follow(turnId);
  }

  destroy(): void {
    this.destroyed = true;
    this.aborter?.abort();
    this.aborter = null;
  }

  /** Stop watching the answer that is arriving. The turn is NOT cancelled: it runs on the server, owned by
   *  the chatbot's account, and the log it keeps writing is what a later connection reads. Looking away must
   *  never be able to stop work that was already submitted. */
  stopWatching(): void {
    this.aborter?.abort();
    this.aborter = null;
  }

  // ── the stream ─────────────────────────────────────────────────────────────────────────────────────

  /** Follow one turn's public log to its end, resuming from what was rendered if the connection drops. */
  private async follow(turnId: string): Promise<void> {
    this.aborter?.abort();
    const aborter = new AbortController();
    this.aborter = aborter;

    for (let attempt = 0; ; attempt += 1) {
      if (this.destroyed || aborter.signal.aborted) return;
      const after = this.cursors.get(turnId) ?? 0;
      const path = `${PUBLIC_PATHS.events(turnId)}?${EVENTS_AFTER_QUERY}=${after}`;
      let response: Response | null;
      try {
        response = await this.request(this.token, 'GET', path, null, aborter.signal);
      } catch {
        response = null;
      }
      if (this.destroyed || aborter.signal.aborted) return;

      if (await invalidCredential(response)) {
        const refreshed = await this.refreshToken();
        // A new visitor cannot read a turn owned by the old visitor. Never retry it under that identity.
        if (refreshed === 'rotated' && attempt < RECONNECT_ATTEMPTS) continue;
        this.deps.view.error(this.strings.errorUnavailable);
        return;
      }

      const terminal: 'ended' | 'dropped' = response && response.ok && response.body
        ? await this.consume(turnId, response.body)
        : 'dropped';

      if (terminal === 'ended') return;
      if (attempt >= RECONNECT_ATTEMPTS) {
        this.deps.view.error(this.strings.errorTurn);
        return;
      }
      this.deps.view.notice(this.strings.reconnecting);
      // Bounded exponential backoff: a deployment that is restarting answers on the second or third try,
      // and one that is down is not made worse by hammering it.
      await this.sleep(RECONNECT_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  /** Read the NDJSON body frame by frame. Returns why it stopped: a terminal frame, or a body that ended
   *  without one. */
  private async consume(turnId: string, body: ReadableStream<Uint8Array>): Promise<'ended' | 'dropped'> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { lines, rest } = readLines(buffer);
        buffer = rest;
        for (const line of lines) {
          const outcome = await this.handleLine(turnId, line);
          if (outcome === 'ended') return 'ended';
        }
      }
      // A body that ends without a terminal frame is a stream this client lost, not a turn that finished:
      // the log is durable, so the answer is picked up from the last rendered sequence number.
      return 'dropped';
    } catch {
      return 'dropped';
    } finally {
      reader.releaseLock();
    }
  }

  private async handleLine(turnId: string, line: string): Promise<'continue' | 'ended'> {
    const frame = parseFrame(line);
    if (!frame) return 'continue';
    if (frame.seq <= (this.cursors.get(turnId) ?? 0)) return 'continue';
    this.cursors.set(turnId, frame.seq);
    switch (frame.type) {
      case 'accepted':
        return 'continue';
      case 'text_delta': {
        const text = frame.data.text;
        if (typeof text === 'string' && text !== '') this.deps.view.streamAnswer(text);
        return 'continue';
      }
      case 'done': {
        const text = frame.data.text;
        await this.deps.view.finishAnswer(typeof text === 'string' ? text : '');
        const offer = this.offers.get(turnId);
        this.offers.delete(turnId);
        if (offer) this.deps.view.showOffer(offer, true);
        return 'ended';
      }
      case 'offer': {
        const offer = readOffer(frame.data, this.allowedOrigins);
        if (offer) this.offers.set(turnId, offer);
        return 'continue';
      }
      case 'error': {
        this.offers.delete(turnId);
        // Every public error code means the same thing to a visitor: this answer is not coming. The code is
        // kept for the log the server keeps, not for a sentence a customer's visitor has to interpret.
        this.deps.view.error(this.strings.errorTurn);
        return 'ended';
      }
      case 'action': {
        // Deliberately NOT awaited. An action can wait on the visitor — a submit waits for their click — and a
        // stream reader parked on that would hold back every frame after it, including the end of the answer.
        // The action reports itself when it is done; the answer keeps arriving in the meantime.
        const restored = this.restoring.get(turnId);
        if (!restored || frame.seq > restored.through || restored.pending.has(String(frame.data.actionId))) {
          void this.handleAction(turnId, frame.data);
        }
        return 'continue';
      }
      case 'ping':
      default:
        return 'continue';
    }
  }

  // ── page actions ───────────────────────────────────────────────────────────────────────────────────

  /** One action the server approved. It is checked again here against the turn's own snapshot and the
   *  policy the server itself uses, and a refusal is REPORTED rather than quietly skipped: the server's
   *  record of what happened has to match what the page did. */
  private async handleAction(turnId: string, data: Record<string, unknown>): Promise<void> {
    try {
      await this.decideAndAct(turnId, data);
    } catch {
      // The panel is the only thing that can report an action, so a panel that throws mid-action leaves one
      // honest option: say the action did not happen. Nothing here may swallow an action into silence.
      await this.reportAction(turnId, String(data.actionId ?? ''), 'denied', 'widget_error' satisfies PageFailureDetail);
    }
  }

  private async decideAndAct(turnId: string, data: Record<string, unknown>): Promise<void> {
    const frame = readActionFrame(data);
    if (!frame || this.handling.has(frame.actionId)) return;
    this.handling.add(frame.actionId);
    if (frame.kind === 'snapshot') {
      const decision = decideAction({
        request: { kind: frame.kind, targetId: frame.targetId, value: frame.value },
        snapshotId: '', turnSnapshotId: '', targets: [],
        performedActions: this.performed.get(turnId) ?? 0, maxActionsPerTurn: WIDGET_MAX_ACTIONS_PER_TURN,
      });
      if (!decision.ok) { await this.reportAction(turnId, frame.actionId, 'denied', decision.reason); return; }
      const captured = this.deps.page.capture();
      this.snapshots.set(turnId, captured);
      this.performed.set(turnId, (this.performed.get(turnId) ?? 0) + 1);
      await this.reportAction(turnId, frame.actionId, 'done', captured.json);
      return;
    }
    const snapshot = this.snapshots.get(turnId) ?? null;
    if (!snapshot || !this.deps.page.holds(frame.snapshotId) || snapshot.snapshotId !== frame.snapshotId) {
      await this.reportAction(turnId, frame.actionId, 'denied', 'stale_snapshot' satisfies ActionRefusal);
      this.deps.view.notice(this.strings.actionStale);
      return;
    }

    const decision = decideAction({
      request: { kind: frame.kind, targetId: frame.targetId, value: frame.value },
      snapshotId: frame.snapshotId,
      turnSnapshotId: snapshot.snapshotId,
      targets: snapshot.targets,
      performedActions: this.performed.get(turnId) ?? 0,
      maxActionsPerTurn: WIDGET_MAX_ACTIONS_PER_TURN,
    });
    if (!decision.ok) {
      await this.reportAction(turnId, frame.actionId, 'denied', decision.reason);
      return;
    }

    // The action is counted the moment it is approved: a submit the visitor declined still spent one of the
    // turn's actions, and a page that refuses them all must not be asked forever.
    this.performed.set(turnId, (this.performed.get(turnId) ?? 0) + 1);

    const action = decision.action;
    if (action.kind === 'navigate') {
      await this.navigate(turnId, frame);
    } else if (action.requiresConfirmation) {
      await this.confirmedSubmit(turnId, frame, snapshot, action);
    } else {
      const report = await this.deps.page.perform(frame.snapshotId, action as PerformableAction);
      await this.finishAction(turnId, frame.actionId, report);
    }
  }

  /** A submit: the visitor's own click, then the server's acceptance of it, and only then the form. */
  private async confirmedSubmit(
    turnId: string,
    frame: ActionFrame,
    snapshot: CapturedPage,
    action: ApprovedAction,
  ): Promise<void> {
    const title = this.deps.page.describeTarget(snapshot.snapshotId, action.targetId ?? '');
    const confirmed = await this.deps.view.confirm({
      title: fillTemplate(this.strings.confirmTitle, { form: title === '' ? '' : `„${title}“` }),
    });
    if (!confirmed) {
      await this.reportDecision(turnId, frame, 'decline');
      this.deps.view.notice(this.strings.confirmDeclined);
      return;
    }
    // The decision goes to the server BEFORE the form does. A confirmation that cannot be recorded is a
    // confirmation the server never gave, and submitting anyway is exactly the silent submit the whole
    // confirmation exists to prevent.
    const accepted = await this.reportDecision(turnId, frame, 'confirm');
    if (!accepted) {
      this.deps.view.error(this.strings.confirmUnavailable);
      return;
    }
    const report = await this.deps.page.submit(snapshot.snapshotId, action.targetId ?? '');
    await this.finishAction(turnId, frame.actionId, report);
  }

  private async finishAction(turnId: string, actionId: string, report: ActionReport): Promise<void> {
    await this.reportAction(turnId, actionId, report.outcome, report.detail);
    if (report.outcome === 'error' && report.detail !== FORM_INVALID) {
      this.deps.view.notice(report.detail === TARGET_GONE ? this.strings.actionStale : this.strings.actionFailed);
    }
  }

  private async reportAction(turnId: string, actionId: string, outcome: ActionOutcome, detail?: string): Promise<void> {
    const response = await this.request(this.token, 'POST', PUBLIC_PATHS.actionResult(turnId, actionId),
      actionResultBody(outcome, detail), undefined, true);
    if (!response || !response.ok) this.deps.view.error(this.strings.actionFailed);
  }

  /** Returns whether the server recorded the visitor's answer. */
  private async reportDecision(turnId: string, frame: ActionFrame, decision: 'confirm' | 'decline'): Promise<boolean> {
    const response = await this.request(
      this.token,
      'POST',
      PUBLIC_PATHS.actionDecision(turnId, frame.actionId),
      actionDecisionBody(decision, frame.confirmationNonce),
      undefined,
      true,
    );
    return response !== null && response.ok;
  }

  private async navigate(turnId: string, frame: ActionFrame): Promise<void> {
    const response = await this.request(this.token, 'POST', PUBLIC_PATHS.handoff,
      { schemaVersion: PUBLIC_SCHEMA_VERSION, turnId, actionId: frame.actionId });
    const body = response?.ok ? await readJson(response) : null;
    if (typeof body?.url !== 'string') {
      await this.reportAction(turnId, frame.actionId, 'error', 'navigation_failed');
      this.deps.view.notice(this.strings.navigationFailed);
      return;
    }
    this.deps.view.notice(this.strings.navigating);
    const destination = new URL(body.url);
    const requested = new URL(frame.value ?? '');
    if (destination.origin !== requested.origin || destination.pathname !== requested.pathname || destination.search !== requested.search) {
      await this.reportAction(turnId, frame.actionId, 'denied', 'navigation_not_allowed');
      return;
    }
    this.snapshots.clear();
    this.deps.page.navigate(destination.href);
  }

  // ── token handling ─────────────────────────────────────────────────────────────────────────────────

  private ensureToken(): Promise<string> {
    if (this.acquiringToken) return this.acquiringToken;
    this.acquiringToken = this.acquireToken().finally(() => { this.acquiringToken = null; });
    return this.acquiringToken;
  }

  private async acquireToken(): Promise<string> {
    if (this.handoffFailed) throw new Error('Navigation handoff refused');
    if (this.handoff !== null) {
      const code = this.handoff;
      this.handoff = null;
      const response = await this.request(null, 'POST', PUBLIC_PATHS.handoff,
        { schemaVersion: PUBLIC_SCHEMA_VERSION, bot: this.deps.publicId, code });
      const body = response?.ok ? await readJson(response) : null;
      if (typeof body?.token !== 'string' || body.token === '') {
        // Refusing a one-time code says nothing about the browser's stored visitor credential.
        // Let the authenticated conversation endpoint validate it, without replacing that identity.
        if (this.token !== null) return this.token;
        this.handoffFailed = true;
        this.deps.view.error(this.strings.navigationFailed);
        throw new Error('Navigation handoff refused');
      }
      this.rememberToken(body.token);
      this.rememberHandoffReceipt(code);
    }
    if (this.token !== null) return this.token;
    const response = await this.request(null, 'POST', PUBLIC_PATHS.visitors, publicBotRequestBody(this.deps.publicId));
    if (!response || !response.ok) throw new Error('token request refused');
    const body = await readJson(response);
    const token = typeof body?.token === 'string' ? body.token : null;
    if (!token) throw new Error('token response carried no token');

    this.rememberToken(token);
    return token;
  }

  /** Called only after an explicit credential rejection. The refresh route accepts live tokens only:
   *  expiry cannot be rotated there. A transient or unreadable refresh refusal still keeps the credential;
   *  only its explicit invalid-credential response permits starting a new visitor. */
  private async refreshToken(): Promise<'rotated' | 'replaced' | false> {
    const rotated = await this.request(this.token, 'POST', PUBLIC_PATHS.refresh, schemaVersionBody());
    if (rotated?.ok) {
      const body = await readJson(rotated);
      if (typeof body?.token !== 'string' || body.token === '') return false;
      this.rememberToken(body.token);
      return 'rotated';
    }
    if (!await invalidCredential(rotated)) return false;
    this.forgetToken();
    try {
      await this.ensureToken();
      return 'replaced';
    } catch {
      return false;
    }
  }

  private async getConversation(retryCredential = true): Promise<{ turns: ConversationTurn[]; activeTurnId: string | null } | null> {
    const response = await this.request(this.token, 'GET', PUBLIC_PATHS.conversation, null);
    if (!response || !response.ok) {
      if (retryCredential && await invalidCredential(response) && await this.refreshToken()) return this.getConversation(false);
      return null;
    }
    const body = await readJson(response);
    if (!body || !Array.isArray(body.turns)) return null;
    const turns: ConversationTurn[] = [];
    for (const entry of body.turns) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.turnId !== 'string') continue;
      turns.push({
        turnId: record.turnId,
        message: record.message,
        reply: record.reply,
        offer: record.offer,
        lastSeq: typeof record.lastSeq === 'number' && record.lastSeq >= 0 ? record.lastSeq : 0,
        pendingActions: Array.isArray(record.pendingActions) ? record.pendingActions.filter((id): id is string => typeof id === 'string') : [],
      });
    }
    return {
      turns,
      activeTurnId: typeof body.activeTurnId === 'string' ? body.activeTurnId : null,
    };
  }

  // ── requests ──────────────────────────────────────────────────────────────────────────────────────

  /** One request to the public surface. Everything the widget sends goes through here, so the credential,
   *  the content type and the absence of cookies are stated once. `accept` is the one thing a caller may
   *  vary: every answer is a JSON body except the avatar's, which is an image. */
  private async request(
    token: string | null,
    method: 'GET' | 'POST',
    path: string,
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
    keepalive = false,
    accept = 'application/json',
  ): Promise<Response | null> {
    const headers: Record<string, string> = { accept };
    if (body !== null) headers['content-type'] = 'application/json';
    if (token !== null) headers.authorization = `${VISITOR_AUTHORIZATION_SCHEME} ${token}`;
    try {
      return await this.deps.fetch(`${this.deps.baseUrl}/${path}`, {
        method,
        headers,
        // The visitor's conversation belongs to this tab and to nobody else: an ambient cookie from the
        // customer's site must never travel with it.
        credentials: 'omit',
        mode: 'cors',
        ...(body === null ? {} : { body: JSON.stringify(body) }),
        ...(signal === undefined ? {} : { signal }),
        ...(keepalive ? { keepalive: true } : {}),
      });
    } catch {
      return null;
    }
  }

  private async handleSendFailure(response: Response | null): Promise<void> {
    if (await invalidCredential(response)) await this.refreshToken();
    // A refused or unavailable chatbot is the same thing to a visitor: nobody is there to answer. A budget
    // or rate refusal is deliberately not distinguished either — a visitor cannot act on the difference.
    this.deps.view.error(this.strings.errorUnavailable);
  }

  // ── the token the widget keeps ────────────────────────────────────────────────────────────────────

  private get storageKey(): string {
    return `elowen.chatbot.${this.deps.publicId}.token`;
  }

  private readHandoffReceipt(): string | null {
    try {
      return this.deps.storage?.getItem(`${this.storageKey}.handoff`) ?? null;
    } catch {
      return null; // Storage is optional; the server still enforces single use.
    }
  }

  private rememberHandoffReceipt(code: string): void {
    try {
      // Only the latest successfully spent code is retained, never an unbounded navigation log.
      this.deps.storage?.setItem(`${this.storageKey}.handoff`, code);
    } catch {
      // A browser that cannot persist a receipt can still resume with its stored token.
    }
  }

  private readStoredToken(): string | null {
    try {
      const value = this.deps.storage?.getItem(this.storageKey) ?? null;
      return value === '' ? null : value;
    } catch {
      return null;
    }
  }

  private rememberToken(token: string): void {
    this.token = token;
    try {
      this.deps.storage?.setItem(this.storageKey, token);
    } catch {
      // A browser that refuses storage still gets a working conversation for as long as the page lives.
    }
  }

  private forgetToken(): void {
    this.token = null;
    try {
      this.deps.storage?.removeItem(this.storageKey);
    } catch {
      // Nothing to do: the value was never stored.
    }
  }
}

/** Status alone is not evidence: gateways and unavailable deployments can also return 401. */
async function invalidCredential(response: Response | null): Promise<boolean> {
  if (response?.status !== 401) return false;
  const body = await readJson(response);
  return body?.error === VISITOR_CREDENTIAL_ERRORS.required || body?.error === VISITOR_CREDENTIAL_ERRORS.invalid;
}

interface ConversationTurn {
  turnId: string;
  message: unknown;
  reply: unknown;
  offer: unknown;
  lastSeq: number;
  pendingActions: string[];
}

/** A body the caller then validates field by field. A response that is not JSON is not an answer. */
async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}