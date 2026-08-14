import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export const defineTool = (definition) => definition;

// ── skills loader ────────────────────────────────────────────────────────────────────────────────────
// Faithful ports of the host package's `loadSkillsFromDir` / `formatSkillsForPrompt` (core/skills.ts).
// The skills plugin resolves BOTH of its catalog surfaces (ListSkills, DeleteSkill) through the loader
// rather than through a flat `*.md` readdir, precisely so it sees the `<name>/SKILL.md` directory form —
// a stand-in that only globbed `*.md` would make the dir-form tests vacuous.
//
// Deliberately left out of the port: the `.gitignore`/`.ignore` matcher and the `sourceInfo` block. The
// plugin never reads sourceInfo, and no skills dir the plugin owns carries an ignore file; everything
// the plugin's behaviour depends on (discovery rules, name fallback, the description gate) is kept.

/** The host's frontmatter parser (utils/frontmatter.ts). Note it is deliberately NOT BOM-tolerant: it
 *  demands a leading `---`, so a BOM-prefixed skill file parses as pure body and — having no description
 *  — never loads. The plugin's own splitFrontmatter IS BOM-tolerant, and that asymmetry is real: the
 *  HTTP catalog shows such a file while PI's loader does not. */
const parseFrontmatter = (content) => {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.startsWith('---')) return { frontmatter: {}, body: normalized };
  const endIndex = normalized.indexOf('\n---', 3);
  if (endIndex === -1) return { frontmatter: {}, body: normalized };
  return { frontmatter: parseYaml(normalized.slice(4, endIndex)) ?? {}, body: normalized.slice(endIndex + 4).trim() };
};

function loadSkillFromFile(filePath, source) {
  try {
    const { frontmatter } = parseFrontmatter(readFileSync(filePath, 'utf-8'));
    // A skill with no description is not loaded at all — it is what the model would have to match on.
    if (!frontmatter.description || String(frontmatter.description).trim() === '') return null;
    const skillDir = dirname(filePath);
    return {
      // The frontmatter name wins; a dir-form skill falls back to its folder name.
      name: frontmatter.name || basename(skillDir),
      description: frontmatter.description,
      filePath,
      baseDir: skillDir,
      source,
      disableModelInvocation: frontmatter['disable-model-invocation'] === true,
    };
  } catch { return null; }
}

/** Discovery rules, verbatim from the host: a directory holding a SKILL.md IS a skill root (and is not
 *  recursed into), otherwise direct `.md` children of the ROOT dir load and every subdirectory is
 *  searched for a SKILL.md. Dotfiles and node_modules are skipped. */
function loadSkillsFromDirInternal(dir, source, includeRootFiles) {
  const skills = [];
  if (!existsSync(dir)) return { skills, diagnostics: [] };
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return { skills, diagnostics: [] }; }

  for (const entry of entries) {
    if (entry.name !== 'SKILL.md') continue;
    const skill = loadSkillFromFile(join(dir, entry.name), source);
    if (skill) skills.push(skill);
    return { skills, diagnostics: [] }; // a skill root, so nothing below it is scanned
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const fullPath = join(dir, entry.name);
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try { const s = statSync(fullPath); isDirectory = s.isDirectory(); isFile = s.isFile(); }
      catch { continue; } // broken symlink
    }
    if (isDirectory) { skills.push(...loadSkillsFromDirInternal(fullPath, source, false).skills); continue; }
    if (!isFile || !includeRootFiles || !entry.name.endsWith('.md')) continue;
    const skill = loadSkillFromFile(fullPath, source);
    if (skill) skills.push(skill);
  }
  return { skills, diagnostics: [] };
}

export function loadSkillsFromDir({ dir, source }) {
  return loadSkillsFromDirInternal(dir, source, true);
}

const escapeXml = (str) => String(str)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** The system-prompt block. A skill flagged `disable-model-invocation` is excluded — it stays reachable
 *  only through an explicit `/skill:name`. */
export function formatSkillsForPrompt(skills) {
  const visible = skills.filter((s) => !s.disableModelInvocation);
  if (visible.length === 0) return '';
  const lines = [
    '\n\nThe following skills provide specialized instructions for specific tasks.',
    "Use the read tool to load a skill's file when the task matches its description.",
    'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.',
    '',
    '<available_skills>',
  ];
  for (const skill of visible) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push('  </skill>');
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

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
