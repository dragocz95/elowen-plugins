import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordAdapter } from '../plugins/discord/lib/adapter.mjs';
import { TelegramAdapter } from '../plugins/telegram/lib/adapter.mjs';
import { WhatsAppAdapter } from '../plugins/whatsapp/lib/adapter.mjs';
import { MsTeamsAdapter } from '../plugins/msteams/lib/adapter.mjs';

test('Discord history keeps zero disabled and caps oversized requests', async () => {
  let requested = '';
  const context = {
    cfg: { historyLimit: 0 },
    rest: async (_method, path) => { requested = path; return []; },
  };
  assert.deepEqual(await DiscordAdapter.prototype.fetchHistory.call(context, 'room', 'before'), []);
  assert.equal(requested, '');
  context.cfg.historyLimit = 1000;
  await DiscordAdapter.prototype.fetchHistory.call(context, 'room', 'before');
  assert.match(requested, /limit=100$/);
});

test('Telegram and WhatsApp question timeouts share fallback and bounds', () => {
  for (const adapter of [TelegramAdapter, WhatsAppAdapter]) {
    const read = (value) => adapter.prototype.askTtlMs.call({ cfg: { askTimeoutMs: value } });
    assert.equal(read(0), read(undefined));
    assert.equal(read(''), read(undefined));
    assert.equal(read(1), 30_000);
    assert.equal(read(9_000_000), 1_800_000);
  }
});

test('Teams history keeps zero disabled and caps oversized requests', () => {
  const read = (value) => MsTeamsAdapter.prototype.historyLimit.call({ cfg: { historyLimit: value } });
  assert.equal(read(0), 0);
  assert.equal(read(''), 0);
  assert.equal(read(1_000_000), 100);
});
