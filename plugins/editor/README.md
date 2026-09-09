# editor

Adds the project file editor to the web interface: editing with Monaco, file management and uploads, previews for common file types, a binary download fallback and read-only Git history. Administrators can also browse and edit persisted host files through the System root.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `editor` plugin.

| | |
| --- | --- |
| Version | `0.3.8` |
| Requires core | `0.28.35` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Tools

This plugin provides no model tools. It works through web interface API routes for file editing, previews and Git history instead.

## Configuration

The manifest declares no settings fields. Disabling the plugin removes the editor UI and its file API, while project registration and task Git history remain available.

## Documentation

See the "Code Tools" page of the Elowen user manual (`docs/site/39-code-tools.md` in the Elowen repository).