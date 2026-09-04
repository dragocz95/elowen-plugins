// @vitest-environment node
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { existsSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolveConfig } from '../plugins/browser/src/config.js';
import { filterViewOnly, VncBridge, VncTicketStore } from '../plugins/browser/src/vnc-bridge.js';
import { VncDisplayPool } from '../plugins/browser/src/vnc-display.js';
import { PuppeteerCoreFactory } from '../plugins/browser/src/browser-launcher.js';
import { containsColour, KEYSYM, RfbClient } from './support/rfb-client.js';
import type { BrowserLogger } from '../plugins/browser/src/types.js';

const logger: BrowserLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const roots: string[] = [];
const root = (): string => {
  const path = mkdtempSync(`${tmpdir()}/browser-vnc-`);
  roots.push(path);
  return path;
};
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

describe('browser VNC pilot configuration', () => {
  it('leaves the virtual display off unless it is explicitly switched on', () => {
    expect(resolveConfig({}).vncEnabled).toBe(false);
    // Anything short of a real boolean true is off: a config row that arrived as the string "false"
    // must not read as enabled, because the cost of getting this backwards is an X server per account.
    expect(resolveConfig({ vncEnabled: 'true' }).vncEnabled).toBe(false);
    expect(resolveConfig({ vncEnabled: 1 }).vncEnabled).toBe(false);
    expect(resolveConfig({ vncEnabled: true }).vncEnabled).toBe(true);
  });

  it('keeps the measured defaults and clamps anything outside them', () => {
    const config = resolveConfig({});
    expect(config.vncPollMs).toBe(20);
    expect(config.vncDeferMs).toBe(40);
    expect(config.vncQualityLevel).toBe(4);
    expect(config.vncCompressionLevel).toBe(6);
    expect(config.vncTicketTtlMs).toBe(15_000);
    expect(resolveConfig({ vncDeferMs: 100_000 }).vncDeferMs).toBe(400);
    expect(resolveConfig({ vncQualityLevel: -5 }).vncQualityLevel).toBe(0);
    expect(resolveConfig({ vncTicketTtlSeconds: 1 }).vncTicketTtlMs).toBe(5_000);
  });
});

describe('browser VNC live view tickets', () => {
  it('opens exactly one connection and refuses the replay', () => {
    const tickets = new VncTicketStore(15_000);
    const { ticket } = tickets.mint(7, 'session-a');
    expect(tickets.redeem(ticket)).toMatchObject({ userId: 7, sessionId: 'session-a' });
    expect(tickets.redeem(ticket)).toBeNull();
  });

  it('names the account and the session, so one ticket cannot open another session', () => {
    const tickets = new VncTicketStore(15_000);
    const mine = tickets.mint(7, 'session-a');
    const theirs = tickets.mint(9, 'session-b');
    expect(tickets.redeem(mine.ticket)).toMatchObject({ userId: 7, sessionId: 'session-a' });
    expect(tickets.redeem(theirs.ticket)).toMatchObject({ userId: 9, sessionId: 'session-b' });
  });

  it('expires, and an expired ticket is consumed rather than left to be retried', () => {
    let now = 1_000;
    const tickets = new VncTicketStore(15_000, () => now);
    const { ticket } = tickets.mint(7, 'session-a');
    now += 15_001;
    expect(tickets.redeem(ticket)).toBeNull();
    expect(tickets.size()).toBe(0);
  });

  it('refuses a ticket that was never minted, and one that merely shares a prefix', () => {
    const tickets = new VncTicketStore(15_000);
    const { ticket } = tickets.mint(7, 'session-a');
    expect(tickets.redeem('')).toBeNull();
    expect(tickets.redeem(ticket.slice(0, -1))).toBeNull();
    expect(tickets.redeem(`${ticket}x`)).toBeNull();
    // The real one still works: the near misses above consumed nothing.
    expect(tickets.redeem(ticket)).not.toBeNull();
  });

  it('drops every ticket for a session that closed', () => {
    const tickets = new VncTicketStore(15_000);
    const a = tickets.mint(7, 'session-a');
    const b = tickets.mint(7, 'session-b');
    tickets.revokeSession('session-a');
    expect(tickets.redeem(a.ticket)).toBeNull();
    expect(tickets.redeem(b.ticket)).not.toBeNull();
  });
});

describe('browser VNC view-only enforcement', () => {
  it('drops input messages and passes the rest', () => {
    // KeyEvent, PointerEvent and ClientCutText carry input; a view-only client may not send them.
    expect(filterViewOnly(Buffer.from([4, 1, 0, 0, 0, 0, 0, 97]))).toBeNull();
    expect(filterViewOnly(Buffer.from([5, 1, 0, 10, 0, 20]))).toBeNull();
    expect(filterViewOnly(Buffer.from([6, 0, 0, 0, 0, 0, 0, 1, 65]))).toBeNull();
    // SetPixelFormat, SetEncodings and FramebufferUpdateRequest are how a viewer WATCHES.
    expect(filterViewOnly(Buffer.from([0, 0, 0, 0]))).not.toBeNull();
    expect(filterViewOnly(Buffer.from([2, 0, 0, 1]))).not.toBeNull();
    expect(filterViewOnly(Buffer.from([3, 1, 0, 0, 0, 0, 5, 0, 3, 32]))).not.toBeNull();
    expect(filterViewOnly(Buffer.alloc(0))).toBeNull();
  });
});

describe('browser VNC bridge', () => {
  it('binds loopback only and refuses an upgrade without a valid ticket', async () => {
    const tickets = new VncTicketStore(15_000);
    const bridge = new VncBridge({
      config: () => resolveConfig({ vncEnabled: true }),
      tickets,
      logger,
      resolve: () => ({ socketPath: '/nonexistent.sock', interactive: false }),
    });
    const port = await bridge.listen();
    try {
      expect(port).toBeGreaterThan(0);
      const refused = await fetch(`http://127.0.0.1:${port}/?ticket=nope`, {
        headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'AAAAAAAAAAAAAAAAAAAAAA==' },
      }).catch((error: Error) => error);
      // Either a 401 body or a torn-down socket: what must NOT happen is a 101.
      if (refused instanceof Response) expect(refused.status).toBe(401);
      expect(bridge.connectionCount).toBe(0);
    } finally {
      await bridge.close();
    }
  });
});

/** The end-to-end proof, and the one thing a design document cannot stand in for: a real X server, a
 *  real headed Chrome on it, a real VNC server, and input that arrives as NATIVE input rather than as
 *  something CDP synthesised.
 *
 *  Off by default because it needs Xvfb, x11vnc and Chrome on the host and takes about half a minute:
 *
 *      ELOWEN_BROWSER_VNC_E2E=1 npx vitest run tests/browser-vnc.test.ts
 */
const e2e = process.env.ELOWEN_BROWSER_VNC_E2E === '1';
const binaryPresent = (name: string): boolean => {
  try { execFileSync('which', [name], { stdio: 'ignore' }); return true; }
  catch { return false; }
};

/** Every TCP address this PID is listening on, as the kernel reports it. Asked of the process rather
 *  than of a port number, so the answer cannot be right by accident. */
const tcpListenersOf = (pid: number): string[] => {
  const output = execFileSync('ss', ['-ltnp'], { encoding: 'utf8' });
  return output.split('\n')
    .filter((line) => line.includes(`pid=${pid},`))
    .map((line) => line.trim().split(/\s+/)[3] ?? '')
    .filter(Boolean);
};

describe.skipIf(!e2e)('browser VNC pilot end to end', () => {
  const cleanup: (() => Promise<void> | void)[] = [];
  afterAll(async () => { for (const step of cleanup.reverse()) await step(); });

  it('draws Chrome on a private display and carries native input back into the page', async () => {
    expect(binaryPresent('Xvfb'), 'Xvfb must be installed for this test').toBe(true);
    expect(binaryPresent('x11vnc'), 'x11vnc must be installed for this test').toBe(true);

    const dataDir = root();
    const config = () => resolveConfig({ vncEnabled: true, vncPollMs: 20, vncDeferMs: 40 });
    const displays = new VncDisplayPool({ dataDir, config, logger });
    cleanup.push(() => displays.releaseAll());

    const display = await displays.acquire(1);
    expect(display.width).toBe(1280);
    expect(display.height).toBe(800);
    expect(existsSync(display.socketPath)).toBe(true);
    // The RFB endpoint is a socket in a private directory, not a port: nothing off this host can dial
    // it, and the mode says so rather than relying on a parent nobody re-checks.
    expect(lstatSync(display.socketPath).mode & 0o777).toBe(0o600);
    expect(lstatSync(display.xauthPath).mode & 0o777).toBe(0o600);
    // The regression this guards: `-rfbport 0` on its own still left x11vnc on the IPv6 wildcard at
    // 5900, an unauthenticated VNC server reachable from the internet.
    expect(tcpListenersOf(display.vncPid)).toEqual([]);

    const browser = await new PuppeteerCoreFactory().launch({
      executablePath: '/opt/google/chrome/chrome',
      userDataDir: root(),
      // No proxy in the harness: the page under test is a data: URL, so nothing is dialled.
      proxyUrl: 'http://127.0.0.1:1',
      viewport: { width: display.width, height: display.height },
      display: { display: display.display, xauthPath: display.xauthPath },
    });
    cleanup.push(() => browser.close());

    const page = await browser.newPage();
    const content = `<!doctype html><html><head><meta charset="utf-8"><title>vnc pilot</title><style>
      html,body{margin:0;padding:0;font:16px/1.4 system-ui;background:#fff}
      #probe{position:fixed;left:40px;top:40px;width:320px;height:40px;font-size:18px}
      #target{position:fixed;left:40px;top:120px;width:240px;height:80px;background:#1a52d6;color:#fff;border:0}
      #flag{position:fixed;left:400px;top:120px;width:200px;height:80px;background:#cccccc}
      .rows{margin-top:320px}.rows div{height:48px;border-bottom:1px solid #ddd}
    </style></head><body>
    <input id="probe" autocomplete="off"><button id="target">Target</button><div id="flag"></div>
    <div class="rows">${Array.from({ length: 200 }, (_, i) => `<div>row ${i}</div>`).join('')}</div>
    <script>
      window.__clicks = 0; window.__keys = []; window.__contextMenus = 0; window.__pointer = [];
      for (const type of ['mousedown', 'mouseup', 'contextmenu']) {
        document.addEventListener(type, (e) => { window.__pointer.push(type + ':' + e.button); }, true);
      }
      document.getElementById('target').addEventListener('click', () => {
        window.__clicks += 1;
        document.getElementById('flag').style.background = '#00ff00';
      });
      document.addEventListener('keydown', (e) => { window.__keys.push((e.ctrlKey ? 'Ctrl+' : '') + e.key); });
      document.addEventListener('contextmenu', (e) => { e.preventDefault(); window.__contextMenus += 1; });
    </script></body></html>`;
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(content)}`, { waitUntil: 'load' });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Kiosk plus a suppressed automation infobar is what makes the framebuffer show the PAGE and
    // nothing else — the same picture today's screencast produces.
    const geometry = await (page as unknown as { evaluate<T>(fn: () => T): Promise<T> }).evaluate(() => ({
      innerHeight: window.innerHeight, outerHeight: window.outerHeight,
      screenX: window.screenX, screenY: window.screenY,
    }));
    expect(geometry.outerHeight - geometry.innerHeight).toBe(0);
    expect(geometry.screenX).toBe(0);
    expect(geometry.screenY).toBe(0);

    const rfb = await RfbClient.connect({ socketPath: display.socketPath });
    cleanup.push(() => rfb.close());
    expect(rfb.width).toBe(1280);
    expect(rfb.height).toBe(800);

    const at = async (selector: string) => (page as unknown as {
      evaluate<T>(fn: (sel: string) => T, arg: string): Promise<T>;
    }).evaluate((sel) => {
      const rect = document.querySelector(sel)!.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, selector);
    const read = <T,>(fn: () => T): Promise<T> => (page as unknown as { evaluate<R>(f: () => R): Promise<R> }).evaluate(fn);

    // Baseline frame, so what follows is genuinely an update rather than the first paint.
    rfb.requestUpdate(false);
    await rfb.readUpdate();

    // A CLICK sent as RFB, verified twice: in the page's own DOM over CDP, and in the pixels that come
    // back. Either alone would be half the loop.
    const target = await at('#target');
    const startedAt = Date.now();
    await rfb.click(target.x, target.y);
    rfb.requestUpdate(true);
    let sawGreen = false;
    const deadline = startedAt + 8_000;
    while (!sawGreen && Date.now() < deadline) {
      const update = await rfb.readUpdate();
      if (containsColour(update.rects, 0x00, 0xff, 0x00)) { sawGreen = true; break; }
      rfb.requestUpdate(true);
    }
    expect(sawGreen).toBe(true);
    expect(await read(() => (window as unknown as { __clicks: number }).__clicks)).toBe(1);

    // The SECONDARY BUTTON, which is the single clearest thing this move buys: a synthesized CDP click
    // cannot produce a contextmenu event at all, and here Chrome cannot tell the press from a mouse.
    //
    // Retried rather than asserted once. The press and release are replayed through XTEST into a
    // compositor that is also busy encoding frames, and a gesture that lands while it is mid-update is
    // simply not seen — a person clicks again and thinks nothing of it. What is NOT tolerated is the
    // event never arriving.
    let secondary: { contextMenus: number; seen: string[] } | null = null;
    for (let attempt = 0; attempt < 4 && !secondary?.contextMenus; attempt += 1) {
      await rfb.click(target.x, target.y, 'right');
      await new Promise((resolve) => setTimeout(resolve, 700));
      secondary = await read(() => ({
        contextMenus: (window as unknown as { __contextMenus: number }).__contextMenus,
        seen: (window as unknown as { __pointer: string[] }).__pointer,
      }));
    }
    expect(secondary?.seen ?? []).toContain('contextmenu:2');
    expect(secondary?.contextMenus ?? 0).toBeGreaterThan(0);

    // TEXT, and the other thing CDP had to special-case: a Ctrl+A the BROWSER handles rather than one
    // the input controller had to translate into a selectAll command.
    const probe = await at('#probe');
    await rfb.click(probe.x, probe.y);
    await new Promise((resolve) => setTimeout(resolve, 250));
    rfb.type('Hello VNC 42');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await read(() => (document.getElementById('probe') as HTMLInputElement).value)).toBe('Hello VNC 42');

    rfb.key(KEYSYM.ControlLeft, true);
    rfb.tap('a'.codePointAt(0)!);
    rfb.key(KEYSYM.ControlLeft, false);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await read(() => {
      const el = document.getElementById('probe') as HTMLInputElement;
      return { start: el.selectionStart, end: el.selectionEnd };
    })).toEqual({ start: 0, end: 12 });

    rfb.tap(KEYSYM.Tab);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await read(() => document.activeElement?.id ?? null)).toBe('target');

    // SCROLL, as wheel buttons 4 and 5 — the gesture that has to feel native for this to be worth it.
    const before = await read(() => window.scrollY);
    for (let step = 0; step < 8; step += 1) {
      rfb.pointer(640, 500, 16);
      rfb.pointer(640, 500, 0);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(await read(() => window.scrollY)).toBeGreaterThan(before);
  }, 120_000);

  it('takes the display down with the session, leaving no X server behind', async () => {
    const dataDir = root();
    const displays = new VncDisplayPool({ dataDir, config: () => resolveConfig({ vncEnabled: true }), logger });
    const display = await displays.acquire(2);
    const lock = `/tmp/.X${display.displayNumber}-lock`;
    expect(existsSync(display.socketPath)).toBe(true);
    await displays.release(2);
    expect(existsSync(display.socketPath)).toBe(false);
    expect(existsSync(lock)).toBe(false);
    expect(displays.get(2)).toBeNull();
  }, 60_000);
});
