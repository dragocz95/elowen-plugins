/** A stand-in for the daemon's conversation directory — `PluginHostStores.conversationsRead`, the narrow
 *  read-only projection the cronjob plugin organizes its recurring jobs by.
 *
 *  It reproduces the OBSERVABLE answers of the core projection (src/brain/conversationTargets.ts) rather
 *  than re-deriving them:
 *   - the scope check THROWS instead of returning an empty list, because a silently empty picker reads as
 *     "you have no conversations" and hides the bug;
 *   - `resolve` collapses "does not exist", "not an eligible target" and "outside the requested scope"
 *     into ONE null, so a probe cannot enumerate another account's conversations;
 *   - `resolveKey` is unscoped and eligibility-blind on purpose: it answers "which row is this" for a key
 *     the host itself minted, and the caller applies its own visibility rule to the answer.
 *
 *  Eligibility and emptiness are CORE's decisions, so a row carries them as explicit flags. The plugin
 *  must never re-derive either, and this fixture must not pretend to own them.
 */

export interface FakeConversationRow {
  id: string;
  /** The immutable identity core mints for the row; survives a channel rollover's re-key. */
  key: string;
  title: string;
  ownerUserId: number;
  platform?: string | null;
  direct?: boolean;
  updatedAt?: string;
  /** Core's isEligibleConversationTarget answer: false for a delegated child, a worker run or an
   *  archived channel transcript. */
  eligible?: boolean;
  /** Core's unspoken-shell answer: an empty conversation nobody has named or spoken in. */
  empty?: boolean;
}

interface ConversationTarget {
  id: string;
  key: string;
  title: string;
  ownerUserId: number;
  platform: string | null;
  direct: boolean;
  updatedAt: string;
}

export interface FakeConversationDirectory {
  list(opts: { actorUserId: number; ownerUserId?: number | null }): ConversationTarget[];
  resolve(opts: { actorUserId: number; ownerUserId?: number | null; sessionId: string }): ConversationTarget | null;
  resolveKey(key: string): ConversationTarget | null;
  /** Every call the plugin made, so a test can prove WHICH scope was asked for. */
  calls: { method: 'list' | 'resolve' | 'resolveKey'; actorUserId?: number; ownerUserId?: number | null; sessionId?: string; key?: string }[];
}

/** The conversation id the permissive stub below answers for. */
export const STUB_CONVERSATION_ID = 'conv-main';

/** A directory that simply ANSWERS: it mints `conv-*` for whichever account is asking and remembers what
 *  it minted, so a later read resolves the same row. For suites whose subject is schedules, ownership or
 *  revisions and which now have to name a conversation to create a job at all — what makes a target
 *  eligible, and for whom, is the subject of cronConversationGroups.test.ts. */
export function stubConversationDirectory(): Omit<FakeConversationDirectory, 'calls'> {
  const minted = new Map<string, ConversationTarget>();
  const mint = (id: string, ownerUserId: number): ConversationTarget => {
    const row: ConversationTarget = {
      id, key: `ns-${id}`, title: 'Chat', ownerUserId,
      platform: null, direct: false, updatedAt: '2026-07-01T00:00:00.000Z',
    };
    minted.set(row.key, row);
    return row;
  };
  return {
    list: ({ ownerUserId }) => [mint(STUB_CONVERSATION_ID, ownerUserId ?? 0)],
    resolve: ({ ownerUserId, sessionId }) => (sessionId.startsWith('conv-') ? mint(sessionId, ownerUserId ?? 0) : null),
    resolveKey: (key) => minted.get(key) ?? null,
  };
}

const toTarget = (row: FakeConversationRow): ConversationTarget => ({
  id: row.id,
  key: row.key,
  title: row.title,
  ownerUserId: row.ownerUserId,
  platform: row.platform ?? null,
  direct: row.direct === true,
  updatedAt: row.updatedAt ?? '2026-09-01T00:00:00.000Z',
});

/** Build the directory over a mutable row table. `rows` may be edited between calls, which is how a test
 *  reproduces a channel rollover (the row keeps its key and takes a new id) or a deletion. */
export function conversationDirectory(
  rows: FakeConversationRow[],
  opts: { admins?: number[] } = {},
): FakeConversationDirectory {
  const admins = new Set(opts.admins ?? []);
  const calls: FakeConversationDirectory['calls'] = [];
  const assertScope = (actorUserId: number, ownerUserId?: number | null): void => {
    if (ownerUserId == null) {
      if (!admins.has(actorUserId)) throw new Error('the instance conversation scope requires an administrator');
      return;
    }
    if (ownerUserId !== actorUserId && !admins.has(actorUserId)) {
      throw new Error("another account's conversation scope requires an administrator");
    }
  };
  const visible = (row: FakeConversationRow): boolean => row.eligible !== false && row.empty !== true;

  return {
    calls,
    list({ actorUserId, ownerUserId }) {
      calls.push({ method: 'list', actorUserId, ownerUserId });
      assertScope(actorUserId, ownerUserId);
      return rows
        .filter((row) => (ownerUserId == null || row.ownerUserId === ownerUserId) && visible(row))
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        .map(toTarget);
    },
    resolve({ actorUserId, ownerUserId, sessionId }) {
      calls.push({ method: 'resolve', actorUserId, ownerUserId, sessionId });
      assertScope(actorUserId, ownerUserId);
      const row = rows.find((entry) => entry.id === sessionId);
      if (!row) return null;
      if (ownerUserId != null && row.ownerUserId !== ownerUserId) return null;
      if (!visible(row)) return null;
      return toTarget(row);
    },
    resolveKey(key) {
      calls.push({ method: 'resolveKey', key });
      const row = rows.find((entry) => entry.key === key);
      return row ? toTarget(row) : null;
    },
  };
}
