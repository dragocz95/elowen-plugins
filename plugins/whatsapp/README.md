# whatsapp

WhatsApp bot that answers from Elowen AI in direct and group chats, with text commands, model selection, live progress and sender policies. It also provides group management and sending tools.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `whatsapp` plugin.

This plugin's version, minimum core version and shared-API requirement are stated in `elowen-plugin.json` in this folder and published in `registry.json`; they are deliberately kept out of this file so it cannot go stale.

## Tools

WhatsappSend, WhatsappGroupList, WhatsappGroupInfo, WhatsappGroupCreate, WhatsappGroupAdd, WhatsappGroupRemove.

## Configuration

phoneNumber, groupIds, notifyChat, respondWithoutMention, streaming, deleteToolActivityAfterTurn, reactions, runtimeFooter, showReasoning, language, visionModel, maxImageBytes, maxImages, maxUploadImages, askTimeoutMs, senderPolicies.

## Documentation

See the [whatsapp page in the Elowen user manual](https://github.com/dragocz95/elowen/blob/main/docs/site/37-chat-platform-plugins.md).
