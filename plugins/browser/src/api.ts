import { randomBytes } from 'node:crypto';
import type { PluginApiRequest, PluginContext, PluginHttpResponse } from 'elowen/plugin-api';
import { BrowserAccessError, requireApiUser } from './ownership.js';
import { SessionRegistry } from './session-registry.js';
import { parseUserInputEvents } from './input-controller.js';

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BrowserAccessError('A JSON object is required.', 400);
  return value as Record<string, unknown>;
};
const requiredString = (value: unknown, name: string, max = 512): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new BrowserAccessError(`${name} is invalid.`, 400);
  return value;
};

function responseError(error: unknown): PluginHttpResponse {
  if (error instanceof BrowserAccessError) return { status: error.status, body: { error: error.message } };
  const message = error instanceof Error ? error.message : 'Browser operation failed.';
  const status = message === 'Browser session not found.' ? 404 : message === 'Browser is already under user control.' ? 409 : 400;
  return { status, body: { error: message } };
}

function ownedSession(registry: SessionRegistry, req: PluginApiRequest) {
  const userId = requireApiUser(req.auth);
  const sessionId = requiredString(req.query.sessionId, 'sessionId', 256);
  try { return registry.getOwned(sessionId, userId); }
  catch { throw new BrowserAccessError('Browser session not found.', 404); }
}

async function json(req: PluginApiRequest): Promise<Record<string, unknown>> {
  return object(await req.json<unknown>());
}

export function registerBrowserApi(ctx: PluginContext, registry: SessionRegistry): void {
  ctx.registerApiRoute({
    path: 'profile', method: 'GET', access: 'user', handler: async (req) => {
      try {
        const userId = requireApiUser(req.auth);
        return { body: { profileBytes: registry.profileSize(userId), activeSessions: registry.listOwned(userId).length } };
      } catch (error) { return responseError(error); }
    },
  });
  ctx.registerApiRoute({
    path: 'profile', method: 'DELETE', access: 'user', handler: async (req) => {
      try { await registry.clearProfile(requireApiUser(req.auth)); return { body: { cleared: true } }; }
      catch (error) { return responseError(error); }
    },
  });
  ctx.registerApiRoute({
    path: 'sessions', method: 'GET', access: 'user', handler: async (req) => {
      try {
        const userId = requireApiUser(req.auth);
        const live = registry.listOwned(userId);
        return { body: { live: live.map((session) => ({ id: session.id, state: session.state, lease: session.currentLease })), history: registry.durableSessions(userId) } };
      } catch (error) { return responseError(error); }
    },
  });
  ctx.registerApiRoute({
    path: 'session', method: 'GET', access: 'user', handler: async (req) => {
      try {
        const session = ownedSession(registry, req);
        return { body: { id: session.id, state: session.state, lease: session.currentLease, tabs: await session.tabs() } };
      } catch (error) { return responseError(error); }
    },
  });
  ctx.registerApiRoute({
    path: 'stream', method: 'GET', access: 'user', handler: async (req) => {
      try {
        const session = ownedSession(registry, req);
        return {
          sse: async (send, signal) => {
            const subscriberId = randomBytes(18).toString('base64url');
            await send(JSON.stringify({ id: session.id, state: session.state, lease: session.currentLease }), 'session');
            let unsubscribeEvents: (() => void) | null = null;
            let unsubscribeFrames: (() => Promise<void>) | null = null;
            const heartbeat = setInterval(() => {
              session.viewerActivity();
              void send(JSON.stringify({ at: Date.now() }), 'heartbeat').catch(() => {});
            }, 15_000);
            heartbeat.unref();
            try {
              unsubscribeEvents = await session.subscribeEvents(subscriberId, async (event) => send(JSON.stringify(event.data), event.kind));
              unsubscribeFrames = await session.subscribeFrames(subscriberId, async (frame) => send(JSON.stringify(frame), 'frame'));
              if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
            } finally {
              clearInterval(heartbeat);
              unsubscribeEvents?.();
              await unsubscribeFrames?.();
            }
          },
        };
      } catch (error) { return responseError(error); }
    },
  });
  ctx.registerApiRoute({
    path: 'takeover', method: 'POST', access: 'user', handler: async (req) => {
      try { return { body: await ownedSession(registry, req).claimTakeover() }; }
      catch (error) { return responseError(error); }
    },
  });
  ctx.registerApiRoute({
    path: 'heartbeat', method: 'POST', access: 'user', handler: async (req) => {
      try {
        const body = await json(req);
        return { body: await ownedSession(registry, req).heartbeat(requiredString(body.leaseId, 'leaseId', 256)) };
      } catch (error) { return responseError(error); }
    },
  });
  ctx.registerApiRoute({
    path: 'release', method: 'POST', access: 'user', handler: async (req) => {
      try {
        const body = await json(req);
        await ownedSession(registry, req).releaseTakeover(requiredString(body.leaseId, 'leaseId', 256));
        return { body: { released: true } };
      } catch (error) { return responseError(error); }
    },
  });
  ctx.registerApiRoute({
    path: 'input', method: 'POST', access: 'user', handler: async (req) => {
      try {
        const body = await json(req);
        const events = parseUserInputEvents(body.events);
        await ownedSession(registry, req).dispatchUserInput(
          requiredString(body.leaseId, 'leaseId', 256),
          events,
        );
        return { body: { accepted: events.length } };
      } catch (error) { return responseError(error); }
    },
  });
  ctx.registerApiRoute({
    path: 'close', method: 'POST', access: 'user', handler: async (req) => {
      try { await ownedSession(registry, req).close('user_closed'); return { body: { closed: true } }; }
      catch (error) { return responseError(error); }
    },
  });
  ctx.registerApiRoute({
    path: 'admin-status', method: 'GET', access: 'admin', handler: async () => ({ body: registry.status() }),
  });
  ctx.registerApiRoute({
    path: 'admin-close', method: 'POST', access: 'admin', handler: async (req) => {
      try {
        const body = await json(req);
        const session = registry.get(requiredString(body.sessionId, 'sessionId', 256));
        if (!session) throw new BrowserAccessError('Browser session not found.', 404);
        await session.close('admin_closed');
        return { body: { closed: true } };
      } catch (error) { return responseError(error); }
    },
  });
}
