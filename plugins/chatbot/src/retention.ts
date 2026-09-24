import type { CoreSessionBridge } from './coreSessions.js';
import type { ConversationRow } from './db.js';
import type { ChatbotStore } from './store.js';

/** The retention cleaner: the one thing that makes "we keep a visitor's conversation for N days" true.
 *
 *  A pass is a bounded batch, and it is deliberately slow and boring:
 *
 *  1. conversations whose due date has passed and that have no turn waiting or running;
 *  2. for each of them, core's own DELETE of the conversation, through an advisor token for the chatbot
 *     account — the plugin never touches a `brain_*` row itself;
 *  3. only after core confirmed it, one plugin transaction that removes the conversation, its turns, their
 *     event log and their actions;
 *  4. then the cheap sweeps: expired tokens, rate windows whose minute is over, and visitors who can no longer
 *     be reached and have nothing left to come back to.
 *
 *  An answer from core that is neither a success nor a verified "no such session" keeps EVERYTHING for this
 *  conversation and the pass moves on. That is the whole failure policy: a transcript this plugin cannot
 *  confirm deleted is a transcript that is still there, and pretending otherwise would leave a visitor's words
 *  in a database nobody is looking at any more.
 *
 *  Visitor uploads remain ordinary files in the bot's managed Project even after transcript deletion.
 *  Unclaimed receipt metadata expires separately; the Project file is never removed here. */

/** How many conversations one pass deletes. Each one is a network round trip to the daemon between two plugin
 *  transactions, so the bound keeps a pass short rather than making it thorough: a backlog is worked off by
 *  the following passes. */
const CONVERSATIONS_PER_PASS = 25;

/** How many rows each of the sweeps may remove in one pass. All three are indexed by the column they are due
 *  on, so one of these is a bounded range scan. */
const SWEEP_PER_PASS = 500;

/** How often the cleaner runs. Retention is measured in days and rate windows in minutes: a quarter of an hour
 *  keeps a minute-granular table small without waking the daemon up often. */
export const RETENTION_INTERVAL_MS = 15 * 60_000;

export interface RetentionDeps {
  store: ChatbotStore;
  now: () => Date;
  core: CoreSessionBridge;
  /** Operator-facing lines: counts, never a visitor's text. */
  info: (message: string) => void;
  warn: (message: string) => void;
}

export interface RetentionPassResult {
  /** Conversations deleted here and in core, in this pass. */
  deleted: number;
  /** Due conversations kept because core could not confirm the delete. */
  deferred: number;
  tokens: number;
  visitors: number;
  windows: number;
  uploads: number;
}

export function createRetentionCleaner(deps: RetentionDeps): { run(): Promise<RetentionPassResult | null> } {
  let running = false;
  return {
    /** One pass, or `null` when the previous one is still going. A skipped pass is reported rather than
     *  silently dropped: two passes at once would each delete the same conversation and each pay for it. */
    async run(): Promise<RetentionPassResult | null> {
      if (running) {
        deps.warn('chatbot retention: the previous pass is still running, skipping this one');
        return null;
      }
      running = true;
      try {
        return await runPass(deps);
      } finally {
        running = false;
      }
    },
  };
}

async function runPass(deps: RetentionDeps): Promise<RetentionPassResult> {
  const { store } = deps;
  const now = deps.now().toISOString();
  const result: RetentionPassResult = { deleted: 0, deferred: 0, tokens: 0, visitors: 0, windows: 0, uploads: 0 };

  for (const conversation of store.retentionCandidates({ now, limit: CONVERSATIONS_PER_PASS })) {
    const removed = await deleteOne(deps, conversation);
    if (removed) result.deleted += 1;
    else result.deferred += 1;
  }

  result.uploads = store.purgeExpiredUploads({ now, limit: SWEEP_PER_PASS });
  result.tokens = store.purgeExpiredTokens({ now, limit: SWEEP_PER_PASS });
  result.visitors = store.purgeOrphanVisitors({ now, limit: SWEEP_PER_PASS });
  result.windows = store.purgeExpiredRateWindows({ now, limit: SWEEP_PER_PASS });

  if (result.deleted > 0 || result.deferred > 0 || result.tokens > 0 || result.visitors > 0 || result.windows > 0 || result.uploads > 0) {
    deps.info(`chatbot retention: removed ${result.deleted} conversation(s)${result.deferred > 0 ? `, kept ${result.deferred} awaiting core` : ''}, `
      + `${result.tokens} expired token(s), ${result.visitors} unreachable visitor(s), ${result.windows} rate window(s), ${result.uploads} expired upload receipt(s)`);
  }
  return result;
}

/** Erase one chatbot's conversations on an operator's word, through the same two steps a retention pass
 *  uses: core's own delete first, this plugin's rows second, and nothing removed here that core did not
 *  confirm gone there. Bounded per call like a pass; the caller repeats until nothing is left.
 *
 *  A conversation with a turn still running is left alone and reported as kept, exactly as retention leaves
 *  it: an answer being written is not a transcript this plugin may take apart underneath it. */
export async function eraseConversations(
  deps: RetentionDeps,
  input: { chatbotUserId: number; limit: number },
): Promise<{ deleted: number; kept: number }> {
  let deleted = 0;
  let kept = 0;
  for (const conversation of deps.store.erasableConversations(input)) {
    if (await deleteOne(deps, conversation)) deleted += 1;
    else kept += 1;
  }
  if (deleted > 0 || kept > 0) {
    deps.info(`chatbot ${input.chatbotUserId}: erased ${deleted} conversation(s) on request`
      + `${kept > 0 ? `, kept ${kept} awaiting core` : ''}`);
  }
  return { deleted, kept };
}

/** Delete one conversation in core and then here. `false` means "keep everything and try again later". */
async function deleteOne(deps: RetentionDeps, conversation: ConversationRow): Promise<boolean> {
  if (conversation.session_id !== null) {
    const answer = await deps.core.deleteSession({
      chatbotUserId: conversation.chatbot_user_id,
      sessionId: conversation.session_id,
    });
    if (!answer.ok) {
      deps.warn(`chatbot retention: conversation ${conversation.id} of chatbot ${conversation.chatbot_user_id} was kept: core did not confirm the delete (${answer.reason})`);
      return false;
    }
  }
  // No session id means nothing ever ran in core for this conversation: the plugin's own rows are all there
  // is, and they are already past their due date.
  deps.store.deleteConversation(conversation);
  return true;
}
