# codebase

Builds a semantic index of the repositories the instance can reach and lets the agent search that code by meaning instead of literal text, refresh the index and check its coverage.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `codebase` plugin.

| | |
| --- | --- |
| Version | `0.1.4` |
| Requires core | `0.28.35` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Tools

`CodebaseSearch` answers a natural-language query with the most relevant code or documentation chunks. `CodebaseReindex` refreshes a repository's index, incrementally or in full. `CodebaseStatus` reports how much of each repository is indexed and whether the index is current.

## Configuration

No field is required. The 13 optional settings tune indexing scope and chunking with `includeGlobs`, `excludeGlobs`, `maxFileBytes` and `chunkMaxChars`, search behavior with `topK`, `relevanceFloor`, `autoReindex` and `reindexEmbedBudget`, and an optional scheduled re-index pass with `scheduledReindex` and its interval and scope fields. The embedding model is inherited from the memory settings rather than configured here. No field is a secret.

## Documentation

See the "Code Tools" page of the Elowen user manual (`docs/site/39-code-tools.md` in the Elowen repository).