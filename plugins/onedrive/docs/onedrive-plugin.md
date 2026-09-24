---
title: OneDrive Mirror
slug: onedrive-plugin
order: 43
eyebrow: Plugin reference
group: Plugin reference
---

# OneDrive Mirror

Open a Project's **OneDrive** tab to mirror the Project or a Sandbox workspace with your own OneDrive. Files sync in both directions, so a file added or changed on either side reaches the other.

## Connect OneDrive and choose a folder

Install **onedrive** from **Settings → Plugins → Available**. In the Project's **OneDrive** tab, connect your Microsoft account, choose a folder in OneDrive, then select the whole Project or a folder inside it. Sandbox workspaces can be connected separately from the Project, and each has its own OneDrive folder. In OneDrive, Project and workspace mirrors are kept in separate subfolders under the configured root. A selected subfolder keeps its path in OneDrive, so two folder mirrors do not overwrite one another.

The plugin needs an enabled Microsoft identity provider, such as Microsoft Teams. The tab appears only for an account linked to Microsoft. Managed Projects and their workspaces need a running Sandbox environment to sync; start it if the tab reports that the environment is not running.

The selected folder is the boundary: its files and subfolders sync, but the rest of the Project does not. For example, mirror `docs/` and edit `docs/guide.md` in OneDrive; the next cycle updates that Project file, while a change to `src/` stays outside the mirror. Each person mirrors into their own linked OneDrive account, not a shared account. The Project's `.gitignore` is respected. Version-control files, dependencies, `.env` files, private keys, credential stores and the sync trash are always excluded. Add further glob patterns in plugin settings.

## Check and control a mirror

The tab shows the OneDrive folder, sync status, last sync, file count and unresolved conflicts. Statuses include **In sync**, **Syncing**, **Paused**, **Waiting for the first sync**, **Waiting for your decision**, **Waiting for confirmation** and **Needs attention**. The Project card also shows a OneDrive indicator and the number of unresolved conflicts.

Use **Sync now** to request an immediate sync, **Pause** to stop automatic cycles, or **Resume** to continue. A second request joins a cycle already running for that mirror. If the Microsoft sign-in expires, the tab asks you to reconnect. If access to the Project is lost, the selected folder disappears, or the linked Microsoft identity changes, the mirror stops instead of switching to a different folder or account. Lowering the interval makes checks more frequent and uses more Microsoft Graph requests. Mirrors that overlap the same Project folder wait for one another.

**Disconnect** stops syncing but leaves files in OneDrive. Removing the Project or account removes its mirror without deleting the remote folder.

## Resolve file conflicts

If a file changes in both places before syncing, both versions are kept. The OneDrive copy is saved beside the Project file with a name such as `notes.onedrive-conflict-2026-09-23-06-15-00`. The tab pauses that file until you choose **Use the project version** or **Use the OneDrive version**. If the OneDrive copy changes again while you decide, the plugin asks you to choose against the newer copy. On the first sync, files already identical on both sides become the starting baseline instead of being flagged as conflicts. A file being actively saved waits for the next cycle.

## Recover deleted files

By default, deleting a mirrored file in OneDrive moves its Project copy to `.elowen-trash` inside the Project, where you can recover it. Turn off **Apply deletions from OneDrive** in plugin settings to keep the local copy and upload it to OneDrive again. Deleting a file in the Project normally deletes its OneDrive copy too; the mass-deletion check pauses that action when too many files disappear at once.

If more than one file disappears from the Project at once and the deletion is unusually large, the mirror waits for confirmation instead of deleting remote files. This happens when more than 34% of tracked files are missing or at least 50 are missing. Check that the Project folder is complete; then use **Sync now** to confirm that specific deletion. A later increase in missing files requires confirmation again.

If a scan cannot read the whole selected folder, OneDrive returns an incomplete listing, or Elowen cannot determine which files `.gitignore` excludes, the cycle is skipped and the status becomes **Needs attention**. This prevents an incomplete view from being mistaken for deleted files. The status includes a reason, such as a file that exceeds the size limit or an expired sign-in, so you know whether to change settings or reconnect.

## Configure OneDrive syncing

An administrator edits instance-wide settings in the plugin details under **Settings → Plugins**. These defaults apply to everyone; each person still connects their own Microsoft account and chooses their own mirror folder.

| Setting | Key | Default | What it controls |
| --- | --- | --- | --- |
| OneDrive folder | `rootFolder` | `Elowen` | Top-level folder for mirrored Projects and workspaces. |
| Sync interval | `intervalSeconds` | 30 seconds | How often a mirror is checked. The effective minimum is 10 seconds. |
| Largest file | `maxFileMb` | 100 MB | Larger files are skipped in both directions and reported. |
| Additional ignored paths | `extraIgnore` | None | Glob patterns excluded in addition to `.gitignore`. |
| Apply deletions from OneDrive | `applyRemoteDeletions` | On | Move a file deleted in OneDrive to `.elowen-trash`; off restores it from the Project. |

A scan covers at most 20,000 files. If the Project contains more, that incomplete scan is skipped rather than used to apply deletions. Files larger than the configured limit are skipped and reported rather than silently omitted. If the OneDrive folder cannot be listed completely or a local scan fails, that sync cycle does not apply deletions.

## Install and permissions

Version 0.3.2 requires Elowen 0.28.50 or newer. An administrator installs it from **Settings → Plugins → Available**. The plugin is user-grantable, so an administrator must also grant it under **Users → Granted plugins** before a non-administrator can use it. It has no mutating capabilities that require extra consent.

Enabling, disabling, installing or changing a plugin restarts Elowen. The settings screen says, "Change saved. Elowen is restarting now to load it." This is separate from a OneDrive sync, which runs on its interval or when you select **Sync now**.

[Next: Sites](sites-plugin)
