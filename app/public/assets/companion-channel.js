import {captureRecordContext, recordContextId} from './companion-model.js';

const VERSION = 1, TICK = 2000, TIMEOUT = 12000;
const validId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const validMode = value => value === 'compare' || value === 'radar';
const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
const supported = () => typeof BroadcastChannel === 'function' && typeof globalThis.crypto?.getRandomValues === 'function';
const envelope = (value, role) => value && typeof value === 'object' && value.version === VERSION && value.role === role
    && validId(value.sender) && Number.isSafeInteger(value.sequence) && value.sequence > 0 && typeof value.type === 'string';

/** One explicit main-window/companion pair. Messages contain record coordinates only. */
export function createCompanionSource({onStatus = () => {}, onSelect = () => {}} = {}) {
    let status = 'idle', destroyed = false, channel = null, popup = null, session = null, sender = null;
    let sequence = 0, receiver = null, received = 0, seen = 0, opened = 0, timer = null;
    let selected = null, mode = 'compare';
    const pending = new Map();
    const statusChange = next => { if (status !== next) { status = next; onStatus(next); } };
    function send(type, data, target = receiver) {
        if (!channel || destroyed) return false;
        try { channel.postMessage({version: VERSION, role: 'source', sender, target, sequence: ++sequence, type, data}); return true; }
        catch { statusChange('disconnected'); return false; }
    }
    function welcome() {
        send('welcome', {mode, selection: selected});
        for (const context of pending.values()) send('pin', context);
        pending.clear();
    }
    function receive(event) {
        const value = event.data;
        if (!envelope(value, 'companion') || value.target && value.target !== sender) return;
        if (value.type === 'ready') {
            if (value.sender === receiver && value.sequence <= received) return;
            receiver = value.sender; received = value.sequence; seen = Date.now();
            statusChange('connected'); welcome(); return;
        }
        if (value.sender !== receiver || value.sequence <= received || !['pong', 'request', 'select', 'mode', 'bye'].includes(value.type)) return;
        const context = value.type === 'select' ? captureRecordContext(value.data) : null;
        if (value.type === 'select' && !context || value.type === 'mode' && !validMode(value.data)) return;
        received = value.sequence; seen = Date.now();
        if (value.type === 'bye') { statusChange('disconnected'); receiver = null; return; }
        const resuming = status !== 'connected';
        statusChange('connected');
        if (resuming) welcome();
        if (value.type === 'request') send('selection', selected);
        else if (value.type === 'select') onSelect(context);
        else if (value.type === 'mode') mode = value.data;
    }
    function heartbeat() {
        if (destroyed) return;
        if (popup?.closed) { receiver = null; statusChange('disconnected'); return; }
        if (receiver) { send('ping'); if (Date.now() - seen > TIMEOUT) statusChange('disconnected'); }
        else if (opened && Date.now() - opened > TIMEOUT) statusChange('disconnected');
    }
    function pageHide(event) { if (!event.persisted) destroy(); }
    function pageShow(event) { if (event.persisted) heartbeat(); }
    function initialize() {
        if (channel) return true;
        if (!supported()) { statusChange('unsupported'); return false; }
        try {
            session = randomId(); sender = randomId();
            channel = new BroadcastChannel('govern.companion.v1.' + session);
            channel.addEventListener('message', receive); timer = setInterval(heartbeat, TICK);
            window.addEventListener('pagehide', pageHide); window.addEventListener('pageshow', pageShow); return true;
        } catch { statusChange('unsupported'); return false; }
    }
    function departed() {
        if (!popup || popup.closed) return false;
        try {
            const href = popup.location?.href;
            if (!href) return false;
            if (href === 'about:blank') return status === 'disconnected';
            const current = new URL(href);
            return current.origin !== window.location.origin || current.pathname !== '/companion.php' || current.hash !== '#' + session;
        } catch { return true; } // A manually navigated cross-origin popup can be restored by an explicit action.
    }
    function open(nextMode = 'compare') {
        if (destroyed || !validMode(nextMode) || !initialize()) return false;
        mode = nextMode;
        if (popup && !popup.closed) {
            if (departed()) {
                try { popup.location.href = new URL('/companion.php#' + session, window.location.origin).href; }
                catch { statusChange('blocked'); return false; }
                receiver = null; received = 0; opened = Date.now(); statusChange('connecting');
            }
            try { popup.focus(); } catch { /* Browser-controlled focus. */ }
            if (receiver && status === 'connected') { send('mode', mode); send('selection', selected); }
            else statusChange('connecting');
            return true;
        }
        receiver = null; received = 0; opened = Date.now();
        try { popup = window.open('/companion.php#' + session, 'govern-companion-' + session,
            'popup,width=1240,height=900,resizable=yes,scrollbars=yes'); }
        catch { popup = null; }
        if (!popup) { statusChange('blocked'); return false; }
        statusChange('connecting'); return true;
    }
    function select(context) {
        if (destroyed) return false;
        const captured = context === null ? null : captureRecordContext(context);
        if (context !== null && !captured) return false;
        const unchanged = selected === null && captured === null || selected && captured
            && recordContextId(selected) === recordContextId(captured) && selected.guided === captured.guided;
        selected = captured;
        if (!unchanged && receiver && status === 'connected') send('selection', selected);
        return true;
    }
    function pin(context) {
        const captured = captureRecordContext(context);
        if (!captured || destroyed) return false;
        // Sending another record keeps keyboard focus on the main screen.
        if (popup && !popup.closed && !departed()) { mode = 'compare'; if (receiver && status === 'connected') send('mode', mode); }
        else if (!open('compare')) return false;
        if (receiver && status === 'connected') return send('pin', captured);
        const id = recordContextId(captured);
        if (pending.size >= 16 && !pending.has(id)) pending.delete(pending.keys().next().value);
        pending.set(id, captured); return true;
    }
    function destroy() {
        if (destroyed) return;
        send('bye'); destroyed = true; clearInterval(timer);
        channel?.removeEventListener('message', receive); channel?.close(); window.removeEventListener('pagehide', pageHide);
        window.removeEventListener('pageshow', pageShow);
        pending.clear(); channel = null; receiver = null; popup = null; selected = null; statusChange('disconnected');
    }
    return {open, select, pin, destroy, get status() { return status; }};
}

/** The paired page fetches its own read-only data; this channel never transports rows. */
export function createCompanionReceiver({onSelection = () => {}, onPin = () => {}, onMode = () => {}, onStatus = () => {}} = {}) {
    let status = 'idle', destroyed = false, channel = null, sender = null, source = null, sequence = 0, received = 0, seen = 0, timer = null;
    const statusChange = next => { if (status !== next) { status = next; onStatus(next); } };
    function send(type, data) {
        if (!channel || destroyed) return false;
        try { channel.postMessage({version: VERSION, role: 'companion', sender, target: source, sequence: ++sequence, type, data}); return true; }
        catch { statusChange('disconnected'); return false; }
    }
    function receive(event) {
        const value = event.data;
        if (!envelope(value, 'source') || value.target !== sender || source && value.sender !== source || value.sequence <= received) return;
        if (!['welcome', 'selection', 'pin', 'mode', 'ping', 'bye'].includes(value.type) || !source && value.type !== 'welcome') return;
        let context = null;
        if (value.type === 'welcome') {
            if (!value.data || !validMode(value.data.mode)) return;
            context = value.data.selection === null ? null : captureRecordContext(value.data.selection);
            if (value.data.selection !== null && !context) return;
        } else if (value.type === 'selection' || value.type === 'pin') {
            context = value.data === null ? null : captureRecordContext(value.data);
            if (!context && (value.type === 'pin' || value.data !== null)) return;
        } else if (value.type === 'mode' && !validMode(value.data)) return;
        source = value.sender; received = value.sequence; seen = Date.now();
        if (value.type === 'bye') { statusChange('disconnected'); return; }
        statusChange('connected');
        if (value.type === 'welcome') { onMode(value.data.mode); onSelection(context); }
        else if (value.type === 'selection') onSelection(context);
        else if (value.type === 'pin') onPin(context);
        else if (value.type === 'mode') onMode(value.data);
        else if (value.type === 'ping') send('pong');
    }
    function heartbeat() {
        if (destroyed || !channel) return;
        if (status !== 'connected') send('ready');
        else if (Date.now() - seen > TIMEOUT) { statusChange('disconnected'); send('ready'); }
    }
    function pageHide(event) { if (!event.persisted) destroy(); }
    function pageShow(event) { if (event.persisted && channel && !destroyed) { statusChange('connecting'); send('ready'); } }
    function destroy() {
        if (destroyed) return;
        send('bye'); destroyed = true; clearInterval(timer);
        channel?.removeEventListener('message', receive); channel?.close(); window.removeEventListener('pagehide', pageHide); channel = null;
        window.removeEventListener('pageshow', pageShow);
    }
    const session = window.location.hash.slice(1);
    if (!validId(session)) statusChange('invalid');
    else if (!supported()) statusChange('unsupported');
    else {
        try {
            sender = randomId(); channel = new BroadcastChannel('govern.companion.v1.' + session);
            channel.addEventListener('message', receive); window.addEventListener('pagehide', pageHide);
            window.addEventListener('pageshow', pageShow);
            statusChange('connecting'); send('ready'); timer = setInterval(heartbeat, TICK);
        } catch { statusChange('unsupported'); }
    }
    return {
        sendSelect(context) { const captured = captureRecordContext(context); return Boolean(captured && status === 'connected' && send('select', captured)); },
        setMode(mode) { return validMode(mode) && send('mode', mode); },
        requestSelection() { return send('request'); }, destroy, get status() { return status; },
    };
}
