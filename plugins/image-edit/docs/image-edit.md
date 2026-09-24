---
title: Image Editing
slug: image-edit
order: 67
eyebrow: Plugin reference
group: Plugin reference
---

# Image Editing

Open **Settings → Plugins** to install and configure `image-edit`. In chat, the agent uses `EditImage` to change an existing PNG or JPEG from the current project or a public URL, guided by a text instruction. Each call saves a new PNG into the current project under `generated-images/` and returns its path; an authorized sender can use `ShareImage({path})` to show it in chat. To create a picture from nothing but a description, see [Image Generation](image-gen).

The plugin adds no slash command or page to the web interface. It has its own card under **Settings → Plugins**.

## Configure an image provider

An administrator adds an OpenAI-compatible provider or connects a ChatGPT account in **Settings → Brain**. Then open the plugin's settings from **Settings → Plugins** and select its provider. An OpenAI-compatible provider reuses its configured API key and base URL; the ChatGPT account uses its existing connection, and its sign-in token never enters plugin code.

The **Model** setting selects an image model enabled for that provider in **Settings → Models**; leave it empty to use the provider's default. With the connected ChatGPT account the default is `gpt-image-2.5-sunburst`; with an API-key provider it is `gpt-image-1`. The tool is unavailable until a usable provider is configured; without one, the agent is not offered the image tool.

## Edit an existing image

`EditImage` takes a required `instruction`, plus either a `path` to a PNG or JPEG in the current project or a public HTTP(S) `url`. Supply exactly one source; when neither is present the call is refused.

For example, set `path` to `assets/room.jpg` and `instruction` to "remove the clutter from the desk and make the wall light blue." You can instead give a public image URL. If the URL response carries a content type, it must be PNG or JPEG; a response without one is treated as PNG. Fetching a source URL has a two-minute limit and follows at most five redirects.

The optional `size` accepts `1024x1024`, `1536x1024`, `1024x1536`, or `auto`. Leaving it out or using another value lets the model choose. Editing makes a new render, not a pixel-exact patch, and the original file is never overwritten. The result is a path to the saved PNG: creating it does not send it automatically. Use `output_path` to save elsewhere in the project; an existing file, including the PNG source, is only replaced with `overwrite: true`.

## Install and access

Install `image-edit` from **Settings → Plugins → Available**. Version 0.2.11 requires Elowen 0.28.53 or newer. Configure a provider as described above. The plugin is not user-grantable, so authenticated accounts can use its tool once a provider is configured. It remains subject to account tool permissions.

Enabling the plugin requires no consent confirmation. Installing, enabling, disabling or saving plugin settings requests an Elowen restart, announced as **Restart**. If active work delays it, the change is saved and the restart waits for that work to settle.

## Limits

Image editing can take up to two minutes before timing out. A missing edit instruction is refused before the provider is called. A source image must be a PNG or JPEG. The plugin can fetch a public image URL, but cannot use a private-network address. Image requests run through Elowen, which keeps provider credentials out of the plugin.

[Next: OneDrive](onedrive-plugin)
