---
title: Image Generation
slug: image-gen
order: 42
eyebrow: Plugin reference
group: Plugin reference
---

# Image Generation

Open **Settings → Plugins** to install and configure `image-gen`. In chat, the agent uses `GenerateImage` to create a picture from a text description. Each call saves one new PNG into the plugin's data directory and returns it as an image that renders inline in web chat. To change an existing picture instead, see [Image Editing](image-edit).

Neither plugin adds a slash command or a page to the web interface. Each has its own card under **Settings → Plugins**.

## Configure an image provider

An administrator adds an OpenAI-compatible provider or connects a ChatGPT account in **Settings → Brain**. Then open the plugin's settings from **Settings → Plugins** and select its provider. An OpenAI-compatible provider reuses its configured API key and base URL; the ChatGPT account uses its existing connection, and its sign-in token never enters plugin code.

The **Model** setting selects an image model enabled for that provider in **Settings → Models**; leave it empty to use the provider's default. With the connected ChatGPT account the default is `gpt-image-2.5-sunburst`; with an API-key provider it is `gpt-image-1`. The tool is unavailable until a usable provider is configured; without one, the agent is not offered the image tool.

The **Size** setting chooses the default output resolution (square, landscape or portrait, defaulting to `1024x1024`). A per-call `size` overrides it for that call.

## Generate a new image

Ask for a subject, style, composition and colours. `GenerateImage` accepts a required `prompt` and an optional `size`:

- `1024x1024` for square images
- `1536x1024` for landscape images
- `1024x1536` for portrait images

Any other value falls back to the configured default size. For example, ask for "a flat-design blue owl logo on a white background, centered, with simple geometric shapes." Naming the subject, style, layout and colours gives the model useful direction. Text inside generated images may be unreliable.

The result is a fresh render returned inline in the conversation, not a file path or raw bytes. Use `EditImage` from the [Image Editing](image-edit) plugin if you want to change an existing picture.

## Install and access

Install `image-gen` from **Settings → Plugins → Available**. Version 0.2.7 requires Elowen 0.28.50 or newer. Configure a provider as described above. The plugin is not user-grantable, so authenticated accounts can use its tool once a provider is configured. It remains subject to account tool permissions.

Enabling the plugin requires no consent confirmation. Installing, enabling, disabling or saving plugin settings requests an Elowen restart, announced as **Restart**. If active work delays it, the change is saved and the restart waits for that work to settle.

## Limits

Image generation can take up to two minutes before timing out. A missing prompt is refused before the provider is called. Image requests run through Elowen, which keeps provider credentials out of the plugin.

[Next: Image Editing](image-edit)
