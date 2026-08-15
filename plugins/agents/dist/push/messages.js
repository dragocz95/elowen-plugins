/** Web-push payloads built daemon-side and rendered verbatim by the service worker. User-facing text
 *  is Czech (formal) — the SW does no i18n. `actions` map to inline notification buttons; an empty
 *  `actions` array means tap-to-open only (the SW opens `url`).
 *
 *  Copy of the MISSION half of src/push/messages.ts: buildTurnDone + notificationPreview (the owner-chat
 *  turn notification) stay core-only — they belong to the brain, not the agents subsystem. */
/** Cut by CODE POINT, not by UTF-16 unit: slicing mid-surrogate ends the text in half an emoji, which a
 *  phone renders as the replacement glyph. Czech diacritics are BMP and were never at risk. */
const trim = (s, n = 140) => {
    const points = Array.from(s);
    return points.length > n ? `${points.slice(0, n - 1).join('')}…` : s;
};
/** Overseer rejected/timed out a phase review — needs a human verdict. */
export function buildReview(input) {
    return {
        kind: 'review',
        title: 'Mise potřebuje vaše rozhodnutí',
        body: input.rationale ? `${input.phaseTitle}: ${trim(input.rationale)}` : input.phaseTitle,
        missionId: input.missionId,
        taskId: input.taskId,
        actions: [{ action: 'approve', title: 'Schválit' }, { action: 'rerun', title: 'Spustit znovu' }],
        url: '/p/agents/escalations',
    };
}
/** An agent is waiting on a prompt the autopilot couldn't answer. A permission prompt (no options)
 *  gets inline Allow/Reject; a multiple-choice question (options present) can't fit on a notification,
 *  so it is tap-to-open only. */
export function buildNeedsInput(input) {
    return {
        kind: 'needs_input',
        title: 'Agent čeká na odpověď',
        body: trim(input.question || 'Agent potřebuje vaši odpověď.'),
        missionId: input.missionId,
        taskId: input.taskId,
        session: input.session,
        actions: input.hasOptions ? [] : [{ action: 'allow', title: 'Povolit' }, { action: 'reject', title: 'Odmítnout' }],
        url: '/p/agents/sessions',
    };
}
/** A mission stalled (no running agents, a blocked child) — waiting on a human. */
export function buildStalled(input) {
    return {
        kind: 'stalled',
        title: 'Mise se zastavila',
        body: `${input.epicTitle} čeká na vaši pozornost.`,
        missionId: input.missionId,
        actions: [{ action: 'open', title: 'Otevřít' }],
        url: '/p/agents/escalations',
    };
}
/** A task was blocked (an agent died too many times). */
export function buildBlocked(input) {
    return {
        kind: 'blocked',
        title: 'Mise se zastavila',
        body: `${input.taskTitle} se zablokovala.`,
        missionId: input.missionId,
        taskId: input.taskId,
        actions: [{ action: 'open', title: 'Otevřít' }],
        url: '/p/agents/escalations',
    };
}
/** A mission finished — FYI, no action. Mentions the PR when one was opened. */
export function buildDone(input) {
    return {
        kind: 'done',
        title: input.prUrl ? 'Mise dokončena — PR otevřen' : 'Mise dokončena',
        body: input.prUrl ? `${input.epicTitle} — PR je připravený k revizi.` : `${input.epicTitle} je hotová.`,
        missionId: input.missionId,
        ...(input.prUrl ? { prUrl: input.prUrl } : {}),
        actions: [],
        url: input.prUrl ?? '/dash',
    };
}
