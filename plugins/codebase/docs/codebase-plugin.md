---
title: Semantic Code Search (Codebase)
slug: codebase-plugin
order: 58
eyebrow: Plugin reference
group: Plugin reference
---

# Semantic Code Search (Codebase)

Codebase builds a private index for each accessible repository. It embeds source and Markdown chunks with the model configured in **Settings → Memory**; the files plugin's literal Search is better when you know the exact text. Search results stay within repositories the current session can access. Only embedding requests go to the configured provider.

Install `codebase` from **Settings → Plugins → Available**. It requires Elowen 0.28.50 or later. Project and tool permissions still apply. Check the registry for the plugin's current version and minimum Elowen version.

| Tool | What it does |
| --- | --- |
| `CodebaseSearch` | Searches by a natural-language query and returns relevant code or documentation snippets with file paths and line numbers. |
| `CodebaseReindex` | Builds or refreshes the index. Incremental by default; a full rebuild re-embeds every file. |
| `CodebaseStatus` | Shows indexed file and chunk counts, last index time, embedding model and whether the index is stale. |

Search returns up to 50 results and drops matches below the relevance floor. Empty results mean no match scored high enough, not that the file is absent. You can limit a search to one accessible repository and a path pattern such as `src/**/*.ts`.

## What gets indexed

By default, common source and documentation formats are included: TypeScript, JavaScript, Python, Go, Rust, Java, Ruby, PHP, C/C++, C#, Kotlin, Scala, Swift, shell, SQL, Vue, Svelte, CSS, Markdown/MDX, JSON, YAML and TOML. You can set include and exclude patterns in the plugin's settings.

## Index refresh and settings

A refresh embeds at most 200 chunks by default. Larger repositories may need several passes. Automatic refresh on search is on by default and runs at most once per repository every five minutes. It works only in a session with full access; Project-scoped sessions must run `CodebaseReindex` explicitly.

Scheduled refresh is off by default. Turn it on to refresh repositories in the index or selected repository paths at an interval. A scheduled run makes up to four passes per repository by default. These background runs use the embedding provider.

| Setting | Key | Default | Purpose |
| --- | --- | --- | --- |
| Include globs | `includeGlobs` | not set | File patterns to include; empty uses built-in source and Markdown extensions. |
| Exclude globs / dirs | `excludeGlobs` | not set | Patterns or directory names to skip. Empty uses built-in exclusions, including `node_modules`, `dist`, `.git` and `.venv`. |
| Max file size (bytes) | `maxFileBytes` | 300000 | Larger files and likely minified files are skipped. |
| Chunk size (characters) | `chunkMaxChars` | 1500 | Maximum chunk length, preferably split at a blank line. |
| Results per search | `topK` | 8 | Default result count; the `k` argument overrides it. |
| Relevance floor | `relevanceFloor` | 0.3 | Minimum similarity score returned. |
| Auto-reindex on search | `autoReindex` | `true` | Lazily refresh an empty or stale index on search. |
| Embeddings per pass | `reindexEmbedBudget` | 200 | Maximum chunks embedded in one pass. |
| Re-index on a schedule | `scheduledReindex` | `false` | Refresh the index on a timer. |
| Interval (minutes) | `reindexIntervalMinutes` | 60 | Scheduled refresh interval. |
| Which repositories | `reindexScope` | `indexed` | Refresh all indexed repositories or only listed paths. |
| Repository paths | `reindexRepos` | not set | Full paths used when scope is `listed`. |
| Passes per repository per tick | `reindexMaxPassesPerRepo` | 4 | Maximum passes in one scheduled run. |

A repository can contain up to 20,000 indexed files. Files with a line longer than 5,000 characters are skipped. Search snippets are limited to six lines and 400 characters. Changing the embedding model in **Settings → Memory** makes old indexes stale; reindex them before searching.

For the shared embedding model, see [Memory & Embeddings](memory).

[Next: Editor](editor-plugin)
