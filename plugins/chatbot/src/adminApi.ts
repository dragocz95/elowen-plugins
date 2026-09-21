import type { PluginApiAuth } from 'elowen/plugin-api';
import type { BotRow } from './db.js';
import type { ChatbotStore } from './store.js';
import { newPublicId } from './token.js';
import { inspectAccount, type ChatbotBlocker } from './preflight.js';
import { isUsableOrigin } from './origin.js';
import { validateBotCreate, validateBotPatch } from './validation.js';
import type { ChatbotStores } from './coreSeams.js';

/** The administrator's surface over the plugin's own rows. It creates nothing in core: the chatbot ACCOUNT
 *  and its Project assignment belong to the core admin API, and this route only registers a bot for an
 *  account that already exists as one. */

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

/** What an administrator needs to see about one bot: its own configuration, plus LIVE facts about the
 *  account it runs as. Nothing here is cached in the plugin — the account's kind, its Projects and its
 *  admin flag are read from the host, so a change in core is visible on the next load. */
interface BotView {
  chatbotUserId: number;
  publicId: string;
  displayName: string;
  prompt: string;
  status: BotRow['status'];
  origins: string[];
  embedSnippet: string | null;
  updatedAt: string;
  account: { username: string; type: 'human' | 'chatbot' | null; isAdmin: boolean } | null;
  projects: { id: number; slug: string }[];
  blockers: ChatbotBlocker[];
  insecureOrigins: string[];
}

const embedSnippetFor = (baseUrl: string | null, publicId: string): string | null =>
  baseUrl === null ? null : `<script src="${baseUrl}/hooks/chatbot/v1/widget.js" data-chatbot="${publicId}" async></script>`;

export function createAdminApi(deps: AdminApiDeps) {
  const { store, stores, now } = deps;

  const viewOf = (row: BotRow): BotView => {
    const { facts, blockers } = inspectAccount(stores, row.chatbot_user_id);
    const origins = store.originsOf(row.chatbot_user_id);
    return {
      chatbotUserId: row.chatbot_user_id,
      publicId: row.public_id,
      displayName: row.display_name,
      prompt: row.prompt,
      status: row.status,
      origins,
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
    };
  };

  /** Admin-only, and re-checked here rather than only by the manifest's `web.adminOnly`: the browser page
   *  is a convenience, the route is the boundary. */
  const requireAdmin = (auth: PluginApiAuth): Reply | null =>
    auth.admin ? null : { status: 403, body: { error: 'forbidden' } };

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
        },
      };
    },

    /** Register a draft for an existing chatbot account. `enabled` is never part of creation: a chatbot
     *  reaches the public hook through an explicit, preflighted enable. */
    async create(auth: PluginApiAuth, body: unknown): Promise<Reply> {
      const refusal = requireAdmin(auth);
      if (refusal) return refusal;
      const parsed = validateBotCreate(body);
      if (!parsed.ok) return { status: 400, body: { error: 'invalid_request', detail: parsed.error } };
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
        prompt: parsed.value.prompt,
        origins: parsed.value.origins,
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
      const current = store.botByUserId(parsed.value.chatbotUserId);
      if (!current) return { status: 404, body: { error: 'not_found' } };
      if (parsed.value.expectedUpdatedAt !== current.updated_at) return { status: 409, body: { error: 'conflict' } };

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
  };
}
