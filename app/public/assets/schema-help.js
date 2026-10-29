import {el, icon, button} from './ui.js';
import {t} from './i18n.js';
import './schema-help-messages.js';

/** A local guide: every described action already belongs to the Schema workspace. */
export function createSchemaHelp({state = {}} = {}) {
    let destroyed = false;
    let opener;
    let outsidePress = false;
    const trigger = button(t('app.schemaHelp.open'), () => open(), {
        id: 'schema-help-open', symbol: 'info', className: 'schema-help-trigger',
        'aria-haspopup': 'dialog', 'aria-controls': 'schema-help-dialog',
    });
    const dialog = el('dialog', {id: 'schema-help-dialog', class: 'schema-help-dialog',
        'aria-labelledby': 'schema-help-title', 'aria-describedby': 'schema-help-intro'});
    const title = el('h2', {id: 'schema-help-title', tabindex: '-1'}, t('app.schemaHelp.title'));
    const close = button(t('app.schemaHelp.close'), () => dialog.close(), {
        id: 'schema-help-close', symbol: 'close', className: 'icon-button',
    });
    close.querySelector('span').className = 'sr-only';
    const sections = [
        ['explore', 'table'], ['connections', 'link'], ['navigate', 'expand'],
        ['arrange', 'layout'], ['tools', 'menu'], ['refresh', 'refresh'],
    ];
    const content = el('div', {class: 'schema-help-body', tabindex: '0', role: 'region', 'aria-labelledby': 'schema-help-title'},
        el('p', {id: 'schema-help-intro', class: 'muted'}, t('app.schemaHelp.intro')),
        el('div', {class: 'schema-help-grid'}, sections.map(([key, symbol]) =>
            el('section', {class: 'schema-help-card', 'data-schema-help-section': key},
                icon(symbol), el('h3', {}, t('app.schemaHelp.' + key + 'Title')),
                el('p', {}, t('app.schemaHelp.' + key + 'Body'))))),
        el('section', {class: 'schema-help-keyboard', 'data-schema-help-section': 'keyboard'},
            el('h3', {}, t('app.schemaHelp.keyboardTitle')),
            el('ul', {}, el('li', {}, t('app.schemaHelp.canvasKeys')), el('li', {}, t('app.schemaHelp.tableKeys')))),
        el('p', {class: 'schema-help-limits'}, t('app.schemaHelp.limits')));
    dialog.append(el('header', {class: 'schema-help-header'}, el('div', {}, title), close), content,
        el('footer', {class: 'schema-help-footer'}, button(t('app.schemaHelp.done'), () => dialog.close(), {id: 'schema-help-done', kind: 'primary'})));
    document.body.append(dialog);

    function open(restoring = false) {
        if (destroyed || dialog.open) return;
        opener = !restoring && document.activeElement?.isConnected && document.activeElement !== document.body
            ? document.activeElement : trigger;
        state.helpOpen = true;
        dialog.showModal();
        title.focus({preventScroll: true});
        content.scrollTop = Number.isFinite(state.helpScroll) ? state.helpScroll : 0;
    }
    content.addEventListener('scroll', () => { state.helpScroll = content.scrollTop; }, {passive: true});
    dialog.addEventListener('close', () => {
        if (destroyed) return;
        state.helpOpen = false;
        const target = opener?.isConnected && !opener.disabled ? opener : trigger;
        if (target.isConnected) target.focus({preventScroll: true});
    });
    dialog.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const controls = [...dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
            .filter(node => node.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1), active = document.activeElement;
        if (!first) { event.preventDefault(); title.focus({preventScroll: true}); return; }
        if (!controls.includes(active) || (event.shiftKey ? active === first : active === last)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus({preventScroll: true});
        }
    });
    const outside = event => {
        const box = dialog.getBoundingClientRect();
        return event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
    };
    dialog.addEventListener('pointerdown', event => { outsidePress = outside(event); });
    dialog.addEventListener('click', event => {
        if (outsidePress && outside(event)) dialog.close();
        outsidePress = false;
    });
    if (state.helpOpen) open(true);

    return {button: trigger, destroy() {
        destroyed = true;
        state.helpScroll = content.scrollTop;
        // A language remount keeps the guide open; leaving Schema disposes it.
        state.helpOpen = dialog.open && window.location.hash.slice(1).split('?')[0] === 'schema';
        if (dialog.open) dialog.close();
        dialog.remove();
    }};
}
