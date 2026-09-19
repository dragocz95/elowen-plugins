/** The ONE place these suites apply a plugin change and settle the daemon on the contract the core
 *  actually publishes.
 *
 *  A change to the plugin SET or to a plugin's config is no longer swapped into a live registry. The
 *  daemon persists it and answers `202` with `pending: true`, because what loads the new registry is a
 *  RESTART — see the core's `PATCH /plugins/:name` route, which returns `{ ...body, pending: true,
 *  restart: { waitingTurns, ceilingMs } }`. Under a real deployment a supervisor brings the daemon back.
 *  In these suites the harness IS the supervisor, so it drives the restart over the same port and data
 *  dir, which is also why the bearer token has to be replaced afterwards.
 *
 *  Only `200` and `202` are accepted, and a `202` must actually carry `pending: true`. Widening this to
 *  "any 2xx" would let the very drift these suites exist to catch pass silently: a route that started
 *  answering `204`, or a `202` that no longer means the change is waiting for a restart, is a changed
 *  contract, not a detail. */

/** @typedef {{ status: number, text: string }} PatchResponse */

function parsePending(response, label) {
  let body;
  try {
    body = JSON.parse(response.text);
  } catch {
    throw new Error(`ASSERTION FAILED: ${label} answered 202 with a body that is not JSON: ${response.text}`);
  }
  if (body?.pending !== true) {
    throw new Error(`ASSERTION FAILED: ${label} answered 202 without \`pending: true\`: ${response.text}`);
  }
  return body;
}

/** Assert the contract, and restart the daemon when the change is pending on one.
 *
 * @param {{ restart: () => Promise<string> }} daemon the harness supervisor
 * @param {PatchResponse} response what the plugin route answered
 * @param {string} token the bearer in use until now
 * @param {string} label how the caller names this change, for the failure message
 * @returns {Promise<string>} the bearer to use from now on — a fresh one after a restart
 */
export async function settlePluginChange(daemon, response, token, label) {
  if (response.status === 200) return token;
  if (response.status !== 202) {
    throw new Error(`ASSERTION FAILED: ${label} → 200 or 202 (got ${response.status}: ${response.text})`);
  }
  parsePending(response, label);
  return daemon.restart();
}
