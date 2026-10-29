import {el, icon, button} from './ui.js';
import {t} from './i18n.js';
import {describeSelection, selectionAncestors, registeredSelections} from './selection-registry.js';
import {explainSelection} from './selection-content.js';
import './selection-messages.js';

const kindKeys = {table: 'kindTable', column: 'kindColumn', row: 'kindRow', cell: 'kindCell',
    relationship: 'kindRelationship', control: 'kindControl', element: 'kindElement', workspace: 'kindWorkspace'};
const kindName = item => t('app.selection.' + (kindKeys[item.meta.kind] || 'kindElement'));

/** Read-only inspection is independent of navigation, SQL and schema selection. */
export class SelectionPointer {
    constructor({root, controls, getContext = () => ({}), onAction = () => {}}) {
        this.root = root;
        this.getContext = getContext;
        this.onAction = onAction;
        this.selected = new Map();
        this.on = false;
        this.hovered = null;
        this.tagged = null;
        this.keyboardTarget = false;
        this.modalItems = [];
        this.events = new AbortController();
        this.toggle = button('', () => this.setOn(!this.on), {id: 'selection-pointer-toggle', symbol: 'pointer',
            'aria-pressed': 'false', 'aria-describedby': 'selection-pointer-hint selection-pointer-keyboard', className: 'button-small'});
        this.count = button('', () => this.review(), {id: 'selection-pointer-count', className: 'button-small', hidden: true});
        this.clear = button('', () => { this.selected.clear(); this.update(); this.toggle.focus({preventScroll: true}); },
            {id: 'selection-pointer-clear', symbol: 'close', className: 'icon-button', hidden: true});
        this.clear.querySelector('span').className = 'sr-only';
        this.controlGroup = el('div', {class: 'selection-pointer-controls', 'data-selection-ui': ''}, this.toggle, this.count, this.clear);
        controls.prepend(this.controlGroup);
        this.hint = el('p', {id: 'selection-pointer-hint', class: 'selection-pointer-hint', 'data-selection-ui': '', hidden: true});
        this.keyboardHint = el('span', {id: 'selection-pointer-keyboard', class: 'sr-only'});
        this.controlGroup.append(this.keyboardHint);
        root.querySelector('.topbar').after(this.hint);
        this.overlay = el('div', {class: 'selection-pointer-overlay', 'data-selection-ui': '', 'aria-hidden': 'true'});
        this.tagName = el('strong', {id: 'selection-pointer-name'});
        this.tagType = el('code', {id: 'selection-pointer-type'});
        this.more = button('', () => this.openMore(), {id: 'selection-pointer-more', symbol: 'more',
            'aria-haspopup': 'dialog', 'aria-controls': 'selection-pointer-dialog', className: 'button-small'});
        this.path = el('nav', {id: 'selection-pointer-path', class: 'selection-pointer-path'});
        this.tag = el('section', {id: 'selection-pointer-tag', class: 'selection-pointer-tag', 'data-selection-ui': '',
            role: 'group', hidden: true}, el('div', {class: 'selection-pointer-tag-top'},
            el('div', {class: 'selection-pointer-tag-name'}, this.tagName, this.tagType), this.more), this.path);
        this.live = el('div', {class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-selection-ui': ''});
        this.createDialog();
        document.body.append(this.overlay, this.tag, this.live);
        const listen = (node, name, handler, options = {}) => node.addEventListener(name, handler, {...options, signal: this.events.signal});
        listen(root, 'pointermove', event => {
            if (!this.on) { if (this.selected.size) this.draw(); return; }
            if (this.dialog.open) return;
            this.keyboardTarget = false;
            if (this.isUI(event.target)) { this.hover(null); return; }
            this.hover(describeSelection(event.target, root));
        });
        listen(root, 'pointerleave', event => {
            if (!this.on || event.relatedTarget?.closest?.('#selection-pointer-tag')) return;
            clearTimeout(this.dwell);
            this.hovered = null;
            this.delayHide();
        });
        listen(this.tag, 'pointerenter', () => { clearTimeout(this.hideTimer); clearTimeout(this.dwell); this.hovered = this.tagged; this.draw(); });
        listen(this.tag, 'pointerleave', () => this.delayHide());
        for (const name of ['pointerdown', 'mousedown', 'dragstart', 'dblclick', 'beforeinput']) {
            listen(root, name, event => {
                if (!this.shouldInspect(event)) return;
                event.preventDefault(); event.stopImmediatePropagation();
            }, {capture: true});
        }
        listen(root, 'click', event => {
            if (!this.shouldInspect(event)) return;
            event.preventDefault(); event.stopImmediatePropagation();
            if (event.target.closest(':disabled')) return;
            const target = describeSelection(event.target, root);
            if (!target) return;
            this.choose(target, event.shiftKey);
            if (event.pointerType === 'touch') this.showTag(target);
        }, {capture: true});
        listen(root, 'pointerup', event => {
            if (!this.shouldInspect(event) || !event.target.closest(':disabled')) return;
            event.preventDefault(); event.stopImmediatePropagation();
            const target = describeSelection(event.target, root);
            if (target) { this.choose(target, event.shiftKey); if (event.pointerType === 'touch') this.showTag(target); }
        }, {capture: true});
        listen(root, 'keydown', event => this.keydown(event), {capture: true});
        // The popover lives outside the shell. Escape must also work there,
        // including the brief native focus return while a dialog is closing.
        listen(document, 'keydown', event => {
            if (event.key !== 'Escape' || !this.on || document.querySelector('dialog[open]')) return;
            event.preventDefault(); event.stopImmediatePropagation();
            this.setOn(false); this.toggle.focus({preventScroll: true});
        }, {capture: true});
        listen(root, 'focusin', event => {
            if (this.on && !this.isUI(event.target)) {
                this.keyboardTarget = false;
                const target = describeSelection(event.target, root);
                if (target) this.showTag(target);
            }
        });
        listen(window, 'scroll', () => { this.draw(); this.positionTag(); }, {capture: true, passive: true});
        listen(window, 'resize', () => { this.draw(); this.positionTag(); }, {passive: true});
        listen(root, 'wheel', () => requestAnimationFrame(() => { this.draw(); this.positionTag(); }), {passive: true});
        listen(window, 'govern:languagechange', () => {
            // The app remounts translated controls in its own listener.
            queueMicrotask(() => {
                this.reconcile(); this.updateLabels();
                if (this.tagged && !this.tag.hidden) this.showTag(this.tagged);
                if (this.dialog.open) {
                    const available = new Map(registeredSelections(this.root).map(item => [item.meta.key, item]));
                    this.modalItems = this.modalItems.map(item => this.selected.get(item.meta.key) ||
                        (item.meta.kind === 'control' ? available.get(item.meta.key) : null) || item);
                    this.renderDialog();
                }
            });
        });
        this.observer = new MutationObserver(() => {
            if (this.reconcileFrame) return;
            this.reconcileFrame = requestAnimationFrame(() => { this.reconcileFrame = null; this.reconcile(); });
        });
        this.observer.observe(root, {subtree: true, childList: true});
        this.resizeObserver = new ResizeObserver(() => { this.draw(); this.positionTag(); });
        this.resizeObserver.observe(root);
        this.update();
    }

    isUI(node) { return node instanceof Element && !!node.closest('[data-selection-ui]'); }
    shouldInspect(event) { return this.on && !this.dialog.open && !this.isUI(event.target); }
    label(item) { return item.meta.label || item.meta.column || item.meta.table || item.tag; }

    setOn(value) {
        this.on = value;
        this.root.classList.toggle('selection-pointer-active', value);
        this.hideTag();
        this.keyboardTarget = false;
        this.update();
    }

    updateLabels() {
        this.toggle.querySelector('span').textContent = t('app.selection.' + (this.on ? 'on' : 'toggle'));
        this.toggle.setAttribute('aria-label', this.toggle.textContent);
        this.count.querySelector('span').textContent = t('app.selection.count', {count: this.selected.size});
        this.count.setAttribute('aria-label', this.count.textContent);
        this.clear.setAttribute('aria-label', t('app.selection.clear'));
        this.clear.querySelector('span').textContent = t('app.selection.clear');
        this.hint.textContent = t('app.selection.hint');
        this.keyboardHint.textContent = t('app.selection.keyboardHint');
        this.tag.setAttribute('aria-label', t('app.selection.tagLabel'));
        this.path.setAttribute('aria-label', t('app.selection.pathLabel'));
        this.close.setAttribute('aria-label', t('app.selection.close'));
        this.back.querySelector('span').textContent = t('app.selection.back');
        this.back.setAttribute('aria-label', t('app.selection.back'));
    }

    update() {
        this.toggle.setAttribute('aria-pressed', String(this.on));
        this.toggle.classList.toggle('button-primary', this.on);
        this.count.hidden = this.clear.hidden = this.selected.size === 0;
        this.hint.hidden = !this.on;
        this.updateLabels();
        if (this.tagged && !this.tag.hidden) this.updateTagLabel();
        this.draw();
    }

    choose(item, multiple = false) {
        if (!multiple) this.selected.clear();
        if (multiple && this.selected.has(item.meta.key)) this.selected.delete(item.meta.key);
        else this.selected.set(item.meta.key, {...item, meta: structuredClone(item.meta)});
        this.update();
        this.live.textContent = t('app.selection.liveSelected', {count: this.selected.size});
    }

    hover(item) {
        if (this.hovered?.node === item?.node) return;
        clearTimeout(this.dwell);
        this.hovered = item;
        this.draw();
        if (!this.tag.hidden) this.delayHide(300);
        if (item) this.dwell = setTimeout(() => {
            if (this.on && this.hovered?.node === item.node && item.node.isConnected) this.showTag(item);
        }, 3100);
    }

    delayHide(delay = 400) {
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => {
            this.tag.hidden = true;
            this.tagged = null;
            this.draw();
        }, delay);
    }

    hideTag() {
        clearTimeout(this.dwell); clearTimeout(this.hideTimer);
        this.tag.hidden = true;
        this.tagged = this.hovered = null;
        this.draw();
    }

    updateTagLabel() {
        const count = this.selected.has(this.tagged.meta.key) ? this.selected.size : 1;
        this.more.querySelector('span').textContent = count > 1 ? t('app.selection.moreCount', {count}) : t('app.selection.more');
        this.more.setAttribute('aria-label', this.more.textContent);
    }

    showTag(item) {
        if (!item?.node?.isConnected) return;
        clearTimeout(this.dwell); clearTimeout(this.hideTimer);
        this.tagged = this.hovered = item;
        this.tagName.textContent = this.label(item);
        this.tagType.textContent = kindName(item) + ' · <' + item.tag + '>';
        this.updateTagLabel();
        const parents = selectionAncestors(item, this.root);
        this.path.replaceChildren(...(parents.length > 1 ? parents.map(parent =>
            button(kindName(parent), event => { this.choose(parent, event.shiftKey); this.showTag(parent); },
                {'data-selection-parent': parent.meta.key, 'aria-pressed': String(parent.meta.key === item.meta.key), kind: 'ghost', className: 'button-small'})) : []));
        this.tag.hidden = false;
        this.positionTag();
        this.draw();
    }

    positionTag() {
        if (this.tag.hidden || !this.tagged?.node.isConnected) return;
        const box = this.tagged.node.getBoundingClientRect();
        const width = document.documentElement.clientWidth, height = window.innerHeight;
        this.tag.style.maxWidth = Math.max(0, width - 24) + 'px';
        const own = this.tag.getBoundingClientRect();
        let top = box.bottom + 8;
        if (top + own.height > height - 12) top = box.top - own.height - 8;
        this.tag.style.left = Math.max(12, Math.min(box.left, width - own.width - 12)) + 'px';
        this.tag.style.top = Math.max(12, Math.min(top, height - own.height - 12)) + 'px';
    }

    draw() {
        const boxes = [];
        const add = (item, index, hover = false) => {
            if (!item?.node?.isConnected || !item.node.getClientRects().length || item.node.closest('[hidden],[inert]')) return;
            let box = item.node.getBoundingClientRect();
            let left = box.left, right = box.right, top = box.top, bottom = box.bottom;
            // A scrolled cell or schema node must not paint over the surrounding chrome.
            for (let parent = item.node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
                const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
                if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
                if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
            }
            left = Math.max(0, left); top = Math.max(0, top);
            right = Math.min(document.documentElement.clientWidth, right); bottom = Math.min(innerHeight, bottom);
            if (right <= left || bottom <= top) return;
            const mark = el('div', {class: 'selection-pointer-box' + (hover ? ' is-hovered' : ' is-selected'),
                style: `left:${left}px;top:${top}px;width:${right-left}px;height:${bottom-top}px`}, index ? el('span', {}, String(index)) : null);
            boxes.push(mark);
        };
        if (!this.dialog?.open) {
            [...this.selected.values()].forEach((item, index) => add(item, index + 1));
            if (this.on) add(this.hovered, 0, true);
        }
        this.overlay?.replaceChildren(...boxes);
    }

    review() {
        const visible = [...this.selected.values()].findLast(item => item.node.isConnected && item.node.getClientRects().length && !item.node.closest('[hidden],[inert]'));
        if (visible && this.on) this.showTag(visible);
        else if (this.selected.size) this.openMore([...this.selected.values()]);
    }

    reconcile() {
        if (!this.selected.size && !this.tagged) return;
        const available = new Map(registeredSelections(this.root).map(item => [item.meta.key, item]));
        for (const [key, item] of this.selected) {
            const replacement = item.node.isConnected ? describeSelection(item.node, this.root) : available.get(key);
            if (replacement && JSON.stringify(item.meta.record) === JSON.stringify(replacement.meta.record) &&
                JSON.stringify(item.meta.value) === JSON.stringify(replacement.meta.value)) this.selected.set(key, replacement);
        }
        if (this.tagged && !this.tagged.node.isConnected) this.hideTag();
        this.draw();
    }

    keydown(event) {
        if (!this.on || this.dialog.open) return;
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopImmediatePropagation();
            this.setOn(false); this.toggle.focus({preventScroll: true}); return;
        }
        const ownControl = this.isUI(event.target);
        if (ownControl && !this.controlGroup.contains(event.target)) return;
        if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) {
            event.preventDefault(); event.stopImmediatePropagation();
            const nodes = [...this.root.querySelectorAll('[data-selection-kind],h1,h2,h3,p,button,a,input,select,textarea,summary,td,th')];
            const seen = new Set(), targets = nodes.map(node => describeSelection(node, this.root))
                .filter(item => item && item.node.getClientRects().length && !seen.has(item.node) && seen.add(item.node));
            const step = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
            const at = targets.findIndex(item => item.node === this.hovered?.node);
            const next = targets[(at + step + targets.length) % targets.length];
            if (next) { this.keyboardTarget = true; next.node.scrollIntoView({block: 'nearest', inline: 'nearest'}); this.showTag(next); }
            return;
        }
        if (['Enter', ' '].includes(event.key) && ((this.keyboardTarget && event.target === this.toggle) || !ownControl)) {
            event.preventDefault(); event.stopImmediatePropagation();
            const item = this.keyboardTarget ? this.hovered : describeSelection(event.target, this.root);
            if (item) { this.choose(item, event.shiftKey); this.showTag(item); }
            return;
        }
        // Focused inputs and drag handles remain inspectable without accepting edits.
        if (!ownControl && event.key !== 'Tab' && !(event.ctrlKey || event.metaKey)) {
            event.preventDefault(); event.stopImmediatePropagation();
        }
    }

    createDialog() {
        this.title = el('h2', {id: 'selection-pointer-dialog-title', tabindex: '-1'});
        this.scope = el('p', {class: 'small muted'});
        this.close = button('', () => this.dialog.close(), {symbol: 'close', className: 'icon-button'});
        this.close.querySelector('span').className = 'sr-only';
        this.body = el('div', {class: 'selection-pointer-dialog-body', tabindex: '0', role: 'region', 'aria-labelledby': 'selection-pointer-dialog-title'});
        this.back = button('', () => this.dialog.close(), {kind: 'primary'});
        this.dialog = el('dialog', {id: 'selection-pointer-dialog', class: 'selection-pointer-dialog', 'data-selection-ui': '', 'aria-labelledby': 'selection-pointer-dialog-title'},
            el('header', {class: 'selection-pointer-dialog-head'}, el('div', {}, this.title, this.scope), this.close), this.body,
            el('footer', {class: 'selection-pointer-dialog-foot'}, this.back));
        document.body.append(this.dialog);
        this.dialog.addEventListener('close', () => {
            this.hideTag();
            const fallback = this.selected.size ? this.count : this.toggle;
            const target = this.returnFocus?.isConnected && !this.tag.contains(this.returnFocus) &&
                this.returnFocus.getClientRects().length ? this.returnFocus : fallback;
            target.focus({preventScroll: true});
        });
        this.dialog.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); return; }
            if (event.key !== 'Tab') return;
            const controls = [...this.dialog.querySelectorAll('button:not([disabled]),[tabindex="0"]')].filter(node => node.getClientRects().length);
            const first = controls[0], last = controls.at(-1);
            if (!controls.includes(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
                event.preventDefault(); (event.shiftKey ? last : first)?.focus({preventScroll: true});
            }
        });
        let outside = false;
        const isOutside = event => { const b = this.dialog.getBoundingClientRect(); return event.target === this.dialog && (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom); };
        this.dialog.addEventListener('pointerdown', event => { outside = isOutside(event); });
        this.dialog.addEventListener('click', event => { if (outside && isOutside(event)) this.dialog.close(); outside = false; });
    }

    openMore(items) {
        if (this.dialog.open) return;
        this.modalItems = items || (this.selected.has(this.tagged?.meta.key) ? [...this.selected.values()] : this.tagged ? [this.tagged] : []);
        if (!this.modalItems.length) return;
        this.returnFocus = document.activeElement;
        clearTimeout(this.dwell); clearTimeout(this.hideTimer);
        this.renderDialog();
        this.dialog.showModal();
        this.title.focus({preventScroll: true});
        this.draw();
    }

    renderDialog() {
        const content = explainSelection(this.modalItems.map(item => ({...item, connected: item.node.isConnected})), this.getContext());
        const scroll = this.body.scrollTop;
        this.title.textContent = content.title;
        this.scope.textContent = content.summary;
        this.body.replaceChildren(
            el('section', {}, el('h3', {}, t('app.selection.what')), content.entries.map(entry =>
                el('article', {class: 'selection-pointer-entry'}, el('strong', {}, entry.title),
                    el('code', {}, entry.kind + ' · <' + entry.tag + '>'), el('p', {}, entry.description),
                    entry.details?.length ? el('dl', {}, entry.details.map(detail => [el('dt', {}, detail.label), el('dd', {}, detail.value)])) : null))),
            el('section', {}, el('h3', {}, t('app.selection.meaning')), el('p', {}, content.relationship)),
            el('section', {}, el('h3', {}, t('app.selection.actions')), el('ul', {}, content.possibilities.map(text => el('li', {}, text))),
                el('div', {class: 'selection-pointer-actions'}, content.actions.map(action => button(action.label, () => {
                    this.returnFocus = this.toggle;
                    this.dialog.close(); this.setOn(false); this.onAction(action, this.modalItems);
                }, {'data-selection-action': action.type, className: 'button-small'})))));
        this.body.scrollTop = scroll;
    }

    destroy() {
        this.events.abort(); this.observer.disconnect(); this.resizeObserver.disconnect();
        clearTimeout(this.dwell); clearTimeout(this.hideTimer); cancelAnimationFrame(this.reconcileFrame);
        this.root.classList.remove('selection-pointer-active');
        if (this.dialog.open) this.dialog.close();
        for (const node of [this.controlGroup, this.hint, this.overlay, this.tag, this.dialog, this.live]) node.remove();
    }
}
