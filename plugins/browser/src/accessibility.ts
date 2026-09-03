import type { AccessibilitySnapshot, AxElementRef, CDPSessionLike, PageLike } from './types.js';

interface AxValue { value?: unknown }
interface AxProperty { name?: string; value?: AxValue }
interface AxNode {
  nodeId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  properties?: AxProperty[];
}

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'tab', 'treeitem',
  'gridcell', 'row',
]);
const SKIP_ROLES = new Set(['StaticText', 'InlineTextBox', 'LineBreak', 'none', 'generic']);
const TEXT_INPUT_ROLES = new Set(['textbox', 'searchbox']);

const text = (value: unknown, max = 160): string => typeof value === 'string'
  ? value.trim().replace(/\s+/g, ' ').slice(0, max)
  : value === undefined || value === null ? '' : String(value).slice(0, max);

const property = (node: AxNode, name: string): unknown => node.properties?.find((item) => item.name === name)?.value?.value;

export async function captureAccessibilitySnapshot(
  cdp: CDPSessionLike,
  page: PageLike,
  options: { maxNodes?: number; maxChars?: number; now?: number } = {},
): Promise<AccessibilitySnapshot> {
  const maxNodes = Math.max(10, Math.min(2000, options.maxNodes ?? 500));
  const maxChars = Math.max(1000, Math.min(100_000, options.maxChars ?? 24_000));
  const response = await cdp.send<{ nodes?: AxNode[] }>('Accessibility.getFullAXTree');
  const nodes = response.nodes ?? [];
  const nodeMap = new Map(nodes.filter((node) => node.nodeId).map((node) => [node.nodeId!, node]));
  const root = nodes.find((node) => node.role?.value === 'RootWebArea') ?? nodes[0];
  const elements = new Map<string, AxElementRef>();
  const lines: string[] = [];
  let emitted = 0;
  let chars = 0;

  const visit = (node: AxNode | undefined, depth: number): void => {
    if (!node || emitted >= maxNodes || chars >= maxChars) return;
    const role = text(node.role?.value, 40) || 'unknown';
    const name = text(node.name?.value);
    if (node.ignored || SKIP_ROLES.has(role)) {
      for (const childId of node.childIds ?? []) visit(nodeMap.get(childId), depth);
      return;
    }
    const interactive = INTERACTIVE_ROLES.has(role);
    if (name || interactive || role === 'RootWebArea') {
      const ref = `e${emitted}`;
      const states: string[] = [];
      if (property(node, 'disabled') === true) states.push('disabled');
      if (property(node, 'focused') === true) states.push('focused');
      if (property(node, 'checked') === true) states.push('checked');
      if (property(node, 'selected') === true) states.push('selected');
      let line = `${'  '.repeat(Math.min(depth, 8))}[${ref}] ${role}`;
      if (name) line += ` "${name}"`;
      if (!TEXT_INPUT_ROLES.has(role)) {
        const value = text(node.value?.value, 120);
        if (value) line += ` value="${value}"`;
      }
      if (states.length) line += ` (${states.join(', ')})`;
      if (chars + line.length + 1 <= maxChars) {
        lines.push(line);
        chars += line.length + 1;
        // EVERY ref the snapshot printed goes in the map, not only the ones that can be clicked. The
        // text is the contract: a reader offered `[e1] heading "Example Domain"` has been told that e1
        // names something, and answering a later question about it with "not found" describes a snapshot
        // that does not exist. What each ref supports is recorded on the entry instead, so a refusal can
        // name the actual reason — not interactive, or no DOM node at all.
        elements.set(ref, {
          ref,
          backendNodeId: Number.isSafeInteger(node.backendDOMNodeId) ? node.backendDOMNodeId as number : null,
          role,
          name,
          interactive,
          disabled: states.includes('disabled'),
        });
        emitted += 1;
      }
    }
    for (const childId of node.childIds ?? []) visit(nodeMap.get(childId), depth + 1);
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

/** The DOM node behind a ref, or the reason there is none.
 *
 *  An accessibility tree is not a copy of the DOM: a root web area, a generated marker and a few other
 *  computed nodes exist only in the tree. They are still worth printing — they give the reader structure
 *  — but there is nothing on screen to measure, and saying so beats a generic failure. */
export function requireDomNode(element: AxElementRef): number {
  if (element.backendNodeId === null) {
    throw new Error(`Element ${element.ref} is a computed ${element.role} with no DOM element behind it, so it has no box on screen.`);
  }
  return element.backendNodeId;
}

export async function elementCenter(cdp: CDPSessionLike, element: AxElementRef): Promise<{ x: number; y: number }> {
  // Addressable is not the same as operable. Every ref the snapshot printed can be looked at; only an
  // interactive one can be driven, and a click on a heading is a request that cannot be honoured rather
  // than a ref that does not exist.
  if (!element.interactive) {
    throw new Error(`Element ${element.ref} is a ${element.role}, which does not take input. Only interactive elements can be clicked or filled.`);
  }
  if (element.disabled) throw new Error(`Element ${element.ref} is disabled.`);
  const response = await cdp.send<{ model?: { border?: number[]; content?: number[] } }>('DOM.getBoxModel', {
    backendNodeId: requireDomNode(element),
  });
  const quad = response.model?.border ?? response.model?.content;
  if (!quad || quad.length < 8) throw new Error(`Element ${element.ref} has no visible box.`);
  const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
  const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
  return { x: xs.reduce((sum, value) => sum + value, 0) / 4, y: ys.reduce((sum, value) => sum + value, 0) / 4 };
}
