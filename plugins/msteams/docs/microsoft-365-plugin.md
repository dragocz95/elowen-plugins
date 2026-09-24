---
title: Microsoft Teams & Microsoft 365
slug: microsoft-365-plugin
order: 38
eyebrow: Plugin reference
group: Plugin reference
---

# Microsoft Teams & Microsoft 365

Find the administrator-only **Microsoft Teams** workspace in the main navigation; install and configure the plugin in **Settings → Plugins**. The bot answers in Teams personal chats, group chats and channels, and its tools can access Microsoft 365 as a linked person. For channel setup and everyday use, see [Microsoft Teams](channels-teams).

## Where to find it

Install and configure the plugin in **Settings → Plugins**. The administrator-only **Microsoft Teams** workspace is in the main navigation. Its **People & access** tab lists people the bot knows and their linked Elowen accounts; **Settings** includes the downloadable Teams app package.

The plugin registers the `msteams` chat platform and offers learned chats and channels as destinations for scheduled notifications. It also provides the `microsoftIdentity` control for other plugins, but only while personal-chat account linking is configured and working. That control can check whether an Elowen account is linked and give an approved consumer a Graph client limited to that person's OneDrive and SharePoint files.

## Tools

The plugin provides 17 tools in four groups.

**Teams messaging:** `TeamsSend` posts in a conversation the bot already knows; `TeamsMessagePerson` opens or reuses a private chat and messages a person; `TeamsSendFile` offers a file in a private chat. The recipient must accept the card before the file is uploaded to their OneDrive. Mentions can use an ID, e-mail or exact display name. Ambiguous names are not guessed.

**Teams directory:** `TeamsFindPerson`, `TeamsChatInfo`, `TeamsMembers`, `TeamsMemberInfo` and `TeamsListConversations` read people and conversations the bot can reach. These five tools are plan-safe. Reading a roster adds its members to the bot's known-people directory.

**Teams API:** `TeamsApi` calls the Bot Connector API for an operation without a dedicated tool.

**Microsoft 365:** These eight tools act as the signed-in person, within their delegated permissions. Tokens stay in the Bot Framework Token Service.

- `MicrosoftDirectory`: signed-in user, people, Entra users, organization chart and group memberships.
- `MicrosoftSharePoint`: sites, lists, list items and modern pages.
- `MicrosoftFiles`: OneDrive and SharePoint files, including upload, download, versions and sharing links.
- `MicrosoftOutlook`: mail, calendar and contacts, including attachments, drafts, replies and event responses.
- `MicrosoftTasks`: To Do and Planner.
- `MicrosoftOneNote`: notebooks, sections and pages.
- `MicrosoftExcel`: worksheets, tables and ranges in Microsoft 365 workbooks.
- `MicrosoftTeams`: chats and channels as the signed-in person.

Only the five Teams directory tools are safe during planning. Other plugin tools are treated as mutating.

## Install and connect

1. Use Elowen core 0.28.53 or newer. The plugin requires shared plugin API version 5 and web API version 22.
2. Install it from **Settings → Plugins → Available**. Review and acknowledge its access to stores and Project files and its ability to change users. Enabling, disabling or saving settings requests a daemon restart, which may wait for active turns. Changes are saved first; if a restart cannot be requested, they apply on the next start.
3. Register a single-tenant Entra app, create a matching single-tenant Azure Bot, add the Teams channel and set its messaging endpoint to `/hooks/msteams/messages`. Download the app package from the Microsoft Teams workspace and upload it in the Teams admin center. The [Microsoft Teams](channels-teams) page has the setup walkthrough.
4. In plugin settings, enter the bot app ID, client secret and tenant ID. The bot does not connect until all three are set.
5. To enable personal-chat sign-in and Microsoft 365 tools, set up a separate Entra app registration and an OAuth connection on the Azure Bot using the Entra ID v2 provider and the delegated Microsoft 365 scopes. Enter the exact connection name and turn on personal-chat sign-in. A tenant administrator must consent to the delegated scopes in Microsoft.
6. Link an identity when account linking is enabled: a tenant member can sign in from a personal chat, or an administrator can link an existing Elowen account in **People & access**. The link uses the immutable Entra object ID, not a name or e-mail address.

Microsoft sign-in to Elowen's web interface is a separate option. Enable it in plugin settings and register its callback URI on the bot app. The [Microsoft Teams](channels-teams) page explains the redirect and account provisioning.

## Configuration

Plugin settings are in the plugin's detail view. The client secret is write-only: the encrypted value is stored, and the interface shows only whether one is set.

### Bot connection and sign-in

| Setting | Key | Default | Purpose |
| --- | --- | --- | --- |
| Microsoft App ID | `appId` | not set | Required client ID of the single-tenant bot app. |
| Client secret | `appPassword` | not set | Required secret used for Bot Connector authentication. |
| Tenant ID | `tenantId` | not set | Required Entra tenant ID. |
| Personal-chat sign-in | `accountLinking` | `false` | Lets enabled tenant members sign in from personal chats and use their linked Elowen account's access. |
| OAuth connection name | `oauthConnectionName` | not set | Shown when sign-in is on; exact name of the Azure Bot OAuth connection. |
| Enable Microsoft sign-in | `ssoEnabled` | `false` | Adds Microsoft sign-in to Elowen's login page. |
| Public Elowen URL | `ssoRedirectBase` | empty | HTTPS base URL without a path. Register `<base>/api/auth/sso/microsoft/callback` on the bot app. |
| Account provisioning | `ssoProvision` | `off` | `tenant` lets enabled tenant members create an account at first sign-in; requires tenant-admin consent for Microsoft Graph `User.Read.All`. |
| Link existing accounts by e-mail | `ssoLinkByEmail` | `true` | On first sign-in, may link one existing account with the same e-mail. Later identity matching uses the Entra object ID. |
| Default projects | `ssoDefaultProjects` | not set | Projects assigned only to newly provisioned accounts. |
| Allowed models | `ssoDefaultModels` | not set | Model allow-list for new accounts; empty means unrestricted. |
| Preferred model | `ssoDefaultModel` | empty | Preferred model for new accounts. |
| Granted plugins | `ssoDefaultPlugins` | not set | Grant-gated plugins for new accounts. |
| Granted tools | `ssoAllowedTools` | not set | Tools for new accounts; empty grants none until an administrator grants some. |
| YOLO for new accounts | `ssoDefaultYolo` | `false` | Auto-approves tool and command prompts in new conversations. Deny rules still apply; existing accounts are unchanged. |

### Microsoft 365 access

| Setting | Key | Default | Purpose |
| --- | --- | --- | --- |
| Access mode | `m365AccessMode` | `read_only` | Read-only blocks Microsoft 365 changes. Read and write still previews each change until the agent commits that exact operation. |
| File transfer limit | `m365MaxTransferBytes` | 20 MiB | Per-call limit from 1 MiB to 250 MiB. Larger uploads use a resumable upload session. |

These settings appear when personal-chat sign-in is enabled.

### Teams app and notifications

| Setting | Key | Default | Purpose |
| --- | --- | --- | --- |
| App name | `agentName` | Elowen | Name shown for the Teams app and bot. |
| Publisher name | `productName` | app name | Publisher shown in the app package. |
| App icon path | `appIconPath` | not set | Server-side path to a 192 × 192 PNG. |
| Notification conversation | `notifyConversationId` | not set | Learned Teams destination for scheduled notifications; empty disables them. |
| Microsoft Graph lookup | `graphLookup` | `false` | Lets the bot find an unknown e-mail in the tenant and install its Teams app to open a private chat. Requires tenant-admin consent for `User.ReadBasic.All` and `TeamsAppInstallation.ReadWriteSelfForUser.All`. Profile photos also require `ProfilePhoto.Read.All`. |
| Teams catalog app ID | `graphCatalogAppId` | not set | Shown when Graph lookup is on; app ID in the organization's Teams catalog. |

### Replies and conversations

| Setting | Key | Default | Purpose |
| --- | --- | --- | --- |
| Respond without mention | `respondWithoutMention` | `true` | In group chats, reply to every mapped sender or only when mentioned. |
| Tool activity | `toolActivity` | `status` | Options: `off`, `status`, `live`. Controls progress messages. |
| Answer delivery | `answerMode` | `final` | `final` replies at turn end; `live` streams as written. |
| Tool output detail | `toolOutput` | `summary` | Options: `hidden`, `summary`, `tail`. |
| Tool message layout | `toolMessageMode` | `single` | Options: `single` edited progress message or `per_tool` message per tool. |
| Replace activity with answer | `deleteToolActivityAfterTurn` | `false` | Reuse the progress message for the final answer; overrides live-answer and per-tool layouts. |
| Processing reactions | `reactions` | `true` | Show processing status as reactions. |
| Runtime footer | `runtimeFooter` | `true` | Add a small model and context line to the final reply. |
| Show reasoning | `showReasoning` | `false` | Include extended-thinking reasoning in progress messages. |
| Service language | `language` | `en` | Language of the bot's service messages; the agent answers in the user's language. |
| Conversation history backfill | `historyLimit` | `0` | Recent messages loaded for a new conversation, from 0 to 100. |
| Read every channel message | `channelMessagesRsc` | `false` | Adds a permission to the app package so the bot can see all messages in a team after its owner consents to the updated package. |
| Vision model | `visionModel` | not set | Model for messages with images; empty uses the chat's normal model. |

### Media and access policies

| Setting | Key | Default | Purpose |
| --- | --- | --- | --- |
| Max inbound image size | `maxImageBytes` | 5 MiB | Image attachment limit, from 1 to 20 MiB. |
| Max images per message | `maxImages` | 4 | Images sent to the vision model, from 1 to 10. |
| Max images per reply | `maxUploadImages` | 4 | Generated images attached to one reply, from 1 to 10. |
| Role policies | `rolePolicies` | not set | First matching policy admits a sender: Entra object ID, UPN/e-mail, conversation ID, or a final `*` catch-all. The admin flag enables room-administration commands and trusted-room context; Project and tool access still comes from the linked Elowen account. |

## Permissions and limits

The plugin is not grant-gated per user. Teams senders are admitted by a matching role policy or a linked account; Microsoft 365 tools require a verified Elowen account linked to a Microsoft identity. The Teams workspace and its API routes are administrator-only. If account linking is enabled without an OAuth connection name, the bot stays up for diagnostics but mapped personal-chat messages fail closed. A missing or incorrectly sized configured icon makes the app-package download fail.

Bot chat uses the Bot Connector and does not need Microsoft Graph permissions. Graph lookup requires the application permissions listed above. Microsoft 365 tools cannot exceed the delegated scopes granted to the signed-in person. Other plugins that use `microsoftIdentity` receive only a drive-scoped Graph client, never a token or access to mail, calendar or chats.

- Delegated Graph calls time out after 15 seconds; tool output is capped at 20,000 characters.
- SharePoint search returns at most 1,000 results.
- Deletion is disabled in SharePoint, files, Outlook and tasks tools. Other mutations require the agent to commit the exact preview; read-only mode blocks them all.
- File offers work only in personal 1:1 chats. Success means the offer was delivered, not accepted.
- A roster lists up to 50 members, person search returns up to 25 matches, and a direct Bot Connector response is truncated at 4,000 characters.
- The known-people directory covers people the bot has encountered in Teams traffic. A missing person may still exist in the tenant.
