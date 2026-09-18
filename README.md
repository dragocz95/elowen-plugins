# elowen-plugins

The plugin marketplace registry for [Elowen](https://github.com/dragocz95/elowen). Elowen's plugin
marketplace (Settings → Plugins → Available) reads `registry.json` from this repo and installs plugins
from `plugins/<name>/` on one click.

## Layout

```
registry.json        # the catalog index
plugins/<name>/      # one folder per plugin: elowen-plugin.json + index.mjs + optional i18n/
                     #   web-src/  optional browser-UI sources (TS/React)
                     #   web/index.js  the BUILT bundle — committed, see below
scripts/build-web.mjs
tests/               # node:test suites, one file per plugin
```

Each catalog entry in `registry.json` carries display metadata (name, version, description, category,
author). The authoritative manifest is each plugin's own `elowen-plugin.json`.

## Working on a plugin

```bash
npm ci
npm test            # every plugin's suite
npm run build:web   # rebuild browser bundles (add a plugin name to build just one)
npm run check       # what CI runs: bundle drift + tests
```

A plugin runs inside the Elowen daemon, so it does not bundle its runtime dependencies: the installer
symlinks the host's `node_modules` into the installed plugin, and bare imports resolve from there. That
covers the daemon's own SDK (`@earendil-works/pi-coding-agent`, `typebox`) and the shared plugin helpers
in [`elowen-plugin-shared`](https://www.npmjs.com/package/elowen-plugin-shared). The versions here are
development-time only — at runtime a plugin gets whatever the host daemon ships.

### Browser UI

A plugin with a `web-src/index.tsx` gets it bundled to `web/index.js` by
[`elowen-plugin-ui-kit`](https://www.npmjs.com/package/elowen-plugin-ui-kit). **That built file is
committed**, because the marketplace installs a plugin by copying files and compiles nothing — the
committed bundle is what users actually run. `npm run check:web` rebuilds it and fails on any diff, so a
bundle can never quietly stop matching its source. Rerun `npm run build:web` and commit the result
whenever you touch `web-src/`.

React is not bundled: the kit aliases it to the host's instance on `window.ElowenUiRuntime`, so a plugin
UI can never ship a second React.

## Plugins

Each `plugins/<name>/` folder is one catalog entry; `registry.json` is the authoritative, up-to-date list
of what this repo ships, with each entry's description, category and version. Browse it there, or in a
running Elowen instance under Settings → Plugins → Available. Note that some bundled Elowen features
(for example web research and MCP bridging) ship with the core daemon itself and are not part of this
registry.
