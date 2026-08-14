import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { FORMATTERS, buildCommand, configNumber, register, resolveFormatter } from '../plugins/formatters/index.mjs';

const dirs = [];
const tmpDir = (tag) => {
  const p = mkdtempSync(join(tmpdir(), `elowen-${tag}-`));
  dirs.push(p);
  return p;
};
const cleanup = () => {
  for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true });
};

/** Drop an executable fake binary (shell script) at `path`. */
const fakeBin = (path, body = '#!/bin/sh\nexit 0\n') => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
};

/** A temp project with a fake local prettier that marks each formatted file with `<file>.formatted`. */
const projectWithPrettier = () => {
  const dir = tmpDir('fmt');
  fakeBin(join(dir, 'node_modules/.bin/prettier'), '#!/bin/sh\necho formatted > "$2.formatted"\n');
  return dir;
};

const writeResult = (path) => ({ tool: 'Write', params: { path }, result: { content: [], details: { ok: true, path } } });

/** The plugin under a stub host: the hook it registers, the log it wrote, and a settable work dir. */
const loadHook = (config = {}, workDir = null) => {
  const lines = [];
  const hooks = [];
  const tools = [];
  const state = { workDir };
  register({
    config,
    logger: { info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) },
    registerHook: (h) => hooks.push(h),
    registerTool: (t) => tools.push(t),
    currentWorkDir: () => state.workDir ?? undefined,
  });
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].name, 'tools.call.after');
  assert.equal(tools.length, 0);
  return { hook: hooks[0], lines, tools, state };
};

const fire = async (loaded, workDir, payload) => {
  loaded.state.workDir = workDir;
  return loaded.hook.run(payload);
};

test('catalog resolution — extension plus the project gate', async (t) => {
  t.after(cleanup);

  await t.test('resolves by extension only when the project gate passes (local prettier bin)', () => {
    const dir = projectWithPrettier();
    assert.equal(resolveFormatter(join(dir, 'a.ts'), dir)?.name, 'prettier');
    assert.equal(resolveFormatter(join(dir, 'notes.md'), dir)?.name, 'prettier');
    assert.equal(resolveFormatter(join(dir, 'x.php'), dir), null); // no vendor/bin/pint
    assert.equal(resolveFormatter(join(dir, 'x.unknown'), dir), null);
    assert.equal(resolveFormatter(join(dir, 'Makefile'), dir), null); // no extension
  });

  await t.test('an empty project enables nothing, even for known extensions', () => {
    const dir = tmpDir('fmt-empty');
    assert.equal(resolveFormatter(join(dir, 'a.ts'), dir), null);
    assert.equal(resolveFormatter(join(dir, 'a.go'), dir), null);
  });

  await t.test('pint is gated on vendor/bin/pint being present', () => {
    const dir = tmpDir('fmt-php');
    assert.equal(resolveFormatter(join(dir, 'x.php'), dir), null);
    fakeBin(join(dir, 'vendor/bin/pint'));
    assert.equal(resolveFormatter(join(dir, 'x.php'), dir)?.name, 'pint');
  });

  await t.test('an explicit biome config wins over a merely present prettier bin (catalog order)', () => {
    const dir = projectWithPrettier();
    fakeBin(join(dir, 'node_modules/.bin/biome'));
    writeFileSync(join(dir, 'biome.json'), '{}');
    assert.equal(resolveFormatter(join(dir, 'a.ts'), dir)?.name, 'biome');
  });

  await t.test('a disabled formatter is skipped', () => {
    const dir = projectWithPrettier();
    assert.equal(resolveFormatter(join(dir, 'a.ts'), dir, new Set(['prettier'])), null);
  });

  await t.test('buildCommand substitutes $FILE and falls back to the PATH binary when the local bin is absent', () => {
    const dir = projectWithPrettier();
    const prettier = FORMATTERS.find((f) => f.name === 'prettier');
    assert.deepEqual(buildCommand(prettier, dir, join(dir, 'a.ts')), ['node_modules/.bin/prettier', '--write', join(dir, 'a.ts')]);
    const bare = tmpDir('fmt-bare');
    assert.equal(buildCommand(prettier, bare, join(bare, 'a.ts'))[0], 'prettier');
  });
});

test('enabledWhen against PATH binaries (temp PATH)', async (t) => {
  const oldPath = process.env.PATH;
  const binDir = mkdtempSync(join(tmpdir(), 'elowen-fmt-bin-'));
  fakeBin(join(binDir, 'ruff'));
  fakeBin(join(binDir, 'gofmt'));
  process.env.PATH = binDir;
  t.after(() => {
    process.env.PATH = oldPath;
    rmSync(binDir, { recursive: true, force: true });
    cleanup();
  });

  await t.test('ruff needs BOTH the binary on PATH and a project ruff config', () => {
    const dir = tmpDir('fmt-py');
    assert.equal(resolveFormatter(join(dir, 'a.py'), dir), null); // binary alone is not enough
    writeFileSync(join(dir, 'ruff.toml'), '');
    assert.equal(resolveFormatter(join(dir, 'a.py'), dir)?.name, 'ruff');
  });

  await t.test('ruff also accepts a pyproject.toml that mentions ruff', () => {
    const dir = tmpDir('fmt-py2');
    writeFileSync(join(dir, 'pyproject.toml'), '[tool.poetry]\n');
    assert.equal(resolveFormatter(join(dir, 'a.py'), dir), null);
    writeFileSync(join(dir, 'pyproject.toml'), '[tool.ruff]\nline-length = 100\n');
    assert.equal(resolveFormatter(join(dir, 'a.py'), dir)?.name, 'ruff');
  });

  await t.test('gofmt needs go.mod, not just the binary', () => {
    const dir = tmpDir('fmt-go');
    assert.equal(resolveFormatter(join(dir, 'main.go'), dir), null);
    writeFileSync(join(dir, 'go.mod'), 'module example.com/x\n');
    assert.equal(resolveFormatter(join(dir, 'main.go'), dir)?.name, 'gofmt');
  });

  await t.test('gofmt stays off when the binary is missing from PATH, even with go.mod', () => {
    process.env.PATH = tmpDir('fmt-nobin');
    try {
      const dir = tmpDir('fmt-go2');
      writeFileSync(join(dir, 'go.mod'), 'module example.com/x\n');
      assert.equal(resolveFormatter(join(dir, 'main.go'), dir), null);
    } finally {
      process.env.PATH = binDir;
    }
  });
});

test('tools.call.after hook flow', async (t) => {
  t.after(cleanup);

  await t.test('formats a written file with the project formatter, logs it and annotates the result (details.notes)', async () => {
    const loaded = loadHook();
    const dir = projectWithPrettier();
    const file = join(dir, 'src', 'a.ts');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'const x=1');
    const payload = writeResult(file);
    await fire(loaded, dir, payload);
    assert.equal(existsSync(`${file}.formatted`), true);
    assert.ok(loaded.lines.some((l) => l.includes(`formatted ${file} with prettier`)));
    // The awaited tools.call.after contract: a successful format appends a transcript note in place.
    assert.deepEqual(payload.result.details.notes, ['formatted a.ts with prettier']);
  });

  await t.test('invalidates the files-plugin details.diff after a successful format (never a diff that contradicts disk)', async () => {
    const loaded = loadHook();
    const dir = projectWithPrettier();
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'const x=1');
    const payload = writeResult(file);
    // The files plugin computed this diff at write time; the reformat below rewrites the file on disk.
    payload.result.details.diff = '-    1 const x=1\n+    1 const x = 1;';
    await fire(loaded, dir, payload);
    // The stale pre-format diff is dropped; only the note survives (messageView falls back to notes-only).
    assert.equal(payload.result.details.diff, undefined);
    assert.deepEqual(payload.result.details.notes, ['formatted a.ts with prettier']);
  });

  await t.test('keeps details.diff when the formatter fails — the file on disk is unchanged, so the diff still matches', async () => {
    const loaded = loadHook();
    const dir = tmpDir('fmt-difffail');
    fakeBin(join(dir, 'node_modules/.bin/prettier'), '#!/bin/sh\nexit 3\n');
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'const x=1');
    const payload = writeResult(file);
    payload.result.details.diff = 'DIFF';
    await fire(loaded, dir, payload);
    assert.equal(payload.result.details.diff, 'DIFF');
    assert.equal(payload.result.details.notes, undefined);
  });

  await t.test('appends its note to an EXISTING details.notes array instead of clobbering it', async () => {
    const loaded = loadHook();
    const dir = projectWithPrettier();
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'const x=1');
    const payload = writeResult(file);
    payload.result.details.notes = ['earlier note'];
    await fire(loaded, dir, payload);
    assert.deepEqual(payload.result.details.notes, ['earlier note', 'formatted a.ts with prettier']);
  });

  await t.test('rejects a path outside the current work dir (resolve + prefix check)', async () => {
    const loaded = loadHook();
    const dir = projectWithPrettier();
    const outside = tmpDir('fmt-out');
    const file = join(outside, 'a.ts');
    writeFileSync(file, 'const x=1');
    await fire(loaded, dir, writeResult(file));
    assert.equal(existsSync(`${file}.formatted`), false);
    // `..` traversal that resolves outside is refused too
    const sneaky = join(dir, '..', 'a.ts');
    await fire(loaded, dir, writeResult(sneaky));
    assert.equal(existsSync(`${resolve(sneaky)}.formatted`), false);
  });

  await t.test('skips files larger than 1MB', async () => {
    const loaded = loadHook();
    const dir = projectWithPrettier();
    const file = join(dir, 'big.ts');
    writeFileSync(file, Buffer.alloc(1024 * 1024 + 1, 0x61));
    await fire(loaded, dir, writeResult(file));
    assert.equal(existsSync(`${file}.formatted`), false);
  });

  await t.test('ignores non-write tools and failed write results', async () => {
    const loaded = loadHook();
    const dir = projectWithPrettier();
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'const x=1');
    await fire(loaded, dir, { tool: 'Read', params: { path: file }, result: { content: [], details: { ok: true, path: file } } });
    await fire(loaded, dir, { tool: 'Write', params: { path: file }, result: { content: [], details: { ok: false, path: file } } });
    await fire(loaded, dir, { tool: 'Write', params: {}, result: { content: [], details: { ok: true } } }); // no path
    await fire(loaded, dir, undefined); // malformed payload
    assert.equal(existsSync(`${file}.formatted`), false);
  });

  await t.test('honors the master toggle (enabled: false)', async () => {
    const loaded = loadHook({ enabled: false });
    const dir = projectWithPrettier();
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'const x=1');
    await fire(loaded, dir, writeResult(file));
    assert.equal(existsSync(`${file}.formatted`), false);
  });

  await t.test('honors the per-formatter disabled list', async () => {
    const loaded = loadHook({ disabled: ['prettier'] });
    const dir = projectWithPrettier();
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'const x=1');
    await fire(loaded, dir, writeResult(file));
    assert.equal(existsSync(`${file}.formatted`), false);
  });

  await t.test('logs a warning (fail-soft) when the formatter binary exits non-zero — and appends NO note', async () => {
    const loaded = loadHook();
    const dir = tmpDir('fmt-fail');
    fakeBin(join(dir, 'node_modules/.bin/prettier'), '#!/bin/sh\nexit 3\n');
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'const x=1');
    const payload = writeResult(file);
    await assert.doesNotReject(() => fire(loaded, dir, payload));
    assert.ok(loaded.lines.some((l) => l.includes('formatter prettier failed')));
    assert.equal(payload.result.details.notes, undefined);
  });

  await t.test('does nothing without a turn work dir', async () => {
    const loaded = loadHook();
    const dir = projectWithPrettier();
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'const x=1');
    await fire(loaded, null, writeResult(file)); // no workDir bound
    assert.equal(existsSync(`${file}.formatted`), false);
  });

  await t.test('applies a configured maxFileBytes override (skips a file the 1MB default would still format)', async () => {
    const loaded = loadHook({ maxFileBytes: 262144 }); // schema min
    const dir = projectWithPrettier();
    const file = join(dir, 'mid.ts');
    writeFileSync(file, Buffer.alloc(300_000, 0x61)); // under the 1MB default, over the configured cap
    await fire(loaded, dir, writeResult(file));
    assert.equal(existsSync(`${file}.formatted`), false);
  });

  await t.test('applies a configured timeoutMs override (kills a subprocess the 10s default would let finish)', async () => {
    const loaded = loadHook({ timeoutMs: 5000 }); // schema min
    const dir = tmpDir('fmt-timeout');
    fakeBin(join(dir, 'node_modules/.bin/prettier'), '#!/bin/sh\nsleep 6\n');
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'const x=1');
    await fire(loaded, dir, writeResult(file));
    assert.ok(loaded.lines.some((l) => l.includes('formatter prettier failed')));
  });
});

test('configNumber clamps a config override into the schema range', () => {
  assert.equal(configNumber(undefined, 10_000, 5000, 60_000), 10_000); // unset -> RUN_TIMEOUT_MS default
  assert.equal(configNumber(20_000, 10_000, 5000, 60_000), 20_000); // in-range override
  assert.equal(configNumber(1, 10_000, 5000, 60_000), 5000); // clamped to min
  assert.equal(configNumber(999_999, 10_000, 5000, 60_000), 60_000); // clamped to max
  assert.equal(configNumber(undefined, 1_048_576, 262_144, 10_485_760), 1_048_576); // unset -> MAX_FILE_BYTES default
});
