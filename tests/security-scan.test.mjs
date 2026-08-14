import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { register, scan } from '../plugins/security-scan/index.mjs';

// The stub HOST. In the daemon the plugin is handed a context built by the plugin loader, and the tool is
// invoked inside `runWithPolicy(ADMIN, …)` so `ctx.assertPathAllowed` resolves against the turn's policy.
// This plugin reads exactly three seams, so that is all the stub supplies — an admin session resolves any
// path, which is what the ADMIN policy in the source test does.
const makeHost = () => {
  const tools = [];
  register({
    logger: { info() {}, warn() {}, error() {} },
    registerTool: (tool) => tools.push(tool),
    assertPathAllowed: (path) => resolve(path),
  });
  return {
    tools,
    runTool: (name, params) => {
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw new Error(`tool ${name} not registered`);
      return tool.execute('t', params);
    },
  };
};

const asText = (result) => result.content[0].text;

describe('security-scan plugin', () => {
  it('scan() flags dangerous patterns with severity + line numbers', () => {
    const code = [
      'const x = 1;',
      'eval(userInput);',
      'import pickle',
      'data = pickle.loads(raw)',
      'subprocess.run(cmd, shell=True)',
      'const key = "api_key: abcdef0123456789xyz"',
    ].join('\n');
    const f = scan(code);
    const ids = f.map((x) => x.id);
    assert.ok(ids.includes('js-eval'));
    assert.ok(ids.includes('pickle'));
    assert.ok(ids.includes('shell-true'));
    assert.equal(f.find((x) => x.id === 'pickle').sev, 'danger');
    // a clean line is not flagged
    assert.equal(f.some((x) => x.line === 1), false);
  });

  it('ScanCode tool returns a clean bill for safe code', async () => {
    const host = makeHost();
    const res = await host.runTool('ScanCode', { code: 'const a = 1 + 1;' });
    assert.match(asText(res), /No risky patterns/);
  });
});
