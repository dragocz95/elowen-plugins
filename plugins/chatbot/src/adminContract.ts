/** The administrator's surface, as ONE contract: the shapes the plugin's own admin routes answer with and
 *  the browser page reads. Types only, and its sole dependency is the plugin's own limit table — because the
 *  limits a chatbot carries ARE the server's numbers, and a page that declared them for itself would be free
 *  to read a field the server stopped sending.
 *
 *  Nothing here is a secret: the visitor token, the signing key and the turn's own internals never appear
 *  on this contract. What travels is an administrator's own configuration and aggregate counts. */

import type { LimitValues, MandatoryLimitField } from './limits.js';
import type { DailyBudget, OriginUsage } from './budget.js';
import type { StoredAppearance } from './appearanceContract.js';

export const DISPLAY_NAME_MAX_CHARS = 80;

/** The account a chatbot runs as, as the host reports it right now. A missing kind means a host whose user
 *  contract does not carry one, which is NOT the same as a chatbot. Private to this contract: it is the
 *  shape of one field of {@link ChatbotBotView}, not a name a caller has any reason to hold. */
interface ChatbotAccountFactsView {
  username: string;
  type: 'human' | 'chatbot' | null;
  isAdmin: boolean;
}

export interface ChatbotProjectView {
  id: number;
  slug: string;
}

/** Which model a chatbot's visitors are answered by, and what decided it. Both fields are CORE's own answer
 *  for the account the chatbot runs as, read live for every listing: a model belongs to an account, so a copy
 *  on the plugin's row would be a second answer to a question core owns, and it would be wrong the moment an
 *  administrator changed the model in the account.
 *
 *  `source` is what makes the row honest rather than merely informative. `preference` is the account's own
 *  stored pick, `instance` is the instance default it fell back to, and `allowed` is a model this account's
 *  allow-list forced it onto because the default is not permitted to it. The last two are different facts —
 *  an account answering from its allow-list has inherited nothing — so the page states them differently. */
export interface ChatbotModelView {
  exec: string;
  source: 'preference' | 'instance' | 'allowed';
}

/** One chatbot: the plugin's own row, plus live facts about the account and the grants a turn needs. */
export interface ChatbotBotView {
  chatbotUserId: number;
  publicId: string;
  displayName: string;
  status: 'draft' | 'enabled' | 'disabled';
  origins: string[];
  maySubmitForms: boolean;
  /** What the customer pastes into their site. Null when the deployment has no canonical public URL. */
  embedSnippet: string | null;
  updatedAt: string;
  account: ChatbotAccountFactsView | null;
  projects: ChatbotProjectView[];
  /** Which model answers this chatbot's visitors, or null when core names none: an account core does not
   *  know, an instance with no provider configured, or an account permitted no configured model at all.
   *  None of those is "the instance default", so the page states no model rather than a guess. */
  model: ChatbotModelView | null;
  /** Why this chatbot cannot run a turn right now, in the server's own vocabulary. */
  blockers: string[];
  /** Allowed domains an ENABLED chatbot would refuse, so the page can say it before Enable does. */
  insecureOrigins: string[];
  /** Every limit as stored, with an unset one as null. The form writes the whole set back on every save. */
  limits: LimitValues;
  budget: DailyBudget;
  /** The mandatory numbers still unset. Non-empty means this chatbot cannot be enabled yet, and the page
   *  says which numbers are missing rather than offering a button the server would refuse. */
  missingLimits: MandatoryLimitField[];
  /** Whether the sensitive-data mode has been ASKED for. Asking is all that is stored: this version refuses
   *  the request itself until the model location and the retention policy are decided, and the page says so
   *  rather than offering a switch that cannot work. */
  sensitiveMode: boolean;
  /** The linked template and explicit overrides. The editor resolves these with the shared contract;
   *  only the public route serves a fully resolved appearance. */
  appearance: StoredAppearance;
}

/** An account that could carry a chatbot but does not yet. */
export interface ChatbotAccountOptionView {
  id: number;
  username: string;
  type: 'human' | 'chatbot' | null;
}

/** `GET api/bots`: the register, what creation may pick from, and the core tool grants a chatbot account
 *  needs. The tool names come from here rather than from the page, because the plugin's own tool is
 *  declared by the plugin's own code — a name restated in the bundle is a name that drifts. */
export interface ChatbotsAnswer {
  bots: ChatbotBotView[];
  candidates: ChatbotAccountOptionView[];
  projects: ChatbotProjectView[];
  requiredTools: string[];
}

/** One visitor's conversation, as the register lists it. Metadata only: what was said is read one
 *  conversation at a time. */
export interface ChatbotConversationView {
  visitorId: string;
  /** The core session reported by the relay, not an id the plugin derives. */
  sessionId: string | null;
  turns: number;
  errors: number;
  firstAt: string;
  lastAt: string;
  lastStatus: string;
}

/** `GET api/conversations?chatbotUserId=&limit=&offset=`. `total` counts the conversations of THIS
 *  chatbot, so a pager never offers a page the server would answer empty. */
export interface ChatbotConversationsAnswer {
  conversations: ChatbotConversationView[];
  total: number;
  limit: number;
  offset: number;
}

/** One UTC day of this chatbot's own turn counters. */
export interface ChatbotStatsDayView {
  day: string;
  turns: number;
  done: number;
  errors: number;
}

/** `GET api/stats?chatbotUserId=&from=&to=`.
 *
 *  Admission counters come from the plugin; tokens and money come from core's origin rollup,
 *  scoped to this chatbot and the same UTC window. No spend is computed from messages. */
export interface ChatbotStatsAnswer {
  chatbotUserId: number;
  /** Inclusive UTC days, `YYYY-MM-DD`. */
  from: string;
  to: string;
  days: ChatbotStatsDayView[];
  /** Core origin rollup for every UTC day, including days with no admitted turns. */
  spend: { day: string; usage: OriginUsage | null }[];
  totals: { turns: number; done: number; errors: number; queued: number; running: number };
  /** How long a turn waited between being admitted and starting, over the same window. `p50Seconds` and
   *  `p95Seconds` are null when no turn in the window ever started, which is not the same as zero. */
  queueWait: { samples: number; p50Seconds: number | null; p95Seconds: number | null };
}
