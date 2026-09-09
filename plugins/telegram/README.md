# telegram

Runs a Telegram bot that answers from Elowen in private chats, groups and forum topics, with slash commands, per-chat model and presentation settings, live tool activity and role policies that map senders to access.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `telegram` plugin.

| | |
| --- | --- |
| Version | `0.2.14` |
| Requires core | `0.28.11` |
| Requires shared API | `4` |
| User-grantable | No |

## Tools

Sixteen `Telegram*` tools cover chat operations: sending a message, reading chat and member information and member counts, pinning and deleting messages, banning, unbanning and promoting members, setting a chat title and description, creating, editing and closing forum topics, and raw Telegram API access through `TelegramApi`.

## Configuration

The required field is `botToken`, a write-only secret. The 24 remaining optional settings cover allowed chats and the notification destination, reply behavior and tool activity, vision and media limits, the open-question timeout, optional Whisper voice transcription and spoken replies, and the role policies that admit senders.

## Documentation

See the "Chat Platform Plugins" page of the Elowen user manual (`docs/site/37-chat-platform-plugins.md` in the Elowen repository).