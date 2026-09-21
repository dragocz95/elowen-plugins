/** The administrator's surface, as ONE contract: the shapes the plugin's own admin routes answer with and
 *  the browser page reads. Types only and deliberately dependency-free, so the bundle can import them the
 *  way the widget imports `publicContract` — a second copy of these shapes in `web-src/` is how a page ends
 *  up reading a field the server stopped sending.
 *
 *  Nothing here is a secret: the visitor token, the signing key and the turn's own internals never appear
 *  on this contract. What travels is an administrator's own configuration and aggregate counts. */

/** One action rule: this action, on this origin and path prefix, needs this confirmation and may happen at
 *  most this often in one turn. `pathPrefix` is a path SEGMENT prefix (see `actionRules.covers`). */
export interface ChatbotActionRuleView {
  origin: string;
  pathPrefix: string;
  action: string;
  requiresConfirmation: boolean;
  maxPerTurn: number;
}

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

/** One chatbot: the plugin's own row, plus live facts about the account and the grants a turn needs. */
export interface ChatbotBotView {
  chatbotUserId: number;
  publicId: string;
  displayName: string;
  prompt: string;
  status: 'draft' | 'enabled' | 'disabled';
  origins: string[];
  actionRules: ChatbotActionRuleView[];
  /** What the customer pastes into their site. Null when the deployment has no canonical public URL. */
  embedSnippet: string | null;
  updatedAt: string;
  account: ChatbotAccountFactsView | null;
  projects: ChatbotProjectView[];
  /** Why this chatbot cannot run a turn right now, in the server's own vocabulary. */
  blockers: string[];
  /** Allowed domains an ENABLED chatbot would refuse, so the page can say it before Enable does. */
  insecureOrigins: string[];
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

/** One turn of a conversation, as an administrator may read it: the visitor's own words and the answer the
 *  plugin published to the widget. The model's tool calls and its reasoning are core transcript and are
 *  deliberately not part of this contract. Private to it: one field of {@link ChatbotTranscriptAnswer}. */
interface ChatbotTranscriptTurnView {
  turnId: string;
  visitorText: string;
  /** The whole answer, or null when the turn produced none (still running, or failed). */
  reply: string | null;
  status: string;
  errorCode: string | null;
  at: string;
}

/** `GET api/conversation?chatbotUserId=&visitorId=`, oldest turn first. */
export interface ChatbotTranscriptAnswer {
  chatbotUserId: number;
  visitorId: string;
  turns: ChatbotTranscriptTurnView[];
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
 *  These are the plugin's own admission counters. Token and cost totals are NOT here: the only
 *  origin-attributed spend in this codebase is core's `usage_by_origin`, which a plugin cannot read, so the
 *  page reads it from the admin usage route for the same window and the two meet on screen, each labelled
 *  for what it counts. */
export interface ChatbotStatsAnswer {
  chatbotUserId: number;
  /** Inclusive UTC days, `YYYY-MM-DD`. */
  from: string;
  to: string;
  days: ChatbotStatsDayView[];
  totals: { turns: number; done: number; errors: number; queued: number; running: number };
  /** How long a turn waited between being admitted and starting, over the same window. `p50Seconds` and
   *  `p95Seconds` are null when no turn in the window ever started, which is not the same as zero. */
  queueWait: { samples: number; p50Seconds: number | null; p95Seconds: number | null };
}
