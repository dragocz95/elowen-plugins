/** What the daemon's MAIN branch already has and the `elowen` release this repo pins does not.
 *
 *  Both parity guards (tests/hostRuntimeParity.test.ts, tests/hostDictionaryParity.test.ts) hold the
 *  stand-ins in tests/ui/* to the INSTALLED package, because CI has the package and nothing else. That
 *  is the right truth for a stand-in — except while this repository is deliberately built against a host
 *  change that has not been released yet. The plugin-UI redesign is exactly that case: it targets
 *  PLUGIN_UI_API_VERSION 12, and the pinned elowen 0.28.17 / elowen-plugin-ui-kit 0.5.0 still ship 6.
 *
 *  So the guards allow a stand-in to carry these names — and NOTHING else the package lacks. Every entry
 *  is a promise about the host, not a free pass: each guard also asserts that the package does NOT have
 *  the name, so bumping the devDependency to a release that carries it FAILS until the entry is deleted.
 *  The list can therefore only shrink, and it cannot rot into a permanent exemption.
 *
 *  What it deliberately CANNOT check is the shape behind a name: the runtime surface is published as a
 *  minified bundle and as `elowen-plugin-ui-kit`'s `ElowenUiRuntime`, whose `components`, `hooks` and
 *  `utils` are `Record<string, …>` — names travel, props do not. A primitive listed here is verified by
 *  eye against the daemon working copy and by the plugin bundles' own suites until it ships. */

/** Runtime primitives added after the pinned release. Names only — the maps are untyped records on both
 * sides. Elowen 0.28.17 already ships the register/page-shell primitives, so no runtime exemption remains. */
export const AHEAD_OF_RELEASE_RUNTIME: { components: string[]; hooks: string[]; utils: string[] } = {
  components: [],
  hooks: [],
  utils: [],
};

/** Host dictionary leaves added after 0.28.17, as flattened `section.key` paths. */
export const AHEAD_OF_RELEASE_DICTIONARY = ['projects.detailTitle'];

/** The plugin UI API version the daemon's main branch and the pinned package both declare. */
export const AHEAD_OF_RELEASE_API_VERSION = 12;
