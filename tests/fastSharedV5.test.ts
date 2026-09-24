// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const json = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>;

describe('shared API v5 registry contract', () => {
  // What the case guards is that the manifest and the registry entry carry ONE version and still declare
  // shared API v5, so a release that reaches only one of the two files fails here. The version itself is
  // read from the manifest rather than pinned: a literal here only ever means a hand edit after every
  // release, which is how this case went red for two plugins at once without anything being wrong.
  const plugins = ['cronjob', 'discord', 'telegram', 'msteams', 'whatsapp'] as const;

  it.each(plugins)('%s manifest and registry entry agree on v5 and the patch version', (name) => {
    const manifest = json(`plugins/${name}/elowen-plugin.json`);
    const registry = json('registry.json').plugins as Record<string, unknown>[];
    const version = manifest.version;
    expect(typeof version).toBe('string');
    expect(manifest).toMatchObject({ name, requiresSharedApi: 5 });
    expect(registry.find((entry) => entry.name === name)).toMatchObject({ name, version });
  });

  it('keeps cron sender-agnostic because it imports no breaking chatCommands export', () => {
    const source = readFileSync(join(root, 'plugins/cronjob/index.mjs'), 'utf8');
    expect(source).toContain("from 'elowen-plugin-shared/format'");
    expect(source).toContain("from 'elowen-plugin-shared/atomicJson'");
    expect(source).not.toContain('elowen-plugin-shared/chatCommands');
    expect(source).not.toContain('runControlCommand');
    expect(source).not.toContain('senderPlatformId');
  });
});
