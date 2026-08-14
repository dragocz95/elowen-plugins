// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Msg = Record<string, unknown>;
type Messages = Record<string, Msg>;

/** Every chat adapter in this registry spreads `SHARED_MESSAGES[lang]` into its own `MESSAGES[lang]` and
 *  layers its surface-specific keys on top. The Elowen package used to assert that inheritance for all
 *  four adapters in one suite; they live here now, so the table does — one row per adapter rather than
 *  four near-identical copies, which is how the telegram and whatsapp rows went missing in the first place.
 *
 *  `freeTextFast` records whether the surface can hand `/fast` an ARBITRARY argument. Telegram, WhatsApp
 *  and Teams parse a plain-text command line, so a user can type `/fast maybe`; Discord's `/fast` is a
 *  slash command whose `state` option is a fixed choice list (on|off, adapter.mjs), so an invalid value
 *  never reaches the shared handler and Discord deliberately carries no `fastUsage` key. */
const ADAPTERS = [
  { name: 'discord', freeTextFast: false },
  { name: 'msteams', freeTextFast: true },
  { name: 'telegram', freeTextFast: true },
  { name: 'whatsapp', freeTextFast: true },
] as const;

const LANGS = ['en', 'cs', 'sk'] as const;

const messages = new Map<string, Messages>();
let SHARED: Messages;

beforeAll(async () => {
  SHARED = (await import('elowen-plugin-shared/messages') as { SHARED_MESSAGES: Messages }).SHARED_MESSAGES;
  for (const { name } of ADAPTERS) {
    const mod = await import(join(repoRoot, `plugins/${name}/lib/messages.mjs`)) as { MESSAGES: Messages };
    messages.set(name, mod.MESSAGES);
  }
});

describe('shared service messages, as the published package delivers them', () => {
  // The adapters here consume the PUBLISHED elowen-plugin-shared, not the Elowen repo's source of it. A
  // language that loses a key in a release is invisible to the package's own suite but breaks every
  // adapter downstream of it, so the key set is checked against what is actually installed.
  it('exposes the same key set in every language', () => {
    const en = Object.keys(SHARED.en).sort();
    expect(Object.keys(SHARED.cs).sort()).toEqual(en);
    expect(Object.keys(SHARED.sk).sort()).toEqual(en);
  });
});

describe.each(ADAPTERS)('$name adapter message inheritance', ({ name, freeTextFast }) => {
  it.each(LANGS)('inherits every shared key verbatim in %s', (lang) => {
    const M = messages.get(name)![lang];
    // Compared key by key rather than on a hand-picked few: a surface quietly growing its own wording for
    // a shared text is the exact drift this contract exists to catch, and it never announces itself. A
    // future DELIBERATE override is meant to fail here — it has to be stated, not slipped in.
    for (const key of Object.keys(SHARED[lang])) {
      // Function keys (compacted, contextError, commandRunning) survive the spread as the same reference,
      // so identity holds for them too and no call-and-compare special case is needed.
      expect(M[key], `${name}.${lang}.${key}`).toBe(SHARED[lang][key]);
    }
  });

  it.each(LANGS)('carries a fastUsage string in %s when /fast takes free text', (lang) => {
    // runControlCommand replies `msg.fastUsage` on an invalid /fast argument and, when the key is absent,
    // replies NOTHING at all (`if (msg.fastUsage)` — chatCommands.mjs). Telegram's cs previously lacked
    // it, which made a mistyped /fast a silent no-op with no way for the user to tell.
    const M = messages.get(name)![lang];
    if (!freeTextFast) {
      expect(M.fastUsage, `${name} has no free-text /fast argument`).toBeUndefined();
      return;
    }
    expect(typeof M.fastUsage, `${name}.${lang}.fastUsage`).toBe('string');
    expect((M.fastUsage as string).length).toBeGreaterThan(0);
  });
});
