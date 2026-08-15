import { detectAgentPrompt } from './shellPatterns/index.js';
import { logger } from '../lib/logger.js';
import { stripPrefix } from '../lib/text.js';
import { textHash as hash } from '../lib/textHash.js';
const log = logger('deriver');
const PANE_TAIL = 60;
/** L1–L3 missions (and manual, mission-less launches) route permission prompts through the overseer;
 *  only L0 (Recommend) escalates everything to a human. L1 differs from L2/L3 not here but at the
 *  overseer's confidence bar — `minConfidenceFor` holds L1 to a stricter threshold. */
function autoClears(autonomy) {
    return autonomy !== 'L0';
}
export class Deriver {
    d;
    last = new Map();
    // Sessions with a pending escalation, keyed by session → { prompt key, needs_input signal }. Lets a
    // persisting escalation be re-emitted every tick so freshly-loaded clients (empty signal cache) see it.
    escalated = new Map();
    constructor(d) {
        this.d = d;
    }
    start() {
        const clock = this.d.clock;
        if (!clock)
            throw new Error('Deriver.start requires a clock');
        return clock.setInterval(() => void this.tick(), 5000);
    }
    async tick() {
        const sessions = (await this.d.tmux.list()).filter(s => s.startsWith('elowen-'));
        for (const session of sessions) {
            // Isolate each session: a vanished session (capturePane) or a relay throw (decideApproval) must
            // not break the 5s sweep for the rest. Robustness of a periodic loop trumps a single iteration.
            try {
                await this.tickSession(session);
            }
            catch (e) {
                log.error(`tick failed for ${session}`, e);
            }
        }
    }
    async tickSession(session) {
        const program = this.d.agents.programFor(stripPrefix(session, 'elowen-'));
        if (!program)
            return;
        const taskId = this.d.sessionTaskId(session);
        if (!taskId)
            return;
        const task = this.d.tasks.get(taskId);
        if (!task)
            return;
        if (task.status === 'closed') {
            this.emitOnce(session, 'complete', { type: 'complete' });
            this.last.delete(session); // finished agent — drop its tracking entry so the Map can't grow unbounded
            this.escalated.delete(session);
            return;
        }
        if (task.status !== 'in_progress' && task.status !== 'open')
            return;
        const prompt = detectAgentPrompt(await this.d.tmux.capturePane(session, PANE_TAIL), program);
        if (prompt) {
            const autonomy = this.d.autonomyFor?.(session) ?? null;
            const key = `prompt:${hash(prompt.question + prompt.context)}`;
            if (this.last.get(session) === key) {
                // Same prompt as last tick — do NOT re-decide (that would re-press keys / re-ask the overseer).
                // But if it was escalated and is still pending, RE-EMIT the needs_input signal: a client that
                // loaded after the one-time emit starts with an empty signal cache and would otherwise never
                // see the prompt (the agent looks online while it's actually blocked → "locked forever").
                const esc = this.escalated.get(session);
                if (esc && esc.key === key)
                    this.d.sink.emit(session, esc.signal);
                return;
            }
            this.last.set(session, key);
            this.escalated.delete(session); // a new/changed prompt supersedes any prior escalation
            const escalate = () => {
                const signal = { type: 'needs_input', question: prompt.question, options: prompt.options, context: prompt.context };
                this.escalated.set(session, { key, signal }); // remember it so later ticks re-emit for fresh clients
                this.d.sink.emit(session, signal);
            };
            // L0 (Recommend) always escalates to a human — nothing is cleared autonomously.
            if (!autoClears(autonomy)) {
                escalate();
                return;
            }
            // Environmental gates (workspace-trust) just block startup — elowen only spawns into the
            // user's own registered projects, so clear them directly without an overseer round-trip.
            if (prompt.autoAccept) {
                await this.d.tmux.sendKeys(session, prompt.acceptKeys);
                this.d.sink.emit(session, { type: 'working' });
                return;
            }
            // A multiple-choice question (the agent's "ask the user" tool): the overseer picks an option id,
            // or escalates. A null choice (low confidence, no overseer, or a thrown decision)
            // hands the question to a human rather than guessing.
            if (prompt.kind === 'choice') {
                let choiceId = null;
                try {
                    const r = this.d.decideQuestion
                        ? await this.d.decideQuestion({ question: prompt.question, context: prompt.context, options: prompt.options, autonomy: autonomy ?? 'L3', missionId: this.d.missionFor?.(session) ?? null, taskId })
                        : { choiceId: null };
                    choiceId = r.choiceId;
                }
                catch (e) {
                    log.error('overseer question decision failed, escalating', e);
                    choiceId = null;
                }
                const chosen = choiceId ? prompt.options.find((o) => o.id === choiceId) : undefined;
                if (chosen) {
                    // The list opens with option 1 focused; step down to the chosen position, then accept.
                    const steps = Math.max(0, Number(chosen.id) - 1);
                    await this.d.tmux.sendKeys(session, [...Array(steps).fill('Down'), ...prompt.acceptKeys]);
                    this.d.sink.emit(session, { type: 'working' });
                }
                else {
                    escalate();
                }
                return;
            }
            // L2/L3: the overseer decides; uncertain prompts still escalate. A decision failure
            // (relay/queue throw) is conservative — escalate to a human rather than auto-clear.
            let decision;
            try {
                decision = this.d.decideApproval
                    ? await this.d.decideApproval({ question: prompt.question, context: prompt.context, options: prompt.options, autonomy: autonomy ?? 'L3', missionId: this.d.missionFor?.(session) ?? null, taskId })
                    : { approve: true };
            }
            catch (e) {
                log.error('overseer decision failed, escalating', e);
                decision = { approve: false };
            }
            if (decision.approve) {
                await this.d.tmux.sendKeys(session, prompt.acceptKeys);
                this.d.sink.emit(session, { type: 'working' });
            }
            else {
                escalate();
            }
            return;
        }
        // No prompt on screen — the agent is working (or an escalation was just answered and it moved on).
        this.escalated.delete(session);
        this.last.set(session, 'working');
        this.d.sink.emit(session, { type: 'working' });
    }
    emitOnce(session, key, sig) {
        if (this.last.get(session) === key)
            return;
        this.last.set(session, key);
        this.d.sink.emit(session, sig);
    }
}
