# chatbot

Visitor chatbots for third-party websites: one Elowen account per chatbot, one widget per customer site.

## Install

Install **chatbot** from **Settings → Plugins → Available**, then open **Chatbots** in the navigation.

| Field | Value |
| --- | --- |
| Version | 0.1.0 |
| requiresCore | 0.28.50 |
| requiresSharedApi | none |

## How it works

Each chatbot is a non-interactive Elowen account of kind `chatbot`, bound to exactly one active managed Project, so its conversations, history, usage and tool rights belong to that account and run inside that container. A visitor's browser talks to the public hook:

```
POST /hooks/chatbot/v1/visitors        issue a server-signed visitor token for an allowed domain
POST /hooks/chatbot/v1/visitors/refresh rotate a live token for the same visitor
POST /hooks/chatbot/v1/turns           submit one message, answered with a receipt (202)
GET  /hooks/chatbot/v1/conversation    this visitor's recent turns and their answers
GET  /hooks/chatbot/v1/turns/:id/events  one turn's public event log as NDJSON
GET  /hooks/chatbot/v1/widget.js       the embeddable widget a customer pastes into their site
```

The plugin then starts a real Elowen turn through the host relay, owned by the chatbot account. The visitor's only authority is the token the server issued: the id it carries is generated server-side, signed, bound to one chatbot and checked against a live database row on every request. Two chatbots never share a session, and neither do two visitors.

The answer reaches the page on the turn's own event stream. Every event is written to the plugin's own `p_chatbot_turn_events` table before any connected widget is told about it, so the stream is a reader of the durable log rather than a channel of its own: a browser that closes mid-answer stops watching, never stops the turn, and a reconnecting widget reads the frames it missed (and the answer of every finished turn) out of the plugin's tables. An idle stream sends an unlogged `ping` frame every 15 seconds so a proxy does not close a connection that is waiting on the model.

A frame is `{"schemaVersion":1,"turnId":"…","seq":3,"type":"text_delta","data":{"text":"Dobrý"}}`. Only `accepted`, `text_delta`, `done`, `action` and `error` ever reach a page: core reasoning, tool activity, tool arguments and internal error text do not cross that boundary. The stream ends when the turn writes its terminal event.

## The widget

The customer pastes one tag into their site's `<head>`:

```html
<script async src="https://elowen.example/hooks/chatbot/v1/widget.js" data-chatbot="cbt_…"></script>
```

Everything it needs is on that tag: the chatbot's public id, which is an identifier rather than a secret, and its own `src`, which is where its conversation lives. The script appends ONE element to the page and keeps its whole UI in that element's shadow root, so the customer's stylesheet cannot break the panel and the panel's styles cannot leak into their page. Including the tag twice is safe, and the only global it leaves behind is `window.ElowenChatbot` (`open()`, `close()`, `destroy()`, `version`) for a site that wants its own button.

`deep-chat` renders the messages; it is configured with a handler rather than a service, so it never talks to a model provider of its own. The in-page half is `@page-agent/page-controller` — the deterministic part of `page-agent`, which dispatches the same event sequence a browser dispatches for a person. Neither library's model-driven half is imported anywhere, so no model client, provider key or model endpoint exists in the served bundle.

**The visitor's conversation.** The first thing the widget sends is a message, and the message carries a bounded description of the page: its origin and path (never the query string), its title, its headings, its forms, and the interactive elements with what each may be asked to do. The description is taken in the submit handler and at no other time — nothing is watched between messages, and a page the visitor never writes to is never described. Passwords, file inputs and card-like fields are described by their label, type and validity and never by their value, and the agent may not write into them either; nothing inside an iframe is read; the whole description has a byte ceiling and an element ceiling, and it says `truncated` rather than growing past them. Values travel inside the message under a label that marks them as data from an unauthenticated page rather than as instructions.

**Acting on the page.** An allowed origin permits every supported action the recorded page itself exposes: `read`, `focus`, `click`, `fill`, `select` and `scroll`. Form submission is the only extra decision and can be disabled per chatbot. The model reaches the page through `ChatbotPageAction`, which takes a `snapshotId`, an `action`, a `targetId` and, where the kind carries one, a `value`. A target id is meaningful only inside the snapshot that issued it, a click on a submit-capable element is refused outright, and submitting a form is its own `request_submit` kind. Every action still counts against `maxActionsPerTurn`. The tool refuses to run outside a live chatbot visitor turn, and what it is told back is what the plugin recorded — the value a `read` found, the page's own refusal, or the fact that it expired.

A `request_submit` shows the visitor what is about to be sent, and only a click THEY make can confirm it: the confirm listener ignores any event the browser did not mark as trusted. The confirmation is recorded on the server before the form is sent — a confirmation the deployment could not store is one it never gave, so nothing is submitted — and the nonce that came with the action is consumed by that one confirmation. A late confirmation, or a second one, is refused.

The widget reports every action's outcome (and every refusal) to `POST /hooks/chatbot/v1/turns/:id/actions/:id/result` and the visitor's answer to `POST …/actions/:id/confirmation`. Both are part of the v1 contract and both are served: the turn's own log carries the action as an `action` frame, so a widget that reconnects reads the pending action again and answers it. A report is answered by the action's own row, and only while that row is live: an action that expired takes no further report, and a confirmation is good for one submission.

**The tool needs a grant.** This plugin is `userGrantable`, so its tools reach only a non-admin account that holds a `granted_plugins` entry for `chatbot`. A chatbot whose account has no such grant still answers visitors, but the model never sees `ChatbotPageAction` and therefore cannot touch the page. Granting it is an administrator's action on the account, in the same place every other plugin grant is handed out; the core owns that decision (`usersRead.mayUsePlugin`), and the plugin does not grant itself anything.

**Streaming and reconnect.** The answer is rendered as it arrives, and a lost connection is resumed with the cursor the protocol already carries: the widget reconnects with the last sequence number it rendered, so a dropped connection never doubles a sentence. The panel says it is reconnecting in its own status line rather than in the transcript, which holds what the visitor said and what the chatbot answered — nothing else. A reload restores the conversation from the visitor's own projection, with the page state stripped back out.

**Caching.** `widget.js` is answered with a strong `ETag` and `Cache-Control: public, max-age=300, must-revalidate`. The URL a customer pasted carries no build hash and cannot be changed for them, so the window is short: an unchanged bundle costs one `304`, and a fixed one reaches every visitor within five minutes.

## Assets

`plugins/chatbot/embed/widget.v1.js` is built from `plugins/chatbot/embed-src/` and COMMITTED, like every other browser artifact in this registry, because the marketplace copies a plugin verbatim and never compiles anything.

```bash
npm run build:chatbot-assets   # embed-src → embed/widget.v1.js
npm run check:chatbot-assets   # rebuild and fail if the committed bundle drifted
npm run test:e2e:chatbot       # the widget in a real browser, on a page you can open
```

## Settings

`visitorTokenTtlDays` (Settings → Plugins → chatbot) is the lifetime of an issued visitor token. Everything else is per chatbot, on the **Chatbots** page: its identity, allowed domains, appearance, limits, whether it may submit forms, and whether it is enabled. Behaviour and knowledge come only from the Project's `AGENTS.md`.

## The administrator's page

The **Chatbots** page has three tabs over one selection, so switching tabs keeps the chatbot you were looking at.

- **Chatbots** — the register and one chatbot's configuration: identity facts read live from the account, allowed domains, appearance and embed snippet, limits, whether it may submit forms, and the sensitive-data status. Enable and disable are explicit, confirmed actions.
- **Conversations** — one page of this chatbot's conversations, and one conversation's own words and answers. A conversation is a `(chatbot, visitor)` pair, so no chatbot's history can appear under another's heading, and the transcript holds what the plugin published to the widget: the model's tool calls and its reasoning are core transcript and are not read by this route at all.
- **Statistics** — the plugin's own admission counters per UTC day (with queue waits), and the account's spend.

**What the numbers are.** The chart and the totals are the plugin's own counters, read from its own rows. The spend figures are read from the instance's `usage_by_origin` rollup through the core admin route, for the chatbot's own account and the same window — that rollup is the only source of origin-attributed spend in this codebase, and neither this page nor the plugin's API ever counts tokens or cost by scanning messages. The rollup begins on the day tracking started, which the page states. The two counters are separate and are not presented as checks on each other.

**Grants are not edited here.** A chatbot's account reaches this plugin's tool only while the account holds the `chatbot` grant, so the dialog that creates a chatbot writes that grant (and the tool grant) alongside core's own account and Project assignment, keeping whatever else the account already had. After that, account grants are edited on the **Users** screen, which owns that rule: this page reports what the account can reach and hands you over rather than keeping a second copy of a permission rule.

**Limits.** A newly registered chatbot receives the complete default profile from `src/limits.ts`, so missing numbers do not make it a draft. The main form shows turns per day, the daily spend ceiling and retention first; rate, token, queue, concurrency and page-action limits remain available under Advanced.

## Operations

- An enabled chatbot needs at least one allowed domain, exactly one active managed Project and a `chatbot` account that is not an administrator. The plugin re-checks all three before every admitted message and refuses with `bot_unavailable` rather than running a turn it cannot own.
- Requests are admitted only from a trusted network origin (`security.trustProxy` must match the deployment) and only when the browser's `Origin` header matches an allowed domain exactly. A body that is not declared `application/json` is refused with `unsupported_media_type` rather than interpreted.
- Every visitor turn denies all ten memory tools and sets no admin flag: one account serves every visitor, so nothing the agent remembers may reach a prompt it was not written for.
- A turn interrupted by a daemon restart is closed as `server_restarted`, in the turn row and in its event log, and is never replayed: one submitted message must not become two model turns.
- A daemon older than the stream seam (`acceptsStreamBody` absent) is refused with `stream_unavailable` instead of being handed a stream it would serialise into one JSON object.
- Deleting a chatbot account removes its registration, tokens, visitors and turn history with it.
- The widget script is served BEFORE the origin gate, deliberately: a classic `<script src>` from a customer's page carries no `Origin` header and no visitor token, and the asset is public by design. Every request that asks for state still passes both gates.
