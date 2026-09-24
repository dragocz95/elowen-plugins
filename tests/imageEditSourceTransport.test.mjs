// image-edit delegates EVERY source-URL safety decision to the host transport: it has no scheme,
// credential or address check of its own, it just hands each redirect destination back to
// `ctx.host.publicHttp().request()`. `imagePlugins.test.mjs` pins that delegation against a hand-written
// mock, which is enough to prove the plugin re-validates each hop but not that the thing it re-validates
// against actually refuses anything — a mock `validate` that only calls `new URL()` accepts `file://` and
// `https://user:pass@host/` happily.
//
// So this file wires the real tool to the CORE validator (`resolvePublicHttpUrl` from the installed
// elowen), with DNS injected and no socket ever opened. It is the composition test: plugin redirect loop
// + real host address policy. A core change that loosened the policy would fail here even though every
// mock-based assertion still passed.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { resolvePublicHttpUrl } from 'elowen/dist/plugins/publicHttp.js';
import { register as registerEdit } from '../plugins/image-edit/index.mjs';

const dirs = [];
const dataDir = () => { const d = mkdtempSync(join(tmpdir(), 'image-edit-transport-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const keyed = { id: 'p1', label: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x' };

/** The only hostnames this suite resolves. `rebind.example` is the DNS-rebinding shape: one global answer
 *  next to a loopback one, which the core policy must reject as a set rather than pick the good half. */
const DNS = new Map([
  ['images.example', [{ address: '93.184.216.34', family: 4 }]],
  ['cdn.example', [{ address: '93.184.216.35', family: 4 }]],
  ['rebind.example', [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]],
]);

/** A transport with the REAL core validation in front of a synthetic response. `routes` maps a validated
 *  URL to the reply for it; anything unrouted answers 200 with image bytes. */
function realTransport(routes = new Map()) {
  const state = { validated: [], delivered: [], cancelled: [], dnsQueries: [], signals: [] };
  const lookup = async (hostname) => {
    state.dnsQueries.push(hostname);
    const answers = DNS.get(hostname);
    if (!answers) throw new Error(`test DNS has no answer for ${hostname}`);
    return answers;
  };
  const validate = async (raw) => {
    const { url } = await resolvePublicHttpUrl(raw, lookup);
    const normalized = url.toString();
    state.validated.push(normalized);
    return normalized;
  };
  return {
    state,
    transport: {
      validate,
      async request(raw, options = {}) {
        state.signals.push(options.signal);
        const normalized = await validate(raw);
        const route = routes.get(normalized);
        if (route?.location !== undefined) {
          return {
            url: normalized,
            status: route.status ?? 302,
            statusText: 'Found',
            headers: { location: route.location },
            body: (async function* body() {}()),
            cancel() { state.cancelled.push(normalized); },
          };
        }
        state.delivered.push(normalized);
        return {
          url: normalized,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'image/png' },
          body: (async function* body() { yield Buffer.from('REMOTE'); }()),
          cancel() { state.cancelled.push(normalized); },
        };
      },
    },
  };
}

function makeCtx(publicHttp) {
  const edits = [];
  const tools = new Map();
  const dir = dataDir();
  const ctx = {
    config: { provider: 'p1', model: 'gpt-image-1' },
    logger: { info() {}, warn() {}, error() {} },
    resolveProvider: (id) => (id === 'p1' ? keyed : null),
    registerTool: (tool) => tools.set(tool.name, tool),
    projectImageFiles: () => ({
      read: async (path) => readFileSync(path),
      write: async (path, bytes, overwrite) => {
        const destination = join(dir, path);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, bytes, { flag: overwrite ? 'w' : 'wx' });
        return destination;
      },
    }),
    host: { publicHttp: () => publicHttp },
    images: {
      generate: async () => { throw new Error('EditImage must never call generate'); },
      edit: async (req) => {
        edits.push(req);
        return { png: Buffer.from('PNG-BYTES'), model: 'm', size: null, quality: null, format: 'png', usage: null };
      },
    },
  };
  registerEdit(ctx);
  const tool = tools.get('EditImage');
  assert.ok(tool, 'EditImage must register for an API-key provider');
  return { tool, edits };
}

/** Run one EditImage call with raw `fetch` trapped, so an accidental direct request is a failure rather
 *  than a silent bypass of the host transport. */
async function editFrom(tool, url) {
  const originalFetch = globalThis.fetch;
  let rawFetchSockets = 0;
  globalThis.fetch = async () => { rawFetchSockets += 1; return new Response('BYPASS'); };
  try {
    const out = await tool.execute('call-1', { instruction: 'make the sky orange', url });
    return { text: out.content[0].text, rawFetchSockets };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/** Every destination the core policy must refuse, with the message it refuses with. The scheme and
 *  credential cases are the ones NO plugin-side check would catch. */
const refused = [
  ['loopback', 'http://127.0.0.1/private', /non-global address/i],
  ['IPv6 loopback', 'http://[::1]/private', /non-global address/i],
  ['RFC1918', 'http://10.0.0.1/private', /non-global address/i],
  ['carrier-grade NAT', 'http://100.64.0.1/private', /non-global address/i],
  ['link-local', 'http://169.254.1.1/private', /non-global address/i],
  ['cloud metadata', 'http://169.254.169.254/latest/meta-data', /non-global address/i],
  ['IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/private', /non-global address/i],
  ['DNS rebinding answer set', 'https://rebind.example/private', /non-global address/i],
  ['file scheme', 'file:///etc/passwd', /only http\(s\) URLs are allowed/i],
  ['gopher scheme', 'gopher://images.example/private', /only http\(s\) URLs are allowed/i],
  ['embedded credentials', 'https://user:pass@images.example/photo.png', /URL credentials are not allowed/i],
];

describe('image-edit remote sources against the real host transport', () => {
  for (const [kind, url, message] of refused) {
    it(`refuses a ${kind} source URL through core validation`, async () => {
      const { state, transport } = realTransport();
      const { tool, edits } = makeCtx(transport);

      const { text, rawFetchSockets } = await editFrom(tool, url);

      assert.match(text, message);
      assert.deepEqual(state.delivered, [], 'no body may be delivered for a refused destination');
      assert.deepEqual(edits, [], 'a refused source must never reach the image seam');
      assert.equal(rawFetchSockets, 0);
    });
  }

  for (const [kind, location, message] of refused) {
    it(`refuses a redirect to a ${kind} destination and releases the first response`, async () => {
      const start = 'https://images.example/start';
      const { state, transport } = realTransport(new Map([[start, { location }]]));
      const { tool, edits } = makeCtx(transport);

      const { text, rawFetchSockets } = await editFrom(tool, start);

      assert.match(text, message);
      // The hop was refused, but the redirect response it came from must still have been released.
      assert.deepEqual(state.cancelled, [start], 'the redirect response must be cancelled before the next hop');
      assert.deepEqual(state.delivered, [], 'no body may be delivered for a refused redirect destination');
      assert.deepEqual(edits, [], 'a refused redirect must never reach the image seam');
      assert.equal(rawFetchSockets, 0);
    });
  }

  it('follows a public cross-host redirect through core validation and delivers the bytes', async () => {
    const start = 'https://images.example/start';
    const { state, transport } = realTransport(new Map([[start, { location: 'https://cdn.example/photo.png' }]]));
    const { tool, edits } = makeCtx(transport);

    const { text, rawFetchSockets } = await editFrom(tool, start);

    assert.match(text, /authorized sender can use ShareImage/);
    assert.deepEqual(state.delivered, ['https://cdn.example/photo.png']);
    assert.deepEqual(state.cancelled, [start]);
    assert.deepEqual(state.validated, [start, 'https://cdn.example/photo.png']);
    // One deadline for the whole chain, not a fresh one per hop: the same signal instance must reach
    // every request, or a redirect loop could outlive the tool's two-minute budget.
    assert.equal(state.signals.length, 2);
    assert.ok(state.signals[0] instanceof AbortSignal);
    assert.equal(state.signals[1], state.signals[0]);
    // One resolution per hop: the plugin re-requests each destination and lets `request` validate it,
    // rather than calling `validate` separately and then connecting to a name it resolved itself.
    assert.deepEqual(state.dnsQueries, ['images.example', 'cdn.example']);
    assert.equal(edits.length, 1);
    assert.equal(Buffer.from(edits[0].images[0].bytes).toString(), 'REMOTE');
    assert.equal(edits[0].images[0].mime, 'image/png');
    assert.equal(rawFetchSockets, 0);
  });

  it('re-validates a relative redirect resolved against the validated response URL', async () => {
    // A relative `location` is resolved against `response.url`, which is the value the HOST normalized —
    // so the plugin can never be tricked into resolving against an unvalidated string.
    const start = 'https://images.example/album/start';
    const { state, transport } = realTransport(new Map([[start, { location: '../photo.png' }]]));
    const { tool, edits } = makeCtx(transport);

    const { text } = await editFrom(tool, start);

    assert.match(text, /authorized sender can use ShareImage/);
    assert.deepEqual(state.delivered, ['https://images.example/photo.png']);
    assert.equal(edits.length, 1);
  });

  it('stops a redirect loop at five hops without ever delivering a body', async () => {
    const start = 'https://images.example/hop';
    // Every hop points at the next one, so only the redirect cap can end the chain.
    const routes = new Map([[start, { location: `${start}?n=0` }]]);
    for (let n = 0; n < 12; n += 1) routes.set(`${start}?n=${n}`, { location: `${start}?n=${n + 1}` });
    const { state, transport } = realTransport(routes);
    const { tool, edits } = makeCtx(transport);

    const { text } = await editFrom(tool, start);

    assert.match(text, /too many redirects/i);
    assert.equal(state.cancelled.length, 6, 'six responses opened and released: the source plus five hops');
    assert.deepEqual(state.delivered, []);
    assert.deepEqual(edits, []);
    assert.equal(state.signals.length, 6);
    assert.ok(state.signals.every((signal) => signal === state.signals[0]));
  });
});
