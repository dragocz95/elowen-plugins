/** The one place a viewer without the takeover lease is actually stopped from driving the browser.
 *
 *  The client's `viewOnly` flag protects nobody: it lives in JavaScript the viewer can edit. So the
 *  plugin sits between the browser and x11vnc and drops the RFB messages that carry INPUT — KeyEvent,
 *  PointerEvent and ClientCutText — before they reach the VNC server, and x11vnc never learns they were
 *  sent.
 *
 *  This has to FRAME the stream rather than sniff the first byte of each chunk. RFB messages are
 *  variable length and several of them arrive in one WebSocket frame, so "does this chunk begin with an
 *  input opcode" passes a PointerEvent that happens to follow a SetEncodings — which is the whole
 *  boundary, defeated by a client that concatenates. Every message is therefore measured and either
 *  forwarded whole or dropped whole.
 *
 *  Unknown territory is a CLOSE, never a pass-through: a message this cannot measure means the stream is
 *  no longer parseable, and forwarding the remainder blind would forward input with it. */
/** RFB client-to-server message types that carry input. */
const KEY_EVENT = 4;
const POINTER_EVENT = 5;
const CLIENT_CUT_TEXT = 6;
const QEMU_CLIENT_MESSAGE = 255;
const QEMU_EXTENDED_KEY_EVENT = 0;
/** A clipboard message is the only client message with an attacker-chosen length. Past this the stream is
 *  treated as hostile rather than buffered: a view-only client has no reason to send a megabyte of
 *  clipboard, and an unbounded reassembly buffer is a memory hole per viewer. */
const MAX_MESSAGE_BYTES = 1024 * 1024;
const SECURITY_NONE = 1;
/** Frames one client-to-server RFB stream and removes its input messages while `allowInput` is false.
 *
 *  Stateful and single-use per connection: it holds the reassembly buffer for a message split across
 *  WebSocket frames, and the handshake phase.
 *
 *  Every connection is framed, including one that is currently allowed to drive. That is not wasted
 *  work, it is the correctness condition: a lease ends mid-connection — released, expired, or taken by
 *  the agent — and a filter that had been skipping the stream until then would resume in the middle of
 *  a message and mistake its payload for opcodes. Framing costs almost nothing, because everything a
 *  client sends is a handful of bytes per gesture. */
export class RfbInputFilter {
    buffer = Buffer.alloc(0);
    phase = 'version';
    closed = null;
    /** @param allowInput whether this viewer holds the lease RIGHT NOW. Read per chunk, never remembered,
     *  so control changing hands takes effect on the very next message. */
    push(chunk, allowInput) {
        if (this.closed)
            return { forward: Buffer.alloc(0), close: this.closed, dropped: 0 };
        this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
        const keep = [];
        let dropped = 0;
        while (this.buffer.length > 0) {
            const step = this.measure();
            if (step === 'incomplete')
                break;
            if (typeof step === 'string') {
                this.closed = step;
                // Whatever was already measured as safe still goes: the refusal is about the remainder.
                return { forward: Buffer.concat(keep), close: step, dropped };
            }
            const message = this.buffer.subarray(0, step.length);
            this.buffer = this.buffer.subarray(step.length);
            if (step.isInput && !allowInput)
                dropped += 1;
            else
                keep.push(Buffer.from(message));
            if (step.next)
                this.phase = step.next;
        }
        if (this.buffer.length > MAX_MESSAGE_BYTES) {
            this.closed = 'A single RFB message exceeded the size this connection will reassemble.';
            return { forward: Buffer.concat(keep), close: this.closed, dropped };
        }
        return { forward: Buffer.concat(keep), close: null, dropped };
    }
    /** The length of the message at the front of the buffer, whether it carries input, and the phase that
     *  follows it. `'incomplete'` means wait for more bytes; a string means the stream cannot be parsed. */
    measure() {
        const buffer = this.buffer;
        if (this.phase === 'version') {
            if (buffer.length < 12)
                return 'incomplete';
            const version = buffer.subarray(0, 12).toString('ascii');
            const minor = Number(version.slice(8, 11));
            if (!/^RFB \d{3}\.\d{3}\n$/.test(version) || !Number.isFinite(minor)) {
                return 'The client did not open with an RFB version string.';
            }
            // Before 3.7 the SERVER chooses the security type, so the client never names one.
            return { length: 12, isInput: false, next: minor >= 7 ? 'security' : 'client-init' };
        }
        if (this.phase === 'security') {
            if (buffer.length < 1)
                return 'incomplete';
            if (buffer[0] !== SECURITY_NONE) {
                return 'The client selected an RFB security type this connection cannot follow.';
            }
            return { length: 1, isInput: false, next: 'client-init' };
        }
        if (this.phase === 'client-init') {
            if (buffer.length < 1)
                return 'incomplete';
            return { length: 1, isInput: false, next: 'messages' };
        }
        return this.measureMessage(buffer);
    }
    measureMessage(buffer) {
        const type = buffer[0];
        switch (type) {
            // SetPixelFormat: type, 3 padding, 16 byte pixel format.
            case 0: return buffer.length < 20 ? 'incomplete' : { length: 20, isInput: false };
            // SetEncodings: type, padding, u16 count, then one u32 per encoding.
            case 2: {
                if (buffer.length < 4)
                    return 'incomplete';
                const total = 4 + 4 * buffer.readUInt16BE(2);
                return buffer.length < total ? 'incomplete' : { length: total, isInput: false };
            }
            // FramebufferUpdateRequest: how a viewer asks for pixels, which is exactly what watching is.
            case 3: return buffer.length < 10 ? 'incomplete' : { length: 10, isInput: false };
            case KEY_EVENT: return buffer.length < 8 ? 'incomplete' : { length: 8, isInput: true };
            case POINTER_EVENT: return buffer.length < 6 ? 'incomplete' : { length: 6, isInput: true };
            // ClientCutText: type, 3 padding, u32 length, then the text. Pasting into the remote page is input.
            case CLIENT_CUT_TEXT: {
                if (buffer.length < 8)
                    return 'incomplete';
                const length = buffer.readUInt32BE(4);
                if (length > MAX_MESSAGE_BYTES)
                    return 'An RFB clipboard message was larger than this connection allows.';
                const total = 8 + length;
                return buffer.length < total ? 'incomplete' : { length: total, isInput: true };
            }
            // EnableContinuousUpdates: type, u8 enable, u16 x, y, width, height.
            case 150: return buffer.length < 10 ? 'incomplete' : { length: 10, isInput: false };
            // ClientFence: type, 3 padding, u32 flags, u8 length, payload.
            case 248: {
                if (buffer.length < 9)
                    return 'incomplete';
                const total = 9 + buffer[8];
                return buffer.length < total ? 'incomplete' : { length: total, isInput: false };
            }
            // SetDesktopSize: type, padding, u16 width, u16 height, u8 screens, padding, 16 bytes per screen.
            case 251: {
                if (buffer.length < 8)
                    return 'incomplete';
                const total = 8 + 16 * buffer[6];
                return buffer.length < total ? 'incomplete' : { length: total, isInput: false };
            }
            case QEMU_CLIENT_MESSAGE: {
                if (buffer.length < 2)
                    return 'incomplete';
                // QEMU Extended Key Event: a keyboard event by another name, and the one noVNC prefers when the
                // server offers it. It is input, and it is dropped like any other key.
                if (buffer[1] !== QEMU_EXTENDED_KEY_EVENT)
                    return `The client sent an unsupported QEMU RFB submessage (${buffer[1]}).`;
                return buffer.length < 12 ? 'incomplete' : { length: 12, isInput: true };
            }
            default:
                return `The client sent an RFB message type this connection cannot frame (${type}).`;
        }
    }
}
