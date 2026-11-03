import {t} from './i18n.js';
import './modal-shell-messages.js';
import {constrainWindow} from './modal-geometry.js';

const entries = new Set();
const byDialog = new WeakMap();
let sequence = 0;
let serial = 0;
let press = null;
let installed = false;

const isModal = dialog => dialog.matches(':modal');
const openEntries = () => [...entries].filter(entry => entry.dialog.open && entry.dialog.isConnected);
const viewport = () => ({width: Math.min(document.documentElement.clientWidth, window.visualViewport?.width || Infinity), height: window.visualViewport?.height || window.innerHeight});
const inBox = (event, element) => {
    const box = element.getBoundingClientRect();
    return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
};
function topEntry() {
    const opened = openEntries();
    const blocking = opened.filter(entry => isModal(entry.dialog));
    // An unrelated native modal also makes the workspace's floating windows inert.
    if (!blocking.length && document.querySelector('dialog:modal')) return null;
    return (blocking.length ? blocking : opened).sort((a, b) => a.order - b.order).at(-1);
}
function entryAt(event) {
    return openEntries().find(entry => entry.dialog.contains(event.target) && inBox(event, entry.dialog));
}
function onPointerDown(event) {
    if (event.button !== 0) { press = null; return; }
    const within = entryAt(event);
    within?.bringToFront();
    const top = topEntry();
    press = top && !within ? {entry: top, x: event.clientX, y: event.clientY, id: event.pointerId} : null;
}
function onClick(event) {
    const started = press;
    press = null;
    if (!started || event.button !== 0 || entryAt(event) ||
        Math.hypot(event.clientX - started.x, event.clientY - started.y) > 6) return;
    // A launcher can synchronously open a peer window. Keep both in that case.
    queueMicrotask(() => {
        const allowed = typeof started.entry.outside === 'function' ? started.entry.outside() : started.entry.outside;
        if (topEntry() === started.entry && allowed) started.entry.requestClose('outside');
    });
}
function onKeyDown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const top = topEntry();
    if (!top || isModal(top.dialog)) return; // Native dialogs own their cancel event.
    event.preventDefault();
    event.stopPropagation();
    top.requestClose('escape');
}
function onFocus(event) {
    const entry = openEntries().find(item => item.dialog.contains(event.target));
    entry?.bringToFront();
}
function onResize() { for (const entry of openEntries()) entry.constrain(); }
function install() {
    if (installed) return;
    installed = true;
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocus);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
}
function uninstall() {
    if (entries.size || !installed) return;
    installed = false;
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('focusin', onFocus);
    window.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
    press = null;
}

/** Add behaviour to an existing native dialog without owning its content or close guards. */
export function attachDialog(dialog, {handle = dialog.querySelector('header, h2'), draggable = true, outside = true, keyboardHandle = false} = {}) {
    if (byDialog.has(dialog)) return byDialog.get(dialog);
    if (typeof handle === 'string') handle = dialog.querySelector(handle);
    let drag = null;
    let detached = false;
    const listeners = new AbortController();
    const signal = listeners.signal;
    const oldTabIndex = handle?.getAttribute('tabindex');
    const oldDescription = handle?.getAttribute('aria-description');
    const oldShortcuts = handle?.getAttribute('aria-keyshortcuts');
    const originalZIndex = dialog.style.zIndex;
    const originalPosition = Object.fromEntries(['position', 'left', 'top', 'right', 'bottom', 'margin'].map(name => [name, dialog.style[name]]));
    dialog.classList.add('govern-window');

    function moveTo(x, y) {
        const box = dialog.getBoundingClientRect();
        const position = constrainWindow({x, y}, box, viewport());
        Object.assign(dialog.style, {position: 'fixed', left: position.x + 'px', top: position.y + 'px', right: 'auto', bottom: 'auto', margin: '0'});
    }
    function endDrag(event) {
        if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
        const pointerId = drag.id;
        drag = null;
        try { handle.releasePointerCapture(pointerId); } catch { /* Already released by the browser. */ }
        dialog.classList.remove('is-dragging');
        delete document.documentElement.dataset.windowDragging;
        press = null;
    }
    function translate() {
        if (draggable && handle) handle.setAttribute('aria-description', t('modalShell.move'));
    }
    const entry = {
        dialog, outside, order: 0,
        bringToFront() { if (detached) return; entry.order = ++sequence; if (!isModal(dialog)) dialog.style.zIndex = String(1000 + sequence); },
        requestClose(reason = 'dismiss') {
            if (detached || !dialog.open) return false;
            const event = new CustomEvent('cancel', {cancelable: true, detail: {reason}});
            if (!dialog.dispatchEvent(event)) return false;
            dialog.close();
            return true;
        },
        constrain() {
            if (detached || !dialog.open || !draggable) return;
            if (dialog.classList.contains('expanded')) { moveTo(0, 0); return; }
            const box = dialog.getBoundingClientRect(); moveTo(box.left, box.top);
        },
        resetPosition() { Object.assign(dialog.style, originalPosition); },
        destroy() {
            if (detached) return;
            detached = true;
            endDrag(); observer.disconnect(); sizeObserver.disconnect(); listeners.abort(); entries.delete(entry); byDialog.delete(dialog);
            dialog.classList.remove('govern-window');
            entry.resetPosition(); dialog.style.zIndex = originalZIndex;
            if (draggable && handle) {
                handle.classList.remove('modal-drag-handle');
                for (const [name, value] of [['tabindex', oldTabIndex], ['aria-description', oldDescription], ['aria-keyshortcuts', oldShortcuts]]) {
                    if (value === null) handle.removeAttribute(name); else handle.setAttribute(name, value);
                }
            }
            uninstall();
        },
    };
    const observer = new MutationObserver(records => {
        if (dialog.open && records.some(record => record.attributeName === 'open')) entry.bringToFront();
        if (dialog.open && records.some(record => record.attributeName === 'class')) entry.constrain();
    });
    observer.observe(dialog, {attributes: true, attributeFilter: ['open', 'class']});
    const sizeObserver = new ResizeObserver(() => entry.constrain());
    sizeObserver.observe(dialog);
    dialog.addEventListener('close', () => endDrag(), {signal});
    if (draggable && handle) {
        handle.classList.add('modal-drag-handle');
        if (oldTabIndex === null) handle.tabIndex = keyboardHandle ? 0 : -1;
        handle.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight');
        translate();
        window.addEventListener('govern:languagechange', translate, {signal});
        handle.addEventListener('pointerdown', event => {
            if (!dialog.open || dialog.classList.contains('expanded') || event.button !== 0 ||
                event.target.closest('button, a, input, select, textarea, label, summary, [contenteditable="true"], [data-no-drag]')) return;
            const box = dialog.getBoundingClientRect();
            drag = {id: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top, active: false};
            entry.bringToFront();
            handle.focus({preventScroll: true});
            handle.setPointerCapture(event.pointerId);
            event.preventDefault();
        }, {signal});
        handle.addEventListener('pointermove', event => {
            if (!drag || drag.id !== event.pointerId) return;
            const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
            if (!drag.active && Math.hypot(dx, dy) < 4) return;
            drag.active = true;
            dialog.classList.add('is-dragging');
            document.documentElement.dataset.windowDragging = 'true';
            moveTo(drag.left + dx, drag.top + dy);
        }, {signal});
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(name, endDrag, {signal});
        handle.addEventListener('keydown', event => {
            if (!event.altKey || !handle.contains(event.target) || dialog.classList.contains('expanded') ||
                event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
            const step = event.shiftKey ? 48 : 16;
            const delta = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]}[event.key];
            if (!delta) return;
            event.preventDefault(); event.stopPropagation();
            const box = dialog.getBoundingClientRect(); moveTo(box.left + delta[0], box.top + delta[1]);
        }, {signal});
    }
    entries.add(entry); byDialog.set(dialog, entry); install();
    if (dialog.open) entry.bringToFront();
    return entry;
}

function capturedContext(value) {
    const copy = structuredClone(value);
    const visited = new WeakSet();
    function freeze(item) {
        if (!item || typeof item !== 'object' || visited.has(item)) return item;
        visited.add(item);
        Object.values(item).forEach(freeze);
        return Object.freeze(item);
    }
    return freeze(copy);
}

/** A fresh content owner receives only its captured context and a cancellable load. */
export function createModal({title = '', description = '', context = null, load, render = value => value,
    beforeClose, onClose, modal = false, className = '', disposeOnClose = true} = {}) {
    const captured = capturedContext(context);
    const id = 'govern-modal-' + (++serial);
    const dialog = document.createElement('dialog');
    dialog.id = id; dialog.className = 'modal-shell ' + className; dialog.setAttribute('aria-labelledby', id + '-title');
    const header = document.createElement('header'); header.className = 'modal-shell-header';
    const heading = document.createElement('div'); heading.className = 'modal-shell-heading';
    const titleNode = document.createElement('h2'); titleNode.className = 'modal-shell-title'; titleNode.id = id + '-title'; titleNode.textContent = title;
    const descriptionNode = document.createElement('p'); descriptionNode.className = 'modal-shell-description'; descriptionNode.textContent = description;
    descriptionNode.hidden = !description;
    if (description) { descriptionNode.id = id + '-description'; dialog.setAttribute('aria-describedby', descriptionNode.id); }
    heading.append(titleNode, descriptionNode);
    const closeButton = document.createElement('button'); closeButton.type = 'button'; closeButton.className = 'icon-button modal-shell-close'; closeButton.textContent = '×';
    header.append(heading, closeButton);
    const body = document.createElement('div'); body.className = 'modal-shell-body';
    dialog.append(header, body); document.body.append(dialog);
    const shell = attachDialog(dialog, {handle: header, keyboardHandle: true});
    let controller = null, revision = 0, cleanup = null, opener = null, destroyed = false, closing = false, closeNotified = true;
    let statusView = null;
    const lifetime = new AbortController();
    const translate = () => {
        closeButton.title = t('modalShell.close'); closeButton.setAttribute('aria-label', t('modalShell.close'));
        if (statusView && body.contains(statusView.text)) {
            statusView.text.textContent = t('modalShell.' + statusView.key);
            if (statusView.retry) statusView.retry.textContent = t('modalShell.retry');
        }
    };
    window.addEventListener('govern:languagechange', translate, {signal: lifetime.signal}); translate();
    function disposeContent() { controller?.abort(); controller = null; statusView = null; if (cleanup) { const dispose = cleanup; cleanup = null; dispose(); } }
    function showStatus(key, error = false) {
        const status = document.createElement(error ? 'div' : 'p');
        status.className = 'modal-shell-status'; status.setAttribute('role', error ? 'alert' : 'status');
        const text = document.createElement('span'); text.textContent = t('modalShell.' + key); status.append(text);
        let retry = null;
        if (error) {
            retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button button-secondary button-small';
            retry.textContent = t('modalShell.retry'); retry.addEventListener('click', reload); status.append(document.createElement('br'), retry);
        }
        statusView = {text, key, retry}; body.replaceChildren(status);
    }
    async function reload() {
        if (destroyed || !dialog.open) return;
        disposeContent();
        const current = ++revision;
        controller = new AbortController();
        const signal = controller.signal;
        const tools = {body, context: captured, signal};
        body.replaceChildren(); dialog.setAttribute('aria-busy', 'true');
        if (load) showStatus('loading');
        try {
            const data = load ? await load(captured, {signal}) : captured;
            if (destroyed || signal.aborted || current !== revision) return;
            statusView = null; body.replaceChildren();
            const content = await render(data, tools);
            if (destroyed || signal.aborted || current !== revision) { if (typeof content === 'function') content(); return; }
            if (typeof content === 'function') cleanup = content;
            else if (content instanceof Node || typeof content === 'string') body.append(content);
        } catch (error) {
            if (destroyed || signal.aborted || current !== revision) return;
            showStatus('error', true);
        } finally { if (!destroyed && current === revision) dialog.removeAttribute('aria-busy'); }
    }
    async function close(reason = 'dismiss') {
        if (destroyed || !dialog.open || closing) return false;
        closing = true;
        try {
            if (beforeClose && !await beforeClose({reason, context: captured, dialog})) return false;
            if (destroyed || !dialog.open) return false;
            dialog.close(); return true;
        } catch { return false; } finally { closing = false; }
    }
    function destroy() {
        if (destroyed) return;
        destroyed = true; ++revision; disposeContent(); lifetime.abort(); shell.destroy();
        if (dialog.open) dialog.close();
        dialog.remove();
        notifyClosed();
    }
    closeButton.addEventListener('click', () => close('button'), {signal: lifetime.signal});
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(event.detail?.reason || 'escape'); }, {signal: lifetime.signal});
    function notifyClosed() {
        if (closeNotified) return;
        closeNotified = true;
        ++revision; disposeContent();
        const target = opener?.isConnected && !opener.disabled ? opener : null;
        if (disposeOnClose) destroy();
        // Do not steal focus from the other window the user just activated.
        const activeWindow = document.activeElement?.closest?.('dialog[open]');
        if (!activeWindow && target) target.focus({preventScroll: true});
        onClose?.({context: captured, dialog});
    }
    dialog.addEventListener('close', () => { if (!dialog.open) notifyClosed(); }, {signal: lifetime.signal});
    return {
        dialog, body, header, title: titleNode, description: descriptionNode, context: captured,
        setTitle(value) { titleNode.textContent = value; },
        open() {
            if (destroyed) return false;
            if (dialog.open) { shell.bringToFront(); header.focus({preventScroll: true}); return true; }
            opener = document.activeElement;
            closeNotified = false;
            if (modal) dialog.showModal(); else dialog.show();
            shell.bringToFront();
            if (!modal) {
                const box = dialog.getBoundingClientRect();
                const peers = openEntries().filter(item => item.dialog !== dialog && !isModal(item.dialog)).length;
                const offset = Math.min(peers, 6) * 24;
                const position = constrainWindow({x: box.left + offset, y: box.top + offset}, box, viewport());
                Object.assign(dialog.style, {left: position.x + 'px', top: position.y + 'px', right: 'auto', bottom: 'auto', margin: '0'});
            }
            header.focus({preventScroll: true}); reload(); return true;
        },
        close, destroy, reload, bringToFront: shell.bringToFront,
    };
}
