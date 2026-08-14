import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from '../plugins/dev-commands/index.mjs';

const fakeCtx = (config = {}) => {
  const commands = [];
  const warnings = [];
  return {
    commands,
    warnings,
    ctx: {
      config,
      logger: { info() {}, warn: (m) => warnings.push(m), error() {} },
      registerCommand: (c) => commands.push(c),
    },
  };
};

test('registers the full curated set when no selection is configured', () => {
  const { commands, ctx } = fakeCtx();
  register(ctx);
  assert.deepEqual(commands.map((c) => c.name).sort(), ['commit', 'docs', 'explain', 'pr', 'review', 'test']);
  for (const c of commands) {
    assert.ok(c.description.trim().length > 0);
    // Every macro takes an argument through the host's native placeholder — the host expands it on send.
    assert.ok(c.prompt.includes('$ARGUMENTS'));
  }
});

test('registers only the selected commands when configured', () => {
  const { commands, ctx } = fakeCtx({ enabled: ['commit', 'review'] });
  register(ctx);
  assert.deepEqual(commands.map((c) => c.name).sort(), ['commit', 'review']);
});

test('an empty selection falls back to all commands', () => {
  const { commands, ctx } = fakeCtx({ enabled: [] });
  register(ctx);
  assert.equal(commands.length, 6);
});

test('an unknown command name is warned about, not silently dropped or registered', () => {
  const { commands, warnings, ctx } = fakeCtx({ enabled: ['commit', 'nope'] });
  register(ctx);
  assert.deepEqual(commands.map((c) => c.name), ['commit']);
  assert.ok(warnings.some((w) => w.includes('nope')));
});
