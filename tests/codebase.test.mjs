import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import {
  chunkFile,
  cosine,
  packVector,
  planIncremental,
  readConfig,
  register,
  splitList,
  unpackVector,
} from '../plugins/codebase/index.mjs';

const log = { info() {}, warn() {}, error() {} };

// ── the stub HOST ────────────────────────────────────────────────────────────────────────────────────
// In the daemon the plugin is driven through two pieces of machinery this repo does not have:
// `loadPlugins({ dirs, enabled, dataRoot, embeddings, embeddingConfig, config })`, which builds the
// `ctx` a plugin sees, and `runWithPolicy(policy, fn, { workDir })`, which binds the turn's policy and
// working directory to an AsyncLocalStorage that `ctx.isAdminSession()` / `ctx.allowedRoots()` /
// `ctx.defaultCwd()` / `ctx.assertPathAllowed()` read at execute time.
//
// Both are replaced here by `makeHost`, which supplies exactly the seams the plugin reads and keeps the
// "current turn" in a plain mutable `session` object: `asAdmin(workDir)` is the stand-in for
// runWithPolicy(adminPolicy(), …, { workDir }), `asUser(roots)` for runWithPolicy(userPolicy(roots), …).
// One `makeHost(...)` call == one `loadPlugins(...)` call: `register()` runs once and its closures (the
// single-flight map, the lazily opened database) are per-host, so a test that needs a fresh generation —
// a plugin reload — simply builds a second host over the same dataRoot.

/** Resolve through symlinks, falling back to the closest existing ancestor for a path that does not
 *  exist yet — the daemon's pathGuard.realAbs, which is what makes the root check symlink-safe. */
const realAbs = (p) => {
  const abs = resolve(p);
  const missing = [];
  let cur = abs;
  for (;;) {
    try {
      const real = realpathSync(cur);
      return missing.length ? join(real, ...missing) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return abs;
      missing.unshift(basename(cur));
      cur = parent;
    }
  }
};

const within = (abs, root) => {
  const real = realAbs(root); // the root itself may be reached through a symlink
  const base = real.endsWith(sep) ? real.slice(0, -1) : real;
  return abs === base || abs.startsWith(base + sep);
};

/** Mirrors the host's isEmbeddingConfigured: a usable model plus somewhere to send it. */
const isEmbeddingConfigured = (cfg) => !!cfg && cfg.model.trim() !== '' && (!!cfg.providerId || !!cfg.baseUrl);

const makeHost = ({ dataRoot, config = {}, embeddings, embeddingConfig }) => {
  const tools = [];
  const platforms = [];
  const session = { admin: true, roots: [], workDir: undefined };

  // The live embedding config, re-read on every call — the daemon reads it per call too, so switching
  // the model in Settings → Memory applies without a plugin reload.
  const liveCfg = () => {
    const cfg = embeddingConfig();
    return isEmbeddingConfigured(cfg) ? cfg : null;
  };
  const requireCfg = () => {
    const cfg = liveCfg();
    if (!cfg) throw new Error('embeddings not configured (set the embedding model in Settings → Memory)');
    return cfg;
  };

  const ctx = {
    config,
    logger: log,
    dataDir: () => {
      const dir = join(dataRoot, 'codebase');
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    registerTool: (tool) => tools.push(tool),
    registerPlatform: (platform) => platforms.push(platform),
    isAdminSession: () => session.admin,
    allowedRoots: () => session.roots,
    defaultCwd: () => session.workDir ?? session.roots[0] ?? process.cwd(),
    assertPathAllowed: (p) => {
      const abs = realAbs(p);
      if (session.admin) return abs; // all-access session: every path resolves
      if (session.roots.some((root) => within(abs, root))) return abs;
      throw new Error(`path is outside your accessible repositories: ${p}`);
    },
    embeddings: {
      isConfigured: () => liveCfg() !== null,
      descriptor: () => {
        const cfg = liveCfg();
        return cfg ? { provider: cfg.providerId ?? cfg.baseUrl ?? '', model: cfg.model, dimensions: cfg.dimensions ?? null } : null;
      },
      embed: async (text) => embeddings.embed(requireCfg(), text),
      embedBatch: async (texts) => embeddings.embedBatch(requireCfg(), texts),
    },
  };

  register(ctx);

  return {
    tools,
    platforms,
    runTool: (name, params) => {
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw new Error(`tool ${name} not registered`);
      return tool.execute('t', params);
    },
    asAdmin: (workDir) => { session.admin = true; session.roots = []; session.workDir = workDir; },
    asUser: (roots, workDir) => { session.admin = false; session.roots = roots; session.workDir = workDir; },
    indexer: () => {
      const found = platforms.find((p) => p.name === 'codebase-index');
      if (!found) throw new Error('scheduled indexer not registered');
      return found;
    },
  };
};

// A deterministic bag-of-words "embedder": each text maps to a fixed-width vector of vocab-word counts.
// Cosine over these vectors gives real, meaningful ranking (shared vocab → higher score) with zero network.
const VOCAB = ['cosine', 'similarity', 'vector', 'dot', 'product', 'background', 'job', 'embedding', 'queue', 'missing', 'memory', 'http', 'client', 'search', 'index'];
const fakeVec = (text) => {
  const t = text.toLowerCase();
  return Float32Array.from(VOCAB.map((w) => (t.match(new RegExp(w, 'g'))?.length ?? 0)));
};
const fakeEmbedder = {
  embed: async (_cfg, text) => fakeVec(text),
  embedBatch: async (_cfg, texts) => texts.map(fakeVec),
};

// Every repo/data root a test mints goes through here so it is removed afterwards: this file alone
// used to leave ~40 directories in the system temp dir on each run.
let dirs = [];
const tmpDir = (tag) => { const p = mkdtempSync(join(tmpdir(), `elowen-${tag}-`)); dirs.push(p); return p; };
afterEach(() => { for (const p of dirs) rmSync(p, { recursive: true, force: true }); dirs = []; });

// ── pure exports ─────────────────────────────────────────────────────────────────────────────────────
describe('codebase plugin — pure helpers', () => {
  it('chunkFile: contiguous 1-based ranges covering the whole file, bounded by chunkMaxChars', () => {
    const src = Array.from({ length: 30 }, (_, i) => `const line${i} = ${i}; // some code content here`).join('\n');
    const chunks = chunkFile(src, 'src/a.ts', { chunkMaxChars: 200, chunkMaxLines: 6 });
    assert.ok(chunks.length > 1);
    assert.equal(chunks[0].startLine, 1);
    for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i].startLine, chunks[i - 1].endLine + 1);
    assert.equal(chunks.at(-1).endLine, 30);
    for (const c of chunks) assert.ok(c.body.length <= 200);
  });

  it('chunkFile: extracts a TS function symbol and a Markdown heading', () => {
    const ts = chunkFile('export function verifyToken(t) {\n  return check(t);\n}', 'auth.ts', {});
    assert.equal(ts[0].symbol, 'verifyToken');
    const md = chunkFile('## Retry backoff\n\nWe wait before retrying.', 'docs/notes.md', {});
    assert.equal(md[0].symbol, 'Retry backoff');
  });

  it('chunkFile: empty/whitespace file yields no chunks', () => {
    assert.deepEqual(chunkFile('   \n\n  ', 'x.ts', {}), []);
  });

  it('planIncremental: skips unchanged, re-indexes edited/new, prunes vanished', () => {
    const disk = [{ path: 'a', hash: '1' }, { path: 'b', hash: '2new' }, { path: 'c', hash: '3' }];
    const dbFiles = [{ path: 'a', file_hash: '1' }, { path: 'b', file_hash: '2old' }, { path: 'd', file_hash: '4' }];
    const plan = planIncremental(disk, dbFiles, {});
    assert.deepEqual(plan.toIndex.sort(), ['b', 'c']); // b edited, c new; a unchanged
    assert.deepEqual(plan.toPrune, ['d']);             // d gone from disk
  });

  it('planIncremental: a model switch re-embeds only the not-yet-converted files (convergence, #4)', () => {
    const disk = [{ path: 'a', hash: '1' }, { path: 'b', hash: '2' }];
    const dbFiles = [{ path: 'a', file_hash: '1' }, { path: 'b', file_hash: '2' }];
    // Both files still under the old model → both rebuilt this pass.
    assert.deepEqual(planIncremental(disk, dbFiles, { stalePaths: new Set(['a', 'b']) }).toIndex.sort(), ['a', 'b']);
    // 'a' was reconverted in an earlier pass and dropped out of the stale set → only 'b' remains. This is
    // the convergence guarantee: the leading file is NOT re-embedded every pass, so `pending` shrinks.
    assert.deepEqual(planIncremental(disk, dbFiles, { stalePaths: new Set(['b']) }).toIndex, ['b']);
    assert.deepEqual(planIncremental(disk, dbFiles, { full: true }).toIndex.sort(), ['a', 'b']); // full → all
    assert.deepEqual(planIncremental(disk, dbFiles, {}).toIndex, []); // no staleness, unchanged → nothing
  });

  it('packVector/unpackVector: round-trips a Float32Array bit-exact', () => {
    const v = Float32Array.from([0.125, -2.5, 3.1415927, 0, 1e-9, -1e9]);
    const round = unpackVector(packVector(v));
    assert.equal(round.length, v.length);
    for (let i = 0; i < v.length; i++) assert.equal(round[i], v[i]);
  });

  it('cosine: 1 for identical, 0 for orthogonal or length-mismatch', () => {
    assert.ok(Math.abs(cosine(Float32Array.from([1, 2, 3]), Float32Array.from([1, 2, 3])) - 1) < 5e-7);
    assert.equal(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1])), 0);
    assert.equal(cosine(Float32Array.from([1, 0]), Float32Array.from([1, 0, 0])), 0);
  });

  it('splitList accepts legacy strings without splitting brace-glob commas and preserves array tokens', () => {
    assert.deepEqual(
      splitList('src/**/*.{ts,tsx}, docs/**\nREADME.md'),
      ['src/**/*.{ts,tsx}', 'docs/**', 'README.md'],
    );
    assert.deepEqual(
      splitList(['src/**/*.{ts,tsx}', 'fixtures/a,b/**', '  docs/**  ']),
      ['src/**/*.{ts,tsx}', 'fixtures/a,b/**', 'docs/**'],
    );
  });

  it('readConfig degrades malformed config input to safe defaults', () => {
    const cfg = readConfig(null);
    assert.equal(cfg.topK, 8);
    assert.equal(cfg.reindexScope, 'indexed');
    assert.deepEqual(cfg.reindexRepos, []);
    assert.equal(cfg.autoReindex, true);
  });
});

// ── integration: real better-sqlite3 index over a fixture repo, driven through the stub host ──────────
describe('codebase plugin — index + search', () => {
  let host;
  let repo1;
  let repo2;
  let dataRoot;
  let liveCfg;

  // These three are indexed once and then queried by every test below, so they outlive a single test
  // and are swept only after the describe finishes — not by the module-level afterEach.
  after(() => { for (const p of [dataRoot, repo1, repo2]) rmSync(p, { recursive: true, force: true }); });

  before(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'elowen-cb-data-'));
    repo1 = mkdtempSync(join(tmpdir(), 'elowen-cb-r1-'));
    repo2 = mkdtempSync(join(tmpdir(), 'elowen-cb-r2-'));
    liveCfg = { providerId: 'p', model: 'fake-1', dimensions: VOCAB.length };

    mkdirSync(join(repo1, 'src'), { recursive: true });
    // A chunk rich in cosine/similarity/vector/dot/product vocabulary.
    writeFileSync(join(repo1, 'src', 'math.ts'),
      'export function cosineSimilarity(a, b) {\n  // cosine similarity of two vector inputs: dot product over norms\n  let dot = 0;\n  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];\n  return dot;\n}\n');
    // A chunk about the background embedding queue filling missing memory embeddings.
    writeFileSync(join(repo1, 'src', 'queue.ts'),
      'export class EmbeddingQueue {\n  // background job that fills in missing memory embedding vectors\n  drain() { return this.background(); }\n}\n');
    // A non-included file that must never be indexed.
    writeFileSync(join(repo1, 'notes.bin'), 'cosine cosine cosine');
    // repo2 has its own cosine content — used to prove scoping keeps it invisible to a repo1-only session.
    writeFileSync(join(repo2, 'other.ts'), 'export function cosineOther(a, b) { return dot(a, b); } // cosine similarity vector\n');

    host = makeHost({ dataRoot, embeddings: fakeEmbedder, embeddingConfig: () => liveCfg });
  });

  it('declares exactly its three tools', () => {
    assert.deepEqual(host.tools.map((t) => t.name).sort(), ['CodebaseReindex', 'CodebaseSearch', 'CodebaseStatus']);
  });

  it('reindex (admin) writes a real index.db with chunk rows carrying the configured model', async () => {
    host.asAdmin(repo1);
    const res = await host.runTool('CodebaseReindex', { repo: repo1 });
    assert.equal(res.details.ok, true);
    assert.ok(res.details.chunksEmbedded > 0);

    const db = new Database(join(dataRoot, 'codebase', 'index.db'), { readonly: true });
    const paths = db.prepare('SELECT DISTINCT path FROM chunks ORDER BY path').all().map((r) => r.path);
    assert.ok(paths.includes('src/math.ts'));
    assert.ok(paths.includes('src/queue.ts'));
    assert.ok(!paths.includes('notes.bin')); // excluded by include-globs
    const models = db.prepare('SELECT DISTINCT model, dimensions FROM chunks').all();
    assert.deepEqual(models, [{ model: 'fake-1', dimensions: VOCAB.length }]);
    db.close();
  });

  it('search ranks the semantically closest chunk first and drops sub-floor hits', async () => {
    host.asUser([repo1]);
    const res = await host.runTool('CodebaseSearch', { query: 'cosine similarity of two vectors', k: 5 });
    assert.equal(res.details.ok, true);
    const text = res.content[0].text;
    // math.ts (cosine/similarity/vector/dot/product) beats queue.ts (background/job/embedding).
    assert.ok(text.indexOf('src/math.ts') >= 0);
    assert.ok(text.split('\n')[0].includes('src/math.ts'));
    // queue.ts shares no vocab with this query → score 0 < floor → filtered out entirely.
    assert.ok(!text.includes('src/queue.ts'));
  });

  it('a different query surfaces the background-embedding-queue chunk', async () => {
    host.asUser([repo1]);
    const res = await host.runTool('CodebaseSearch', { query: 'background job that fills in missing memory embeddings' });
    assert.ok(res.content[0].text.split('\n')[0].includes('src/queue.ts'));
  });

  it('a pathGlob narrows results to matching files', async () => {
    host.asUser([repo1]);
    const res = await host.runTool('CodebaseSearch', { query: 'cosine similarity vector', pathGlob: 'src/queue.ts' });
    assert.ok(!res.content[0].text.includes('src/math.ts'));
  });

  it('repo scoping: a repo1-only session never sees repo2 chunks', async () => {
    // Index repo2 as admin, then search as a repo1-scoped user — repo2 must stay invisible.
    host.asAdmin(repo2);
    await host.runTool('CodebaseReindex', { repo: repo2 });
    host.asUser([repo1]);
    const scoped = await host.runTool('CodebaseSearch', { query: 'cosine similarity vector dot product' });
    assert.ok(!scoped.content[0].text.includes('other.ts'));
    // An admin (all-access, no roots) CAN see repo2's chunk.
    host.asAdmin(repo1);
    const admin = await host.runTool('CodebaseSearch', { query: 'cosine similarity vector dot product' });
    assert.ok(admin.content[0].text.includes('other.ts'));
  });

  it('a project-scoped session can reindex its accessible repository', async () => {
    host.asUser([repo1]);
    const res = await host.runTool('CodebaseReindex', { repo: repo1 });
    assert.equal(res.details.ok, true);
    assert.ok(!res.content[0].text.includes('admin session'));
  });

  it('an incremental reindex re-embeds only edited files and prunes deleted ones', async () => {
    const edited = tmpDir('cb-inc');
    writeFileSync(join(edited, 'keep.ts'), 'export function keep() { return 1; } // cosine vector\n');
    writeFileSync(join(edited, 'gone.ts'), 'export function gone() { return 2; } // dot product\n');
    host.asAdmin(edited);
    await host.runTool('CodebaseReindex', { repo: edited });

    // Edit one file (new content), delete the other.
    writeFileSync(join(edited, 'keep.ts'), 'export function keep() { return 42; } // cosine similarity vector product changed\n');
    rmSync(join(edited, 'gone.ts'));
    const res = await host.runTool('CodebaseReindex', { repo: edited });
    assert.equal(res.details.filesChanged, 1); // only keep.ts re-embedded
    assert.equal(res.details.pruned, 1);       // gone.ts pruned

    const db = new Database(join(dataRoot, 'codebase', 'index.db'), { readonly: true });
    const rows = db.prepare('SELECT path FROM chunks WHERE repo = ?').all(realAbs(edited)).map((r) => r.path);
    assert.ok(rows.includes('keep.ts'));
    assert.ok(!rows.includes('gone.ts'));
    db.close();
  });

  it('switching the embedding model marks the repo stale and rebuilds it under the new model', async () => {
    const stale = tmpDir('cb-stale');
    writeFileSync(join(stale, 'a.ts'), 'export function alpha() { return 1; } // cosine vector\n');
    host.asAdmin(stale);
    await host.runTool('CodebaseReindex', { repo: stale });

    liveCfg = { providerId: 'p', model: 'fake-2', dimensions: VOCAB.length }; // operator switched the model
    const res = await host.runTool('CodebaseReindex', { repo: stale });
    assert.ok(res.details.chunksEmbedded > 0); // rebuilt despite no file edit

    const db = new Database(join(dataRoot, 'codebase', 'index.db'), { readonly: true });
    const models = db.prepare('SELECT DISTINCT model FROM chunks WHERE repo = ?').all(realAbs(stale)).map((r) => r.model);
    assert.deepEqual(models, ['fake-2']);
    db.close();
    liveCfg = { providerId: 'p', model: 'fake-1', dimensions: VOCAB.length }; // restore for later tests
  });

  it('status reports per-repo coverage and the configured model', async () => {
    host.asUser([repo1]);
    const res = await host.runTool('CodebaseStatus', {});
    assert.equal(res.details.ok, true);
    assert.ok(res.content[0].text.includes('fake-1'));
    assert.ok(res.content[0].text.includes(realAbs(repo1)));
  });

  it('search returns a clear failure (not a throw) when no embedding model is configured', async () => {
    const off = tmpDir('cb-off');
    const hostOff = makeHost({
      dataRoot: off,
      embeddings: fakeEmbedder,
      embeddingConfig: () => ({ providerId: '', model: '', dimensions: null }),
    });
    hostOff.asUser([repo1]);
    const res = await hostOff.runTool('CodebaseSearch', { query: 'anything' });
    assert.equal(res.details.ok, false);
    assert.ok(res.content[0].text.toLowerCase().includes('embedding'));
  });
});

const waitFor = async (cond, ms = 3000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const chunkCount = (dataRoot, sql = 'SELECT COUNT(*) AS n FROM chunks', ...params) => {
  const db = new Database(join(dataRoot, 'codebase', 'index.db'), { readonly: true });
  const n = db.prepare(sql).get(...params).n;
  db.close();
  return n;
};

// ── batch3 regression fixes (#4 convergence, #5 scoping, #6 debounce, #8 latency, #9 memory) ────────────
describe('codebase plugin — batch3 fixes', () => {
  // #4 — a budget-capped model switch must CONVERGE: each pass converts a fresh batch, so `pending`
  // strictly shrinks and the leading files are never re-embedded forever.
  it('#4 model switch converges under a per-pass budget (pending shrinks 2→1→0)', async () => {
    const dataRoot = tmpDir('cb4-data');
    const repo = tmpDir('cb4-repo');
    for (const [name, word] of [['a', 'cosine'], ['b', 'vector'], ['c', 'dot']])
      writeFileSync(join(repo, `${name}.ts`), `export function ${name}() { return 1; } // ${word} similarity\n`);
    let cfg = { providerId: 'p', model: 'fake-1', dimensions: VOCAB.length };
    const host = makeHost({
      dataRoot,
      config: { reindexEmbedBudget: 1 }, // one chunk per pass so files spread across passes
      embeddings: fakeEmbedder,
      embeddingConfig: () => cfg,
    });
    host.asAdmin(repo);
    const reindex = () => host.runTool('CodebaseReindex', { repo });

    for (let i = 0; i < 3; i++) await reindex(); // fully index under fake-1 (3 passes @ budget 1)
    assert.equal(chunkCount(dataRoot, "SELECT COUNT(*) AS n FROM chunks WHERE model = 'fake-1'"), 3);

    cfg = { providerId: 'p', model: 'fake-2', dimensions: VOCAB.length }; // operator switches the model
    const pendings = [];
    const fake2 = [];
    for (let i = 0; i < 3; i++) {
      const r = await reindex();
      pendings.push(r.details.pending);
      fake2.push(chunkCount(dataRoot, "SELECT COUNT(*) AS n FROM chunks WHERE model = 'fake-2'"));
    }
    assert.deepEqual(pendings, [2, 1, 0]);  // the bug re-embeds the same leading file forever → pending stuck at 2
    assert.deepEqual(fake2, [1, 2, 3]);     // one more file reconverted every pass
    assert.equal(chunkCount(dataRoot, "SELECT COUNT(*) AS n FROM chunks WHERE model = 'fake-1'"), 0); // fully migrated
  });

  // #5 — automatic reindexing on search is limited to all-access sessions; a project-scoped search must
  // never write the index or spend the embedding provider on its own.
  it('#5 a project-scoped search never triggers auto-reindex; an all-access search does', async () => {
    const dataRoot = tmpDir('cb5-data');
    const repo = tmpDir('cb5-repo');
    writeFileSync(join(repo, 'x.ts'), 'export function x() { return 1; } // cosine similarity vector\n');
    const cfg = { providerId: 'p', model: 'fake-1', dimensions: VOCAB.length };
    let embedBatchCalls = 0;
    const embedder = {
      embed: async (_c, t) => fakeVec(t),
      embedBatch: async (_c, texts) => { embedBatchCalls++; return texts.map(fakeVec); },
    };
    const host = makeHost({ dataRoot, embeddings: embedder, embeddingConfig: () => cfg });
    // Project-scoped search: no automatic reindex; the response points at the explicit reindex tool.
    host.asUser([repo]);
    const res = await host.runTool('CodebaseSearch', { query: 'cosine similarity vector' });
    await new Promise((r) => setTimeout(r, 60)); // give any wrongly-fired background pass time to run
    assert.equal(embedBatchCalls, 0);            // the bug fires a full reindex+embed here for a scoped user
    assert.equal(res.details.ok, false);
    assert.ok(res.content[0].text.includes('CodebaseReindex'));
    assert.equal(chunkCount(dataRoot), 0);

    // All-access search kicks the background reindex and chunks appear.
    host.asAdmin(repo);
    await host.runTool('CodebaseSearch', { query: 'cosine similarity vector' });
    await waitFor(() => embedBatchCalls > 0 && chunkCount(dataRoot) > 0);
  });

  // #6 — the debounce must apply even to a repo that indexes to zero chunks (failing provider / all
  // excluded), so a persistently-empty repo can't re-walk + re-embed on every search.
  it('#6 the debounce holds for a repo that keeps indexing to zero chunks', async () => {
    const dataRoot = tmpDir('cb6-data');
    const repo = tmpDir('cb6-repo');
    writeFileSync(join(repo, 'x.ts'), 'export function x() { return 1; } // cosine vector\n');
    const cfg = { providerId: 'p', model: 'fake-1', dimensions: VOCAB.length };
    let embedBatchCalls = 0;
    const embedder = {
      embed: async (_c, t) => fakeVec(t),
      embedBatch: async () => { embedBatchCalls++; throw new Error('provider down'); }, // indexing always fails → stays empty
    };
    const host = makeHost({ dataRoot, embeddings: embedder, embeddingConfig: () => cfg });
    host.asAdmin(repo);
    const adminSearch = () => host.runTool('CodebaseSearch', { query: 'cosine vector' });

    await adminSearch();                         // first search kicks a pass that fails → index still empty
    await waitFor(() => embedBatchCalls === 1);
    await new Promise((r) => setTimeout(r, 60)); // let the failed pass write its debounce marker
    await adminSearch();                         // second search within the window must NOT re-attempt
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(embedBatchCalls, 1);            // the bug bypasses the debounce whenever chunk count is 0 → 2 attempts
    assert.equal(chunkCount(dataRoot), 0);
  });

  // #8 — the search answer must not wait on a full reindex embedding pass (fire-and-forget).
  it('#8 an admin search does not block on the reindex embed pass', async () => {
    const dataRoot = tmpDir('cb8-data');
    const repo = tmpDir('cb8-repo');
    writeFileSync(join(repo, 'seed.ts'), 'export function seed() { return 1; } // cosine similarity vector dot product\n');
    const cfg = { providerId: 'p', model: 'fake-1', dimensions: VOCAB.length };
    const SLOW_MS = 500;
    let slow = false;
    const embedder = {
      embed: async (_c, t) => fakeVec(t), // query embed is always fast
      embedBatch: async (_c, texts) => {
        if (slow) await new Promise((r) => setTimeout(r, SLOW_MS));
        return texts.map(fakeVec);
      },
    };
    const host = makeHost({ dataRoot, embeddings: embedder, embeddingConfig: () => cfg });
    host.asAdmin(repo);
    await host.runTool('CodebaseReindex', { repo }); // seed (fast)

    // Add a file so the next auto-reindex has real (slow) embedding work, and force the repo debounce-stale.
    writeFileSync(join(repo, 'fresh.ts'), 'export function fresh() { return 2; } // cosine vector\n');
    const realRepo = realpathSync(repo);
    const wdb = new Database(join(dataRoot, 'codebase', 'index.db'));
    wdb.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(`reindex:${realRepo}`, '0');
    wdb.close();
    slow = true;

    const t0 = Date.now();
    const res = await host.runTool('CodebaseSearch', { query: 'cosine similarity vector dot product' });
    const elapsed = Date.now() - t0;
    assert.equal(res.details.ok, true);
    assert.ok(res.content[0].text.includes('seed.ts'));  // served from the existing index immediately
    assert.ok(elapsed < SLOW_MS - 150);                  // did NOT wait for the slow reindex embed pass
    await new Promise((r) => setTimeout(r, SLOW_MS + 120)); // let the background pass settle
  });

  // #9 / #4 — search filters by stored MODEL (not vector width) in SQL: a same-width chunk from a foreign
  // model is never cosine-compared, even when its vector is a perfect match for the query.
  it('#9/#4 search never ranks a same-width foreign-model vector', async () => {
    const dataRoot = tmpDir('cb9-data');
    const repo = tmpDir('cb9-repo');
    writeFileSync(join(repo, 'real.ts'), 'export function real() { return 1; } // background job queue\n');
    const cfg = { providerId: 'p', model: 'fake-1', dimensions: VOCAB.length };
    const host = makeHost({ dataRoot, embeddings: fakeEmbedder, embeddingConfig: () => cfg });
    host.asAdmin(repo);
    await host.runTool('CodebaseReindex', { repo });

    // Inject a chunk from a DIFFERENT model but the SAME width, whose vector is a perfect match for the
    // query — the old width-only guard would have ranked it #1; the model filter must exclude it.
    const q = fakeVec('cosine similarity vector');
    const realRepo = realpathSync(repo);
    const wdb = new Database(join(dataRoot, 'codebase', 'index.db'));
    wdb.prepare(`INSERT INTO chunks (repo, path, start_line, end_line, symbol, body, content_hash, model, dimensions, vector)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(realRepo, 'foreign.ts', 1, 1, null, 'cosine similarity vector foreign', 'h', 'other-model', VOCAB.length, Buffer.from(q.buffer, q.byteOffset, q.byteLength));
    wdb.close();

    const res = await host.runTool('CodebaseSearch', { query: 'cosine similarity vector' });
    assert.ok(!res.content[0].text.includes('foreign.ts')); // excluded by the SQL model filter, not compared
  });

  // #7 — the result snippet is line-aware and UTF-8-safe (PI truncateHead/truncateLine), never splitting a
  // multibyte char and never emptying on a lone over-long first line.
  it('#7 snippet truncates an over-long single line without splitting a multibyte char', async () => {
    const dataRoot = tmpDir('cb7-data');
    const repo = tmpDir('cb7-repo');
    // A single line far longer than SNIPPET_MAX_CHARS (400), padded with 3-byte '€' so a naive byte slice
    // could land mid-character. Vocab words make it rank for the query.
    const longLine = `// cosine similarity vector ${'€'.repeat(600)} dot product`;
    writeFileSync(join(repo, 'wide.ts'), `${longLine}\n`);
    const cfg = { providerId: 'p', model: 'fake-1', dimensions: VOCAB.length };
    const host = makeHost({ dataRoot, embeddings: fakeEmbedder, embeddingConfig: () => cfg });
    host.asAdmin(repo);
    await host.runTool('CodebaseReindex', { repo });

    const res = await host.runTool('CodebaseSearch', { query: 'cosine similarity vector dot product' });
    const text = res.content[0].text;
    assert.ok(text.includes('wide.ts'));
    // The over-long line is capped for display and marked — the snippet is never empty.
    assert.ok(text.includes('... [truncated]'));
    // No U+FFFD replacement char: the multibyte '€' sequence was never cut mid-byte.
    assert.ok(!text.includes('\uFFFD'));
  });
});

// ── auto-reindex single-flight: concurrent searches must never run the same repo's pass twice ───────────
describe('codebase plugin — auto-reindex single-flight', () => {
  // An embedder whose every embedBatch call parks on a manual gate, so a pass can be held mid-flight while
  // further callers arrive. With one file per repo, `calls` counts PASSES; `maxConcurrent` records whether
  // two passes ever overlapped.
  const gatedEmbedder = () => {
    let open = () => {};
    const gate = new Promise((r) => { open = r; });
    const state = { calls: 0, concurrent: 0, maxConcurrent: 0 };
    const embedder = {
      embed: async (_c, t) => fakeVec(t), // the query embed never blocks
      embedBatch: async (_c, texts) => {
        state.calls++;
        state.concurrent++;
        state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent);
        await gate;
        state.concurrent--;
        return texts.map(fakeVec);
      },
    };
    return { embedder, state, release: () => open() };
  };

  const seedRepo = (tag) => {
    const dataRoot = tmpDir(`cb-${tag}-data`);
    const repo = tmpDir(`cb-${tag}-repo`);
    writeFileSync(join(repo, 'x.ts'), 'export function x() { return 1; } // cosine similarity vector\n');
    return { dataRoot, repo };
  };
  const cfg = { providerId: 'p', model: 'fake-1', dimensions: VOCAB.length };
  const load = (dataRoot, repo, embeddings) => {
    const host = makeHost({ dataRoot, embeddings, embeddingConfig: () => cfg });
    host.asAdmin(repo);
    return host;
  };
  const search = (host) => host.runTool('CodebaseSearch', { query: 'cosine similarity vector' });

  it('two concurrent admin searches run ONE pass, and the pass outliving the debounce window does not let a third in', async () => {
    const { dataRoot, repo } = seedRepo('sf1');
    const { embedder, state, release } = gatedEmbedder();
    const host = load(dataRoot, repo, embedder);

    // The second search starts while the first one's pass is parked inside embedBatch — a genuine overlap,
    // not two sequential calls: neither has written anything yet when the other checks the debounce.
    const both = Promise.all([search(host), search(host)]);
    await waitFor(() => state.calls > 0);
    await new Promise((r) => setTimeout(r, 50)); // a duplicate pass would have started (and parked) by now
    assert.equal(state.calls, 1);          // the bug: both callers clear the debounce check → 2 passes
    assert.equal(state.maxConcurrent, 1);  // ...running concurrently over the same repo

    // A pass slower than the debounce window must still not be duplicated: expire the marker under the
    // running pass, then search again. Only the in-flight guard can hold this one.
    const wdb = new Database(join(dataRoot, 'codebase', 'index.db'));
    wdb.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(`reindex:${realpathSync(repo)}`, '0');
    wdb.close();
    await search(host);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(state.calls, 1);
    assert.equal(state.maxConcurrent, 1);

    release();
    await both;
    await waitFor(() => chunkCount(dataRoot) > 0); // the single shared pass still indexes the repo
    assert.equal(state.calls, 1);
  });

  const manualReindex = (host, repo, full = false) => host.runTool('CodebaseReindex', { repo, full });

  it('a manual reindex waits for the in-flight pass instead of doubling it — and is never skipped', async () => {
    const { dataRoot, repo } = seedRepo('sf3');
    const { embedder, state, release } = gatedEmbedder();
    const host = load(dataRoot, repo, embedder);

    const auto = search(host); // an admin search kicks a pass that parks inside embedBatch
    await waitFor(() => state.calls > 0);

    const manual = manualReindex(host, repo, true); // full → real embedding work even though the pass indexed it
    await new Promise((r) => setTimeout(r, 50));    // a claim-bypassing manual run would have parked by now
    assert.equal(state.calls, 1);                   // the bug: the manual path calls reindexRepo directly → 2 passes
    assert.equal(state.maxConcurrent, 1);           // ...embedding the same repo concurrently

    release();
    await auto;
    const res = await manual;
    assert.equal(res.details.ok, true);
    assert.ok(res.details.chunksEmbedded > 0); // unlike an auto pass, it still ran
    assert.equal(state.calls, 2);
    assert.equal(state.maxConcurrent, 1);
  });

  it('two manual reindexes queued behind the same pass do not overlap each other', async () => {
    const { dataRoot, repo } = seedRepo('sf4');
    const { embedder, state, release } = gatedEmbedder();
    const host = load(dataRoot, repo, embedder);

    const auto = search(host);
    await waitFor(() => state.calls > 0);

    // Both manual runs queue behind the SAME parked pass, so both are resumed by its completion. Waiting on
    // that one pass is not enough: whichever wakes second must re-check and queue behind the first.
    const first = manualReindex(host, repo, true);
    const second = manualReindex(host, repo, true);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(state.calls, 1);

    release();
    await auto;
    assert.equal((await first).details.ok, true);
    assert.equal((await second).details.ok, true);
    assert.equal(state.calls, 3);         // every explicitly requested run happened
    assert.equal(state.maxConcurrent, 1); // but never two at once over the same repo
  });

  it('a plugin reload does not restart a pass already in flight (the debounce marker is claimed up front)', async () => {
    const { dataRoot, repo } = seedRepo('sf2');
    const { embedder, state, release } = gatedEmbedder();
    const host1 = load(dataRoot, repo, embedder);

    const first = search(host1);
    await waitFor(() => state.calls > 0); // host1's pass is parked inside embedBatch

    // A reload swaps in a fresh closure — empty in-flight map, same index.db. Only a marker written at the
    // START of the pass can tell it that one is already running.
    const host2 = load(dataRoot, repo, embedder);
    await search(host2);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(state.calls, 1);
    assert.equal(state.maxConcurrent, 1);

    release();
    await first;
    await waitFor(() => chunkCount(dataRoot) > 0);
  });
});

// ── scheduled reindexing: the background timer converges a repo with no search and no manual run ────────
describe('codebase plugin — scheduled reindex', () => {
  const cfg = { providerId: 'p', model: 'fake-1', dimensions: VOCAB.length };

  const countingEmbedder = () => {
    const state = { calls: 0 };
    return {
      state,
      embedder: {
        embed: fakeEmbedder.embed,
        embedBatch: async (c, texts) => { state.calls++; return fakeEmbedder.embedBatch(c, texts); },
      },
    };
  };
  const load = (dataRoot, config, embeddings = fakeEmbedder) =>
    makeHost({ dataRoot, config, embeddings, embeddingConfig: () => cfg });
  const seed = (tag, files) => {
    const dataRoot = tmpDir(`cb-${tag}-data`);
    const repo = tmpDir(`cb-${tag}-repo`);
    for (const [name, body] of Object.entries(files)) writeFileSync(join(repo, name), body);
    return { dataRoot, repo };
  };
  const src = (word) => `export function f() { return 1; } // ${word} similarity vector\n`;
  // Expire the shared debounce marker, i.e. make the repo due again without waiting out the interval.
  const expireMarker = (dataRoot, repo) => {
    const db = new Database(join(dataRoot, 'codebase', 'index.db'));
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(`reindex:${realpathSync(repo)}`, '0');
    db.close();
  };

  it('registers the adapter but stays idle while the schedule is off', async () => {
    const { dataRoot, repo } = seed('sch-off', { 'a.ts': src('cosine') });
    const { embedder, state } = countingEmbedder();
    // Scope and paths configured, but scheduledReindex left at its default (false).
    const host = load(dataRoot, { reindexScope: 'listed', reindexRepos: repo }, embedder);
    const indexer = host.indexer();

    await indexer.connect();
    await indexer.tick();

    assert.equal(state.calls, 0); // an unattended timer must not spend the provider until it is asked to
    indexer.disconnect();
  });

  it('indexes only the listed repositories and skips a path that is not a directory', async () => {
    const { dataRoot, repo } = seed('sch-listed', { 'a.ts': src('cosine') });
    const host = load(dataRoot, {
      scheduledReindex: true,
      reindexIntervalMinutes: 5,
      reindexScope: 'listed',
      reindexRepos: `${repo}\n/var/empty/does-not-exist-${Date.now()}`,
    });
    const indexer = host.indexer();

    await indexer.tick(); // the bogus path must be skipped, not thrown on

    assert.equal(chunkCount(dataRoot), 1);
    assert.equal(chunkCount(dataRoot, 'SELECT COUNT(*) AS n FROM chunks WHERE repo = ?', realpathSync(repo)), 1);
    indexer.disconnect();
  });

  it('refreshes a repository the index already holds when the scope is everything indexed', async () => {
    const { dataRoot, repo } = seed('sch-indexed', { 'a.ts': src('cosine') });
    const host = load(dataRoot, { scheduledReindex: true, reindexIntervalMinutes: 5 });
    host.asAdmin(repo);
    await host.runTool('CodebaseReindex', { repo });
    assert.equal(chunkCount(dataRoot), 1);

    writeFileSync(join(repo, 'b.ts'), src('dot')); // a commit lands while nobody searches
    expireMarker(dataRoot, repo);
    await host.indexer().tick();

    assert.equal(chunkCount(dataRoot), 2); // the timer found the repo through the index itself
    host.indexer().disconnect();
  });

  it('converges a repo bigger than one pass within a single tick', async () => {
    const { dataRoot, repo } = seed('sch-conv', { 'a.ts': src('cosine'), 'b.ts': src('vector'), 'c.ts': src('dot') });
    const host = load(dataRoot, {
      scheduledReindex: true,
      reindexIntervalMinutes: 5,
      reindexEmbedBudget: 1, // one chunk per pass, so three files need three passes
      reindexMaxPassesPerRepo: 4,
      reindexScope: 'listed',
      reindexRepos: repo,
    });

    await host.indexer().tick();

    // Follow-up passes must bypass the debounce marker the first pass stamped, or the tick indexes one file
    // and then blocks itself for the whole interval.
    assert.equal(chunkCount(dataRoot), 3);
    host.indexer().disconnect();
  });

  it('a disconnected generation does no further work (a reload must not leave two timers indexing)', async () => {
    const { dataRoot, repo } = seed('sch-stop', { 'a.ts': src('cosine') });
    const { embedder, state } = countingEmbedder();
    const config = { scheduledReindex: true, reindexIntervalMinutes: 5, reindexScope: 'listed', reindexRepos: repo };
    const host1 = load(dataRoot, config, embedder);
    const orphan = host1.indexer();
    await orphan.connect();

    orphan.disconnect(); // the host tears the old generation down right before swapping in the new one
    await orphan.tick();
    assert.equal(state.calls, 0);

    const host2 = load(dataRoot, config, embedder); // the live generation still works
    await host2.indexer().tick();
    assert.equal(state.calls, 1);
    host2.indexer().disconnect();
  });
});
