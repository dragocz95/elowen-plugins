import { MEMORY_TOOL_NAMES } from './coreSeams.js';
/** The one platform name this plugin registers, relays under and is billed as. Core attributes a relayed
 *  turn's spend to `platform:<name>` in `usage_by_origin`, so the name is not only an identity here: it is
 *  the key the budget is read back under, and a second spelling of it would be a budget that never counts. */
export const CHATBOT_PLATFORM = 'chatbot';
/** A visitor's conversation, as core keys a channel session: `platform-channelId`. The plugin's channel id
 *  carries BOTH identities, so two chatbots never share a session even when a visitor id repeats, and the
 *  resulting session id is `brain-ch-chatbot-<chatbotUserId>:<visitorId>`. */
export function conversationChannelId(chatbotUserId, visitorId) {
    return `${chatbotUserId}:${visitorId}`;
}
/** The source of a visitor turn. `access.actAsUserId` names the chatbot ACCOUNT; it is effective only
 *  because this source enters through the host relay control, which is what stamps host-relay provenance.
 *  The same object handed to an ordinary message listener would be a sender claim and would not own the
 *  transcript (core enforces that, and this plugin never relies on the difference). */
export function visitorSource(input) {
    return {
        platform: CHATBOT_PLATFORM,
        // The visitor is the sender and is anonymous: no name, no e-mail and no identity the CLIENT supplied.
        // The random id is only a platform-side handle; authority is the signed token checked before this.
        userId: input.visitorId,
        roleIds: [],
        channelId: conversationChannelId(input.chatbotUserId, input.visitorId),
        // Adapter-fetched metadata, injected into the channel session's system prompt at spawn time. It is the
        // bot's own configured name, never text a visitor typed.
        channelName: input.displayName || undefined,
        access: {
            // Authority comes from the chatbot ACCOUNT the host relay stamps into the turn, never from the
            // anonymous sender: an administrator flag here would widen a website's reach for free.
            admin: false,
            actAsUserId: input.chatbotUserId,
            // Every visitor writes into the SAME account, so an agent that remembers one visitor's details can
            // put them in the next visitor's prompt. Core already turns automatic memory off for a chatbot
            // account; this denies the tools themselves for the whole turn.
            denyTools: [...MEMORY_TOOL_NAMES],
        },
    };
}
/** The chatbot platform adapter. It owns no transport: a visitor's message arrives on the public hook and
 *  the answer leaves through the plugin's own event log, so this adapter exists to be the host's registered
 *  platform (identity, session, ownership) and to hold the relay control the queue calls. */
export class ChatbotAdapter {
    warn;
    name = CHATBOT_PLATFORM;
    ingress = null;
    relayFn = null;
    accepting = false;
    constructor(warn = () => { }) {
        this.warn = warn;
    }
    /** The host's inbound handler. Stored only so readiness can prove the host completed the adapter
     *  handshake; nothing in this plugin ever calls it, deliberately — an ingress that did not enter through
     *  the relay control carries no host-relay provenance and must not receive account-owned semantics. */
    listen(onMessage) {
        this.ingress = onMessage;
    }
    control(api) {
        this.relayFn = api.relay.bind(api);
    }
    /** Ready only once BOTH halves arrived. Called by the host at startup; a failure here is reported as
     *  "not ready", which fails every public request closed rather than half-serving them. */
    async connect() {
        this.accepting = this.ingress !== null && this.relayFn !== null;
        if (!this.accepting) {
            // No throw: an unwired adapter is a state the public hook reports as unavailable, and a throw here
            // would only replace that answer with a log line no visitor sees.
            this.warn('chatbot adapter is not ready: the host did not wire both listen and the relay control');
        }
    }
    /** Stop admitting new work. In-flight relay calls are NOT aborted: a turn the host already owns must be
     *  allowed to finish and persist its answer, exactly as a browser disconnect does not cancel one. */
    disconnect() {
        this.accepting = false;
    }
    isReady() {
        return this.accepting && this.relayFn !== null;
    }
    /** The relay control, or null when the host has not wired it. Resolved at CALL time, never cached across
     *  registrations. */
    relay() {
        return this.accepting ? this.relayFn : null;
    }
    /** There is deliberately no outbound transport: an answer reaches the website through the relay event
     *  log, so a host that found no other way to deliver one is told rather than silently ignored. */
    send() {
        return Promise.reject(new Error('the chatbot platform has no outbound transport; answers are delivered through the relay event log'));
    }
}
/** Narrow a host relay event to the fields this plugin projects. Everything else — reasoning, tool
 *  arguments, tool output, internal error text — is dropped here, at the boundary, rather than filtered
 *  somewhere further along where a new event type could slip past. */
export function relayEventFields(event) {
    return {
        type: typeof event?.type === 'string' ? event.type : 'unknown',
        ...(typeof event?.delta === 'string' ? { delta: event.delta } : {}),
        ...(typeof event?.sessionId === 'string' ? { sessionId: event.sessionId } : {}),
        ...(typeof event?.messageId === 'string' ? { messageId: event.messageId } : {}),
    };
}
