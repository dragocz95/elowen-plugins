# telegram

Telegram bot that answers from Elowen AI, with slash commands, per-chat presentation settings, live tool activity, status reactions and proactive pushes. It also provides chat, member, moderation and forum-topic tools.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `telegram` plugin.

This plugin's version, minimum core version and shared-API requirement are stated in `elowen-plugin.json` in this folder and published in `registry.json`; they are deliberately kept out of this file so it cannot go stale.

## Tools

TelegramApi, TelegramSend, TelegramChatInfo, TelegramGetMembersCount, TelegramMemberInfo, TelegramPinMessage, TelegramUnpinMessage, TelegramDeleteMessage, TelegramBanMember, TelegramUnbanMember, TelegramPromoteMember, TelegramSetChatTitle, TelegramSetChatDescription, TelegramCreateForumTopic, TelegramEditForumTopic, TelegramCloseForumTopic.

## Configuration

botToken, allowedChatIds, notifyChatId, respondWithoutMention, toolActivity, answerMode, toolOutput, toolMessageMode, deleteToolActivityAfterTurn, reactions, runtimeFooter, showReasoning, language, visionModel, maxImageBytes, maxImages, maxUploadImages, askTimeoutMs, voiceProvider, stt, sttModel, tts, ttsModel, ttsVoice, rolePolicies.

## Documentation

See the [telegram page in the Elowen user manual](https://github.com/dragocz95/elowen/blob/main/docs/site/37-chat-platform-plugins.md).
