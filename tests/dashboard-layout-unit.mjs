import assert from 'node:assert/strict';
import {createDashboardLayout, DASHBOARD_STORAGE_KEY} from '../app/public/assets/dashboard-layout.js';

const registry = [
    {id: 'overview.tables', titleKey: 'overview.tables.title', defaultSize: 'wide', render: () => 'table'},
    {id: 'overview.research', titleKey: 'overview.research.title', defaultSize: 'small'},
    {id: 'overview.learning', titleKey: 'overview.learning.title', defaultSize: 'small'},
    {id: 'overview.restore', titleKey: 'overview.restore.title', defaultSize: 'wide'},
];
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
function storageWith(value, fail = false) {
    const values = new Map([['preferences', 'keep']]);
    if (value !== undefined) values.set(DASHBOARD_STORAGE_KEY, JSON.stringify(value));
    return {values, getItem(key) { return values.get(key) || null; }, setItem(key, next) { if (fail) throw new Error('Quota exceeded'); values.set(key, next); }};
}

{
    const storage = storageWith(), model = createDashboardLayout(registry, {storage});
    check(model.getBlocks().length === 4 && !storage.values.has(DASHBOARD_STORAGE_KEY), 'Defaults need no automatic write');
    check(!model.setHidden('overview.tables', true), 'Mutations require explicit edit mode');
    model.begin(); model.move('overview.tables', 1); model.setSize('overview.research', 'full'); model.setHidden('overview.learning', true);
    check(model.getBlocks()[0].id === 'overview.research' && model.getBlocks().length === 3, 'Draft order, size and visibility');
    model.cancel();
    check(model.getBlocks()[0].id === 'overview.tables' && model.getBlocks().length === 4 && model.getBlocks()[1].size === 'small', 'Cancel restores committed state without saving');
    model.begin(); model.setHidden('overview.learning', true); model.move('overview.restore', -1);
    check(model.getBlocks()[1].id === 'overview.restore', 'Move counts visible blocks rather than hidden blocks');
    model.setSize('overview.restore', 'full');
    check(model.commit().saved, 'Commit persists');
    const reopened = createDashboardLayout(registry, {storage});
    check(reopened.getBlocks()[1].id === 'overview.restore' && reopened.getBlocks()[1].size === 'full' && reopened.getBlocks().length === 3, 'A fresh instance restores the saved layout');
    check(storage.values.get('preferences') === 'keep', 'Keep separate preferences untouched');
    model.dispose(); reopened.dispose();
}
{
    const storage = storageWith({version: 1, futureEnvelope: {retain: true}, order: ['overview.research', 'future.chart', 'overview.tables'], blocks: {
        'future.chart': {size: 'full', hidden: true, settings: {query: 22}},
        'overview.tables': {size: 'wide', hidden: true, render: 'untrusted', titleKey: 'untrusted', futureField: 7},
    }});
    const model = createDashboardLayout(registry, {storage});
    check(model.getLayout().order.join(',') === 'overview.research,future.chart,overview.tables,overview.learning,overview.restore', 'Append newly registered blocks after the existing order');
    const tables = model.getBlocks({includeHidden: true}).find(block => block.id === 'overview.tables');
    check(typeof tables.render === 'function' && tables.titleKey === 'overview.tables.title', 'Saved data cannot override trusted renderers');
    model.begin(); model.reset(); model.commit();
    const result = JSON.parse(storage.values.get(DASHBOARD_STORAGE_KEY));
    check(result.blocks['future.chart'].settings.query === 22 && result.blocks['future.chart'].hidden && result.futureEnvelope.retain, 'Reset preserves unknown blocks and envelope fields');
    check(result.blocks['overview.tables'].futureField === 7 && result.blocks['overview.tables'].hidden === false, 'Reset touches known layout fields only');
    model.dispose();
}
{
    const model = createDashboardLayout(registry, {storage: storageWith(undefined, true)});
    model.begin(); model.setHidden('overview.research', true);
    check(!model.commit().saved && model.getBlocks().length === 3 && !model.isEditing(), 'Failed persistence retains the committed session layout');
    model.begin(); model.setSize('overview.tables', 'full'); model.commit();
    check(model.getBlocks().length === 3 && model.getBlocks()[0].size === 'full', 'Later failed saves preserve earlier session changes');
    model.dispose();
}
{
    const storage = storageWith({version: 1, order: ['overview.tables', 'overview.research'], blocks: {}});
    const model = createDashboardLayout(registry, {storage});
    model.begin(); model.setSize('overview.tables', 'full');
    storage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify({version: 1, order: ['overview.tables', 'future.chart', 'overview.research'], blocks: {'future.chart': {hidden: true, futureData: 7}, 'overview.research': {hidden: true}}}));
    model.commit();
    const result = model.getLayout();
    check(result.blocks['overview.tables'].size === 'full' && result.blocks['overview.research'].hidden && result.blocks['future.chart'].futureData === 7, 'Merge independent other-tab updates');
    model.dispose();
}
{
    const storage = storageWith({version: 99, order: ['future.chart'], blocks: {'future.chart': {retain: true}}});
    const model = createDashboardLayout(registry, {storage});
    model.begin(); model.setHidden('overview.tables', true);
    check(!model.commit().saved && JSON.parse(storage.values.get(DASHBOARD_STORAGE_KEY)).version === 99, 'Do not downgrade a future schema');
    model.dispose();
}
console.log(`${checks} dashboard layout checks passed.`);
