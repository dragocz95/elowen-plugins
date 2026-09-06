import { randomBytes } from 'node:crypto';
import { BrowserAccessError, requireApiUser } from './ownership.js';
const object = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new BrowserAccessError('A JSON object is required.', 400);
    return value;
};
const requiredString = (value, name, max = 512) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
        throw new BrowserAccessError(`${name} is invalid.`, 400);
    return value;
};
function responseError(error) {
    if (error instanceof BrowserAccessError)
        return { status: error.status, body: { error: error.message } };
    const message = error instanceof Error ? error.message : 'Browser operation failed.';
    const status = message === 'Browser session not found.' ? 404 : message === 'Browser is already under user control.' ? 409 : 400;
    return { status, body: { error: message } };
}
/** The accessor, or nothing at all.
 *
 *  `stores()` does not answer null when a host cannot serve it — it THROWS, both for an undeclared grant
 *  and for a host with no read stores wired. The reply is a decoration on the session listing, and that
 *  listing is the account panel's only source for the rows, the stills and the close button, so a refusal
 *  must not take all of it down. It is said out loud rather than swallowed: a missing grant is a
 *  misconfiguration somebody has to fix, and it would otherwise look exactly like an older core. */
function conversationsRead(ctx) {
    try {
        return ctx.host.stores().conversationsRead;
    }
    catch (error) {
        ctx.logger.warn(`browser session listing cannot read conversation replies: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}
function ownedSession(registry, req) {
    const userId = requireApiUser(req.auth);
    const sessionId = requiredString(req.query.sessionId, 'sessionId', 256);
    try {
        return registry.getOwned(sessionId, userId);
    }
    catch {
        throw new BrowserAccessError('Browser session not found.', 404);
    }
}
async function json(req) {
    return object(await req.json());
}
export function registerBrowserApi(ctx, registry, dependencies, liveView) {
    ctx.registerApiRoute({
        path: 'profile', method: 'GET', access: 'user', handler: async (req) => {
            try {
                const userId = requireApiUser(req.auth);
                return { body: { profileBytes: registry.profileSize(userId), activeSessions: registry.listOwned(userId).length } };
            }
            catch (error) {
                return responseError(error);
            }
        },
    });
    ctx.registerApiRoute({
        path: 'profile', method: 'DELETE', access: 'user', handler: async (req) => {
            try {
                await registry.clearProfile(requireApiUser(req.auth));
                return { body: { cleared: true } };
            }
            catch (error) {
                return responseError(error);
            }
        },
    });
    ctx.registerApiRoute({
        path: 'sessions', method: 'GET', access: 'user', handler: async (req) => {
            try {
                // The ACTING account, resolved from the request's own auth. Everything below is scoped by it, and
                // it is the id handed to the core's ownership check — a session id or a user id off the query
                // string never reaches this route's reads.
                const userId = requireApiUser(req.auth);
                // Resolved per request, so a host that gains the seam does not need the plugin reloaded. The core
                // answers null for a conversation this account does not own, so a session opened from someone
                // else's chat carries `lastReply: null` exactly like one the agent has not answered in yet.
                const conversations = conversationsRead(ctx);
                const live = registry.listOwned(userId).map((session) => ({
                    id: session.id, state: session.state, lease: session.currentLease,
                    controlRevision: session.controlRevision, reason: session.controlReason,
                    lastReply: conversations?.lastAssistantText(session.conversationId, userId) ?? null,
                }));
                return { body: { live, history: registry.durableSessions(userId) } };
            }
            catch (error) {
                return responseError(error);
            }
        },
    });
    ctx.registerApiRoute({
        path: 'session', method: 'GET', access: 'user', handler: async (req) => {
            try {
                const session = ownedSession(registry, req);
                return { body: { id: session.id, state: session.state, lease: session.currentLease, controlRevision: session.controlRevision, reason: session.controlReason, tabs: await session.tabs() } };
            }
            catch (error) {
                return responseError(error);
            }
        },
    });
    ctx.registerApiRoute({
        // One session's screen as a small still, for the account panel's list. `ownedSession` is the whole
        // access story: an account may photograph a session it owns and cannot name one it does not, so this
        // route hands out exactly what its caller could already see in the live view.
        //
        // A picture that could not be taken is a 200 with no image, not a failure. The panel draws a
        // placeholder for a session whose page is mid-navigation or whose first capture has not landed, and a
        // red error row for that would be wrong every few seconds on a perfectly healthy session.
        path: 'thumbnail', method: 'GET', access: 'user', handler: async (req) => {
            try {
                const thumbnail = await registry.thumbnail(ownedSession(registry, req));
                // A picture of whatever the account is signed into, on a plain GET with the session id in the
                // query. Every other route here answers with state; this one answers with page CONTENT, so it
                // says explicitly that it must not be written to a disk cache or held by anything in between.
                return { headers: { 'cache-control': 'private, no-store' }, body: thumbnail ?? { dataUrl: null } };
            }
            catch (error) {
                return responseError(error);
            }
        },
    });
    ctx.registerApiRoute({
        path: 'stream', method: 'GET', access: 'user', handler: async (req) => {
            try {
                const session = ownedSession(registry, req);
                return {
                    // The session's STATE, not its picture. Pixels travel over the live view socket now, so this
                    // carries only what a card has to know: who is in control, what the agent just did, the
                    // favicon, and the end of the session. It is cheap enough to have no viewer limit of its own —
                    // the limit that matters is on the framebuffer connections, and it lives with them.
                    sse: async (send, signal) => {
                        const subscriberId = randomBytes(18).toString('base64url');
                        let unsubscribeEvents = null;
                        const heartbeat = setInterval(() => {
                            session.viewerActivity();
                            void send(JSON.stringify({ at: Date.now() }), 'heartbeat').catch(() => { });
                        }, 15_000);
                        heartbeat.unref();
                        try {
                            unsubscribeEvents = await session.subscribeEvents(subscriberId, async (event) => send(JSON.stringify(event.data), event.kind));
                            // Subscribe first, then seed the stream. A concurrent control change may arrive before this
                            // snapshot, but its higher revision makes the older snapshot harmless to the client.
                            await send(JSON.stringify({
                                id: session.id, state: session.state, lease: session.currentLease,
                                controlRevision: session.controlRevision, reason: session.controlReason, favicon: session.currentFavicon,
                            }), 'session');
                            if (!signal.aborted)
                                await new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
                        }
                        catch (error) {
                            // The 200 and the opening snapshot are already on the wire, so this cannot become an HTTP
                            // error — and a stream that ends right after its snapshot is indistinguishable, from the
                            // client's side, from a viewer that simply left. So the refusal is SAID: the client shows
                            // it and backs off instead of believing it is connected to a stream that is dead.
                            const message = error instanceof Error ? error.message : String(error);
                            await send(JSON.stringify({ reason: 'stream_failed', message }), 'rejected').catch(() => { });
                            ctx.logger.warn(`browser live view stream for ${session.id} failed: ${message}`);
                            throw error;
                        }
                        finally {
                            clearInterval(heartbeat);
                            unsubscribeEvents?.();
                        }
                    },
                };
            }
            catch (error) {
                return responseError(error);
            }
        },
    });
    ctx.registerApiRoute({
        path: 'takeover', method: 'POST', access: 'user', handler: async (req) => {
            try {
                return { body: await ownedSession(registry, req).claimTakeover() };
            }
            catch (error) {
                return responseError(error);
            }
        },
    });
    ctx.registerApiRoute({
        path: 'heartbeat', method: 'POST', access: 'user', handler: async (req) => {
            try {
                const body = await json(req);
                return { body: await ownedSession(registry, req).heartbeat(requiredString(body.leaseId, 'leaseId', 256)) };
            }
            catch (error) {
                return responseError(error);
            }
        },
    });
    ctx.registerApiRoute({
        path: 'release', method: 'POST', access: 'user', handler: async (req) => {
            try {
                const body = await json(req);
                await ownedSession(registry, req).releaseTakeover(requiredString(body.leaseId, 'leaseId', 256));
                return { body: { released: true } };
            }
            catch (error) {
                return responseError(error);
            }
        },
    });
    ctx.registerApiRoute({
        path: 'navigation', method: 'POST', access: 'user', handler: async (req) => {
            try {
                const body = await json(req);
                const action = requiredString(body.action, 'action', 16);
                if (action !== 'back' && action !== 'forward' && action !== 'reload')
                    throw new BrowserAccessError('Browser navigation action is invalid.', 400);
                await ownedSession(registry, req).dispatchUserNavigation(requiredString(body.leaseId, 'leaseId', 256), action);
                return { body: { navigated: action } };
            }
            catch (error) {
                return responseError(error);
            }
        },
    });
    ctx.registerApiRoute({
        // The only door to the live view socket, and an ordinary authenticated plugin route: `ownedSession`
        // already proves the caller is signed in AND owns this session, so the ticket it mints inherits
        // exactly that authority and nothing more. A browser WebSocket cannot carry an Authorization header,
        // which is why the proof has to be moved into a one-shot token first. The owner may always drive
        // their own browser through it: the takeover lease tells the AGENT to wait, it does not gate the
        // human's input.
        path: 'vnc-ticket', method: 'POST', access: 'user', handler: async (req) => {
            try {
                const userId = requireApiUser(req.auth);
                const session = ownedSession(registry, req);
                if (!liveView)
                    throw new BrowserAccessError('This host cannot carry a browser live view connection.', 501);
                const payload = registry.liveViewPayload(session.id, userId);
                if (!payload)
                    throw new BrowserAccessError('The browser live view has no display yet.', 409);
                // Refused here as well as at the socket, because this is the only place the CARD can be told
                // why. noVNC surfaces no close code, so a refusal that happened at the upgrade would reach the
                // reader as an anonymous disconnect. The socket still enforces the limit — this only races
                // ahead of it to produce a sentence — so two tickets minted at once cannot exceed it.
                //
                // 429 rather than another 409: the STATUS is what crosses to the card, because the host's API
                // client keeps the status and the error string and drops any other field. A full room and a
                // session with no display yet have to be told apart, and "too many" is exactly this code.
                if (liveView.transport.viewerCount(session.id) >= registry.viewerLimit()) {
                    return { status: 429, body: { error: 'This browser session already has as many viewers as it allows.' } };
                }
                const issued = liveView.transport.issueTicket(liveView.core, userId, payload);
                const display = registry.liveViewSize(userId);
                return { body: { ...issued, ...(display ? { width: display.width, height: display.height } : {}) } };
            }
            catch (error) {
                return responseError(error);
            }
        },
    });
    ctx.registerApiRoute({
        path: 'close', method: 'POST', access: 'user', handler: async (req) => {
            try {
                await ownedSession(registry, req).close('user_closed');
                return { body: { closed: true } };
            }
            catch (error) {
                return responseError(error);
            }
        },
    });
    ctx.registerApiRoute({
        // Admin-only, and deliberately a READ: an operator opening the status page must never be the thing
        // that launches Chrome, opens a proxy or writes config.
        path: 'admin-status', method: 'GET', access: 'admin', handler: async () => ({ body: { ...registry.status(), dependencies: await dependencies() } }),
    });
    ctx.registerApiRoute({
        path: 'admin-close', method: 'POST', access: 'admin', handler: async (req) => {
            try {
                const body = await json(req);
                const session = registry.get(requiredString(body.sessionId, 'sessionId', 256));
                if (!session)
                    throw new BrowserAccessError('Browser session not found.', 404);
                await session.close('admin_closed');
                return { body: { closed: true } };
            }
            catch (error) {
                return responseError(error);
            }
        },
    });
}
