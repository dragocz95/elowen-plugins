import { ACTION_KINDS, PAGE_SNAPSHOT_MAX_ELEMENTS, PAGE_CONTEXT_LABEL, PAGE_STATE_MAX_BYTES, SNAPSHOT_ID_PATTERN, TARGET_ID_PATTERN, } from './publicContract.js';
const MARKER = `\n\n${PAGE_CONTEXT_LABEL}\n`;
const MAX_TARGETS = PAGE_SNAPSHOT_MAX_ELEMENTS;
const refuse = (error) => ({ ok: false, error });
export function readRecordedPageState(json) {
    if (Buffer.byteLength(json, 'utf8') > PAGE_STATE_MAX_BYTES)
        return refuse('the page state is larger than a snapshot may be');
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        return refuse('the page state is not JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return refuse('the page state is not a JSON object');
    const state = parsed;
    const snapshotId = state.snapshotId;
    if (typeof snapshotId !== 'string' || !SNAPSHOT_ID_PATTERN.test(snapshotId))
        return refuse('the page state carries no usable snapshot id');
    const url = readUrl(state.url);
    if (!url.ok)
        return url;
    if (typeof state.aria !== 'string' || typeof state.title !== 'string' || typeof state.truncated !== 'boolean')
        return refuse('the snapshot is missing its aria text or metadata');
    const targets = readTargets(state.targets);
    if (!targets.ok)
        return targets;
    return { ok: true, value: { snapshotId, origin: url.value.origin, path: url.value.path, targets: targets.value } };
}
/** Where the description says the page is. The widget sends `origin + pathname` and nothing else, so a
 *  value carrying a query, a fragment or another scheme is not one this widget produced: it is refused
 *  rather than normalised, because the action rule is decided against exactly what arrives. */
function readUrl(raw) {
    if (typeof raw !== 'string' || raw === '')
        return { ok: false, error: 'the page state carries no URL' };
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        return { ok: false, error: 'the page state carries an unparsable URL' };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
        return { ok: false, error: 'the page is not an http(s) page' };
    if (url.origin === 'null' || url.host === '')
        return { ok: false, error: 'the page state carries no origin' };
    if (url.username || url.password)
        return { ok: false, error: 'the page state carries URL credentials' };
    if (url.search !== '' || url.hash !== '')
        return { ok: false, error: 'the page state carries a query or a fragment' };
    return { ok: true, value: { origin: url.origin, path: url.pathname } };
}
/** The targets the description lists, reduced to the two things a decision needs: an id, and what the page
 *  itself claims may be done with it. A duplicate id is refused outright — an action naming it could mean
 *  either element, and the plugin has no way to say which one it approved. */
function readTargets(raw) {
    if (!Array.isArray(raw))
        return { ok: false, error: 'the page state lists no targets' };
    if (raw.length > MAX_TARGETS)
        return { ok: false, error: 'the page state lists more targets than a snapshot may' };
    const targets = [];
    const seen = new Set();
    for (const entry of raw) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
            return { ok: false, error: 'a target is not a JSON object' };
        const record = entry;
        const id = record.id;
        if (typeof id !== 'string' || !TARGET_ID_PATTERN.test(id))
            return { ok: false, error: 'a target carries no usable id' };
        if (seen.has(id))
            return { ok: false, error: `the page state lists the target ${id} twice` };
        seen.add(id);
        const caps = record.caps;
        if (!Array.isArray(caps))
            return { ok: false, error: `the target ${id} claims no capabilities` };
        for (const cap of caps) {
            if (typeof cap !== 'string' || !ACTION_KINDS.includes(cap)) {
                return { ok: false, error: `the target ${id} claims a capability this version has no action for` };
            }
        }
        targets.push({ id, caps: caps });
    }
    return { ok: true, value: targets };
}
/** Metadata only. A snapshot must come from an explicit, settled snapshot action, never this message. */
export function readPageContext(message) {
    const marker = message.lastIndexOf(MARKER);
    if (marker === -1)
        return { ok: false, error: 'no page metadata' };
    try {
        const parsed = JSON.parse(message.slice(marker + MARKER.length));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return { ok: false, error: 'invalid page metadata' };
        return readUrl(('url' in parsed) ? parsed.url : null);
    }
    catch {
        return { ok: false, error: 'invalid page metadata' };
    }
}
