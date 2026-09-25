// @vitest-environment node
/** The chatbot identity triple, pinned across the repository boundary.
 *
 *  A `chatbot` account is a KIND core owns: it is the `CHECK` in the account table, the reason memory is
 *  off, and the whole reason such an account exists. Core names the plugin behind that kind in one line
 *  (`CHATBOT_PLUGIN` in the auth routes) and reuses the kind as the PLATFORM that authorises deleting a
 *  channel session, so three strings have to agree with what `plugins/chatbot` declares. Nothing in either
 *  tree states the agreement, and a rename on one side is SILENT in both directions:
 *
 *  - rename the plugin and the account is still created, the grant simply names nothing, and a chatbot
 *    answers visitors while its page-control tool is quietly absent from its prompt;
 *  - rename the platform and every visitor session is minted under a name core will not accept as the
 *    authority to delete it, so the retention cleaner keeps every transcript while logging only its own
 *    warning, and "we delete a visitor's conversation after N days" quietly stops being true.
 *
 *  Source text cannot be compared across the repo boundary — core publishes `dist/`, not `src/` — so the
 *  core half is pinned BEHAVIOURALLY against the built checkout named by `ELOWEN_CORE_ROOT` wherever core
 *  exports the rule (the account-create schema, the session-id grammar, the delete predicate, the delete
 *  route), and by source text only for the two facts core keeps private: the plugin name it grants and the
 *  account kind it passes as platform authority.
 *
 *  This is deliberately a TEST rather than a seam: resolving the plugin from a manifest field would let
 *  installed plugin data decide a grant and a delete authority, which is the shape `platformIdentity.ts`
 *  rejects in its own words for the sibling decision — and no second consumer needs that mapping. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHATBOT_PLATFORM, conversationChannelId } from '../plugins/chatbot/src/adapter.js';
import { inspectAccount } from '../plugins/chatbot/src/preflight.js';
import { createCoreSessionBridge } from '../plugins/chatbot/src/coreSessions.js';
import { createChatbotHost } from './helpers/chatbotHost.js';

const configuredCoreRoot = process.env.ELOWEN_CORE_ROOT?.trim();
if (!configuredCoreRoot) {
  throw new Error('[chatbot-identity-parity] ELOWEN_CORE_ROOT must point to the authoritative built core checkout');
}
const coreRoot = configuredCoreRoot;
console.info(`[chatbot-identity-parity] core source: ELOWEN_CORE_ROOT (${coreRoot})`);

const coreAuthRoute = readFileSync(join(coreRoot, 'dist/api/routes/auth.js'), 'utf8');
const coreBrainRoute = readFileSync(join(coreRoot, 'dist/api/routes/brain.js'), 'utf8');
const coreSessionIds = await import(pathToFileURL(join(coreRoot, 'dist/brain/sessionId.js')).href) as {
  channelSessionId: (channelId: string) => string;
  platformOfSession: (sessionId: string) => string | null;
  mayDeleteSession: (row: unknown, userId: number, sessionId: string, channelPlatform?: string) => boolean;
};
const coreAuthSchemas = await import(pathToFileURL(join(coreRoot, 'dist/api/schemas/auth.js')).href) as {
  userCreateSchema: { safeParse: (input: unknown) => { success: boolean } };
};

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'plugins/chatbot/elowen-plugin.json'), 'utf8')) as {
  name: string;
  provides: { platforms: string[] };
};

const CHATBOT_USER_ID = 9;
/** A visitor session exactly as core mints one for a chatbot turn: `CHANNEL_PREFIX` + the platform the
 *  plugin registers + the channel id the plugin builds for this pair of accounts. Built from core's own
 *  prefix and the plugin's own channel-id rule, so this test never spells out a session-id literal. */
const VISITOR_SESSION_ID = coreSessionIds.channelSessionId(
  `${CHATBOT_PLATFORM}-${conversationChannelId(CHATBOT_USER_ID, 'visitor')}`,
);

describe('the plugin a chatbot account is created for', () => {
  it('is the plugin this repository publishes', () => {
    const granted = /const CHATBOT_PLUGIN = '([^']+)'/.exec(coreAuthRoute)?.[1];
    expect(granted, 'core must still name the plugin a new chatbot account is granted in CHATBOT_PLUGIN').toBeTruthy();
    // A rename on either side fails here: the manifest name is what `setGrantedPlugins` matches against
    // the installed plugin, so a grant that never lands leaves the account unable to touch its own page.
    expect(granted).toBe(manifest.name);
  });

  it('is granted through that one constant rather than a second literal', () => {
    expect(coreAuthRoute).toMatch(/setGrantedPlugins\(created\.id,\s*\[CHATBOT_PLUGIN\]\)/);
  });

  it('declares the platform its code registers', () => {
    expect(manifest.provides.platforms).toContain(CHATBOT_PLATFORM);
  });
});

describe('the account kind core accepts for a chatbot', () => {
  it('is the platform this plugin registers', () => {
    // Core turns this kind into the channel platform that authorises a delete (`user.type` below), so the
    // kind and the registered platform are one name in two repositories.
    expect(coreAuthSchemas.userCreateSchema.safeParse({ type: CHATBOT_PLATFORM, username: 'visitor-bot' }).success).toBe(true);
  });

  it('is one literal kind, not any type string', () => {
    // Without this the assertion above stays green on a core that widened the field, while the account
    // table's own CHECK constraint refused the insert and the plugin's account gate refused the account.
    expect(coreAuthSchemas.userCreateSchema.safeParse({ type: `${CHATBOT_PLATFORM}_v2`, username: 'visitor-bot' }).success).toBe(false);
  });

  it('is the kind core hands to the plugin account gate', () => {
    const host = createChatbotHost({
      accounts: [
        { id: CHATBOT_USER_ID, username: 'visitor-bot', name: 'Bot', avatar: '', isAdmin: false, type: CHATBOT_PLATFORM },
        { id: 10, username: 'human', name: 'Human', avatar: '', isAdmin: false, type: 'human' },
      ],
    });
    // The same rule guards the public hook and the admin enable, so a kind the plugin does not recognise
    // is every visitor's turn refused — the reason `src/preflight.ts` exists next to this test.
    expect(inspectAccount(host.stores, CHATBOT_USER_ID).blockers).toEqual([]);
    expect(inspectAccount(host.stores, 10).blockers).toContain('account_not_chatbot');
  });
});

describe('the platform a visitor session is minted under', () => {
  const row = { user_id: CHATBOT_USER_ID, delegated_access: null };

  it('is the one core reads back out of the session id', () => {
    expect(coreSessionIds.platformOfSession(VISITOR_SESSION_ID)).toBe(CHATBOT_PLATFORM);
  });

  it('is the authority core accepts when the plugin deletes the transcript it owns', () => {
    expect(coreSessionIds.mayDeleteSession(row, CHATBOT_USER_ID, VISITOR_SESSION_ID, CHATBOT_PLATFORM)).toBe(true);
  });

  it('is compared rather than assumed, so a rename would refuse that delete', () => {
    expect(coreSessionIds.mayDeleteSession(row, CHATBOT_USER_ID, VISITOR_SESSION_ID, `${CHATBOT_PLATFORM}_v2`)).toBe(false);
  });

  it('is the account kind core derives it from, never the request', () => {
    const authority = /const channelPlatform = user\.type === '([^']+)'[^;]*?\? user\.type\s*: undefined;/.exec(coreBrainRoute);
    expect(authority, 'core must still derive channel-delete authority from the authenticated account kind in the session delete route').toBeTruthy();
    expect(authority?.[1]).toBe(CHATBOT_PLATFORM);
  });
});

describe('the route the retention cleaner deletes through', () => {
  it('is the route core registers, at the path the plugin requests', async () => {
    const registered = /app\.delete\('(\/brain\/sessions\/:id)'/.exec(coreBrainRoute)?.[1];
    expect(registered, 'core must still register the session delete route the adapter bridge calls').toBeTruthy();

    const requested: string[] = [];
    const bridge = createCoreSessionBridge({
      baseUrl: () => 'http://daemon.invalid',
      tokenForUser: () => 'advisor-token',
      fetchImpl: async (input) => {
        requested.push(String(input));
        return new Response(null, { status: 200 });
      },
    });

    expect(await bridge.deleteSession({ chatbotUserId: CHATBOT_USER_ID, sessionId: VISITOR_SESSION_ID }))
      .toEqual({ ok: true, outcome: 'deleted' });
    // A renamed or moved route answers 404, which the bridge reads as "unverified" and retries forever:
    // the transcript is never deleted and the cleaner says so only in its own warning.
    expect(requested).toEqual([`http://daemon.invalid${registered!.replace(':id', encodeURIComponent(VISITOR_SESSION_ID))}`]);
  });
});
