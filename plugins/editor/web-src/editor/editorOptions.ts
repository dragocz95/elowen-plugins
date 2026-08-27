/** The one Monaco option table both panes use.
 *
 *  Monaco standalone starts far plainer than the VS Code most people picture when they hear "the VS
 *  Code editor": the minimap, sticky scroll, bracket colouring and indent guides that make it READ as
 *  an editor are all things VS Code turns on around the library, not defaults the library ships. With
 *  them off it renders as a competent syntax-highlighted textarea, which is exactly what it looked
 *  like here.
 *
 *  It lives in its own module because the editor and the diff sat on two hand-written option objects
 *  that had already drifted, so the same file looked like two different products depending on which
 *  tab was open. */

export interface MonacoOptions { [key: string]: unknown }

/** Fed from the user's own preferences, so this stays a pure function of them. */
export interface EditorPrefs {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  minimap: boolean;
}

export const DEFAULT_PREFS: EditorPrefs = { fontSize: 13, tabSize: 2, wordWrap: false, minimap: true };

export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;
export const TAB_SIZES = [2, 4, 8] as const;

/** Clamp anything restored from storage: a stored preference is user-controlled input, and a font size
 *  of 0 or 900 would leave the editor unusable with no way back to the control that caused it. */
export function normalisePrefs(raw: unknown): EditorPrefs {
  const value = (raw ?? {}) as Partial<Record<keyof EditorPrefs, unknown>>;
  const size = Number(value.fontSize);
  const tab = Number(value.tabSize);
  return {
    fontSize: Number.isFinite(size) ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size))) : DEFAULT_PREFS.fontSize,
    tabSize: (TAB_SIZES as readonly number[]).includes(tab) ? tab : DEFAULT_PREFS.tabSize,
    wordWrap: typeof value.wordWrap === 'boolean' ? value.wordWrap : DEFAULT_PREFS.wordWrap,
    minimap: typeof value.minimap === 'boolean' ? value.minimap : DEFAULT_PREFS.minimap,
  };
}

export function editorOptions(prefs: EditorPrefs): MonacoOptions {
  return {
    fontSize: prefs.fontSize,
    tabSize: prefs.tabSize,
    wordWrap: prefs.wordWrap ? 'on' : 'off',
    minimap: { enabled: prefs.minimap, renderCharacters: false, maxColumn: 90 },

    // The affordances that carry the "this is an editor" impression.
    stickyScroll: { enabled: true },
    bracketPairColorization: { enabled: true },
    guides: { indentation: true, bracketPairs: 'active' },
    renderLineHighlight: 'all',
    occurrencesHighlight: 'singleFile',
    selectionHighlight: true,
    matchBrackets: 'always',
    folding: true,
    foldingHighlight: true,
    showFoldingControls: 'mouseover',
    glyphMargin: true,
    lineNumbersMinChars: 3,
    renderWhitespace: 'selection',

    // Movement. Smooth caret and scrolling are the difference between "a text box updated" and "an
    // editor responded"; both are cheap and both are off by default in standalone Monaco.
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    mouseWheelZoom: true,

    // A scrollbar sized to be grabbed, and an overview ruler that actually reports something.
    scrollbar: { verticalScrollbarSize: 12, horizontalScrollbarSize: 12, useShadows: false },
    overviewRulerBorder: false,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    padding: { top: 10, bottom: 10 },
    fontLigatures: true,
    roundedSelection: false,
    // Monaco has no language services here, so word-based suggestions are all it can honestly offer.
    // Left on: inside one file they are genuinely useful, and quiet when they have nothing to say.
    quickSuggestions: { other: true, comments: false, strings: false },
    suggestSelection: 'first',
    tabCompletion: 'on',
  };
}

/** The diff is read-only and side-by-side, and drops the parts that only make sense while typing. */
export function diffOptions(prefs: EditorPrefs): MonacoOptions {
  return {
    ...editorOptions(prefs),
    readOnly: true,
    renderSideBySide: true,
    // Whitespace-only changes are real changes when reviewing a file you are about to save.
    ignoreTrimWhitespace: false,
    stickyScroll: { enabled: false },
    quickSuggestions: false,
    occurrencesHighlight: 'off',
  };
}
