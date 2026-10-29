// Semantic descriptions are attached to DOM nodes, never copied into HTML as JSON.
const descriptions = new WeakMap();
const genericKeys = new WeakMap();
let nextKey = 0;

export function registerSelection(node, description) {
    descriptions.set(node, description);
    const meta = typeof description === 'function' ? description() : description;
    node.dataset.selectionKind = meta.kind || 'element';
    if (meta.key) node.dataset.selectionKey = meta.key;
    return node;
}

function genericMeta(node) {
    if (!genericKeys.has(node)) genericKeys.set(node, 'element:' + ++nextKey);
    const label = node.getAttribute('aria-label') ||
        (node.labels?.length ? [...node.labels].map(label => label.textContent.trim()).join(' ') : '') ||
        node.getAttribute('placeholder') || node.textContent?.trim().replace(/\s+/g, ' ') || node.localName;
    return {kind: node.matches('button,a,input,select,textarea,summary') ? 'control' : 'element',
        key: genericKeys.get(node), label: label.slice(0, 120), role: node.getAttribute('role') || node.localName};
}

export function describeSelection(node, root) {
    if (!(node instanceof Element) || !root.contains(node) || node.closest('[data-selection-ui],script,style,[hidden],[inert]')) return null;
    const svg = node.closest('svg');
    if (svg && !descriptions.has(node)) node = node.closest('[data-selection-kind]') || svg.closest('button,a') || svg;
    const control = node.closest('button,a,input,select,textarea,summary');
    if (control && root.contains(control)) node = control;
    else if (!descriptions.has(node)) {
        const cell = node.closest('td,th');
        const owner = node.closest('[data-selection-kind]');
        if (cell) node = cell;
        else if (owner && ['SPAN', 'CODE', 'STRONG', 'I', 'SVG', 'PATH'].includes(node.tagName.toUpperCase())) node = owner;
    }
    const source = descriptions.get(node);
    const meta = source ? (typeof source === 'function' ? source() : source) : genericMeta(node);
    return {node, meta: {...meta}, tag: node.localName, connected: node.isConnected};
}

export function selectionAncestors(target, root) {
    const result = [];
    let node = target.node;
    while (node && root.contains(node)) {
        if (node === target.node || descriptions.has(node)) {
            const item = describeSelection(node, root);
            if (item && !result.some(parent => parent.meta.key === item.meta.key)) result.unshift(item);
        }
        node = node.parentElement;
    }
    return result.slice(-4);
}

export function registeredSelections(root) {
    return [...root.querySelectorAll('[data-selection-kind]')].map(node => describeSelection(node, root))
        .filter(item => item && item.node.getClientRects().length);
}
