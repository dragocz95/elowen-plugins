import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Scanner } from '@tailwindcss/oxide';
import { buildPluginUiCss } from 'elowen-plugin-ui-kit/build';

const root = new URL('..', import.meta.url).pathname;
const pluginsDir = join(root, 'plugins');
const pluginNames = readdirSync(pluginsDir)
  .filter((name) => statSync(join(pluginsDir, name)).isDirectory())
  .filter((name) => existsSync(join(pluginsDir, name, 'elowen-plugin.json')));
const manifestOf = (name) => JSON.parse(readFileSync(join(pluginsDir, name, 'elowen-plugin.json'), 'utf8'));
const webPlugins = pluginNames.filter((name) => manifestOf(name).web?.entry);

function cssEscape(value) {
  const string = String(value);
  let result = '';
  for (let index = 0; index < string.length; index += 1) {
    const code = string.charCodeAt(index);
    if (code === 0) {
      result += '\uFFFD';
    } else if (
      (code >= 1 && code <= 31) ||
      code === 127 ||
      (index === 0 && code >= 48 && code <= 57) ||
      (index === 1 && code >= 48 && code <= 57 && string.charCodeAt(0) === 45)
    ) {
      result += `\\${code.toString(16)} `;
    } else if (index === 0 && code === 45 && string.length === 1) {
      result += '\\-';
    } else if (code >= 128 || code === 45 || code === 95 || (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      result += string[index];
    } else {
      result += `\\${string[index]}`;
    }
  }
  return result;
}

const regexEscape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasUtilitySelector = (css, candidate) =>
  new RegExp(`${regexEscape(`.${cssEscape(candidate)}`)}(?=[\\s,{.:#>+~\\[])`).test(css);

test('every plugin with web.entry declares its generated stylesheet', () => {
  assert.ok(webPlugins.length > 0, 'expected the registry to contain web plugins');
  const missing = webPlugins.filter((name) => manifestOf(name).web.css !== 'web/index.css');
  assert.deepEqual(missing, [], `plugins with web.entry but no web.css "web/index.css": ${missing.join(', ')}`);
});

test('committed web bundles have every utility in host or plugin CSS', async (t) => {
  const hostCssDir = join(root, 'node_modules', 'elowen', 'web-dist', '.next', 'static', 'chunks');
  const hostCssFiles = readdirSync(hostCssDir).filter((name) => name.endsWith('.css'));
  assert.ok(hostCssFiles.length > 0, 'published host CSS chunks were not found');
  const hostCss = hostCssFiles.map((name) => readFileSync(join(hostCssDir, name), 'utf8')).join('\n');

  assert.equal(hasUtilitySelector(hostCss, 'h-44'), false, 'self-check failed: published host CSS now covers h-44');

  const tempDir = mkdtempSync(join(tmpdir(), 'elowen-plugin-css-'));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  for (const name of webPlugins) {
    const manifest = manifestOf(name);
    const bundlePath = join('plugins', name, manifest.web.entry);
    let committedBundle;
    try {
      committedBundle = execFileSync('git', ['show', `HEAD:${bundlePath}`], { cwd: root, encoding: 'utf8' });
    } catch {
      assert.fail(`${name}: web bundle "${manifest.web.entry}" is not committed`);
    }

    const cssPath = manifest.web.css ?? 'web/index.css';
    const pluginCssPath = join(pluginsDir, name, cssPath);
    assert.ok(existsSync(pluginCssPath), `${name}: web.css "${cssPath}" does not exist`);
    const trackedCss = execFileSync('git', ['ls-files', '--', join('plugins', name, cssPath)], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    assert.notEqual(trackedCss, '', `${name}: web.css "${cssPath}" is not committed`);
    const pluginCss = readFileSync(pluginCssPath, 'utf8');

    const tempBundle = join(tempDir, `${name}.js`);
    const tempCss = join(tempDir, `${name}.css`);
    writeFileSync(tempBundle, committedBundle);
    const expectedCss = await buildPluginUiCss({ bundle: tempBundle, outfile: tempCss });
    const candidates = new Scanner({}).scanFiles([{ content: committedBundle, extension: 'js' }]);
    const utilityCandidates = candidates.filter((candidate) => hasUtilitySelector(expectedCss, candidate));
    assert.ok(utilityCandidates.length > 0, `${name}: committed bundle produced no utility candidates`);

    const missing = utilityCandidates.filter(
      (candidate) => !hasUtilitySelector(hostCss, candidate) && !hasUtilitySelector(pluginCss, candidate),
    );
    assert.deepEqual(missing, [], `${name}: utilities missing from published host CSS and ${manifest.web.css}: ${missing.join(', ')}`);
  }
});
