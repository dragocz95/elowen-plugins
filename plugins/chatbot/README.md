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
```

The plugin then starts a real Elowen turn through the host relay, owned by the chatbot account. The visitor's only authority is the token the server issued: the id it carries is generated server-side, signed, bound to one chatbot and checked against a live database row on every request. Two chatbots never share a session, and neither do two visitors.

The answer reaches the page on the turn's own event stream. Every event is written to the plugin's own `p_chatbot_turn_events` table before any connected widget is told about it, so the stream is a reader of the durable log rather than a channel of its own: a browser that closes mid-answer stops watching, never stops the turn, and a reconnecting widget reads the frames it missed (and the answer of every finished turn) out of the plugin's tables. An idle stream sends an unlogged `ping` frame every 15 seconds so a proxy does not close a connection that is waiting on the model.

A frame is `{"schemaVersion":1,"turnId":"…","seq":3,"type":"text_delta","data":{"text":"Dobrý"}}`. Only `accepted`, `text_delta`, `done` and `error` ever reach a page: core reasoning, tool activity, tool arguments and internal error text do not cross that boundary. The stream ends when the turn writes its terminal event.

The embeddable widget and its `widget.js` asset are not part of this release; the plugin currently exposes the token, the message path, the response stream and the administration.

## Settings

`visitorTokenTtlDays` (Settings → Plugins → chatbot) is the lifetime of an issued visitor token. Everything else is per chatbot, on the **Chatbots** page: its display name, its instructions, the domains it may answer on, and whether it is enabled.

## Operations

- An enabled chatbot needs at least one allowed domain, exactly one active managed Project and a `chatbot` account that is not an administrator. The plugin re-checks all three before every admitted message and refuses with `bot_unavailable` rather than running a turn it cannot own.
- Requests are admitted only from a trusted network origin (`security.trustProxy` must match the deployment) and only when the browser's `Origin` header matches an allowed domain exactly. A body that is not declared `application/json` is refused with `unsupported_media_type` rather than interpreted.
- Every visitor turn denies all ten memory tools and sets no admin flag: one account serves every visitor, so nothing the agent remembers may reach a prompt it was not written for.
- A turn interrupted by a daemon restart is closed as `server_restarted`, in the turn row and in its event log, and is never replayed: one submitted message must not become two model turns.
- A daemon older than the stream seam (`acceptsStreamBody` absent) is refused with `stream_unavailable` instead of being handed a stream it would serialise into one JSON object.
- Deleting a chatbot account removes its registration, tokens, visitors and turn history with it.
