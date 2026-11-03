import {request} from './api.js';
import {parseConnectionScope} from './connection-scope.js';
import {el, button, badge, notice} from './ui.js';
import {t} from './i18n.js';
import {createModal} from './modal-shell.js';
import {friendlyName, recordLabel} from './explorer-guide.js';
import {valueText} from './record-explorer-model.js';
import './explorer-messages.js';
import './record-window-messages.js';

const text = (key, params) => t('app.recordWindow.' + key, params);
const sameKey = (left, right) => left && right && !Array.isArray(left) && !Array.isArray(right)
    && Object.keys(left).length === Object.keys(right).length
    && Object.keys(right).every(name => Object.hasOwn(left, name) && left[name] === right[name]);

/** Record content owns its exact source; modal-shell owns only window behaviour. */
export function openRecordWindow({database, table, key, guided = true}) {
    // Take a copy before any asynchronous work or subsequent explorer selection.
    const context = structuredClone({database, table, key, guided});
    let result = null, technicalOpen = false;
    const category = name => context.guided ? friendlyName(name) : name;
    const label = node => context.guided ? recordLabel(node, node.table) : node.label;
    const values = (fields, friendly = false) => el('dl', {class: 'record-explorer-values'},
        Object.entries(fields || {}).map(([name, value]) => el('div', {},
            el('dt', {}, friendly ? friendlyName(name) : name),
            el('dd', {class: value === null ? 'null-value' : ''}, valueText(value)))));

    function scopeLabel() {
        const scope = parseConnectionScope(context.database);
        return scope.connection === 'postgres'
            ? text('postgresScope', scope) : text('scope', scope);
    }

    function renderRecord(data) {
        const node = data.nodes.find(item => item.id === data.center);
        const source = el('section', {class: 'record-window-content'},
            el('p', {class: 'record-window-scope'}, scopeLabel()),
            el('div', {class: 'record-window-context'}, el('span', {}, category(node.table)), badge(text('readOnly'), 'badge-blue')),
            el('h3', {}, label(node)), el('p', {class: 'small muted'}, text('snapshot')),
            button(text('refresh'), () => modal.reload(), {symbol: 'refresh', className: 'button-small'}));
        if (context.guided) {
            const identifiers = new Set(Object.keys(node.key).filter(name => /(^id$|_id$|^uuid$)/i.test(name)));
            for (const edge of data.edges) {
                if (edge.source === node.id) edge.columns.forEach(name => identifiers.add(name));
                if (edge.target === node.id) edge.referenced_columns.forEach(name => identifiers.add(name));
            }
            const friendlyValues = Object.fromEntries(Object.entries(node.values).filter(([name]) => !identifiers.has(name)));
            if (Object.keys(friendlyValues).length) source.append(el('h4', {}, t('app.explorerGuide.itemValues')), values(friendlyValues, true));
            const details = el('details', {class: 'record-explorer-technical', 'data-record-window-technical': '', ...(technicalOpen ? {open: true} : {})},
                el('summary', {}, t('app.explorerGuide.technicalDetails')),
                el('p', {}, t('app.explorerGuide.originalName')), el('code', {}, node.table),
                el('h4', {}, t('app.explorer.key')), values(node.key),
                el('h4', {}, t('app.explorer.fields')), values(node.values));
            details.addEventListener('toggle', () => { if (details.isConnected) technicalOpen = details.open; });
            source.append(details);
        } else source.append(el('h4', {}, t('app.explorer.key')), values(node.key),
            el('h4', {}, t('app.explorer.fields')), values(node.values));
        if (node.truncated) source.append(notice(t('app.explorer.preview')));

        const linkedIds = new Set(data.edges.flatMap(edge => edge.source === node.id ? [edge.target] : edge.target === node.id ? [edge.source] : []));
        linkedIds.delete(node.id);
        const linked = data.nodes.filter(item => linkedIds.has(item.id));
        source.append(el('h4', {}, text('links')), el('p', {class: 'small muted'}, text('linksHelp')));
        source.append(linked.length ? el('div', {class: 'record-explorer-record-links'}, linked.map(item =>
            button(label(item), () => openRecordWindow({database: context.database, table: item.table, key: item.key, guided: context.guided}),
                {symbol: 'external', className: 'record-explorer-record-link', 'data-record-window-link': item.id,
                    'aria-label': text('openRecord', {label: label(item)})}))) : el('p', {class: 'small muted'}, text('noLinks')));
        return source;
    }

    const modal = createModal({
        title: text('title'), context, className: 'record-window',
        load: async (captured, {signal}) => {
            const data = await request('explore', {params: {database: captured.database, table: captured.table, key: JSON.stringify(captured.key)}, signal});
            const node = data.nodes?.find(item => item.id === data.center);
            if (data.scope_key !== captured.database || data.table !== captured.table || node?.table !== captured.table || !sameKey(node.key, captured.key)) {
                throw new Error(text('wrongRecord'));
            }
            return data;
        },
        render: (data, {signal}) => {
            result = data;
            modal.title.textContent = label(data.nodes.find(item => item.id === result.center));
            // Loading, closing and disposing the shell each abort this owner.
            window.addEventListener('govern:languagechange', translate, {signal});
            return renderRecord(data);
        },
    });
    modal.dialog.dataset.recordWindow = '';
    modal.dialog.dataset.recordScope = context.database;
    modal.dialog.dataset.recordTable = context.table;
    modal.dialog.dataset.recordKey = JSON.stringify(context.key);
    function translate() {
        if (!result || !modal.dialog.open) { modal.title.textContent = text('title'); return; }
        const scroll = modal.body.scrollTop;
        const details = modal.body.querySelector('[data-record-window-technical]');
        if (details) technicalOpen = details.open;
        modal.title.textContent = label(result.nodes.find(item => item.id === result.center));
        modal.body.replaceChildren(renderRecord(result));
        modal.body.scrollTop = scroll;
    }
    modal.open();
    return modal;
}
