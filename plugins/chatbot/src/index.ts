import type { PluginContext } from 'elowen/plugin-api';
import { ChatbotAdapter } from './adapter.js';
import { PageActionService } from './actionService.js';
import { registerPageActionTool } from './actionsTool.js';
import { TurnEventBroker } from './broker.js';
import { createCoreSessionBridge } from './coreSessions.js';
import { migrate } from './db.js';
import { createAdminApi } from './adminApi.js';
import { createPublicRoute, STREAM_PING_INTERVAL_MS } from './publicRoutes.js';
import { PUBLIC_MOUNT } from './publicContract.js';
import { inspectAccount } from './preflight.js';
import { ChatbotTurnQueue } from './queue.js';
import { RETENTION_INTERVAL_MS, createRetentionCleaner } from './retention.js';
import { ChatbotStore } from './store.js';
import { newSecret, TOKEN_SECRET_KEY } from './token.js';
import { asChatbotContext } from './coreSeams.js';

/** Default lifetime of a visitor token, in days. Declared in the manifest as `visitorTokenTtlDays` and
 *  read from configuration at issue time; this is only the fallback when a deployment stored no value. */
const DEFAULT_TOKEN_TTL_DAYS = 30;
const SECONDS_PER_DAY = 86_400;

/** Register everything this plugin contributes: its platform adapter, its public hook, the administrator's
 *  own route and its tables. One entry point, so a reader can see the whole surface at once. */
export function register(published: PluginContext): void {
  const ctx = asChatbotContext(published);
  const logger = ctx.logger;
  const warn = (message: string): void => logger.warn(message);

  const db = ctx.db();
  migrate(db);
  const store = new ChatbotStore(db);
  const stores = ctx.host.stores();

  const now = (): Date => new Date();
  const adapter = new ChatbotAdapter(warn);
  // One broker per process, shared by the queue that publishes and the streams that read. It holds live
  // subscribers only: every event a visitor can read is already durable in the plugin's own tables.
  const broker = new TurnEventBroker(warn);
  const queue = new ChatbotTurnQueue({ store, adapter, broker, now: () => now().toISOString(), warn });
  // The page actions of this process: what a visitor's turn may ask their page to do, and what becomes of an
  // action while the turn waits for it. One instance, because the tool that asks and the public route that
  // receives the answer must wake the same waiters.
  const actions = new PageActionService({
    store,
    broker,
    now,
    info: (message) => logger.info(message),
    warn,
  });

  // The signing key for visitor tokens lives in the instance secret bag: created once, never configured,
  // never returned and never logged. A second process racing the first loses only its own value.
  const secret = (): string => {
    const existing = ctx.instanceSecrets().get(TOKEN_SECRET_KEY);
    if (existing) return existing.value;
    const minted = newSecret();
    try {
      ctx.instanceSecrets().set(TOKEN_SECRET_KEY, minted);
      return minted;
    } catch {
      const stored = ctx.instanceSecrets().get(TOKEN_SECRET_KEY);
      if (!stored) throw new Error('the visitor token signing key could not be created');
      return stored.value;
    }
  };

  const tokenTtlSeconds = (): number => {
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
    broker,
    actions,
    pingIntervalMs: STREAM_PING_INTERVAL_MS,
    secret,
    tokenTtlSeconds,
    now,
    warn,
  });
  ctx.registerHttpRoute({
    path: PUBLIC_MOUNT,
    handler: async (req) => publicRoute(req),
  });

  // The one thing a turn may do to the visitor's page. Registered instance-wide: a chatbot account is
  // created by an administrator at any time, so there is no single owner to scope it to. The tool itself
  // refuses every turn that is not a live chatbot visitor turn.
  registerPageActionTool({ ctx, store, service: actions });

  // One mount, dispatched by method, so the manifest declares exactly what exists.
  ctx.registerApiRoute({ path: 'bots', method: 'GET', access: 'admin', handler: async (req) => adminApi.list(req.auth) });
  ctx.registerApiRoute({ path: 'bots', method: 'POST', access: 'admin', handler: async (req) => adminApi.create(req.auth, await req.json()) });
  ctx.registerApiRoute({ path: 'bots', method: 'PATCH', access: 'admin', handler: async (req) => adminApi.update(req.auth, await req.json()) });
  // What an administrator reads after registering a chatbot: one page of its conversations, one
  // conversation's own words and answers, and the plugin's own counters over a window of days. All three
  // name the chatbot they are about and re-check it, so no route here can answer for a chatbot the caller
  // did not name.
  ctx.registerApiRoute({ path: 'conversations', method: 'GET', access: 'admin', handler: async (req) => adminApi.conversations(req.auth, req.query) });
  ctx.registerApiRoute({ path: 'conversation', method: 'GET', access: 'admin', handler: async (req) => adminApi.conversation(req.auth, req.query) });
  ctx.registerApiRoute({ path: 'stats', method: 'GET', access: 'admin', handler: async (req) => adminApi.stats(req.auth, req.query) });

  /** Turn off every ENABLED chatbot that could no longer run a turn: its account is gone, is not a chatbot
   *  account, is an administrator, or it no longer has exactly one usable managed Project.
   *
   *  The public path refuses all of those on every single request, so this changes no answer a visitor gets.
   *  What it changes is what an administrator sees: a disabled chatbot that needs attention instead of an
   *  enabled one that silently answers nobody.
   *
   *  Nothing is assigned and nothing is created — the plugin never picks which container a website's turn
   *  lands in. A sweep that cannot read any account at all is skipped rather than acted on: with no accounts
   *  to check against, every bot would look orphaned, and an unreadable account list cannot be told apart
   *  from an empty one from here. */
  const disableUnusableBots = (reason: string): string[] => {
    if (stores.usersRead.list().length === 0) {
      warn(`chatbot: chatbots were not re-checked (${reason}): no account could be read`);
      return [];
    }
    const disabled: string[] = [];
    for (const bot of store.listBots()) {
      if (bot.status !== 'enabled') continue;
      const { blockers } = inspectAccount(stores, bot.chatbot_user_id);
      if (blockers.length === 0) continue;
      store.setBotStatus({ chatbotUserId: bot.chatbot_user_id, status: 'disabled', now: now().toISOString() });
      warn(`chatbot: ${bot.public_id} was disabled (${reason}): ${blockers.join(', ')}`);
      disabled.push(bot.public_id);
    }
    return disabled;
  };

  // A turn this process no longer runs cannot be resumed: the core turn is gone with the process, and
  // replaying it would be a second model turn for one submitted message. Say so instead of leaving a
  // visitor's widget waiting on a turn nobody will finish — and say it in the durable log as well, so a
  // widget that reconnects afterwards reads the same closing event a live stream would have sent.
  ctx.registerBootReconcile(() => {
    const closed = store.closeOrphanedTurns(now().toISOString(), 'server_restarted');
    for (const turnId of closed) broker.publish(turnId);
    if (closed.length > 0) warn(`chatbot: ${closed.length} interrupted turn(s) were closed as server_restarted`);
    // Every turn is closed above, so nothing of this process is in flight any more: the counts are stale by
    // definition, and a counter whose only writer is a `finally` would otherwise stay inflated for good.
    store.resetInFlight(now().toISOString());
    disableUnusableBots('the daemon restarted');
  });

  // An account that is deleted takes its chatbot's rows with it. Nothing else ever reaps them, and the
  // plugin may well be disabled when the deletion happens, which is why the boot reconcile above also
  // closes interrupted turns.
  ctx.registerUserRemoved((userId) => {
    const bot = store.botByUserId(userId);
    if (!bot) return;
    store.deleteBot(userId);
    logger.info(`chatbot: removed the registration and history of chatbot ${bot.public_id}`);
  });

  // A Project that disappears takes a chatbot's ability to run with it. The public path already refuses such
  // a bot on every request; this writes the fact down so an administrator sees a chatbot that needs
  // attention instead of one that silently answers nobody. Nothing is assigned, adopted or created — the
  // plugin never chooses which container an anonymous website's turn lands in.
  ctx.registerProjectRemoved((projectId) => {
    const disabled = disableUnusableBots(`project ${projectId} was removed`);
    if (disabled.length > 0) logger.info(`chatbot: disabled ${disabled.length} chatbot(s) whose Project is gone: ${disabled.join(', ')}`);
  });

  // Retention. One bounded pass every quarter of an hour, in the background: the cleaner deletes a
  // conversation in core through an advisor token for its own chatbot account, and only then removes what
  // this plugin holds. A pass that cannot confirm the core delete keeps everything and tries again.
  const cleaner = createRetentionCleaner({
    store,
    now,
    core: createCoreSessionBridge({
      // Both are read per call and never captured at registration: the deployment's own address and a
      // credential minted for one account are decisions of the running daemon, not of this module load.
      baseUrl: () => ctx.host.elowenCli().url ?? null,
      tokenForUser: (chatbotUserId) => ctx.host.elowenCli().tokenForUser(chatbotUserId),
    }),
    info: (message) => logger.info(message),
    warn,
  });
  ctx.registerInterval('chatbot-retention', async () => { await cleaner.run(); }, RETENTION_INTERVAL_MS);

  logger.info('chatbot plugin registered: platform, public hook v1, the admin route, the page-action tool and the retention cleaner');
}
