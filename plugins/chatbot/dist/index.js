import { ChatbotAdapter } from './adapter.js';
import { migrate } from './db.js';
import { createAdminApi } from './adminApi.js';
import { createPublicRoute, PUBLIC_MOUNT } from './publicRoutes.js';
import { ChatbotTurnQueue } from './queue.js';
import { ChatbotStore } from './store.js';
import { newSecret, TOKEN_SECRET_KEY } from './token.js';
import { asChatbotContext } from './coreSeams.js';
/** Default lifetime of a visitor token, in days. Declared in the manifest as `visitorTokenTtlDays` and
 *  read from configuration at issue time; this is only the fallback when a deployment stored no value. */
const DEFAULT_TOKEN_TTL_DAYS = 30;
const SECONDS_PER_DAY = 86_400;
/** Register everything this plugin contributes: its platform adapter, its public hook, the administrator's
 *  own route and its tables. One entry point, so a reader can see the whole surface at once. */
export function register(published) {
    const ctx = asChatbotContext(published);
    const logger = ctx.logger;
    const warn = (message) => logger.warn(message);
    const db = ctx.db();
    migrate(db);
    const store = new ChatbotStore(db);
    const stores = ctx.host.stores();
    const now = () => new Date();
    const adapter = new ChatbotAdapter(warn);
    const queue = new ChatbotTurnQueue({ store, adapter, now: () => now().toISOString(), warn });
    // The signing key for visitor tokens lives in the instance secret bag: created once, never configured,
    // never returned and never logged. A second process racing the first loses only its own value.
    const secret = () => {
        const existing = ctx.instanceSecrets().get(TOKEN_SECRET_KEY);
        if (existing)
            return existing.value;
        const minted = newSecret();
        try {
            ctx.instanceSecrets().set(TOKEN_SECRET_KEY, minted);
            return minted;
        }
        catch {
            const stored = ctx.instanceSecrets().get(TOKEN_SECRET_KEY);
            if (!stored)
                throw new Error('the visitor token signing key could not be created');
            return stored.value;
        }
    };
    const tokenTtlSeconds = () => {
        const configured = ctx.config.visitorTokenTtlDays;
        const days = typeof configured === 'number' && Number.isFinite(configured) && configured >= 1 ? configured : DEFAULT_TOKEN_TTL_DAYS;
        return Math.round(days * SECONDS_PER_DAY);
    };
    ctx.registerPlatform(adapter);
    const adminApi = createAdminApi({
        store,
        stores,
        publicBaseUrl: () => ctx.publicWebUrl(),
        now,
    });
    // The public route is registered AHEAD of any configuration or readiness check, so an instance whose
    // adapter never started answers an explicit refusal instead of a 404 that looks like a missing plugin.
    const publicRoute = createPublicRoute({
        store,
        queue,
        adapter,
        stores,
        secret,
        tokenTtlSeconds,
        now,
        warn,
    });
    ctx.registerHttpRoute({
        path: PUBLIC_MOUNT,
        handler: async (req) => publicRoute(req),
    });
    // One mount, dispatched by method, so the manifest declares exactly what exists.
    ctx.registerApiRoute({ path: 'bots', method: 'GET', access: 'admin', handler: async (req) => adminApi.list(req.auth) });
    ctx.registerApiRoute({ path: 'bots', method: 'POST', access: 'admin', handler: async (req) => adminApi.create(req.auth, await req.json()) });
    ctx.registerApiRoute({ path: 'bots', method: 'PATCH', access: 'admin', handler: async (req) => adminApi.update(req.auth, await req.json()) });
    // A turn this process no longer runs cannot be resumed: the core turn is gone with the process, and
    // replaying it would be a second model turn for one submitted message. Say so instead of leaving a
    // visitor's widget waiting on a turn nobody will finish.
    ctx.registerBootReconcile(() => {
        const failed = store.failOrphanedTurns(now().toISOString(), 'server_restarted');
        if (failed > 0)
            warn(`chatbot: ${failed} interrupted turn(s) were closed as server_restarted`);
    });
    // An account that is deleted takes its chatbot's rows with it. Nothing else ever reaps them, and the
    // plugin may well be disabled when the deletion happens, which is why the boot reconcile above also
    // closes interrupted turns.
    ctx.registerUserRemoved((userId) => {
        const bot = store.botByUserId(userId);
        if (!bot)
            return;
        store.deleteBot(userId);
        logger.info(`chatbot: removed the registration and history of chatbot ${bot.public_id}`);
    });
    logger.info('chatbot plugin registered: platform, public hook v1 and the admin route');
}
