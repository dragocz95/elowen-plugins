import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { fileURLToPath } from 'node:url';
import { formatCheckResult, formatLspFailure } from './manager.js';
import { containsPath } from './paths.js';
/** Most-specific current-turn root containing the checked file. This is both the LSP search boundary
 *  and the security boundary: project marker discovery must never walk above a scoped user's repo. */
function lspBoundary(ctx, path) {
    // An allowed repo is the hard security floor. Prefer it over a possibly deeper client cwd so a turn
    // launched from `<repo>/src` can still discover `<repo>/tsconfig.json` without ever reaching outside
    // the repo. All-access turns have no allowed roots, so their validated cwd is the useful fallback.
    const permitted = ctx.allowedRoots()
        .filter((root) => containsPath(root, path))
        .sort((a, b) => b.length - a.length)[0];
    if (permitted)
        return permitted;
    // ctx.workDir(), never ctx.defaultCwd(): the latter falls back to an allowed root or the daemon's
    // own cwd (`/` under systemd), and either would hand marker discovery a scope this turn never
    // named — the whole filesystem, in the systemd case.
    const workDir = ctx.workDir();
    return workDir && containsPath(workDir, path) ? workDir : undefined;
}
/** The workspace boundary for a symbol search. Unlike {@link lspBoundary} there is NO file to anchor on
 *  — the query is a symbol name, never a path — so the boundary is the caller's own scope. WHICH of
 *  their allowed repos is decided by the turn's bound work dir: ranking the roots by path length alone
 *  answered from whichever repo happened to have the longest path, so a user working in project A got
 *  project B's symbols. Falls back to the widest scope when the work dir names no allowed repo, and to
 *  the work dir itself for an all-access turn (which carries no allowed roots).
 *
 *  `undefined` means UNBOUNDED — the manager then merges symbols from every live client, i.e. from every
 *  tenant's project. That is only ever correct for an all-access turn, so the caller must pair this with
 *  {@link unscopedSymbolSearch}. Exported for the boundary unit test. */
export function workspaceBoundary(ctx) {
    const roots = ctx.allowedRoots();
    const workDir = ctx.workDir();
    if (roots.length === 0)
        return workDir;
    const containing = workDir ? roots.filter((root) => containsPath(root, workDir)) : [];
    return (containing.length > 0 ? containing : roots.slice()).sort((a, b) => b.length - a.length)[0];
}
/** True when a symbol search would run with NO boundary for a turn that is not all-access — the one case
 *  the workspace search must refuse instead of answer.
 *
 *  Empty `allowedRoots()` is ambiguous by construction: it is what an all-access admin carries AND what a
 *  scoped session with no repo carries (a delegated turn whose project policy resolved to nothing). While
 *  these tools were owner-chat built-ins the ambiguity was harmless — only the admin ever had them. As
 *  plugin tools they compose into every session kind, so the ambiguity became a cross-tenant read: every
 *  OTHER tool here is anchored by `assertPathAllowed`, but a symbol query carries no path to anchor on.
 *  Fail closed on the admin bit, which is what actually distinguishes the two. */
function unscopedSymbolSearch(ctx, boundary) {
    return boundary === undefined && !ctx.isAdminSession();
}
/** A tool-result text block (tools report, they never throw). */
function lspText(text) {
    return { content: [{ type: 'text', text }], details: {} };
}
/** Reject a non-positive or non-integer LSP position before it reaches the server (0 → -1 line/char). */
function badPosition(line, character) {
    if (!Number.isInteger(line) || line < 1 || !Number.isInteger(character) || character < 1) {
        return 'LSP: line and character must be 1-based positive integers.';
    }
    return null;
}
/** Render a code-intelligence outcome: the formatter's text on success (or `empty` when it found
 *  nothing), else the honest failure explanation. */
function renderOp(out, format, empty) {
    if (out.ok)
        return format(out.result) ?? empty;
    return formatLspFailure(out) ?? empty;
}
/** The LSP toolset: an on-demand "did I break it?" probe the agent runs after editing a code file.
 *  Read-only (reads the file, queries its language server) → plan-mode safe (manifest `planSafe`).
 *
 *  Names, labels, descriptions and parameter schemas are byte-identical to the core built-ins these
 *  were extracted from — those bytes sit in the model's cached prompt prefix, and the parity test
 *  (tests/plugins/lsp/toolParity.test.ts) pins them. As PLUGIN tools they now compose into every
 *  session kind instead of owner-chat only; that is correct for what they are — repo-scoped READ tools
 *  guarded by ctx.assertPathAllowed, exactly like the files plugin's Read/Search, not control-plane
 *  tools like the ones the agents extraction had to re-gate.
 *
 *  `manager` is resolved per call (never captured): the plugin's service owns the instance, so a reload
 *  that replaced it can never leave a tool talking to language servers nobody will stop. It answers null
 *  once that generation has been stopped — a call landing in a reload's stop window reports that instead
 *  of spawning servers into an instance whose teardown has already run. */
export function registerLspTools(ctx, manager) {
    const assertPathAllowed = (path) => ctx.assertPathAllowed(path);
    const STOPPED = 'LSP: the language-server plugin is reloading — retry in a moment.';
    for (const tool of [
        defineTool({
            name: 'LspDiagnostics', label: 'Check diagnostics',
            description: 'Type-check a file with its language server (LSP) and return errors/warnings with exact line:column. Call this right after editing a code file to immediately confirm it still compiles. Returns "no problems" for a clean file, and a clear note when LSP is off (/lsp) or no server is installed for the language.',
            parameters: Type.Object({ path: Type.String({ description: 'Absolute path to the file to check' }) }),
            execute: async (_id, p) => {
                // Same per-user path policy as every other file tool — without it a user scoped to one project
                // could feed ANY file on disk to a language server and read its content back through quoted
                // diagnostics. Reject with a plain error text (tools report, they don't throw).
                let path;
                try {
                    path = assertPathAllowed(p.path);
                }
                catch (e) {
                    return { content: [{ type: 'text', text: `LSP: ${e.message}` }], details: {} };
                }
                const m = manager();
                if (!m)
                    return lspText(STOPPED);
                const result = await m.checkFile(path, lspBoundary(ctx, path));
                const text = formatCheckResult(result) || `LSP: nothing to check for ${p.path}.`;
                return { content: [{ type: 'text', text }], details: {} };
            },
        }),
        defineTool({
            name: 'LspGoToDefinition', label: 'Go to definition',
            description: 'Find where a symbol (function, class, variable) is defined using the language server. Returns the file path and line:column of the definition. Requires LSP to be enabled and a server installed for the file\'s language.',
            parameters: Type.Object({
                path: Type.String({ description: 'Absolute path to the file containing the symbol' }),
                line: Type.Number({ description: 'Line number (1-based) of the symbol' }),
                character: Type.Number({ description: 'Character offset (1-based) of the symbol' }),
            }),
            execute: async (_id, p) => {
                const bad = badPosition(p.line, p.character);
                if (bad)
                    return lspText(bad);
                let path;
                try {
                    path = assertPathAllowed(p.path);
                }
                catch (e) {
                    return lspText(`LSP: ${e.message}`);
                }
                const m = manager();
                if (!m)
                    return lspText(STOPPED);
                const out = await m.definition(path, p.line, p.character, lspBoundary(ctx, path));
                return lspText(renderOp(out, formatLocations, 'No definition found.'));
            },
        }),
        defineTool({
            name: 'LspFindReferences', label: 'Find references',
            description: 'Find all references to a symbol (function, class, variable) across the workspace using the language server. Returns a list of file:line:column locations. Requires LSP to be enabled and a server installed for the file\'s language.',
            parameters: Type.Object({
                path: Type.String({ description: 'Absolute path to the file containing the symbol' }),
                line: Type.Number({ description: 'Line number (1-based) of the symbol' }),
                character: Type.Number({ description: 'Character offset (1-based) of the symbol' }),
            }),
            execute: async (_id, p) => {
                const bad = badPosition(p.line, p.character);
                if (bad)
                    return lspText(bad);
                let path;
                try {
                    path = assertPathAllowed(p.path);
                }
                catch (e) {
                    return lspText(`LSP: ${e.message}`);
                }
                const m = manager();
                if (!m)
                    return lspText(STOPPED);
                const out = await m.references(path, p.line, p.character, lspBoundary(ctx, path));
                return lspText(renderOp(out, formatLocations, 'No references found.'));
            },
        }),
        defineTool({
            name: 'LspHover', label: 'Hover info',
            description: 'Get hover information (documentation, type signature) for a symbol at a position using the language server. Returns the symbol\'s type and doc comment. Requires LSP to be enabled and a server installed for the file\'s language.',
            parameters: Type.Object({
                path: Type.String({ description: 'Absolute path to the file containing the symbol' }),
                line: Type.Number({ description: 'Line number (1-based) of the symbol' }),
                character: Type.Number({ description: 'Character offset (1-based) of the symbol' }),
            }),
            execute: async (_id, p) => {
                const bad = badPosition(p.line, p.character);
                if (bad)
                    return lspText(bad);
                let path;
                try {
                    path = assertPathAllowed(p.path);
                }
                catch (e) {
                    return lspText(`LSP: ${e.message}`);
                }
                const m = manager();
                if (!m)
                    return lspText(STOPPED);
                const out = await m.hover(path, p.line, p.character, lspBoundary(ctx, path));
                return lspText(renderOp(out, formatHover, 'No hover information available.'));
            },
        }),
        defineTool({
            name: 'LspDocumentSymbol', label: 'Document symbols',
            description: 'List all symbols (functions, classes, variables, interfaces) in a file using the language server. Returns a hierarchical outline of the document. Requires LSP to be enabled and a server installed for the file\'s language.',
            parameters: Type.Object({
                path: Type.String({ description: 'Absolute path to the file' }),
            }),
            execute: async (_id, p) => {
                let path;
                try {
                    path = assertPathAllowed(p.path);
                }
                catch (e) {
                    return lspText(`LSP: ${e.message}`);
                }
                const m = manager();
                if (!m)
                    return lspText(STOPPED);
                const out = await m.documentSymbol(path, lspBoundary(ctx, path));
                return lspText(renderOp(out, (r) => formatDocumentSymbols(r), 'No symbols found.'));
            },
        }),
        defineTool({
            name: 'LspWorkspaceSymbol', label: 'Workspace symbols',
            description: 'Search for symbols (functions, classes, variables) across the entire workspace by name using the language server. Returns matching symbols with their file locations. Requires LSP to be enabled and at least one server running.',
            parameters: Type.Object({
                query: Type.String({ description: 'Symbol name to search for (fuzzy match)' }),
            }),
            execute: async (_id, p) => {
                const boundary = workspaceBoundary(ctx);
                // Refuse rather than search everything: an unbounded merge would hand a scoped caller symbols
                // (names AND file paths) out of other tenants' projects. See unscopedSymbolSearch.
                if (unscopedSymbolSearch(ctx, boundary))
                    return lspText('LSP: this session has no workspace in scope to search.');
                const m = manager();
                if (!m)
                    return lspText(STOPPED);
                const out = await m.workspaceSymbol(p.query, boundary);
                return lspText(renderOp(out, formatWorkspaceSymbols, 'No symbols found.'));
            },
        }),
    ])
        ctx.registerTool(tool);
}
// ── LSP result formatters ──────────────────────────────────────────────────────────────────────────
/** Convert a file URI to a plain path for display. */
function uriToPath(uri) {
    try {
        return fileURLToPath(uri);
    }
    catch {
        return uri;
    }
}
/** Format a Location or Location[] or LocationLink[] result from definition/references. Exported for
 *  the formatter unit tests. */
export function formatLocations(result) {
    if (!result)
        return null;
    const items = Array.isArray(result) ? result : [result];
    if (items.length === 0)
        return null;
    const lines = [];
    for (const item of items.slice(0, 30)) {
        const loc = item;
        const uri = loc.uri ?? loc.targetUri;
        const range = loc.range ?? loc.targetRange;
        if (!uri)
            continue;
        const path = uriToPath(uri);
        const line = (range?.start?.line ?? 0) + 1;
        const col = (range?.start?.character ?? 0) + 1;
        lines.push(`${path}:${line}:${col}`);
    }
    if (items.length > 30)
        lines.push(`… +${items.length - 30} more`);
    return lines.join('\n') || null;
}
/** Format a Hover result. */
export function formatHover(result) {
    if (!result || typeof result !== 'object')
        return null;
    const hover = result;
    const contents = hover.contents;
    if (!contents)
        return null;
    if (typeof contents === 'string')
        return contents;
    if (Array.isArray(contents)) {
        return contents.map((c) => {
            if (typeof c === 'string')
                return c;
            if (c && typeof c === 'object' && 'value' in c)
                return String(c.value);
            return '';
        }).filter(Boolean).join('\n\n') || null;
    }
    if (typeof contents === 'object' && 'value' in contents)
        return String(contents.value);
    return null;
}
/** Format a documentSymbol result. Servers return EITHER a hierarchical `DocumentSymbol[]` (each has a
 *  `range` and optional `children`) OR a flat `SymbolInformation[]` (each has a `location`, no `range`).
 *  Detect which and handle both — the old code silently returned "No symbols found." for the flat shape. */
export function formatDocumentSymbols(result, indent = 0) {
    if (!Array.isArray(result) || result.length === 0)
        return null;
    const first = result[0];
    if (indent === 0 && first && typeof first === 'object' && !('range' in first) && 'location' in first) {
        return formatFlatSymbols(result);
    }
    const lines = [];
    const pad = '  '.repeat(indent);
    for (const sym of result.slice(0, 50)) {
        const s = sym;
        const kindName = SYMBOL_KINDS[s.kind ?? 0] ?? 'symbol';
        const line = (s.range?.start?.line ?? 0) + 1;
        lines.push(`${pad}${s.name ?? '?'} (${kindName}) :${line}`);
        if (s.children?.length) {
            const childText = formatDocumentSymbols(s.children, indent + 1);
            if (childText)
                lines.push(childText);
        }
    }
    if (result.length > 50)
        lines.push(`${pad}… +${result.length - 50} more`);
    return lines.join('\n') || null;
}
/** Format a flat SymbolInformation[] documentSymbol result (a `location`, not a hierarchical range). */
function formatFlatSymbols(result) {
    const lines = [];
    for (const sym of result.slice(0, 50)) {
        const s = sym;
        const kindName = SYMBOL_KINDS[s.kind ?? 0] ?? 'symbol';
        const line = (s.location?.range?.start?.line ?? 0) + 1;
        lines.push(`${s.name ?? '?'} (${kindName}) :${line}`);
    }
    if (result.length > 50)
        lines.push(`… +${result.length - 50} more`);
    return lines.join('\n') || null;
}
/** Format a SymbolInformation[] result from workspace/symbol. */
export function formatWorkspaceSymbols(result) {
    if (!Array.isArray(result) || result.length === 0)
        return null;
    const lines = [];
    for (const sym of result.slice(0, 30)) {
        const s = sym;
        const kindName = SYMBOL_KINDS[s.kind ?? 0] ?? 'symbol';
        const path = s.location?.uri ? uriToPath(s.location.uri) : '?';
        const line = (s.location?.range?.start?.line ?? 0) + 1;
        lines.push(`${s.name ?? '?'} (${kindName}) ${path}:${line}`);
    }
    if (result.length > 30)
        lines.push(`… +${result.length - 30} more`);
    return lines.join('\n') || null;
}
/** LSP SymbolKind enum → human-readable name. */
const SYMBOL_KINDS = {
    1: 'file', 2: 'module', 3: 'namespace', 4: 'package', 5: 'class', 6: 'method',
    7: 'property', 8: 'field', 9: 'constructor', 10: 'enum', 11: 'interface',
    12: 'function', 13: 'variable', 14: 'constant', 15: 'string', 16: 'number',
    17: 'boolean', 18: 'array', 19: 'object', 20: 'key', 21: 'null', 22: 'enum-member',
    23: 'struct', 24: 'event', 25: 'operator', 26: 'type-parameter',
};
