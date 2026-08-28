import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LspClient, spawnStdioTransport } from './client.js';
import { canonical, pathWithin } from './paths.js';
import { commandExists, detectLanguage, listServers, serverForLanguage } from './servers.js';
const PROJECT_MARKERS = [
    '.git', 'package.json', 'tsconfig.json', 'jsconfig.json', 'pyproject.toml', 'setup.py',
    'go.mod', 'Cargo.toml', 'CMakeLists.txt', 'compile_commands.json',
];
/** Find the closest project-looking ancestor of `path`, bounded by `boundary` when supplied. With no
 *  marker, use the boundary (a known allowed project) or the file's own directory — never the daemon's
 *  process.cwd(), which is `/` under systemd. */
export function projectRootForFile(path, boundary) {
    const start = canonical(dirname(path));
    const candidate = boundary ? canonical(boundary) : undefined;
    const floor = candidate && pathWithin(start, candidate) ? candidate : undefined;
    let current = start;
    while (true) {
        // With no explicit boundary, never promote the filesystem root merely because it happens to carry
        // a marker. A file nested in some checkout must not recreate the old daemon-wide `/` workspace.
        if (!floor && current !== start && dirname(current) === current)
            break;
        if (PROJECT_MARKERS.some((marker) => existsSync(join(current, marker))))
            return current;
        if (current === floor)
            break;
        const parent = dirname(current);
        if (parent === current || (floor && !pathWithin(parent, floor)))
            break;
        current = parent;
    }
    return floor ?? start;
}
/** Owns the live language-server clients (one per server binary + project root, lazily spawned and reused) and turns a
 *  file path into diagnostics. Enable/disable is a single flag the `/lsp` toggle flips — when off,
 *  `checkFile` is a cheap no-op and no servers are spawned. */
export class LspManager {
    /** Insertion order is the reusable-client LRU. Retired clients are detached from lookup immediately,
     *  but remain alive until their already-running checks settle. */
    clients = new Map();
    retiredClients = new Set();
    /** Diagnostics for one server+project share tsserver's project index. Queue them so a burst of agent
     *  probes cannot make the cold server analyze several newly opened files at once. */
    diagnosticQueues = new Map();
    enabled = true;
    spawnFn;
    readFile;
    root;
    exists;
    firstCheckTimeoutMs;
    recheckTimeoutMs;
    settleMs;
    maxClients;
    constructor(deps = {}) {
        this.spawnFn = deps.spawn ?? spawnStdioTransport;
        this.readFile = deps.readFile ?? ((p) => readFileSync(p, 'utf8'));
        this.root = deps.root;
        this.exists = deps.exists ?? commandExists;
        // The first check pays for the server's project load (tsserver on a large repo easily needs >4s —
        // with the old flat 4s it "timed out clean" and reported a false ✓); re-checks are fast.
        this.firstCheckTimeoutMs = deps.firstCheckTimeoutMs ?? 15000;
        this.recheckTimeoutMs = deps.recheckTimeoutMs ?? 4000;
        // tsserver's syntax and semantic passes arrive ~50ms apart once warm; 1s absorbs slower servers.
        this.settleMs = deps.settleMs ?? 1000;
        this.maxClients = Math.max(1, Math.floor(deps.maxClients ?? 8));
    }
    isEnabled() { return this.enabled; }
    setEnabled(on) {
        this.enabled = on;
        if (!on)
            this.disposeAll(); // free the servers when the user turns LSP off
    }
    /** Whether at least one language server is currently alive. */
    isRunning() {
        return this.allClients().some((entry) => !entry.client.isDisposed());
    }
    /** Enabled/running plus a per-server row (installed on PATH? client alive?) — the single status
     *  accessor every UI reads (the CLI /lsp modal, GET /brain/lsp, any panel indicator). */
    status() {
        const servers = listServers().map((spec) => {
            return {
                language: spec.language,
                label: spec.label,
                command: spec.command,
                installed: this.exists(spec.command),
                running: this.hasRunningClient(spec),
                installable: !!spec.npmPackages?.length,
                installHint: spec.installHint,
            };
        });
        return { enabled: this.enabled, running: this.isRunning(), servers };
    }
    /** Type-check one file and return its diagnostics (or why it was skipped). Never throws — a spawn or
     *  server failure degrades to a `skipped`/empty result so it can't break the agent's edit loop. */
    async checkFile(path, boundary) {
        if (!this.enabled)
            return { path, diagnostics: [], skipped: 'disabled' };
        const language = detectLanguage(path);
        if (!language)
            return { path, diagnostics: [], skipped: 'not-a-known-language' };
        const spec = serverForLanguage(language);
        if (!spec)
            return { path, language, diagnostics: [], skipped: 'unsupported-language' };
        const root = projectRootForFile(path, boundary ?? this.root);
        const key = this.keyFor(spec, root);
        return this.queueDiagnostic(key, async () => {
            // A queued probe may outlive an /lsp disable; do not respawn after disposeAll().
            if (!this.enabled)
                return { path, diagnostics: [], skipped: 'disabled' };
            let text;
            try {
                text = this.readFile(path);
            }
            catch {
                return { path, language, diagnostics: [], skipped: 'unreadable' };
            }
            const entry = this.clientFor(spec, root);
            if (!entry)
                return { path, language, server: spec.label, diagnostics: [], skipped: 'no-server-installed' };
            entry.activeChecks++;
            try {
                // A file's first semantic pass can be slow even after another file warmed the project. Only an
                // already-confirmed path gets the short re-check window used for the edit loop.
                const timeoutMs = entry.warmed && entry.checkedPaths.has(path) ? this.recheckTimeoutMs : this.firstCheckTimeoutMs;
                const { diagnostics, published } = await entry.client.diagnose(path, text, language, timeoutMs, this.settleMs);
                // No verdict within the window: say so instead of a false "no problems" — the worst possible
                // answer for an agent probe is a wrong all-clear.
                if (!published) {
                    // publishDiagnostics is often unversioned. After a timeout, a delayed verdict for text A could
                    // otherwise satisfy the next check for text B on the same URI. Quarantine the whole client;
                    // the next probe starts with a fresh server and cannot consume that stale publish.
                    this.retire(entry);
                    return { path, language, server: spec.label, diagnostics: [], skipped: 'no-response' };
                }
                entry.warmed = true;
                entry.checkedPaths.add(path);
                return { path, language, server: spec.label, diagnostics };
            }
            catch {
                // The server crashed/timed out — drop the client so the next check re-spawns, and say so honestly
                // (NOT "no server installed", which would send the agent chasing an install it already has).
                this.retire(entry);
                return { path, language, server: spec.label, diagnostics: [], skipped: 'server-error' };
            }
            finally {
                this.release(entry);
            }
        });
    }
    // ── Code-intelligence operations ─────────────────────────────────────────────────────────────────
    // Each resolves the language server for the file, ensures a client is running, and delegates to the
    // client's corresponding method. Returns the raw LSP result (or null on any failure) — the caller
    // (lspTools) formats it for the model.
    /** Resolve the server + client for a file and run an operation against it. Returns a discriminated
     *  outcome so the tool can report WHY nothing came back (LSP off / not code / no server installed /
     *  server crashed) instead of collapsing every failure into a misleading "not found". */
    async withClient(path, boundary, op) {
        if (!this.enabled)
            return { ok: false, reason: 'disabled' };
        const language = detectLanguage(path);
        if (!language)
            return { ok: false, reason: 'not-a-known-language' };
        const spec = serverForLanguage(language);
        if (!spec)
            return { ok: false, reason: 'unsupported-language', language };
        let text;
        try {
            text = this.readFile(path);
        }
        catch {
            return { ok: false, reason: 'unreadable', language };
        }
        const root = projectRootForFile(path, boundary ?? this.root);
        const entry = this.clientFor(spec, root);
        if (!entry)
            return { ok: false, reason: 'no-server-installed', language, server: spec.label };
        entry.activeChecks++;
        try {
            return { ok: true, result: await op(entry.client, text, language) };
        }
        catch {
            this.retire(entry);
            return { ok: false, reason: 'server-error', language, server: spec.label };
        }
        finally {
            this.release(entry);
        }
    }
    async definition(path, line, character, boundary) {
        return this.withClient(path, boundary, (c, text, lang) => c.definition(path, text, lang, line, character));
    }
    async references(path, line, character, boundary) {
        return this.withClient(path, boundary, (c, text, lang) => c.references(path, text, lang, line, character));
    }
    async hover(path, line, character, boundary) {
        return this.withClient(path, boundary, (c, text, lang) => c.hover(path, text, lang, line, character));
    }
    async documentSymbol(path, boundary) {
        return this.withClient(path, boundary, (c, text, lang) => c.documentSymbol(path, text, lang));
    }
    /** workspace/symbol across the caller's project(s). SECURITY: the manager is a daemon-wide singleton
     *  shared by every user, so results are taken ONLY from clients whose root is inside `boundary` (the
     *  caller's allowed scope) — never a client rooted in another tenant's project. When nothing in scope
     *  is live yet, a server is spawned for the boundary root so the tool works on a cold session. */
    async workspaceSymbol(query, boundary) {
        if (!this.enabled)
            return { ok: false, reason: 'disabled' };
        const boundaryRoot = boundary ?? this.root;
        const within = (root) => {
            if (!boundaryRoot)
                return true; // all-access (no boundary) — every live client is in scope
            const base = canonical(boundaryRoot);
            const candidate = canonical(root);
            return candidate === base || pathWithin(candidate, base);
        };
        let inScope = [...this.clients.values()].filter((e) => !e.client.isDisposed() && within(e.root));
        if (inScope.length === 0) {
            if (!boundaryRoot)
                return { ok: false, reason: 'no-server-installed' };
            // Cold session: spawn the first installed server for the boundary's nearest project root.
            const root = projectRootForFile(join(boundaryRoot, '_probe'), boundaryRoot);
            const entry = this.spawnAnyClientFor(root);
            if (!entry)
                return { ok: false, reason: 'no-server-installed' };
            inScope = [entry];
        }
        const merged = [];
        for (const entry of inScope) {
            entry.activeChecks++;
            try {
                const res = await entry.client.workspaceSymbol(query);
                if (Array.isArray(res))
                    merged.push(...res);
            }
            catch {
                this.retire(entry);
            }
            finally {
                this.release(entry);
            }
        }
        return { ok: true, result: merged };
    }
    /** Spawn (or reuse) any installed language server for `root` — used by workspace/symbol on a cold
     *  session, where there is no file to pick a language from. First registered server that spawns wins. */
    spawnAnyClientFor(root) {
        for (const spec of listServers()) {
            const entry = this.clientFor(spec, root);
            if (entry)
                return entry;
        }
        return null;
    }
    keyFor(spec, root) { return `${spec.command}\0${root}`; }
    /** Run one diagnostics probe at a time for a server+project. Different projects and server binaries
     *  remain independent, while a failure in one queued probe never poisons the next. */
    queueDiagnostic(key, operation) {
        const previous = this.diagnosticQueues.get(key) ?? Promise.resolve();
        const current = previous.catch(() => undefined).then(operation);
        this.diagnosticQueues.set(key, current);
        return current.finally(() => {
            if (this.diagnosticQueues.get(key) === current)
                this.diagnosticQueues.delete(key);
        });
    }
    hasRunningClient(spec) {
        return this.allClients().some((entry) => entry.command === spec.command && !entry.client.isDisposed());
    }
    allClients() {
        return [...this.clients.values(), ...this.retiredClients];
    }
    clientFor(spec, root) {
        const key = this.keyFor(spec, root);
        const existing = this.clients.get(key);
        if (existing && !existing.client.isDisposed()) {
            // Map insertion order is the LRU queue. A hit becomes newest.
            this.clients.delete(key);
            this.clients.set(key, existing);
            return existing;
        }
        if (existing)
            this.retire(existing); // a crashed/exited server client — evict and respawn below
        const transport = this.spawnFn(spec, root);
        if (!transport)
            return null;
        this.makeRoomForClient();
        const client = new LspClient(transport, root);
        const entry = {
            key, command: spec.command, root, client, activeChecks: 0, retired: false, warmed: false, checkedPaths: new Set(),
        };
        this.clients.set(key, entry);
        return entry;
    }
    /** Evict the oldest reusable client which is not serving a diagnostics call. When every client is busy,
     *  allow a temporary cap overflow; release() trims it as soon as one client becomes idle. */
    makeRoomForClient() {
        while (this.clients.size >= this.maxClients) {
            const idle = [...this.clients.values()].find((entry) => entry.activeChecks === 0);
            if (!idle)
                break;
            this.clients.delete(idle.key);
            idle.retired = true;
            idle.client.dispose();
        }
    }
    trimClients() {
        while (this.clients.size > this.maxClients) {
            const idle = [...this.clients.values()].find((entry) => entry.activeChecks === 0);
            if (!idle)
                break;
            this.clients.delete(idle.key);
            idle.retired = true;
            idle.client.dispose();
        }
    }
    /** Remove a failed/no-verdict client from future lookup now, without aborting unrelated checks already
     *  using it. Identity guards ensure an old request can never retire a replacement at the same key. */
    retire(entry) {
        if (this.clients.get(entry.key) === entry)
            this.clients.delete(entry.key);
        entry.retired = true;
        if (!entry.client.isDisposed())
            this.retiredClients.add(entry);
        if (entry.activeChecks === 0)
            this.disposeRetired(entry);
    }
    release(entry) {
        entry.activeChecks = Math.max(0, entry.activeChecks - 1);
        if (entry.activeChecks === 0 && entry.retired)
            this.disposeRetired(entry);
        this.trimClients();
    }
    disposeRetired(entry) {
        this.retiredClients.delete(entry);
        entry.client.dispose();
    }
    disposeAll() {
        const all = this.allClients();
        this.clients.clear();
        this.retiredClients.clear();
        for (const entry of all) {
            entry.retired = true;
            entry.client.dispose();
        }
    }
}
/** Explain a failed code-intelligence operation to the agent — mirrors formatCheckResult's honest,
 *  actionable wording (off / not code / install-would-help / server error). Returns null when there is
 *  no useful explanation (the caller then renders its own "No X found."). */
export function formatLspFailure(f) {
    switch (f.reason) {
        case 'disabled': return 'LSP is off (/lsp to enable).';
        case 'not-a-known-language': return null;
        case 'unsupported-language': return `LSP doesn't cover ${f.language} (no language server registered for it).`;
        case 'no-server-installed': return `The ${f.server ?? f.language ?? 'required'} language server isn't installed — install it to use this.`;
        case 'server-error': return `The ${f.server ?? f.language} language server errored or timed out — no result this time (it will be retried).`;
        case 'unreadable': return 'Could not read the file.';
    }
}
/** Render a CheckResult as a compact, agent-readable summary line block (used by the lsp tool + hook). */
export function formatCheckResult(r) {
    if (r.skipped === 'not-a-known-language')
        return '';
    if (r.skipped === 'unsupported-language')
        return `LSP doesn't cover ${r.language} (no language server registered for it).`;
    if (r.skipped === 'disabled')
        return 'LSP is off (/lsp to enable).';
    if (r.skipped === 'no-server-installed')
        return `The ${r.server ?? r.language} language server isn't installed — install it to get ${r.language} diagnostics.`;
    if (r.skipped === 'server-error')
        return `The ${r.server ?? r.language} language server errored or timed out — no diagnostics this time (it will be retried).`;
    if (r.skipped === 'no-response')
        return `The ${r.server ?? r.language} language server gave no verdict on ${r.path} in time (it may still be indexing) — NOT a clean bill, re-check shortly.`;
    if (r.skipped === 'unreadable')
        return `Could not read ${r.path}.`;
    if (r.diagnostics.length === 0)
        return `✓ ${r.path}: no problems (${r.server}).`;
    const lines = r.diagnostics.slice(0, 20).map((d) => `  ${d.severity} ${r.path}:${d.line}:${d.column} — ${d.message}${d.source ? ` (${d.source})` : ''}`);
    const errors = r.diagnostics.filter((d) => d.severity === 'error').length;
    const warnings = r.diagnostics.filter((d) => d.severity === 'warning').length;
    const more = r.diagnostics.length > 20 ? `\n  … +${r.diagnostics.length - 20} more` : '';
    return `${r.path}: ${errors} error(s), ${warnings} warning(s) (${r.server})\n${lines.join('\n')}${more}`;
}
