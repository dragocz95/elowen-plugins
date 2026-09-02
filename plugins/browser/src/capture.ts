import type { AxElementRef, CDPSessionLike } from './types.js';

/** Screenshots, through one code path.
 *
 *  All three areas are `Page.captureScreenshot` with a different clip, rather than a viewport helper here
 *  and a page-object call there: the caps below are the reason the tool is safe to expose, and a second
 *  implementation is a second place for them to be missing. */

/** A full-page capture is one image of an arbitrarily long document. Past this height the encode alone
 *  can outlive the operation deadline and the result is unreadable anyway. */
export const MAX_FULL_PAGE_CSS_PX = 8000;
/** …but a per-side limit is not a limit on the WORK. 8000×8000 satisfies both sides and is 64 megapixels,
 *  a quarter of a gigabyte of raw bitmap before a single byte of the encoded result exists to be measured
 *  — so the byte cap below never gets to fire, and the operation dies of memory or of its deadline
 *  instead. The area is the real budget; 16 MP leaves a full-width page (1280×8000 ≈ 10 MP) comfortably
 *  inside it while refusing the square monsters. */
export const MAX_CAPTURE_CSS_AREA = 16_000_000;
/** The image is base64'd into a model transcript, so its size is the reader's cost, not just ours. */
export const MAX_SCREENSHOT_BYTES = 1_572_864; // 1.5 MiB

export type ImageFormat = 'png' | 'jpeg';

export interface CapturedImage {
  data: string;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
  area: 'viewport' | 'fullPage' | 'element';
}

interface Clip { x: number; y: number; width: number; height: number; scale: number }

const decodedBytes = (base64: string): number => Math.floor(base64.length * 0.75);

async function capture(
  cdp: CDPSessionLike,
  area: CapturedImage['area'],
  format: ImageFormat,
  quality: number,
  clip: Clip | undefined,
  beyondViewport: boolean,
): Promise<CapturedImage> {
  const response = await cdp.send<{ data?: string }>('Page.captureScreenshot', {
    format,
    ...(format === 'jpeg' ? { quality } : {}),
    ...(clip ? { clip } : {}),
    captureBeyondViewport: beyondViewport,
    optimizeForSpeed: false,
  });
  const data = response.data;
  if (typeof data !== 'string' || !data) throw new Error('The browser returned no image for this capture.');
  const bytes = decodedBytes(data);
  // Fail closed rather than hand back something smaller than what was asked for. Quietly re-encoding at a
  // lower quality, or scaling the clip, would answer a different question than the caller asked and give
  // no sign it had done so — a screenshot is evidence, and evidence that silently changed is worse than a
  // refusal that says which of the two knobs to turn.
  if (bytes > MAX_SCREENSHOT_BYTES) {
    throw new Error(
      `The ${area} capture is ${Math.round(bytes / 1024)} KiB, over the ${Math.round(MAX_SCREENSHOT_BYTES / 1024)} KiB limit. `
      + 'Capture the viewport instead, or use format "jpeg".',
    );
  }
  return {
    data,
    mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
    width: Math.round(clip?.width ?? 0),
    height: Math.round(clip?.height ?? 0),
    bytes,
    area,
  };
}

/** Refuse a capture before Chrome is asked to rasterize it, and refuse one whose size could not be
 *  established at all.
 *
 *  A zero or missing dimension is the second case: `Page.captureScreenshot` with a 1×1 clip cheerfully
 *  returns a valid image, and a one-pixel PNG passed off as "the page" is worse than an error — it is
 *  evidence of nothing that looks like evidence of something. */
function assertCapturable(subject: string, width: number, height: number): void {
  if (!(width > 0) || !(height > 0)) {
    throw new Error(`${subject} reported no measurable size, so there is nothing to capture.`);
  }
  if (width > MAX_FULL_PAGE_CSS_PX || height > MAX_FULL_PAGE_CSS_PX) {
    throw new Error(
      `${subject} is ${Math.round(width)}×${Math.round(height)} CSS pixels, beyond the ${MAX_FULL_PAGE_CSS_PX} pixel capture limit. `
      + 'Capture the viewport, or an element, instead.',
    );
  }
  if (width * height > MAX_CAPTURE_CSS_AREA) {
    throw new Error(
      `${subject} is ${Math.round(width)}×${Math.round(height)} CSS pixels, `
      + `over the ${Math.round(MAX_CAPTURE_CSS_AREA / 1_000_000)} megapixel capture limit. `
      + 'Capture the viewport, or an element, instead.',
    );
  }
}

interface LayoutMetrics {
  cssContentSize?: { width?: number; height?: number };
  cssLayoutViewport?: { clientWidth?: number; clientHeight?: number };
}

async function layoutMetrics(cdp: CDPSessionLike): Promise<LayoutMetrics> {
  return cdp.send<LayoutMetrics>('Page.getLayoutMetrics');
}

export async function captureViewport(cdp: CDPSessionLike, format: ImageFormat, quality: number): Promise<CapturedImage> {
  const metrics = await layoutMetrics(cdp);
  const width = Math.round(metrics.cssLayoutViewport?.clientWidth ?? 0);
  const height = Math.round(metrics.cssLayoutViewport?.clientHeight ?? 0);
  assertCapturable('The viewport', width, height);
  return capture(cdp, 'viewport', format, quality, { x: 0, y: 0, width, height, scale: 1 }, false);
}

export async function captureFullPage(cdp: CDPSessionLike, format: ImageFormat, quality: number): Promise<CapturedImage> {
  const metrics = await layoutMetrics(cdp);
  const width = Math.round(metrics.cssContentSize?.width ?? 0);
  const height = Math.round(metrics.cssContentSize?.height ?? 0);
  assertCapturable('The document', width, height);
  return capture(cdp, 'fullPage', format, quality, { x: 0, y: 0, width, height, scale: 1 }, true);
}

/** The element's border box, from the same box model the click path uses — so "the element the model can
 *  see" and "the element the model can click" are the same rectangle, resolved the same way. */
export async function captureElement(
  cdp: CDPSessionLike,
  element: AxElementRef,
  format: ImageFormat,
  quality: number,
): Promise<CapturedImage> {
  const response = await cdp.send<{ model?: { border?: number[]; content?: number[] } }>('DOM.getBoxModel', {
    backendNodeId: element.backendNodeId,
  });
  const quad = response.model?.border ?? response.model?.content;
  if (!quad || quad.length < 8) throw new Error(`Element ${element.ref} has no visible box.`);
  const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
  const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  if (!(width > 0) || !(height > 0)) throw new Error(`Element ${element.ref} has no visible box.`);
  assertCapturable(`Element ${element.ref}`, width, height);
  return capture(cdp, 'element', format, quality, { x, y, width, height, scale: 1 }, true);
}

/** The viewport JPEG `BrowserSnapshot` offers beside its accessibility tree. Same capture path as the
 *  explicit screenshot tool, so the caps and the failure modes cannot drift between the two. */
export async function captureModelScreenshot(cdp: CDPSessionLike, quality: number): Promise<string> {
  return (await captureViewport(cdp, 'jpeg', quality)).data;
}
