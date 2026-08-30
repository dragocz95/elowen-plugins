// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const registryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugins = ['msteams', 'whatsapp'] as const;
const legacyUtility = /\b(?:bg-(?:bg|surface(?:-2)?|elevated|overlay)|text-(?:text(?:-muted|-subtle)?|danger)|(?:border|ring)-(?:accent))(?:\/\d+)?\b/g;
const legacyVariable = /--color-(?:bg|surface(?:-2)?|elevated|overlay|text(?:-muted|-subtle)?|danger)\b/g;

function sourceFiles(plugin: typeof plugins[number]): string[] {
  const root = resolve(registryRoot, 'plugins', plugin, 'web-src');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = resolve(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry)) files.push(path);
    }
  };
  walk(root);
  return files.sort();
}

function matches(pattern: RegExp, text: string): string[] {
  pattern.lastIndex = 0;
  return text.match(pattern) ?? [];
}

describe.each(plugins)('%s marketplace UI theme semantics', (plugin) => {
  it('uses the UI kit 0.6 semantic utility vocabulary in source', () => {
    const offenders = sourceFiles(plugin).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return text.split('\n').flatMap((line, index) =>
        matches(legacyUtility, line).map((token) => `${relative(registryRoot, file)}:${index + 1} ${token}`));
    });

    expect(offenders).toEqual([]);
  });

  it('ships CSS without removed legacy color variables', () => {
    const css = readFileSync(resolve(registryRoot, 'plugins', plugin, 'web', 'index.css'), 'utf8');
    expect(matches(legacyVariable, css)).toEqual([]);
  });
});

it('ships the semantic tokens each migrated platform UI renders', () => {
  const teamsCss = readFileSync(resolve(registryRoot, 'plugins/msteams/web/index.css'), 'utf8');
  for (const token of ['card', 'foreground', 'muted', 'muted-foreground', 'subtle-foreground', 'destructive', 'primary', 'accent']) {
    expect(teamsCss).toContain(`--color-${token}`);
  }

  const whatsappCss = readFileSync(resolve(registryRoot, 'plugins/whatsapp/web/index.css'), 'utf8');
  for (const token of ['foreground', 'muted-foreground', 'destructive']) {
    expect(whatsappCss).toContain(`--color-${token}`);
  }
});
