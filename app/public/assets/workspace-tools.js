import {t} from './i18n.js';
import {icon} from './ui.js';
import './workspace-tools-messages.js';

const instances = new WeakMap();
const text = (key, params) => t('app.workspaceTools.' + key, params);

/** Keep the real controls and their state; only their presentation moves. */
export function createWorkspaceTools() {
    const trigger = document.getElementById('workspace-tools-toggle');
    const panel = document.getElementById('workspace-tools');
    if (!trigger || !panel) return null;
    if (instances.has(panel)) return instances.get(panel);
    const lifetime = new AbortController(), signal = lifetime.signal;
    const native = typeof panel.showPopover === 'function' && typeof panel.hidePopover === 'function';
    const moved = [], restoredClasses = [];
    let fallbackOpen = false, destroyed = false, frame = null, triggerPressWasOpen = null;
    const isOpen = () => native ? panel.matches(':popover-open') : fallbackOpen;
    trigger.setAttribute('data-selection-ui', ''); panel.setAttribute('data-selection-ui', '');
    trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-controls', panel.id);
    if (native) trigger.setAttribute('popovertarget', panel.id);
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false');
    if (!trigger.querySelector('.icon')) trigger.prepend(icon('settings'));
    const triggerLabel = trigger.querySelector('span');
    if (triggerLabel) triggerLabel.dataset.workspaceToolsText = 'trigger';
    const dismiss = panel.querySelector('#workspace-tools-close');
    if (dismiss) {
        dismiss.removeAttribute('data-workspace-tools-text');
        const label = document.createElement('span'); label.className = 'sr-only'; label.dataset.workspaceToolsText = 'close';
        dismiss.replaceChildren(icon('close'), label);
        dismiss.addEventListener('click', () => close(), {signal});
    }
    if (!native) { panel.removeAttribute('popover'); panel.hidden = true; }

    function move(selector, slot, className) {
        const control = document.querySelector(selector), destination = document.getElementById(slot);
        if (!control || !destination) return;
        const marker = document.createComment('workspace tool');
        control.before(marker); moved.push({control, marker});
        if (className) { control.classList.add(className); restoredClasses.push([control, className]); }
        destination.append(control);
    }
    move('.selection-pointer-controls', 'workspace-tools-explore');
    for (const selector of ['#open-companion', '#ai-toggle']) move(selector, 'workspace-tools-explore', 'workspace-tools-control');
    for (const selector of ['#open-database', '#context-export']) move(selector, 'workspace-tools-data', 'workspace-tools-control');
    move('.language-picker', 'workspace-tools-preferences', 'workspace-tools-language');
    move('#workspace-account', 'workspace-tools-preferences', 'workspace-tools-control');
    const language = panel.querySelector('.workspace-tools-language');
    if (language && !language.querySelector('[data-workspace-tools-text="language"]')) {
        const label = document.createElement('span'); label.dataset.workspaceToolsText = 'language';
        language.prepend(label);
    }
    for (const [id, key] of [['context-export', 'app.shell.export']]) {
        const control = document.getElementById(id);
        if (!control) continue;
        let label = control.querySelector('span');
        if (!label) { label = document.createElement('span'); label.dataset.i18n = key; control.append(label); }
        label.classList.remove('sr-only');
        if (label.dataset.i18n) label.textContent = t(label.dataset.i18n);
    }

    function expanded() {
        const opened = isOpen();
        trigger.setAttribute('aria-expanded', String(opened)); panel.dataset.open = String(opened);
    }
    function position() {
        if (destroyed || !isOpen()) return;
        const width = Math.min(document.documentElement.clientWidth, window.visualViewport?.width || Infinity);
        const height = window.visualViewport?.height || window.innerHeight;
        const anchor = trigger.getBoundingClientRect();
        if (anchor.bottom < 0 || anchor.top > height) { close({restoreFocus: false}); return; }
        const top = Math.max(8, Math.min(anchor.bottom + 8, height - 100));
        panel.style.maxHeight = Math.max(72, height - top - 12) + 'px';
        const box = panel.getBoundingClientRect();
        const left = Math.max(12, Math.min(anchor.right - box.width, width - box.width - 12));
        Object.assign(panel.style, {left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto'});
    }
    function schedulePosition(event) {
        if (!isOpen() || event?.target === panel || frame !== null) return;
        frame = requestAnimationFrame(() => { frame = null; position(); });
    }
    function open() {
        if (destroyed || isOpen()) return;
        if (native) panel.showPopover({source: trigger}); else { fallbackOpen = true; panel.hidden = false; }
        expanded(); position();
        const control = [...panel.querySelectorAll('button:not([disabled]), a[href], select:not([disabled]), input:not([disabled]), [tabindex="0"]')]
            .find(node => node.getClientRects().length && node.getAttribute('aria-disabled') !== 'true' && node.id !== 'workspace-tools-close');
        (control || panel.querySelector('#workspace-tools-close') || panel).focus({preventScroll: true});
    }
    function close({restoreFocus = true} = {}) {
        if (!isOpen()) { expanded(); return; }
        if (native) panel.hidePopover(); else { fallbackOpen = false; panel.hidden = true; }
        expanded();
        if (restoreFocus && trigger.isConnected && !trigger.disabled) trigger.focus({preventScroll: true});
    }
    trigger.addEventListener('pointerdown', () => { triggerPressWasOpen = isOpen(); }, {signal});
    trigger.addEventListener('pointercancel', () => { triggerPressWasOpen = null; }, {signal});
    trigger.addEventListener('click', event => {
        event.preventDefault();
        const wasOpen = event.detail > 0 && triggerPressWasOpen !== null ? triggerPressWasOpen : isOpen();
        triggerPressWasOpen = null;
        if (wasOpen) close(); else open();
    }, {signal});
    panel.addEventListener('click', event => {
        const control = event.target.closest('button, a[href]');
        if (!control || !panel.contains(control) || control.disabled || control.getAttribute('aria-disabled') === 'true') return;
        // Native dialog owners capture this visible opener before their click runs.
        close();
    }, {capture: true, signal});
    panel.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault(); event.stopPropagation(); close();
    }, {signal});
    panel.addEventListener('toggle', () => {
        expanded(); if (isOpen()) position();
        else if (panel.contains(document.activeElement)) trigger.focus({preventScroll: true});
    }, {signal});
    document.addEventListener('focusin', event => {
        if (isOpen() && !panel.contains(event.target) && event.target !== trigger) close({restoreFocus: false});
    }, {capture: true, signal});
    document.addEventListener('pointerdown', event => {
        if (!native && isOpen() && !panel.contains(event.target) && !trigger.contains(event.target)) close({restoreFocus: false});
    }, {capture: true, signal});
    window.addEventListener('resize', schedulePosition, {signal});
    window.addEventListener('scroll', schedulePosition, {capture: true, passive: true, signal});
    window.visualViewport?.addEventListener('resize', schedulePosition, {signal});

    const connection = document.getElementById('connection-state');
    const database = document.getElementById('database-select');
    function describeState() {
        const active = [];
        for (const [selector, attribute, value] of [['#selection-pointer-toggle', 'aria-pressed', 'true'],
            ['#ai-toggle', 'aria-expanded', 'true'], ['#open-companion', 'data-companion-status', 'connected']]) {
            const control = panel.querySelector(selector);
            if (control?.getAttribute(attribute) === value) active.push(control.getAttribute('aria-label') || control.textContent.trim());
        }
        trigger.dataset.active = String(Boolean(active.length));
        trigger.setAttribute('aria-description', active.length ? text('active', {tools: active.join(', ')}) : text('description'));
        if (connection) {
            const status = connection.textContent.trim(); connection.title = status; connection.setAttribute('aria-label', status);
        }
        if (database) database.title = database.selectedOptions[0]?.textContent || '';
    }
    function translate() {
        document.querySelectorAll('[data-workspace-tools-text]').forEach(node => { node.textContent = text(node.dataset.workspaceToolsText); });
        trigger.setAttribute('aria-label', text('trigger')); trigger.title = text('title');
        panel.setAttribute('aria-label', text('title'));
        if (dismiss) { dismiss.setAttribute('aria-label', text('close')); dismiss.title = text('close'); }
        describeState(); schedulePosition();
    }
    const observer = new MutationObserver(describeState);
    observer.observe(panel, {subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['aria-pressed', 'aria-expanded', 'data-companion-status', 'disabled', 'hidden']});
    if (connection) observer.observe(connection, {childList: true, characterData: true, subtree: true});
    if (database) { observer.observe(database, {childList: true, subtree: true}); database.addEventListener('change', describeState, {signal}); }
    window.addEventListener('govern:languagechange', translate, {signal});
    document.body.classList.add('workspace-tools-ready'); trigger.disabled = false; expanded(); translate();
    const instance = {open, close, destroy() {
        if (destroyed) return;
        close(); destroyed = true; observer.disconnect(); lifetime.abort();
        if (frame !== null) cancelAnimationFrame(frame);
        for (const {control, marker} of moved) { marker.before(control); marker.remove(); }
        for (const [control, name] of restoredClasses) control.classList.remove(name);
        document.body.classList.remove('workspace-tools-ready'); instances.delete(panel);
    }};
    instances.set(panel, instance); return instance;
}
