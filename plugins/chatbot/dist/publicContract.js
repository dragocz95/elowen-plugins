/** The v1 public contract: every value the widget, the public hook and the page-action policy have to
 *  agree on lives here and nowhere else.
 *
 *  This module is DELIBERATELY dependency-free. The embeddable widget is bundled straight from it into a
 *  browser artifact that runs on a third party's website, so it may never reach for a Node built-in, a
 *  host module or anything else the browser cannot resolve. That is what makes one home possible: the
 *  same bytes of truth are compiled into the daemon-side public route and into the customer's page.
 *
 *  `v1` is the protocol AND the asset version. A compatible change may replace the served asset; a
 *  breaking one gets a new mount (`v2`) rather than runtime detection of two shapes inside one handler. */
/** The one mount this plugin declares. Every public path below is a remainder under it. */
export const PUBLIC_MOUNT = 'v1';
/** Carried by every public request and response body, and by every streamed frame. A caller naming
 *  another version is refused, never reinterpreted. */
export const PUBLIC_SCHEMA_VERSION = 1;
/** The widget script a customer pastes into their site, relative to the mount. */
export const WIDGET_ASSET_NAME = 'widget.js';
/** The protocol version the served widget bundle speaks, and the version in its own file name. A widget
 *  built for `v1` refuses a `v2` mount's frames rather than reading them as `v1`: two versions who disagree
 *  about a frame are two different products, and neither should guess at the other. */
export const WIDGET_PROTOCOL_VERSION = 1;
/** The largest visitor message the hook accepts, in UTF-8 bytes. It bounds the visitor's own text AND the
 *  page state composed into the same message, because the composed text is what the hook receives. */
export const MESSAGE_MAX_BYTES = 8 * 1024;
/** What the visitor's own text may take of a message. The rest is the page state's budget below. */
export const VISITOR_TEXT_MAX_BYTES = 2 * 1024;
/** Ceiling on the page-state block the widget composes into a message. This is the byte bound on page
 *  awareness: the plugin holds no snapshot ceiling of its own that a page could reach past this, because
 *  a snapshot that does not fit a message is never sent anywhere. */
export const PAGE_STATE_MAX_BYTES = MESSAGE_MAX_BYTES - VISITOR_TEXT_MAX_BYTES - 256;
/** How many interactive elements a snapshot may describe, in DOM order. Past it the snapshot is marked
 *  truncated rather than grown. */
export const PAGE_SNAPSHOT_MAX_ELEMENTS = 500;
/** How many characters of one field's own value may travel. A long textarea is described by its first
 *  characters and the fact that it was cut. */
export const PAGE_FIELD_VALUE_MAX_CHARS = 200;
/** How many headings a snapshot carries. */
export const PAGE_SNAPSHOT_MAX_HEADINGS = 20;
/** How long one short piece of page text may be: a heading, a field's label, a form's name, the page title.
 *  One bound for all of them, because they are the same kind of value and a second number would only be a
 *  second thing to keep in step. */
export const PAGE_TEXT_MAX_CHARS = 120;
/** The two labels of the composed model input. The visitor's own words come first and the page state is
 *  labelled for what it is: data from a page nobody has authenticated, never an instruction. */
export const VISITOR_MESSAGE_LABEL = 'Visitor message:';
export const PAGE_STATE_LABEL = 'Untrusted page state:';
/** Every frame type a turn's public stream may carry. `ping` is never stored and only says the stream is
 *  alive; `action` is the server asking the page to do something it has already approved. A client that
 *  meets a type it does not know ignores it rather than guessing. */
export const PUBLIC_FRAME_TYPES = ['accepted', 'text_delta', 'done', 'error', 'action', 'ping'];
/** What a visitor's widget may be asked to do inside the page. The allowlist lives on the SERVER: a frame
 *  naming anything else is a fact about a broken or hostile sender and is refused, never executed. */
export const ACTION_KINDS = ['read', 'focus', 'click', 'fill', 'select', 'scroll', 'request_submit'];
/** Submitting a form is its OWN kind, never a click. An irreversible step is not something a page may be
 *  talked into by a target that merely happens to be a submit button. */
export const CONFIRMATION_ACTION_KIND = 'request_submit';
/** How many actions one widget will perform for a single turn.
 *
 *  This is NOT a budget. A chatbot's own per-turn ceiling (its own setting, enforced server-side) is the
 *  budget, and the server simply stops approving actions when it is reached. This number is the client's
 *  own refusal: a page that has been driven twenty times in one turn is a page something has gone wrong
 *  with, and a widget that keeps going because a frame asked it to is not one a customer should install. */
export const WIDGET_MAX_ACTIONS_PER_TURN = 20;
/** Element ids and snapshot ids issued by the widget. Both are opaque handles: a server that receives
 *  anything else refuses it, and no CSS selector, XPath or script ever crosses this boundary. */
export const TARGET_ID_PATTERN = /^e\d{1,3}$/;
export const SNAPSHOT_ID_PATTERN = /^s[0-9a-f]{16}$/;
/** The `Authorization` scheme a visitor token is presented with. Its own scheme, so this credential can
 *  never be mistaken for a bearer token of another surface. */
export const VISITOR_AUTHORIZATION_SCHEME = 'ChatbotVisitor';
/** The query parameter a stream resumes from: the last sequence number a widget already rendered. */
export const EVENTS_AFTER_QUERY = 'after';
/** The path segments the public surface is built from. Named once so the widget cannot spell a URL
 *  differently from the handler that answers it, and so a route is renamed in one place or not at all. */
export const PUBLIC_SEGMENTS = {
    visitors: 'visitors',
    refresh: 'refresh',
    turns: 'turns',
    events: 'events',
    actions: 'actions',
    result: 'result',
    confirmation: 'confirmation',
    conversation: 'conversation',
    widget: WIDGET_ASSET_NAME,
};
/** The public paths, relative to the mount. */
export const PUBLIC_PATHS = {
    visitors: PUBLIC_SEGMENTS.visitors,
    refresh: `${PUBLIC_SEGMENTS.visitors}/${PUBLIC_SEGMENTS.refresh}`,
    turns: PUBLIC_SEGMENTS.turns,
    conversation: PUBLIC_SEGMENTS.conversation,
    events: (turnId) => `${PUBLIC_SEGMENTS.turns}/${turnId}/${PUBLIC_SEGMENTS.events}`,
    actionResult: (turnId, actionId) => `${PUBLIC_SEGMENTS.turns}/${turnId}/${PUBLIC_SEGMENTS.actions}/${actionId}/${PUBLIC_SEGMENTS.result}`,
    actionDecision: (turnId, actionId) => `${PUBLIC_SEGMENTS.turns}/${turnId}/${PUBLIC_SEGMENTS.actions}/${actionId}/${PUBLIC_SEGMENTS.confirmation}`,
    widget: PUBLIC_SEGMENTS.widget,
};
/** The outcomes a widget reports for a performed action. */
export const ACTION_OUTCOMES = ['done', 'error', 'denied'];
/** The visitor's answer to a confirmation the server required. `confirm` is only ever sent from a real
 *  click: a widget that could be talked into confirming has no confirmation at all. */
export const ACTION_DECISIONS = ['confirm', 'decline'];
/** Whether an action kind is only ever performed after the visitor themselves confirmed it. */
export function requiresVisitorConfirmation(kind) {
    return kind === CONFIRMATION_ACTION_KIND;
}
