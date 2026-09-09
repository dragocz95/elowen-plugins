# onedrive

Mirrors a Project between the instance and each person's own OneDrive in both directions, so files the agent produces appear in their OneDrive without being handed over in chat.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `onedrive` plugin.

| | |
| --- | --- |
| Version | `0.2.3` |
| Requires core | `0.28.17` |
| Requires shared API | `not declared` |
| User-grantable | Yes |

## Tools

This plugin provides no model tools. Connecting, pausing, syncing and conflict resolution run through its web interface surface on the Project.

## Configuration

No field is required. The 5 optional settings name the OneDrive root folder, the sync interval, the largest mirrored file, extra ignored paths and whether deletions from OneDrive are applied. No field is a secret. The plugin requires the `microsoftIdentity` control, which the `msteams` plugin provides, because each person connects their own Microsoft account.

## Documentation

See the "OneDrive Mirror" page of the Elowen user manual (`docs/site/43-onedrive-plugin.md` in the Elowen repository).