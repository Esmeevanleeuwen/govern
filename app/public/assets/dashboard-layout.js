/** A small, data-only layout model. Renderers remain in the registering feature. */
export const DASHBOARD_STORAGE_KEY = 'govern.dashboard.v1';
const VERSION = 1;
const sizes = ['small', 'wide', 'full'];
const clone = value => JSON.parse(JSON.stringify(value));
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,159}$/i.test(value);

function browserStorage() {
    try { return globalThis.localStorage || null; } catch { return null; }
}

/** Registry entries accept {id,titleKey,defaultSize,allowedSizes,...renderer properties}. */
export function createDashboardLayout(registry, {storageKey = DASHBOARD_STORAGE_KEY, storage = browserStorage()} = {}) {
    const definitions = new Map();
    for (const definition of registry) {
        if (!validId(definition.id) || definitions.has(definition.id)) throw new Error('Dashboard block IDs must be valid and unique.');
        const allowedSizes = [...new Set((definition.allowedSizes || sizes).filter(size => sizes.includes(size)))];
        if (!allowedSizes.length) throw new Error('A dashboard block must allow at least one width.');
        definitions.set(definition.id, {
            ...definition, allowedSizes,
            defaultSize: allowedSizes.includes(definition.defaultSize) ? definition.defaultSize : allowedSizes[0],
        });
    }
    const listeners = new Set();
    let draft = null;
    let orderChanged = false;
    let dirtySizes = new Set();
    let dirtyVisibility = new Set();

    function normalize(value) {
        const source = record(value) ? value : {};
        const blocks = {};
        if (record(source.blocks)) {
            for (const [id, entry] of Object.entries(source.blocks)) {
                if (validId(id) && record(entry)) Object.defineProperty(blocks, id, {value: {...entry}, enumerable: true, configurable: true, writable: true});
            }
        }
        const order = [...new Set((Array.isArray(source.order) ? source.order : []).filter(validId))];
        // A temporarily unavailable block can have settings even when an older client omitted it from the order.
        for (const id of Object.keys(blocks)) if (!order.includes(id)) order.push(id);
        for (const [id, definition] of definitions) {
            if (!order.includes(id)) order.push(id);
            const existing = blocks[id] || {};
            Object.defineProperty(blocks, id, {value: {
                ...existing,
                size: definition.allowedSizes.includes(existing.size) ? existing.size : definition.defaultSize,
                hidden: typeof existing.hidden === 'boolean' ? existing.hidden : false,
            }, enumerable: true, configurable: true, writable: true});
        }
        return {...source, version: VERSION, order, blocks};
    }

    function decode(raw) {
        if (!raw) return {layout: normalize({}), writable: true};
        try {
            const parsed = JSON.parse(raw);
            if (!record(parsed)) throw new Error('Invalid dashboard layout');
            return {layout: normalize(parsed), writable: parsed.version === undefined || parsed.version === 0 || parsed.version === VERSION};
        } catch { return {layout: normalize({}), writable: true}; }
    }

    let lastSeenRaw = null;
    try { lastSeenRaw = storage?.getItem(storageKey) || null; } catch { /* Session layout still works. */ }
    let {layout: committed, writable} = decode(lastSeenRaw);
    const active = () => draft || committed;

    function getLayout() { return clone(active()); }
    function isEditing() { return draft !== null; }

    function getBlocks({includeHidden = false} = {}) {
        const layout = active();
        return layout.order.filter(id => definitions.has(id)).map(id => ({
            ...layout.blocks[id], ...definitions.get(id), id,
            size: layout.blocks[id].size, hidden: layout.blocks[id].hidden,
        })).filter(block => includeHidden || !block.hidden);
    }

    function notify(reason, saved = false) {
        for (const callback of listeners) callback(getLayout(), {reason, editing: isEditing(), saved});
    }

    function begin() {
        if (!draft) {
            draft = clone(committed);
            orderChanged = false;
            dirtySizes = new Set();
            dirtyVisibility = new Set();
            notify('begin');
        }
        return getLayout();
    }

    function replaceKnownOrder(layout, ordered) {
        const remaining = [...ordered];
        layout.order = layout.order.map(id => definitions.has(id) ? remaining.shift() : id);
        layout.order.push(...remaining);
    }

    function reorderVisible(ordered) {
        const visible = new Set(ordered);
        const remaining = [...ordered];
        draft.order = draft.order.map(id => visible.has(id) ? remaining.shift() : id);
        orderChanged = true;
        notify('move');
        return true;
    }

    /** Offset is among visible known blocks. Hidden and unknown entries retain their slots. */
    function move(id, offset) {
        if (!draft || !Number.isInteger(offset) || offset === 0) return false;
        const ordered = getBlocks().map(block => block.id);
        const from = ordered.indexOf(id), to = Math.max(0, Math.min(ordered.length - 1, from + offset));
        if (from < 0 || from === to) return false;
        ordered.splice(to, 0, ordered.splice(from, 1)[0]);
        return reorderVisible(ordered);
    }

    function moveBefore(id, beforeId) {
        if (!draft || id === beforeId) return false;
        const ordered = getBlocks().map(block => block.id);
        const from = ordered.indexOf(id);
        if (from < 0 || (beforeId !== null && !ordered.includes(beforeId))) return false;
        ordered.splice(from, 1);
        ordered.splice(beforeId === null ? ordered.length : ordered.indexOf(beforeId), 0, id);
        return reorderVisible(ordered);
    }

    function setSize(id, size) {
        if (!draft || !definitions.get(id)?.allowedSizes.includes(size)) return false;
        draft.blocks[id].size = size;
        dirtySizes.add(id);
        notify('size');
        return true;
    }

    function setHidden(id, hidden) {
        if (!draft || !definitions.has(id) || typeof hidden !== 'boolean') return false;
        draft.blocks[id].hidden = hidden;
        dirtyVisibility.add(id);
        notify('visibility');
        return true;
    }

    /** Reset only registered blocks in this layout draft, preserving settings for unavailable blocks. */
    function reset() {
        if (!draft) return false;
        replaceKnownOrder(draft, [...definitions.keys()]);
        for (const [id, definition] of definitions) {
            draft.blocks[id] = {...draft.blocks[id], size: definition.defaultSize, hidden: false};
            dirtySizes.add(id);
            dirtyVisibility.add(id);
        }
        orderChanged = true;
        notify('reset');
        return true;
    }

    function commit() {
        if (!draft) return {saved: false, layout: getLayout()};
        // Merge independent changes from another tab; do not erase unknown block settings.
        try {
            const raw = storage?.getItem(storageKey) || null;
            if (raw !== lastSeenRaw) {
                const incoming = decode(raw);
                committed = incoming.layout;
                writable = incoming.writable;
                lastSeenRaw = raw;
            }
        } catch { /* Keep the latest session state if storage cannot be read. */ }
        const next = clone(committed);
        if (orderChanged) replaceKnownOrder(next, draft.order.filter(id => definitions.has(id)));
        for (const id of dirtySizes) next.blocks[id].size = draft.blocks[id].size;
        for (const id of dirtyVisibility) next.blocks[id].hidden = draft.blocks[id].hidden;
        committed = normalize(next);
        draft = null;
        let saved = false;
        if (storage && writable) {
            try {
                const raw = JSON.stringify(committed);
                storage.setItem(storageKey, raw);
                lastSeenRaw = raw;
                saved = true;
            } catch { /* The committed session arrangement still applies. */ }
        }
        notify('commit', saved);
        return {saved, layout: getLayout()};
    }

    function cancel() {
        draft = null;
        orderChanged = false;
        dirtySizes.clear();
        dirtyVisibility.clear();
        notify('cancel');
        return getLayout();
    }

    function subscribe(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
    }

    function storageChanged(event) {
        if (event.key !== storageKey && event.key !== null) return;
        if (event.storageArea && event.storageArea !== storage) return;
        if (event.newValue) {
            try { JSON.parse(event.newValue); } catch { return; }
        }
        const raw = event.key === null ? null : event.newValue;
        const incoming = decode(raw);
        if (!incoming.writable) { writable = false; lastSeenRaw = raw; return; }
        committed = incoming.layout;
        writable = true;
        lastSeenRaw = raw;
        notify('storage');
    }
    globalThis.addEventListener?.('storage', storageChanged);

    return {
        getLayout, getBlocks, isEditing, begin, move, moveBefore, setSize, setHidden, reset, commit, cancel, subscribe,
        dispose() { globalThis.removeEventListener?.('storage', storageChanged); listeners.clear(); },
    };
}
