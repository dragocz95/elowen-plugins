# image-gen

Generates images from a text prompt through a configured provider, and the generated image is delivered straight into the chat.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `image-gen` plugin.

| | |
| --- | --- |
| Version | `0.2.3` |
| Requires core | `0.28.36` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Tools

`GenerateImage` takes a text prompt and returns the generated image in the chat.

## Configuration

The required field is `provider`, the configured provider that renders the image. Optional fields are `model` for the image model and `size` for the output resolution, defaulting to a square 1024x1024. The manifest declares 3 settings fields, none of them secret.

## Documentation

See the "Image Tools" page of the Elowen user manual (`docs/site/42-image-tools.md` in the Elowen repository).