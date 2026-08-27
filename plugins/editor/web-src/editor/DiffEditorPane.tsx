'use client';
import { MonacoDiffEditor } from './monacoLoader';
import { langOf } from './helpers';
import { runtime } from '../runtime';
import { diffOptions, type EditorPrefs } from './editorOptions';

/** Native Monaco side-by-side diff: original (file at HEAD) vs modified (working content). Read-only. */
export function DiffEditorPane({ path, original, modified, prefs }: {
  path: string; original: string; modified: string; prefs: EditorPrefs;
}) {
  return (
    <MonacoDiffEditor
      key={path}
      height="100%"
      theme={runtime().utils.editorTheme()}
      beforeMount={runtime().utils.defineEditorThemes}
      language={langOf(path)}
      original={original}
      modified={modified}
      options={diffOptions(prefs)}
    />
  );
}
