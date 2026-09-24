---
title: WhatsApp Plugin
slug: whatsapp-plugin
order: 64
eyebrow: Plugin reference
group: Plugin reference
---

# WhatsApp Plugin

The WhatsApp plugin connects Elowen to WhatsApp. Install it in **Settings → Plugins → Available**. The plugin's detail view contains its settings, including the pairing panel. Installing, enabling or disabling the plugin takes effect after Elowen restarts; some settings apply live. For day-to-day commands and channel behavior, see [WhatsApp](channels-whatsapp). Shared concepts for all chat platforms are on the [Chat Platform Plugins](chat-platform-plugins) overview.

Current version: **0.2.25**. Requires Elowen 0.28.53 or later, shared API version 5.

Only an administrator can install, enable or configure this plugin. WhatsApp uses the linked device's saved session. Plugin tools are available only while WhatsApp is paired.

## Pair and connect

Install and enable the WhatsApp plugin, then open its **Pairing** panel and select **Pair device**. Scan the QR code with WhatsApp → **Linked devices** → **Link a device**. The QR code is also available in the plugin logs. To pair by phone number instead, set the bot's number in international format without a plus sign; enter the displayed code using **Link with phone number**. Set at least one sender policy. Commands include `/model`, `/new` and `/help`.

The plugin keeps the paired session across reconnects. Select **Unpair device** in the Pairing panel to log out and remove it. Buttons may not work reliably in personal-account chats, so interactive prompts also accept a numbered text reply.

A sender policy decides who the bot answers and can provide extra instructions for a shared room. Configure at least one policy. The first matching policy applies; put a catch-all `*` rule last so it does not shadow specific senders. A sender who matches no policy is ignored. A policy does not replace identity: the sender also needs a linked Elowen account, whose project access and tool permissions apply to the turn.

Each chat has its own conversation and can have its own model and display settings. Use `/new` to start a fresh conversation there. Images are sent to the configured vision model.

Set a notification chat to receive proactive messages such as scheduled results. Leave it empty to turn those messages off.

## Connection and access

| Setting | What it does |
| --- | --- |
| Pairing phone number | Optional bot number in international format, without `+`, spaces or dashes. When set, pairing uses an 8-character code instead of a QR code. |
| Allowed groups | Optional group JIDs; empty allows groups where a mapped sender writes. Direct chats remain allowed. |
| Notification chat | Phone number or JID for proactive messages; empty disables them. |
| Sender policies | Map a phone number, personal JID or whole group JID to access and room instructions. A group ID admits everyone in that group. Put `*` last if used. |

The field keys, in table order, are `phoneNumber`, `groupIds`, `notifyChat` and `senderPolicies`.

## Replies and media

| Setting | Default | What it does |
| --- | --- | --- |
| Respond without mention | On | Answer every message from a mapped sender in groups; turn off to require a mention or reply. Direct chats are always answered. |
| Live progress trace | On | Edit a progress message while the agent works; the answer itself is sent once at the end. |
| Replace tool activity with answer | Off | Replace the progress message with the final answer. |
| Processing reactions | On | Show processing status as reactions on the incoming message. |
| Runtime footer | On | Add the model and context usage below the reply. |
| Show reasoning | Off | Show extended-thinking output when the model supports it. |
| Service language | English | Language of service messages: English, Czech or Slovak. |
| Vision model | Not set | Model for image messages; empty uses the chat's usual model. |
| Max inbound image size | 5 MiB | Download limit from 1 to 20 MiB; larger images are noted. |
| Max images per message | 4 | Number of images sent for recognition, from 1 to 10. |
| Max images per reply | 4 | Images shared through `ShareImage` attached to one reply, from 1 to 10. |
| Question timeout | 6 minutes | How long a question or interactive menu stays open, from 30 seconds to 30 minutes. |

The keys in table order are `respondWithoutMention`, `streaming`, `deleteToolActivityAfterTurn`, `reactions`, `runtimeFooter`, `showReasoning`, `language`, `visionModel`, `maxImageBytes`, `maxImages`, `maxUploadImages` and `askTimeoutMs`.

## Tools and permissions

The paired account must be a group administrator to add or remove members. `WhatsappGroupList` returns group JIDs for other group tools; `WhatsappGroupInfo` shows the group's participants and administrators. The six tools are `WhatsappGroupList`, `WhatsappGroupInfo`, `WhatsappSend`, `WhatsappGroupCreate`, `WhatsappGroupAdd` and `WhatsappGroupRemove`; there is no raw API tool. Messages sent by `WhatsappSend` cannot be recalled. Removing a member is announced to the group. Numbers not registered with WhatsApp may be skipped when creating a group. Newsletters and broadcast lists are not supported. Long replies are split into messages of up to 4,000 characters.

[Next: Microsoft Teams & Microsoft 365](microsoft-365-plugin)
