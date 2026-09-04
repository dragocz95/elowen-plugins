/** PILOT (ELOWEN_BROWSER_VNC). noVNC 1.7 ships no types and has no @types package, so the surface this
 *  plugin actually uses is declared here rather than reached for through `any`. Narrow on purpose: a
 *  member that is not written down is a member the bundle cannot call by accident, which is the whole
 *  point of the web typecheck gate. */
declare module '@novnc/novnc' {
  export interface RfbCredentials { username?: string; password?: string; target?: string }

  export interface RfbOptions {
    shared?: boolean;
    credentials?: RfbCredentials;
    repeaterID?: string;
    wsProtocols?: string[];
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string | URL, options?: RfbOptions);
    viewOnly: boolean;
    focusOnClick: boolean;
    clipViewport: boolean;
    dragViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    background: string;
    /** Tight JPEG quality, 0 (smallest) to 9 (best). */
    qualityLevel: number;
    /** zlib compression level, 0 to 9. */
    compressionLevel: number;
    readonly capabilities: { power?: boolean };
    disconnect(): void;
    focus(options?: FocusOptions): void;
    blur(): void;
    sendCtrlAltDel(): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    clipboardPasteFrom(text: string): void;
  }
}
