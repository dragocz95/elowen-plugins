# Changelog

## browser 0.2.11 - 2026-09-04

- Report an input batch dropped because the page moved on as an outcome the card shows for a moment, not as an error toast per pointer move

## editor 0.3.6 - 2026-09-04

- Let the standalone editor use roughly 80% of a wide workspace and reveal the file-tree scrollbar on hover or keyboard focus

## editor 0.3.5 - 2026-09-03

- Restore host-owned project icons in the administrator project picker and require plugin UI API 16

## browser 0.2.10 - 2026-09-03

- Rebuild the account browser profile panel on the host's settings rows so it reads as the same surface as Models, Memory and Terminal

## github 0.1.14 - 2026-09-03

- Request the GitHub `workflow` scope during device login so authenticated Sandbox Git can publish branches that update Actions workflows

## github 0.1.13 - 2026-09-03

- Name the personal GitHub settings entry "GitHub" instead of the plugin's whole description

## github 0.1.12 - 2026-09-03

- Publish the connected GitHub identity to sibling plugins so a Sandbox shell starts already authenticated

## browser 0.2.9 - 2026-09-03

- Tell a viewer the session is full instead of ending its stream in silence, and let one person watch from the web, the CLI and a phone at once
- Keep a takeover through a re-render or reload of the card, bound every user input from the moment it is queued, answer the session read without waiting on the page, and log each change of control

## browser 0.2.8 - 2026-09-03

- Let a person take control instantly and recover a session whose queue is stuck

## browser 0.2.7 - 2026-09-03

- Stream page favicons and use real history navigation in the takeover toolbar

## browser 0.2.6 - 2026-09-03

- Keep cosmetic artifact limits from breaking browser takeover

## browser 0.2.5 - 2026-09-03

- Keep takeover ownership stable and fall back across approved proxy addresses

## msteams 0.7.0 - 2026-09-03

- Address Outlook mail folders by name

## browser 0.1.0 - 2026-09-02

- Add per-account persistent Chrome profiles, typed CDP automation, pinned-proxy network isolation, live web/CLI viewing and exclusive user takeover

## whatsapp 0.2.16 - 2026-09-02

- Validate role policies and harden pairing recovery

## web 0.3.1 - 2026-09-02

- Validate search provider and result limits

## voice-bot 0.1.1 - 2026-09-02

- Validate required endpoint and token configuration

## telegram 0.2.13 - 2026-09-02

- Normalize role policies and configuration validation

## skills 0.3.4 - 2026-09-02

- Add revision-safe edits and atomic move-update

## sites 0.7.5 - 2026-09-02

- Add atomic guest replacement and persistent action feedback

## onedrive 0.2.3 - 2026-09-02

- Preserve pending actions and retry state

## msteams 0.6.1 - 2026-09-02

- Validate role policies and add People retry feedback

## mcp 0.1.7 - 2026-09-02

- Add revision-safe server drafts and write-only credentials

## image-gen 0.2.2 - 2026-09-02

- Enforce image-size schema and runtime bounds

## image-edit 0.2.2 - 2026-09-02

- Validate image inputs and declare network access

## github 0.1.11 - 2026-09-02

- Harden device-flow recovery and duplicate submissions

## editor 0.3.3 - 2026-09-02

- Protect dirty drafts during close and navigation

## discord 0.3.17 - 2026-09-02

- Validate role policy configuration and surface slash-command failures

## cronjob 0.3.2 - 2026-09-02

- Add revision-safe job autosave and durable retry

## codebase 0.1.3 - 2026-09-02

- Validate indexing configuration and persistence feedback

## mcp 0.1.5 - 2026-09-01

- Move MCP server management into the registry and place the Enabled/Disabled control at the top of the drawer.

## msteams 0.6.0 - 2026-08-31

- Apply one validated Microsoft onboarding template to accounts created from either web SSO or a delegated personal Teams sign-in: projects, models, preferred model, plugins, tools and the persisted YOLO default.
- Await core provisioning before the first Teams turn starts, so a new account is never briefly visible with empty permissions.

## skills 0.3.3 - 2026-08-31

- SkillLoad now opens every grant-filtered skill advertised by the host, including plugin-contributed skills.

## cronjob 0.3.1 - 2026-08-31

- Give active and paused job dots an inline-block box so their semantic width and height render instead of collapsing to 0 × 0.

## cronjob 0.3.0 - 2026-08-31

- Add a shadcn Play action that runs a recurring job immediately without rewriting its future schedule.
- Normalize empty optional job fields so an untouched GET response can round-trip through the editor.

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
