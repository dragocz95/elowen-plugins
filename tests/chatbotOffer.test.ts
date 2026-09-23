// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateOffer } from '../plugins/chatbot/src/validation.js';
import { OFFER_LIMITS } from '../plugins/chatbot/src/offerContract.js';
import { registerOfferTool } from '../plugins/chatbot/src/offerTool.js';
import { eventPayload } from '../plugins/chatbot/src/store.js';
import type { ChatbotContext } from '../plugins/chatbot/src/coreSeams.js';
import { CHATBOT_SITE, createChatbotHost, issueToken, publicRequest, registerBot } from './helpers/chatbotHost.js';

const origins = [CHATBOT_SITE, 'http://127.0.0.1:3000'];

describe('visitor offer validation', () => {
  it('rejects off-origin links, card images, card actions and unsafe schemes', () => {
    for (const offer of [
      { links: [{ label: 'Away', url: 'https://evil.example/page' }] },
      { cards: [{ title: 'Title', imageUrl: 'https://evil.example/image.png' }] },
      { cards: [{ title: 'Title', action: { label: 'Go', url: 'https://evil.example/' } }] },
      { links: [{ label: 'Bad', url: 'javascript:alert(1)' }] },
      { links: [{ label: 'Bad', url: 'https://user:pass@www.example.cz/' }] },
      { links: [{ label: 'Bad', url: 'http://www.example.cz/' }] },
    ]) expect(validateOffer(offer, origins).ok).toBe(false);
    expect(validateOffer({ links: [{ label: 'Local', url: 'http://127.0.0.1:3000/path' }] }, origins).ok).toBe(true);
  });
  it('enforces limits, nonempty text, and strict action shapes', () => {
    expect(validateOffer({ choices: Array.from({ length: OFFER_LIMITS.choices + 1 }, () => ({ label: 'yes' })) }, origins).ok).toBe(false);
    expect(validateOffer({ choices: [{ label: 'x'.repeat(OFFER_LIMITS.label + 1) }] }, origins).ok).toBe(false);
    expect(validateOffer({ cards: [{ title: 'x', action: { label: 'Open', url: CHATBOT_SITE, reply: 'also' } }] }, origins).ok).toBe(false);
    expect(validateOffer({ choices: [{ label: ' ' }] }, origins).ok).toBe(false);
    expect(validateOffer({ choices: [] }, origins).ok).toBe(false);
  });
});

it('replaces the offer for restore, while streaming both durable offer frames within the byte budget', async () => {
  const host = createChatbotHost();
  registerBot(host);
  await host.adapter.connect();
  const issued = await issueToken(host);
  expect(issued.status).toBe(200);
  const { token, visitorId } = issued.body as { token: string; visitorId: string };
  const turnId = randomUUID();
  host.store.createTurn({ turnId, chatbotUserId: 12, visitorId, clientTurnId: randomUUID(),
    message: 'Choose', page: { url: CHATBOT_SITE, title: 'Test' }, now: '2026-09-23T17:00:00.000Z' });
  host.store.markTurnRunning(turnId, '2026-09-23T17:00:01.000Z');
  type Tool = { execute: (id: string, input: unknown) => Promise<{ details: Record<string, unknown> }> };
  let tool: Tool | null = null;
  const ctx = {
    currentIdentity: () => ({ platform: 'chatbot', userId: visitorId, elowenUserId: 12 }),
    host: { stores: () => host.stores },
    registerTool: (value: Tool) => { tool = value; },
  } as unknown as ChatbotContext;
  registerOfferTool({ ctx, store: host.store, broker: host.broker, now: () => '2026-09-23T17:00:02.000Z' });
  expect(tool).not.toBeNull();
  expect((await tool!.execute('blocked', { cards: [{ title: 'No', imageUrl: 'https://off-origin.example/pixel' }] })).details.status).toBe('refused');
  expect(host.store.events(turnId)).toHaveLength(0);
  const first = { choices: [{ label: 'First' }] };
  const second = { choices: [{ label: 'Second', reply: 'Reply' }], links: [{ label: 'Read', url: CHATBOT_SITE + '/read' }] };
  expect((await tool!.execute('one', first)).details.status).toBe('done');
  expect((await tool!.execute('two', second)).details.status).toBe('done');
  const events = host.store.events(turnId).filter(event => event.type === 'offer');
  expect(events.map(eventPayload)).toEqual([first, second]);
  const streamed = await host.handler(publicRequest({ method: 'GET', path: `turns/${turnId}/events`,
    query: { after: '0' }, headers: { origin: CHATBOT_SITE, authorization: `ChatbotVisitor ${token}` } }));
  expect(streamed.status).toBe(200);
  const reader = (streamed.body as ReadableStream<Uint8Array>).getReader();
  const frames = new TextDecoder().decode((await reader.read()).value);
  expect(frames).toContain('"type":"offer"');
  await reader.cancel();
  host.store.appendEvent(turnId, 'done', { text: 'Here are the options.' }, '2026-09-23T17:00:03.000Z');
  host.store.finishTurn({ turnId, status: 'done', coreSessionId: null, errorCode: null, now: '2026-09-23T17:00:03.000Z' });
  const restored = await host.handler(publicRequest({ method: 'GET', path: 'conversation',
    headers: { origin: CHATBOT_SITE, authorization: `ChatbotVisitor ${token}` } }));
  expect(restored.status).toBe(200);
  expect((restored.body as { turns: { offer: unknown }[] }).turns[0]!.offer).toEqual(second);
  expect(Buffer.byteLength(JSON.stringify(restored.body))).toBeLessThanOrEqual(256 * 1024);
});
