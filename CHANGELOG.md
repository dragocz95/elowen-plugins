# Changelog

## cronjob 0.2.9 - 2026-08-31

- Show semantic green active and red paused status dots in the jobs table.

## msteams 0.5.35 - 2026-08-31

- Resolve delegated Microsoft 365 access from the verified Elowen account on every surface, so web chat, linked platform chats and personal scheduled jobs share the same configured read/write capabilities.

## cronjob 0.2.8 - 2026-08-31

- Show each personal job's owner with their avatar, display name and account ID in the admin jobs register.
- Require Elowen 0.28.22 so personal jobs carry the owner's verified scheduled identity through every delivery path.

## sites 0.7.4 - 2026-08-31

- Move site search, visibility and status filters into the canonical condensed page toolbar.

## msteams 0.5.34 - 2026-08-31

- Use the canonical page toolbar for people search and mapping filters across loading and error states.

## cronjob 0.2.7 - 2026-08-31

- Move search, status and ownership filters into the canonical condensed page toolbar.

## stats 0.2.3 - 2026-08-31

- Apply date ranges across every metric, restore the shared chart palette and unify search with condensed filters.

## msteams 0.5.33 - 2026-08-31

- Preserve person identity width on mobile access details

## msteams 0.5.32 - 2026-08-30

- Keep people access in a clean desktop master-detail layout with a scrollable avatar list and sticky detail panel

## onedrive 0.2.2 - 2026-08-30

- Use semantic host tokens across OneDrive project panels.

## github 0.1.10 - 2026-08-30

- Use semantic host tokens across connection and project views.

## whatsapp 0.2.15 - 2026-08-30

- Use semantic host tokens in pairing settings.

## msteams 0.5.31 - 2026-08-30

- Use semantic host tokens across Teams identity and mapping views.

## sites 0.7.3 - 2026-08-30

- Use semantic host tokens across site register and detail views.

## skills 0.3.2 - 2026-08-30

- Use semantic host text tokens in settings.

## cronjob 0.2.6 - 2026-08-30

- Use semantic host tokens across scheduler forms and tables.

## stats 0.2.2 - 2026-08-30

- Use semantic chart and table tokens in Light and Dark.

## editor 0.3.2 - 2026-08-30

- Use semantic host surfaces and readable Light/Dark editor styling.

## whatsapp 0.2.14 - 2026-08-30

- Accept token-list group allowlists while keeping phone number and JID notification targets open

## telegram 0.2.12 - 2026-08-30

- Accept token-list chat allowlists while keeping notification chat IDs open

## discord 0.3.16 - 2026-08-30

- Use the live destination catalog for notifications and token-list thread allowlists

## onedrive 0.2.1 - 2026-08-30

- Use token-list ignore patterns with lossless array handling and legacy string compatibility

## cronjob 0.2.5 - 2026-08-30

- Add guided interval, daily and weekly scheduling with bounded whole-hour active windows

## codebase 0.1.2 - 2026-08-30

- Use token-list fields for index globs and browsable repository paths while preserving legacy config

## github 0.1.9 - 2026-08-27

- GitHub reads as one identity among the linked accounts, and shows in the summary when linked

Plugin release entries are added by `npm run release:plugin`.
