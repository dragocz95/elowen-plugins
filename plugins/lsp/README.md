# lsp

Answers code questions through the real language server for the file: it type-checks edits as they land, resolves definitions and references, reads hover signatures and lists document and workspace symbols.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `lsp` plugin.

| | |
| --- | --- |
| Version | `0.2.0` |
| Requires core | `0.28.35` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Tools

`LspDiagnostics` type-checks a file through its language server. `LspGoToDefinition`, `LspFindReferences` and `LspHover` locate and inspect a symbol. `LspDocumentSymbol` and `LspWorkspaceSymbol` list symbols in one file or across the workspace.

## Configuration

Two optional fields, neither secret. `diagnosticsEnabled` turns live diagnostics on or off. `idleTtlMinutes` (0-240, default 10) is how long a language server stays warm after its last check; the pool also drops a server whose project root has gone away, whatever this is set to, and `0` turns age eviction off. Disabling the plugin stops every language server and withdraws the tools.

## Documentation

See the "Code Tools" page of the Elowen user manual (`docs/site/39-code-tools.md` in the Elowen repository).