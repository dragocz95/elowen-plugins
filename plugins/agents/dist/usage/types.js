export const EMPTY_USAGE = {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0,
    reasoning: 0, costUsd: null, currency: null, costSource: 'unavailable',
};
/** Tolerate small clock skew between when elowen marks a task in_progress and when the CLI
 *  actually opens its session (a few seconds of startup). */
export const SESSION_MATCH_SKEW_MS = 15_000;
