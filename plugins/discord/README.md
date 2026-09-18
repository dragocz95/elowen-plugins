# discord

Discord bot that answers from Elowen AI, with slash commands, per-channel presentation settings, live tool activity, status reactions and proactive pushes. It also provides server, member, role, thread, channel and message management.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `discord` plugin.

This plugin's version, minimum core version and shared-API requirement are stated in `elowen-plugin.json` in this folder and published in `registry.json`; they are deliberately kept out of this file so it cannot go stale.

## Tools

DiscordApi, DiscordListChannels, DiscordReadChannel, DiscordListRoles, DiscordListMembers, DiscordAssignRole, DiscordRemoveRole, DiscordServerInfo, DiscordChannelInfo, DiscordMemberInfo, DiscordSearchMembers, DiscordListPins, DiscordCreateThread, DiscordPinMessage, DiscordUnpinMessage, DiscordDeleteMessage, DiscordPurgeMessages, DiscordCreateChannel, DiscordCreateCategory, DiscordRenameChannel, DiscordDeleteChannel, DiscordArchiveThread, DiscordLockThread, DiscordAddThreadMember, DiscordRemoveThreadMember.

## Configuration

botToken, guildId, threadIds, notifyChannelId, respondWithoutMention, toolActivity, answerMode, toolOutput, toolMessageMode, deleteToolActivityAfterTurn, reactions, runtimeFooter, showReasoning, language, historyLimit, visionModel, maxImageBytes, maxImages, maxFileBytes, maxFiles, maxUploadImages, voiceProvider, stt, sttModel, tts, ttsModel, ttsVoice, rolePolicies.

## Documentation

See the [discord page in the Elowen user manual](https://github.com/dragocz95/elowen/blob/main/docs/site/37-chat-platform-plugins.md).
