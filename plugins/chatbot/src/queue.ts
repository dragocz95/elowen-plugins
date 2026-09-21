import type { ChatbotAdapter } from './adapter.js';
import { relayEventFields, visitorSource } from './adapter.js';
import type { BotRow, TurnRow } from './db.js';
import type { ChatbotStore } from './store.js';

/** The public event log a website reads. Only these names ever reach a browser, and every one of them is
 *  built from the fields this plugin chose to keep — never from a raw host event. */
const PUBLIC_EVENTS = ['accepted', 'text_delta', 'done', 'error'] as const;
export type PublicEventType = (typeof PUBLIC_EVENTS)[number];

/** Stable public error codes. A visitor learns one of these and nothing about the daemon's internals. */
const PUBLIC_ERROR_CODES = ['turn_failed', 'relay_no_reply', 'server_restarted'] as const;
export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

export interface QueueDeps {
  store: ChatbotStore;
  adapter: ChatbotAdapter;
  /** Injected so the durable log and the internal warning can be observed in a test without a daemon. */
  now: () => string;
  warn: (message: string) => void;
}

/** Runs submitted turns. The POST that submitted one returned 202 and holds nothing open: this worker owns
 *  the relay promise, so a browser that goes away mid-answer cannot cancel the work, and the answer lands in
 *  the durable event log for whoever reconnects.
 *
 *  One turn at a time is a deliberate placeholder: the real per-chatbot concurrency ceiling, the FIFO
 *  bounds and the queue metrics belong to the limits phase, which owns those numbers. What must not wait
 *  for that phase is the shape below — the relay promise is owned here and nowhere else. */
export class ChatbotTurnQueue {
  private pending: string[] = [];
  private draining = false;
  private stopped = false;

  constructor(private deps: QueueDeps) {}

  /** Admit a queued turn. Returns immediately; work happens on the drain loop. */
  submit(turnId: string): void {
    if (this.stopped) return;
    this.pending.push(turnId);
    void this.drain();
  }

  /** Boot reconcile left turns behind that this process never ran. They are not replayed: the core turn is
   *  gone, and pretending to resume it would be a second model turn for one submitted message. */
  stop(): void {
    this.stopped = true;
    this.pending = [];
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const turnId = this.pending.shift();
        if (turnId === undefined || this.stopped) return;
        await this.runOne(turnId);
      }
    } finally {
      this.draining = false;
    }
  }

  private append(turnId: string, type: PublicEventType, data: Record<string, unknown>): void {
    this.deps.store.appendEvent(turnId, type, data, this.deps.now());
  }

  /** Fail a turn with one of the stable public codes and nothing else. */
  private fail(turnId: string, code: PublicErrorCode, sessionId: string | null): void {
    this.append(turnId, 'error', { code });
    this.deps.store.finishTurn({ turnId, status: 'error', coreSessionId: sessionId, errorCode: code, now: this.deps.now() });
  }

  /** Send one turn through the host relay and project what the visitor is allowed to see. */
  async runOne(turnId: string): Promise<void> {
    const { store, adapter, warn } = this.deps;
    const turn: TurnRow | null = store.turn(turnId);
    if (!turn || turn.status !== 'queued') return;
    const bot: BotRow | null = store.botByUserId(turn.chatbot_user_id);
    if (!bot) {
      this.fail(turnId, 'turn_failed', null);
      return;
    }
    // Readiness is re-checked HERE, not only when the request was admitted: a turn can sit in the queue
    // while the adapter is torn down, and a half-wired relay would otherwise run a turn nothing owns.
    const relay = adapter.relay();
    if (!relay) {
      this.fail(turnId, 'turn_failed', null);
      return;
    }

    store.markTurnRunning(turnId, this.deps.now());
    this.append(turnId, 'accepted', {});

    const source = visitorSource({
      chatbotUserId: turn.chatbot_user_id,
      visitorId: turn.visitor_id,
      displayName: bot.display_name,
      instructions: bot.prompt,
    });

    let sessionId: string | null = null;
    try {
      const reply = await relay(source, turn.message, {
        onEvent: (event) => {
          const fields = relayEventFields(event);
          if (fields.type === 'session' && fields.sessionId) {
            sessionId = fields.sessionId;
            return;
          }
          // Everything else is dropped except the answer's own text. The relay event stream also carries
          // reasoning, tool activity, file references and internal error text, and none of that may cross
          // into a log an anonymous visitor reads.
          if (fields.type === 'text' && typeof fields.delta === 'string' && fields.delta !== '') {
            this.append(turnId, 'text_delta', { text: fields.delta });
          }
        },
      });

      // `undefined` is not an empty answer: the seam documents it as a deliberate silence or a refused
      // path, and reporting it as success would show a visitor a blank reply. It is an error here.
      if (reply === undefined) {
        warn(`chatbot turn ${turnId} produced no reply; the relay resolved without one`);
        this.fail(turnId, 'relay_no_reply', sessionId);
        return;
      }

      this.append(turnId, 'done', { text: reply });
      store.finishTurn({ turnId, status: 'done', coreSessionId: sessionId, errorCode: null, now: this.deps.now() });
    } catch (error) {
      // The internal detail stays in the daemon log; the visitor gets a stable code.
      warn(`chatbot turn ${turnId} failed: ${error instanceof Error ? error.message : String(error)}`);
      this.fail(turnId, 'turn_failed', sessionId);
    }
  }
}
