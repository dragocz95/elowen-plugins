import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodeMessage, MessageDecoder } from './protocol.js';
import { resolveServerCommand } from './servers.js';
const SEVERITY = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };
/** File URIs are identifiers, but servers do not agree on which optional path characters to percent-
 * encode (typescript-language-server encodes parentheses while Node's pathToFileURL leaves them literal).
 * Round-trip through the filesystem path so equivalent spellings share one document/waiter key. */
function canonicalDocumentUri(uri) {
    try {
        return pathToFileURL(fileURLToPath(uri)).href;
    }
    catch {
        return uri;
    }
}
/** Interpret an LSP `textDocument/publishDiagnostics` params object into { uri, diagnostics }. Pure and
 *  defensive (servers vary): unknown severities default to 'warning', missing ranges to line 1. This is
 *  the single place raw protocol becomes Elowen's Diagnostic — so it carries the unit tests. */
export function parsePublishDiagnostics(params) {
    const p = (params && typeof params === 'object') ? params : {};
    const uri = typeof p.uri === 'string' ? canonicalDocumentUri(p.uri) : '';
    const raw = Array.isArray(p.diagnostics) ? p.diagnostics : [];
    const diagnostics = [];
    for (const d of raw) {
        const item = (d && typeof d === 'object') ? d : {};
        const start = (item.range?.start) ?? {};
        const message = typeof item.message === 'string' ? item.message.replace(/\s+/g, ' ').trim() : '';
        if (!message)
            continue;
        diagnostics.push({
            severity: SEVERITY[Number(item.severity)] ?? 'warning',
            message,
            line: Number(start.line ?? 0) + 1,
            column: Number(start.character ?? 0) + 1,
            ...(typeof item.source === 'string' && item.source ? { source: item.source } : {}),
            ...(item.code != null ? { code: String(item.code) } : {}),
        });
    }
    // Errors first, then by position — the agent reads the most important line first.
    const rank = { error: 0, warning: 1, info: 2, hint: 3 };
    diagnostics.sort((a, b) => rank[a.severity] - rank[b.severity] || a.line - b.line || a.column - b.column);
    return { uri, diagnostics };
}
/** Spawn a language server as a child process and wrap its stdio in an LspTransport. Returns null when the
 *  server binary isn't on PATH — checked SYNCHRONOUSLY up front, because `spawn` reports ENOENT only via
 *  an async 'error' event, so relying on a try/catch would return a dead-pipe transport that stalls every
 *  request. The child is detached-safe: on error/exit the transport notifies so the client can fail fast. */
export function spawnStdioTransport(spec, cwd) {
    // Resolved (not bare) command: servers installed into Elowen's own LSP prefix aren't on the daemon's PATH.
    const bin = resolveServerCommand(spec.command);
    if (!bin)
        return null;
    let child;
    try {
        child = spawn(bin, spec.args, { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
    }
    catch {
        return null;
    }
    const decoder = new MessageDecoder();
    let alive = true;
    const messageCbs = [];
    const exitCbs = [];
    const die = () => { if (!alive)
        return; alive = false; for (const cb of exitCbs)
        cb(); };
    child.on('error', die); // a late ENOENT (race) or spawn failure still fails the client fast
    child.on('exit', die);
    child.stdout.on('data', (chunk) => { for (const m of decoder.push(chunk))
        for (const cb of messageCbs)
            cb(m); });
    child.stdin.on('error', () => { });
    return {
        send: (framed) => { if (alive) {
            try {
                child.stdin.write(framed);
            }
            catch { /* pipe closing */ }
        } },
        onMessage: (cb) => { messageCbs.push(cb); },
        onExit: (cb) => { exitCbs.push(cb); },
        dispose: () => { alive = false; try {
            child.kill();
        }
        catch { /* already gone */ } },
    };
}
/** A minimal LSP client: initialize handshake, then open/update a document and collect the diagnostics
 *  the server publishes for it. Deliberately request/notify only what diagnostics need — this is a
 *  "did I break it?" probe for the agent, not a full editor client. */
export class LspClient {
    transport;
    rootPath;
    maxDocuments;
    static DEFAULT_MAX_DOCUMENTS = 128;
    nextId = 1;
    pending = new Map();
    // A diagnostics verdict is valid only for the exact bytes the server checked. Keeping the text on
    // the open-document record makes that relationship explicit: an identical re-check can return the
    // confirmed verdict immediately, while any edit invalidates it before didChange is sent.
    documents = new Map();
    // publishDiagnostics has no reliably-present document version across servers. Serialize checks for
    // one URI so a publish can never be consumed by two different document contents; different files
    // still diagnose concurrently. Identical concurrent calls share the same in-flight promise.
    diagnosesByUri = new Map();
    // Multiple concurrent diagnose() calls can await the SAME uri — keep every waiter, not just the last,
    // or an earlier caller's promise would never settle. Waiters stay registered across publishes (they
    // resolve on quiescence, not on the first publish) and remove themselves when they finish.
    diagnosticWaiters = new Map();
    // Every operation that changes a document's server-side state runs exclusively per URI. A didChange
    // sent by a hover/references call while a diagnose is waiting for that URI's (version-less) publish
    // would otherwise hand the waiting caller a verdict computed for someone else's text — and the request
    // itself could equally be answered against text a concurrent diagnose had just pushed.
    uriOperations = new Map();
    starting = null;
    disposed = false;
    constructor(transport, rootPath, maxDocuments = LspClient.DEFAULT_MAX_DOCUMENTS) {
        this.transport = transport;
        this.rootPath = rootPath;
        this.maxDocuments = maxDocuments;
        transport.onMessage((msg) => this.onMessage(msg));
        transport.onExit(() => this.onExit());
    }
    isDisposed() { return this.disposed; }
    onExit() {
        this.close(new Error('language server exited'));
    }
    /** Mark the client unusable and settle every promise which otherwise depends on more server I/O. */
    close(error) {
        if (this.disposed)
            return;
        this.disposed = true;
        // Fail every in-flight request so no caller hangs on a dead server.
        for (const { reject } of this.pending.values())
            reject(error);
        this.pending.clear();
        // A partial publish is not a trustworthy verdict: reject diagnostics waits so the manager reports a
        // server error and replaces the client. Copy first because fail() removes itself from the waiter set.
        for (const waiters of this.diagnosticWaiters.values()) {
            for (const waiter of [...waiters])
                waiter.fail(error);
        }
        this.diagnosticWaiters.clear();
        this.diagnosesByUri.clear();
        this.documents.clear();
    }
    onMessage(msg) {
        // A response to one of our own requests (a response has an id but no method).
        if (msg.method === undefined && typeof msg.id === 'number' && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            p.resolve(msg);
            return;
        }
        // A server → client REQUEST (both method and id). It MUST be answered: tsserver and pyright block
        // on `workspace/configuration` / `window/workDoneProgress/create` after initialize, and dropping
        // the reply (the old behaviour) left them waiting — diagnostics never arrived and every check
        // "timed out clean". This was the core reliability bug of the integration.
        if (msg.method !== undefined && msg.id !== undefined) {
            this.transport.send(encodeMessage(this.replyToServerRequest(msg)));
            return;
        }
        if (msg.method === 'textDocument/publishDiagnostics') {
            const { uri, diagnostics } = parsePublishDiagnostics(msg.params);
            // A workspace edit can republish diagnostics for another, byte-identical open document. Its old
            // exact-text verdict is stale even when nobody is currently waiting on that URI; the next explicit
            // check must ask the server again instead of returning the old cached answer.
            const document = this.documents.get(uri);
            if (document)
                document.confirmed = undefined;
            // Notify (don't resolve) every waiter — servers publish in passes and the waiter decides when
            // the stream has gone quiet enough to trust.
            for (const w of this.diagnosticWaiters.get(uri) ?? [])
                w.publish(diagnostics);
        }
    }
    /** The response for a server → client request. We support none of the optional client features, so
     *  every answer is the protocol's "nothing to report" shape for that method; unknown methods get a
     *  proper MethodNotFound error instead of silence (silence stalls the server). */
    replyToServerRequest(msg) {
        const base = { jsonrpc: '2.0', id: msg.id };
        switch (msg.method) {
            case 'workspace/configuration': {
                // One `null` per requested item = "no overrides, use your defaults".
                const items = msg.params?.items;
                return { ...base, result: Array.isArray(items) ? items.map(() => null) : [] };
            }
            case 'workspace/workspaceFolders':
                return { ...base, result: [{ uri: pathToFileURL(this.rootPath).href, name: 'root' }] };
            case 'client/registerCapability':
            case 'client/unregisterCapability':
            case 'window/workDoneProgress/create':
            case 'window/showMessageRequest':
                return { ...base, result: null };
            default:
                return { ...base, error: { code: -32601, message: `method not supported: ${msg.method}` } };
        }
    }
    notify(method, params) {
        this.transport.send(encodeMessage({ jsonrpc: '2.0', method, params }));
    }
    request(method, params, timeoutMs = 8000) {
        if (this.disposed)
            return Promise.reject(new Error('language server disposed'));
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`LSP ${method} timed out`)); }, timeoutMs);
            timer.unref?.();
            this.pending.set(id, { resolve: (m) => { clearTimeout(timer); resolve(m); }, reject: (e) => { clearTimeout(timer); reject(e); } });
            this.transport.send(encodeMessage({ jsonrpc: '2.0', id, method, params }));
        });
    }
    /** Run the initialize/initialized handshake exactly once, even under concurrent diagnose() calls (a
     *  second `initialize` is a protocol error). The in-flight promise is memoized. */
    start() {
        if (this.starting)
            return this.starting;
        this.starting = (async () => {
            await this.request('initialize', {
                processId: process.pid, // let the server watchdog exit if the daemon dies
                rootUri: pathToFileURL(this.rootPath).href,
                capabilities: { textDocument: { publishDiagnostics: { relatedInformation: false }, synchronization: { didSave: false } } },
                workspaceFolders: [{ uri: pathToFileURL(this.rootPath).href, name: 'root' }],
            });
            this.notify('initialized', {});
        })();
        return this.starting;
    }
    /** Queue `op` behind every other operation on this URI (see {@link uriOperations}). A failed operation
     *  settles the chain for its own caller instead of poisoning the next one; different URIs never wait
     *  on each other. */
    runOnUri(uri, op) {
        const queued = (this.uriOperations.get(uri) ?? Promise.resolve())
            .catch(() => { })
            .then(op);
        this.uriOperations.set(uri, queued);
        return queued.finally(() => { if (this.uriOperations.get(uri) === queued)
            this.uriOperations.delete(uri); });
    }
    /** Open (or, on a re-check, update) a document and resolve with the diagnostics the server publishes
     *  for it. Servers publish in PASSES — tsserver sends a (usually empty) syntax pass and the semantic
     *  verdict right after — so resolving on the first publish would return a false "no problems" for a
     *  file whose errors are semantic. Instead, each publish (re)arms a `settleMs` quiescence timer and the
     *  LAST published set wins; `timeoutMs` caps the whole wait. If the server publishes NOTHING in time,
     *  resolves `published: false` — "no verdict yet", never a false all-clear. Throws only if the server
     *  is gone (so the manager can evict + respawn). */
    async diagnose(path, text, language, timeoutMs = 4000, settleMs = 1000) {
        if (this.disposed)
            throw new Error('language server disposed');
        const uri = pathToFileURL(path).href;
        // A single LSP document has one current version. Queue a different-content check behind the current
        // one; otherwise an unversioned publish could satisfy both callers with the wrong document state.
        // The loop matters when multiple changed-content calls arrive while the first one is still running.
        while (true) {
            const active = this.diagnosesByUri.get(uri);
            if (!active)
                break;
            if (active.language === language && active.text === text)
                return active.promise;
            await active.promise;
            if (this.disposed)
                throw new Error('language server disposed');
        }
        const promise = this.runOnUri(uri, () => this.diagnoseCurrent(uri, text, language, timeoutMs, settleMs));
        const active = { language, text, promise };
        this.diagnosesByUri.set(uri, active);
        try {
            return await promise;
        }
        finally {
            // A later queued call may already own the slot; never delete its entry from an older finally.
            if (this.diagnosesByUri.get(uri) === active)
                this.diagnosesByUri.delete(uri);
            // The document cap may have been exceeded while every eviction candidate was being diagnosed.
            // Enforce it as soon as one of those documents becomes idle.
            this.trimDocuments();
        }
    }
    async diagnoseCurrent(uri, text, language, timeoutMs, settleMs) {
        await this.start();
        const previous = this.documents.get(uri);
        if (previous?.language === language && previous.text === text && previous.confirmed !== undefined) {
            this.touchDocument(uri, previous);
            return { diagnostics: previous.confirmed, published: true };
        }
        // didOpen exactly once; every later probe is didChange. Invalidate a previous verdict before the
        // update so a quiet/busy server can never turn a stale clean result into a fresh all-clear.
        const version = (previous?.version ?? 0) + 1;
        const document = { language, version, text };
        if (!previous)
            this.evictDocumentsFor(uri);
        else
            this.documents.delete(uri); // reinsert below → newest in the LRU order
        this.documents.set(uri, document);
        const wait = new Promise((resolve, reject) => {
            const waiters = this.diagnosticWaiters.get(uri) ?? new Set();
            this.diagnosticWaiters.set(uri, waiters);
            let latest = null;
            let settle;
            let overall;
            let finished = false;
            const cleanup = () => {
                if (finished)
                    return false;
                finished = true;
                if (settle)
                    clearTimeout(settle);
                if (overall)
                    clearTimeout(overall);
                waiters.delete(entry);
                if (waiters.size === 0)
                    this.diagnosticWaiters.delete(uri);
                return true;
            };
            const finish = () => {
                if (!cleanup())
                    return;
                // Only cache the quiesced, final publish and only if this exact document version is still open.
                // A timeout with no publish deliberately leaves the document unconfirmed.
                if (latest?.published && this.documents.get(uri) === document)
                    document.confirmed = latest.diagnostics;
                resolve(latest ?? { diagnostics: [], published: false });
            };
            const entry = {
                publish: (diagnostics) => {
                    if (finished)
                        return;
                    latest = { diagnostics, published: true };
                    if (settle)
                        clearTimeout(settle);
                    settle = setTimeout(finish, settleMs);
                    settle.unref?.();
                },
                fail: (error) => { if (cleanup())
                    reject(error); },
            };
            waiters.add(entry);
            overall = setTimeout(finish, timeoutMs);
            overall.unref?.();
        });
        if (!previous) {
            this.notify('textDocument/didOpen', { textDocument: { uri, languageId: language, version, text } });
        }
        else {
            this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] });
        }
        return wait;
    }
    touchDocument(uri, document) {
        this.documents.delete(uri);
        this.documents.set(uri, document);
    }
    /** Bound cached text/verdict memory and tell the server it may release the corresponding document. */
    evictDocumentsFor(incomingUri) {
        const cap = Math.max(1, Math.floor(this.maxDocuments));
        while (this.documents.size >= cap && this.evictOldestIdleDocument(incomingUri)) { /* trim */ }
    }
    trimDocuments() {
        const cap = Math.max(1, Math.floor(this.maxDocuments));
        while (this.documents.size > cap && this.evictOldestIdleDocument()) { /* trim */ }
    }
    /** Never didClose a document whose diagnostics are still in flight. If every candidate is active,
     *  the soft memory cap may be exceeded briefly and trimDocuments() restores it when one settles. */
    evictOldestIdleDocument(excludeUri) {
        for (const uri of this.documents.keys()) {
            if (uri === excludeUri || this.diagnosesByUri.has(uri))
                continue;
            this.documents.delete(uri);
            this.notify('textDocument/didClose', { textDocument: { uri } });
            return true;
        }
        return false;
    }
    // ── Code-intelligence operations (goToDefinition, findReferences, hover, symbols) ──────────────
    // Each ensures the document is open (didOpen/didChange), then sends the corresponding LSP request
    // and returns the raw result. The caller (lspTools) formats it for the model.
    /** Open or update a document so subsequent requests operate on the current text. Callers must hold the
     *  URI's operation slot (see withDocument): an unserialized didChange is exactly what let one caller's
     *  text answer another caller's pending request. */
    async ensureOpen(path, text, language) {
        if (this.disposed)
            throw new Error('language server disposed');
        await this.start();
        const uri = pathToFileURL(path).href;
        const previous = this.documents.get(uri);
        if (previous?.language === language && previous.text === text) {
            this.touchDocument(uri, previous);
            return;
        }
        const version = (previous?.version ?? 0) + 1;
        const document = { language, version, text };
        if (!previous)
            this.evictDocumentsFor(uri);
        else
            this.documents.delete(uri);
        this.documents.set(uri, document);
        if (!previous) {
            this.notify('textDocument/didOpen', { textDocument: { uri, languageId: language, version, text } });
        }
        else {
            this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] });
        }
    }
    /** Update the document and run one request against it as a single exclusive unit (see runOnUri), so
     *  the server answers for exactly the text this call opened. */
    withDocument(path, text, language, op) {
        const uri = pathToFileURL(path).href;
        return this.runOnUri(uri, async () => {
            await this.ensureOpen(path, text, language);
            return op(uri);
        });
    }
    /** textDocument/definition — where a symbol is defined. */
    async definition(path, text, language, line, character, timeoutMs = 8000) {
        return this.withDocument(path, text, language, async (uri) => {
            const res = await this.request('textDocument/definition', {
                textDocument: { uri }, position: { line: line - 1, character: character - 1 },
            }, timeoutMs);
            return res.result;
        });
    }
    /** textDocument/references — all references to a symbol. */
    async references(path, text, language, line, character, timeoutMs = 8000) {
        return this.withDocument(path, text, language, async (uri) => {
            const res = await this.request('textDocument/references', {
                textDocument: { uri }, position: { line: line - 1, character: character - 1 },
                context: { includeDeclaration: true },
            }, timeoutMs);
            return res.result;
        });
    }
    /** textDocument/hover — documentation and type info for a symbol. */
    async hover(path, text, language, line, character, timeoutMs = 8000) {
        return this.withDocument(path, text, language, async (uri) => {
            const res = await this.request('textDocument/hover', {
                textDocument: { uri }, position: { line: line - 1, character: character - 1 },
            }, timeoutMs);
            return res.result;
        });
    }
    /** textDocument/documentSymbol — all symbols (functions, classes, variables) in a document. */
    async documentSymbol(path, text, language, timeoutMs = 8000) {
        return this.withDocument(path, text, language, async (uri) => {
            const res = await this.request('textDocument/documentSymbol', { textDocument: { uri } }, timeoutMs);
            return res.result;
        });
    }
    /** workspace/symbol — search for symbols across the entire workspace. */
    async workspaceSymbol(query, timeoutMs = 8000) {
        await this.start();
        const res = await this.request('workspace/symbol', { query }, timeoutMs);
        return res.result;
    }
    dispose() {
        if (this.disposed)
            return;
        // Best-effort graceful shutdown, then drop the transport. `shutdown` is a REQUEST in LSP (it needs
        // an id or conformant servers reject it as malformed); we fire it without awaiting the response.
        try {
            this.transport.send(encodeMessage({ jsonrpc: '2.0', id: this.nextId++, method: 'shutdown', params: null }));
            this.notify('exit', null);
        }
        catch { /* transport may be dead */ }
        this.close(new Error('language server disposed'));
        this.transport.dispose();
    }
}
