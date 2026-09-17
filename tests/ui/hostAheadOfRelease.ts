/** What the daemon's MAIN branch already has and the `elowen` release this repo pins does not.
 *
 *  Both parity guards (tests/hostRuntimeParity.test.ts, tests/hostDictionaryParity.test.ts) hold the
 *  stand-ins in tests/ui/* to the INSTALLED package, because CI has the package and nothing else. That
 *  is the right truth for a stand-in — except while this repository is deliberately built against a host
 *  change that has not been released yet. Core 0.28.47 ships API 17, the host-owned `Calendar`
 *  primitive and the current project copy, so as of that release NOTHING is exempt: both lists
 *  below are empty and every name a stand-in carries has to exist in the installed package.
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
  // `Progress` arrived with the same seam batch: the host publishes the plain determinate meter from
  // web/lib/pluginUi.tsx and the pinned release predates it. The todo rail section draws its done/total
  // bar with it, and now the card draws the same meter, so the stand-in has to carry it. Delete when the
  // devDependency moves to the release that ships it.
  components: ['Progress'],
  // The session-task hooks arrived with the seam batch that moved the task surfaces out of the core and
  // into this repository's `todo` plugin: the core publishes all four from web/lib/pluginUi.tsx and the
  // pinned 0.28.47 predates them. They are what TasksPicker/TasksRail/TodoCard read, so the stand-in has
  // to carry them or those components cannot be rendered in a test at all. Delete these four when the
  // devDependency moves to the release that ships them — the guard fails until they are removed.
  hooks: [
    'useProjectEnvironmentState',
    'useSessionTasks', 'useUpdateSessionTask', 'useDeleteSessionTask', 'useClearSessionTasks',
  ],
  // The card-preview rule and its cap. The todo card used to keep its own copy of "which four rows a
  // card shows"; the host now publishes the one the CLI panel and the host's own card run, and the
  // bundle reads it from `runtime().utils` so `slice(0, 4)` cannot come back. Delete both when the
  // devDependency moves to the release that ships them.
  utils: ['TODO_PREVIEW_ITEMS', 'todoPreviewItems'],
};

/** Host dictionary leaves added after the pinned release, as flattened `section.key` paths. */
export const AHEAD_OF_RELEASE_DICTIONARY: string[] = [];

/** The plugin UI API version targeted by the stand-in. The todo card requires it: it draws its rows
 *  through `utils.todoPreviewItems`, which the in-development core publishes under API 18, so a host
 *  stamped lower refuses the bundle and keeps rendering its own card. */
export const AHEAD_OF_RELEASE_API_VERSION = 18;
