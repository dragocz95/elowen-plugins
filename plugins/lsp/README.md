# lsp

Answers code questions through the real language server for the file: it type-checks edits as they land, resolves definitions and references, reads hover signatures and lists document and workspace symbols.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `lsp` plugin.

| | |
| --- | --- |
| Version | `0.1.5` |
| Requires core | `0.28.35` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Tools

`LspDiagnostics` type-checks a file through its language server. `LspGoToDefinition`, `LspFindReferences` and `LspHover` locate and inspect a symbol. `LspDocumentSymbol` and `LspWorkspaceSymbol` list symbols in one file or across the workspace.

## Configuration

The single setting is the optional boolean `diagnosticsEnabled`, which turns live diagnostics on or off. No field is required and none is secret; disabling the plugin stops every language server and withdraws the tools.

## Documentation

See the "Code Tools" page of the Elowen user manual (`docs/site/39-code-tools.md` in the Elowen repository).