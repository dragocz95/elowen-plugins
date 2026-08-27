'use client';
import { useRef } from 'react';
import { MonacoEditor } from './monacoLoader';
import { langOf } from './helpers';
import { runtime } from '../runtime';
import { editorOptions, type EditorPrefs } from './editorOptions';

/** Where the caret is, and how much is under selection — the status bar's whole input. */
export interface CursorState { line: number; column: number; selected: number }

/** Monaco editor for one file. Cmd/Ctrl+S saves (always the latest handler via a ref, so the
 *  keybinding never goes stale). */
export function EditorPane({ path, value, onChange, onSave, prefs, onCursor }: {
  path: string; value: string; onChange: (v: string) => void; onSave: () => void;
  prefs: EditorPrefs; onCursor?: (state: CursorState) => void;
}) {
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const cursorRef = useRef(onCursor);
  cursorRef.current = onCursor;
  return (
    <MonacoEditor
      key={path}
      height="100%"
      theme={runtime().utils.editorTheme()}
      beforeMount={runtime().utils.defineEditorThemes}
      onMount={(editor: any, monaco: any) => {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
        // Report both the caret and the size of the selection. Monaco fires the two as separate
        // events, and the status bar wants them as one reading, so selection length is recomputed
        // from the live model on each — cheaper than tracking two pieces of state that can disagree.
        const report = () => {
          const position = editor.getPosition();
          const selection = editor.getSelection();
          const selected = selection && !selection.isEmpty()
            ? editor.getModel()?.getValueInRange(selection).length ?? 0
            : 0;
          if (position) cursorRef.current?.({ line: position.lineNumber, column: position.column, selected });
        };
        editor.onDidChangeCursorPosition(report);
        editor.onDidChangeCursorSelection(report);
        report();
      }}
      language={langOf(path)}
      value={value}
      onChange={(v: string | undefined) => onChange(v ?? '')}
      options={editorOptions(prefs)}
    />
  );
}
