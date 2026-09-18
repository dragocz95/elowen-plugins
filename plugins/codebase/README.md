# codebase

Semantic code index: search your repositories by meaning instead of literal text. It indexes accessible code and documentation with the same embedding model used by memory, and reports coverage.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `codebase` plugin.

This plugin's version, minimum core version and shared-API requirement are stated in `elowen-plugin.json` in this folder and published in `registry.json`; they are deliberately kept out of this file so it cannot go stale.

## Tools

CodebaseSearch, CodebaseReindex, CodebaseStatus.

## Configuration

includeGlobs, excludeGlobs, maxFileBytes, chunkMaxChars, topK, relevanceFloor, autoReindex, reindexEmbedBudget, scheduledReindex, reindexIntervalMinutes, reindexScope, reindexRepos, reindexMaxPassesPerRepo.

## Documentation

See the [codebase page in the Elowen user manual](https://github.com/dragocz95/elowen/blob/main/docs/site/39-code-tools.md).
