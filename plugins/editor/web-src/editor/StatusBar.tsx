'use client';
import { Circle } from 'lucide-react';
import type { CursorState } from './EditorPane';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) { value /= 1024; unit = units[i]; }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

/** The strip along the bottom of the editor.
 *
 *  Monaco ships no status bar — it is one of the things VS Code builds AROUND the editor — and its
 *  absence is a good part of why the pane read as a viewer: nothing on screen answered "where am I in
 *  this file", which is the question an editor is always able to answer. */
export function StatusBar({ path, cursor, language, tabSize, size, dirty, labels }: {
  path: string;
  cursor: CursorState | null;
  language: string;
  tabSize: number;
  size: number;
  dirty: boolean;
  labels: { line: string; column: string; selected: string; spaces: string; unsaved: string };
}) {
  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-background px-3 text-[11px] text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5">
        {dirty ? <Circle size={7} className="shrink-0 fill-warning text-warning" aria-label={labels.unsaved} /> : null}
        <span className="truncate font-mono" title={path}>{path}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-3 tabular-nums">
        {cursor ? (
          <span>
            {labels.line} {cursor.line}, {labels.column} {cursor.column}
            {cursor.selected > 0 ? <span className="text-primary"> ({cursor.selected} {labels.selected})</span> : null}
          </span>
        ) : null}
        <span>{labels.spaces}: {tabSize}</span>
        <span>{formatBytes(size)}</span>
        <span className="font-medium uppercase text-foreground">{language}</span>
      </span>
    </div>
  );
}
