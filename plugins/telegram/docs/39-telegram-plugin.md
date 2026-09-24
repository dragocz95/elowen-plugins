---
title: Telegram Plugin
slug: telegram-plugin
order: 39
eyebrow: Plugin reference
group: Plugin reference
---

# Telegram Plugin

The Telegram plugin connects Elowen to Telegram. Install it in **Settings → Plugins → Available**. The plugin's detail view contains its settings. Installing, enabling or disabling the plugin takes effect after Elowen restarts; some settings and per-chat overrides apply live. For day-to-day commands and channel behavior, see [Telegram](channels-telegram). Shared concepts for all chat platforms are on the [Chat Platform Plugins](chat-platform-plugins) overview.

Current version: **0.2.21**. Requires Elowen 0.28.53 or later, shared API version 5.

Only an administrator can install, enable or configure this plugin. The bot token is stored as a secret; its setting shows whether a token is set, not its value. Plugin tools are available only while the bot is connected.

## Install and connect

Create a bot with @BotFather and copy its token. If it must receive every message in groups, turn off BotFather's **Group Privacy** setting. Install the Telegram plugin, enter the token, configure at least one role policy, and optionally set allowed chats and a notification chat. Enable the plugin to connect. It uses long polling, so no public webhook is needed. Its commands include `/model`, `/reasoning`, `/display`, `/new` and `/help`. On connection, it publishes a command menu; Telegram allows up to 100 commands, and entries whose names or descriptions exceed Telegram's limits are omitted.

A role policy decides who the bot answers and can provide extra instructions for a shared room. Configure at least one policy. The first matching policy applies; put a catch-all `*` rule last so it does not shadow specific senders. A sender who matches no policy is ignored. A policy does not replace identity: the sender also needs a linked Elowen account, whose project access and tool permissions apply to the turn.

Each chat has its own conversation and can have its own model and display settings. Use `/new` to start a fresh conversation there. `/context` can bring one of your own conversations into a platform chat. Images are sent to the configured vision model.

Set a notification chat to receive proactive messages such as scheduled results. Leave it empty to turn those messages off.

## Connection and access

| Setting | What it does |
| --- | --- |
| Bot token | Required secret from @BotFather. |
| Allowed chats | Optional numeric user or group chat IDs; empty adds no allowlist. |
| Notification chat ID | Numeric chat ID or `@channelusername` for proactive messages; empty disables them. |
| Role policies | Map a Telegram user ID, @username or whole chat ID to access and room instructions. A whole chat ID admits everyone in that chat. Put `*` last if used. |

The field keys, in table order, are `botToken`, `allowedChatIds`, `notifyChatId` and `rolePolicies`.

## Replies, media and voice

| Setting | Default | What it does |
| --- | --- | --- |
| Respond without mention | On | Answer every message from a mapped sender in groups; turn off to require a mention or reply. Direct chats are always answered. |
| Tool activity | Status | Choose Off, Status or Live progress. Set a chat override with `/display`. |
| Answer delivery | Final | Send one complete answer or edit it as it is written. |
| Tool output detail | Short summary | Choose hidden, summary or output tail; full raw output is not posted. |
| Tool message layout | One live message | Keep one message or use one message per tool call. |
| Replace tool activity with answer | Off | Replace the progress message with the final answer. |
| Processing reactions | On | Show status using supported reactions. |
| Runtime footer | On | Add the model and context usage below the reply. |
| Show reasoning | Off | Show extended-thinking output when the model supports it. |
| Service language | English | Language of service messages: English, Czech or Slovak. |
| Vision model | Not set | Model for image messages; empty uses the chat's usual model. |
| Max inbound image size | 5 MiB | Download limit from 1 to 20 MiB; larger images are noted. |
| Max images per message | 4 | Number of images sent for recognition, from 1 to 10. |
| Max images per reply | 4 | Images shared through `ShareImage` attached to one reply, from 1 to 10. |
| Question timeout | 6 minutes | How long an interactive question stays open; 30 seconds to 30 minutes in 30-second steps. |
| Voice provider | Not set | Configured OpenAI-compatible provider for transcription and speech. Empty disables voice features. |
| Transcribe voice messages | Off | Transcribe incoming voice messages and audio with Whisper. |
| Speech-to-text model | `whisper-1` | Model used for transcription. |
| Speak replies | Off | Attach spoken audio by default; change per chat with `/voice`. |
| Text-to-speech model | `gpt-4o-mini-tts` | Model used for speech. |
| TTS voice | `alloy` | Voice ID, such as `alloy`, `echo`, `fable`, `onyx`, `nova` or `shimmer`. |

The keys in table order are `respondWithoutMention`, `toolActivity`, `answerMode`, `toolOutput`, `toolMessageMode`, `deleteToolActivityAfterTurn`, `reactions`, `runtimeFooter`, `showReasoning`, `language`, `visionModel`, `maxImageBytes`, `maxImages`, `maxUploadImages`, `askTimeoutMs`, `voiceProvider`, `stt`, `sttModel`, `tts`, `ttsModel` and `ttsVoice`.

## Tools and permissions

The plugin provides 16 tools. The bot needs the relevant rights in a chat to pin or delete messages, manage members or change chat details. It cannot manage the chat creator and can grant only rights it holds itself. The Bot API can return a member count but cannot list every group member. Messages are sent as plain text. Deleting other people's messages may be limited to the first 48 hours, depending on chat type. Promoting someone replaces their administrator rights with the rights you specify. Chat titles can be up to 128 characters and descriptions up to 255.

Tools: `TelegramChatInfo`, `TelegramGetMembersCount`, `TelegramMemberInfo`, `TelegramSend`, `TelegramPinMessage`, `TelegramUnpinMessage`, `TelegramDeleteMessage`, `TelegramBanMember`, `TelegramUnbanMember`, `TelegramPromoteMember`, `TelegramSetChatTitle`, `TelegramSetChatDescription`, `TelegramCreateForumTopic`, `TelegramEditForumTopic`, `TelegramCloseForumTopic` and `TelegramApi`.

`TelegramApi` can call any Bot API method using a JSON parameter object; use it only when no dedicated tool covers the task. Its output is capped at 4,000 characters. Long replies are split into messages of up to 4,000 characters, and photo captions are limited to 1,024 characters.

[Next: WhatsApp](whatsapp-plugin)
