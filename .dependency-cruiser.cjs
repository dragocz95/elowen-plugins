const { existsSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const root = __dirname;
const pluginsDir = join(root, 'plugins');
const pluginNames = readdirSync(pluginsDir)
  .filter((name) => statSync(join(pluginsDir, name)).isDirectory())
  .filter((name) => existsSync(join(pluginsDir, name, 'elowen-plugin.json')))
  .sort();

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Architecture guard for a registry of independently installed plugins.
 * Rules are generated from plugins/* so a newly added plugin is isolated immediately.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make a plugin harder to load, test and publish independently.',
      from: {},
      to: { circular: true },
    },
    ...pluginNames.map((name) => {
      const pluginPath = `plugins/${escapeRegex(name)}/`;
      return {
        name: `${name}-not-to-sibling-plugin`,
        severity: 'error',
        comment: `Plugin ${name} must be self-contained; shared runtime code belongs in elowen-plugin-shared.`,
        from: { path: `^${pluginPath}` },
        // The registry-only auto-save ABI is type-only; it is erased from every bundle and is not shared runtime code.
        to: { path: '^plugins/', pathNot: `^${pluginPath}|^plugins/autoSaveContract\.ts$` },
      };
    }),
    {
      name: 'plugin-not-to-test-or-script',
      severity: 'error',
      comment: 'Published plugin code must not depend on repository test or build harnesses.',
      from: { path: '^plugins/' },
      to: { path: '^(tests|scripts)/' },
    },
    {
      name: 'no-test-in-production',
      severity: 'error',
      comment: 'Production modules must never import test files.',
      from: { pathNot: '(^|/)tests?/|\\.(test|spec)\\.' },
      to: { path: '(^|/)tests?/|\\.(test|spec)\\.' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: 'node_modules|/dist/|/web/|/coverage/' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    },
  },
};
