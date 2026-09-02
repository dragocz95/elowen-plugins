/** Screenshots, through one code path.
 *
 *  All three areas are `Page.captureScreenshot` with a different clip, rather than a viewport helper here
 *  and a page-object call there: the caps below are the reason the tool is safe to expose, and a second
 *  implementation is a second place for them to be missing. */
/** A full-page capture is one image of an arbitrarily long document. Past this height the encode alone
 *  can outlive the operation deadline and the result is unreadable anyway. */
export const MAX_FULL_PAGE_CSS_PX = 8000;
/** The image is base64'd into a model transcript, so its size is the reader's cost, not just ours. */
export const MAX_SCREENSHOT_BYTES = 1_572_864; // 1.5 MiB
const decodedBytes = (base64) => Math.floor(base64.length * 0.75);
async function capture(cdp, area, format, quality, clip, beyondViewport) {
    const response = await cdp.send('Page.captureScreenshot', {
        format,
        ...(format === 'jpeg' ? { quality } : {}),
        ...(clip ? { clip } : {}),
        captureBeyondViewport: beyondViewport,
        optimizeForSpeed: false,
    });
    const data = response.data;
    if (typeof data !== 'string' || !data)
        throw new Error('The browser returned no image for this capture.');
    const bytes = decodedBytes(data);
    // Fail closed rather than hand back something smaller than what was asked for. Quietly re-encoding at a
    // lower quality, or scaling the clip, would answer a different question than the caller asked and give
    // no sign it had done so — a screenshot is evidence, and evidence that silently changed is worse than a
    // refusal that says which of the two knobs to turn.
    if (bytes > MAX_SCREENSHOT_BYTES) {
        throw new Error(`The ${area} capture is ${Math.round(bytes / 1024)} KiB, over the ${Math.round(MAX_SCREENSHOT_BYTES / 1024)} KiB limit. `
            + 'Capture the viewport instead, or use format "jpeg".');
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
async function layoutMetrics(cdp) {
    return cdp.send('Page.getLayoutMetrics');
}
export async function captureViewport(cdp, format, quality) {
    const metrics = await layoutMetrics(cdp);
    const width = Math.max(1, Math.round(metrics.cssLayoutViewport?.clientWidth ?? 0));
    const height = Math.max(1, Math.round(metrics.cssLayoutViewport?.clientHeight ?? 0));
    return capture(cdp, 'viewport', format, quality, { x: 0, y: 0, width, height, scale: 1 }, false);
}
export async function captureFullPage(cdp, format, quality) {
    const metrics = await layoutMetrics(cdp);
    const width = Math.max(1, Math.round(metrics.cssContentSize?.width ?? 0));
    const height = Math.max(1, Math.round(metrics.cssContentSize?.height ?? 0));
    if (height > MAX_FULL_PAGE_CSS_PX || width > MAX_FULL_PAGE_CSS_PX) {
        throw new Error(`The document is ${width}×${height} CSS pixels, beyond the ${MAX_FULL_PAGE_CSS_PX} pixel full-page limit. `
            + 'Capture the viewport, or an element, instead.');
    }
    return capture(cdp, 'fullPage', format, quality, { x: 0, y: 0, width, height, scale: 1 }, true);
}
/** The element's border box, from the same box model the click path uses — so "the element the model can
 *  see" and "the element the model can click" are the same rectangle, resolved the same way. */
export async function captureElement(cdp, element, format, quality) {
    const response = await cdp.send('DOM.getBoxModel', {
        backendNodeId: element.backendNodeId,
    });
    const quad = response.model?.border ?? response.model?.content;
    if (!quad || quad.length < 8)
        throw new Error(`Element ${element.ref} has no visible box.`);
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;
    if (!(width > 0) || !(height > 0))
        throw new Error(`Element ${element.ref} has no visible box.`);
    if (width > MAX_FULL_PAGE_CSS_PX || height > MAX_FULL_PAGE_CSS_PX) {
        throw new Error(`Element ${element.ref} is ${Math.round(width)}×${Math.round(height)} CSS pixels, beyond the ${MAX_FULL_PAGE_CSS_PX} pixel capture limit.`);
    }
    return capture(cdp, 'element', format, quality, { x, y, width, height, scale: 1 }, true);
}
/** The viewport JPEG `BrowserSnapshot` offers beside its accessibility tree. Same capture path as the
 *  explicit screenshot tool, so the caps and the failure modes cannot drift between the two. */
export async function captureModelScreenshot(cdp, quality) {
    return (await captureViewport(cdp, 'jpeg', quality)).data;
}
