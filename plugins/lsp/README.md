# lsp

Language-server code intelligence for diagnostics, definitions, references, hover information and document or workspace symbols.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `lsp` plugin.

This plugin's version, minimum core version and shared-API requirement are stated in `elowen-plugin.json` in this folder and published in `registry.json`; they are deliberately kept out of this file so it cannot go stale.

## Tools

LspDiagnostics, LspGoToDefinition, LspFindReferences, LspHover, LspDocumentSymbol, LspWorkspaceSymbol.

## Configuration

diagnosticsEnabled, idleTtlMinutes.

## Documentation

See the [lsp page in the Elowen user manual](https://github.com/dragocz95/elowen/blob/main/docs/site/39-code-tools.md).
