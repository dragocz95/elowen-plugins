import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../scripts/check-languages.mjs', import.meta.url);
const roots = [];

test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'elowen-languages-'));
  roots.push(root);
  const plugin = join(root, 'plugins', 'demo');
  mkdirSync(join(plugin, 'i18n'), { recursive: true });
  writeFileSync(join(plugin, 'elowen-plugin.json'), JSON.stringify({
    name: 'demo',
    description: 'Demo plugin',
    configSchema: [{ key: 'instance', label: 'Instance label', type: 'string' }],
    userConfigSchema: [{
      key: 'method', label: 'Method', hint: 'Preferred method', type: 'enum',
      options: [{ value: 'fast', label: 'Fast' }, { value: 'safe', label: 'Safe' }],
    }],
  }));
  const translation = {
    description: 'Demo preklad',
    fields: {
      instance: { label: 'Inštancia' },
      method: { label: 'Metóda', hint: 'Preferovaná metóda', options: { fast: 'Rýchlo', safe: 'Bezpečne' } },
    },
  };
  writeFileSync(join(plugin, 'i18n', 'cs.json'), JSON.stringify(translation));
  writeFileSync(join(plugin, 'i18n', 'sk.json'), JSON.stringify(translation));
  return { root, plugin, translation };
}

function run(root) {
  return spawnSync(process.execPath, [script.pathname], {
    encoding: 'utf8',
    env: { ...process.env, ELOWEN_LANGUAGES_ROOT: root },
  });
}

test('checks userConfigSchema enum labels as manifest translation keys', () => {
  const { root, plugin, translation } = fixture();
  const broken = structuredClone(translation);
  delete broken.fields.method.options.safe;
  writeFileSync(join(plugin, 'i18n', 'sk.json'), JSON.stringify(broken));

  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing fields\.method\.options\.safe/);
});

test('rejects orphaned field and enum option translations', () => {
  const { root, plugin, translation } = fixture();
  const broken = structuredClone(translation);
  broken.fields.method.options.removed = 'Odstránené';
  broken.fields.removedField = { label: 'Odstránené pole' };
  writeFileSync(join(plugin, 'i18n', 'cs.json'), JSON.stringify(broken));

  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fields\.method\.options\.removed has no matching manifest option/);
  assert.match(result.stderr, /fields\.removedField has no matching settings field/);
});
