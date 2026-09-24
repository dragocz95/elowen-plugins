import { relayEventFields, visitorSource } from './adapter.js';
import { readBotLimits } from './limits.js';
import { publicAttachment } from './visitorImages.js';
/** How many turns one pump pass will close when a chatbot cannot run any at all. A bound, not a policy: the
 *  loop it guards is one that always shrinks the queue, and this only stops it if that ever stops being true. */
const UNRUNNABLE_DRAIN_LIMIT = 100;
/** Runs submitted turns.
 *
 *  The POST that submitted one returned 202 and holds nothing open: this worker owns the relay promise, so a
 *  browser that goes away mid-answer cannot cancel the work, and the answer lands in the durable event log for
 *  whoever reconnects.
 *
 *  What runs, and how much of it, is decided by DURABLE state and the chatbot's own numbers, not by a list
 *  held in this process:
 *
 *  - at most `max_concurrent_turns` of one chatbot's turns run at once, counted from the turn rows
 *    themselves, so a restart cannot leave a slot held by a turn nobody runs;
 *  - the oldest waiting turn of a chatbot goes first (FIFO by `created_at`, then by id);
 *  - a turn that waits longer than `queue_timeout_seconds` is closed as `queue_timeout` without a model call;
 *  - a turn whose chatbot has no usable limits is failed rather than run under a number this queue invented.
 *
 *  Depth and admission are NOT decided here: a turn only exists because the public route admitted it against
 *  the same numbers, in the database, before this class was told anything. */
export class ChatbotTurnQueue {
    deps;
    /** Chatbots with work that has not been dispatched yet. A hint, not a queue: what runs is read from the
     *  store, and this set only says which chatbots are worth asking about. */
    dirty = new Set();
    deadlines = new Map();
    pumping = false;
    constructor(deps) {
        this.deps = deps;
    }
    /** Admit a queued turn into this process. Returns immediately; the work happens on the pump. */
    submit(turnId) {
        const turn = this.deps.store.turn(turnId);
        if (!turn)
            return;
        this.watchDeadline(turn);
        this.dirty.add(turn.chatbot_user_id);
        this.pump();
    }
    /** Dispatch whatever may run right now, for one pass. Synchronous on purpose: every decision below is a
     *  compare-and-set against the rows, so a second pass cannot interleave with this one and see a slot this
     *  one has already taken. The launched turns are not awaited — they are why the class exists. */
    pump() {
        if (this.pumping)
            return;
        this.pumping = true;
        try {
            for (const chatbotUserId of [...this.dirty]) {
                const bot = this.deps.store.botByUserId(chatbotUserId);
                if (!bot) {
                    // The bot row is gone while turns of it are not. Nothing here invents a bot: the turns are closed
                    // so no visitor waits on a chatbot that no longer exists.
                    this.drainUnrunnable(chatbotUserId, 'the chatbot is no longer registered');
                    this.dirty.delete(chatbotUserId);
                    continue;
                }
                const limits = readBotLimits(bot);
                if (!limits) {
                    this.drainUnrunnable(chatbotUserId, 'the chatbot has no usable limits');
                    this.dirty.delete(chatbotUserId);
                    continue;
                }
                // The count is re-read every iteration rather than kept in a local number: a turn that failed
                // synchronously inside this same pass has already given its slot back, and this loop is then free to
                // dispatch the next one instead of stopping one turn short.
                while (this.deps.store.runningCount(chatbotUserId) < limits.maxConcurrentTurns) {
                    const next = this.deps.store.nextQueuedTurn(chatbotUserId);
                    if (!next) {
                        this.dirty.delete(chatbotUserId);
                        break;
                    }
                    // Claim it. A lost claim means another process took this turn; the row has left the waiting set, so
                    // the next read returns a different one and this loop still makes progress.
                    if (!this.deps.store.markTurnRunning(next.turn_id, this.deps.now()))
                        break;
                    this.clearDeadline(next.turn_id);
                    void this.runTurn(next.turn_id, bot).catch((error) => {
                        // The only handler left: this call is not awaited, and a failure here would otherwise be an
                        // unhandled rejection that takes the daemon with it.
                        this.deps.warn(`chatbot: turn ${next.turn_id} left the queue unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
                    });
                }
            }
        }
        finally {
            this.pumping = false;
        }
    }
    /** Ask again after something settled: a slot may have come free for the next waiting turn. */
    poke(chatbotUserId) {
        this.dirty.add(chatbotUserId);
        this.pump();
    }
    /** Close every waiting turn of a chatbot that cannot run any of them, oldest first. Bounded, and only ever
     *  reached by a state admission already refuses to serve: it exists so a visitor is told, instead of waiting
     *  forever on a turn nothing will pick up. */
    drainUnrunnable(chatbotUserId, reason) {
        for (let guard = 0; guard < UNRUNNABLE_DRAIN_LIMIT; guard += 1) {
            const next = this.deps.store.nextQueuedTurn(chatbotUserId);
            if (!next)
                return;
            this.deps.warn(`chatbot: turn ${next.turn_id} cannot run: ${reason}`);
            this.clearDeadline(next.turn_id);
            this.fail(next.turn_id, 'turn_failed', null);
        }
        this.deps.warn(`chatbot: chatbot ${chatbotUserId} stopped being drained after ${UNRUNNABLE_DRAIN_LIMIT} failed turns`);
    }
    /** Start the clock on a turn's own wait. A chatbot whose timeout is not configured schedules nothing: the
     *  deadline is a number the owner sets, and this queue does not invent one. */
    watchDeadline(turn) {
        const limits = readBotLimits(this.deps.store.botByUserId(turn.chatbot_user_id));
        if (!limits)
            return;
        const deadline = Date.parse(turn.created_at) + limits.queueTimeoutSeconds * 1_000;
        const delay = Math.max(0, deadline - Date.parse(this.deps.now()));
        const cancel = (this.deps.schedule ?? defaultSchedule)(turn.turn_id, delay, () => this.expireWaiting(turn.turn_id));
        this.deadlines.set(turn.turn_id, cancel);
    }
    clearDeadline(turnId) {
        this.deadlines.get(turnId)?.();
        this.deadlines.delete(turnId);
    }
    /** A waiting turn's clock ran out. Only a turn that is STILL waiting is closed: one that started, finished
     *  or was already closed has a state of its own, and this timer says nothing about it. */
    expireWaiting(turnId) {
        this.deadlines.delete(turnId);
        const turn = this.deps.store.turn(turnId);
        if (!turn || turn.status !== 'queued')
            return;
        this.deps.warn(`chatbot: turn ${turnId} waited for a slot longer than its chatbot allows and was not run`);
        this.fail(turnId, 'queue_timeout', null);
        this.poke(turn.chatbot_user_id);
    }
    /** Write one public event and THEN announce it. The order is the invariant: a subscriber that wakes up
     *  reads the log, so an event nobody can read must never be announced, and an event that was announced is
     *  always already there for the client that reconnects later. */
    record(turnId, type, data) {
        this.deps.store.appendEvent(turnId, type, data, this.deps.now());
        this.deps.broker.publish(turnId);
    }
    /** Fail a turn with one of the stable public codes and nothing else. */
    fail(turnId, code, sessionId) {
        this.record(turnId, 'error', { code });
        this.deps.store.finishTurn({ turnId, status: 'error', coreSessionId: sessionId, errorCode: code, now: this.deps.now() });
    }
    /** Send one claimed turn through the host relay and project what the visitor is allowed to see.
     *
     *  The turn is already `running`: this process claimed it before launching. Everything between here and the
     *  settle is either the relay's own outcome or one of the two facts this process can establish without it
     *  (no relay control, no bot). */
    async runTurn(turnId, bot) {
        const { store, adapter, warn } = this.deps;
        const turn = store.turn(turnId);
        if (!turn || turn.status !== 'running')
            return;
        try {
            // Readiness is re-checked HERE, not only when the request was admitted: a turn can sit in the queue
            // while the adapter is torn down, and a half-wired relay would otherwise run a turn nothing owns.
            const relay = adapter.relay();
            if (!relay) {
                this.fail(turnId, 'turn_failed', null);
                return;
            }
            const upload = store.uploadForTurn(turnId);
            let image = null;
            if (upload) {
                if (!this.deps.files) {
                    this.fail(turnId, 'turn_failed', null);
                    return;
                }
                try {
                    image = await this.deps.files.readProjectImage({ botUserId: turn.chatbot_user_id, receipt: upload.receipt });
                }
                catch (error) {
                    warn(`chatbot turn ${turnId} could not read its image: ${error instanceof Error ? error.message : String(error)}`);
                }
                if (!image) {
                    this.fail(turnId, 'turn_failed', null);
                    return;
                }
            }
            this.record(turnId, 'accepted', {});
            const source = visitorSource({
                chatbotUserId: turn.chatbot_user_id,
                visitorId: turn.visitor_id,
                displayName: bot.display_name,
                ...(image ? { images: [{ data: image.bytes.toString('base64'), mimeType: image.mimeType }] } : {}),
            });
            let sessionId = null;
            let imageCount = 0;
            let fileCount = 0;
            let attachmentCount = 0;
            let streamedAnswer = '';
            // Whether what the relay delivered last was more of the CURRENT step's own text. One step writes its
            // text as a run of deltas; anything else ends that run, so the next delta is the first piece of the
            // next assistant message and meets the answer at a seam no message of its own carries (see
            // `pieceAtSeam`).
            let stepTextOpen = false;
            try {
                const message = upload
                    ? `${turn.message || 'The visitor sent an image without accompanying text.'}\n\n[Untrusted visitor attachment: ${JSON.stringify(upload.receipt.path)}]`
                    : turn.message;
                const reply = await relay(source, message, {
                    onEvent: (event) => {
                        const fields = relayEventFields(event);
                        if (fields.type === 'session') {
                            if (fields.sessionId)
                                sessionId = fields.sessionId;
                            stepTextOpen = false;
                            return;
                        }
                        const attachment = publicAttachment(event);
                        if (attachment && (attachment.kind === 'image' ? imageCount < 4 : fileCount < 4)) {
                            if (attachment.kind === 'image')
                                imageCount += 1;
                            else
                                fileCount += 1;
                            attachmentCount += 1;
                            this.record(turnId, 'attachment', { ...attachment });
                            stepTextOpen = false;
                            return;
                        }
                        // Everything else is dropped except the answer's own text. The relay event stream also carries
                        // reasoning, tool activity, file references and internal error text, and none of that may cross
                        // into a log an anonymous visitor reads.
                        if (fields.type === 'text' && typeof fields.delta === 'string' && fields.delta !== '') {
                            const text = stepTextOpen ? fields.delta : pieceAtSeam(streamedAnswer, fields.delta);
                            stepTextOpen = true;
                            this.record(turnId, 'text_delta', { text });
                            streamedAnswer += text;
                            return;
                        }
                        stepTextOpen = false;
                    },
                });
                // `undefined` is not an empty answer: the seam documents it as a deliberate silence or a refused
                // path, and reporting it as success would show a visitor a blank reply. It is an error here.
                if (reply === undefined && attachmentCount === 0) {
                    warn(`chatbot turn ${turnId} produced no reply; the relay resolved without one`);
                    this.fail(turnId, 'relay_no_reply', sessionId);
                    return;
                }
                // Core returns only the last assistant message of a multi-step turn. The terminal frame must
                // instead reconcile to every public text delta we recorded, including text before page actions.
                // A relay without text events still has its returned answer; an undefined reply remains a refusal.
                this.record(turnId, 'done', { text: streamedAnswer || reply || '' });
                store.finishTurn({ turnId, status: 'done', coreSessionId: sessionId, errorCode: null, now: this.deps.now() });
            }
            catch (error) {
                // The internal detail stays in the daemon log; the visitor gets a stable code.
                warn(`chatbot turn ${turnId} failed: ${error instanceof Error ? error.message : String(error)}`);
                this.fail(turnId, 'turn_failed', sessionId);
            }
        }
        finally {
            // The slot comes back however this turn ended, and the next waiting turn of the same chatbot is looked
            // for. `finishTurn` has already moved the row out of `running`, which is what frees it.
            this.poke(bot.chatbot_user_id);
        }
    }
}
/** One delta as it joins the answer: the first piece of a step carries the separator its seam needs, and
 *  every other delta is the model's own text untouched. Both are non-empty — the caller keeps only a delta
 *  that carries text.
 *
 *  The answer of a multi-step turn is the text of EVERY step, and the relay delivers each step's text as
 *  its own run of deltas. The whitespace BETWEEN two assistant messages belongs to neither of them, so this
 *  seam is the one place the model's own text cannot carry a separator: two pieces that meet on a non-space
 *  character on both sides reached the visitor glued together — the live
 *  "…balayage.Otevřel jsem stránku s rezervací.". Exactly one space is inserted there, and nothing at all
 *  when either side already carries the whitespace the model wrote itself.
 *
 *  Only this seam is touched. The deltas INSIDE one step are the model's own chunks of one continuous
 *  message, so a piece that merely happens to begin on a non-space character continues the text exactly as
 *  written: a URL, a code span or a number arriving in two chunks stays whole. */
function pieceAtSeam(assembled, piece) {
    if (assembled === '')
        return piece;
    // A collision: neither the answer so far nor the piece carries whitespace at the seam.
    return /\s$/.test(assembled) || /^\s/.test(piece) ? piece : ` ${piece}`;
}
/** The scheduler a running daemon uses. The turn id a test scheduler keys on is of no interest to a timer. */
const defaultSchedule = (_turnId, delayMs, fn) => {
    const timer = setTimeout(fn, delayMs);
    return () => clearTimeout(timer);
};
