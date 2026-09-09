# image-edit

Edits an existing image from a text instruction through a configured provider, and the edited image is delivered straight into the chat.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `image-edit` plugin.

| | |
| --- | --- |
| Version | `0.2.3` |
| Requires core | `0.28.36` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Tools

`EditImage` takes a source image and a text instruction and returns the edited image in the chat.

## Configuration

The required field is `provider`, the configured provider that renders the edit. The optional `model` selects the image model, and leaving it empty uses the provider default. The manifest declares 2 settings fields, neither of them secret.

## Documentation

See the "Image Tools" page of the Elowen user manual (`docs/site/42-image-tools.md` in the Elowen repository).