const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'option', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'tab', 'treeitem',
    'gridcell', 'row',
]);
const SKIP_ROLES = new Set(['StaticText', 'InlineTextBox', 'LineBreak', 'none', 'generic']);
const TEXT_INPUT_ROLES = new Set(['textbox', 'searchbox']);
const text = (value, max = 160) => typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').slice(0, max)
    : value === undefined || value === null ? '' : String(value).slice(0, max);
const property = (node, name) => node.properties?.find((item) => item.name === name)?.value?.value;
export async function captureAccessibilitySnapshot(cdp, page, options = {}) {
    const maxNodes = Math.max(10, Math.min(2000, options.maxNodes ?? 500));
    const maxChars = Math.max(1000, Math.min(100_000, options.maxChars ?? 24_000));
    const response = await cdp.send('Accessibility.getFullAXTree');
    const nodes = response.nodes ?? [];
    const nodeMap = new Map(nodes.filter((node) => node.nodeId).map((node) => [node.nodeId, node]));
    const root = nodes.find((node) => node.role?.value === 'RootWebArea') ?? nodes[0];
    const elements = new Map();
    const lines = [];
    let emitted = 0;
    let chars = 0;
    const visit = (node, depth) => {
        if (!node || emitted >= maxNodes || chars >= maxChars)
            return;
        const role = text(node.role?.value, 40) || 'unknown';
        const name = text(node.name?.value);
        if (node.ignored || SKIP_ROLES.has(role)) {
            for (const childId of node.childIds ?? [])
                visit(nodeMap.get(childId), depth);
            return;
        }
        const interactive = INTERACTIVE_ROLES.has(role);
        if (name || interactive || role === 'RootWebArea') {
            const ref = `e${emitted}`;
            const states = [];
            if (property(node, 'disabled') === true)
                states.push('disabled');
            if (property(node, 'focused') === true)
                states.push('focused');
            if (property(node, 'checked') === true)
                states.push('checked');
            if (property(node, 'selected') === true)
                states.push('selected');
            let line = `${'  '.repeat(Math.min(depth, 8))}[${ref}] ${role}`;
            if (name)
                line += ` "${name}"`;
            if (!TEXT_INPUT_ROLES.has(role)) {
                const value = text(node.value?.value, 120);
                if (value)
                    line += ` value="${value}"`;
            }
            if (states.length)
                line += ` (${states.join(', ')})`;
            if (chars + line.length + 1 <= maxChars) {
                lines.push(line);
                chars += line.length + 1;
                if (interactive && Number.isSafeInteger(node.backendDOMNodeId)) {
                    elements.set(ref, {
                        ref,
                        backendNodeId: node.backendDOMNodeId,
                        role,
                        name,
                        disabled: states.includes('disabled'),
                    });
                }
                emitted += 1;
            }
        }
        for (const childId of node.childIds ?? [])
            visit(nodeMap.get(childId), depth + 1);
    };
    visit(root, 0);
    const title = await page.title().catch(() => '');
    const url = page.url();
    const suffix = emitted >= maxNodes || chars >= maxChars ? '\n… snapshot truncated' : '';
    return {
        title,
        url,
        text: `Page: ${title}\nURL: ${url}\n\nAccessibility tree:\n${lines.join('\n')}${suffix}`,
        elements,
        capturedAt: options.now ?? Date.now(),
    };
}
export async function elementCenter(cdp, element) {
    if (element.disabled)
        throw new Error(`Element ${element.ref} is disabled.`);
    const response = await cdp.send('DOM.getBoxModel', {
        backendNodeId: element.backendNodeId,
    });
    const quad = response.model?.border ?? response.model?.content;
    if (!quad || quad.length < 8)
        throw new Error(`Element ${element.ref} has no visible box.`);
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    return { x: xs.reduce((sum, value) => sum + value, 0) / 4, y: ys.reduce((sum, value) => sum + value, 0) / 4 };
}
