---
title: Project Editor
slug: editor-plugin
order: 39
eyebrow: Plugin reference
group: Plugin reference
---

# Project Editor

The Editor plugin adds a browser workbench for Project files. It includes a Monaco editor, Edit, Diff and Preview tabs, file management, uploads and read-only Git history. It has no model tools; the model continues to use the files plugin.

Install `editor` from **Settings → Plugins → Available**. It requires Elowen 0.28.53 or later. Project and tool permissions still apply. Check the registry for the plugin's current version and minimum Elowen version.

Open **Editor** in the main navigation. Project permissions determine which files it can show or change. Previews support Markdown, images, PDF, audio, video, CSV and Office documents; unsupported or binary files can be downloaded instead. People can also set word wrap, a minimap, text size and indentation, use fullscreen, and drag files into the tree.

Administrators also get a **System** root for the persisted host filesystem. In managed Projects, Project and System are separate roots; Git history belongs to Project.

## Editor limits

- Text files up to 50 MiB can be buffered; Office previews support files up to 20 MiB.
- Uploads use 2 MiB chunks.
- Git history shows 30 commits by default and at most 500, with changed files and diffs.
- The System root lists one directory level at a time and excludes kernel virtual filesystems.

The plugin has no configuration fields. Disabling it removes the editor and its file API; Project registration and task Git history remain available.

[Next: GitHub](github-plugin)
