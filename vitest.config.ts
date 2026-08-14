import { defineConfig } from 'vitest/config';

/** The browser-UI runner. A plugin that ships `web-src/` renders inside the host app in production, so
 *  its tests render it the same way: in jsdom, against a `window.ElowenUiRuntime` (tests/ui/hostRuntime)
 *  rather than against imports from the app — which is exactly the boundary the built bundle runs on.
 *
 *  It also runs the `.test.ts` suites that came WITH a plugin adopted from the Elowen package. Those were
 *  written against the daemon's real plugin loader and are kept verbatim rather than rewritten for
 *  `node --test`: rewriting hundreds of assertions by hand is how coverage quietly gets lost. They load
 *  the loader from the published `elowen` devDependency, so they check the plugin against the same host
 *  code an installed instance runs — and each one opts into the node environment with a
 *  `@vitest-environment node` docblock.
 *
 *  Plugin tests written HERE stay on `node --test` (npm run test:node); `npm test` runs both runners. */
export default defineConfig({
  // The plugin sources are .tsx and are only TRANSPILED here (automatic JSX runtime, vitest's default),
  // never type-checked: the bundle's type contract is checked by its own web-src/tsconfig.json at build
  // time, against the same elowen-plugin-ui-kit types plugin authors compile against. The adopted .ts
  // suites are transpiled the same way — their types were checked in the package they came from.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/ui/setup.ts'],
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
  },
});
