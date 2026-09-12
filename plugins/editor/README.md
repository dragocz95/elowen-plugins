# editor

Adds the project file editor to the web interface: editing with Monaco, file management and uploads, previews for common file types, a binary download fallback and read-only Git history. Administrators can also browse and edit persisted host files through the System root.

## Roots

A project opened in the editor has one root, except a managed project, which has two and shows a switch between them.

| Root | What it shows |
| --- | --- |
| Project | The project's files, at the directory the project is mounted at inside its own environment. Version history belongs here. |
| System | The whole persistent filesystem of that environment, with the project directory visible beside the base image. Kernel filesystems (`/dev`, `/proc`, `/run`, `/sys`) are excluded, and version history is reported as unavailable. |

The two roots stay separate: each keeps its own listing and its own cache, and switching between them closes what was open, because the same relative path means a different file under the other root. Which root a request operates on travels as a named value and the daemon resolves the directory from the project itself, so a path can never select its own confinement. A host project keeps its single root and does not gain access to the server filesystem; that view remains an administrator capability of its own.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `editor` plugin.

| | |
| --- | --- |
| Version | `0.4.2` |
| Requires core | `0.28.42` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Tools

This plugin provides no model tools. It works through web interface API routes for file editing, previews and Git history instead.

## Configuration

The manifest declares no settings fields. Disabling the plugin removes the editor UI and its file API, while project registration and task Git history remain available.

## Documentation

See the "Code Tools" page of the Elowen user manual (`docs/site/39-code-tools.md` in the Elowen repository).