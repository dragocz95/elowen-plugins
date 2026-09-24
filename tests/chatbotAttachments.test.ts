// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  CHATBOT_SITE as SITE, CLIENT_TURN_ID, NOW_MS, TURN_PAGE,
  createChatbotHost, issueToken, postRequest, publicRequest, registerBot, settledTurn,
  type ChatbotHost,
} from './helpers/chatbotHost.js';
import { VISITOR_IMAGE_MAX_BYTES } from '../plugins/chatbot/src/publicContract.js';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 1]);
const STORED = `${'a'.repeat(64)}.bin`;
const REF = `/api/brain/chat-files/${STORED}`;

let host: ChatbotHost;
beforeEach(async () => {
  host = createChatbotHost();
  registerBot(host);
  await host.adapter.connect();
});

function stream(bytes: Uint8Array, onPull?: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream({ pull(controller) {
    onPull?.();
    controller.enqueue(bytes);
    controller.close();
  } }, { highWaterMark: 0 });
}

function upload(token: string, bytes: Uint8Array, input: {
  visitor?: string; size?: number; clientTurnId?: string; onPull?: () => void;
} = {}) {
  return host.handler(publicRequest({
    method: 'POST', path: 'uploads',
    headers: { origin: input.visitor ?? SITE, authorization: `ChatbotVisitor ${token}` },
    query: { clientTurnId: input.clientTurnId ?? CLIENT_TURN_ID, name: 'picture.png', size: String(input.size ?? bytes.length) },
    stream: stream(bytes, input.onPull),
  }));
}

function turn(token: string, uploadId: string, clientTurnId = CLIENT_TURN_ID) {
  return host.handler(postRequest({
    path: 'turns', headers: { origin: SITE, authorization: `ChatbotVisitor ${token}` },
    body: { schemaVersion: 2, clientTurnId, message: '', uploadId, page: TURN_PAGE },
  }));
}

function download(token: string, turnId: string, storedName = STORED, origin = SITE) {
  return host.handler(publicRequest({
    method: 'GET', path: `turns/${turnId}/files/file/${storedName}`,
    headers: { origin, authorization: `ChatbotVisitor ${token}` },
  }));
}

describe('visitor image uploads', () => {
  it('rejects credentials, origin and invalid bounds before pulling any bytes', async () => {
    const visitor = await issueToken(host);
    let pulls = 0;
    const attempt = (headers: Record<string, string>, size: number) => host.handler(publicRequest({
      method: 'POST', path: 'uploads', headers,
      query: { clientTurnId: CLIENT_TURN_ID, name: 'image.png', size: String(size) },
      stream: stream(PNG, () => { pulls += 1; }),
    }));
    expect((await attempt({ origin: SITE }, PNG.length)).status).toBe(401);
    expect((await attempt({ origin: 'https://other.example', authorization: `ChatbotVisitor ${visitor.body.token}` }, PNG.length)).status).toBe(403);
    expect((await attempt({ origin: SITE, authorization: `ChatbotVisitor ${visitor.body.token}` }, VISITOR_IMAGE_MAX_BYTES + 1)).status).toBe(400);
    expect(pulls).toBe(0);
    expect(host.store.pendingUploadCount(12, visitor.body.visitorId as string, new Date(NOW_MS).toISOString())).toBe(0);
  });

  it('rejects false signatures, mismatched lengths and a receipt presented by another visitor', async () => {
    const first = await issueToken(host);
    const second = await issueToken(host);
    expect((await upload(first.body.token, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).status).toBe(400);
    expect((await upload(first.body.token, PNG, { size: PNG.length + 1 })).status).toBe(400);
    expect((await upload(first.body.token, Buffer.concat([PNG, PNG]), { size: PNG.length })).status).toBe(400);
    const saved = await upload(first.body.token, PNG);
    expect(saved.status).toBe(201);
    const id = (saved.body as { uploadId: string }).uploadId;
    expect(await turn(second.body.token, id)).toMatchObject({ status: 409, body: { error: 'invalid_upload' } });
    expect(await turn(first.body.token, id, randomUUID())).toMatchObject({ status: 409, body: { error: 'invalid_upload' } });
    const admitted = await turn(first.body.token, id);
    expect(admitted.status).toBe(202);
    const turnId = (admitted.body as { turnId: string }).turnId;
    expect(await settledTurn(host, turnId)).toBe('done');
    expect(host.calls[0]?.src.images).toHaveLength(1);
    expect(host.calls[0]?.text).toContain('picture.png');
    expect(host.store.uploadNameForTurn(turnId)).toBe('picture.png');
    expect(await turn(second.body.token, id)).toMatchObject({ status: 409, body: { error: 'invalid_upload' } });
  });

  it('expires unclaimed receipts without removing the uploaded Project file', async () => {
    const visitor = await issueToken(host);
    const saved = await upload(visitor.body.token, PNG);
    const receipt = host.db.prepare('SELECT receipt_json FROM p_chatbot_upload_receipts').get() as { receipt_json: string };
    const parsed = JSON.parse(receipt.receipt_json) as Parameters<ChatbotHost['files']['readProjectImage']>[0]['receipt'];
    host.setNow(NOW_MS + 16 * 60_000);
    expect(await turn(visitor.body.token, (saved.body as { uploadId: string }).uploadId))
      .toMatchObject({ status: 409, body: { error: 'invalid_upload' } });
    expect(host.store.purgeExpiredUploads({ now: new Date(NOW_MS + 16 * 60_000).toISOString(), limit: 10 })).toBe(1);
    expect(await host.files.readProjectImage({ botUserId: 12, receipt: parsed })).not.toBeNull();
  });
});

describe('shared attachment delivery', () => {
  it('serves only a durable same-visitor, same-session share and restores an attachment-only answer', async () => {
    const first = await issueToken(host);
    const other = await issueToken(host);
    host.handleTurn = async ({ observer }) => {
      observer?.onEvent({ type: 'session', sessionId: 'brain-ch-chatbot-session' });
      observer?.onEvent({ type: 'file', ref: REF, name: 'invoice.pdf', size: 4 });
      return undefined;
    };
    const admitted = await host.handler(postRequest({
      path: 'turns', headers: { origin: SITE, authorization: `ChatbotVisitor ${first.body.token}` },
      body: { schemaVersion: 2, clientTurnId: CLIENT_TURN_ID, message: 'send file', page: TURN_PAGE },
    }));
    const turnId = (admitted.body as { turnId: string }).turnId;
    expect(await settledTurn(host, turnId)).toBe('done');
    const events = host.store.attachmentEventsOf(turnId);
    expect(events).toMatchObject([{ kind: 'file', storedName: STORED, name: 'invoice.pdf' }]);
    const snapshot = await host.handler(publicRequest({
      method: 'GET', path: 'conversation', headers: { origin: SITE, authorization: `ChatbotVisitor ${first.body.token}` },
    }));
    expect(snapshot.status).toBe(200);
    expect(snapshot.body).toMatchObject({ turns: [{ turnId, reply: '', attachments: [{ kind: 'file', storedName: STORED }] }] });

    let reads = 0;
    host.files.readShared = ({ botUserId, sessionId, storedName }) => {
      reads += 1;
      expect({ botUserId, sessionId, storedName }).toEqual({ botUserId: 12, sessionId: 'brain-ch-chatbot-session', storedName: STORED });
      return { bytes: Buffer.from('file'), mimeType: 'application/pdf', disposition: 'attachment; filename="invoice.pdf"' };
    };
    expect(await download(other.body.token, turnId)).toMatchObject({ status: 404 });
    expect(await download(first.body.token, turnId, STORED, 'https://other.example')).toMatchObject({ status: 403 });
    expect(await download(first.body.token, turnId, `${'b'.repeat(64)}.bin`)).toMatchObject({ status: 404 });
    expect(reads).toBe(0);
    const served = await download(first.body.token, turnId);
    expect(served).toMatchObject({ status: 200, headers: {
      'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
      'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="invoice.pdf"',
    } });
    expect(served.body).toEqual(Buffer.from('file'));
    expect(reads).toBe(1);
  });
});
