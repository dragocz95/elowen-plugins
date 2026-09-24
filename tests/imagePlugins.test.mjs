import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  normalizeSize,
  providerUsable,
  register as registerGen,
  resolveModel as genModel,
} from '../plugins/image-gen/index.mjs';
import { register as registerEdit, editSize } from '../plugins/image-edit/index.mjs';

const log = { info() {}, warn() {}, error() {} };
const dirs = [];
const dataDir = () => { const d = mkdtempSync(join(tmpdir(), 'image-plugin-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const PNG = Buffer.from('PNG-BYTES');

/** The daemon builds `ctx` in `loadPlugins`; here it is the exact set of seams these plugins read. Image
 *  rendering stays in `ctx.images`, while remote source loading stays in `ctx.host.publicHttp`; no raw fetch
 *  or credential lives in either plugin. */
function makeCtx({ provider, config = {}, dir = dataDir(), publicHttp } = {}) {
  const calls = { generate: [], edit: [] };
  const tools = new Map();
  const written = [];
  const image = { png: PNG, model: 'm', size: '1024x1024', quality: 'low', format: 'png', usage: null };
  const network = publicHttp ?? {
    validate: async (url) => url,
    request: async () => { throw new Error('unexpected public HTTP request'); },
  };
  return {
    calls,
    tools,
    written,
    dir,
    ctx: {
      config: { provider: 'p1', ...config },
      logger: log,
      resolveProvider: (id) => (id === 'p1' ? provider : null),
      registerTool: (tool) => tools.set(tool.name, tool),
      projectImageFiles: () => ({
        read: async (path) => readFileSync(path.startsWith('/') ? path : join(dir, path)),
        write: async (path, bytes, overwrite) => {
          const absolute = path.startsWith('/') ? path : join(dir, path);
          mkdirSync(join(absolute, '..'), { recursive: true });
          writeFileSync(absolute, bytes, { flag: overwrite ? 'w' : 'wx' });
          written.push({ path: absolute, overwrite });
          return absolute;
        },
      }),
      host: { publicHttp: () => network },
      images: {
        generate: async (req) => { calls.generate.push(req); return image; },
        edit: async (req) => { calls.edit.push(req); return image; },
      },
    },
  };
}

const chatgpt = { id: 'p1', label: 'ChatGPT account', type: 'oauth-openai-codex', baseUrl: '', apiKey: null };
const keyed = { id: 'p1', label: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x' };

describe('image plugin shared plumbing and distinct size contracts', () => {
  it('keeps the independently installed runtime modules byte-identical', () => {
    const generated = readFileSync(new URL('../plugins/image-gen/lib/runtime.mjs', import.meta.url), 'utf8');
    const edited = readFileSync(new URL('../plugins/image-edit/lib/runtime.mjs', import.meta.url), 'utf8');
    assert.equal(edited, generated);
  });

  it('defaults invalid generation sizes but leaves edit sizes for the model to choose', () => {
    assert.equal(normalizeSize('bogus', '1536x1024'), '1536x1024');
    assert.equal(editSize('bogus'), undefined);
    assert.equal(normalizeSize('auto'), '1024x1024');
    assert.equal(editSize('auto'), undefined);
    assert.equal(normalizeSize('1024x1536'), '1024x1536');
    assert.equal(editSize('1024x1536'), '1024x1536');
  });
});

describe('image-gen on the host image seam', () => {
  // The old plugin required `provider.apiKey`, so a ChatGPT account — which has no key at all, only a
  // credential the daemon holds — could never register the tool.
  it('registers for a keyless OAuth account and renders through ctx.images', async () => {
    const host = makeCtx({ provider: chatgpt, config: { model: 'gpt-image-2.5-flare', size: '1536x1024' } });
    registerGen(host.ctx);

    const tool = host.tools.get('GenerateImage');
    assert.ok(tool, 'GenerateImage must be registered for a connected ChatGPT account');
    const out = await tool.execute('call-1', { prompt: 'a blue owl' });

    assert.deepEqual(host.calls.generate, [{
      providerId: 'p1', model: 'gpt-image-2.5-flare', prompt: 'a blue owl', size: '1536x1024',
    }]);
    assert.match(out.content[0].text, /Use ShareImage/);
    assert.match(host.written[0].path, /\/generated-images\/[\da-f-]+\.png$/);
    assert.equal(host.written[0].overwrite, false);
    assert.equal(readFileSync(host.written[0].path).toString(), 'PNG-BYTES');
    assert.ok(!out.content[0].text.includes('/api/brain/images/'));
  });

  it('uses an explicit output path and reports it for ShareImage', async () => {
    const host = makeCtx({ provider: keyed });
    registerGen(host.ctx);
    const out = await host.tools.get('GenerateImage').execute('call-1', { prompt: 'x', path: 'assets/banner.png' });
    assert.equal(readFileSync(join(host.dir, 'assets/banner.png')).toString(), 'PNG-BYTES');
    assert.deepEqual(host.written, [{ path: join(host.dir, 'assets/banner.png'), overwrite: true }]);
    assert.match(out.content[0].text, /assets\/banner\.png/);
  });

  it('keeps using an API-key provider, and stays unregistered without a usable provider', async () => {
    const withKey = makeCtx({ provider: keyed, config: { model: 'gpt-image-1' } });
    registerGen(withKey.ctx);
    await withKey.tools.get('GenerateImage').execute('call-1', { prompt: 'x', size: 'nonsense' });
    assert.equal(withKey.calls.generate[0].size, '1024x1024'); // unknown size → the configured default

    const none = makeCtx({ provider: null });
    registerGen(none.ctx);
    assert.equal(none.tools.size, 0);
    assert.equal(providerUsable(null), false);
    assert.equal(providerUsable({ type: 'openai', apiKey: null }), false);
  });

  it('defaults the model per account type and tolerates a stored exec string', () => {
    assert.equal(genModel('', 'oauth-openai-codex'), 'gpt-image-2.5-sunburst');
    assert.equal(genModel('', 'openai'), 'gpt-image-1');
    assert.equal(genModel('orca:openai/gpt-image-2.5-flare', 'oauth-openai-codex'), 'gpt-image-2.5-flare');
  });
});

describe('image-edit on the host image seam', () => {
  it('hands the source bytes to the seam and lets the model choose the size for auto', async () => {
    const host = makeCtx({ provider: chatgpt, config: { model: 'gpt-image-2.5-sunburst' } });
    registerEdit(host.ctx);
    const tool = host.tools.get('EditImage');
    assert.ok(tool, 'EditImage must be registered for a connected ChatGPT account');

    const source = join(host.dir, 'source.jpg');
    writeFileSync(source, Buffer.from('SOURCE'));
    await tool.execute('call-1', { instruction: 'make the sky orange', path: source, size: 'auto' });
    assert.match(host.written[0].path, /\/generated-images\/[\da-f-]+\.png$/);
    assert.equal(host.written[0].overwrite, false);
    assert.equal(readFileSync(source).toString(), 'SOURCE');

    assert.equal(host.calls.edit.length, 1);
    const [req] = host.calls.edit;
    assert.equal(req.providerId, 'p1');
    assert.equal(req.model, 'gpt-image-2.5-sunburst');
    assert.equal(req.prompt, 'make the sky orange');
    assert.equal(req.images[0].mime, 'image/jpeg');
    assert.equal(Buffer.from(req.images[0].bytes).toString(), 'SOURCE');
    assert.equal('size' in req, false); // "auto" means: send no size at all
    assert.equal(editSize('1024x1536'), '1024x1536');
    assert.equal(editSize('auto'), undefined);
  });

  it('replaces the source only when its output path explicitly names that source', async () => {
    const host = makeCtx({ provider: keyed });
    registerEdit(host.ctx);
    const source = join(host.dir, 'source.png');
    writeFileSync(source, Buffer.from('SOURCE'));
    const out = await host.tools.get('EditImage').execute('call-1', {
      instruction: 'x', path: source, output_path: source,
    });
    assert.match(out.content[0].text, /Use ShareImage/);
    assert.deepEqual(host.written, [{ path: source, overwrite: true }]);
    assert.equal(readFileSync(source).toString(), 'PNG-BYTES');
  });

  it('refuses a source that is neither a repo path nor a URL', async () => {
    const host = makeCtx({ provider: keyed });
    registerEdit(host.ctx);
    const out = await host.tools.get('EditImage').execute('call-1', { instruction: 'x' });
    assert.match(out.content[0].text, /exactly one source/);
    assert.equal(host.calls.edit.length, 0);
  });

  const refusedSources = [
    ['loopback', 'http://127.0.0.1/private', ['127.0.0.1']],
    ['RFC1918', 'http://10.0.0.1/private', ['10.0.0.1']],
    ['link-local', 'http://169.254.1.1/private', ['169.254.1.1']],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data', ['169.254.169.254']],
    ['mixed DNS response', 'https://rebind.example/private', ['93.184.216.34', '127.0.0.1']],
  ];

  for (const [kind, url, answers] of refusedSources) {
    it(`refuses ${kind} source URLs before opening a socket`, async () => {
      const validated = [];
      let transportSockets = 0;
      const publicHttp = {
        validate: async (raw) => {
          validated.push(raw);
          if (answers.some((address) => address !== '93.184.216.34')) {
            throw new Error('URL resolves to a non-global address');
          }
          return new URL(raw).toString();
        },
        request: async (raw) => {
          const normalized = await publicHttp.validate(raw);
          transportSockets += 1;
          return {
            url: normalized,
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'image/png' },
            body: (async function* body() { yield Buffer.from('REMOTE'); }()),
            cancel() {},
          };
        },
      };
      const host = makeCtx({ provider: keyed, publicHttp });
      registerEdit(host.ctx);
      const originalFetch = globalThis.fetch;
      let rawFetchSockets = 0;
      globalThis.fetch = async () => {
        rawFetchSockets += 1;
        return new Response('REMOTE', { headers: { 'content-type': 'image/png' } });
      };
      try {
        const out = await host.tools.get('EditImage').execute('call-1', { instruction: 'x', url });
        assert.match(out.content[0].text, /non-global address/i);
        assert.deepEqual(validated, [url]);
        assert.equal(transportSockets, 0);
        assert.equal(rawFetchSockets, 0);
        assert.equal(host.calls.edit.length, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }

  it('follows a public redirect through publicHttp', async () => {
    const requests = [];
    const cancelled = [];
    const publicHttp = {
      validate: async (raw) => new URL(raw).toString(),
      request: async (raw, options) => {
        const normalized = await publicHttp.validate(raw);
        requests.push({ raw: normalized, options });
        if (normalized === 'https://images.example/start') {
          return {
            url: normalized,
            status: 302,
            statusText: 'Found',
            headers: { location: '/photo.jpg' },
            body: (async function* body() {})(),
            cancel() { cancelled.push(normalized); },
          };
        }
        return {
          url: normalized,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'image/jpeg' },
          body: (async function* body() { yield Buffer.from('REDIRECTED'); }()),
          cancel() {},
        };
      },
    };
    const host = makeCtx({ provider: keyed, publicHttp });
    registerEdit(host.ctx);

    const out = await host.tools.get('EditImage').execute('call-1', {
      instruction: 'x',
      url: 'https://images.example/start',
    });

    assert.match(out.content[0].text, /Use ShareImage/);
    assert.deepEqual(requests.map(({ raw }) => raw), [
      'https://images.example/start',
      'https://images.example/photo.jpg',
    ]);
    assert.ok(requests.every(({ options }) => options.signal instanceof AbortSignal));
    assert.deepEqual(cancelled, ['https://images.example/start']);
    assert.equal(Buffer.from(host.calls.edit[0].images[0].bytes).toString(), 'REDIRECTED');
  });

  it('refuses a public redirect to a non-global destination', async () => {
    const requested = [];
    const validated = [];
    const publicHttp = {
      validate: async (raw) => {
        const normalized = new URL(raw).toString();
        validated.push(normalized);
        if (normalized === 'http://127.0.0.1/private') {
          throw new Error('URL resolves to a non-global address');
        }
        return normalized;
      },
      request: async (raw) => {
        const normalized = await publicHttp.validate(raw);
        requested.push(normalized);
        return {
          url: normalized,
          status: 302,
          statusText: 'Found',
          headers: { location: 'http://127.0.0.1/private' },
          body: (async function* body() {})(),
          cancel() {},
        };
      },
    };
    const host = makeCtx({ provider: keyed, publicHttp });
    registerEdit(host.ctx);

    const out = await host.tools.get('EditImage').execute('call-1', {
      instruction: 'x',
      url: 'https://images.example/start',
    });

    assert.match(out.content[0].text, /non-global address/i);
    assert.deepEqual(requested, ['https://images.example/start']);
    assert.deepEqual(validated, [
      'https://images.example/start',
      'http://127.0.0.1/private',
    ]);
    assert.equal(host.calls.edit.length, 0);
  });

  it('stops after five public redirects', async () => {
    const requests = [];
    const publicHttp = {
      validate: async (raw) => new URL(raw).toString(),
      request: async (raw) => {
        const normalized = await publicHttp.validate(raw);
        requests.push(normalized);
        const next = new URL(normalized);
        next.searchParams.set('hop', String(requests.length));
        return {
          url: normalized,
          status: 302,
          statusText: 'Found',
          headers: { location: next.toString() },
          body: (async function* body() {})(),
          cancel() {},
        };
      },
    };
    const host = makeCtx({ provider: keyed, publicHttp });
    registerEdit(host.ctx);

    const out = await host.tools.get('EditImage').execute('call-1', {
      instruction: 'x',
      url: 'https://images.example/start',
    });

    assert.match(out.content[0].text, /too many redirects/i);
    assert.equal(requests.length, 6);
    assert.equal(host.calls.edit.length, 0);
  });

  it('loads a public source through publicHttp', async () => {
    const validated = [];
    const requests = [];
    let transportSockets = 0;
    const publicHttp = {
      validate: async (raw) => { validated.push(raw); return new URL(raw).toString(); },
      request: async (raw, options) => {
        requests.push({ raw, options });
        const normalized = await publicHttp.validate(raw);
        transportSockets += 1;
        return {
          url: normalized,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'image/jpeg; charset=binary' },
          body: (async function* body() { yield Buffer.from('REMOTE'); }()),
          cancel() {},
        };
      },
    };
    const host = makeCtx({ provider: keyed, publicHttp });
    registerEdit(host.ctx);
    const originalFetch = globalThis.fetch;
    let rawFetchSockets = 0;
    globalThis.fetch = async () => {
      rawFetchSockets += 1;
      return new Response('WRONG', { headers: { 'content-type': 'image/png' } });
    };
    try {
      const url = 'https://images.example/photo.jpg';
      const out = await host.tools.get('EditImage').execute('call-1', { instruction: 'x', url });
      assert.match(out.content[0].text, /Use ShareImage/);
      assert.deepEqual(validated, [url]);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].raw, url);
      assert.ok(requests[0].options.signal instanceof AbortSignal);
      assert.equal(transportSockets, 1);
      assert.equal(rawFetchSockets, 0);
      assert.equal(host.calls.edit.length, 1);
      assert.equal(host.calls.edit[0].images[0].mime, 'image/jpeg');
      assert.equal(Buffer.from(host.calls.edit[0].images[0].bytes).toString(), 'REMOTE');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
