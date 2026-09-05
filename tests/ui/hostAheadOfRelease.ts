/** What the daemon's MAIN branch already has and the `elowen` release this repo pins does not.
 *
 *  Both parity guards (tests/hostRuntimeParity.test.ts, tests/hostDictionaryParity.test.ts) hold the
 *  stand-ins in tests/ui/* to the INSTALLED package, because CI has the package and nothing else. That
 *  is the right truth for a stand-in — except while this repository is deliberately built against a host
 *  change that has not been released yet. Core 0.28.31 ships API 16, including the host-owned
 *  `ProjectIcon` primitive. No runtime or dictionary additions currently need an exemption.
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
 * sides. */
export const AHEAD_OF_RELEASE_RUNTIME: { components: string[]; hooks: string[]; utils: string[] } = {
  components: [],
  hooks: [],
  utils: [],
};

/** Host dictionary leaves added after the pinned release, as flattened `section.key` paths. */
export const AHEAD_OF_RELEASE_DICTIONARY: string[] = [];

/** The plugin UI API version targeted by the stand-in, shipped by core 0.28.31. */
export const AHEAD_OF_RELEASE_API_VERSION = 16;
