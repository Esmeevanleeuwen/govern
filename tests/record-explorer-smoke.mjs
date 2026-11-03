import {selectWorkspaceLanguage, clickWorkspaceTool} from './workspace-tools.mjs';
/** Flexible canvas interaction against real, isolated record-map fixtures. */
import assert from 'node:assert/strict';
import {exploreHarness, bounded} from './explore-helpers.mjs';

const h = await exploreHarness();
const {page, inspector, node, api, bookmark, ensureSources, selectSeed, mapResponse} = h;
const rootInput = {table: 'zz_record_map_people', key: {id: '9007199254740993'}};
const outer = id => page.locator('.record-map-node[data-node-id="' + id + '"]');
const position = id => outer(id).evaluate(el => ({left: el.style.left, top: el.style.top, transform: el.style.transform}));
const cameraTransform = () => page.locator('.record-map-world').evaluate(el => el.style.transform);
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
const withinPanel = (control, panel) => control.evaluate((element, selector) => {
    const box = element.getBoundingClientRect(), frame = element.closest(selector).getBoundingClientRect();
    return box.top >= frame.top && box.bottom <= frame.bottom && box.left >= frame.left && box.right <= frame.right;
}, panel);
const selectedId = () => page.locator('.record-map-node[data-selected="true"] [data-record-node]').first().getAttribute('data-record-node');
try {
    const info = await api('record-map', {database: 'bestuursatlas'}, rootInput);
    const incoming = info.relations.find(item => item.constraint === 'zz_record_map_project_lead' && item.direction === 'incoming');
    await page.goto(bookmark('bestuursatlas', rootInput.table), {waitUntil: 'networkidle'});
    assert.equal(await page.locator('#workspace-context').isVisible(), false,
        'Explore has one source library rather than a second fixed table sidebar.');
    await ensureSources();
    await page.locator('#record-map-table-search').fill('zz_record_map_projects');
    assert.deepEqual(await page.locator('#record-map-table option').evaluateAll(options => options.map(option => option.value).sort()),
        ['zz_record_map_people', 'zz_record_map_projects'],
        'Filtering table names keeps the current table available while narrowing the source choices.');
    await page.locator('#record-map-table-search').fill('');
    await page.locator('#record-map-search').fill('%_');
    const sourceResult = page.locator('#record-map-records [data-map-record]').filter({hasText: 'Atlas%_'}).first();
    await sourceResult.waitFor();
    assert.match(await sourceResult.locator('[data-map-record-preview]').innerText(), /123456789012345678901234\.12/,
        'A source result shows a recognizable existing-field preview in addition to its label.');
    assert.match(await sourceResult.locator('[data-map-record-key]').innerText(), /9007199254740993/,
        'A friendly source preview keeps the exact large record key available for disambiguation.');
    const rootId = await selectSeed('Atlas%_');
    assert.match(await sourceResult.locator('.record-map-record-badge').innerText(), /Starting record/i,
        'The first chosen source is immediately labeled as the passive starting record.');
    assert.match(await node(rootId).getAttribute('aria-label'), /9007199254740993/,
        'A canvas card exposes its exact key in its accessible name.');
    const originalRootPosition = await position(rootId);
    const connections = page.locator('#record-map-connections[data-map-connections-for="' + rootId + '"]');
    await connections.waitFor();
    assert.equal(await connections.locator('[data-record-relation="' + incoming.id + '"]').count(), 1,
        'The inspector exposes the selected record through the shared Connections interface.');
    assert.match(await connections.locator('[data-record-relation="' + incoming.id + '"]').getAttribute('aria-label'),
        new RegExp(incoming.constraint, 'i'), 'A connection action names its declared relationship for assistive technology.');
    await page.locator('#record-map-inspector-close').click();
    await outer(rootId).locator('.record-map-card-expand').click();
    await connections.waitFor({state: 'visible'});
    assert.equal(await connections.locator('[data-record-relation="' + incoming.id + '"]').count(), 1,
        'The card shortcut opens the same selected-record Connections interface.');
    await page.locator('#record-map-inspector-close').click();
    await page.locator('#record-map-expand-selected').click();
    await connections.waitFor({state: 'visible'});
    assert.equal(await connections.locator('[data-record-relation="' + incoming.id + '"]').count(), 1,
        'The selection shortcut opens the same selected-record Connections interface.');

    let releaseInitialExpansion, markInitialExpansionHeld, markInitialExpansionHandled;
    const initialExpansionHeld = new Promise(resolve => { markInitialExpansionHeld = resolve; });
    const initialExpansionReleased = new Promise(resolve => { releaseInitialExpansion = resolve; });
    const initialExpansionHandled = new Promise(resolve => { markInitialExpansionHandled = resolve; });
    const initialExpansionMatcher = url => url.pathname === '/api.php' && url.searchParams.get('action') === 'record-map'
        && url.searchParams.get('database') === 'bestuursatlas';
    const holdInitialExpansion = async route => {
        if (route.request().postDataJSON()?.relation !== incoming.id) return route.continue();
        try {
            const response = await route.fetch();
            markInitialExpansionHeld(); await initialExpansionReleased;
            try { await route.fulfill({response}); } catch { /* Clearing or a newer read may abort this route. */ }
        } finally { markInitialExpansionHandled(); }
    };
    await page.route(initialExpansionMatcher, holdInitialExpansion);
    const expanded = mapResponse('mariadb', incoming.id);
    await connections.locator('[data-record-relation="' + incoming.id + '"]').click();
    await bounded(initialExpansionHeld);
    const viewport = page.locator('.record-map-viewport');
    await viewport.focus();
    for (let index = 0; index < 20; index++) await viewport.press('ArrowRight');
    await viewport.press('+'); await viewport.press('+');
    const liveCameraWhilePending = await cameraTransform();
    releaseInitialExpansion();
    const payload = (await (await expanded).json()).data;
    await bounded(initialExpansionHandled);
    await page.unroute(initialExpansionMatcher, holdInitialExpansion);
    await page.waitForFunction(() => document.querySelectorAll('[data-record-node]').length === 3);
    assert.deepEqual(await position(rootId), originalRootPosition, 'Expanding a branch preserves existing card positions.');
    assert.equal(await cameraTransform(), liveCameraWhilePending,
        'An expansion response preserves the live camera, including pan and zoom performed while it was pending.');
    const children = payload.nodes.filter(item => item.table === 'zz_record_map_projects');
    const first = children.find(item => item.key.id === '11'), second = children.find(item => item.key.id === '12');
    assert.ok(first && second, 'The canvas contains both real composite-key projects.');
    const relationState = page.locator('[data-map-relation-state="' + incoming.id + '"]');
    assert.match((await relationState.innerText()).replace(/\s+/g, ' '), /2 loaded.*complete/i,
        'Connection status reports accepted relationship matches and completion without guessing a database total.');
    const cameraBeforeReveal = await cameraTransform();
    await page.locator('[data-map-show-added]').click();
    assert.notEqual(await cameraTransform(), cameraBeforeReveal,
        'Show added records is the explicit action that reveals an offscreen branch.');
    assert.equal(await page.locator('[data-record-node]').evaluateAll(cards => cards.some(card => card === document.activeElement)), true,
        'Show added records returns focus to a newly revealed record card.');
    assert.equal(await page.locator('[data-record-node]').count(), 3, 'Revealing additions changes the view, not the loaded graph.');

    const graphBeforeSourceChange = await page.locator('[data-record-node]').evaluateAll(items => items.map(item => item.dataset.recordNode).sort());
    const edgesBeforeSourceChange = await page.locator('[data-record-edge]').evaluateAll(items => items.map(item => item.dataset.recordEdge).sort());
    const cameraBeforeSourceChange = await cameraTransform();
    await ensureSources();
    await page.locator('#record-map-table').selectOption('zz_record_map_projects');
    await page.locator('#record-map-records [data-map-record]').filter({hasText: 'Project Alpha'}).first().waitFor();
    assert.deepEqual(await page.locator('[data-record-node]').evaluateAll(items => items.map(item => item.dataset.recordNode).sort()), graphBeforeSourceChange,
        'Changing the Sources table preserves the loaded graph.');
    assert.deepEqual(await page.locator('[data-record-edge]').evaluateAll(items => items.map(item => item.dataset.recordEdge).sort()), edgesBeforeSourceChange,
        'Changing the Sources table preserves relationship evidence.');
    assert.equal(await selectedId(), rootId, 'Changing the Sources table preserves the active canvas record.');
    assert.equal(await cameraTransform(), cameraBeforeSourceChange, 'Changing the Sources table preserves the camera.');
    await page.locator('#record-map-table').selectOption('zz_record_map_people');
    await page.locator('#record-map-search').fill('%_');
    await page.locator('#record-map-records [data-map-record]').filter({hasText: 'Atlas%_'}).first().waitFor();

    let releaseDetailHydration, markDetailHydrationHeld, markDetailHydrationHandled, detailHydrationReads = 0;
    const detailHydrationHeld = new Promise(resolve => { markDetailHydrationHeld = resolve; });
    const detailHydrationReleased = new Promise(resolve => { releaseDetailHydration = resolve; });
    const detailHydrationHandled = new Promise(resolve => { markDetailHydrationHandled = resolve; });
    const holdDetailHydration = async route => {
        const body = route.request().postDataJSON();
        if (body?.relation || body?.table !== first.table || JSON.stringify(body?.key) !== JSON.stringify(first.key)) {
            return route.continue();
        }
        detailHydrationReads++;
        try {
            const response = await route.fetch();
            markDetailHydrationHeld(); await detailHydrationReleased;
            try { await route.fulfill({response}); } catch { /* Back may abort this obsolete record read. */ }
        } finally { markDetailHydrationHandled(); }
    };
    await page.route(initialExpansionMatcher, holdDetailHydration);
    await outer(first.id).locator('.record-map-card-expand').click();
    await bounded(detailHydrationHeld);
    assert.equal(await selectedId(), first.id, 'Selecting a loaded card starts its detail read immediately.');
    await page.locator('#record-map-back').click();
    await page.waitForFunction(id => document.querySelector('.record-map-node[data-selected="true"] [data-record-node]')?.dataset.recordNode === id, rootId);
    releaseDetailHydration();
    await bounded(detailHydrationHandled);
    await page.unroute(initialExpansionMatcher, holdDetailHydration);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(detailHydrationReads, 1, 'The card Connections shortcut starts only one detail read.');
    assert.equal(await selectedId(), rootId, 'A stale detail response cannot reselect a record after Back.');
    assert.match(await inspector.locator('.record-map-inspector-heading h3').innerText(), /Atlas%_/,
        'A stale detail response cannot overwrite the inspector restored by Back.');
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

    await viewport.focus();
    await viewport.press('ArrowLeft');
    const rootHistoryCamera = await cameraTransform();
    const hydrated = mapResponse('mariadb', undefined, first.key);
    await outer(first.id).locator('.record-map-card-expand').click();
    const firstInfo = (await (await hydrated).json()).data;
    await inspector.locator('h3').filter({hasText: first.label}).waitFor();
    await page.locator('[data-record-relation="' + firstInfo.relations[0].id + '"]').waitFor();
    assert.equal(await page.locator('#record-map-connections').evaluate(element => element === document.activeElement), true,
        'Connections keeps focus after the accepted detail read replaces the inspector content.');
    assert.deepEqual(await page.locator('[data-record-edge]').evaluateAll(items => items.map(el => el.dataset.recordEdge).sort()),
        payload.edges.map(item => item.id).sort(), 'Inspecting an unchanged neighboring record preserves the loaded branch evidence.');
    await viewport.focus();
    await viewport.press('ArrowRight');
    assert.notEqual(await cameraTransform(), rootHistoryCamera, 'The neighboring record can have its own current viewpoint.');
    assert.equal(await page.locator('#record-map-back').isDisabled(), false, 'Back becomes available after deliberate record navigation.');
    await page.locator('#record-map-back').click();
    assert.equal(await selectedId(), rootId, 'Back restores the previous inspected record.');
    assert.equal(await cameraTransform(), rootHistoryCamera, 'Back restores that record context\'s saved viewpoint.');
    assert.equal(await page.locator('[data-record-node]').count(), 3, 'Back keeps branches loaded.');
    await node(first.id).focus(); await node(first.id).press('Enter');
    await inspector.locator('h3').filter({hasText: first.label}).waitFor();
    await page.locator('#record-map-inspector-close').click();
    assert.equal(await node(first.id).evaluate(element => element === document.activeElement), true,
        'Closing the inspector returns focus to the current visible card.');
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

    await node(rootId).focus(); await node(rootId).press('Enter');
    await inspector.locator('h3').filter({hasText: 'Atlas%_'}).waitFor();
    const projectFilter = page.locator('[data-map-entity-filter="zz_record_map_projects"]');
    await projectFilter.evaluate(control => { control.closest('details').open = true; });
    await projectFilter.uncheck();
    assert.equal(await page.locator('[data-record-node]').count(), 1, 'A table filter can hide a prior history target without deleting it.');
    await page.locator('#record-map-back').click();
    const historyRecovery = page.locator('[data-map-history-recovery]');
    await historyRecovery.waitFor();
    assert.equal(await selectedId(), rootId, 'Back does not silently reverse a filter for a hidden target.');
    assert.match(await historyRecovery.innerText(), /hidden/i, 'The history recovery explains why the prior record is unavailable in the current view.');
    await historyRecovery.locator('[data-map-reveal-return]').click();
    await node(first.id).waitFor();
    assert.equal(await selectedId(), first.id, 'Reveal and return explicitly restores the hidden history target.');
    assert.equal(await page.locator('[data-record-node]').count(), 3, 'Reveal and return keeps the complete loaded graph.');
    await page.locator('#record-map-return-start').click();
    assert.equal(await selectedId(), rootId, 'Return to starting record restores the passive exploration origin.');
    assert.equal(await page.locator('[data-record-node]').count(), 3, 'Returning to the start keeps later branches loaded.');
    await node(first.id).focus(); await node(first.id).press('Enter');
    await inspector.locator('h3').filter({hasText: first.label}).waitFor();
    await page.locator('#record-map-inspector-close').click();

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
    await inspector.locator('[data-map-technical] > summary').click();
    await inspector.locator('.record-map-panel-body').evaluate(body => { body.scrollTop = body.scrollHeight; });
    assert.equal(await withinPanel(page.locator('#record-map-inspector-close'), '#record-map-inspector'), true,
        'Scrolling record evidence keeps the inspector close control reachable.');
    await inspector.locator('.record-map-panel-body').evaluate(body => { body.scrollTop = 0; });
    const sourceRead = page.waitForRequest(request => {
        const url = new URL(request.url());
        return url.pathname === '/api.php' && url.searchParams.get('action') === 'record-map'
            && request.postDataJSON()?.table === first.table && !request.postDataJSON()?.relation;
    });
    await page.locator('[data-map-open-table="' + first.table + '"]').click();
    assert.deepEqual((await sourceRead).postDataJSON().key, first.key, 'Opening Data passes the complete composite record key.');
    await page.locator('#selected-source-record .data-table').waitFor();
    assert.ok((await page.locator('#selected-source-record').textContent()).includes(first.label));
    const sourceCard = page.locator('#selected-source-record');
    const recordsCard = page.locator('#selected-source-record + .card');
    await recordsCard.locator('.data-table').waitFor();
    const sourceGap = () => sourceCard.evaluate(source =>
        source.nextElementSibling.getBoundingClientRect().top - source.getBoundingClientRect().bottom);
    assert.ok(await sourceGap() >= 24, 'The selected source and complete record table are visually separate.');
    await h.screenshot('records-source-spacing');

    const originalSearch = await page.locator('#data-search').inputValue();
    const originalRows = await recordsCard.locator('.data-table').innerText();
    let releaseBrowse, markBrowseHeld, markBrowseHandled;
    const browseHeld = new Promise(resolve => { markBrowseHeld = resolve; });
    const browseReleased = new Promise(resolve => { releaseBrowse = resolve; });
    const browseHandled = new Promise(resolve => { markBrowseHandled = resolve; });
    const browseMatcher = url => url.pathname === '/api.php' && url.searchParams.get('action') === 'browse'
        && url.searchParams.get('table') === first.table;
    const holdBrowse = async route => {
        try {
            const response = await route.fetch();
            markBrowseHeld(); await browseReleased;
            await route.fulfill({response});
        } finally { markBrowseHandled(); }
    };
    await page.route(browseMatcher, holdBrowse);
    try {
        const immediatelyBusy = await page.locator('#data-search').evaluate(input => {
            input.value = 'no_matching_record_layout_check';
            input.dispatchEvent(new Event('input', {bubbles: true}));
            return Boolean(document.querySelector('#selected-source-record + .card .data-table')?.closest('[inert][aria-busy="true"]'));
        });
        assert.equal(immediatelyBusy, true, 'Typing immediately disables stale row actions, before the search debounce expires.');
        await bounded(browseHeld);
        assert.equal(await recordsCard.locator('.data-table').innerText(), originalRows,
            'The existing rows remain readable while the next search response is pending.');
        assert.equal(await recordsCard.locator('.data-table').evaluate(table => Boolean(table.closest('[inert][aria-busy="true"]'))), true,
            'Rows from the previous search cannot trigger stale record actions.');
        assert.equal(await recordsCard.locator('.table-pagination button').evaluateAll(buttons => buttons.every(button => button.disabled)), true,
            'Pagination cannot compete with a pending search.');
        assert.match(await page.locator('.data-update-status').innerText(), /Updating records/);
    } finally {
        releaseBrowse();
        await bounded(browseHandled);
        await page.unroute(browseMatcher, holdBrowse);
    }
    await page.waitForFunction(() => document.querySelector('.data-update-status')?.textContent === '');
    const restoredBrowse = page.waitForResponse(response => browseMatcher(new URL(response.url())));
    await page.locator('#data-search').fill(originalSearch);
    await restoredBrowse;
    await page.waitForFunction(() => document.querySelector('.data-update-status')?.textContent === '');
    assert.equal(await recordsCard.locator('.data-table').evaluate(table => Boolean(table.closest('[inert]'))), false);
    await page.setViewportSize({width: 320, height: 860});
    assert.ok(await sourceGap() >= 24, 'The selected source also has clear separation on a narrow screen.');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
        'Both Records tables scroll inside their cards at 320px.');
    await page.setViewportSize({width: 1440, height: 1000});
    await sourceCard.locator('.selected-source-actions .button').last().click();
    assert.equal(await sourceCard.count(), 0);
    assert.equal(await page.locator('#data-search').evaluate(input => input === document.activeElement), true,
        'Dismissing source context returns keyboard focus to record search.');
    await page.locator('[data-database-view="verkennen"]').click();
    await page.locator('#record-map-layout').waitFor();
    assert.equal(await page.locator('[data-record-node]').count(), 3, 'Data and Explore share the selected record without discarding the canvas.');
    assert.equal(await outer(first.id).getAttribute('data-pinned'), 'true');
    await page.locator('#record-map-fit').click();
    await h.screenshot('flexible-explore-expanded');
    const beforeRefresh = await position(first.id);
    const refreshed = mapResponse('mariadb', undefined, first.key);
    await clickWorkspaceTool(page, '#refresh-app');
    await refreshed;
    await node(first.id).waitFor();
    assert.equal(await outer(first.id).getAttribute('data-pinned'), 'true', 'Global refresh keeps the pinned presentation state.');
    assert.deepEqual(await position(first.id), beforeRefresh, 'Global refresh preserves the pinned card geometry.');
    assert.equal(await page.locator('[data-record-edge]').count(), 0, 'Global refresh drops the previous source evidence before re-reading.');
    assert.equal(await page.locator('#record-map-undo').isDisabled(), true, 'Canvas Undo cannot revive pre-refresh record snapshots.');
    await page.locator('#record-map-fit').click();
    await h.screenshot('flexible-explore-desktop');

    await ensureSources();
    assert.equal(await inspector.isVisible(), true, 'The wide canvas can show both context panels.');
    await page.locator('#record-map-search').focus();
    await page.setViewportSize({width: 1000, height: 1000});
    assert.ok(await viewport.evaluate(element => element.clientWidth) < 900,
        'The navigation can make the Explore canvas constrained before the browser viewport is compact.');
    await page.waitForFunction(() => document.querySelector('[data-flexible-explorer]')?.dataset.constrained === 'true');
    assert.equal(await page.locator('[data-flexible-explorer]').getAttribute('data-constrained'), 'true',
        'Responsive state follows actual canvas width.');
    await page.waitForFunction(() => [...document.querySelectorAll('.record-map-panel')].filter(panel => !panel.hidden).length === 1);
    assert.equal(await page.locator('.record-map-panel').evaluateAll(panels => panels.filter(panel => !panel.hidden).length), 1,
        'Resizing to a narrow canvas closes the peer panel before the panels overlap.');
    assert.equal(await sourcePanel.isVisible(), true, 'The source panel with keyboard focus survives the resize.');
    assert.equal(await page.locator('#record-map-search').evaluate(input => input === document.activeElement), true,
        'Resizing does not discard keyboard focus from source search.');

    await page.setViewportSize({width: 360, height: 860});
    await page.waitForFunction(() => document.querySelector('[data-flexible-explorer]')?.dataset.narrow === 'true');
    assert.equal(await page.locator('[data-flexible-explorer]').getAttribute('data-narrow'), 'true',
        'The compact drawer mode follows actual canvas width.');
    await ensureSources();
    await page.locator('#record-map-records').evaluate(list => { list.scrollTop = list.scrollHeight; });
    assert.equal(await withinPanel(page.locator('#record-map-search'), '#record-map-sources'), true,
        'Browsing source rows keeps record search reachable in the compact drawer.');
    assert.equal(await withinPanel(page.locator('#record-map-sources-close'), '#record-map-sources'), true,
        'The compact source drawer always keeps its close control reachable.');
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
    await page.locator('#toasts .toast').evaluateAll(toasts => toasts.forEach(toast => toast.remove()));
    await h.screenshot('flexible-explore-mobile');
    assert.equal(await page.evaluate(() => JSON.stringify({...localStorage, ...sessionStorage}).includes('9007199254740993')), false,
        'Source records and exact keys are never persisted in browser storage.');

    await page.setViewportSize({width: 1440, height: 1000});
    await node(first.id).focus(); await node(first.id).press('Enter');
    await inspector.locator('h3').filter({hasText: first.label}).waitFor();
    const tableBeforeClear = await page.locator('#record-map-table').inputValue();
    const searchBeforeClear = await page.locator('#record-map-search').inputValue();
    const nodesBeforeClear = await page.locator('[data-record-node]').count();
    await page.locator('#record-map-clear').click();
    let confirmation = page.locator('dialog.confirm-dialog[open]');
    await confirmation.waitFor();
    assert.match((await confirmation.innerText()).replace(/\s+/g, ' '), /loaded|exploration/i,
        'Clearing a populated map explains the exploration that will be discarded.');
    assert.match((await confirmation.innerText()).replace(/\s+/g, ' '), /history|undo/i,
        'The confirmation names temporary navigation or Undo state.');
    await confirmation.getByRole('button', {name: /Cancel/i}).click();
    await confirmation.waitFor({state: 'detached'});
    assert.equal(await page.locator('[data-record-node]').count(), nodesBeforeClear, 'Cancelling Clear map preserves the graph.');
    assert.equal(await page.locator('#record-map-table').inputValue(), tableBeforeClear, 'Cancelling Clear map preserves the source table.');
    assert.equal(await page.locator('#record-map-search').inputValue(), searchBeforeClear, 'Cancelling Clear map preserves the source query.');
    assert.equal(await page.locator('#record-map-clear').evaluate(button => button === document.activeElement), true,
        'Cancelling returns keyboard focus to the Clear map opener.');

    const taskRelation = firstInfo.relations.find(relation => relation.constraint === 'zz_record_map_task_project'
        && relation.direction === 'incoming');
    assert.ok(taskRelation, 'The project fixture exposes a real task relationship for delayed clearing.');
    let releaseClearExpansion, markClearExpansionHeld, markClearExpansionHandled;
    const clearExpansionHeld = new Promise(resolve => { markClearExpansionHeld = resolve; });
    const clearExpansionReleased = new Promise(resolve => { releaseClearExpansion = resolve; });
    const clearExpansionHandled = new Promise(resolve => { markClearExpansionHandled = resolve; });
    const clearExpansionMatcher = url => url.pathname === '/api.php' && url.searchParams.get('action') === 'record-map'
        && url.searchParams.get('database') === 'bestuursatlas';
    const holdClearExpansion = async route => {
        if (route.request().postDataJSON()?.relation !== taskRelation.id) return route.continue();
        try {
            const response = await route.fetch();
            markClearExpansionHeld(); await clearExpansionReleased;
            try { await route.fulfill({response}); } catch { /* Clear map aborts the obsolete browser request. */ }
        } finally { markClearExpansionHandled(); }
    };
    await page.route(clearExpansionMatcher, holdClearExpansion);
    await page.locator('#record-map-connections [data-record-relation="' + taskRelation.id + '"]').click();
    await bounded(clearExpansionHeld);
    await page.locator('#record-map-clear').click();
    confirmation = page.locator('dialog.confirm-dialog[open]');
    await confirmation.waitFor();
    await confirmation.locator('button[type="submit"]').click();
    await confirmation.waitFor({state: 'detached'});
    await page.waitForFunction(() => document.querySelectorAll('[data-record-node]').length === 0);
    releaseClearExpansion();
    await bounded(clearExpansionHandled);
    await page.unroute(clearExpansionMatcher, holdClearExpansion);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('[data-record-node]').count(), 0, 'Confirming Clear map discards the loaded graph.');
    assert.equal(await page.locator('[data-record-edge]').count(), 0, 'A delayed expansion cannot repopulate a cleared map.');
    assert.equal(await page.locator('#record-map-table').inputValue(), tableBeforeClear, 'Clear map retains the source table for restarting.');
    assert.equal(await page.locator('#record-map-search').inputValue(), searchBeforeClear, 'Clear map retains the source query for restarting.');
    assert.equal(await page.locator('#record-map-undo').isDisabled(), true, 'Clear map discards presentation Undo state.');
    assert.equal(await page.locator('#record-map-back').isDisabled(), true, 'Clear map discards record navigation history.');
    assert.equal(await page.locator('#record-map-return-start').isDisabled(), true, 'Clear map discards the starting-record origin.');
    h.clean();
    console.log('PASS: systematic Explore sources, shared connections, stable camera, record history, safe clearing, flexible canvas and compact drawers.');
} finally { await h.close(); }
