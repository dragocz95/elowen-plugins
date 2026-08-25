// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// A Telegram inline picker is the same thing as a parked AskUserQuestion: an interactive prompt this chat
// still owes an answer to. It used to expire on its own hardcoded six minutes while `askTimeoutMs`
// governed only the ask, so raising the setting left the picker dying at the old bound. These tests pin
// the picker to that ONE setting.
//
// Adopted from the Elowen package, where one suite covered the WhatsApp menu and this picker together and
// so could not move with either plugin alone.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const log = { info() {}, warn() {}, error() {} };

const advance = (ms: number) => { vi.setSystemTime(new Date(Date.now() + ms)); };

// Only Date is faked — the adapter stamps `createdAt` with Date.now() and compares against it, while the
// command handlers themselves run on real promises.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-14T09:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

interface ModelOption {
  provider: string;
  providerLabel: string;
  model: string;
  reasoningLevels?: string[];
  reasoningLabels?: Record<string, string>;
}

interface TelegramCallbackContext {
  callbackQuery: { data: string; from: { id: number }; message: { chat: { id: number }; message_id: number } };
  answerCallbackQuery(): Promise<void>;
}
interface TelegramAdapterUnderTest {
  pendingPickers: Map<string, unknown>;
  tgSend(chatId: number, text: string, extra?: Record<string, unknown>): Promise<number>;
  tgEdit(chatId: number, messageId: number, text: string, extra?: Record<string, unknown>): Promise<boolean>;
  handleCommand(chatId: number, from: { id: number }, ids: string[], text: string): Promise<boolean | void>;
  onCallback(ctx: TelegramCallbackContext): Promise<void>;
}

const makeTelegram = async (cfg: Record<string, unknown>) => {
  const { TelegramAdapter } = await import(join(repoRoot, 'plugins/telegram/lib/adapter.mjs')) as {
    TelegramAdapter: new (...args: unknown[]) => TelegramAdapterUnderTest;
  };
  const chats: Record<string, Record<string, unknown>> = { '5': {} };
  const state = {
    get: (id: string) => chats[id] ?? {},
    patch: (id: string, fields: Record<string, unknown>) => { chats[id] = { ...(chats[id] ?? {}), ...fields }; },
  };
  const models: ModelOption[] = [
    { provider: 'p', providerLabel: 'Prov', model: 'model-0' },
    { provider: 'p', providerLabel: 'Prov', model: 'model-1' },
  ];
  const adapter = new TelegramAdapter(
    { language: 'en', rolePolicies: [{ roleId: '42', admin: true }], ...cfg },
    // The adapter opens a local picker only for a command the daemon published for this surface, so a
    // test that opens the /model picker has to hand it a projection carrying /model.
    log, state, async () => models, [], () => null, () => false,
    () => [{ name: 'model', kind: 'picker', execution: 'surface-local' }],
  );
  const edits: string[] = [];
  adapter.tgSend = async () => 111;
  adapter.tgEdit = async (_chatId: number, _mid: number, text: string) => { edits.push(text); return true; };
  return { adapter, chats, edits };
};

const cbCtx = (data: string): TelegramCallbackContext => ({
  callbackQuery: { data, from: { id: 42 }, message: { chat: { id: 5 }, message_id: 111 } },
  answerCallbackQuery: async () => {},
});

describe('telegram inline picker honours askTimeoutMs', () => {
  it('a picker still selects ten minutes on when askTimeoutMs was raised', async () => {
    const { adapter, chats } = await makeTelegram({ askTimeoutMs: 1_800_000 });
    await adapter.handleCommand(5, { id: 42 }, ['42'], '/model');

    advance(10 * 60_000); // past the old hardcoded six-minute picker TTL
    await adapter.onCallback(cbCtx('m:1'));
    expect(chats['5']?.model).toEqual({ provider: 'p', model: 'model-1' });
  });

  it('a picker goes stale early when askTimeoutMs was LOWERED', async () => {
    const { adapter, chats, edits } = await makeTelegram({ askTimeoutMs: 60_000 });
    await adapter.handleCommand(5, { id: 42 }, ['42'], '/model');

    advance(2 * 60_000);
    await adapter.onCallback(cbCtx('m:1'));
    expect(chats['5']?.model).toBeUndefined();
    expect(edits.at(-1)).toContain('No models'); // the stale-picker reply, not a selection
  });

  it('unset askTimeoutMs keeps the six-minute default on both sides of the boundary', async () => {
    const inside = await makeTelegram({});
    await inside.adapter.handleCommand(5, { id: 42 }, ['42'], '/model');
    advance(5 * 60_000);
    await inside.adapter.onCallback(cbCtx('m:1'));
    expect(inside.chats['5']?.model).toEqual({ provider: 'p', model: 'model-1' });

    const outside = await makeTelegram({});
    await outside.adapter.handleCommand(5, { id: 42 }, ['42'], '/model');
    advance(7 * 60_000);
    await outside.adapter.onCallback(cbCtx('m:1'));
    expect(outside.chats['5']?.model).toBeUndefined();
  });
});
