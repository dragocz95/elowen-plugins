/** A bucket that was never written: nothing was spent, which is a fact and not a guess. */
export const NO_USAGE = { turns: 0, tokens: 0, costUsd: null, costedTurns: 0 };
/** Micro-USD for a cost core reported, rounded to the nearest whole one.
 *
 *  The conversion is where a real number becomes an integer, and rounding is what makes it safe: a cost of
 *  exactly the ceiling is stored as a float that may be a hair above the integer it means
 *  (`0.0015 * 1_000_000 === 1500.0000000000002`), and truncating or comparing the float directly would refuse
 *  a turn that is exactly at its ceiling. Rounding to the nearest micro-USD is the one conversion both sides
 *  of the comparison agree on. */
export function microUsd(costUsd) {
    return Math.round(costUsd * 1_000_000);
}
/** Whether one more turn may be admitted today.
 *
 *  Every ceiling is checked, and the order below is only the order they are reported in; a bot at its cost
 *  ceiling AND its turn ceiling answers with the turn ceiling, which is the one an administrator can act on
 *  without knowing what anything cost. */
export function decideBudget(input) {
    const { limits, admittedTurns, usage } = input;
    // "Reaching" a ceiling is what refuses, not crossing it: a bot whose day allows 100 turns admits 100.
    if (admittedTurns >= limits.dailyTurnLimit)
        return { ok: false, reason: 'budget_exhausted' };
    if (limits.dailyTokenLimit !== null && usage.tokens >= limits.dailyTokenLimit) {
        return { ok: false, reason: 'budget_exhausted' };
    }
    if (limits.dailyCostMicrousd === null)
        return { ok: true };
    // A spending ceiling can only be enforced against spending this plugin can read. A bucket whose turns were
    // only partly priced must not be treated as the priced part: that would be reading an unknown total as a
    // small one, which is exactly how a ceiling is passed without anybody noticing.
    if (usage.costUsd === null) {
        return usage.turns === 0 ? { ok: true } : { ok: false, reason: 'budget_unverifiable' };
    }
    if (usage.costedTurns < usage.turns)
        return { ok: false, reason: 'budget_unverifiable' };
    if (microUsd(usage.costUsd) >= limits.dailyCostMicrousd)
        return { ok: false, reason: 'budget_exhausted' };
    return { ok: true };
}
/** UTC day, `YYYY-MM-DD`, the grain both core's rollup and this plugin count a day at. */
export function utcDay(nowMs) {
    return new Date(nowMs).toISOString().slice(0, 10);
}
/** Seconds until the beginning of the next UTC day, for `Retry-After` on an exhausted budget.
 *
 *  A budget is not a window that rolls: it is a day, and the honest answer to a refused visitor is how long
 *  the ceiling stands. Always at least one second, so a caller is never told to retry inside the day that
 *  refused it. */
export function secondsUntilNextUtcDay(nowMs) {
    const now = new Date(nowMs);
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return Math.max(1, Math.ceil((next - nowMs) / 1000));
}
