import assert from 'node:assert/strict';
import test from 'node:test';
import { register, resolveSearchProvider } from '../plugins/web/index.mjs';

/** Registers the plugin with a given config and returns WebSearch plus the captured fetch calls, so
 *  each test drives the REAL tool path (config → provider choice → request → formatting). */
function mount(config, responder) {
  const tools = [];
  register({ config, logger: { info() {} }, registerTool: (tool) => tools.push(tool) });
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return responder ? responder(String(url), init) : new Response('{}', { status: 200 });
  };
  const search = tools.find((tool) => tool.name === 'WebSearch');
  assert.ok(search, 'WebSearch must be registered');
  return { search, calls, restore: () => { globalThis.fetch = original; } };
}

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const textOf = (result) => result.content[0].text;

const SERPER_BODY = {
  answerBox: { answer: '42' },
  organic: [
    { title: 'First hit', link: 'https://example.com/a', snippet: 'Alpha snippet' },
    { title: 'Second hit', link: 'https://example.com/b', snippet: 'Beta snippet' },
  ],
};

test('Serper answers WebSearch with its own endpoint, key header and normalized output', async (t) => {
  const { search, calls, restore } = mount(
    { provider: 'serper', serperApiKey: 'serper-key', maxResults: 2 },
    () => json(SERPER_BODY),
  );
  t.after(restore);

  const text = textOf(await search.execute('call-1', { query: 'meaning of life' }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://google.serper.dev/search');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-api-key'], 'serper-key');
  assert.deepEqual(JSON.parse(calls[0].init.body), { q: 'meaning of life', num: 2 });
  // Same shape Tavily produces: an optional Answer block, then "- title / url / snippet" per result.
  assert.match(text, /^Answer: 42\n\n/);
  assert.match(text, /- First hit\n {2}https:\/\/example\.com\/a\n {2}Alpha snippet/);
  assert.match(text, /- Second hit\n {2}https:\/\/example\.com\/b\n {2}Beta snippet/);
});

test('Serper falls back to the knowledge graph when there is no answer box', async (t) => {
  const { search, restore } = mount(
    { provider: 'serper', serperApiKey: 'serper-key' },
    () => json({ knowledgeGraph: { description: 'A programming language.' }, organic: [] }),
  );
  t.after(restore);

  assert.match(textOf(await search.execute('call-1', { query: 'rust' })), /^Answer: A programming language\./);
});

test('an install carrying only the legacy Tavily key still goes to Tavily', async (t) => {
  const { search, calls, restore } = mount(
    { tavilyApiKey: 'tavily-key', maxResults: 3 },
    () => json({ answer: 'Tavily answer', results: [{ title: 'T', url: 'https://t.example', content: 'Tavily snippet' }] }),
  );
  t.after(restore);

  const text = textOf(await search.execute('call-1', { query: 'anything' }));

  assert.equal(calls[0].url, 'https://api.tavily.com/search');
  assert.deepEqual(JSON.parse(calls[0].init.body), { api_key: 'tavily-key', query: 'anything', max_results: 3, include_answer: true });
  assert.match(text, /^Answer: Tavily answer\n\n- T\n {2}https:\/\/t\.example\n {2}Tavily snippet$/);
});

test('the automatic choice uses Serper when it is the only key configured', async (t) => {
  const { search, calls, restore } = mount({ serperApiKey: 'serper-key' }, () => json(SERPER_BODY));
  t.after(restore);

  await search.execute('call-1', { query: 'q' });
  assert.equal(calls[0].url, 'https://google.serper.dev/search');
});

test('a provider selected without its key explains the fix instead of calling out', async (t) => {
  const { search, calls, restore } = mount({ provider: 'serper', tavilyApiKey: 'tavily-key' });
  t.after(restore);

  const text = textOf(await search.execute('call-1', { query: 'q' }));

  assert.equal(calls.length, 0, 'a misconfiguration must not reach the network');
  assert.match(text, /set to Serper but no Serper API key/);
  assert.match(text, /a Tavily key is configured/);
});

test('no key at all keeps the WebFetch-only guidance', async (t) => {
  const { search, calls, restore } = mount({});
  t.after(restore);

  assert.match(textOf(await search.execute('call-1', { query: 'q' })), /not configured .*no Tavily or Serper API key/);
  assert.equal(calls.length, 0);
});

test('resolveSearchProvider prefers Tavily when both keys are set, and honors an explicit choice', () => {
  assert.equal(resolveSearchProvider({ tavilyApiKey: 'a', serperApiKey: 'b' }).id, 'tavily');
  assert.equal(resolveSearchProvider({ provider: 'serper', tavilyApiKey: 'a', serperApiKey: 'b' }).id, 'serper');
  // Blank/whitespace keys must not count as configured, or the tool would send an empty credential.
  assert.match(resolveSearchProvider({ tavilyApiKey: '   ' }).message, /not configured/);
  assert.match(resolveSearchProvider({ provider: 'bing', serperApiKey: 'b' }).message, /unknown/);
});
