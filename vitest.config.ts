import { defineConfig } from 'vitest/config';

/** The browser-UI runner. A plugin that ships `web-src/` renders inside the host app in production, so
 *  its tests render it the same way: in jsdom, against a `window.ElowenUiRuntime` (tests/ui/hostRuntime)
 *  rather than against imports from the app — which is exactly the boundary the built bundle runs on.
 *
 *  Node-side plugin tests stay on `node --test` (npm run test:node); `npm test` runs BOTH. */
export default defineConfig({
  // The plugin sources are .tsx and are only TRANSPILED here (automatic JSX runtime, vitest's default),
  // never type-checked: the bundle's type contract is checked by its own web-src/tsconfig.json at build
  // time, against the same elowen-plugin-ui-kit types plugin authors compile against.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/ui/setup.ts'],
    include: ['tests/**/*.test.tsx'],
  },
});
