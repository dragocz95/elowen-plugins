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
```

The plugin then starts a real Elowen turn through the host relay, owned by the chatbot account. The visitor's only authority is the token the server issued: the id it carries is generated server-side, signed, bound to one chatbot and checked against a live database row on every request. Two chatbots never share a session, and neither do two visitors.

The embeddable widget and its `widget.js` asset are not part of this release; the plugin currently exposes the token, the message path and the administration.

## Settings

`visitorTokenTtlDays` (Settings → Plugins → chatbot) is the lifetime of an issued visitor token. Everything else is per chatbot, on the **Chatbots** page: its display name, its instructions, the domains it may answer on, and whether it is enabled.

## Operations

- An enabled chatbot needs at least one allowed domain, exactly one active managed Project and a `chatbot` account that is not an administrator. The plugin re-checks all three before every admitted message and refuses with `bot_unavailable` rather than running a turn it cannot own.
- Requests are admitted only from a trusted network origin (`security.trustProxy` must match the deployment) and only when the browser's `Origin` header matches an allowed domain exactly.
- A turn interrupted by a daemon restart is reported to the visitor as `server_restarted`; the core turn is not resumed.
- Deleting a chatbot account removes its registration, tokens, visitors and turn history with it.
