import test from 'node:test';
import assert from 'node:assert/strict';
import { validateServerInput } from '../plugins/mcp/index.mjs';

test('MCP rejects credential-bearing remote URLs', () => {
  assert.throws(
    () => validateServerInput({ name: 'remote', transport: 'http', url: 'https://user:password@example.test/mcp' }),
    /must not contain credentials or secret query parameters/,
  );
  assert.throws(
    () => validateServerInput({ name: 'remote', transport: 'sse', url: 'https://example.test/mcp?access_token=secret' }),
    /must not contain credentials or secret query parameters/,
  );
});

test('MCP accepts a remote URL without embedded secrets', () => {
  assert.deepEqual(
    validateServerInput({ name: 'remote', transport: 'http', url: 'https://example.test/mcp?project=docs' }),
    { name: 'remote', enabled: true, transport: 'http', url: 'https://example.test/mcp?project=docs' },
  );
});

test('MCP leaves environment absent when an edit does not replace it', () => {
  assert.deepEqual(
    validateServerInput({ name: 'local', transport: 'stdio', command: 'node' }),
    { name: 'local', enabled: true, transport: 'stdio', command: 'node', args: [] },
  );
});
