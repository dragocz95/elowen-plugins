# Changelog

## cronjob 0.6.8 - 2026-09-18

- The web schedule builder hand-copied the every/daily/weekly regexes from the plugin's parseSchedule grammar; both now import them from one `scheduleGrammar.mjs`, and a new cronGrammar.test.ts case fails if the builder ever stops recognizing a shape the grammar accepts.

## editor 0.4.8 - 2026-09-18

- The kernel-VFS exclusion list existed twice: one array behind the host system-root guard in `files.ts`, another behind the managed guest rule in `editorRoots.ts`, the second copied from the first. One safety list in two copies means a path added to one stays servable through the other, so the list now lives once — exported from the node-free `editorRoots.ts` the browser bundle already imports, consumed by both roots — with a regression test that appends a path to the shared list and proves both consumers refuse it. The excluded paths themselves are unchanged.
## msteams 0.8.1 - 2026-09-18

- Removed two shelved pieces of dead code: the one-line `createMicrosoftIdentityControl` wrapper (tests now call the `createMicrosoftIdentityRuntime` factory it wrapped directly) and the unused `buildTableCard` Adaptive Card table renderer, whose phase-2 wiring never arrived. Live table replies in chat already go through `renderChatTables`, which is unchanged.
## github 0.1.20 - 2026-09-18

- Delete 16 orphaned github translation keys (web.strings) with zero code references across web-src; error_* keys are kept because runtime.ts composes them from a prefix.

## cronjob 0.6.7 - 2026-09-18

- Delete 43 orphaned cronjob translation keys (web.strings) with zero code references across web-src, execution.mjs and index.mjs; weekday* keys are kept because fields.tsx composes them from a prefix.

## sites 0.14.4 - 2026-09-18

- `SiteGet` and `SiteRollback` carried their own owner-only gate on top of the admin-or-owner check already done to resolve the site, so an administrator reading or restoring a file site they do not own was refused by the tool while the API route granted the same actor full detail and rollback. The admin-or-owner rule now lives once, as `canManage` in `access.ts`, and both the tool door and the route call it; the tool's duplicate gate is gone.
## skills 0.4.9 - 2026-09-18

- Agent deletion no longer removes a directory-form skill's support files. Both the DeleteSkill tool and the HTTP route now remove only the skill definition, keep non-empty `references/` and `scripts/` folders, and refuse bundled skills through the same deletion rule.

## image-edit 0.2.5 - 2026-09-18

- Remote source images now use the host's public-only HTTP transport, so loopback, private, link-local, cloud metadata and mixed public/private DNS destinations are refused before a socket opens. An operator who deliberately used an internal image host must expose it through a public address or use an allowed repository path.

## editor 0.4.7 - 2026-09-18

- A git read that fails for a real reason — a locked index, a missing git binary, a corrupt object — no longer answers the same as a clean or empty tree. `status`, `diff`, `show` and `log` swallowed every failure alike; only "not a repository" is still a legitimate empty answer, and everything else now reaches the client as 503 with the daemon's own wording. The Git file tree, the working diff, the commit diff and the file-at-HEAD diff each show that refusal, with a retry, instead of quietly reading as nothing changed.
## browser 0.4.4 - 2026-09-18

- The API route derived a session's HTTP status by matching the exact wording of its error message, so rewording either sentence silently turned a 404 or 409 into a 400 with nothing failing at the throw site. The takeover conflict now throws the plugin's typed access error with its status attached, read at the route instead of guessed from the message.
## voice-bot 0.1.2 - 2026-09-18

- The hourly call cap can no longer be lifted past the maximum the plugin declares. `maxCallsPerHour` written straight to the config API bypassed the settings form, and the runtime only rejected nonsense below 1, so a large value became the limit in full: the one brake on a repeating agent dialling real phones was whatever number the config said. It now clamps to the manifest's min/max/default — 1..200, fallback 10 — declared once in the code and asserted against the manifest in the tests, the same way the longest-call deadline has always been resolved.
## todo 0.14.14 - 2026-09-18

- An unreadable metadata column now survives on disk. The old read swallowed a parse failure into an empty object, so the next unrelated update serialised that empty object back and wrote NULL over the corrupt value, destroying the one piece of evidence of what was stored. A row nobody can parse is now reported instead: the task id is logged once, the read answers empty with a `metadataCorrupt` marker, and updates that do not name metadata leave the column exactly as it is. An explicit metadata write stays the deliberate way to replace it, the same way cronjob refuses to rebuild a shared list from a truncated read.
## codebase 0.1.6 - 2026-09-18

- Report a swallowed auto-reindex failure with a logger warning instead of vanishing silently

## skills 0.4.8 - 2026-09-18

- A plugin contribution an account has switched off no longer carries a 'Disabled for account' badge: the row's own switch is that statement, and repeating it beside the source badge said the same thing twice. The write behind that switch also answers immediately now, so the control stops looking stuck.

## skills 0.4.7 - 2026-09-18

- A contributed skill now names its plugin in the owner column, which is what owns it and has the width for a name. Beside the source badge it shared one 16rem cell with the badge and clipped, so a row for a skill from a plugin ended in a bare ellipsis instead of saying who it belongs to. The source cell is left with the badge alone.

## skills 0.4.6 - 2026-09-18

- A register row marks only what is wrong and what it cannot otherwise say. The switch at the row's edge already states whether the model may invoke a skill, and the scope filter already names its catalogue, so the Active, manual-only and bundled capsules restated what was on screen and together clipped the source cell into a bare ellipsis. What is left is the plugin a contributed skill comes from, and the reason a skill cannot be used. The count that read Effective now reads Active, because effective availability is not a phrase anyone outside the code uses.

## browser 0.4.3 - 2026-09-18

- Below 768px — the same boundary the floating card uses — the docked card in the transcript no longer opens a live view, and shows a still of the session's screen instead. Measured on a real instance, that connection was 708 kB/s while the remote page scrolled and 1923 kB/s while it animated, for a picture a few hundred pixels wide, and noVNC attaches its own gesture handlers to its canvas the moment it connects: touchstart and touchmove are cancelled there, so pinch-zoom stopped working over the whole transcript the moment the agent opened a browser. The still is the route the account panel already uses, refreshed on a timer; above 768px nothing about the docked card changes.
- The still route now names the window it stands for (the cache's `THUMBNAIL_TTL_MS`, lowered from 4 s to 1.5 s) in every answer, and the card refreshes on that value rather than carrying an interval of its own — one number, server-side, that the preview cannot drift away from. The timer stops while the raised canvas is covering the card, while the document is hidden, and once the session has closed, because every ask costs the session's Chrome a rasterization. A still that cannot be renewed is dropped rather than left on the glass as a picture of the past, and the card says which of the two it is showing.
- Opening the card on a phone gives the live view as WATCH-ONLY: the client is told not to send input and is not given the keyboard, because a finger cannot aim a desktop Chrome. The surface still owns its gestures and keeps its labelled way back out. Over that live canvas the state mark is a plain translucent fill instead of a backdrop blur, which was recomputed on every frame the remote page painted; where it only ever sits over a still, it keeps the blur.


## onedrive 0.2.8 - 2026-09-18

- Both registers now carry the tracks their always-visible cells land in. The compact template asked for a single column, so from 40rem to 56rem a conflict or a workspace stacked one record over three lines instead of closing ranks the way every host register does.

## github 0.1.19 - 2026-09-18

- Two status chips asked for a neutral tone the host's scale does not have, so both silently fell back to the default paint instead of the intent they were written with; they name default, and a pull request's merge state now reads in the tone it asked for.

## browser 0.4.2 - 2026-09-18

- A live session's id no longer carries a hand-written ellipsis after its twelve-character clip. The clip stays, because the id names the tab to whoever is closing it and is not something anyone reads in full, but the register is where a value clipped at its column edge is said to be clipped.

## cronjob 0.6.6 - 2026-09-18

- The run history is the host's register: the same document, the same frame for a pending or failed read, the same padded register, and a compact template that keeps the receipt, its state and the open affordance on the three tracks its cells occupy. Its trailing three-dot cell promised a menu that never existed and is replaced by the register's own chevron, and a page beyond the end of a shortened register is no longer a dead end.
## msteams 0.8.0 - 2026-09-18

- A file the agent shares with `ShareFile` now reaches a 1:1 Teams chat. Teams refuses a general file inside a Bot Connector message, so the shared document arrives as the file consent card the owner-only `TeamsSendFile` already posts, and the bytes upload into the recipient's own OneDrive once they accept — the shared live-message engine's file half, wired into the same transport seam that already carried images, with the adapter's existing `offerFile` doing the work rather than a second delivery path. A channel or a group chat keeps exactly its previous behaviour: Microsoft's consent APIs do not work there, so no offer is made, nothing throws, and the answer text still lands.
- Two limits that a shared file makes visible are now named in the chat instead of being swallowed: a file over the 20 MB upload cap, which core's `ShareFile` allows at 25 MB, and an offer Teams refuses. Neither costs the other files in the turn or the answer. A stored file the shared resolver cannot read is still dropped before this plugin sees it — the same silence as on Discord, Telegram and WhatsApp, because the engine's file seam only ever hands a surface the bytes it managed to read. An offer nobody has accepted still lives only in memory, so a daemon restart loses it — the card is then answered with "that file offer is no longer available".

## sites 0.14.3 - 2026-09-18

- A picture the register is about to renew no longer carries a caveat. Opening the register takes a new picture of anything past its age, so the "Stale" badge on the card and in the drawer only reported work already under way; the previous picture stays until the new one arrives. A capture that failed still says so, because nothing resolves that on its own.

## todo 0.14.7 - 2026-09-15

- The task list now reaches the turn it was composed for. Core re-reads a registered provider inside a long turn, after the last tool result and every N tool calls (the cadence knob in Settings -> Runtime), so a 60-call turn no longer works from a snapshot taken before its first call. The reminder is at most two short lines — the running task, its elapsed time, the open and completed counts, and one instruction to reconcile the list — and never a second copy of `<task_context>`, because core freezes every byte of it and re-sends it for the rest of the turn.
- A list whose every task is completed says nothing, so a conversation with no task list stays silent and spends no bytes. An install onto a core that predates the seam keeps today's behaviour instead of skipping the whole plugin.

## lsp 0.2.0 - 2026-09-15

- Idle and root-less language servers are now evicted: a warm server whose project root has been deleted, or that has not served a check for idleTtlMinutes (default 10, 0 turns age eviction off), is disposed and its memory released, so the pool no longer holds a server for the whole daemon lifetime.

## onedrive 0.2.5 - 2026-09-15

- Managed Project mirrors now pass the authenticated guest request when launching Git, renew and release their execution lease, cancel bounded commands that do not settle, and discard completed root locks instead of leaving later cycles joined to stale work.
- Complete managed scans preserve the documented 20,000-path limit with one explicit sentinel entry. A larger or partially read tree is reported as incomplete rather than silently mirrored as a complete inventory.

## registry catalog - 2026-09-14

- Removed the obsolete marketplace `web` 0.3.1 copy. Web has been bundled in Elowen core since the 0.28.17 release line, bundled folders always win over an installed plugin with the same name, and the marketplace classifies that entry as bundled rather than installable. Core Web 0.5.0 is now the single authority.

## browser 0.4.0 - 2026-09-14

- The browser plugin publishes a Sites-only `browserCapture` control for one server-derived HTTPS publication URL. It resolves and validates the public hostname once, pins that address behind the existing authenticated enforcing proxy, and permits only the exact origin for redirects, documents, subresources, fetches, WebSockets and workers. Literal, loopback, private, link-local and rebound destinations are refused.
- Capture timeout and plugin disposal retain ownership until a late browser launch is closed and the throwaway profile is removed. Cleanup failures fail the attempt instead of returning a successful picture, downloads remain denied, and only one capture runs at a time.

## sites 0.14.0 - 2026-09-14

- Sites publishes one model: an address for an application inside an active managed Project, created with the port it listens on and published by verifying it through the Project's own transport. Nothing is copied, nothing is started, and a host Project is refused.
- The file-publication copier is gone. Rows published under the retired model keep serving the files they already hold, keep their release ledger and can still be rolled back, but they can no longer be published: `SitePublish` refuses instead of reviving a copy path this release does not have.
- The Sites register shows a picture of each published page, taken through the site's own published hostname with a one-use grant bound to the site and its access generation and spent by the first request that presents it. Rendering stays anonymous: no account is forwarded to the Project application and no capture counts as a visit.
- One bounded picture per site, replaced atomically under a new version, renewed lazily while a register is open, after a publish and on a rate-limited manager request from the drawer. The picture has its own access-controlled endpoint, goes with the site on deletion, and a capture that fails leaves the previous one in place while the card states the caveat.
- The proxy probe now presents the site's public Host rather than `localhost`, so an application that answers by Host is judged as a visitor would find it.
- Turning public sites off now closes the pages that are already public, instead of only removing the option from the settings form, and a method a file release refuses is answered after access rather than before it.
- Retired file-publication size and retention settings, the public SPA router input and unused copy-path dependencies are removed. Existing file rows still serve, roll back and delete; proxy rows expose no source folder or release activation path.

## skills 0.4.0 - 2026-09-14

- Show the live effective skill catalog from every source in Skills, including plugin-contributed skills with contributor, scope, manual-only and availability status.
- Let administrators select an account and disable or re-enable individual plugin skill contributions without changing plugin grants or another account's catalog.
- Resolve `ListSkills` through the same live host catalog as the prompt and `SkillLoad`; plugin skill writes require Elowen core 0.28.46.

## onedrive 0.2.4 - 2026-09-14

- Mirror host and managed Projects through their authoritative file transport. Managed mirrors stay confined to the Project guest root and pin the environment generation and file version while scanning and transferring data.
- Require Elowen core 0.28.46 so an older daemon refuses installation instead of exposing a host-path API error on managed Projects.

## sites 0.13.0 - 2026-09-14

- The Sites register is a responsive grid of cards led by an address plate, three across on a wide desktop and one on a phone, and the standalone Publication column is withdrawn in favour of a single badge on the card.

## discord 0.3.20 - 2026-09-13

- Strip Elowen conversation generations from Discord delivery targets.

## editor 0.4.4 - 2026-09-13

- Keep the editor toolbar focused on controls by moving the full active file path to the bottom status bar, with a storage icon and the complete host or managed-environment path.

## sites 0.12.0 - 2026-09-13

- Remove the complete Site-owned application runtime: command and PHP publication, process supervision, runtime sockets, logs, settings, API and UI controls, plus the retired per-Site environment lifecycle and conversion paths.
- Keep only immutable static releases and proxy publications bound to an explicit managed Project through Sandbox's durable publication transport, with no host path fallback and no Site-owned application lifecycle.
- Publish managed Project static output through bounded Sandbox Project file operations. Regular file reads remain content-versioned, unsupported files and symlinks are skipped, inconsistent metadata is rejected and every failed transfer removes its partial release atomically. Dormant command, PHP and environment rows remain hidden as opaque audit data.

## editor 0.4.3 - 2026-09-12

- The root path moved to the trailing edge of the editor toolbar, where it reads as a status rather than sitting between the title and the File menu and pushing the menus along as it grew with every file opened. File, View and Settings stay compact behind the title. The path is right-aligned, gives way before anything else in the row and is not drawn on a phone, so it can neither wrap the toolbar nor crowd out the actions.

## editor 0.4.2 - 2026-09-12

- A managed Project's files are read one directory at a time, the way the environment filesystem already was. The Project tree was read eight levels deep in one crossing, which a real Project exceeds: Sdilene answered `directory listing is too large; select a subdirectory` on its own root, so the whole editor was unusable there. The root now returns its direct children and each folder is read as it is opened, so the size below a folder can no longer decide whether the root opens at all. The node limit is unchanged and no listing is trimmed and reported as whole.
- A folder that cannot be read is reported and collapses again, instead of sitting open and empty.

## editor 0.4.1 - 2026-09-12

- A file listing that fails is reported as a failure. It was drawn as an empty folder, so a refusal the daemon had already explained — a tree too large to render, an environment that is not running, access that was revoked — reached the browser as "No files" with no reason and nothing to retry. The refusal is now shown in the tree with the daemon's own wording and a retry beside it.
- The Project and System switch moved from the toolbar into the File menu, where it sits with the actions whose target it decides. It is a submenu of the host's menu, so it is reachable by keyboard and to assistive technology, and the toolbar keeps its width for the file path.

## editor 0.4.0 - 2026-09-12

- A managed Project's files are read at the directory it is actually mounted at, taken from core's canonical slug rule, instead of a hardcoded `/workspace`. That directory belongs to the base image and is empty in every Project, which is why a Project such as Sdilene showed an empty tree with no error at all.
- A managed Project now offers two separate roots. Project is its own directory inside the environment and keeps the Git history; System is the whole persistent environment filesystem, where the Project directory appears beside the base image. Kernel filesystems (`/dev`, `/proc`, `/run`, `/sys`) are excluded from System, and version history is reported as unavailable there rather than Git being run at `/`.
- The root travels as a named value on every request and the daemon resolves the directory from the authorized Project, so a path can never select its own confinement. Each root keeps its own listing cache, and switching roots closes what was open, because a relative path means a different file under the other root.
- Host Projects are unchanged and gain no filesystem root; browsing the server filesystem remains the separate administrator capability it already was.

## github 0.1.16 - 2026-09-12

- Read a managed Project's repository at its canonical guest root and request only the selected Project, so the Project drawer reports real Git state instead of a load failure; genuine Git, permission and runtime failures still surface as errors.

## whatsapp 0.2.18 - 2026-09-12

- declare elowen-plugin-shared API 4 so the channel keeps loading on core 0.28.42, which refuses a plugin declaring API 3

## telegram 0.2.15 - 2026-09-12

- declare elowen-plugin-shared API 4 so the channel keeps loading on core 0.28.42, which refuses a plugin declaring API 3

## msteams 0.7.1 - 2026-09-12

- declare elowen-plugin-shared API 4 so the channel keeps loading on core 0.28.42, which refuses a plugin declaring API 3

## discord 0.3.19 - 2026-09-12

- declare elowen-plugin-shared API 4 so the channel keeps loading on core 0.28.42, which refuses a plugin declaring API 3

## sites 0.11.2 - 2026-09-12

- the published address no longer ends a certificate detail that is already a sentence with a second full stop

## sites 0.11.1 - 2026-09-12

- SiteGet no longer reports a host Project path the caller cannot use

## sites 0.11.0 - 2026-09-12

- Derive the published-sites hostname from the instance's own public URL when a forked tool runner holds no gateway broker, so SiteCreate and SitePublish report the address the daemon serves instead of refusing, and report each site row's recorded certificate state in SiteList without a TLS handshake per site.

## sites 0.10.29 - 2026-09-11

- Register new Site environments with a persistent exploded root filesystem, preserving installed applications and system configuration across container recreation and source rebinding.
- Use conversion bootstrap seeds only for the first persistent-disk container, keep legacy image-backed rows unchanged, and route snapshots and rollback through Sandbox disk format 2 with optional data restoration.

## sites 0.10.28 - 2026-09-11

- A Site built natively in its environment (no conversion recipe) creates its container without a bootstrap seed instead of failing with a missing recipe.

## sites 0.10.27 - 2026-09-11

- Rebuild and import the disposable conversion bootstrap seed before every new Sandbox container rootfs, preserving application data while restoring the app unit and one-use credentials after source rebinding, recovery or recreation.
- Keep existing Site generations on their registered content-addressed image during restart, provisioning the current fixed recipe only for an unprovisioned runtime.

## sites 0.10.26 - 2026-09-11

- Upgrade legacy Sandbox Site registrations and the Sites binding copy with the migrated Project-relative source reference during plugin boot, preserving the runtime generation and rejecting any changed absolute source.

## sites 0.10.25 - 2026-09-11

- Store Site sources as Project-relative references and resolve the current host workspace through Sandbox when publishing, reconciling or recreating a container, so Project adoption, rollback and generation changes cannot leave stale absolute binds.
- Refuse startup migration when a legacy Site source lies outside its owning Project instead of silently serving an empty directory.

## sites 0.10.24 - 2026-09-11

- Skip automatic conversion completion for Sites already being deleted, so the migration supervisor does not compete with deletion or log repeated completion failures.

## sites 0.10.23 - 2026-09-11

- Remove each deleted Site's privileged runtime socket directory after its environment and durable rows are gone, and log one warning if the gateway helper refuses cleanup.
- Let `SiteDelete` explicitly hand over a mismatched Sandbox runtime binding, so deletion converges for retained pre-0.10.22 migration rows instead of retrying forever.

## sites 0.10.22 - 2026-09-11

- Give every runtime conversion attempt its own durable operation identity, so a Site can complete, roll back and complete again without reusing the first conversion's Sandbox requests or trusted binding.

## sites 0.10.21 - 2026-09-11

- Treat a deleted Sandbox environment binding as absent during conversion preparation, so a completed conversion can roll back and convert forward again with a new binding identity while live mismatches remain rejected.
- Complete Site deletion after environment resources are removed even when the published-sites socket broker is unavailable during final gateway teardown.

## sites 0.10.20 - 2026-09-11

- Restore completed command conversions symmetrically when their application data directory is nested below `/data`, and retain rollback artifacts until environment cleanup succeeds.
- Use the Sites runtime authority for supervisor cleanup after rollback restores a legacy runtime, including idempotent deletion of retained environments and tombstones.
- Render one non-throwing publish result for file and proxy publications, and complete `SiteDelete` before reporting success.

## sites 0.10.19 - 2026-09-11

- Keep completed conversion undo material until an explicit `retire` step, allow durable rollback from `completed`, and restore legacy data, runtime and publication before discarding the Project-side environment.
- Queue conversion completion for the daemon supervisor so client deadlines cannot interrupt its durable phases. The final environment still replaces its own container and volume before readiness, so hostname downtime covers export, rebind, import and startup until a future dual-transport cutover is implemented.
- Return a truthful successful `SitePublish` result when no public base hostname is configured, including the verified Project port and transport socket instead of throwing after publication went live.

## sites 0.10.18 - 2026-09-11

- Wait up to the configured start deadline for a persistent environment ingress socket, keep timeout failures retryable, and derive live routing from the durable Site row and socket so flipped conversions recover after reconcile or restart.

## sites 0.10.17 - 2026-09-11

- Re-register a discarded conversion environment from its Sandbox tombstone before preparing the same Site again.

## sites 0.10.16 - 2026-09-11

- Keep restored legacy publications live while a converted environment is discarded, remove staged migration files before deleting the environment, and make rollback cleanup converge after a partial discard.

## sites 0.10.15 - 2026-09-10

- Make runtime-conversion rollback durable and re-entrant, restore legacy serving before discarding the environment, retain completed migration audit rows, remove the conversion seed from the final container, and finish site deletion when its environment is already absent.

## sites 0.10.14 - 2026-09-10

- Finish conversion staging retirement and make proxy conversion rollback restore the legacy socket until the Project application is published again.

## sites 0.10.13 - 2026-09-10

- Show actionable publication failures, complete environment setup localization, and serialize conversion retirement across reconcile ticks.

## todo 0.14.6 - 2026-09-10

- Give `TaskCreate` one unambiguous sibling dependency syntax: `blockedBy: ["$1"]`. Existing task IDs stay plain strings, invalid references name the affected task, and every prompt surface shows the same example.

## sites 0.10.12 - 2026-09-10

- Complete plain flipped conversions automatically and surface unhealthy live proxy publications as degraded.

## sites 0.10.11 - 2026-09-10

- Harden Project-backed publications, stop creating per-site environments, and require the account-independent core publication seam.

## sites 0.10.10 - 2026-09-10

- A site created in a managed Project gets its source folder inside that Project, under the directory the
  Project is mounted at (`/<slug>`), instead of the fixed `/workspace/sites/<slug>` — a path that does not
  exist in a Project container. The folder was created outside the Project, so the Project tools never
  showed the tree the agent had been told to write into, and publishing it found no files to copy.

## sites 0.10.9 - 2026-09-10

- Completing a runtime conversion retires the staged copy, so a converted site is left with ONE working
  copy: `complete` folds the staged workspace back into the site's folder in the Project, rebuilds the
  container on that folder with its persistent volume carried across, and removes the conversion's
  directory. A conversion a restart interrupted after its flip is completed by the periodic reconcile as
  soon as the site answers, instead of serving a staged copy nobody edits for good.

## browser 0.3.11 - 2026-09-10

- The project browser is removed. The plugin has one mode: the linked account's Chrome running on the
  host, with the live view card and user takeover. `BrowserOpenProject` is gone, `BrowserOpen` takes only
  an optional `url`, and no browser runs inside a managed project's environment any more. The
  `project_id` column stays in the session table for databases that already carry it, and is never
  written.

## browser 0.3.10 - 2026-09-10

- The project browser is its own tool, `BrowserOpenProject`, instead of a `useProjectProfile` flag on
  `BrowserOpen`. Models that fill every optional parameter sent the flag as `true` on every open, which
  turned the shared project profile into the default and took the live view card away again.

## browser 0.3.9 - 2026-09-10

- `BrowserOpen` no longer switches to the project browser just because the turn executes in a managed
  project. A chat runs in a managed personal project by default, and keying the mode on that ambient
  execution target replaced the account browser everywhere: the session ran headless inside the container,
  opened no chat artifact, so no live view card appeared, and stayed out of the account's session listing
  on Account -> Plugins -> Browser. The shared project profile is now asked for explicitly with
  `useProjectProfile`, and follow-up tools resolve a session by how it was opened.

## image-gen 0.2.3, image-edit 0.2.3 - 2026-09-09

- Both plugins now render through the host image seam (`ctx.images`) instead of their own HTTP client, so
  a connected ChatGPT account works alongside an API-key provider: the account's OAuth token stays in the
  daemon and never reaches plugin code. Requires core 0.28.36, the first core that provides the seam.
- The provider field accepts an OpenAI-compatible endpoint or the ChatGPT account, and the model field is
  free text: the account serves gpt-image-2.5-sunburst, gpt-image-2.5-flare, gpt-image-2 and
  gpt-image-1.5, which are image models and are no longer offered in the chat model picker.

## lsp 0.1.5 - 2026-09-09

- Requires core 0.28.35: this plugin reaches a managed project through the Sandbox environment control, which no earlier core provides.

## github 0.1.15 - 2026-09-09

- Requires core 0.28.35: this plugin reaches a managed project through the Sandbox environment control, which no earlier core provides.

## editor 0.3.7 - 2026-09-09

- Requires core 0.28.35 and rebuilds the web bundle, whose committed copy still omitted the upload size a managed project's chunked upload requires.

## cronjob 0.4.7 - 2026-09-09

- Requires core 0.28.35: this plugin reaches a managed project through the Sandbox environment control, which no earlier core provides.

## codebase 0.1.4 - 2026-09-09

- Requires core 0.28.35 and declares the controls grant: the semantic index now reads a managed project through its environment instead of the host filesystem.

## browser 0.3.8 - 2026-09-09

- Requires core 0.28.35: this plugin reaches a managed project through the Sandbox environment control, which no earlier core provides.

## whatsapp 0.2.17 - 2026-09-05

- Collect every question's numbered or permitted custom answer before submission, retain questions beyond the initial preview, and preserve pending answers when delivery is refused.

## telegram 0.2.14 - 2026-09-05

- Preserve all questions, collect per-question choices and custom answers, and prompt for missing answers without prematurely resolving the conversation.

## discord 0.3.18 - 2026-09-05

- Collect complete multi-question answers through components or numbered text, retain per-question custom input, and preserve pending state when submission is refused.

## todo 0.14.2 - 2026-09-05

- Add atomic task batch deletion, structured task card fields, editable subjects and owners, and control-character validation without exposing private task metadata.

## sites 0.10.2 - 2026-09-05

- Add persistent rootless environments with systemd, bounded resources and host-owned ingress alongside static, command and PHP sites.

## cronjob 0.3.3 - 2026-09-05

- Trigger job autosave only for user edits, preventing scheduler updates and API refreshes from causing repeated save loops.

## browser 0.3.3 - 2026-09-05

- Introduce persistent account-owned Chrome automation with typed accessibility actions, live VNC viewing, exclusive user takeover and an enforcing network boundary.
- Include readiness and performance diagnostics and rebuild the committed browser UI with the released host helpers.

## sites 0.8.0 - 2026-09-04

- Let agents build normally in Project worktrees, then run published sites with configurable outbound networking, safe socket or loopback binding, runtime `.env`, modern browser API access and dependency-safe release copies

## browser 0.2.11 - 2026-09-04

- Report an input batch dropped because the page moved on as an outcome the card shows for a moment, not as an error toast per pointer move

## editor 0.3.6 - 2026-09-04

- Let the standalone editor use roughly 80% of a wide workspace and reveal the file-tree scrollbar on hover or keyboard focus
- Add administrator browsing and editing of persisted host files through the System root while excluding kernel virtual filesystems.

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
- Preserve per-question custom answers in Adaptive Cards, require complete answers before submission, and retain pending state when delivery is refused.

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
