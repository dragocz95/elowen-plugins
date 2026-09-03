// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const json = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>;

describe('shared API v3 registry contract', () => {
  const versions = {
    cronjob: '0.3.3',
    discord: '0.3.17',
    telegram: '0.2.13',
    msteams: '0.6.1',
    whatsapp: '0.2.16',
  } as const;

  it.each(Object.entries(versions))('%s manifest and registry entry agree on v3 and the patch version', (name, version) => {
    const manifest = json(`plugins/${name}/elowen-plugin.json`);
    const registry = json('registry.json').plugins as Record<string, unknown>[];
    expect(manifest).toMatchObject({ name, version, requiresSharedApi: 3 });
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
