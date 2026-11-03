/** Flexible canvas interaction against real, isolated record-map fixtures. */
import assert from 'node:assert/strict';
import {exploreHarness} from './explore-helpers.mjs';

const h = await exploreHarness();
const {page, inspector, node, api, bookmark, ensureSources, selectSeed, mapResponse} = h;
const rootInput = {table: 'zz_record_map_people', key: {id: '9007199254740993'}};
const outer = id => page.locator('.record-map-node[data-node-id="' + id + '"]');
const position = id => outer(id).evaluate(el => ({left: el.style.left, top: el.style.top, transform: el.style.transform}));
const positions = () => page.locator('.record-map-node[data-node-id]').evaluateAll(items =>
    Object.fromEntries(items.map(el => [el.dataset.nodeId, {left: el.style.left, top: el.style.top, transform: el.style.transform}])));
const waitPosition = async (id, expected) => page.waitForFunction(({id, expected}) => {
    const el = document.querySelector('.record-map-node[data-node-id="' + id + '"]');
    return el && JSON.stringify({left: el.style.left, top: el.style.top, transform: el.style.transform}) === JSON.stringify(expected);
}, {id, expected});
const closePanels = async () => {
    for (const selector of ['#record-map-sources-close', '#record-map-inspector-close']) {
        if (await page.locator(selector).isVisible()) await page.locator(selector).click();
    }
};
const drag = async (locator, dx, dy) => {
    const box = await locator.boundingBox();
    assert.ok(box, 'The drag handle is visible.');
    const x = box.x + box.width / 2, y = box.y + Math.min(22, box.height / 2);
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, {steps: 8}); await page.mouse.up();
};
try {
    const info = await api('record-map', {database: 'bestuursatlas'}, rootInput);
    const incoming = info.relations.find(item => item.constraint === 'zz_record_map_project_lead' && item.direction === 'incoming');
    await page.goto(bookmark('bestuursatlas', rootInput.table), {waitUntil: 'networkidle'});
    assert.equal(await page.locator('#workspace-context').isVisible(), false,
        'Explore has one source library rather than a second fixed table sidebar.');
    await ensureSources();
    await page.locator('#record-map-search').fill('%_');
    const rootId = await selectSeed('Atlas%_');
    const originalRootPosition = await position(rootId);
    const expanded = mapResponse('mariadb', incoming.id);
    await page.locator('[data-record-relation="' + incoming.id + '"]').click();
    const payload = (await (await expanded).json()).data;
    await page.waitForFunction(() => document.querySelectorAll('[data-record-node]').length === 3);
    assert.deepEqual(await position(rootId), originalRootPosition, 'Expanding a branch preserves existing card positions.');
    const children = payload.nodes.filter(item => item.table === 'zz_record_map_projects');
    const first = children.find(item => item.key.id === '11'), second = children.find(item => item.key.id === '12');
    assert.ok(first && second, 'The canvas contains both real composite-key projects.');
    await closePanels();
    await page.locator('#record-map-fit').click();

    const beforeDrag = await position(first.id);
    const beforeLayout = await page.locator('#record-map-layout').inputValue();
    await drag(node(first.id), 54, 28);
    assert.equal(await page.locator('#record-map-layout').inputValue(), 'manual', 'Dragging takes control of the arrangement.');
    assert.notDeepEqual(await position(first.id), beforeDrag);
    await page.locator('#record-map-undo').click();
    await waitPosition(first.id, beforeDrag);
    assert.equal(await page.locator('#record-map-layout').inputValue(), beforeLayout, 'Undo restores the preceding arrangement mode and position.');

    const hydrated = mapResponse('mariadb', undefined, first.key);
    await node(first.id).focus(); await node(first.id).press('Enter');
    const firstInfo = (await (await hydrated).json()).data;
    await inspector.locator('h3').filter({hasText: first.label}).waitFor();
    await page.locator('[data-record-relation="' + firstInfo.relations[0].id + '"]').waitFor();
    assert.deepEqual(await page.locator('[data-record-edge]').evaluateAll(items => items.map(el => el.dataset.recordEdge).sort()),
        payload.edges.map(item => item.id).sort(), 'Inspecting an unchanged neighboring record preserves the loaded branch evidence.');
    await page.locator('#record-map-inspector-close').click();
    await page.locator('#record-map-pin').click();
    assert.equal(await outer(first.id).getAttribute('data-pinned'), 'true');
    const pinnedPosition = await position(first.id), beforeArrange = await positions();
    await page.locator('#record-map-layout').selectOption('flow');
    await page.waitForFunction(({id, old}) => {
        const el = document.querySelector('.record-map-node[data-node-id="' + id + '"]');
        return el && JSON.stringify({left: el.style.left, top: el.style.top, transform: el.style.transform}) !== JSON.stringify(old);
    }, {id: second.id, old: beforeArrange[second.id]});
    assert.deepEqual(await position(first.id), pinnedPosition, 'Automatic layout preserves a pinned card.');
    await page.locator('#record-map-undo').click();
    await waitPosition(second.id, beforeArrange[second.id]);
    assert.equal(await outer(first.id).getAttribute('data-pinned'), 'true', 'Undoing a layout does not undo the earlier pin action.');

    await node(second.id).click({modifiers: ['Shift']});
    assert.equal(await page.locator('.record-map-node[data-selected="true"]').count(), 2, 'Shift-click shares a multi-record selection.');
    const validEdgesBeforeHide = await page.locator('[data-record-edge]').evaluateAll(items => items.map(el => el.dataset.recordEdge).sort());
    await page.locator('#record-map-hide').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-record-node]').length === 1);
    assert.equal(await page.locator('[data-record-edge]').count(), 0, 'Hiding cards also hides their attached lines.');
    await page.locator('#record-map-undo').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-record-node]').length === 3);
    assert.deepEqual(await page.locator('[data-record-edge]').evaluateAll(items => items.map(el => el.dataset.recordEdge).sort()), validEdgesBeforeHide,
        'Undo restores presentation visibility using still-current source evidence, never links invalidated by a source re-read.');

    await closePanels();
    await ensureSources();
    const sourcePanel = page.locator('#record-map-sources');
    const sourceBefore = await sourcePanel.boundingBox();
    await drag(page.locator('[data-map-panel-handle="sources"]'), 40, 24);
    const sourceAfter = await sourcePanel.boundingBox();
    assert.ok(sourceAfter.x > sourceBefore.x + 20 && sourceAfter.y > sourceBefore.y + 10, 'The source library can move within the workspace.');
    const resize = await sourcePanel.boundingBox();
    await page.mouse.move(resize.x + resize.width - 3, resize.y + resize.height - 3); await page.mouse.down();
    await page.mouse.move(resize.x + resize.width + 32, resize.y + resize.height - 3, {steps: 6}); await page.mouse.up();
    assert.ok((await sourcePanel.boundingBox()).width > resize.width + 15, 'The source library can be resized.');
    const grip = page.locator('[data-map-panel-move="sources"]');
    await grip.focus();
    const beforeGrip = await sourcePanel.boundingBox();
    await grip.press('ArrowRight');
    assert.ok((await sourcePanel.boundingBox()).x > beforeGrip.x + 10, 'The source panel can move with its keyboard grip.');
    const beforeKeyResize = await sourcePanel.boundingBox();
    await grip.press('Shift+ArrowRight');
    assert.ok((await sourcePanel.boundingBox()).width > beforeKeyResize.width + 10, 'The same keyboard grip can resize the source panel.');
    await page.locator('#record-map-sources-close').click();

    await node(first.id).focus();
    const beforeKeyboard = await position(first.id);
    await node(first.id).press('ArrowRight');
    assert.notDeepEqual(await position(first.id), beforeKeyboard, 'Keyboard controls can move a card without a pointer.');
    await page.locator('#record-map-undo').click();
    await waitPosition(first.id, beforeKeyboard);
    await node(first.id).press('Enter');
    await inspector.locator('h3').filter({hasText: first.label}).waitFor();
    const sourceRead = page.waitForRequest(request => {
        const url = new URL(request.url());
        return url.pathname === '/api.php' && url.searchParams.get('action') === 'record-map'
            && request.postDataJSON()?.table === first.table && !request.postDataJSON()?.relation;
    });
    await page.locator('[data-map-open-table="' + first.table + '"]').click();
    assert.deepEqual((await sourceRead).postDataJSON().key, first.key, 'Opening Data passes the complete composite record key.');
    await page.locator('#selected-source-record .data-table').waitFor();
    assert.ok((await page.locator('#selected-source-record').textContent()).includes(first.label));
    await page.locator('[data-database-view="verkennen"]').click();
    await page.locator('#record-map-layout').waitFor();
    assert.equal(await page.locator('[data-record-node]').count(), 3, 'Data and Explore share the selected record without discarding the canvas.');
    assert.equal(await outer(first.id).getAttribute('data-pinned'), 'true');
    await h.screenshot('flexible-explore-expanded');
    const beforeRefresh = await position(first.id);
    const refreshed = mapResponse('mariadb', undefined, first.key);
    await page.locator('#refresh-app').click();
    await refreshed;
    await node(first.id).waitFor();
    assert.equal(await outer(first.id).getAttribute('data-pinned'), 'true', 'Global refresh keeps the pinned presentation state.');
    assert.deepEqual(await position(first.id), beforeRefresh, 'Global refresh preserves the pinned card geometry.');
    assert.equal(await page.locator('[data-record-edge]').count(), 0, 'Global refresh drops the previous source evidence before re-reading.');
    assert.equal(await page.locator('#record-map-undo').isDisabled(), true, 'Canvas Undo cannot revive pre-refresh record snapshots.');
    await h.screenshot('flexible-explore-desktop');

    await page.setViewportSize({width: 360, height: 860});
    await ensureSources();
    await page.locator('#record-map-sources-close').click();
    await node(first.id).focus(); await node(first.id).press('Enter');
    await inspector.waitFor({state: 'visible'});
    assert.equal(await sourcePanel.isVisible(), false, 'A mobile source library and inspector do not overlap.');
    await page.locator('#record-map-sources-toggle').click();
    await sourcePanel.waitFor({state: 'visible'});
    assert.equal(await inspector.isVisible(), false, 'Opening mobile sources replaces the inspector.');
    await page.locator('#record-map-sources-close').click();
    for (const width of [320, 375]) {
        await page.setViewportSize({width, height: 860});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Canvas controls fit ' + width + 'px.');
    }
    await h.screenshot('flexible-explore-mobile');
    assert.equal(await page.evaluate(() => JSON.stringify({...localStorage, ...sessionStorage}).includes('9007199254740993')), false,
        'Source records and exact keys are never persisted in browser storage.');
    h.clean();
    console.log('PASS: flexible real-record cards, drag/keyboard positioning, expansion stability, pin/layout/undo/hide, movable/resizable sources, exact shared source selection and mobile drawers.');
} finally { await h.close(); }
