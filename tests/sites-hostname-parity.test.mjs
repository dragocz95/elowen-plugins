import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { derivedHostnameBase } from '../plugins/sites/dist/config.js';

/** Two processes derive this instance's site hostname base, and they MUST answer the same thing.
 *
 *  The daemon reads it from the privileged control core builds in `src/privileged/publishedSitesGateway.ts`.
 *  A forked tool runner is given no such control, so the plugin recomputes the rule from the public app URL
 *  both processes are handed. Source text cannot be compared across the repo boundary — core publishes
 *  `dist/`, not `src/` — so this pins BEHAVIOUR against the built checkout named by ELOWEN_CORE_ROOT.
 *
 *  What drift would cost: a site created in a runner under one hostname and served by the daemon under
 *  another is a published address that answers nothing and a certificate issued for the wrong name. */
const configuredCoreRoot = process.env.ELOWEN_CORE_ROOT?.trim();
if (!configuredCoreRoot) {
  throw new Error('[sites-hostname-parity] ELOWEN_CORE_ROOT must point to the authoritative built core checkout');
}
const corePath = resolve(configuredCoreRoot, 'dist/privileged/publishedSitesGateway.js');
const { createPublishedSitesGatewayControl } = await import(pathToFileURL(corePath).href);
console.info(`[sites-hostname-parity] core source: ELOWEN_CORE_ROOT (${corePath})`);

/** Core's answer, read through the only surface that exposes it. The invoker is replaced so a mistake in
 *  this test can never reach the root helper: `hostnameBase()` is pure, and anything else is a bug. */
const coreHostnameBase = (publicWebUrl) => createPublishedSitesGatewayControl({
  publicWebUrl,
  invoke: async () => { throw new Error('a parity test must never invoke the privileged site gateway helper'); },
  audit: { info: () => {}, warn: () => {} },
  helper: {
    status: async () => { throw new Error('a parity test must never inspect the installed helper'); },
    install: async () => { throw new Error('a parity test must never install the helper'); },
  },
}).hostnameBase();

const INPUTS = [
  null,
  '',
  '   ',
  'https://build.coresynth.io',
  'https://build.coresynth.io/',
  'https://BUILD.CORESYNTH.IO/app?next=1',
  'https://agent.example.invalid:8443/',
  'https://sub.domain.example.org',
  'https://example.com.',
  'https://xn--hxajbheg2az3al.example',
  'https://münchen.example',
  'http://x',
  'http://build.coresynth.io',
  'https://localhost',
  'https://localhost:4500',
  'https://dotless',
  'https://127.0.0.1',
  'https://[::1]',
  'ftp://build.coresynth.io',
  'file:///var/www',
  'build.coresynth.io',
  'not a url',
  '//build.coresynth.io',
];

test('the plugin derivation answers exactly what the core gateway control answers', () => {
  for (const input of INPUTS) {
    assert.equal(derivedHostnameBase(input), coreHostnameBase(input), `input ${JSON.stringify(input)}`);
  }
});

test('the inputs that must produce no hostname at all produce none in either derivation', () => {
  // Named one by one, because each is a rule an instance depends on: a plain-HTTP or dotless deployment has
  // no certifiable public name, and `localhost` is refused explicitly even though it carries no dot.
  for (const input of [null, 'http://x', 'http://build.coresynth.io', 'https://localhost', 'https://dotless', 'not a url']) {
    assert.equal(coreHostnameBase(input), null, `core: ${String(input)}`);
    assert.equal(derivedHostnameBase(input), null, `plugin: ${String(input)}`);
  }
});

test('core feeds both seams the same URL, so identical rules cannot answer differently', () => {
  // Equal functions are only half the guarantee: two derivations agreeing on every input still diverge if
  // they are HANDED different inputs. Core computes one `canonicalPublicWebUrl` and passes it BOTH to the
  // privileged gateway control and to the plugin context, which is what makes the rule above sufficient.
  // Asserted against the built core, because that is what this instance actually runs.
  const brainCore = readFileSync(resolve(configuredCoreRoot, 'dist/daemon/brainCore.js'), 'utf8');
  const declaration = /const (\w+) = trustedPublicWebUrl\(/.exec(brainCore);
  assert.ok(declaration, 'core must still derive one trusted public web URL for the process');
  const shared = declaration[1];

  assert.match(brainCore, new RegExp(`createPublishedSitesGatewayControl\\(\\{ publicWebUrl: ${shared}`),
    'the privileged gateway control must be built from that one URL');
  assert.match(brainCore, new RegExp(`publicWebUrl: \\(\\) => ${shared}`),
    'and the plugin context must expose the same one');
});

test('an HTTPS deployment yields the lowercased sites. base in both derivations', () => {
  assert.equal(derivedHostnameBase('https://BUILD.CORESYNTH.IO/app'), 'sites.build.coresynth.io');
  assert.equal(coreHostnameBase('https://BUILD.CORESYNTH.IO/app'), 'sites.build.coresynth.io');
});
