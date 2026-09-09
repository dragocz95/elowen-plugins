import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { register as registerGen, resolveModel as genModel, providerUsable } from '../plugins/image-gen/index.mjs';
import { register as registerEdit, editSize } from '../plugins/image-edit/index.mjs';

const log = { info() {}, warn() {}, error() {} };
const dirs = [];
const dataDir = () => { const d = mkdtempSync(join(tmpdir(), 'image-plugin-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const PNG = Buffer.from('PNG-BYTES');

/** The daemon builds `ctx` in `loadPlugins`; here it is the exact set of seams these plugins read. The
 *  image transport is the host's (`ctx.images`), so the stub records what the plugin asked for — that
 *  request IS the plugin's whole contribution now that no fetch or credential lives in it. */
function makeCtx({ provider, config = {}, dir = dataDir() }) {
  const calls = { generate: [], edit: [] };
  const tools = new Map();
  const image = { png: PNG, model: 'm', size: '1024x1024', quality: 'low', format: 'png', usage: null };
  return {
    calls,
    tools,
    dir,
    ctx: {
      config: { provider: 'p1', ...config },
      logger: log,
      dataDir: () => dir,
      resolveProvider: (id) => (id === 'p1' ? provider : null),
      assertPathAllowed: (p) => p,
      registerTool: (tool) => tools.set(tool.name, tool),
      images: {
        generate: async (req) => { calls.generate.push(req); return image; },
        edit: async (req) => { calls.edit.push(req); return image; },
      },
    },
  };
}

const chatgpt = { id: 'p1', label: 'ChatGPT account', type: 'oauth-openai-codex', baseUrl: '', apiKey: null };
const keyed = { id: 'p1', label: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x' };

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
    const rendered = /\(\/api\/brain\/images\/([^)]+)\)/.exec(out.content[0].text);
    assert.ok(rendered, 'the tool answers with the inline markdown image');
    assert.equal(readFileSync(join(host.dir, rendered[1])).toString(), 'PNG-BYTES');
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

  it('refuses a source that is neither a repo path nor a URL', async () => {
    const host = makeCtx({ provider: keyed });
    registerEdit(host.ctx);
    const out = await host.tools.get('EditImage').execute('call-1', { instruction: 'x' });
    assert.match(out.content[0].text, /repo file path or a public image URL/);
    assert.equal(host.calls.edit.length, 0);
  });
});
