import { existsSync } from 'node:fs';
import { lspPrefixDir } from './install.js';
/** File extension → LSP language id. Kept broad; an unmapped extension yields null (LSP skipped). */
const EXTENSION_LANGUAGE = {
    ts: 'typescript', tsx: 'typescriptreact', mts: 'typescript', cts: 'typescript',
    js: 'javascript', jsx: 'javascriptreact', mjs: 'javascript', cjs: 'javascript',
    py: 'python', pyi: 'python',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    java: 'java',
    c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp',
    cs: 'csharp',
    lua: 'lua',
    json: 'json', jsonc: 'jsonc',
    css: 'css', scss: 'scss', less: 'less',
    html: 'html', vue: 'vue',
    yaml: 'yaml', yml: 'yaml',
    sh: 'shellscript', bash: 'shellscript',
};
/** language id → the server that handles it. One server can cover several language ids (tsserver handles
 *  js/ts/jsx/tsx). The command is resolved on PATH at spawn time; missing → that language is skipped. */
const SERVERS = [
    { language: 'typescript', command: 'typescript-language-server', args: ['--stdio'], label: 'TypeScript', npmPackages: ['typescript-language-server', 'typescript'], installHint: 'npm install -g typescript-language-server typescript' },
    { language: 'python', command: 'pyright-langserver', args: ['--stdio'], label: 'Pyright', npmPackages: ['pyright'], installHint: 'npm install -g pyright' },
    { language: 'go', command: 'gopls', args: [], label: 'gopls', installHint: 'go install golang.org/x/tools/gopls@latest' },
    { language: 'rust', command: 'rust-analyzer', args: [], label: 'rust-analyzer', installHint: 'rustup component add rust-analyzer' },
    { language: 'ruby', command: 'solargraph', args: ['stdio'], label: 'Solargraph', installHint: 'gem install solargraph' },
    { language: 'php', command: 'intelephense', args: ['--stdio'], label: 'Intelephense', npmPackages: ['intelephense'], installHint: 'npm install -g intelephense' },
    { language: 'c', command: 'clangd', args: [], label: 'clangd', installHint: 'apt install clangd (or brew install llvm)' },
    { language: 'cpp', command: 'clangd', args: [], label: 'clangd', installHint: 'apt install clangd (or brew install llvm)' },
    { language: 'lua', command: 'lua-language-server', args: [], label: 'lua-language-server', installHint: 'brew install lua-language-server (or your package manager)' },
    { language: 'yaml', command: 'yaml-language-server', args: ['--stdio'], label: 'yaml-language-server', npmPackages: ['yaml-language-server'], installHint: 'npm install -g yaml-language-server' },
    { language: 'bash', command: 'bash-language-server', args: ['start'], label: 'bash-language-server', npmPackages: ['bash-language-server'], installHint: 'npm install -g bash-language-server' },
];
/** Aliases that share a server with a primary language id (so tsx/jsx reuse the TS server, etc.). */
const SERVER_ALIAS = {
    typescriptreact: 'typescript', javascript: 'typescript', javascriptreact: 'typescript',
    jsonc: 'json', scss: 'css', less: 'css',
    shellscript: 'bash',
};
/** Resolve `command` to a runnable binary path: Elowen's own LSP install prefix (`<data dir>/lsp/bin`,
 *  where ctrl+i / the setup wizard install servers — the daemon user can't write the system npm prefix)
 *  wins over PATH lookup. Returns null when the server isn't installed anywhere — checked UP FRONT
 *  because `child_process.spawn` reports a missing binary only via an async 'error' event, so a missing
 *  server would otherwise spawn a dead pipe and stall the whole request timeout on every check.
 *  Linux/macOS PATH semantics (prod is linux). */
export function resolveServerCommand(command, env = process.env) {
    const runnable = (p) => { try {
        return existsSync(p);
    }
    catch {
        return false;
    } };
    if (command.includes('/'))
        return runnable(command) ? command : null;
    const own = `${lspPrefixDir()}/bin/${command}`;
    if (runnable(own))
        return own;
    const dirs = (env.PATH ?? '').split(':').filter(Boolean);
    for (const d of dirs)
        if (runnable(`${d}/${command}`))
            return `${d}/${command}`;
    return null;
}
/** Whether `command` resolves to an executable (Elowen's LSP prefix or PATH). */
export function commandExists(command, env = process.env) {
    return resolveServerCommand(command, env) !== null;
}
/** The LSP language id for a file path, or null when the extension isn't code we type-check. */
export function detectLanguage(path) {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    return EXTENSION_LANGUAGE[ext] ?? null;
}
/** The server spec that handles a language id (following aliases), or null when none is registered. */
export function serverForLanguage(language) {
    const canonical = SERVER_ALIAS[language] ?? language;
    return SERVERS.find((s) => s.language === canonical) ?? null;
}
/** Every registered server, one entry per BINARY (clangd covers c and cpp but is one server). Feeds the
 *  status surfaces — which servers Elowen can drive, whether each is installed/running. */
export function listServers() {
    const seen = new Set();
    return SERVERS.filter((s) => {
        if (seen.has(s.command))
            return false;
        seen.add(s.command);
        return true;
    });
}
