import type { PluginDb, SessionSource } from 'elowen/plugin-api';
import { pluginDbFor } from './pluginDb.js';
import { ChatbotAdapter } from '../../plugins/chatbot/src/adapter.js';
import { PageActionService } from '../../plugins/chatbot/src/actionService.js';
import { TurnEventBroker } from '../../plugins/chatbot/src/broker.js';
import { createPublicRoute, STREAM_PING_INTERVAL_MS, type PublicRouteDeps } from '../../plugins/chatbot/src/publicRoutes.js';
import { ChatbotTurnQueue } from '../../plugins/chatbot/src/queue.js';
import { ChatbotStore } from '../../plugins/chatbot/src/store.js';
import { migrate } from '../../plugins/chatbot/src/db.js';
import { newPublicId, newSecret } from '../../plugins/chatbot/src/token.js';
import { DEFAULT_LIMITS, type LimitValues } from '../../plugins/chatbot/src/limits.js';
import type { ChatbotAccountView, ChatbotHookRequest, ChatbotProjectView, ChatbotRelayEvent, ChatbotStores } from '../../plugins/chatbot/src/coreSeams.js';

/** The fake host every chatbot suite drives the public path against.
 *
 *  The plugin's public surface is deliberately reachable without a daemon: the route takes a hook request,
 *  the queue takes a relay control, and the stores it consults for account and Project facts are three
 *  methods wide. That is what makes the security rules testable at all — the only parts of the host this
 *  fixture does NOT fake are the ones the plugin cannot decide itself (the relay's identity and policy
 *  resolution, the canonical request origin, the hook body cap). */

/** The signing key. Shared by a suite so a test can re-sign a payload the plugin would not have minted. */
export const CHATBOT_SECRET = newSecret();

export const CHATBOT_SITE = 'https://www.example.cz';

/** A COMPLETE limit set: what an administrator fills in before a chatbot may be enabled.
 *
 *  These numbers belong to the fixture, not to the plugin — the plugin has no defaults at all, and that is the
 *  property the limit tests exist to prove. A suite that is ABOUT a limit passes its own value through
 *  `registerBot`/`setLimits` instead of editing this, so the value a test exercises is visible in the test. */
export const TEST_LIMITS: LimitValues = { ...DEFAULT_LIMITS };

/** The origin the HOST resolved, which is a separate fact from the browser's Origin header. */
export const TRUSTED_REQUEST_ORIGIN = { value: '203.0.113.9', kind: 'ip' as const, trusted: true };

export const CLIENT_TURN_ID = '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c34';

export type ChatbotHookReply = Awaited<ReturnType<ReturnType<typeof createPublicRoute>>>;

export interface RelayCall {
  src: SessionSource;
  text: string;
  observer?: { onEvent: (event: ChatbotRelayEvent) => void; signal?: AbortSignal };
}

export interface TurnInput {
  src: SessionSource;
  text: string;
  observer?: RelayCall['observer'];
}

export interface ChatbotHost {
  /** The plugin's own tables, for the one thing a test cannot reach through the plugin's API: a stored row
   *  that contradicts the payload it was written from, which is how a defence-in-depth branch is shown to
   *  be load-bearing rather than merely present. */
  db: PluginDb;
  store: ChatbotStore;
  adapter: ChatbotAdapter;
  queue: ChatbotTurnQueue;
  broker: TurnEventBroker;
  /** The page-action half: the same service the tool asks and the public route reports to. */
  actions: PageActionService;
  stores: ChatbotStores;
  handler: ReturnType<typeof createPublicRoute>;
  calls: RelayCall[];
  warnings: string[];
  /** The turn behaviour. A test that needs a LIVE turn replaces it and drives the observer by hand. */
  handleTurn: (input: TurnInput) => Promise<string | undefined>;
  /** Move the one clock this host reads. A rule about TIME — an action's own expiry, a token's lifetime — is
   *  exercised by moving the instant, never by sleeping through it. */
  setNow: (ms: number) => void;
  /** Write a chatbot's limits the way an administrator does, so a suite can configure one mid-scenario. */
  setLimits(chatbotUserId: number, limits: Partial<LimitValues>): void;
  /** The queue's waiting clock, driven by hand: every deadline it scheduled, keyed by turn, and a way to fire
   *  one. A turn that WAITS for a slot is how the queue's own timeout is exercised without waiting it out. */
  queueDeadlines: Map<string, { delayMs: number; fire: () => void }>;
  fireQueueTimeout(turnId: string): void;
}

/** The answer the default turn behaviour resolves with. */
const SCRIPTED_REPLY = 'Dobrý den, s čím pomohu?';

/** The default turn: one session event, traffic a public log must never carry, one text delta, and the
 *  answer the relay resolves with. Exported so a test can install the same shape with no answer at all. */
export function scriptedTurn(reply: string | undefined): (input: TurnInput) => Promise<string | undefined> {
  return async ({ observer }) => {
    observer?.onEvent({ type: 'session', sessionId: 'brain-ch-chatbot-session' });
    // Reasoning and tool traffic are what a public log must never carry; the queue's allowlist drops them.
    observer?.onEvent({ type: 'reasoning', delta: 'internal thinking' });
    // Deliberately NOT a shape the plugin's narrow restatement declares: a public log has to drop a tool
    // event whatever core puts in it, so this fake carries a field the plugin never reads.
    observer?.onEvent({ type: 'tool', name: 'Search' } as ChatbotRelayEvent);
    observer?.onEvent({ type: 'text', delta: reply ?? '' });
    return reply;
  };
}

/** The instant every fixture starts at, so a token's `iat` and a stored timestamp are comparable. Exported
 *  because a test that moves the clock has to say where it moved it FROM. */
export const NOW_MS = 1_800_000_000_000;
const NOW_ISO = new Date(NOW_MS).toISOString();

let hostCount = 0;

/** The host as this plugin sees it. `accounts` and `projects` are handed in as LIVE arrays, so a test can
 *  change the world between two requests — which is exactly what the per-admission preflight exists for. */
export function createChatbotHost(options: {
  accounts?: ChatbotAccountView[];
  projects?: ChatbotProjectView[];
  pingIntervalMs?: number;
  actionTimeoutMs?: number;
  /** The core's own answer to "may this account use this plugin right now" — the grant an administrator
   *  hands out. True by default, because a chatbot without it answers questions and can do nothing else. */
  mayUsePlugin?: (userId: number) => boolean;
} = {}): ChatbotHost {
  hostCount += 1;
  // One in-memory database per host, addressed the way the loader addresses it: the helper returns the
  // per-plugin resolver, so the plugin's own migration bookkeeping is exercised for real.
  const db = pluginDbFor(`chatbot-test-${hostCount}`)('chatbot');
  migrate(db);
  const store = new ChatbotStore(db);
  const accounts: ChatbotAccountView[] = options.accounts ?? [
    { id: 12, username: 'ured-bot', name: 'Úřad', avatar: '', isAdmin: false, type: 'chatbot' },
  ];
  const projects: ChatbotProjectView[] = options.projects ?? [{ id: 4, slug: 'ured', path: '/ured', executionKind: 'managed' }];
  const stores = {
    usersRead: {
      list: () => accounts,
      isAdmin: (id: number) => accounts.find((account) => account.id === id)?.isAdmin === true,
      allowedExecs: () => [],
      mayUsePlugin: (id: number) => options.mayUsePlugin?.(id) ?? true,
    },
    projects: { get: (id: number) => projects.find((project) => project.id === id) ?? null, list: () => projects },
    userProjects: { canAccess: () => true, canManage: () => true },
  } as unknown as ChatbotStores;

  const calls: RelayCall[] = [];
  const warnings: string[] = [];
  const warn = (message: string): void => { warnings.push(message); };
  const adapter = new ChatbotAdapter(warn);
  adapter.listen(async () => undefined);
  const broker = new TurnEventBroker(warn);
  // One movable instant for every part of this host: the store, the queue, the action service and the token
  // issuer all read the same clock, so a test moves time for all of them at once.
  let clockMs = NOW_MS;
  const now = (): Date => new Date(clockMs);

  const host: ChatbotHost = {
    db,
    store,
    adapter,
    broker,
    stores,
    calls,
    warnings,
    handleTurn: scriptedTurn(SCRIPTED_REPLY),
    queue: undefined as unknown as ChatbotTurnQueue,
    actions: undefined as unknown as PageActionService,
    handler: undefined as unknown as ReturnType<typeof createPublicRoute>,
    setNow: (ms: number) => { clockMs = ms; },
    setLimits: (chatbotUserId: number, limits: Partial<LimitValues>) => store.updateBot({
      chatbotUserId,
      expectedUpdatedAt: store.botByUserId(chatbotUserId)!.updated_at,
      displayName: store.botByUserId(chatbotUserId)!.display_name,
      origins: store.originsOf(chatbotUserId),
      limits: { ...TEST_LIMITS, ...limits },
      maySubmitForms: store.botByUserId(chatbotUserId)!.may_submit_forms === 1,
      now: now().toISOString(),
    }),
    queueDeadlines: new Map(),
    fireQueueTimeout: (turnId: string) => { host.queueDeadlines.get(turnId)?.fire(); },
  };
  adapter.control({
    relay: (src, text, observer) => {
      calls.push({ src, text, ...(observer ? { observer } : {}) });
      return host.handleTurn({ src, text, ...(observer ? { observer } : {}) });
    },
  });

  // The queue's clock is the fixture's, not a real one: a waiting turn's deadline is fired by the test that
  // is about it, and no suite leaves a pending 60-second timer behind.
  host.queue = new ChatbotTurnQueue({
    store,
    adapter,
    broker,
    now: () => now().toISOString(),
    warn,
    schedule: (turnId, delayMs, fn) => {
      host.queueDeadlines.set(turnId, { delayMs, fire: fn });
      return () => host.queueDeadlines.delete(turnId);
    },
  });
  // The action wait is short here on purpose: what a suite is checking is which state answers a waiting
  // tool, not how long a visitor takes to click.
  host.actions = new PageActionService({
    store,
    broker,
    now,
    info: (message) => { warnings.push(message); },
    warn,
    timeoutMs: options.actionTimeoutMs ?? 120,
  });
  const deps: PublicRouteDeps = {
    store,
    queue: host.queue,
    adapter,
    stores,
    broker,
    actions: host.actions,
    pingIntervalMs: options.pingIntervalMs ?? STREAM_PING_INTERVAL_MS,
    secret: () => CHATBOT_SECRET,
    tokenTtlSeconds: () => 30 * 86_400,
    now,
    warn,
  };
  host.handler = createPublicRoute(deps);
  return host;
}

/** A hook request. `origin: null` drops the host-resolved origin entirely, which is how a daemon that does
 *  not carry the seam looks; `acceptsStreamBody: false` is a daemon that buffers whatever it is handed. */
export function publicRequest(input: {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  origin?: typeof TRUSTED_REQUEST_ORIGIN | null;
  acceptsStreamBody?: boolean;
  query?: Record<string, string>;
}): ChatbotHookRequest {
  const origin = input.origin === undefined ? TRUSTED_REQUEST_ORIGIN : input.origin;
  return {
    ...(origin === null ? {} : { origin }),
    method: input.method,
    path: input.path,
    query: input.query ?? {},
    headers: input.headers ?? {},
    body: () => Promise.resolve(Buffer.from(JSON.stringify(input.body ?? {}), 'utf8')),
    json: () => Promise.resolve(input.body ?? {}),
    ...(input.acceptsStreamBody === false ? {} : { acceptsStreamBody: true }),
  } as ChatbotHookRequest;
}

/** A POST with the JSON body content type this API requires. */
export function postRequest(input: {
  path: string;
  headers: Record<string, string>;
  body: unknown;
  origin?: typeof TRUSTED_REQUEST_ORIGIN | null;
}): ChatbotHookRequest {
  return publicRequest({
    method: 'POST',
    path: input.path,
    body: input.body,
    origin: input.origin,
    headers: { 'content-type': 'application/json', ...input.headers },
  });
}

/** Register one chatbot for an account. Draft unless a status is given, and configured with the fixture's
 *  complete limit set unless a test passes its own — an enabled chatbot with no numbers is a state the admin
 *  route refuses to create, so a suite that wants one asks for it explicitly with `limits: {}`. */
export function registerBot(host: ChatbotHost, input: {
  chatbotUserId?: number;
  publicId?: string;
  status?: 'draft' | 'enabled';
  origins?: string[];
  limits?: Partial<LimitValues>;
  maySubmitForms?: boolean;
} = {}): void {
  const row = host.store.createBot({
    chatbotUserId: input.chatbotUserId ?? 12,
    publicId: input.publicId ?? newPublicId(),
    displayName: 'Městský úřad',
    origins: input.origins ?? [CHATBOT_SITE],
    limits: input.limits ?? TEST_LIMITS,
    maySubmitForms: input.maySubmitForms,
    now: NOW_ISO,
  });
  if ((input.status ?? 'enabled') === 'enabled') host.store.setBotStatus({ chatbotUserId: row.chatbot_user_id, status: 'enabled', now: row.updated_at });
}

export async function issueToken(host: ChatbotHost, input: { site?: string; publicId?: string } = {}): Promise<{ status: number; body: Record<string, any> }> {
  const bot = input.publicId ?? host.store.listBots()[0]!.public_id;
  const answer = await host.handler(postRequest({
    path: 'visitors',
    headers: { origin: input.site ?? CHATBOT_SITE },
    body: { schemaVersion: 1, bot },
  }));
  return { status: answer.status, body: answer.body as Record<string, any> };
}

/** The queue runs off the request path by design, so a test waits for the turn to settle rather than for
 *  the POST that submitted it. */
export async function settledTurn(host: ChatbotHost, turnId: string): Promise<'done' | 'error'> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const row = host.store.turn(turnId);
    if (row && (row.status === 'done' || row.status === 'error')) return row.status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('turn never settled');
}
