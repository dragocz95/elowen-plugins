# orcasynth-plugins

The plugin marketplace registry for [Orca](https://github.com/dragocz1995/orcasynth). Orca's plugin
marketplace (Settings → Plugins → Available) reads `registry.json` from this repo and installs plugins
from `plugins/<name>/` on one click.

## Layout

```
registry.json        # the catalog index
plugins/<name>/      # one folder per plugin: orca-plugin.json + index.mjs + optional i18n/
```

Each catalog entry in `registry.json` carries display metadata (name, version, description, category,
author). The authoritative manifest is each plugin's own `orca-plugin.json`.

## Plugins

- **todo** — the agent keeps a live todo checklist for multi-step work and shows it to you as it goes.
- **mem0** — long-term memory backed by a self-hosted [mem0](https://github.com/mem0ai/mem0) server;
  the brain saves durable facts and recalls them across conversations.
