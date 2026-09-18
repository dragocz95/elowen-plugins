# msteams

Microsoft Teams bot that answers from Elowen AI in personal chats, group chats and team channels, with chat and Microsoft 365 tools.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `msteams` plugin.

This plugin's version, minimum core version and shared-API requirement are stated in `elowen-plugin.json` in this folder and published in `registry.json`; they are deliberately kept out of this file so it cannot go stale.

## Tools

TeamsSend, TeamsMessagePerson, TeamsFindPerson, TeamsChatInfo, TeamsMembers, TeamsMemberInfo, TeamsListConversations, TeamsSendFile, TeamsApi, MicrosoftDirectory, MicrosoftSharePoint, MicrosoftFiles, MicrosoftOutlook, MicrosoftTasks, MicrosoftOneNote, MicrosoftExcel, MicrosoftTeams.

## Configuration

appId, appPassword, tenantId, accountLinking, oauthConnectionName, ssoEnabled, ssoRedirectBase, ssoProvision, ssoLinkByEmail, ssoDefaultProjects, ssoDefaultModels, ssoDefaultModel, ssoDefaultPlugins, ssoAllowedTools, ssoDefaultYolo, m365AccessMode, m365MaxTransferBytes, agentName, productName, appIconPath, notifyConversationId, graphLookup, graphCatalogAppId, respondWithoutMention, toolActivity, answerMode, toolOutput, toolMessageMode, deleteToolActivityAfterTurn, reactions, runtimeFooter, showReasoning, language, historyLimit, channelMessagesRsc, visionModel, maxImageBytes, maxImages, maxUploadImages, rolePolicies.

## Documentation

See the [msteams page in the Elowen user manual](https://github.com/dragocz95/elowen/blob/main/docs/site/38-microsoft-365-plugin.md).
