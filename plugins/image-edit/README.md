# image-edit

Edit an existing image from a text instruction through a configured image provider or connected ChatGPT account.

## Install

Install **image-edit** from **Settings → Plugins → Available**, configure its provider and model, then enable it.

| Field | Value |
| --- | --- |
| Version | 0.2.10 |
| requiresCore | 0.28.53 |
| requiresSharedApi | none |

Configure the image provider and model in the plugin settings.

The tool saves a PNG in the current project's `generated-images/` folder by default and returns its path. An optional output path can place it elsewhere in the project, relative to the working directory or absolute in the managed environment. An explicit output path may overwrite an existing file. Without one, the source is never overwritten. A PNG source may be explicitly selected as the output; a JPEG source cannot be overwritten with PNG data. Use `ShareImage({path})` to show the saved image in the conversation; creating it does not send it automatically.

See the [Image Tools page in the Elowen user manual](https://github.com/dragocz95/elowen/blob/main/docs/site/42-image-tools.md).
