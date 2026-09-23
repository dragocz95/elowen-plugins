import type { PluginApiAuth } from 'elowen/plugin-api';
import type { BotRow } from './db.js';
import type { ChatbotStore } from './store.js';
import { isVisitorId, newPublicId } from './token.js';
import { inspectAccount } from './preflight.js';
import { isUsableOrigin } from './origin.js';
import { LIMIT_FIELDS, readBotLimits, incompleteValues, missingLimits, storedLimits, type LimitValues, type MandatoryLimitField } from './limits.js';
import { validateAppearanceWrite, validateBotCreate, validateBotPatch } from './validation.js';
import { parseStoredAppearance } from './appearanceContract.js';
import { utcDay } from './budget.js';
import type { ChatbotStores } from './coreSeams.js';
import { PUBLIC_MOUNT, WIDGET_ASSET_NAME } from './publicContract.js';
import { PAGE_ACTION_TOOL_NAME } from './actionsTool.js';
import { OFFER_TOOL_NAME } from './offerTool.js';
import type {
  ChatbotBotView,
  ChatbotConversationsAnswer,
  ChatbotFeedbackAnswer,
  ChatbotModelView,
  ChatbotStatsAnswer,
  ChatbotVisitorsAnswer,
} from './adminContract.js';

/** The administrator's surface over the plugin's own rows. It creates nothing in core: the chatbot ACCOUNT
 *  and its Project assignment belong to the core admin API, and this route only registers a bot for an
 *  account that already exists as one.
 *
 *  Configuration and admissions belong to this plugin. Spend is read from core's `usage_by_origin`
 *  through the same store projection admission uses. No query computes spend by scanning messages. */

export interface AdminApiDeps {
  store: ChatbotStore;
  stores: ChatbotStores;
  /** Canonical deployment URL, for the embed snippet. Null when the deployment has none. */
  publicBaseUrl: () => string | null;
  now: () => Date;
  /** Erase one chatbot's conversations here and in core, one bounded batch per call. Injected rather than
   *  built here: deleting a transcript in core needs a credential only the running daemon can mint, and this
   *  surface decides WHO may ask for it, not how it is done. */
  erase: (input: { chatbotUserId: number; limit: number }) => Promise<{ deleted: number; kept: number }>;
  /** Where a read the host REFUSED is reported. The register still answers the rest of its rows; the reason
   *  core gave lands here rather than being dressed up as a model. */
  warn: (message: string) => void;
}

interface Reply {
  status: number;
  body: object;
}

/** How many conversations one page of the register holds. */
const CONVERSATIONS_DEFAULT_LIMIT = 25;
const CONVERSATIONS_MAX_LIMIT = 100;

/** How many visitors the register's picker offers: the most recently active ones. Bounded so one read
 *  never walks a chatbot's whole audience, and the answer says when the bound cut the list. */
const VISITORS_LIMIT = 500;

/** How far back a statistics read may reach, and the window it uses when a caller names none. Bounded so a
 *  request can never ask the daemon to walk the whole history of an account for a chart nobody can read. */
const STATS_DEFAULT_DAYS = 30;
const STATS_MAX_DAYS = 366;

/** One UTC day, or null when the caller's value is not a date at all. The stats route takes days, not
 *  timestamps, because every counter below is keyed by the UTC day the plugin already groups by. */
const readDay = (value: string | undefined): string | null => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? utcDay(parsed) : null;
};

/** The nearest-rank percentile of a small sample. Nearest-rank rather than an interpolation: with a
 *  handful of turns per day, "the 95th percentile" is a real turn's own wait, and an interpolated number
 *  between two turns is one no visitor ever experienced. */
export function percentileMs(samples: readonly number[], fraction: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index]!;
}

// Keep this URL stable: widgetAssetHeaders requires ETag revalidation on every page load.
// Per-load query strings would discard the cached body and defeat the cheap 304 path.
const embedSnippetFor = (baseUrl: string | null, publicId: string): string | null =>
  baseUrl === null ? null : `<script src="${baseUrl}/hooks/chatbot/${PUBLIC_MOUNT}/${WIDGET_ASSET_NAME}" data-chatbot="${publicId}" async></script>`;

/** The model this chatbot's visitors are answered by, from core's own composed answer for the account — the
 *  same rules a spawn applies, so the row can never promise a model the turn would not really run. This
 *  plugin has no model of its own to report and no route to write one: it asks, and states the answer.
 *
 *  A REFUSAL is a state of its own rather than a failure of this register. Core throws for an account that
 *  may run no configured model at all, and one mis-granted account must not take the whole register down
 *  with it: the refusal is reported as "core named no model" — which is exactly what is true — and core's
 *  own message goes to the daemon log, where an operator can act on it. */
function modelOf(stores: ChatbotStores, chatbotUserId: number, warn: (message: string) => void): ChatbotModelView | null {
  try {
    return stores.usersRead.effectiveChatExec(chatbotUserId);
  } catch (reason) {
    warn(`chatbot: no model could be named for account ${chatbotUserId} (${reason instanceof Error ? reason.message : String(reason)})`);
    return null;
  }
}

export function createAdminApi(deps: AdminApiDeps) {
  const { store, stores, now, warn } = deps;

  const viewOf = (row: BotRow): ChatbotBotView => {
    const { facts, blockers } = inspectAccount(stores, row.chatbot_user_id);
    const origins = store.originsOf(row.chatbot_user_id);
    return {
      chatbotUserId: row.chatbot_user_id,
      publicId: row.public_id,
      displayName: row.display_name,
      status: row.status,
      origins,
      maySubmitForms: row.may_submit_forms === 1,
      appearance: parseStoredAppearance(row.appearance),
      embedSnippet: embedSnippetFor(deps.publicBaseUrl(), row.public_id),
      updatedAt: row.updated_at,
      account: facts.account === null ? null : {
        username: facts.account.username,
        type: facts.account.type ?? null,
        isAdmin: facts.account.isAdmin,
      },
      projects: facts.projects.map((project) => ({ id: project.id, slug: project.slug })),
      model: modelOf(stores, row.chatbot_user_id, warn),
      blockers,
      insecureOrigins: origins.filter((origin) => !isUsableOrigin(origin)),
      limits: storedLimits(row),
      budget: store.dailyBudget(row.chatbot_user_id, readBotLimits(row), utcDay(now().getTime())),
      missingLimits: missingLimits(row),
      sensitiveMode: row.sensitive_mode === 1,
    };
  };

  /** Fold one write's limits over the row they are replacing.
   *
   *  One rule for every field: a field the payload carries is written, including a carried null (which says
   *  "this number is not decided"), and a field it does not carry keeps what the row has. The enable gate
   *  below then judges the folded result, so what an administrator is told and what a visitor would get are
   *  the same set of numbers. */
  const mergeLimits = (row: BotRow, patch: Partial<LimitValues>): LimitValues => {
    const stored = storedLimits(row);
    const merged = {} as LimitValues;
    for (const field of LIMIT_FIELDS) {
      merged[field] = field in patch ? patch[field]! : stored[field];
    }
    return merged;
  };

  /** Admin-only, and re-checked here rather than only by the manifest's `web.adminOnly`: the browser page
   *  is a convenience, the route is the boundary. */
  const requireAdmin = (auth: PluginApiAuth): Reply | null =>
    auth.admin ? null : { status: 403, body: { error: 'forbidden' } };

  /** The only answer the sensitive-data mode gets from this version.
   *
   *  Where such a visitor's words are processed and how long they are kept are decisions this plugin does not
   *  own: the model's location, the contractual terms and the exact retention for identity numbers and
   *  addresses are still open. Until an owner decides them, the mode is a REQUEST that is stored as nothing
   *  and answered with this. This is deliberately not a step an implementer may relax, and nothing here may
   *  choose a provider or call the plugin compliant. */
  const privacyUnresolved = (): Reply => ({ status: 409, body: { error: 'privacy_policy_unresolved' } });

  /** A chatbot this instance knows, or a refusal. Every route below names its chatbot by id, and the id is
   *  re-checked against the host's own account list — a plugin row for an account that no longer exists
   *  (or never was a chatbot) must not become readable history through an admin route. */
  const requireBot = (chatbotUserId: number): { row: BotRow } | Reply => {
    const row = store.botByUserId(chatbotUserId);
    if (!row) return { status: 404, body: { error: 'not_found' } };
    const account = stores.usersRead.list().find((candidate) => candidate.id === chatbotUserId);
    if (!account) return { status: 404, body: { error: 'account_unknown' } };
    return { row };
  };

  const isRefusal = (value: { row: BotRow } | Reply): value is Reply => 'status' in value;

  const readChatbotUserId = (raw: string | undefined): number | null => {
    const parsed = Number(raw);
    return raw !== undefined && raw !== '' && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  };

  const clampLimit = (raw: string | undefined, fallback: number, max: number): number => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(max, Math.floor(parsed));
  };

  return {
    async list(auth: PluginApiAuth): Promise<Reply> {
      const refusal = requireAdmin(auth);
      if (refusal) return refusal;
      // Accounts that could carry a chatbot but do not yet: what the page offers when an administrator
      // registers one. Only the kind that may carry a chatbot is offered, and never one that already has a
      // register row. The server refuses anything else at creation time anyway, but a register that OFFERS
      // a person invites an administrator to fill a form that cannot succeed.
      const registered = new Set(store.listBots().map((row) => row.chatbot_user_id));
      const candidates = stores.usersRead.list()
        .filter((account) => account.type === 'chatbot' && !registered.has(account.id))
        .map((account) => ({ id: account.id, username: account.username, type: account.type ?? null }));
      const projects = stores.projects.list()
        .filter((project) => project.executionKind === 'managed' && project.lifecycle !== 'deleting')
        .map((project) => ({ id: project.id, slug: project.slug }));
      return {
        status: 200,
        body: {
          bots: store.listBots().map(viewOf),
          candidates,
          projects,
          // The core grant a chatbot account needs before a turn of its may touch a visitor's page. Read
          // from the plugin's OWN registration rather than restated in the browser bundle.
          requiredTools: [PAGE_ACTION_TOOL_NAME, OFFER_TOOL_NAME],
        },
      };
    },

    /** Register a draft for an existing chatbot account. `enabled` is never part of creation: a chatbot
     *  reaches the public hook through an explicit, preflighted enable. Every omitted limit starts from the
     *  owner-approved default profile; explicit values may still override it. */
    async create(auth: PluginApiAuth, body: unknown): Promise<Reply> {
      const refusal = requireAdmin(auth);
      if (refusal) return refusal;
      const parsed = validateBotCreate(body);
      if (!parsed.ok) return { status: 400, body: { error: 'invalid_request', detail: parsed.error } };
      // Asking for the sensitive-data mode is answered before anything is written: the mode is a request this
      // version cannot grant, and a draft that recorded it as granted would be a lie in the database.
      if (parsed.value.sensitiveMode) return privacyUnresolved();
      if (store.botByUserId(parsed.value.chatbotUserId)) {
        return { status: 409, body: { error: 'already_registered' } };
      }
      const { blockers } = inspectAccount(stores, parsed.value.chatbotUserId);
      // Only the account itself can disqualify creation. A missing Project is allowed here and reported
      // as a blocker, so an administrator can register the chatbot first and bind the Project after.
      const disqualifying = blockers.filter((blocker) => blocker === 'account_unknown' || blocker === 'account_not_chatbot' || blocker === 'account_admin');
      if (disqualifying.length > 0) return { status: 400, body: { error: 'account_invalid', detail: disqualifying } };
      // A public id is an identifier, not a secret: it names the chatbot in the embed snippet. It is
      // generated server-side so nobody can choose one that reads as another site's chatbot.
      const row = store.createBot({
        chatbotUserId: parsed.value.chatbotUserId,
        publicId: newPublicId(),
        displayName: parsed.value.displayName,
        origins: parsed.value.origins,
        limits: parsed.value.limits,
        maySubmitForms: parsed.value.maySubmitForms,
        now: now().toISOString(),
      });
      return { status: 200, body: { bot: viewOf(row) } };
    },

    /** Write the whole editable state back, and optionally flip `enabled`. Compare-and-set on the row's
     *  own `updatedAt` is what stops two administrators from silently overwriting each other. */
    async update(auth: PluginApiAuth, body: unknown): Promise<Reply> {
      const refusal = requireAdmin(auth);
      if (refusal) return refusal;
      const parsed = validateBotPatch(body);
      if (!parsed.ok) return { status: 400, body: { error: 'invalid_request', detail: parsed.error } };
      if (parsed.value.sensitiveMode) return privacyUnresolved();
      const current = store.botByUserId(parsed.value.chatbotUserId);
      if (!current) return { status: 404, body: { error: 'not_found' } };
      if (parsed.value.expectedUpdatedAt !== current.updated_at) return { status: 409, body: { error: 'conflict' } };
      const limits = mergeLimits(current, parsed.value.limits);
      const incomplete: MandatoryLimitField[] = incompleteValues(limits);

      // A chatbot that is enabled, or is being enabled, has to come OUT of this write able to serve. A draft
      // may still carry an explicit missing value while an administrator is deciding a replacement.
      if (parsed.value.action === 'enable' || current.status === 'enabled') {
        if (incomplete.length > 0) return { status: 400, body: { error: 'not_ready', detail: incomplete } };
      }

      if (parsed.value.action === 'enable') {
        // Enable is the point at which this chatbot may answer the public internet, so the whole rule is
        // re-run here rather than trusted from when the draft was registered.
        const { blockers } = inspectAccount(stores, current.chatbot_user_id);
        if (blockers.length > 0) return { status: 400, body: { error: 'not_ready', detail: blockers } };
        if (parsed.value.origins.length === 0) return { status: 400, body: { error: 'not_ready', detail: ['no_origins'] } };
        const insecure = parsed.value.origins.filter((origin) => !isUsableOrigin(origin));
        if (insecure.length > 0) return { status: 400, body: { error: 'not_ready', detail: ['insecure_origin'] } };
      }

      const updated = store.updateBot({
        chatbotUserId: parsed.value.chatbotUserId,
        expectedUpdatedAt: parsed.value.expectedUpdatedAt,
        displayName: parsed.value.displayName,
        origins: parsed.value.origins,
        limits,
        maySubmitForms: parsed.value.maySubmitForms,
        now: now().toISOString(),
      });
      // Lost between the read and the write: someone else committed first.
      if (!updated) return { status: 409, body: { error: 'conflict' } };
      // A plain edit leaves the status alone; enable and disable are explicit actions of their own.
      const next = parsed.value.action === null
        ? updated
        : store.setBotStatus({
          chatbotUserId: parsed.value.chatbotUserId,
          status: parsed.value.action === 'enable' ? 'enabled' : 'disabled',
          now: now().toISOString(),
        })!;
      return { status: 200, body: { bot: viewOf(next) } };
    },

    /** One page of this chatbot's conversations. Metadata only — a visitor's own words are read one
     *  conversation at a time, so a register never becomes a transcript dump. */
    async conversations(auth: PluginApiAuth, query: Record<string, string>): Promise<Reply> {
      const refusal = requireAdmin(auth);
      if (refusal) return refusal;
      const chatbotUserId = readChatbotUserId(query.chatbotUserId);
      if (chatbotUserId === null) return { status: 400, body: { error: 'invalid_request', detail: '"chatbotUserId" must be a positive integer' } };
      // The one way to narrow the register: exactly one visitor, picked from `visitors`. Absent means all of
      // them; anything that is not a whole visitor id is a malformed request, never a fragment to match.
      const visitorId = query.visitor ?? null;
      if (visitorId !== null && !isVisitorId(visitorId)) {
        return { status: 400, body: { error: 'invalid_request', detail: '"visitor" must be a visitor id' } };
      }
      const bot = requireBot(chatbotUserId);
      if (isRefusal(bot)) return bot;
      // The core projection needs the verified caller to decide the scope; a request without an account has
      // no scope to ask for.
      const actorUserId = auth.userId;
      if (actorUserId === null) return { status: 403, body: { error: 'forbidden' } };
      const limit = clampLimit(query.limit, CONVERSATIONS_DEFAULT_LIMIT, CONVERSATIONS_MAX_LIMIT);
      const offset = Math.max(0, Math.floor(Number(query.offset)) || 0);
      // A conversation's title is core's own (the auto-titler names the session, a person may rename it), so
      // it is read per row from the host's conversation projection, scoped to the chatbot account that owns
      // these sessions, rather than stored here as a second copy that would go stale.
      const conversations = store.conversations({ chatbotUserId, visitorId, limit, offset }).map((row) => {
        const target = row.sessionId === null
          ? null
          : stores.conversationsRead.resolve({ actorUserId, ownerUserId: chatbotUserId, sessionId: row.sessionId });
        return { ...row, title: target === null || target.title === '' ? null : target.title };
      });
      const total = store.conversationCount({ chatbotUserId, visitorId });
      return { status: 200, body: { conversations, total, limit, offset } satisfies ChatbotConversationsAnswer };
    },

    async feedback(auth: PluginApiAuth, query: Record<string, string>): Promise<Reply> {
      const refusal = requireAdmin(auth);
      if (refusal) return refusal;
      const chatbotUserId = query.chatbotUserId === undefined ? null : readChatbotUserId(query.chatbotUserId);
      if (query.chatbotUserId !== undefined && chatbotUserId === null) {
        return { status: 400, body: { error: 'invalid_request', detail: '"chatbotUserId" must be a positive integer' } };
      }
      if (chatbotUserId !== null) {
        const bot = requireBot(chatbotUserId);
        if (isRefusal(bot)) return bot;
      }
      const rating = query.rating ?? 'all';
      if (rating !== 'all' && rating !== 'up' && rating !== 'down') {
        return { status: 400, body: { error: 'invalid_request', detail: '"rating" must be all, up or down' } };
      }
      const offset = query.offset === undefined ? 0 : Number(query.offset);
      if (!Number.isSafeInteger(offset) || offset < 0) {
        return { status: 400, body: { error: 'invalid_request', detail: '"offset" must be a nonnegative integer' } };
      }
      const limit = clampLimit(query.limit, CONVERSATIONS_DEFAULT_LIMIT, CONVERSATIONS_MAX_LIMIT);
      const result = store.feedbackList({ chatbotUserId, rating: rating === 'all' ? null : rating, limit, offset });
      return { status: 200, body: { ...result, limit, offset } satisfies ChatbotFeedbackAnswer };
    },

    /** The visitors the register can be narrowed to, for the picker: most recently active first, each with
     *  the last address the host vouched for. Searching happens in the picker, over this bounded list. */
    async visitors(auth: PluginApiAuth, query: Record<string, string>): Promise<Reply> {
      const refusal = requireAdmin(auth);
      if (refusal) return refusal;
      const chatbotUserId = readChatbotUserId(query.chatbotUserId);
      if (chatbotUserId === null) return { status: 400, body: { error: 'invalid_request', detail: '"chatbotUserId" must be a positive integer' } };
      const bot = requireBot(chatbotUserId);
      if (isRefusal(bot)) return bot;
      // One more than the bound is read, so the answer can say whether the bound cut anything off.
      const rows = store.visitors({ chatbotUserId, limit: VISITORS_LIMIT + 1 });
      return {
        status: 200,
        body: { visitors: rows.slice(0, VISITORS_LIMIT), truncated: rows.length > VISITORS_LIMIT } satisfies ChatbotVisitorsAnswer,
      };
    },

    /** Erase this chatbot's conversations, here and in core. One bounded batch per call, so the answer says
     *  what is left: `remaining` above zero means the caller repeats. A conversation whose answer is still
     *  being written is reported as `kept` and survives, exactly as retention leaves it. */
    async eraseConversations(auth: PluginApiAuth, query: Record<string, string>): Promise<Reply> {
      const refusal = requireAdmin(auth);
      if (refusal) return refusal;
      const chatbotUserId = readChatbotUserId(query.chatbotUserId);
      if (chatbotUserId === null) return { status: 400, body: { error: 'invalid_request', detail: '"chatbotUserId" must be a positive integer' } };
      const bot = requireBot(chatbotUserId);
      if (isRefusal(bot)) return bot;
      const { deleted, kept } = await deps.erase({ chatbotUserId, limit: CONVERSATIONS_MAX_LIMIT });
      return { status: 200, body: { deleted, kept, remaining: store.conversationCount({ chatbotUserId, visitorId: null }) } };
    },

    /** This chatbot's admission counters and core origin usage over the same bounded UTC window. */
    async stats(auth: PluginApiAuth, query: Record<string, string>): Promise<Reply> {
      const refusal = requireAdmin(auth);
      if (refusal) return refusal;
      const chatbotUserId = readChatbotUserId(query.chatbotUserId);
      if (chatbotUserId === null) return { status: 400, body: { error: 'invalid_request', detail: '"chatbotUserId" must be a positive integer' } };
      const bot = requireBot(chatbotUserId);
      if (isRefusal(bot)) return bot;

      const today = utcDay(now().getTime());
      const requestedTo = readDay(query.to);
      const toDay = requestedTo ?? today;
      const requestedFrom = readDay(query.from);
      const fromDay = requestedFrom ?? utcDay(Date.parse(`${toDay}T00:00:00.000Z`) - (STATS_DEFAULT_DAYS - 1) * 86_400_000);
      // A window the caller got backwards is a mistake to report, not a range to silently swap.
      if (fromDay > toDay) return { status: 400, body: { error: 'invalid_request', detail: '"from" must not be after "to"' } };
      const spanDays = Math.round((Date.parse(`${toDay}T00:00:00.000Z`) - Date.parse(`${fromDay}T00:00:00.000Z`)) / 86_400_000) + 1;
      if (spanDays > STATS_MAX_DAYS) return { status: 400, body: { error: 'invalid_request', detail: `the window may span at most ${STATS_MAX_DAYS} days` } };

      const waits = store.queueWaitsMs({ chatbotUserId, fromDay, toDay });
      const p50 = percentileMs(waits, 0.5);
      const p95 = percentileMs(waits, 0.95);
      return {
        status: 200,
        body: {
          chatbotUserId,
          from: fromDay,
          to: toDay,
          days: store.dailyTurns({ chatbotUserId, fromDay, toDay }),
          spend: Array.from({ length: spanDays }, (_, index) => {
            const day = utcDay(Date.parse(`${fromDay}T00:00:00.000Z`) + index * 86_400_000);
            return { day, usage: store.usageFor(chatbotUserId, day) };
          }),
          totals: store.turnTotals({ chatbotUserId, fromDay, toDay }),
          queueWait: {
            samples: waits.length,
            p50Seconds: p50 === null ? null : Math.round(p50 / 100) / 10,
            p95Seconds: p95 === null ? null : Math.round(p95 / 100) / 10,
          },
        } satisfies ChatbotStatsAnswer,
      };
    },

    /** Save the look, and the display name that goes with it, as a whole. Its own route rather than another
     *  optional field of `PATCH bots`, so the appearance editor cannot touch the domains it never showed,
     *  and so a colour cannot be saved through a payload nobody validated as an appearance. */
    async updateAppearance(auth: PluginApiAuth, body: unknown): Promise<Reply> {
      const refusal = requireAdmin(auth);
      if (refusal) return refusal;
      const parsed = validateAppearanceWrite(body);
      if (!parsed.ok) return { status: 400, body: { error: 'invalid_request', detail: parsed.error } };
      const current = store.botByUserId(parsed.value.chatbotUserId);
      if (!current) return { status: 404, body: { error: 'not_found' } };
      if (parsed.value.expectedUpdatedAt !== current.updated_at) return { status: 409, body: { error: 'conflict' } };

      const updated = store.updateAppearance({
        chatbotUserId: parsed.value.chatbotUserId,
        expectedUpdatedAt: parsed.value.expectedUpdatedAt,
        displayName: parsed.value.displayName,
        appearance: JSON.stringify(parsed.value.appearance),
        now: now().toISOString(),
      });
      // Lost between the read and the write: someone else committed first.
      if (!updated) return { status: 409, body: { error: 'conflict' } };
      return { status: 200, body: { bot: viewOf(updated) } };
    },
  };
}