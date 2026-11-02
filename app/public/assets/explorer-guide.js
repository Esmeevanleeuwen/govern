import {el, button, number} from './ui.js';
import {t, getLocale} from './i18n.js';
import './explorer-guide-messages.js';

const MODE_KEY = 'govern.explorer.mode.v1';
const modes = new Set(['guided', 'detailed']);
let memoryMode = 'guided';
let memoryOverride = false;

/** Presentation aliases only: exact identifiers remain in the source objects. */
export function friendlyName(identifier) {
    const words = String(identifier ?? '').replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
        .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2').replace(/[_\s]+/gu, ' ').trim();
    const [first = '', ...rest] = [...words];
    return first.toLocaleUpperCase(getLocale()) + rest.join('');
}

export function getExplorerMode() {
    if (memoryOverride) return memoryMode;
    try {
        const value = globalThis.localStorage?.getItem(MODE_KEY);
        if (value !== null && value !== undefined) memoryMode = modes.has(value) ? value : 'guided';
        return memoryMode;
    } catch { return memoryMode; }
}

/** Save the presentation choice only, never selections, records or keys. */
export function setExplorerMode(mode) {
    if (!modes.has(mode)) return false;
    memoryMode = mode;
    try {
        if (!globalThis.localStorage) { memoryOverride = true; return false; }
        globalThis.localStorage.setItem(MODE_KEY, mode);
        memoryOverride = false;
        return true;
    } catch { memoryOverride = true; return false; }
}

export function recordLabel(node, table = node?.table || '') {
    const label = typeof node?.label === 'string' ? node.label : '';
    const key = Object.values(node?.key || {}).map(value => value === null ? 'NULL' : String(value)).join(' / ');
    const named = ['name', 'title', 'label', 'full_name', 'code'].some(column =>
        typeof node?.values?.[column] === 'string' && node.values[column].trim() !== '');
    const complete = node?.truncated === false && node.values !== null && typeof node.values === 'object' && !Array.isArray(node.values);
    if (complete && !named && table && label === table + ' · ' + key) return friendlyName(table) + ' · ' + key;
    return label || (key ? friendlyName(table) + ' · ' + key : friendlyName(table));
}

function neighborhood(data) {
    const nodes = new Map((data?.nodes || []).filter(node => typeof node?.id === 'string').map(node => [node.id, node]));
    const relations = new Map((data?.relations || []).map(relation => [relation.id, relation]));
    const connected = new Map();
    if (!nodes.has(data?.center)) return {nodes, connected};
    for (const edge of data?.edges || []) {
        const source = nodes.get(edge.source), target = nodes.get(edge.target), relation = relations.get(edge.relation);
        if (!source || !target || !relation || relation.source_table !== source.table || relation.target_table !== target.table) continue;
        const other = edge.source === data.center ? target : edge.target === data.center ? source : null;
        if (!other || other.id === data.center) continue;
        const item = connected.get(other.id) || {node: other, relationIds: new Set()};
        item.relationIds.add(relation.id); connected.set(other.id, item);
    }
    return {nodes, connected};
}

/** Count distinct loaded neighbors; parallel links never multiply item counts. */
export function connectedGroups(data) {
    const {connected} = neighborhood(data), groups = new Map();
    for (const {node, relationIds} of connected.values()) {
        const group = groups.get(node.table) || {table: node.table, label: friendlyName(node.table), count: 0, ids: new Set()};
        group.count += 1;
        for (const id of relationIds) group.ids.add(id);
        groups.set(node.table, group);
    }
    return [...groups.values()].map(({ids, ...group}) => ({...group, relationIds: [...ids].sort()}))
        .sort((left, right) => left.label.localeCompare(right.label, getLocale()) || left.table.localeCompare(right.table));
}

export function connectionDescription(edge, source, target) {
    if (!edge || !source || !target || edge.source !== source.id || edge.target !== target.id) {
        return t('app.explorerGuide.connectionUnavailable');
    }
    return t('app.explorerGuide.connectionSummary', {source: recordLabel(source), target: recordLabel(target)});
}

/** Questions operate on the current bounded neighborhood through parent callbacks. */
export function renderExplorerGuide(data, {onShowAll = () => {}, onShowGroup = () => {}, onExplain = () => {},
    onFollow = () => {}, selectedId = ''} = {}) {
    const {nodes, connected} = neighborhood(data), center = nodes.get(data?.center), groups = connectedGroups(data);
    const panel = el('section', {id: 'explorer-guide', class: 'explorer-guide', 'data-explorer-guide': '', 'aria-labelledby': 'explorer-guide-title'},
        el('div', {class: 'explorer-guide-heading'}, el('h3', {id: 'explorer-guide-title'}, t('app.explorerGuide.heading')),
            el('ol', {class: 'explorer-guide-steps', 'aria-label': t('app.explorerGuide.introduction')},
                ['stepsCategory', 'stepsItem', 'stepsQuestion'].map((key, index) => el('li', {},
                    el('span', {'aria-hidden': 'true'}, String(index + 1)), t('app.explorerGuide.' + key))))));
    if (!center) { panel.append(el('p', {class: 'small muted'}, t('app.explorerGuide.noItems'))); return panel; }
    panel.append(el('p', {class: 'explorer-guide-summary'}, t('app.explorerGuide.summary', {
        count: number(connected.size), groups: number(groups.length), label: recordLabel(center),
    })));
    const questions = el('div', {class: 'explorer-guide-choices', role: 'group', 'aria-label': t('app.explorerGuide.questions')},
        button(t('app.explorerGuide.showAll'), onShowAll, {id: 'explorer-guide-all', 'data-guide-all': '', symbol: 'network', className: 'explorer-guide-question'}),
        groups.map(group => button(t('app.explorerGuide.showGroup', {category: group.label, count: number(group.count)}),
            () => onShowGroup(group), {'data-guide-group': group.table, className: 'explorer-guide-question'})));
    panel.append(questions);
    if (!connected.size) panel.append(el('p', {class: 'small muted'}, t('app.explorerGuide.noConnections')));
    else {
        const choices = [...connected.values()].map(item => item.node).sort((left, right) =>
            recordLabel(left).localeCompare(recordLabel(right), getLocale()) || left.id.localeCompare(right.id));
        const selected = choices.some(node => node.id === selectedId) ? selectedId : choices[0].id;
        const picker = el('select', {id: 'explorer-guide-item', class: 'input'}, choices.map(node =>
            el('option', {value: node.id, selected: node.id === selected}, recordLabel(node) + ' · ' + friendlyName(node.table))));
        panel.append(el('details', {id: 'explorer-guide-questions', class: 'explorer-guide-more'},
            el('summary', {}, t('app.explorerGuide.explainQuestion')),
            el('div', {class: 'explorer-guide-explain'},
                el('label', {class: 'explorer-guide-field'}, el('span', {}, t('app.explorerGuide.explainChoice')), picker),
                button(t('app.explorerGuide.explain'), () => onExplain(picker.value), {id: 'explorer-guide-explain', symbol: 'info'}),
                button(t('app.explorerGuide.follow'), () => onFollow(picker.value), {id: 'explorer-guide-follow', symbol: 'arrow'}))));
    }
    if (data.partial) panel.append(el('p', {class: 'explorer-guide-limited'}, t('app.explorerGuide.limited')));
    return panel;
}
