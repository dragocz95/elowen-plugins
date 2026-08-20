// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..');
const log = { info() {}, warn() {}, error() {} };

const message = (remoteJid: string, extra: Record<string, unknown> = {}) => ({
  key: { remoteJid, fromMe: false, ...extra },
  message: { conversation: 'hello' },
});

describe('whatsapp inbound chat classification', () => {
  it('accepts only group and personal PN/LID chats', async () => {
    const { WhatsAppAdapter } = await import(join(repoRoot, 'plugins/whatsapp/lib/adapter.mjs')) as {
      WhatsAppAdapter: new (...args: unknown[]) => {
        listen(fn: (...args: unknown[]) => unknown): void;
        visibleMessageIdentity(m: unknown): { chatJid: string; group: boolean; senderJid: string } | null;
      };
    };
    const state = { get: () => ({}), patch() {} };
    const adapter = new WhatsAppAdapter({}, log, state, async () => [], [], '', '', () => false);
    adapter.listen(async () => undefined);

    expect(adapter.visibleMessageIdentity(message('420123456789@s.whatsapp.net'))).toEqual({
      chatJid: '420123456789@s.whatsapp.net', group: false, senderJid: '420123456789@s.whatsapp.net',
    });
    expect(adapter.visibleMessageIdentity(message('987654321@lid'))).toEqual({
      chatJid: '987654321@lid', group: false, senderJid: '987654321@lid',
    });
    expect(adapter.visibleMessageIdentity(message('120363000000000000@g.us', {
      participant: '420111222333@s.whatsapp.net',
    }))).toEqual({
      chatJid: '120363000000000000@g.us', group: true, senderJid: '420111222333@s.whatsapp.net',
    });

    for (const jid of ['status@broadcast', '12345@newsletter', '12345@broadcast', '12345@unknown']) {
      expect(adapter.visibleMessageIdentity(message(jid)), jid).toBeNull();
    }
  });
});
