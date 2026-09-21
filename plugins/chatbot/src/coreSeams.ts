import type { PluginContext, PluginHttpRequest, PluginHostStores, PluginUserView, SessionSource } from 'elowen/plugin-api';

/** The host contracts this plugin consumes that the published `elowen` package does not type yet.
 *
 *  A registry plugin is compiled against a RELEASED daemon while it targets the core it is written for, so
 *  a seam the core has just gained resolves to nothing here. The shape below is the approved contract from
 *  the core seam design, restated in this repository the same way `plugins/sites/src/coreSeams.ts` restates
 *  its own newer transports — never a second protocol, only the local declaration of one. Delete each
 *  restatement in the change that moves the `elowen` devDependency past the release carrying it. */

/** `ClientOrigin` from the daemon's single origin decider (`src/api/clientIp.ts`): where a request came
 *  from and whether the deployment's own trust configuration makes that value canonical. `trusted` is
 *  never authentication, never a browser-Origin allowlist decision and never a permission. */
export interface ChatbotClientOrigin {
  value: string;
  kind: 'ip' | 'local' | 'internal' | 'platform';
  trusted: boolean;
}

/** A public hook request as the core hands it to a plugin once the hook carries a canonical origin.
 *  `origin` is absent on daemons older than that seam, so every reader validates its shape instead of
 *  trusting the type (see `readRequestOrigin` in `./origin.js`). */
export type ChatbotHookRequest = Omit<PluginHttpRequest, 'origin'> & { origin?: ChatbotClientOrigin };

/** The subset of a live host-relay event this plugin reads. Core sends its full event union; a plugin
 *  that serves an unauthenticated client keeps its OWN allowlist and never forwards an event verbatim
 *  (see `./queue.js`). Unknown types are ignored rather than interpreted. */
export interface ChatbotRelayEvent {
  type: string;
  delta?: string;
  sessionId?: string;
  messageId?: string;
}

/** The subscriber a relay caller attaches. Observational only: detaching it never aborts the turn. */
interface ChatbotRelayObserver {
  onEvent: (event: ChatbotRelayEvent) => void;
  signal?: AbortSignal;
}

/** `PlatformControlApi` narrowed to relay. The host resolves the acting account, its policy, its Project,
 *  the durable channel session and the lock; a plugin supplies only the source and the text. The returned
 *  promise is the terminal authority: a resolved `undefined` is a deliberate silence, never an empty
 *  answer, and a rejection is a failed turn. */
export type ChatbotRelay = (src: SessionSource, text: string, observer?: ChatbotRelayObserver) => Promise<string | undefined>;

export interface ChatbotRelayControl {
  relay: ChatbotRelay;
}

/** An account as the host reports it once the account KIND is part of the user contract. `type` is absent
 *  on older daemons, so a caller treats a missing value as "not a chatbot" (fail closed). */
export interface ChatbotAccountView extends Omit<PluginUserView, 'id'> {
  id: number;
  type?: 'human' | 'chatbot';
}

export interface ChatbotStores extends Omit<PluginHostStores, 'projects' | 'usersRead'>, ChatbotProjectStores {
  usersRead: Omit<PluginHostStores['usersRead'], 'list'> & { list(): ChatbotAccountView[] };
}

/** The host surface this plugin uses, narrowed to what it calls. Every member exists on a core whose
 *  `requiresCore` this manifest declares; the restatement is about TYPE availability, not capability. */
export type ChatbotContext = Omit<PluginContext, 'host' | 'registerHttpRoute' | 'registerPlatform'> & {
  host: Omit<PluginContext['host'], 'stores'> & { stores(): ChatbotStores };
  registerHttpRoute(route: {
    path: string;
    handler(req: ChatbotHookRequest): Promise<{ status?: number; headers?: Record<string, string>; body?: object }>;
  }): void;
  registerPlatform(adapter: {
    name: string;
    connect(): Promise<void>;
    disconnect?(): void;
    listen(onMessage: ChatbotIngressHandler): void;
    send(channelId: string, text: string): Promise<void>;
    control?(api: ChatbotRelayControl): void;
  }): void;
};

/** The handler the host wires through `listen`. A chatbot receives nothing from it: an inbound message
 *  that did not enter through the host relay control carries no host-relay provenance, and admitting one
 *  would give an anonymous website the ownership semantics of a scheduled, account-owned turn. It is kept
 *  only so adapter readiness can report that the host completed the adapter handshake. */
export type ChatbotIngressHandler = (
  src: SessionSource,
  text: string,
  onEvent?: (event: ChatbotRelayEvent) => void,
) => Promise<string | undefined>;

/** A Project row from the host's store, narrowed to the fields the chatbot preflight reads. Core's own
 *  `Project` type is not published on the plugin API, so the few fields this plugin depends on are named
 *  here; `executionKind` and `lifecycle` are what separate a usable managed Project from a host directory
 *  or one that is being deleted. */
export interface ChatbotProjectView {
  id: number;
  slug: string;
  path: string;
  executionKind?: 'host' | 'managed';
  lifecycle?: 'active' | 'deleting';
}

interface ChatbotProjectStores {
  projects: Omit<PluginHostStores['projects'], 'get' | 'list'> & {
    get(id: number): ChatbotProjectView | null;
    list(): ChatbotProjectView[];
  };
  userProjects: PluginHostStores['userProjects'];
}

export const asChatbotContext = (ctx: PluginContext): ChatbotContext => ctx as unknown as ChatbotContext;
