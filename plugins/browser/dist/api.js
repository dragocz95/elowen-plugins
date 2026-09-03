import { randomBytes } from 'node:crypto';
import { BrowserAccessError, requireApiUser } from './ownership.js';
import { parseUserInputEvents } from './input-controller.js';
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
export function registerBrowserApi(ctx, registry, dependencies) {
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
                const userId = requireApiUser(req.auth);
                const live = registry.listOwned(userId);
                return { body: { live: live.map((session) => ({ id: session.id, state: session.state, lease: session.currentLease, controlRevision: session.controlRevision, reason: session.controlReason })), history: registry.durableSessions(userId) } };
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
        path: 'stream', method: 'GET', access: 'user', handler: async (req) => {
            try {
                const session = ownedSession(registry, req);
                return {
                    sse: async (send, signal) => {
                        const subscriberId = randomBytes(18).toString('base64url');
                        let unsubscribeEvents = null;
                        let unsubscribeFrames = null;
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
                                controlRevision: session.controlRevision, reason: session.controlReason, cursor: session.currentCursor, favicon: session.currentFavicon,
                            }), 'session');
                            unsubscribeFrames = await session.subscribeFrames(subscriberId, async (frame) => send(JSON.stringify(frame), 'frame'));
                            if (!signal.aborted)
                                await new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
                        }
                        finally {
                            clearInterval(heartbeat);
                            unsubscribeEvents?.();
                            await unsubscribeFrames?.();
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
        path: 'input', method: 'POST', access: 'user', handler: async (req) => {
            try {
                const body = await json(req);
                const events = parseUserInputEvents(body.events);
                await ownedSession(registry, req).dispatchUserInput(requiredString(body.leaseId, 'leaseId', 256), events);
                return { body: { accepted: events.length } };
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
