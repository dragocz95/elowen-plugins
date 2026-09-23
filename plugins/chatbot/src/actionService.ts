import { randomBytes, randomUUID } from 'node:crypto';
import { decideAction, isActionKind, type ActionRefusal, type ApprovedAction } from './actions.js';
import type { TurnEventBroker } from './broker.js';
import type { ActionRow, TurnRow } from './db.js';
import { readRecordedPageState, type RecordedPageState } from './pageState.js';
import {
  type ActionDecision as VisitorDecision,
  type ActionKind,
  type ActionOutcome,
} from './publicContract.js';
import { readBotLimits } from './limits.js';
import { actionRequestPayload, actionResultPayload, type ChatbotStore } from './store.js';
import { hashToken, sameHash } from './token.js';
import { readPageUrl } from './validation.js';

/** How long one action may wait for the visitor's page before it is closed as unanswered.
 *
 *  There is one number, not one per kind. A page performs an ordinary action at once, so the wait is only
 *  ever spent on a `request_submit`, which waits for a person to read what is about to be sent and click.
 *  A minute is long enough for that and short enough that the turn behind it does not sit there forever. */
const ACTION_WAIT_TIMEOUT_MS = 60_000;

export interface PageActionDeps {
  store: ChatbotStore;
  /** Woken after an action's frame is durable, so a connected widget reads it from its own cursor. */
  broker: TurnEventBroker;
  now: () => Date;
  /** Lifecycle lines for the operator: an action id, a kind, a turn and a status — never a form's value. */
  info: (message: string) => void;
  warn: (message: string) => void;
  /** Injected so a test does not sit through the real wait. */
  timeoutMs?: number;
}

/** Why an action never became one. The policy's own reasons, plus the facts only the server can establish:
 *  the turn recorded no page to act on, the page origin is not allowed, or form submission is disabled. */
export type ActionRequestRefusal = ActionRefusal | 'action_not_allowed' | 'no_page_state';

/** What the tool that asked is told. A refused request has no action id: it never became an action, so no
 *  page was ever asked to do anything. */
export type ActionOutcomeStatus = 'done' | 'error' | 'denied' | 'cancelled' | 'expired';

export type ActionAnswer =
  | {
    status: ActionOutcomeStatus;
    actionId: string;
    kind: ActionKind;
    targetId: string | null;
    /** The value a `read` returned, the page's own code for a failure, or nothing where an answer has no
     *  detail. */
    detail: string | null;
  }
  | { status: 'refused'; reason: ActionRequestRefusal };

/** What a report from the page did to the row. `not_found` covers both an action that does not exist and
 *  one belonging to another visitor's turn: a caller that guessed learns nothing either way. */
export type ActionReportOutcome =
  | { ok: true; row: ActionRow }
  | { ok: false; reason: 'not_found' | 'expired' | 'closed' | 'invalid_nonce' | 'invalid_result' };

/** The page actions of one process: what a turn may ask a page to do, and what happens to the row while it
 *  waits for the answer.
 *
 *  The order is the contract of this module, and it is the order the phases were written in:
 *
 *  1. the request is decided against the description the turn RECORDED, the chatbot's allowed origin,
 *     form-submission switch and the element's own claim — a refusal leaves no trace in the plugin's tables;
 *  2. the action row and the frame that asks the page for it are written in ONE transaction, BEFORE anything
 *     is woken: a widget that reconnects reads the same action a connected one received;
 *  3. the tool waits for the row to reach a state that answers it, and the wait ends either on the page's
 *     own report, on the visitor's decision, or on the fixed timeout;
 *  4. the visitor's confirmation carries a nonce that is consumed exactly once, so a replayed confirmation
 *     is refused rather than becoming a second submission. */
export class PageActionService {
  private readonly waiters = new ActionWaiters();
  private readonly timeoutMs: number;

  constructor(private readonly deps: PageActionDeps) {
    this.timeoutMs = deps.timeoutMs ?? ACTION_WAIT_TIMEOUT_MS;
  }

  /** Decide one action and, if it survives the decision, ask the visitor's page to do it. */
  async request(input: {
    turn: TurnRow;
    chatbotUserId: number;
    /** The brain session the turn runs in. Logged, never trusted: it names the conversation an operator
     *  looking at one action line would want, and it decides nothing. */
    sessionId: string | undefined;
    request: { snapshotId: string | null; kind: string; targetId: string | null; value: string | null };
  }): Promise<ActionAnswer> {
    const { store, warn } = this.deps;
    if (!isActionKind(input.request.kind)) return this.refuse(input, 'unknown_action');
    const kind = input.request.kind;
    // The page the visitor's message was written on, as the turn stored it. A turn stored without one has
    // no page to act on at all.
    const metadata = input.turn.page_url === null ? null : readPageUrl(input.turn.page_url);
    if (!metadata?.ok) return this.refuse(input, 'no_page_state');
    const latest = store.latestPageAction(input.turn.turn_id);
    const recorded = latest?.action === 'snapshot' && latest.status === 'done'
      ? readRecordedPageState(actionResultPayload(latest).detail ?? '') : null;
    if (kind !== 'snapshot' && !recorded?.ok) return this.refuse(input, 'no_page_state');
    const page: RecordedPageState = recorded?.ok ? recorded.value
      : { ...metadata.value, snapshotId: '', targets: [] };

    // The per-turn ceiling is the CHATBOT's own number, and it is the only one: the widget refuses at its own
    // hard limit whatever the server approves, so a server number above that would approve actions no page
    // would perform, and a number invented here would be a budget the owner never set. A chatbot whose limits
    // cannot be read has no ceiling to act under and therefore may not act.
    const bot = store.botByUserId(input.chatbotUserId);
    const limits = readBotLimits(bot);
    if (!limits) {
      warn(`chatbot: turn ${input.turn.turn_id} was asked for a page action but its chatbot has no usable limit configuration`);
      return this.refuse(input, 'action_not_allowed');
    }

    if (!bot || !store.originsOf(input.chatbotUserId).includes(page.origin)) {
      return this.refuse(input, 'action_not_allowed');
    }
    if (kind === 'request_submit' && bot.may_submit_forms !== 1) {
      return this.refuse(input, 'action_not_allowed');
    }

    if (kind === 'navigate') {
      try {
        const url = new URL(input.request.value ?? '');
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
          || !store.originsOf(input.chatbotUserId).includes(url.origin)) return this.refuse(input, 'navigation_not_allowed');
      } catch { return this.refuse(input, 'invalid_value'); }
    }
    const decision = decideAction({
      request: input.request,
      // The snapshot the caller named must be the one this turn recorded, and the targets are the recorded
      // ones: an id is only meaningful inside the description that issued it.
      snapshotId: input.request.snapshotId ?? '',
      turnSnapshotId: page.snapshotId,
      targets: page.targets,
      performedActions: store.actionCountOfTurn(input.turn.turn_id),
      maxActionsPerTurn: limits.maxActionsPerTurn,
    });
    if (!decision.ok) return this.refuse(input, decision.reason);

    return this.dispatch(input, page, decision.action);
  }
  /** `POST …/actions/:actionId/result`: what the page did with an action this plugin approved. */
  reportResult(input: { turn: TurnRow; actionId: string; outcome: ActionOutcome; detail: string | null; origin?: string }): ActionReportOutcome {
    const row = this.ownedAction(input.turn, input.actionId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (!this.live(row)) return { ok: false, reason: 'expired' };
    if (input.outcome === 'done' && row.action === 'snapshot') {
      const parsed = readRecordedPageState(input.detail ?? '');
      if (!parsed.ok || parsed.value.origin !== input.origin
        || !this.deps.store.originsOf(input.turn.chatbot_user_id).includes(parsed.value.origin)) return { ok: false, reason: 'invalid_result' };
    }
    // A denial is the page refusing what the plugin approved. It is recorded as the failure it is, and the
    // widget's own word for it is kept in the result rather than folded into the status: nothing downstream
    // then has to reconstruct which of the two happened.
    const settled = this.deps.store.settleActionResult({
      actionId: row.id,
      status: input.outcome === 'done' ? 'done' : 'error',
      result: JSON.stringify({ schemaVersion: 1, outcome: input.outcome, detail: input.detail }),
      now: this.deps.now().toISOString(),
    });
    if (!settled) return { ok: false, reason: row.status === 'expired' ? 'expired' : 'closed' };
    this.deps.info(`chatbot: action ${row.id} (${actionRequestPayload(settled).kind}) ${input.outcome}`);
    this.waiters.settle(row.id);
    return { ok: true, row: settled };
  }

  /** `POST …/actions/:actionId/confirmation`: the visitor's own answer, carrying the nonce the plugin
   *  issued with the action. The nonce is checked for BOTH answers — the caller has to be the widget this
   *  action was sent to — and only a `confirm` consumes it. */
  reportDecision(input: { turn: TurnRow; actionId: string; decision: VisitorDecision; nonce: string }): ActionReportOutcome {
    const row = this.ownedAction(input.turn, input.actionId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (!this.live(row)) return { ok: false, reason: 'expired' };
    if (row.requires_confirmation !== 1) return { ok: false, reason: 'closed' };
    if (row.status !== 'confirmation_required') return { ok: false, reason: row.status === 'expired' ? 'expired' : 'closed' };
    if (row.confirmation_nonce_hash === null || !sameHash(hashToken(input.nonce), row.confirmation_nonce_hash)) {
      return { ok: false, reason: 'invalid_nonce' };
    }
    const decided = this.deps.store.decideAction({
      actionId: row.id,
      confirmed: input.decision === 'confirm',
      now: this.deps.now().toISOString(),
    });
    if (!decided) return { ok: false, reason: 'closed' };
    this.deps.info(`chatbot: action ${row.id} (${actionRequestPayload(decided).kind}) ${input.decision === 'confirm' ? 'confirmed' : 'declined'}`);
    this.waiters.settle(row.id);
    return { ok: true, row: decided };
  }

  /** The action this visitor's turn owns, or nothing. Ownership is what makes a guess useless: an action id
   *  from another conversation is indistinguishable from one that does not exist. */
  private ownedAction(turn: TurnRow, actionId: string): ActionRow | null {
    const row = this.deps.store.action(actionId);
    return !row || row.turn_id !== turn.turn_id ? null : row;
  }

  /** Whether an action is still one this plugin is waiting on: its own expiry is the line, and a report that
   *  arrives after it is refused as expired rather than folded into a row nobody will read again. What the
   *  row already recorded stays recorded — a visitor's own confirmation is a fact about their decision, not
   *  an open question this refusal somehow reopens. */
  private live(row: ActionRow): boolean {
    return row.expires_at > this.deps.now().toISOString();
  }

  private refuse(input: { turn: TurnRow; request: { kind: string } }, reason: ActionRequestRefusal): ActionAnswer {
    this.deps.warn(`chatbot: action ${input.request.kind} was refused for turn ${input.turn.turn_id}: ${reason}`);
    return { status: 'refused', reason };
  }

  /** Write the action and its frame, wake the widgets, and wait. */
  private async dispatch(
    input: { turn: TurnRow; sessionId: string | undefined },
    page: RecordedPageState,
    action: ApprovedAction,
  ): Promise<ActionAnswer> {
    const { store, broker, info } = this.deps;
    const actionId = randomUUID();
    // The nonce is minted for EVERY action, not only for a submission: the v1 frame carries it always, and a
    // frame without it is one a widget drops rather than guesses about. Only a `request_submit` ever checks
    // it, which is where it is consumed.
    const nonce = randomBytes(16).toString('hex');
    const nowMs = this.deps.now().getTime();
    const row = store.createAction({
      actionId,
      turnId: input.turn.turn_id,
      snapshotId: page.snapshotId,
      kind: action.kind,
      targetId: action.targetId,
      value: action.value,
      requiresConfirmation: action.requiresConfirmation,
      nonceHash: hashToken(nonce),
      expiresAt: new Date(nowMs + this.timeoutMs).toISOString(),
      frame: {
        actionId,
        kind: action.kind,
        targetId: action.targetId,
        value: action.value,
        snapshotId: page.snapshotId,
        requiresConfirmation: action.requiresConfirmation,
        confirmationNonce: nonce,
      },
      now: new Date(nowMs).toISOString(),
    });
    // The row and the frame are durable before anybody is told. A connected widget reads the frame off the
    // turn's own log, and a widget that reconnects reads the same frame again — neither is handed a copy.
    broker.publish(input.turn.turn_id);
    info(`chatbot: action ${actionId} (${action.kind}) requested for turn ${input.turn.turn_id}${input.sessionId === undefined ? '' : ` in ${input.sessionId}`}`);
    return this.awaitOutcome(row);
  }

  /** Wait for a recorded result. Confirmation alone is never evidence that the browser performed it. */
  private async awaitOutcome(created: ActionRow): Promise<ActionAnswer> {
    for (;;) {
      const row = this.deps.store.action(created.id) ?? created;
      if (row.status === 'done' || row.status === 'error') return this.fromResult(row);
      if (row.status === 'cancelled') return this.fromRow(row, 'cancelled', null);
      if (row.status === 'expired') return this.fromRow(row, 'expired', null);

      const waited = await this.waiters.wait(row.id, this.timeoutMs);
      if (waited === 'settled') continue;

      // The wait ran out. `row` was read before it and is re-read only through a CAS: every state this plugin
      // writes goes through a guarded UPDATE followed by a wake-up with nothing awaited in between, so the
      // state the row held when the timer fired is still the state the CAS decides against.
      this.deps.warn(`chatbot: action ${row.id} was never answered by the page and expired`);
      // The CAS decides, and what it returns is the row as it really is now: a state that moved anyway is
      // answered by the row, never by this call's expectation of it.
      const closed = this.deps.store.expireAction(row.id, this.deps.now().toISOString())
        ?? this.deps.store.action(row.id) ?? row;
      switch (closed.status) {
        case 'pending':
        case 'confirmation_required':
        case 'expired':
          return this.fromRow(closed, 'expired', null);
        case 'done':
        case 'error':
          return this.fromResult(closed);
        case 'confirmed':
          return this.fromRow(closed, 'expired', null);
        case 'cancelled':
          return this.fromRow(closed, 'cancelled', null);
      }
    }
  }

  private fromResult(row: ActionRow): ActionAnswer {
    const { outcome, detail } = actionResultPayload(row);
    const status = outcome === 'done' ? 'done' : outcome === 'denied' ? 'denied' : 'error';
    return this.fromRow(row, status, detail);
  }

  /** The answer a caller gets is built from the ROW, never from the request that produced it: what the tool
   *  is told about an action is what the plugin recorded, including the kind and target it really approved. */
  private fromRow(row: ActionRow, status: ActionOutcomeStatus, detail: string | null): ActionAnswer {
    const request = actionRequestPayload(row);
    return { status, actionId: row.id, kind: request.kind, targetId: request.targetId, detail };
  }
}

/** The one thing that wakes a waiting tool: a promise per action, resolved when its row changes state.
 *
 *  Nothing durable lives here — the row IS the state, this is only who is listening to it — so a process
 *  that restarts loses nothing but its own waiters, together with the turns they belong to. */
class ActionWaiters {
  private readonly pending = new Map<string, Set<() => void>>();

  /** Wait for this action to change state. Answers WHICH of the two happened, because "the page said
   *  something" and "the visitor's page is not answering" are different facts about a turn. */
  wait(actionId: string, timeoutMs: number): Promise<'settled' | 'timeout'> {
    return new Promise<'settled' | 'timeout'>((resolve) => {
      const listeners = this.pending.get(actionId) ?? new Set<() => void>();
      let timer: ReturnType<typeof setTimeout>;
      const finish = (outcome: 'settled' | 'timeout'): void => {
        clearTimeout(timer);
        listeners.delete(onSettle);
        if (listeners.size === 0) this.pending.delete(actionId);
        resolve(outcome);
      };
      const onSettle = (): void => finish('settled');
      timer = setTimeout(() => finish('timeout'), timeoutMs);
      listeners.add(onSettle);
      this.pending.set(actionId, listeners);
    });
  }

  settle(actionId: string): void {
    for (const listener of [...(this.pending.get(actionId) ?? [])]) listener();
  }
}