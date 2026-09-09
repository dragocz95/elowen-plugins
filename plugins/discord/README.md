# discord

Runs a Discord bot that answers from Elowen in channels, threads and direct messages, with slash commands, per-channel model and presentation settings, live tool activity and role-based admission.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `discord` plugin.

| | |
| --- | --- |
| Version | `0.3.18` |
| Requires core | `0.28.11` |
| Requires shared API | `4` |
| User-grantable | No |

## Tools

Twenty-five `Discord*` tools, in four groups: reading and inspection, such as `DiscordReadChannel`, `DiscordListChannels`, `DiscordListRoles`, `DiscordListMembers`, `DiscordSearchMembers`, `DiscordServerInfo`, `DiscordChannelInfo`, `DiscordMemberInfo` and `DiscordListPins`; membership, `DiscordAssignRole` and `DiscordRemoveRole`; thread management, `DiscordCreateThread`, `DiscordArchiveThread`, `DiscordLockThread`, `DiscordAddThreadMember` and `DiscordRemoveThreadMember`; and channels and messages, `DiscordCreateChannel`, `DiscordCreateCategory`, `DiscordRenameChannel`, `DiscordDeleteChannel`, `DiscordPinMessage`, `DiscordUnpinMessage`, `DiscordDeleteMessage` and `DiscordPurgeMessages`.

`DiscordApi` calls any Discord REST endpoint directly as the escape hatch when no curated tool fits.

## Configuration

The required field is `botToken`, a write-only secret. The 27 remaining optional settings cover scoping and the notification destination, reply behavior and tool activity, conversation context and vision, media limits, optional Whisper voice transcription and spoken replies, and the role policies that map Discord roles to admission and room instructions.

## Documentation

See the "Chat Platform Plugins" page of the Elowen user manual (`docs/site/37-chat-platform-plugins.md` in the Elowen repository).