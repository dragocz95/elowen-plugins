import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { normalizeSize } from '../plugins/image-gen/index.mjs';
import { normalizeMaxResults } from '../plugins/web/index.mjs';
import { resolveApiUrl } from '../plugins/voice-bot/lib/tool.mjs';

const root = join(process.cwd(), 'plugins');
const manifest = (name) => JSON.parse(readFileSync(join(root, name, 'elowen-plugin.json'), 'utf8'));

const field = (name, key) => manifest(name).configSchema.find((entry) => entry.key === key);

describe('plugin autosave configuration contracts', () => {
  it('declares effective image defaults and enum sizes', () => {
    // The model field carries no manifest default: the runtime fallback depends on the chosen provider
    // (the ChatGPT account and an API-key endpoint serve different image models), and a manifest default
    // would have to equal the runtime one. It is the shared model picker narrowed to image models, which
    // stores the bare id the Images API takes — the same shape the free-text field stored before.
    for (const plugin of ['image-edit', 'image-gen']) {
      const model = field(plugin, 'model');
      assert.equal(model.type, 'model');
      assert.equal(model.modelKind, 'image');
      assert.equal(model.default, undefined);
      assert.equal(model.placeholder, 'gpt-image-2.5-sunburst');
      // Both transports are pickable: an OpenAI-compatible key provider and the connected ChatGPT account.
      assert.deepEqual(field(plugin, 'provider').providerType, ['openai', 'oauth-openai-codex']);
    }
    assert.equal(manifest('image-edit').capabilities.network, true);
    assert.equal(field('image-gen', 'size').type, 'enum');
    assert.deepEqual(field('image-gen', 'size').options.map((option) => option.value), [
      '1024x1024', '1536x1024', '1024x1536',
    ]);
  });

  it('normalizes invalid image and web values instead of silently producing invalid requests', () => {
    assert.equal(normalizeSize('1536x1024'), '1536x1024');
    assert.equal(normalizeSize('bogus'), '1024x1024');
    assert.equal(normalizeMaxResults(3.9), 3);
    assert.equal(normalizeMaxResults('bogus'), 5);
    assert.equal(normalizeMaxResults(999), 10);
  });

  it('accepts only HTTP(S) voice endpoints', () => {
    assert.equal(resolveApiUrl(' https://voice.example.test/calls/ '), 'https://voice.example.test/calls');
    assert.equal(resolveApiUrl('file:///tmp/calls'), '');
    assert.equal(resolveApiUrl('not a URL'), '');
  });

  it('declares the web search result bounds used by its runtime', () => {
    assert.deepEqual(field('web', 'maxResults'), {
      key: 'maxResults', label: 'Search results', type: 'number', min: 1, max: 10, step: 1, default: 5,
      hint: 'How many results WebSearch returns (1–10, default 5).',
    });
  });
});
