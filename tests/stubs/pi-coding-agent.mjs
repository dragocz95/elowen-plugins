export const defineTool = (definition) => definition;

// ── truncation helpers ───────────────────────────────────────────────────────────────────────────────
// Faithful ports of the host package's `truncateHead` / `truncateLine` (core/tools/truncate.ts). The
// codebase plugin renders every search snippet through them, and the byte-aware / never-split-a-
// multibyte-char behaviour is what its snippet test actually asserts — a looser stand-in would make that
// assertion vacuous.

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024;
const GREP_MAX_LINE_LENGTH = 500;

function splitLinesForCounting(content) {
  if (content.length === 0) return [];
  const lines = content.split('\n');
  if (content.endsWith('\n')) lines.pop();
  return lines;
}

/** Keep the first N lines/bytes, never returning a partial line. When the FIRST line alone exceeds the
 *  byte limit the content comes back empty with `firstLineExceedsLimit: true` — the caller is expected to
 *  fall back to that raw line rather than render nothing. */
export function truncateHead(content, options = {}) {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const totalBytes = Buffer.byteLength(content, 'utf-8');
  const lines = splitLinesForCounting(content);
  const totalLines = lines.length;

  const base = { totalLines, totalBytes, lastLinePartial: false, maxLines, maxBytes };

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      ...base,
      content,
      truncated: false,
      truncatedBy: null,
      outputLines: totalLines,
      outputBytes: totalBytes,
      firstLineExceedsLimit: false,
    };
  }

  if (Buffer.byteLength(lines[0], 'utf-8') > maxBytes) {
    return {
      ...base,
      content: '',
      truncated: true,
      truncatedBy: 'bytes',
      outputLines: 0,
      outputBytes: 0,
      firstLineExceedsLimit: true,
    };
  }

  const kept = [];
  let keptBytes = 0;
  let truncatedBy = 'lines';
  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const lineBytes = Buffer.byteLength(lines[i], 'utf-8') + (i > 0 ? 1 : 0); // +1 for the newline
    if (keptBytes + lineBytes > maxBytes) { truncatedBy = 'bytes'; break; }
    kept.push(lines[i]);
    keptBytes += lineBytes;
  }
  if (kept.length >= maxLines && keptBytes <= maxBytes) truncatedBy = 'lines';

  const outputContent = kept.join('\n');
  return {
    ...base,
    content: outputContent,
    truncated: true,
    truncatedBy,
    outputLines: kept.length,
    outputBytes: Buffer.byteLength(outputContent, 'utf-8'),
    firstLineExceedsLimit: false,
  };
}

/** Cap one line at `maxChars` CHARACTERS (never bytes, so a multibyte char is never cut in half),
 *  marking the cut with a `... [truncated]` suffix. */
export function truncateLine(line, maxChars = GREP_MAX_LINE_LENGTH) {
  if (line.length <= maxChars) return { text: line, wasTruncated: false };
  return { text: `${line.slice(0, maxChars)}... [truncated]`, wasTruncated: true };
}
