---
title: Image Tools
slug: image-tools
order: 42
eyebrow: Plugin reference
group: Plugin reference
---

# Image Tools

This page stays as the landing slot for the old `image-tools` slug. Image documentation now lives on two pages, one per plugin:

- [Image Generation](image-gen) — the `image-gen` plugin and its `GenerateImage` tool.
- [Image Editing](image-edit) — the `image-edit` plugin and its `EditImage` tool.

Suggested handling: keep this slug as a short overview that links to both pages (this draft), or redirect `image-tools` to `image-gen` and link onwards to `image-edit`. Either way the old slug should not hold the full reference twice.

| Plugin | Tool | Use it to |
| --- | --- | --- |
| `image-gen` | `GenerateImage` | Create a new image from a text description. |
| `image-edit` | `EditImage` | Change an existing PNG or JPEG from the current project or a public URL. |

Both plugins need a configured image provider in **Settings → Brain**, selected per plugin under **Settings → Plugins**. Both require Elowen 0.28.50 or newer.

Order note: this draft, `image-gen` and `image-edit` all declare order 42. Only one page can own that slot; the owner picks which two keep numeric orders and which slug becomes the redirect.
