import { VISITOR_IMAGE_MIN_BYTES, VISITOR_IMAGE_MAX_BYTES, VISITOR_IMAGE_FORMATS } from './publicContract.js';
function imageMime(bytes) {
    return VISITOR_IMAGE_FORMATS.find((format) => format.signatures.some((alternative) => alternative.every((part) => bytes.length >= part.offset + part.bytes.length
        && part.bytes.every((byte, index) => bytes[part.offset + index] === byte))))?.mime ?? null;
}
/** Inspect the first twelve bytes while forwarding the same stream to core's upload helper. */
export function verifiedImageStream(body, size) {
    if (!Number.isSafeInteger(size) || size < VISITOR_IMAGE_MIN_BYTES || size > VISITOR_IMAGE_MAX_BYTES)
        throw new Error('invalid_image_size');
    const reader = body.getReader();
    let received = 0;
    let header = Buffer.alloc(0);
    let verified = false;
    return new ReadableStream({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    if (received !== size || !verified)
                        throw new Error('invalid_image_size');
                    controller.close();
                    return;
                }
                received += value.byteLength;
                if (received > size)
                    throw new Error('invalid_image_size');
                if (!verified) {
                    header = Buffer.concat([header, Buffer.from(value.subarray(0, 12 - header.length))]);
                    if (header.length >= 12) {
                        if (!imageMime(header))
                            throw new Error('invalid_image_type');
                        verified = true;
                    }
                }
                controller.enqueue(value);
            }
            catch (error) {
                controller.error(error);
                await reader.cancel().catch(() => { });
            }
        },
        cancel(reason) { return reader.cancel(reason); },
    });
}
const IMAGE_REF = new RegExp(`^/api/brain/chat-images/([0-9a-f]{64}\\.(?:${VISITOR_IMAGE_FORMATS.flatMap((format) => [...format.extensions]).map((extension) => extension.slice(1)).join('|')}))$`);
const FILE_REF = /^\/api\/brain\/chat-files\/([0-9a-f]{64}\.bin)$/;
/** Core relay's ShareImage/ShareFile events only, never screenshots or a model-authored URL. */
export function publicAttachment(event) {
    if (typeof event.ref !== 'string' || event.preview)
        return null;
    const caption = typeof event.caption === 'string' && event.caption.length <= 240 ? event.caption : undefined;
    if (event.type === 'image') {
        const file = IMAGE_REF.exec(event.ref)?.[1];
        return file ? { kind: 'image', storedName: file, ...(caption ? { caption } : {}) } : null;
    }
    if (event.type === 'file') {
        const file = FILE_REF.exec(event.ref)?.[1];
        if (!file || typeof event.name !== 'string' || !event.name || event.name.length > 180
            || !Number.isSafeInteger(event.size) || (event.size ?? -1) < 0 || (event.size ?? 0) > 25 * 1024 * 1024)
            return null;
        return { kind: 'file', storedName: file, name: event.name, size: event.size, ...(caption ? { caption } : {}) };
    }
    return null;
}
