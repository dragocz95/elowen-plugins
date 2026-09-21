import type { PluginApiAuth } from 'elowen/plugin-api';
import type { ActionRuleRow, BotRow } from './db.js';
import type { ChatbotStore } from './store.js';
import { newPublicId } from './token.js';
import { inspectAccount } from './preflight.js';
import { isUsableOrigin } from './origin.js';
import { LIMIT_FIELDS, incompleteValues, missingLimits, storedLimits, type LimitValues, type MandatoryLimitField } from './limits.js';
import { validateAppearanceWrite, validateBotCreate, validateBotPatch } from './validation.js';
import { parseStoredAppearance } from './appearanceContract.js';
import type { ChatbotStores } from './coreSeams.js';
import { PAGE_ACTION_TOOL_NAME } from './actionsTool.js';
import type {
  ChatbotActionRuleView,
  ChatbotBotView,
  ChatbotConversationsAnswer,
  ChatbotStatsAnswer,
  ChatbotTranscriptAnswer,
} from './adminContract.js';

/** The administrator's surface over the plugin's own rows. It creates nothing in core: the chatbot ACCOUNT
 *  and its Project assignment belong to the core admin API, and this route only registers a bot for an
 *  account that already exists as one.
 *
 *  Everything a reader sees here is either the plugin's own configuration or a COUNT over the plugin's own
 *  rows. Spend is the one thing this plugin cannot read: the only origin-attributed spend in this codebase
 *  is core's `usage_by_origin` rollup, and the admin page reads it from the core usage route for the chatbot
 *  account. No query here, and none on the page, ever counts spend by scanning messages. */

export interface AdminApiDeps {
  store: ChatbotStore;
  stores: ChatbotStores;
  /** Canonical deployment URL, for the embed snippet. Null when the deployment has none. */
  publicBaseUrl: () => string | null;
  now: () => Date;
}

interface Reply {
  status: number;
  body: object;
}

/** How many conversations one page of the register holds, and how many turns one transcript read returns.
 *  Both are bounded reads on purpose: this surface is a register and a transcript, not an export. */
const CONVERSATIONS_DEFAULT_LIMIT = 25;
const CONVERSATIONS_MAX_LIMIT = 100;
const TRANSCRIPT_MAX_TURNS = 200;

/** How far back a statistics read may reach, and the window it uses when a caller names none. Bounded so a
 *  request can never ask the daemon to walk the whole history of an account for a chart nobody can read. */
const STATS_DEFAULT_DAYS = 30;
const STATS_MAX_DAYS = 366;

const utf8Day = (date: Date): string => date.toISOString().slice(0, 10);

/** One UTC day, or null when the caller's value is not a date at all. The stats route takes days, not
 *  timestamps, because every counter below is keyed by the UTC day the plugin already groups by. */
const readDay = (value: string | undefined): string | null => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? utf8Day(new Date(parsed)) : null;
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

const ruleView = (row: ActionRuleRow): ChatbotActionRuleView => ({
  origin: row.origin,
  pathPrefix: row.path_prefix,
  action: row.action,
  requiresConfirmation: row.requires_confirmation === 1,
  maxPerTurn: row.max_per_turn,
});

const embedSnippetFor = (baseUrl: string | null, publicId: string): string | null =>
  baseUrl === null ? null : `<script src="${baseUrl}/hooks/chatbot/v1/widget.js" data-chatbot="${publicId}" async></script>`;

/** Domains a rule names that this chatbot does not answer on.
 *
 *  The policy checks the domain allowlist BEFORE it looks at any rule (`resolveActionRule`), so such a rule
 *  can never match anything: it is a policy that silently does nothing while reading like one that does.
 *  Both writes below refuse it rather than storing it. */
const strayRuleOrigins = (rules: readonly { origin: string }[], origins: readonly string[]): string[] =>
  [...new Set(rules.map((rule) => rule.origin).filter((origin) => !origins.includes(origin)))];

export function createAdminApi(deps: AdminApiDeps) {
  const { store, stores, now } = deps;

  const viewOf = (row: BotRow): ChatbotBotView => {
    const { facts, blockers } = inspectAccount(stores, row.chatbot_user_id);
    const origins = store.originsOf(row.chatbot_user_id);
    return {
      chatbotUserId: row.chatbot_user_id,
      publicId: row.public_id,
      displayName: row.display_name,
      prompt: row.prompt,
      status: row.status,
      origins,
      actionRules: store.actionRulesOf(row.chatbot_user_id).map(ruleView),
      appearance: parseStoredAppearance(row.appearance),
      embedSnippet: embedSnippetFor(deps.publicBaseUrl(), row.public_id),
      updatedAt: row.updated_at,
      account: facts.account === null ? null : {
        username: facts.account.username,
        type: facts.account.type ?? null,
        isAdmin: facts.account.isAdmin,
      },
      projects: facts.projects.map((project) => ({ id: project.id, slug: project.slug })),
      blockers,
      insecureOrigins: origins.filter((origin) => !isUsableOrigin(origin)),
      limits: storedLimits(row),
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
      // registers one. Administrators are excluded because a chatbot must never be one.
      const registered = new Set(store.listBots().map((row) => row.chatbot_user_id));
      const candidates = stores.usersRead.list()
        .filter((account) => !account.isAdmin && !registered.has(account.id))
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
          requiredTools: [PAGE_ACTION_TOOL_NAME],
        },
      };
    },

    /** Register a draft for an existing chatbot account. `enabled` is never part of creation: a chatbot
     *  reaches the public hook through an explicit, preflighted enable. The limits a draft carries are
     *  whatever the administrator has already decided; the rest stay unset. */
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
      const stray = strayRuleOrigins(parsed.value.actionRules, parsed.value.origins);
      if (stray.length > 0) return { status: 400, body: { error: 'invalid_request', detail: `action rule for a domain this chatbot does not answer on: ${stray.join(', ')}` } };

      // A public id is an identifier, not a secret: it names the chatbot in the embed snippet. It is
      // generated server-side so nobody can choose one that reads as another site's chatbot.
      const row = store.createBot({
        chatbotUserId: parsed.value.chatbotUserId,
        publicId: newPublicId(),
        displayName: parsed.value.displayName,
        prompt: parsed.value.prompt,
        origins: parsed.value.origins,
        limits: parsed.value.limits,
        actionRules: parsed.value.actionRules,
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
      // The policy this write leaves behind: what it carries, or the policy the row already holds when it
      // carries none. The stray-domain check below judges THAT, because it is what a visitor would get.
      const rules = parsed.value.actionRules ?? store.actionRuleInputsOf(current.chatbot_user_id);

      // A chatbot that is enabled, or is being enabled, has to come OUT of this write able to serve. A draft
      // is deliberately free of all of it: a draft is what an administrator is still deciding, and that is
      // where its numbers are chosen.
      if (parsed.value.action === 'enable' || current.status === 'enabled') {
        if (incomplete.length > 0) return { status: 400, body: { error: 'not_ready', detail: incomplete } };
      }

      const stray = strayRuleOrigins(rules, parsed.value.origins);
      if (stray.length > 0) return { status: 400, body: { error: 'invalid_request', detail: `action rule for a domain this chatbot does not answer on: ${stray.join(', ')}` } };

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
        prompt: parsed.value.prompt,
        origins: parsed.value.origins,
        limits,
        actionRules: rules,
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
      const bot = requireBot(chatbotUserId);
      if (isRefusal(bot)) return bot;
      const limit = clampLimit(query.limit, CONVERSATIONS_DEFAULT_LIMIT, CONVERSATIONS_MAX_LIMIT);
      const offset = Math.max(0, Math.floor(Number(query.offset)) || 0);
      const conversations = store.conversations({ chatbotUserId, limit, offset });
      const total = store.conversationCount(chatbotUserId);
      return { status: 200, body: { conversations, total, limit, offset } satisfies ChatbotConversationsAnswer };
    },

    /** One conversation, as an administrator may read it: the visitor's own words and the answer the
     *  plugin published. Tool calls and reasoning are core transcript and are not part of this contract —
     *  they are never read here, so they can never leak through this route. */
    async conversation(auth: PluginApiAuth, query: Record<string, string>): Promise<Reply> {
      const refusal = requireAdmin(auth);
      if (refusal) return refusal;
      const chatbotUserId = readChatbotUserId(query.chatbotUserId);
      if (chatbotUserId === null) return { status: 400, body: { error: 'invalid_request', detail: '"chatbotUserId" must be a positive integer' } };
      const visitorId = typeof query.visitorId === 'string' ? query.visitorId : '';
      if (visitorId === '') return { status: 400, body: { error: 'invalid_request', detail: '"visitorId" is required' } };
      const bot = requireBot(chatbotUserId);
      if (isRefusal(bot)) return bot;
      const turns = store.conversationTurns({ chatbotUserId, visitorId, limit: TRANSCRIPT_MAX_TURNS });
      const replies = store.doneRepliesOf(turns.map((turn) => turn.turn_id));
      return {
        status: 200,
        body: {
          chatbotUserId,
          visitorId,
          turns: turns.map((turn) => ({
            turnId: turn.turn_id,
            visitorText: turn.message,
            reply: replies.get(turn.turn_id) ?? null,
            status: turn.status,
            errorCode: turn.error_code,
            at: turn.created_at,
          })),
        } satisfies ChatbotTranscriptAnswer,
      };
    },

    /** This chatbot's own admission counters over a window of UTC days. No spend here: tokens and cost are
     *  read from core's `usage_by_origin` rollup by the page, which is the only place that counter exists. */
    async stats(auth: PluginApiAuth, query: Record<string, string>): Promise<Reply> {
      const refusal = requireAdmin(auth);
      if (refusal) return refusal;
      const chatbotUserId = readChatbotUserId(query.chatbotUserId);
      if (chatbotUserId === null) return { status: 400, body: { error: 'invalid_request', detail: '"chatbotUserId" must be a positive integer' } };
      const bot = requireBot(chatbotUserId);
      if (isRefusal(bot)) return bot;

      const today = utf8Day(now());
      const requestedTo = readDay(query.to);
      const toDay = requestedTo ?? today;
      const requestedFrom = readDay(query.from);
      const fromDay = requestedFrom ?? utf8Day(new Date(Date.parse(`${toDay}T00:00:00.000Z`) - (STATS_DEFAULT_DAYS - 1) * 86_400_000));
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
     *  optional field of `PATCH bots`, so the appearance editor cannot touch the prompt or the domains it
     *  never showed, and so a colour cannot be saved through a payload nobody validated as an appearance. */
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
