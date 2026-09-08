import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LspClient, spawnStdioTransport, type Diagnostic, type LspTransport } from './client.js';
import { canonical, pathWithin } from './paths.js';
import { commandExists, detectLanguage, listServers, serverForLanguage, type LanguageServerSpec } from './servers.js';

/** The outcome of checking one file. `skipped` explains a non-check so the agent gets honest, correctly
 *  actionable guidance instead of silence or a wrong "install a server" hint:
 *   - not-a-known-language: the extension isn't code Elowen type-checks.
 *   - unsupported-language: it IS code, but Elowen has no server registered for it (installing won't help).
 *   - no-server-installed: Elowen knows the server, but it isn't on PATH (installing WILL help).
 *   - server-error: the server is installed but crashed/timed out on this check.
 *   - no-response: the server is up but published no verdict in time (likely still indexing) —
 *     crucially NOT reported as "no problems".
 *   - crash-looping: the server died on every spawn and hit the crash-restart cap, so it is no longer
 *     respawned (installing or re-checking won't help — the server itself is broken).
 *   - unreadable / disabled / cancelled: file couldn't be read / LSP is toggled off / the caller's
 *     turn was cancelled while the check was in flight. */
export interface CheckResult {
  path: string;
  language?: string;
  server?: string;
  diagnostics: Diagnostic[];
  skipped?: 'not-a-known-language' | 'unsupported-language' | 'no-server-installed' | 'server-error' | 'no-response' | 'crash-looping' | 'unreadable' | 'disabled' | 'cancelled';
  /** The exhausted restart budget, present only on `crash-looping` so the text can name it. */
  maxRestarts?: number;
}

/** Why a code-intelligence operation (definition/references/hover/symbols) produced nothing — kept
 *  distinct so the tool reports the ACTUAL cause (LSP off / not code / no server installed / crash)
 *  instead of a misleading "not found". `ok:true` carries the raw LSP result (which may itself be an
 *  empty/`null` answer the caller renders as "none found"). */
export interface LspOpFailure {
  ok: false;
  reason: 'disabled' | 'not-a-known-language' | 'unsupported-language' | 'no-server-installed' | 'server-error' | 'crash-looping' | 'unreadable' | 'cancelled';
  language?: string;
  server?: string;
  /** The exhausted restart budget, present only on `crash-looping` so the text can name it. */
  maxRestarts?: number;
}
export type LspOpResult<T> = { ok: true; result: T } | LspOpFailure;

/** One registry server as the status surfaces see it: whether its binary is on PATH, whether a live
 *  client for it is currently running, whether Elowen can install it itself (npm), and the human install
 *  command to show otherwise. */
interface LspServerStatus { language: string; label: string; command: string; installed: boolean; running: boolean; installable: boolean; installHint: string }

/** The manager's health at a glance — reused by every UI (CLI /lsp modal, panels, REST). */
export interface LspStatus { enabled: boolean; running: boolean; servers: LspServerStatus[] }

/** Injected so tests drive the manager with a fake transport instead of spawning real servers. */
export interface LspManagerDeps {
  spawn?: (spec: LanguageServerSpec, cwd: string) => LspTransport | null | Promise<LspTransport | null>;
  readFile?: (path: string) => string | Promise<string>;
  projectRoot?: (path: string, boundary?: string) => string | Promise<string>;
  /** Optional access boundary/default project root. Production passes the current turn's allowed root;
   *  tests may pin one. The nearest project marker is selected without walking above this directory. */
  root?: string;
  /** PATH probe for status(); injectable so tests don't depend on the host's installed binaries. */
  exists?: (command: string) => boolean;
  /** Wait for the FIRST check on a freshly spawned server — generous, it covers project indexing. */
  firstCheckTimeoutMs?: number;
  /** Wait for re-checks against a warm server. */
  recheckTimeoutMs?: number;
  /** Quiescence window after a publish before the verdict is trusted (servers publish in passes). */
  settleMs?: number;
  /** Hard daemon-wide cap for server+project processes (LRU, default 8). */
  maxClients?: number;
  /** Consecutive crashes tolerated per server+project before it stops being respawned (default 3). */
  maxRestarts?: number;
}

const PROJECT_MARKERS = [
  '.git', 'package.json', 'tsconfig.json', 'jsconfig.json', 'pyproject.toml', 'setup.py',
  'go.mod', 'Cargo.toml', 'CMakeLists.txt', 'compile_commands.json',
] as const;

/** Find the closest project-looking ancestor of `path`, bounded by `boundary` when supplied. With no
 *  marker, use the boundary (a known allowed project) or the file's own directory — never the daemon's
 *  process.cwd(), which is `/` under systemd. */
export function projectRootForFile(path: string, boundary?: string): string {
  const start = canonical(dirname(path));
  const candidate = boundary ? canonical(boundary) : undefined;
  const floor = candidate && pathWithin(start, candidate) ? candidate : undefined;
  let current = start;
  while (true) {
    // With no explicit boundary, never promote the filesystem root merely because it happens to carry
    // a marker. A file nested in some checkout must not recreate the old daemon-wide `/` workspace.
    if (!floor && current !== start && dirname(current) === current) break;
    if (PROJECT_MARKERS.some((marker) => existsSync(join(current, marker)))) return current;
    if (current === floor) break;
    const parent = dirname(current);
    if (parent === current || (floor && !pathWithin(parent, floor))) break;
    current = parent;
  }
  return floor ?? start;
}

interface ManagedClient {
  key: string;
  command: string;
  /** The project root this client is spawned against — the scoping key for workspace/symbol so a
   *  daemon-wide singleton never hands one caller symbols from another tenant's project. */
  root: string;
  client: LspClient;
  activeChecks: number;
  retired: boolean;
  /** Becomes true only after this server has returned a real publishDiagnostics verdict. Merely finding
   *  an already-created client does not mean its project index has finished its cold start. */
  warmed: boolean;
  /** Files which already produced a real verdict on this client. A warm server can still need the full
   *  startup window for the first semantic pass of a newly opened file. */
  checkedPaths: Set<string>;
}

/** Owns the live language-server clients (one per server binary + project root, lazily spawned and reused) and turns a
 *  file path into diagnostics. Enable/disable is a single flag the `/lsp` toggle flips — when off,
 *  `checkFile` is a cheap no-op and no servers are spawned. */
export class LspManager {
  /** Insertion order is the reusable-client LRU. Retired clients are detached from lookup immediately,
   *  but remain alive until their already-running checks settle. */
  private clients = new Map<string, ManagedClient>();
  private retiredClients = new Set<ManagedClient>();
  /** Diagnostics for one server+project share tsserver's project index. Queue them so a burst of agent
   *  probes cannot make the cold server analyze several newly opened files at once. */
  private diagnosticQueues = new Map<string, Promise<unknown>>();
  /** Consecutive crashes per client key. A server that dies on every spawn was previously respawned on
   *  every single call; the count caps that and is cleared as soon as one client answers. */
  private restarts = new Map<string, number>();
  private enabled = true;
  private epoch = 0;
  private readonly spawnFn: NonNullable<LspManagerDeps['spawn']>;
  private readonly readFile: NonNullable<LspManagerDeps['readFile']>;
  private readonly projectRoot: NonNullable<LspManagerDeps['projectRoot']>;
  private readonly root?: string;
  private readonly exists: (command: string) => boolean;
  private readonly firstCheckTimeoutMs: number;
  private readonly recheckTimeoutMs: number;
  private readonly settleMs: number;
  private readonly maxClients: number;
  private readonly maxRestarts: number;

  constructor(deps: LspManagerDeps = {}) {
    this.spawnFn = deps.spawn ?? spawnStdioTransport;
    this.projectRoot = deps.projectRoot ?? projectRootForFile;
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
    this.maxRestarts = Math.max(1, Math.floor(deps.maxRestarts ?? 3));
  }

  isEnabled(): boolean { return this.enabled; }
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.disposeAll(); // free the servers when the user turns LSP off
  }

  /** Whether at least one language server is currently alive. */
  isRunning(): boolean {
    return this.allClients().some((entry) => !entry.client.isDisposed());
  }

  /** Enabled/running plus a per-server row (installed on PATH? client alive?) — the single status
   *  accessor every UI reads (the CLI /lsp modal, GET /brain/lsp, any panel indicator). */
  status(): LspStatus {
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

  async statusAsync(): Promise<LspStatus> { return this.status(); }

  /** Wait for `operation`, or for the caller's cancellation, whichever lands first. The warm client the
   *  operation drives outlives the call by design, so an abort-winner leaves the loser running with its
   *  rejection observed (never unhandled) and its eventual verdict discarded. `done:false` only when the
   *  signal fired — a discriminator, because `clientFor` and the operations can legitimately return null. */
  private async cancellable<T>(operation: () => Promise<T>, signal: AbortSignal | undefined): Promise<{ done: true; value: T } | { done: false }> {
    if (!signal) return { done: true, value: await operation() };
    if (signal.aborted) return { done: false };
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        signal.removeEventListener('abort', onAbort);
        resolve({ done: false });
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) { onAbort(); return; }
      let done: Promise<T>;
      try { done = operation(); }
      catch (error) { signal.removeEventListener('abort', onAbort); reject(error); return; }
      void done.then(
        (value) => { signal.removeEventListener('abort', onAbort); resolve({ done: true, value }); },
        (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
      );
    });
  }

  /** The pid the server watchdog should follow. A host server shares this process namespace, so the
   *  daemon's own pid is exactly right; a guest server does not, which is why this is overridable. */
  protected watchdogProcessId(): number | null {
    return process.pid;
  }

  /** Type-check one file and return its diagnostics (or why it was skipped). Never throws — a spawn or
   *  server failure degrades to a `skipped`/empty result so it can't break the agent's edit loop. */
  async checkFile(path: string, boundary?: string, signal?: AbortSignal): Promise<CheckResult> {
    if (!this.enabled) return { path, diagnostics: [], skipped: 'disabled' };
    const epoch = this.epoch;
    const language = detectLanguage(path);
    if (!language) return { path, diagnostics: [], skipped: 'not-a-known-language' };
    const spec = serverForLanguage(language);
    if (!spec) return { path, language, diagnostics: [], skipped: 'unsupported-language' };
    const root = await this.projectRoot(path, boundary ?? this.root);
    const key = this.keyFor(spec, root);

    return this.queueDiagnostic(key, async () => {
      // A queued probe may outlive an /lsp disable; do not respawn after disposeAll().
      if (!this.enabled || this.epoch !== epoch) return { path, diagnostics: [], skipped: 'disabled' };
      if (signal?.aborted) return { path, language, diagnostics: [], skipped: 'cancelled' };
      let text: string;
      try { text = await this.readFile(path); }
      catch { return { path, language, diagnostics: [], skipped: 'unreadable' }; }
      if (!this.enabled || this.epoch !== epoch) return { path, diagnostics: [], skipped: 'disabled' };
      const raced = await this.cancellable(() => this.clientFor(spec, root, signal), signal);
      if (!raced.done) return { path, language, server: spec.label, diagnostics: [], skipped: 'cancelled' };
      const entry = raced.value;
      if (entry === 'crash-looping') return { path, language, server: spec.label, diagnostics: [], skipped: 'crash-looping', maxRestarts: this.maxRestarts };
      if (!entry) return { path, language, server: spec.label, diagnostics: [], skipped: 'no-server-installed' };
      entry.activeChecks++;
      try {
        // A file's first semantic pass can be slow even after another file warmed the project. Only an
        // already-confirmed path gets the short re-check window used for the edit loop.
        const timeoutMs = entry.warmed && entry.checkedPaths.has(path) ? this.recheckTimeoutMs : this.firstCheckTimeoutMs;
        const verdict = await this.cancellable(
          () => entry.client.diagnose(path, text, language, timeoutMs, this.settleMs), signal);
        if (!verdict.done) {
          // Unversioned publishes from the abandoned text must never satisfy a later check.
          this.retire(entry, 'quarantine');
          return { path, language, server: spec.label, diagnostics: [], skipped: 'cancelled' };
        }
        const { diagnostics, published } = verdict.value;
        // No verdict within the window: say so instead of a false "no problems" — the worst possible
        // answer for an agent probe is a wrong all-clear.
        if (!published) {
          // publishDiagnostics is often unversioned. After a timeout, a delayed verdict for text A could
          // otherwise satisfy the next check for text B on the same URI. Quarantine the whole client;
          // the next probe starts with a fresh server and cannot consume that stale publish.
          this.retire(entry, 'quarantine');
          return { path, language, server: spec.label, diagnostics: [], skipped: 'no-response' };
        }
        entry.warmed = true;
        entry.checkedPaths.add(path);
        this.restarts.delete(key); // a real verdict clears the crash budget for this server+project
        return { path, language, server: spec.label, diagnostics };
      } catch {
        // The server crashed/timed out — drop the client so the next check re-spawns, and say so honestly
        // (NOT "no server installed", which would send the agent chasing an install it already has).
        this.retire(entry, 'crash');
        return { path, language, server: spec.label, diagnostics: [], skipped: 'server-error' };
      } finally {
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
  private async withClient<T>(path: string, boundary: string | undefined, op: (client: LspClient, text: string, language: string) => Promise<T>, signal?: AbortSignal): Promise<LspOpResult<T>> {
    if (!this.enabled) return { ok: false, reason: 'disabled' };
    const epoch = this.epoch;
    const language = detectLanguage(path);
    if (!language) return { ok: false, reason: 'not-a-known-language' };
    const spec = serverForLanguage(language);
    if (!spec) return { ok: false, reason: 'unsupported-language', language };
    if (signal?.aborted) return { ok: false, reason: 'cancelled', language };
    let text: string;
    try { text = await this.readFile(path); } catch { return { ok: false, reason: 'unreadable', language }; }
    const root = await this.projectRoot(path, boundary ?? this.root);
    if (!this.enabled || this.epoch !== epoch) return { ok: false, reason: 'disabled' };
    const raced = await this.cancellable(() => this.clientFor(spec, root, signal), signal);
    if (!raced.done) return { ok: false, reason: 'cancelled', language };
    const entry = raced.value;
    if (entry === 'crash-looping') return { ok: false, reason: 'crash-looping', language, server: spec.label, maxRestarts: this.maxRestarts };
    if (!entry) return { ok: false, reason: 'no-server-installed', language, server: spec.label };
    entry.activeChecks++;
    try {
      const result = await this.cancellable(() => op(entry.client, text, language), signal);
      // A cancelled call is the CALLER's decision, not a server fault: it must neither retire the warm
      // client as a crash nor answer with a misleading "not found".
      if (!result.done) return { ok: false, reason: 'cancelled', language };
      this.restarts.delete(entry.key); // the server answered — it is not crash-looping
      return { ok: true, result: result.value };
    } catch {
      // A cancelled call is the CALLER's decision, not a server fault: it must neither retire the warm
      // client as a crash nor answer with a misleading "not found".
      if (signal?.aborted) return { ok: false, reason: 'cancelled', language };
      this.retire(entry, 'crash');
      return { ok: false, reason: 'server-error', language, server: spec.label };
    } finally {
      this.release(entry);
    }
  }

  async definition(path: string, line: number, character: number, boundary?: string, signal?: AbortSignal): Promise<LspOpResult<unknown>> {
    return this.withClient(path, boundary, (c, text, lang) => c.definition(path, text, lang, line, character), signal);
  }

  async references(path: string, line: number, character: number, boundary?: string, signal?: AbortSignal): Promise<LspOpResult<unknown>> {
    return this.withClient(path, boundary, (c, text, lang) => c.references(path, text, lang, line, character), signal);
  }

  async hover(path: string, line: number, character: number, boundary?: string, signal?: AbortSignal): Promise<LspOpResult<unknown>> {
    return this.withClient(path, boundary, (c, text, lang) => c.hover(path, text, lang, line, character), signal);
  }

  async documentSymbol(path: string, boundary?: string, signal?: AbortSignal): Promise<LspOpResult<unknown>> {
    return this.withClient(path, boundary, (c, text, lang) => c.documentSymbol(path, text, lang), signal);
  }

  /** workspace/symbol across the caller's project(s). SECURITY: the manager is a daemon-wide singleton
   *  shared by every user, so results are taken ONLY from clients whose root is inside `boundary` (the
   *  caller's allowed scope) — never a client rooted in another tenant's project. When nothing in scope
   *  is live yet, a server is spawned for the boundary root so the tool works on a cold session. */
  async workspaceSymbol(query: string, boundary?: string, signal?: AbortSignal): Promise<LspOpResult<unknown[]>> {
    if (!this.enabled) return { ok: false, reason: 'disabled' };
    const epoch = this.epoch;
    if (signal?.aborted) return { ok: false, reason: 'cancelled' };
    const boundaryRoot = boundary ?? this.root;
    const within = (root: string): boolean => {
      if (!boundaryRoot) return true; // all-access (no boundary) — every live client is in scope
      const base = canonical(boundaryRoot);
      const candidate = canonical(root);
      return candidate === base || pathWithin(candidate, base);
    };
    let inScope = [...this.clients.values()].filter((e) => !e.client.isDisposed() && within(e.root));
    if (inScope.length === 0) {
      if (!boundaryRoot) return { ok: false, reason: 'no-server-installed' };
      // Cold session: spawn the first installed server for the boundary's nearest project root.
      const root = await this.projectRoot(join(boundaryRoot, '_probe'), boundaryRoot);
      if (!this.enabled || this.epoch !== epoch) return { ok: false, reason: 'disabled' };
      const raced = await this.cancellable(() => this.spawnAnyClientFor(root, signal), signal);
      if (!raced.done) return { ok: false, reason: 'cancelled' };
      const entry = raced.value;
      if (entry === 'crash-looping') return { ok: false, reason: 'crash-looping', maxRestarts: this.maxRestarts };
      if (!entry) return { ok: false, reason: 'no-server-installed' };
      inScope = [entry];
    }
    const merged: unknown[] = [];
    for (const entry of inScope) {
      entry.activeChecks++;
      try {
        const raced = await this.cancellable(() => entry.client.workspaceSymbol(query), signal);
        if (!raced.done) return { ok: false, reason: 'cancelled' };
        this.restarts.delete(entry.key);
        if (Array.isArray(raced.value)) merged.push(...raced.value);
      } catch {
        this.retire(entry, 'crash');
      } finally {
        this.release(entry);
      }
    }
    return { ok: true, result: merged };
  }

  /** Spawn (or reuse) any installed language server for `root` — used by workspace/symbol on a cold
   *  session, where there is no file to pick a language from. First registered server that spawns wins.
   *  Reports the crash cap only when it is the reason nothing came up, so a merely uninstalled registry
   *  still reads as "no server installed". */
  private async spawnAnyClientFor(root: string, signal?: AbortSignal): Promise<ManagedClient | 'crash-looping' | null> {
    let capped = false;
    for (const spec of listServers()) {
      const entry = await this.clientFor(spec, root, signal);
      if (entry === 'crash-looping') { capped = true; continue; }
      if (entry) return entry;
    }
    return capped ? 'crash-looping' : null;
  }

  private keyFor(spec: LanguageServerSpec, root: string): string { return `${spec.command}\0${root}`; }

  /** Run one diagnostics probe at a time for a server+project. Different projects and server binaries
   *  remain independent, while a failure in one queued probe never poisons the next. */
  private queueDiagnostic<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.diagnosticQueues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.diagnosticQueues.set(key, current);
    return current.finally(() => {
      if (this.diagnosticQueues.get(key) === current) this.diagnosticQueues.delete(key);
    });
  }

  private hasRunningClient(spec: LanguageServerSpec): boolean {
    return this.allClients().some((entry) => entry.command === spec.command && !entry.client.isDisposed());
  }

  private allClients(): ManagedClient[] {
    return [...this.clients.values(), ...this.retiredClients];
  }

  private async clientFor(spec: LanguageServerSpec, root: string, signal?: AbortSignal): Promise<ManagedClient | 'crash-looping' | null> {
    if (signal?.aborted) return null;
    const key = this.keyFor(spec, root);
    const existing = this.clients.get(key);
    if (existing && !existing.client.isDisposed()) {
      // Map insertion order is the LRU queue. A hit becomes newest.
      this.clients.delete(key);
      this.clients.set(key, existing);
      return existing;
    }
    if (existing) this.retire(existing, 'crash'); // a crashed/exited server client — evict and respawn below
    // A server broken enough to die on every spawn was respawned on every single call, burning a process
    // per tool call and answering "errored or timed out (it will be retried)" forever. Give up after
    // maxRestarts consecutive crashes and report that instead.
    if ((this.restarts.get(key) ?? 0) >= this.maxRestarts) return 'crash-looping';
    const epoch = this.epoch;
    const transport = await this.spawnFn(spec, root);
    if (!transport) return null;
    if (!this.enabled || this.epoch !== epoch || signal?.aborted) { transport.dispose(); return null; }
    const concurrent = this.clients.get(key);
    if (concurrent && !concurrent.client.isDisposed()) {
      transport.dispose();
      return concurrent;
    }
    this.makeRoomForClient();
    const client = new LspClient(transport, root, undefined, this.watchdogProcessId());
    const entry: ManagedClient = {
      key, command: spec.command, root, client, activeChecks: 0, retired: false, warmed: false, checkedPaths: new Set(),
    };
    this.clients.set(key, entry);
    return entry;
  }

  /** Evict the oldest reusable client which is not serving a diagnostics call. When every client is busy,
   *  allow a temporary cap overflow; release() trims it as soon as one client becomes idle. */
  private makeRoomForClient(): void {
    while (this.clients.size >= this.maxClients) {
      const idle = [...this.clients.values()].find((entry) => entry.activeChecks === 0);
      if (!idle) break;
      this.clients.delete(idle.key);
      idle.retired = true;
      idle.client.dispose();
    }
  }

  private trimClients(): void {
    while (this.clients.size > this.maxClients) {
      const idle = [...this.clients.values()].find((entry) => entry.activeChecks === 0);
      if (!idle) break;
      this.clients.delete(idle.key);
      idle.retired = true;
      idle.client.dispose();
    }
  }

  /** Remove a failed/no-verdict client from future lookup now, without aborting unrelated checks already
   *  using it. Identity guards ensure an old request can never retire a replacement at the same key.
   *
   *  Only a `crash` counts against the restart budget, and only the first time this client is retired: a
   *  `quarantine` is a healthy but slow server whose verdict missed the window, and capping those would
   *  leave a big project permanently unchecked. */
  private retire(entry: ManagedClient, cause: 'crash' | 'quarantine'): void {
    if (cause === 'crash' && !entry.retired) this.restarts.set(entry.key, (this.restarts.get(entry.key) ?? 0) + 1);
    if (this.clients.get(entry.key) === entry) this.clients.delete(entry.key);
    entry.retired = true;
    if (!entry.client.isDisposed()) this.retiredClients.add(entry);
    if (entry.activeChecks === 0) this.disposeRetired(entry);
  }

  private release(entry: ManagedClient): void {
    entry.activeChecks = Math.max(0, entry.activeChecks - 1);
    if (entry.activeChecks === 0 && entry.retired) this.disposeRetired(entry);
    this.trimClients();
  }

  private disposeRetired(entry: ManagedClient): void {
    this.retiredClients.delete(entry);
    entry.client.dispose();
  }

  disposeAll(): void {
    this.epoch++;
    const all = this.allClients();
    this.clients.clear();
    this.retiredClients.clear();
    // Toggling LSP off and on is the operator's "I fixed the server" signal — start from a clean budget.
    this.restarts.clear();
    for (const entry of all) {
      entry.retired = true;
      entry.client.dispose();
    }
  }
}

/** Explain a failed code-intelligence operation to the agent — mirrors formatCheckResult's honest,
 *  actionable wording (off / not code / install-would-help / server error). Returns null when there is
 *  no useful explanation (the caller then renders its own "No X found."). */
export function formatLspFailure(f: LspOpFailure): string | null {
  switch (f.reason) {
    case 'disabled': return 'LSP is off (/lsp to enable).';
    case 'not-a-known-language': return null;
    case 'unsupported-language': return `LSP doesn't cover ${f.language} (no language server registered for it).`;
    case 'no-server-installed': return `The ${f.server ?? f.language ?? 'required'} language server isn't installed — install it to use this.`;
    case 'server-error': return `The ${f.server ?? f.language} language server errored or timed out — no result this time (it will be retried).`;
    case 'crash-looping': return `The ${f.server ?? f.language} language server exceeded max crash recovery attempts (${f.maxRestarts ?? 3}) — no result, and it will NOT be restarted again until LSP is toggled off and on (/lsp).`;
    case 'unreadable': return 'Could not read the file.';
    case 'cancelled': return 'LSP: the request was cancelled before the server answered — re-issue it if still needed.';
  }
}

/** Render a CheckResult as a compact, agent-readable summary line block (used by the lsp tool + hook). */
export function formatCheckResult(r: CheckResult): string {
  if (r.skipped === 'not-a-known-language') return '';
  if (r.skipped === 'unsupported-language') return `LSP doesn't cover ${r.language} (no language server registered for it).`;
  if (r.skipped === 'disabled') return 'LSP is off (/lsp to enable).';
  if (r.skipped === 'no-server-installed') return `The ${r.server ?? r.language} language server isn't installed — install it to get ${r.language} diagnostics.`;
  if (r.skipped === 'server-error') return `The ${r.server ?? r.language} language server errored or timed out — no diagnostics this time (it will be retried).`;
  if (r.skipped === 'crash-looping') return `The ${r.server ?? r.language} language server exceeded max crash recovery attempts (${r.maxRestarts ?? 3}) — no diagnostics, and it will NOT be restarted again until LSP is toggled off and on (/lsp).`;
  if (r.skipped === 'no-response') return `The ${r.server ?? r.language} language server gave no verdict on ${r.path} in time (it may still be indexing) — NOT a clean bill, re-check shortly.`;
  if (r.skipped === 'unreadable') return `Could not read ${r.path}.`;
  if (r.skipped === 'cancelled') return 'LSP: the check was cancelled before the server answered — re-issue it if still needed.';
  if (r.diagnostics.length === 0) return `✓ ${r.path}: no problems (${r.server}).`;
  const lines = r.diagnostics.slice(0, 20).map((d) => `  ${d.severity} ${r.path}:${d.line}:${d.column} — ${d.message}${d.source ? ` (${d.source})` : ''}`);
  const errors = r.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = r.diagnostics.filter((d) => d.severity === 'warning').length;
  const more = r.diagnostics.length > 20 ? `\n  … +${r.diagnostics.length - 20} more` : '';
  return `${r.path}: ${errors} error(s), ${warnings} warning(s) (${r.server})\n${lines.join('\n')}${more}`;
}
