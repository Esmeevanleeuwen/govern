/** Plain-language questions and optional technical evidence in the shared canvas. */
import assert from 'node:assert/strict';
import {exploreHarness} from './explore-helpers.mjs';

const h = await exploreHarness();
const {page, node, api, bookmark, inspector, ensureSources, chooseTable, selectSeed, mapResponse} = h;
const publicKey = 'postgres:govern_pg:public', archiveKey = 'postgres:govern_pg:archive';
const scope = {connection: 'postgres', database: 'govern_pg', schema: 'public'};
const openQuestions = async () => {
    const questions = page.locator('#record-map-questions');
    if (!await questions.evaluate(el => el.open)) await questions.locator('summary').click();
};
try {
    const start = await api('record-map', scope, {table: 'demo_organizations', key: {id: '1'}});
    const systems = start.relations.find(item => item.source_table === 'demo_systems' && item.direction === 'incoming');
    assert.ok(systems, 'The guide has a real systems FK to follow.');
    await page.goto(bookmark(publicKey, 'demo_organizations'), {waitUntil: 'networkidle'});
    await ensureSources();
    const rootId = await selectSeed('Northbridge Council');
    assert.equal(rootId, start.focus.id);
    assert.equal(await page.locator('#open-database').isDisabled(), true);
    assert.equal(await page.locator('#add-row, [data-row-action]').count(), 0);
    assert.equal(await page.locator('.record-map textarea').count(), 0, 'Guided exploration requires no SQL input.');
    await openQuestions();
    const question = page.locator('[data-map-question="' + systems.id + '"]');
    assert.ok((await question.textContent()).includes('Demo systems'), 'Questions use readable category names.');
    const expanded = mapResponse('postgres', systems.id);
    await question.focus(); await question.press('Enter');
    const systemData = (await (await expanded).json()).data;
    const portal = systemData.nodes.find(item => item.table === 'demo_systems' && item.key.id === '1');
    assert.ok(portal, 'The returned records include the real portal.');
    await page.waitForFunction(() => document.querySelectorAll('[data-record-node]').length === 3);
    assert.equal(await page.locator('[data-guide-group="demo_systems"]').count(), 1,
        'Guided questions and the canvas share one relationship action.');
    const ownership = systemData.edges.find(edge => edge.source === portal.id && edge.target === rootId);
    assert.ok(ownership);
    await page.locator('[data-record-edge="' + ownership.id + '"]').focus();
    await page.locator('[data-record-edge="' + ownership.id + '"]').press('Enter');
    await inspector.waitFor({state: 'visible'});
    assert.ok((await inspector.textContent()).includes('Resident Services Portal')
        && (await inspector.textContent()).includes('Northbridge Council'), 'Connection explanations name both real records.');
    const technical = inspector.locator('[data-map-technical]').first();
    assert.equal(await technical.evaluate(el => el.open), false, 'Technical key/SQL information starts collapsed.');
    await technical.locator('summary').first().click();
    assert.ok((await technical.textContent()).includes('owner_organization_id'));
    assert.ok((await technical.textContent()).includes('demo_organizations'));
    assert.ok((await inspector.textContent()).includes(ownership.constraint));

    await node(portal.id).focus(); await node(portal.id).press('Enter');
    await inspector.locator('h3').filter({hasText: portal.label}).waitFor();
    assert.ok((await inspector.textContent()).includes('125000.00'), 'The same selected portal exposes its source budget field.');
    await inspector.getByRole('button', {name: 'Explore from here', exact: true}).click();
    const portalInfo = await api('record-map', scope, {table: 'demo_systems', key: {id: '1'}});
    const projectRelation = portalInfo.relations.find(item => item.source_table === 'demo_projects' && item.direction === 'incoming');
    assert.ok(projectRelation);
    await openQuestions();
    const projects = mapResponse('postgres', projectRelation.id);
    await page.locator('[data-map-question="' + projectRelation.id + '"]').click();
    const projectData = (await (await projects).json()).data;
    const project = projectData.nodes.find(item => item.label === 'Plain-language service pages');
    assert.ok(project, 'Following and asking the next question reveals a real connected project.');
    await node(project.id).waitFor();
    await node(project.id).focus(); await node(project.id).press('Enter');
    await inspector.locator('h3').filter({hasText: project.label}).waitFor();
    const beforeLanguage = await page.locator('[data-record-node]').evaluateAll(items => items.map(el => el.dataset.recordNode).sort());
    await page.locator('#language-select').selectOption('nl');
    await page.waitForFunction(() => document.documentElement.lang === 'nl');
    await node(project.id).waitFor();
    assert.deepEqual(await page.locator('[data-record-node]').evaluateAll(items => items.map(el => el.dataset.recordNode).sort()), beforeLanguage,
        'A language change preserves the loaded exploration path and records.');
    assert.equal(await page.locator('.record-map-node[data-node-id="' + project.id + '"]').getAttribute('data-selected'), 'true');
    await page.locator('#language-select').selectOption('en');
    await h.screenshot('explore-questions-desktop');

    // A new schema starts with its own source list, selection and questions.
    await page.goto(bookmark(archiveKey, 'govern_pg_values'), {waitUntil: 'networkidle'});
    await chooseTable('govern_pg_values');
    const archiveId = await selectSeed('Archive-only row');
    assert.equal(await page.locator('[data-record-node]').count(), 1);
    assert.equal(await page.locator('[data-map-question]').count(), 0, 'Another schema cannot reuse the public questions.');
    assert.equal((await page.locator('.record-map').textContent()).includes('Northbridge Council'), false);
    await page.setViewportSize({width: 320, height: 850});
    if (await page.locator('#record-map-sources').isVisible()) await page.locator('#record-map-sources-close').click();
    await node(archiveId).focus(); await node(archiveId).press('Enter');
    await inspector.locator('h3').filter({hasText: 'Archive-only row'}).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await h.screenshot('explore-questions-mobile');
    h.clean();
    console.log('PASS: real guided FK questions, readable labels, optional exact source evidence, following records, language preservation, isolated schemas and keyboard/mobile selection.');
} finally { await h.close(); }
