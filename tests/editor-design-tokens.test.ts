import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const registryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const editorSourcesRoot = resolve(registryRoot, 'plugins/editor/web-src');
const editorAuthoredCssPath = resolve(editorSourcesRoot, 'editor.css');
const editorCssPath = resolve(registryRoot, 'plugins/editor/web/index.css');

function editorSources(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = resolve(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry)) files.push(path);
    }
  };
  walk(editorSourcesRoot);
  return files.sort();
}

function sourceOffenders(check: (line: string) => string[]): string[] {
  const offenders: string[] = [];
  for (const file of editorSources()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      for (const utility of check(line)) {
        offenders.push(`${relative(registryRoot, file)}:${index + 1} ${utility}`);
      }
    });
  }
  return offenders;
}

const RETIRED = /\b(?:bg-bg(?:\/\d+)?|bg-surface|bg-elevated|bg-document|text-text(?:-muted)?|text-danger|bg-text-muted|bg-black|bg-white)\b/g;
const COMPAT_VAR = /var\(--(?:color-)?(?:bg|surface|text|text-muted|danger)\b/g;
const BRAND_ACCENT = /(?:^|[\s'"])((?:text|fill|ring)-accent)(?=$|[\s'"])/g;
const ACCENT_ALPHA = /\bbg-accent\/\d+\b/g;
const BARE_ACCENT = /(?:^|[\s'"])(bg-accent)(?=$|[\s'"])/g;

describe('Editor design-token contract', () => {
  it('uses the current semantic utility vocabulary', () => {
    const offenders = sourceOffenders((line) => [
      ...(line.match(RETIRED) ?? []),
      ...(line.match(COMPAT_VAR) ?? []),
    ]);
    expect(offenders).toEqual([]);
  });

  it('reserves accent for neutral interactive washes, not brand state', () => {
    const offenders = sourceOffenders((line) => {
      const found = [
        ...Array.from(line.matchAll(BRAND_ACCENT), (match) => match[1]),
        ...(line.match(ACCENT_ALPHA) ?? []),
      ];
      const bare = Array.from(line.matchAll(BARE_ACCENT), (match) => match[1]);
      if (bare.length > 0 && !line.includes('text-accent-foreground')) found.push(...bare);
      return found;
    });
    expect(offenders).toEqual([]);
  });

  it('owns the wide page and hover scrollbar as authored plugin CSS', () => {
    const css = readFileSync(editorAuthoredCssPath, 'utf8');
    expect(css).toContain('.workspace-page.editor-workspace-page');
    expect(css).toContain('max-width: min(max(var(--content-max), 80%), 118rem)');
    expect(css).toContain('.editor-file-tree-scroll:is(:hover, :focus-within)');
    expect(css).toContain('@media (hover: hover) and (pointer: fine)');
  });

  it('ships CSS against the current semantic token contract', () => {
    const css = readFileSync(editorCssPath, 'utf8');
    const legacyVariables = css.match(/--color-(?:bg|text(?:-muted)?|surface|elevated|danger)\b/g) ?? [];
    const legacyFallbacks = [
      'var(--color-bg, #000000)',
      'var(--color-surface, #070707)',
      'var(--color-elevated, #0d0d0d)',
      'var(--color-text, #f7f3f0)',
      'var(--color-text-muted, #9d948e)',
      'var(--color-danger, #e94d42)',
      'var(--color-accent, #ff5236)',
    ].filter((fallback) => css.includes(fallback));
    expect([...legacyVariables, ...legacyFallbacks]).toEqual([]);

    for (const token of [
      '--color-background', '--color-foreground', '--color-card', '--color-muted',
      '--color-muted-foreground', '--color-accent', '--color-accent-foreground',
      '--color-primary', '--color-destructive',
    ]) {
      expect(css, `missing shipped semantic token ${token}`).toContain(`var(${token}`);
    }
  });
});
