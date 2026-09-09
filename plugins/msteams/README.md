# msteams

Runs a Microsoft Teams bot backed by the Azure Bot Framework that answers in personal chats, group chats and team channels, with delegated Microsoft 365 Graph tools, proactive messaging, Adaptive Cards and an administrator workspace for people and admission.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `msteams` plugin.

| | |
| --- | --- |
| Version | `0.7.0` |
| Requires core | `0.28.23` |
| Requires shared API | `4` |
| User-grantable | No |

## Tools

The nine `Teams*` tools cover the chat surface: sending a message or a file, messaging a person proactively by e-mail or name, looking up people and chats, listing members and conversations, and raw Bot Connector access through `TeamsApi`. The eight `Microsoft*` tools reach Microsoft 365 for the directory, SharePoint, files, Outlook, tasks, OneNote, Excel and Teams, and each one acts with the linked person's own Microsoft identity, so it can never reach data that person cannot reach.

## Configuration

The required fields are `appId`, `tenantId` and the client secret `appPassword`, which is write-only. The 37 optional settings cover personal-chat Microsoft sign-in, Microsoft single sign-on and the defaults applied to newly provisioned accounts, Microsoft 365 access mode and transfer limits, proactive Microsoft Graph lookup, reply behavior, conversation context, media limits and the role policies that admit senders. The plugin provides the `microsoftIdentity` control.

## Documentation

See the "Microsoft Teams & Microsoft 365" page of the Elowen user manual (`docs/site/38-microsoft-365-plugin.md` in the Elowen repository).