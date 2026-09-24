---
title: Discord Plugin
slug: discord-plugin
order: 38
eyebrow: Plugin reference
group: Plugin reference
---

# Discord Plugin

The Discord plugin connects Elowen to Discord. Install it in **Settings → Plugins → Available**. The plugin's detail view contains its settings. Installing, enabling or disabling the plugin takes effect after Elowen restarts; some settings and per-channel overrides apply live. For day-to-day commands and channel behavior, see [Discord](channels-discord). Shared concepts for all chat platforms are on the [Chat Platform Plugins](chat-platform-plugins) overview.

Current version: **0.3.25**. Requires Elowen 0.28.53 or later, shared API version 5.

Only an administrator can install, enable or configure this plugin. The bot token is stored as a secret; its setting shows whether a token is set, not its value. Plugin tools are available only while the bot is connected.

## Install and connect

Create a bot in the Discord Developer Portal, copy its token, and enable the **Message Content** privileged intent. Enable **Server Members** too if you want the bot to list server members. Invite the bot with the Discord permissions it needs for its work, then install the plugin, enter the token and set at least one role policy in **Settings → Plugins**. Enable the plugin to connect it. The bot's commands include `/model`, `/display`, `/new` and `/help`. If no token is configured, the plugin does not connect and its platform tools are unavailable. Discord direct messages and group DMs are ignored. The notification-destination picker needs the bot token and a guild ID; without them, it shows no destinations.

A role policy decides who the bot answers and can provide extra instructions for a shared room. Configure at least one policy. The first matching policy applies; put a catch-all `*` rule last so it does not shadow specific senders. A sender who matches no policy is ignored. A policy does not replace identity: the sender also needs a linked Elowen account, whose project access and tool permissions apply to the turn.

Each channel has its own conversation and can have its own model and display settings. Use `/new` to start a fresh conversation there. `/context` can bring one of your own conversations into a platform chat. Images are sent to the configured vision model; other attachments are subject to the media limits below.

Set a notification destination to receive proactive messages such as scheduled results. Leave it empty to turn those messages off.

## Connection and access

| Setting | What it does |
| --- | --- |
| Bot token | Required secret from the Discord Developer Portal. |
| Guild ID | Optional server restriction and default server for server tools; empty allows every server the bot belongs to. |
| Allowed threads | Optional thread ID allowlist; empty adds no thread restriction. |
| Notification destination | Channel or thread for proactive messages; empty disables them. |
| Role policies | Map Discord role IDs to access and room instructions. Put `*` last if used. |

The field keys, in table order, are `botToken`, `guildId`, `threadIds`, `notifyChannelId` and `rolePolicies`.

## Replies and display

| Setting | Default | What it does |
| --- | --- | --- |
| Respond without mention | On | Answer in channels the bot can see; turn off to require an @mention. |
| Tool activity | Status | Choose Off, Status or Live output. Set a channel override with `/display`. |
| Answer delivery | Final answer only | Send a complete answer after tool activity, or edit the answer as it is written. |
| Tool output detail | Short summary | Choose Status only, Short summary or Rolling output tail. Full raw tool output is not posted. |
| Tool message layout | One live message | Keep one message or use one message per tool call. |
| Replace tool activity with the answer | Off | Replace the progress message with the final answer. This overrides live-answer and per-tool layouts. |
| Processing reactions | On | Show processing status as reactions on the incoming message. |
| Runtime footer | On | Add the model and context usage below the reply. |
| Show reasoning | Off | Show extended-thinking output when the model supports it. |
| Service language | English | Language of the bot's service messages: English, Czech or Slovak. |

The keys in table order are `respondWithoutMention`, `toolActivity`, `answerMode`, `toolOutput`, `toolMessageMode`, `deleteToolActivityAfterTurn`, `reactions`, `runtimeFooter`, `showReasoning` and `language`.

## Conversation, media and voice

| Setting | Default | What it does |
| --- | --- | --- |
| Channel history backfill | 0 | Load up to 100 recent messages when a new conversation starts. |
| Vision model | Not set | Model for messages with images; empty uses the channel's usual model. |
| Max inbound image size | 5 MiB | Image download limit, configurable from 1 to 20 MiB. Larger images are noted but not sent for recognition. |
| Max images per message | 4 | Number of images sent for recognition, from 1 to 10. |
| Max file size | Not set | Download limit for non-image attachments; unset uses 25 MiB. |
| Max files per message | Not set | Number of non-image attachments, from 1 to 10; unset uses 5. |
| Max images per reply | 4 | Images shared through `ShareImage` attached to one reply, from 1 to 10. |
| Voice provider | Not set | Configured OpenAI-compatible provider for transcription and speech. Empty disables voice features. |
| Transcribe voice messages | Off | Transcribe incoming voice messages and audio with Whisper. |
| Speech-to-text model | `whisper-1` | Model used for transcription. |
| Speak replies | Off | Attach spoken audio to replies by default; change per channel with `/voice`. |
| Text-to-speech model | `gpt-4o-mini-tts` | Model used for speech. |
| TTS voice | `alloy` | Voice ID, such as `alloy`, `echo`, `fable`, `onyx`, `nova` or `shimmer`. |

The keys in table order are `historyLimit`, `visionModel`, `maxImageBytes`, `maxImages`, `maxFileBytes`, `maxFiles`, `maxUploadImages`, `voiceProvider`, `stt`, `sttModel`, `tts`, `ttsModel` and `ttsVoice`.

## Tools and permissions

The bot needs the matching Discord permissions for server-management actions. The **Server Members** intent is required for member listings. The bot's highest role must be above a role it grants or removes. Its tools include:

- Read-only: `DiscordListChannels`, `DiscordReadChannel`, `DiscordServerInfo`, `DiscordChannelInfo`, `DiscordMemberInfo`, `DiscordSearchMembers`, `DiscordListRoles`, `DiscordListMembers` and `DiscordListPins`.
- Manage: `DiscordPinMessage`, `DiscordUnpinMessage`, `DiscordDeleteMessage`, `DiscordPurgeMessages`, `DiscordAssignRole`, `DiscordRemoveRole`, `DiscordCreateThread`, `DiscordArchiveThread`, `DiscordLockThread`, `DiscordAddThreadMember`, `DiscordRemoveThreadMember`, `DiscordCreateChannel`, `DiscordCreateCategory`, `DiscordRenameChannel` and `DiscordDeleteChannel`.
- `DiscordApi`: any Discord REST API v10 request available to the bot.

Start with `DiscordListChannels` to find a channel ID, then use it with the channel tools. `DiscordSearchMembers` matches name prefixes. Channel tools can create text, voice, news, stage or forum channels and public threads. `DiscordApi` is a powerful raw API tool; use it only when a structured tool does not cover the task. Deleting messages or channels cannot be undone, and bulk deletion always starts with a dry run.

`DiscordReadChannel` can retrieve up to 100 recent messages, and its text output may omit the oldest messages when it exceeds 6,000 characters. `DiscordListMembers` returns at most 200 members and needs the Server Members intent. `DiscordListPins` previews message text up to 120 characters; a channel can have at most 50 pinned messages. `DiscordPurgeMessages` considers up to 5,000 recent messages, keeps pinned messages by default and must first be run as a dry run. It deletes messages older than 14 days one at a time. `DiscordApi` output is capped at 4,000 characters and retries rate-limited calls up to three times. Verify targets before using any permanent delete tool. Long replies are split into messages of up to 1,990 characters.

[Next: Telegram](telegram-plugin)
