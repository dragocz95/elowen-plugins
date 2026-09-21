/** The one core call the retention cleaner makes, and the only reason this plugin ever talks to the daemon's
 *  own API.
 *
 *  Deleting a visitor's transcript is core's job — the plugin must never run its own DELETE against a
 *  `brain_*` table — so the cleaner authenticates as the CHATBOT ACCOUNT and asks core to delete that
 *  conversation. The credential is the host's internal advisor token for that one account: it is created on
 *  demand by `ctx.host.elowenCli()`, never stored by this plugin, never logged, and never sent anywhere but
 *  the daemon's own loopback URL. A change that put it in a widget, a URL or a plugin response would be a
 *  security defect, not a refactor. */
/** Core's own code for "no such session for this account" (`DELETE /brain/sessions/:id` answers
 *  `{ error: 'unknown session' }` with a 404). It is checked rather than assumed: a 404 from a proxy, a
 *  renamed route or a URL typo would look identical from here, and reading THAT as "already deleted" would
 *  quietly stop deleting anything. If core renames the code, this cleaner stops deleting and says so in the
 *  log — which is the safe direction. */
const UNKNOWN_SESSION_CODE = 'unknown session';
export function createCoreSessionBridge(deps) {
    const doFetch = () => deps.fetchImpl ?? fetch;
    return {
        async deleteSession(input) {
            const base = deps.baseUrl();
            if (!base)
                return { ok: false, reason: 'transport' };
            const token = deps.tokenForUser(input.chatbotUserId);
            // An account the host will not mint a credential for is an account whose transcript this plugin cannot
            // delete. Keeping the rows is the only honest answer.
            if (!token)
                return { ok: false, reason: 'no_credential' };
            let response;
            try {
                response = await doFetch()(`${base}/brain/sessions/${encodeURIComponent(input.sessionId)}`, {
                    method: 'DELETE',
                    headers: { authorization: `Bearer ${token}` },
                });
            }
            catch {
                return { ok: false, reason: 'transport' };
            }
            if (response.status === 200)
                return { ok: true, outcome: 'deleted' };
            if (response.status !== 404)
                return { ok: false, reason: 'unverified' };
            // A 404 counts only when the daemon's own API is what answered, and this is where that is decided.
            let body;
            try {
                body = await response.json();
            }
            catch {
                return { ok: false, reason: 'unverified' };
            }
            const declared = typeof body === 'object' && body !== null ? body.error : undefined;
            return declared === UNKNOWN_SESSION_CODE ? { ok: true, outcome: 'absent' } : { ok: false, reason: 'unverified' };
        },
    };
}
