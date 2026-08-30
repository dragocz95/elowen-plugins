import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = (plugin) => JSON.parse(readFileSync(join(root, 'plugins', plugin, 'elowen-plugin.json'), 'utf8'));
const fields = (plugin) => new Map(manifest(plugin).configSchema.map((field) => [field.key, field]));

test('Discord uses its authoritative destination catalog without inventing a guild catalog', () => {
  const config = fields('discord');
  assert.equal(config.get('notifyChannelId')?.type, 'destination');
  assert.equal(config.get('threadIds')?.type, 'tokenList');
  assert.equal(config.get('guildId')?.type, 'string');
});

test('Telegram keeps notification targets open and tokenizes only the allowlist', () => {
  const config = fields('telegram');
  assert.equal(config.get('notifyChatId')?.type, 'string');
  assert.equal(config.get('allowedChatIds')?.type, 'tokenList');
});

test('WhatsApp keeps phone/JID targets open and tokenizes only the group allowlist', () => {
  const config = fields('whatsapp');
  assert.equal(config.get('notifyChat')?.type, 'string');
  assert.equal(config.get('groupIds')?.type, 'tokenList');
});
