// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const name = `${'a'.repeat(64)}.png`;
const image = { type: 'image', ref: `/api/brain/chat-images/${name}`, caption: 'Generated' };
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'scheduled-image-'));
  dirs.push(dir);
  writeFileSync(join(dir, name), Buffer.from('PNG'));
  return dir;
};

describe('scheduled explicit-image notification delivery', () => {
  it('uploads a shared image through Discord before posting text', async () => {
    const { DiscordAdapter } = await import('../plugins/discord/lib/adapter.mjs');
    const order: string[] = [];
    const fake = {
      cfg: { language: 'en' }, imageDir: fixture(),
      resolveImageFiles: (names: string[]) => DiscordAdapter.prototype.resolveImageFiles.call(fake, names),
      uploadImages: async (id: string, caption: string, files: { name: string; data: Buffer }[]) => {
        expect(id).toBe('123'); expect(caption).toBe('Generated');
        expect(files.map((file) => [file.name, file.data.toString()])).toEqual([[name, 'PNG']]);
        order.push('image');
      },
      reply: async (id: string, text: string) => { expect(id).toBe('123'); expect(text).toBe('Result'); order.push('text'); },
    };
    await DiscordAdapter.prototype.notify.call(fake, 'Result', '123', undefined, [image]);
    expect(order).toEqual(['image', 'text']);
  });

  it('sends an explicit shared image as a Telegram photo before text', async () => {
    const { TelegramAdapter } = await import('../plugins/telegram/lib/adapter.mjs');
    const order: string[] = [];
    const fake = {
      cfg: { language: 'en' }, imageDir: fixture(), bot: {},
      resolveImageFiles: (names: string[]) => TelegramAdapter.prototype.resolveImageFiles.call(fake, names),
      sendPhotos: async (_id: unknown, files: { name: string; data: Buffer }[], _extra: unknown, caption: string) => {
        expect(files.map((file) => [file.name, file.data.toString()])).toEqual([[name, 'PNG']]);
        expect(caption).toBe('Generated'); order.push('image');
      },
      reply: async (_id: unknown, text: string) => { expect(text).toBe('Result'); order.push('text'); },
    };
    await TelegramAdapter.prototype.notify.call(fake, 'Result', '123', undefined, [image]);
    expect(order).toEqual(['image', 'text']);
  });

  it('sends an explicit shared image as a WhatsApp image before text', async () => {
    const { WhatsAppAdapter } = await import('../plugins/whatsapp/lib/adapter.mjs');
    const order: string[] = [];
    const fake = {
      cfg: { language: 'en' }, imageDir: fixture(), sock: {},
      resolveImageFiles: (names: string[]) => WhatsAppAdapter.prototype.resolveImageFiles.call(fake, names),
      sendImages: async (id: string, files: { name: string; data: Buffer }[]) => {
        expect(id).toBe('420111222333@s.whatsapp.net');
        expect(files.map((file) => [file.name, file.data.toString()])).toEqual([[name, 'PNG']]);
        order.push('image');
      },
      sendText: async (_id: string, text: string) => { expect(text).toBe('Result'); order.push('text'); },
    };
    await WhatsAppAdapter.prototype.notify.call(fake, 'Result', '420111222333@s.whatsapp.net', undefined, [image]);
    expect(order).toEqual(['image', 'text']);
  });
});
