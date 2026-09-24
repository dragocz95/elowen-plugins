---
title: Chat Platform Plugins
slug: chat-platform-plugins
order: 37
eyebrow: Plugin reference
group: Plugin reference
---

# Chat Platform Plugins

Discord, Telegram and WhatsApp plugins connect Elowen to those chat platforms. Install them in **Settings → Plugins → Available**. The plugin's detail view contains its settings. Installing, enabling or disabling a plugin takes effect after Elowen restarts; some settings and per-chat overrides apply live. For day-to-day commands and channel behavior, see [Discord](channels-discord), [Telegram](channels-telegram) or [WhatsApp](channels-whatsapp). Microsoft Teams is covered in [Microsoft Teams & Microsoft 365](microsoft-365-plugin).

The current plugin versions require Elowen 0.28.53 or later. Each uses shared API version 5.

Only an administrator can install, enable or configure these plugins. Discord and Telegram bot tokens are stored as secrets; their settings show whether a token is set, not its value. WhatsApp uses the linked device's saved session. Plugin tools are available only while the corresponding bot is connected or WhatsApp is paired.

## How platform access works

A role policy on Discord or Telegram, or a sender policy on WhatsApp, decides who the bot answers and can provide extra instructions for a shared room. Configure at least one policy. The first matching policy applies; put a catch-all `*` rule last so it does not shadow specific senders. A sender who matches no policy is ignored. A policy does not replace identity: the sender also needs a linked Elowen account, whose project access and tool permissions apply to the turn.

Each chat or channel has its own conversation and can have its own model and display settings. Use `/new` to start a fresh conversation there. `/context` can bring one of your own conversations into a platform chat. Images are sent to the configured vision model; other attachments are subject to the plugin's media limits. The adapters can show tool progress and status reactions, depending on the platform and its settings.

Set a notification destination to receive proactive messages such as scheduled results. Leave it empty to turn those messages off.

## Plugin pages

- [Discord](discord-plugin): bot setup, connection and access settings, replies and display, conversation and media limits, voice, and the 25 server tools.
- [Telegram](telegram-plugin): bot setup, connection and access settings, replies and media, voice, and the 16 chat tools.
- [WhatsApp](whatsapp-plugin): device pairing, sender policies, replies and media, and the six group tools.

## Message and attachment limits

The platform adapters split long replies into messages of up to 1,990 characters on Discord, 4,000 on Telegram and 4,000 on WhatsApp. Telegram photo captions are limited to 1,024 characters. Each platform allows up to four shared files per reply. Spoken replies use up to 4,000 characters of text, and voice clips larger than 25 MiB are not transcribed.

Telegram and WhatsApp questions stay open for six minutes by default; change this with **Question timeout**. A platform may also reject an action when the bot or paired account lacks permission. Discord ignores direct messages and group DMs. Telegram tools need the bot to be connected, and WhatsApp tools need a paired device.

[Next: Discord](discord-plugin)
