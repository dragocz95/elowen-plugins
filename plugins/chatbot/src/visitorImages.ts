import { VISITOR_IMAGE_MAX_BYTES } from './publicContract.js';

export function imageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 6 && (Buffer.from(bytes.subarray(0, 6)).toString('ascii') === 'GIF87a'
    || Buffer.from(bytes.subarray(0, 6)).toString('ascii') === 'GIF89a')) return 'image/gif';
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/** Inspect the first twelve bytes while forwarding the same stream to core's upload helper. */
export function verifiedImageStream(body: ReadableStream<Uint8Array>, size: number): ReadableStream<Uint8Array> {
  if (!Number.isSafeInteger(size) || size < 12 || size > VISITOR_IMAGE_MAX_BYTES) throw new Error('invalid_image_size');
  const reader = body.getReader();
  let received = 0;
  let header = Buffer.alloc(0);
  let verified = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (received !== size || !verified) throw new Error('invalid_image_size');
          controller.close();
          return;
        }
        received += value.byteLength;
        if (received > size) throw new Error('invalid_image_size');
        if (!verified) {
          header = Buffer.concat([header, Buffer.from(value.subarray(0, 12 - header.length))]);
          if (header.length >= 12) {
            if (!imageMime(header)) throw new Error('invalid_image_type');
            verified = true;
          }
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        await reader.cancel().catch(() => {});
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

export interface PublicAttachment {
  kind: 'image' | 'file'; storedName: string; name?: string; size?: number; caption?: string;
}

const IMAGE_REF = /^\/api\/brain\/chat-images\/([0-9a-f]{64}\.(?:png|jpg|gif|webp))$/;
const FILE_REF = /^\/api\/brain\/chat-files\/([0-9a-f]{64}\.bin)$/;

/** Core relay's ShareImage/ShareFile events only, never screenshots or a model-authored URL. */
export function publicAttachment(event: {
  type: string; ref?: string; preview?: boolean; name?: string; size?: number; caption?: string;
}): PublicAttachment | null {
  if (typeof event.ref !== 'string' || event.preview) return null;
  const caption = typeof event.caption === 'string' && event.caption.length <= 240 ? event.caption : undefined;
  if (event.type === 'image') {
    const file = IMAGE_REF.exec(event.ref)?.[1];
    return file ? { kind: 'image', storedName: file, ...(caption ? { caption } : {}) } : null;
  }
  if (event.type === 'file') {
    const file = FILE_REF.exec(event.ref)?.[1];
    if (!file || typeof event.name !== 'string' || !event.name || event.name.length > 180
      || !Number.isSafeInteger(event.size) || (event.size ?? -1) < 0 || (event.size ?? 0) > 25 * 1024 * 1024) return null;
    return { kind: 'file', storedName: file, name: event.name, size: event.size, ...(caption ? { caption } : {}) };
  }
  return null;
}

