---
title: Language Server (LSP)
slug: lsp-plugin
order: 39
eyebrow: Plugin reference
group: Plugin reference
---

# Language Server (LSP)

LSP checks files and answers code questions using language servers rather than text search. After Elowen edits a file, it checks in the background and gives new diagnostics to the model on its next turn. The first check starts the server. Disabling the plugin stops its servers.

Install `lsp` from **Settings → Plugins → Available**. It requires Elowen 0.28.53 or later. Project and tool permissions still apply. Check the registry for the plugin's current version and minimum Elowen version.

The plugin has no main navigation page or account panel. In a conversation, **LSP** in the chat rail shows whether live diagnostics are active; use `/lsp` to see server status and toggle diagnostics.

| Tool | What it does |
| --- | --- |
| `LspDiagnostics` | Checks a file and returns errors and warnings with line and column positions. |
| `LspGoToDefinition` | Finds a symbol's definition. |
| `LspFindReferences` | Lists references to a symbol. |
| `LspHover` | Shows a symbol's type and documentation. |
| `LspDocumentSymbol` | Lists a file's functions, classes and variables. |
| `LspWorkspaceSymbol` | Searches symbols by name in the current workspace. |

All six tools are read-only and safe in plan mode.

## Servers and setup

Elowen supports language servers for TypeScript/JavaScript, Python, Go, Rust, Ruby, PHP, C/C++, Lua, YAML and Bash. It uses its own install folder before checking PATH. Missing servers are skipped for that language.

Elowen can install the npm-based servers itself: TypeScript, Pyright, Intelephense, YAML and Bash language servers. Install other servers with their language toolchains. The setup wizard offers the TypeScript server; administrators can install or remove servers in the `/lsp` dialog or through the plugin's API. The status route is also available to ordinary users. In managed Projects, servers run in that Project's environment, separately for each account.

## Configuration and limits

| Setting | Key | Default | Purpose |
| --- | --- | --- | --- |
| Live diagnostics | `diagnosticsEnabled` | `true` | Checks edits. Turning it off stops running servers; tools remain listed and report that LSP is off. The `/lsp` command changes this setting. |
| Server idle time (minutes) | `idleTtlMinutes` | 10 | How long an idle server stays ready. Set to 0 to keep it running until the pool fills or LSP is turned off. |

After-edit checks are best effort and cover Elowen's own Write and Edit operations; external edits are checked only when a tool asks. Results are retained for up to 20 recently edited files in each of 50 recent sessions. Files without a matching language server are skipped. In a managed Project, the environment also bounds a server session to 15 minutes. The TypeScript language server uses TypeScript 5.x.

[Next: Codebase](codebase-plugin)
