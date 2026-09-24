---
title: Chatbot Plugin
slug: chatbot-plugin
order: 42
eyebrow: Plugin reference
group: Plugin reference
---

# Chatbot Plugin

The chatbot plugin puts an Elowen chatbot on a third-party website. Each chatbot is a non-interactive Elowen account bound to exactly one managed Project, and visitors reach it through a widget on the customer's own site. The plugin never calls a model itself: every admitted visitor message starts a real Elowen turn owned by the chatbot account.

Current version: **0.3.11**. Requires Elowen 0.28.54 or later.

Only an administrator can install, configure and manage chatbots. Install the plugin from **Settings → Plugins → Available**, then open **Chatbots** in the main navigation.

## Create a chatbot

On the **Chatbots** page, create a chatbot from a new or an existing account. The account is created as a non-interactive chatbot account: it cannot sign in and cannot be an administrator. Bind it to exactly one active managed Project; the chatbot works inside that Project and owns the transcript. Behaviour and knowledge come only from that Project's `AGENTS.md`.

A chatbot answers nobody until three things hold: at least one allowed domain, exactly one active managed Project, and a non-administrator chatbot account. The plugin re-checks all three before every admitted message.

## Allowed domains and the embed snippet

Every request must match an allowed origin. Enter each domain as scheme and host without a path, for example `https://www.example.cz`. With no domain listed, the chatbot answers nobody. Once the chatbot is enabled, only secure origins are allowed.

The page shows an embed snippet for the customer's website. The public ID in the snippet identifies the chatbot and is not a secret.

## Limits

Every chatbot starts from a safe default profile; the main form shows the three main ceilings first and the rest under Advanced.

| Limit | Default | What it does |
| --- | --- | --- |
| Turns per day | 500 | Turns admitted per UTC day. |
| Daily spend ceiling | $10 | USD per UTC day. |
| Conversation retention | 30 days | Days before a conversation is deleted. |
| Requests from one address per minute | 75 | Rate bound per IP address. |
| Requests to this chatbot per minute | 150 | Rate bound across all visitors. |
| Requests in one conversation per minute | 25 | Rate bound per visitor conversation. |
| Turns running at once | 5 | Turns that may run at the same time. |
| Turns waiting in the queue | 10 | Turns that may wait for a free slot. |
| Wait for a free slot | 150 s | Seconds a turn may wait for a free slot. |
| Page actions per turn | 20 | Page actions allowed in one turn. |

A newly registered chatbot receives the complete default profile, so missing numbers do not make it a draft. A visitor token is the only authority an anonymous visitor has; when it expires, the widget asks for a new one and the conversation continues. The token lifetime is set in plugin settings as **Visitor token lifetime (days)**, 1 to 365 days, default 30.

## The visitor's page

An allowed origin permits the page actions the recorded page itself exposes: describing the page, navigating between allowed pages, and reading, focusing, clicking, filling, selecting and scrolling. Form submission is the only extra decision and can be switched off per chatbot with **May submit forms**; only form submission is blocked by that switch, and the visitor still confirms every submission.

The model reaches the page through the `ChatbotPageAction` tool, which works only inside a running chatbot visitor turn. Every visitor turn denies all ten memory tools: one account serves every visitor, so nothing the agent remembers may reach a prompt it was not written for.

The `ChatbotOffer` tool attaches a short option set or one next step to a text answer. Choices send a reply; links and cards point only to this chatbot's allowed pages.

## Appearance

The page offers an appearance editor: panel title, greeting, avatar, quick buttons, colours, light or dark mode, size, position on the page, effects and sounds. Named templates are available; applying one replaces all appearance settings, keeping only the chatbot name.

## Conversations, feedback and statistics

- **Conversations** shows one chatbot's conversations, one conversation at a time. A conversation appears once a visitor's first message has been admitted. The register can be narrowed to one visitor; visitors are offered by their last IP address and visitor id. Each conversation keeps the visitor's last IP address, which is personal data: it is deleted with the conversation by retention, by an operator's erase, or with the chatbot account.
- **Feedback** shows how visitors rated finished answers: helpful or unhelpful, with an optional comment.
- **Statistics** shows the plugin's own admission counters per UTC day with queue waits, plus the chatbot account's spend over the same window.

Conversations can be erased in bulk; conversations still being answered are kept. Deleting a chatbot account removes its registration, tokens, visitors and turn history with it.

## Tools and grants

The plugin's tools reach only a non-administrator account that holds the `chatbot` grant. A chatbot whose account has no such grant still answers visitors, but the model never sees `ChatbotPageAction` and cannot touch the page. Grants are handed out per account on the **Users** screen, which also owns later edits; the Chatbots page reports what the account can reach.

The model is not edited on the Chatbots page either. The chatbot's answer comes from its own account, so the detail row states the model resolved for that account and which rule decided it: the account's own stored pick, the instance default, or a model the account's allow-list forced. Change it on that account.

## Sensitive data

Identity numbers and addresses are not handled yet. Where such data would be processed and how long it would be kept has not been decided, so the chatbot refuses that mode instead of storing a setting it cannot honour.

## Enable and disable

Enable and disable are explicit, confirmed actions. Enabling admits visitors from the allowed domains, and every message spends the chatbot's own account. Disabling stops admitting visitors immediately; recorded conversations stay in the transcript.
