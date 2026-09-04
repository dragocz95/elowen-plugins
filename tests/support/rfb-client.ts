import { connect, type Socket } from 'node:net';

/** A minimal RFB 3.8 client, enough for a test to drive a display and SEE the result.
 *
 *  Raw encoding only, on purpose. The point of the browser VNC pilot's end-to-end test is that input
 *  sent as RFB reaches the page as native input and that the pixels come back — not that a Tight
 *  decoder is correct. Raw costs bandwidth the test does not care about over a unix socket, and it
 *  removes a decoder that would otherwise have to be trusted for the assertion to mean anything.
 *
 *  Real clients negotiate Tight; the transport, the handshake and the input messages below are the same
 *  ones noVNC sends, so this exercises the path the product uses. */

const MSG_SET_PIXEL_FORMAT = 0;
const MSG_SET_ENCODINGS = 2;
const MSG_FB_UPDATE_REQUEST = 3;
const MSG_KEY_EVENT = 4;
const MSG_POINTER_EVENT = 5;
const SERVER_FB_UPDATE = 0;

/** X11 keysyms a test needs by name; a printable ASCII character is its own keysym. */
export const KEYSYM = {
  BackSpace: 0xff08, Tab: 0xff09, Return: 0xff0d, Escape: 0xff1b,
  Home: 0xff50, Left: 0xff51, Up: 0xff52, Right: 0xff53, Down: 0xff54, End: 0xff57,
  Delete: 0xffff, ShiftLeft: 0xffe1, ControlLeft: 0xffe3, AltLeft: 0xffe9,
} as const;

export interface RfbRect { x: number; y: number; width: number; height: number; pixels: Buffer }

interface Waiter { need: number; resolve(value: Buffer): void; reject(error: Error): void }

class ByteStream {
  private chunks: Buffer[] = [];
  private length = 0;
  private readonly waiters: Waiter[] = [];
  bytesReceived = 0;

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.length += chunk.length;
    this.bytesReceived += chunk.length;
    while (this.waiters.length > 0 && this.length >= this.waiters[0]!.need) {
      const waiter = this.waiters.shift()!;
      waiter.resolve(this.take(waiter.need));
    }
  }

  fail(error: Error): void {
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  read(need: number): Promise<Buffer> {
    if (this.length >= need) return Promise.resolve(this.take(need));
    return new Promise((resolve, reject) => { this.waiters.push({ need, resolve, reject }); });
  }

  private take(need: number): Buffer {
    const out = Buffer.allocUnsafe(need);
    let offset = 0;
    while (offset < need) {
      const chunk = this.chunks[0]!;
      const take = Math.min(chunk.length, need - offset);
      chunk.copy(out, offset, 0, take);
      offset += take;
      if (take === chunk.length) this.chunks.shift();
      else this.chunks[0] = chunk.subarray(take);
    }
    this.length -= need;
    return out;
  }
}

export class RfbClient {
  width = 0;
  height = 0;
  name = '';
  private buttonMask = 0;

  private constructor(private readonly socket: Socket, private readonly stream: ByteStream) {}

  static async connect(options: { socketPath?: string; host?: string; port?: number; timeoutMs?: number }): Promise<RfbClient> {
    const stream = new ByteStream();
    const timeoutMs = options.timeoutMs ?? 10_000;
    const socket = await new Promise<Socket>((resolve, reject) => {
      const pending = options.socketPath
        ? connect(options.socketPath)
        : connect({ host: options.host ?? '127.0.0.1', port: options.port ?? 0 });
      const timer = setTimeout(() => { pending.destroy(); reject(new Error('RFB connect timed out.')); }, timeoutMs);
      pending.once('connect', () => { clearTimeout(timer); resolve(pending); });
      pending.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    socket.on('data', (chunk: Buffer) => stream.push(chunk));
    socket.on('error', (error: Error) => stream.fail(error));
    socket.on('close', () => stream.fail(new Error('RFB connection closed.')));
    const client = new RfbClient(socket, stream);
    await client.handshake();
    return client;
  }

  get bytesReceived(): number { return this.stream.bytesReceived; }

  private async handshake(): Promise<void> {
    const version = (await this.stream.read(12)).toString('ascii');
    if (!/^RFB 003\.00[3-8]\n$/.test(version)) throw new Error(`Unexpected RFB banner: ${JSON.stringify(version)}`);
    this.socket.write(Buffer.from('RFB 003.008\n', 'ascii'));
    const count = (await this.stream.read(1))[0]!;
    if (count === 0) {
      const reasonLength = (await this.stream.read(4)).readUInt32BE(0);
      throw new Error(`RFB server refused the connection: ${(await this.stream.read(reasonLength)).toString('utf8')}`);
    }
    const types = await this.stream.read(count);
    if (!types.includes(1)) throw new Error('RFB server offers no None security type.');
    this.socket.write(Buffer.from([1]));
    if ((await this.stream.read(4)).readUInt32BE(0) !== 0) throw new Error('RFB security handshake failed.');
    this.socket.write(Buffer.from([1]));
    const init = await this.stream.read(24);
    this.width = init.readUInt16BE(0);
    this.height = init.readUInt16BE(2);
    this.name = (await this.stream.read(init.readUInt32BE(20))).toString('utf8');

    // 32-bit little-endian BGRX, which the framebuffer already is: no server-side conversion, and a
    // rect whose byte length is exactly width * height * 4.
    const format = Buffer.alloc(20);
    format.writeUInt8(MSG_SET_PIXEL_FORMAT, 0);
    format.writeUInt8(32, 4);
    format.writeUInt8(24, 5);
    format.writeUInt8(0, 6);
    format.writeUInt8(1, 7);
    format.writeUInt16BE(255, 8);
    format.writeUInt16BE(255, 10);
    format.writeUInt16BE(255, 12);
    format.writeUInt8(16, 14);
    format.writeUInt8(8, 15);
    format.writeUInt8(0, 16);
    this.socket.write(format);

    const encodings = Buffer.alloc(8);
    encodings.writeUInt8(MSG_SET_ENCODINGS, 0);
    encodings.writeUInt16BE(1, 2);
    encodings.writeInt32BE(0, 4);
    this.socket.write(encodings);
  }

  requestUpdate(incremental = true): void {
    const message = Buffer.alloc(10);
    message.writeUInt8(MSG_FB_UPDATE_REQUEST, 0);
    message.writeUInt8(incremental ? 1 : 0, 1);
    message.writeUInt16BE(0, 2);
    message.writeUInt16BE(0, 4);
    message.writeUInt16BE(this.width, 6);
    message.writeUInt16BE(this.height, 8);
    this.socket.write(message);
  }

  pointer(x: number, y: number, buttonMask = this.buttonMask): void {
    this.buttonMask = buttonMask;
    const message = Buffer.alloc(6);
    message.writeUInt8(MSG_POINTER_EVENT, 0);
    message.writeUInt8(buttonMask, 1);
    message.writeUInt16BE(Math.round(x), 2);
    message.writeUInt16BE(Math.round(y), 4);
    this.socket.write(message);
  }

  /** A click with a human's timing. The three events are NOT written back to back: x11vnc replays them
   *  through XTEST as fast as it reads them, and Chrome then sees a press and release at a position the
   *  pointer arrived at in the same instant — which it treats as a move, not a gesture. Moving first and
   *  holding the button briefly is both what a person does and what makes the click land. */
  async click(x: number, y: number, button: 'left' | 'right' = 'left'): Promise<void> {
    const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    this.pointer(x, y, 0);
    await pause(80);
    this.pointer(x, y, button === 'right' ? 4 : 1);
    await pause(80);
    this.pointer(x, y, 0);
    await pause(80);
  }

  key(keysym: number, down: boolean): void {
    const message = Buffer.alloc(8);
    message.writeUInt8(MSG_KEY_EVENT, 0);
    message.writeUInt8(down ? 1 : 0, 1);
    message.writeUInt32BE(keysym, 4);
    this.socket.write(message);
  }

  tap(keysym: number): void { this.key(keysym, true); this.key(keysym, false); }

  /** Type a printable string. Shift is held around characters that need it, so the X server produces
   *  the shifted keysym rather than one the page would read as its lower-case twin. */
  type(text: string): void {
    for (const char of text) {
      const code = char.codePointAt(0)!;
      const shifted = /[A-Z!@#$%^&*()_+{}|:"<>?~]/.test(char);
      if (shifted) this.key(KEYSYM.ShiftLeft, true);
      this.key(code, true);
      this.key(code, false);
      if (shifted) this.key(KEYSYM.ShiftLeft, false);
    }
  }

  /** Read one FramebufferUpdate. Non-update server messages are skipped rather than rejected: x11vnc
   *  sends a bell or a clipboard message whenever it feels like it, and a test that died on one would
   *  be flaky for a reason that has nothing to do with what it checks. */
  async readUpdate(): Promise<{ rects: RfbRect[]; at: number }> {
    for (;;) {
      const type = (await this.stream.read(1))[0]!;
      if (type !== SERVER_FB_UPDATE) {
        if (type === 2) continue;
        if (type === 1) { const meta = await this.stream.read(5); await this.stream.read(meta.readUInt16BE(3) * 6); continue; }
        if (type === 3) { const meta = await this.stream.read(7); await this.stream.read(meta.readUInt32BE(3)); continue; }
        throw new Error(`Unsupported RFB server message type ${type}.`);
      }
      const meta = await this.stream.read(3);
      const rects: RfbRect[] = [];
      for (let index = 0; index < meta.readUInt16BE(1); index += 1) {
        const rect = await this.stream.read(12);
        const encoding = rect.readInt32BE(8);
        if (encoding !== 0) throw new Error(`Unexpected RFB encoding ${encoding}; only Raw was negotiated.`);
        const width = rect.readUInt16BE(4);
        const height = rect.readUInt16BE(6);
        rects.push({
          x: rect.readUInt16BE(0), y: rect.readUInt16BE(2), width, height,
          pixels: await this.stream.read(width * height * 4),
        });
      }
      return { rects, at: Date.now() };
    }
  }

  close(): void { this.socket.destroy(); }
}

/** Whether an exact colour appears anywhere in these rectangles. Pixels arrive as little-endian BGRX. */
export function containsColour(rects: readonly RfbRect[], red: number, green: number, blue: number): boolean {
  return rects.some(({ pixels }) => {
    for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
      if (pixels[offset] === blue && pixels[offset + 1] === green && pixels[offset + 2] === red) return true;
    }
    return false;
  });
}
