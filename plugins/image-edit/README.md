# image-edit

Edit an existing image from a text instruction through a configured image provider or connected ChatGPT account.

## Install

Install **image-edit** from **Settings → Plugins → Available**, configure its provider and model, then enable it.

| Field | Value |
| --- | --- |
| Version | 0.2.11 |
| requiresCore | 0.28.53 |
| requiresSharedApi | none |

Configure the image provider and model in the plugin settings.

The tool saves a PNG in the current project's `generated-images/` folder by default and returns its path. Use `output_path` to save elsewhere in the project. Existing files, including the PNG source, are only replaced with `overwrite: true`. An authorized sender can use `ShareImage({path})` to show the saved image in chat.

See the [Image Editing reference](docs/image-edit.md).
