/** Real Studio UI → PHP API → PostgreSQL, using a disposable local installation. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {authenticatedContext} from './auth-session.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use an explicitly isolated local test installation.');
const audioFile = process.env.STUDIO_FAKE_AUDIO || '/workspace/work/live-whiteboard/synthetic-microphone.wav';
const screenshots = resolve(process.env.STUDIO_SCREENSHOT_DIR || 'test-results/studio');
await mkdir(screenshots, {recursive: true});
const browser = await chromium.launch({headless: true,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
        '--use-file-for-fake-audio-capture=' + audioFile],
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await authenticatedContext(browser, base, {locale: 'nl-NL', viewport: {width: 1440, height: 1000}, permissions: ['microphone']});
const observerContext = await authenticatedContext(browser, base, {locale: 'en-GB', viewport: {width: 1440, height: 1000}});
const page = await context.newPage(), observer = await observerContext.newPage();
const errors = [], failedApi = [];
for (const client of [page, observer]) {
    client.on('pageerror', error => errors.push(error.message));
    client.on('response', response => {
        const url = new URL(response.url());
        if (url.pathname === '/api.php' && response.status() >= 400) failedApi.push({action: url.searchParams.get('action'), status: response.status()});
    });
}

async function until(check, message, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        if (await check()) return;
        await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
    }
    throw new Error(message);
}

const tool = key => page.locator(`[data-studio-tool="${key}"]`);
let scope, boardId;
async function snapshot() {
    const [connection, database, schema] = scope.split(':').map(decodeURIComponent);
    const url = new URL('/api.php', base);
    url.search = new URLSearchParams({action: 'studio-board', connection, database, schema, board: boardId});
    const response = await context.request.get(url.href), result = await response.json();
    assert.ok(response.ok() && result.ok, 'Studio snapshot must be available through the authenticated real API.');
    return result.data;
}
async function saved() {
    await page.waitForFunction(() => {
        const text = document.getElementById('studio-save-state')?.textContent;
        return text === 'Opgeslagen' || text === 'Saved';
    });
}
async function edit(text) {
    await page.locator('#studio-edit-text').fill(text);
    await page.locator('#studio-board-title').click();
    await saved();
    await until(async () => (await snapshot()).nodes.some(node => node.text === text), 'Edited note must reach PostgreSQL.');
}
async function moveSelected(key, count = 1) {
    await page.locator('#studio-canvas').focus();
    for (let index = 0; index < count; index++) { await page.keyboard.press(key); await saved(); }
}
async function clickCard(id, corner = 'center') {
    const card = page.locator(`[data-studio-node="${id}"]`);
    if (corner === 'center') await card.click();
    else {
        let bounds;
        await until(async () => { bounds = await card.boundingBox(); return Boolean(bounds); }, 'A card must have a visible position.');
        await page.mouse.click(bounds.x + (corner === 'right' ? bounds.width - 12 : 12), bounds.y + 20);
    }
}

try {
    await page.goto(new URL('/studio.php', base).href);
    await page.locator('#studio-new-board:not([disabled])').waitFor();
    await page.locator('#studio-language').selectOption('nl');
    scope = await page.locator('body').getAttribute('data-studio-scope');
    assert.ok(scope?.startsWith('postgres:'), 'Studio uses explicit PostgreSQL scope.');
    const title = 'Browserproef · ' + new Date().toISOString();
    await page.locator('#studio-new-board').click();
    await page.locator('#studio-board-name').fill(title);
    await page.locator('#studio-create-submit').click();
    await page.waitForFunction(expected => document.getElementById('studio-board-title')?.textContent === expected, title);
    boardId = new URL(page.url()).searchParams.get('board');
    assert.ok(boardId, 'The board URL identifies a durable shared board.');
    await saved();
    assert.equal((await snapshot()).nodes.length, 0, 'A new board contains no invented sample records.');

    await tool('note').click(); await saved();
    const note = (await snapshot()).nodes.find(node => node.kind === 'note');
    assert.ok(note);
    const literal = 'Een afsprakenplatform voor coaches <img src=x onerror="window.studioInjected=1">';
    await edit(literal);
    await page.reload();
    await page.locator(`[data-studio-node="${note.id}"]`).waitFor();
    assert.ok((await page.locator(`[data-studio-node="${note.id}"]`).textContent()).includes(literal));
    assert.equal(await page.locator('#studio-nodes img').count(), 0, 'Note text is never interpreted as HTML.');
    assert.equal(await page.evaluate(() => window.studioInjected), undefined);

    await observer.goto(new URL('/studio.php?board=' + boardId, base).href);
    await observer.locator(`[data-studio-node="${note.id}"]`).waitFor();
    await page.bringToFront();
    await tool('idea').click(); await saved();
    await edit('Agenda en een eigen klantomgeving');
    const idea = (await snapshot()).nodes.find(node => node.kind === 'idea');
    await moveSelected('Shift+ArrowRight', 5);
    await moveSelected('Shift+ArrowDown', 3);
    const movedIdea = (await snapshot()).nodes.find(node => node.id === idea.id);
    assert.ok(movedIdea.x > idea.x && movedIdea.y > idea.y, 'Keyboard movement persists the selected card.');
    await page.locator('#studio-camera-controls button[aria-label="Alles in beeld"]').click();

    await tool('connect').click();
    await clickCard(note.id, 'left'); await clickCard(idea.id, 'right'); await saved();
    await until(async () => (await snapshot()).edges.length === 1, 'Connecting two cards must persist their relationship.');
    const connected = await snapshot();
    assert.equal(connected.edges[0].from_node_id, note.id);
    assert.equal(connected.edges[0].to_node_id, idea.id);

    await tool('screen').click(); await saved();
    await edit('Afsprakenoverzicht');
    await moveSelected('Shift+ArrowLeft', 5);
    await moveSelected('Shift+ArrowDown', 5);
    assert.equal((await snapshot()).nodes.filter(node => node.kind === 'screen').length, 1);
    assert.equal(await page.locator('.studio-screen-field').count(), 2, 'A screen card renders a real wireframe skeleton.');

    await tool('draw').click();
    const canvas = await page.locator('#studio-canvas').boundingBox();
    const x = canvas.x + 125, y = canvas.y + canvas.height - 145;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 35, y - 25, {steps: 5});
    await page.mouse.move(x + 75, y + 15, {steps: 5});
    await page.mouse.move(x + 115, y - 5, {steps: 5}); await page.mouse.up();
    await saved();
    await until(async () => (await snapshot()).nodes.some(node => node.kind === 'stroke'), 'A drawn stroke must reach PostgreSQL.');
    const stroke = (await snapshot()).nodes.find(node => node.kind === 'stroke');
    assert.ok(stroke.data.points.length >= 4, 'Stored pen strokes preserve editable vector points.');
    await tool('undo').click(); await saved();
    await until(async () => !(await snapshot()).nodes.some(node => node.id === stroke.id), 'Undo removes the complete pen gesture.');
    await tool('redo').click(); await saved();
    await until(async () => (await snapshot()).nodes.some(node => node.id === stroke.id), 'Redo restores the complete pen gesture.');
    await tool('select').click();
    await page.reload();
    await page.locator(`[data-studio-node="${stroke.id}"]`).waitFor();
    assert.equal(await page.locator('[data-studio-edge]').count(), 1, 'Links survive a full page reload.');
    assert.equal(await page.locator('[data-kind="screen"]').count(), 1, 'Wireframes survive a full page reload.');

    await observer.bringToFront();
    await until(async () => await observer.locator('[data-studio-node]').count() === 4, 'An independent browser client must receive live additions.');
    assert.equal(await observer.locator('[data-studio-edge]').count(), 1);

    await page.bringToFront();
    const sourceBefore = (await snapshot()).segments.length;
    await page.locator('#studio-microphone:not([disabled])').click();
    await until(async () => (await snapshot()).segments.length > sourceBefore,
        'Fake microphone capture must reach the real multipart API and provider fixture.', 25000);
    await page.locator('#studio-microphone').click();
    await until(async () => (await snapshot()).recordings.every(recording => recording.status === 'stopped'), 'Stop must drain audio and close the recording.', 20000);
    const spoken = await snapshot(), segment = spoken.segments.find(value => value.text);
    assert.ok(segment && segment.node_id, 'A finalised transcript creates a source-linked note.');
    assert.ok(segment.end_ms > segment.start_ms && segment.recording_id, 'Transcripts preserve recording identity and time range.');
    const speechNode = spoken.nodes.find(node => node.id === segment.node_id);
    assert.equal(speechNode.source_segment_id, segment.id);
    assert.equal(speechNode.text, segment.text);
    await page.locator('#studio-camera-controls button[aria-label="Alles in beeld"]').click();
    await clickCard(speechNode.id);
    await edit('Gesproken idee uitgewerkt tot een klantportaal');
    const editedSpeech = await snapshot();
    assert.equal(editedSpeech.segments.find(value => value.id === segment.id).text, segment.text,
        'Editing a spoken card does not rewrite the original transcript.');
    assert.equal(editedSpeech.nodes.find(node => node.id === speechNode.id).source_segment_id, segment.id);
    assert.ok((await page.locator('.studio-source').first().textContent()).includes(segment.text));

    await observer.bringToFront();
    await until(async () => (await observer.locator(`[data-studio-node="${speechNode.id}"]`).count()) === 1,
        'The second client must receive the source-linked voice note.');
    await page.bringToFront();
    await page.locator('#studio-camera-controls button[aria-label="Alles in beeld"]').click();

    // Release a real incoming poll while a different card has an unsaved, focused draft.
    await clickCard(speechNode.id);
    let releasePoll, interceptedPoll, held = false;
    const pollGate = new Promise(resolvePromise => { releasePoll = resolvePromise; });
    const pollIntercepted = new Promise(resolvePromise => { interceptedPoll = resolvePromise; });
    const interceptPoll = async route => {
        if (new URL(route.request().url()).searchParams.get('action') !== 'studio-board' || held) return route.continue();
        held = true; interceptedPoll(); await pollGate;
        await route.fulfill({response: await route.fetch()});
    };
    await page.route('**/api.php*', interceptPoll);
    const remoteId = randomUUID(), draft = 'Mijn tekst blijft tijdens het ontvangen van een ander idee';
    try {
        await Promise.race([pollIntercepted, new Promise((_, reject) => setTimeout(() => reject(new Error('The live board must keep polling.')), 5000))]);
        const authResponse = await observerContext.request.get(new URL('/auth-api.php?action=status', base).href);
        const auth = await authResponse.json(), beforeRemote = await snapshot();
        const [connection, database, schema] = scope.split(':').map(decodeURIComponent);
        const remoteUrl = new URL('/api.php', base);
        remoteUrl.search = new URLSearchParams({action: 'studio-mutate', connection, database, schema});
        const remoteResponse = await observerContext.request.post(remoteUrl.href, {
            headers: {'X-CSRF-Token': auth.data.csrf}, data: {board_id: boardId, generation: beforeRemote.generation,
                base_revision: beforeRemote.board.revision, operation_id: randomUUID(), changes: [{type: 'put-node', node: {
                    id: remoteId, kind: 'note', text: 'Een tweede client voegt een onafhankelijk idee toe',
                    x: 800, y: 650, width: 280, height: 180, data: {},
                }}]},
        });
        assert.ok(remoteResponse.ok() && (await remoteResponse.json()).ok, 'The second authenticated client can commit an unrelated card.');
        await page.locator('#studio-edit-text').fill(draft);
        releasePoll();
        await page.locator(`[data-studio-node="${remoteId}"]`).waitFor();
        assert.equal(await page.locator('#studio-edit-text').inputValue(), draft, 'Incoming polling preserves the focused local draft.');
        assert.ok(await page.locator('#studio-edit-text').evaluate(node => document.activeElement === node), 'Polling preserves editor focus.');
        await page.locator('#studio-board-title').click(); await saved();
        await until(async () => (await snapshot()).nodes.find(node => node.id === speechNode.id)?.text === draft,
            'A preserved draft remains editable and saves after an unrelated remote revision.');
    } finally {
        releasePoll(); await page.unroute('**/api.php*', interceptPoll);
    }

    // Two real CDP touch pointers must pinch even when the pen tool is active.
    await tool('draw').click();
    const touchSession = await context.newCDPSession(page);
    await touchSession.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 2});
    const touchCanvas = await page.locator('#studio-canvas').boundingBox();
    const touchX = touchCanvas.x + touchCanvas.width * .55, touchY = touchCanvas.y + touchCanvas.height * .55;
    const transformBefore = await page.locator('#studio-world').getAttribute('style');
    const strokesBefore = (await snapshot()).nodes.filter(node => node.kind === 'stroke').length;
    await touchSession.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [
        {id: 1, x: touchX - 30, y: touchY, radiusX: 5, radiusY: 5},
        {id: 2, x: touchX + 30, y: touchY, radiusX: 5, radiusY: 5},
    ]});
    await touchSession.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [
        {id: 1, x: touchX - 60, y: touchY - 10, radiusX: 5, radiusY: 5},
        {id: 2, x: touchX + 80, y: touchY + 10, radiusX: 5, radiusY: 5},
    ]});
    await touchSession.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    assert.notEqual(await page.locator('#studio-world').getAttribute('style'), transformBefore, 'A two-finger pinch changes the camera.');
    await saved();
    assert.equal((await snapshot()).nodes.filter(node => node.kind === 'stroke').length, strokesBefore, 'A pinch never commits an accidental pen stroke.');
    await touchSession.send('Emulation.setTouchEmulationEnabled', {enabled: false});
    await touchSession.detach();
    await tool('select').click();
    await page.locator('#studio-camera-controls button[aria-label="Alles in beeld"]').click();
    await page.screenshot({path: resolve(screenshots, 'studio-desktop.png')});

    for (const language of ['nl', 'en']) {
        await page.locator('#studio-language').selectOption(language);
        for (const width of [320, 375, 768, 1024, 1440]) {
            await page.setViewportSize({width, height: width < 641 ? 850 : 1000});
            if (width <= 900 && await page.locator('#studio-inspector-close').isVisible()) await page.locator('#studio-inspector-close').click();
            await page.waitForTimeout(60);
            const dimensions = await page.evaluate(() => ({page: document.documentElement.scrollWidth, viewport: innerWidth,
                canvas: document.getElementById('studio-canvas').getBoundingClientRect().width}));
            assert.ok(dimensions.page <= dimensions.viewport, `${language} ${width}px must not overflow horizontally.`);
            assert.ok(dimensions.canvas > 160, `${language} ${width}px keeps a usable canvas.`);
            assert.equal(await page.locator('[data-kind="screen"]').count(), 1, 'Language and viewport changes retain saved content.');
            if (language === 'nl' && width === 375) await page.screenshot({path: resolve(screenshots, 'studio-mobile.png')});
        }
    }
    assert.deepEqual(errors, [], 'Both real clients must finish without JavaScript errors.');
    assert.deepEqual(failedApi, [], 'The complete user flow must finish without failed Studio API calls.');
    console.log('PASS: Studio real UI/API/PostgreSQL, two clients, preserved focused drafts during live polling, two-finger pinch without pen artifacts, notes, source text, screen/edge/stroke persistence, undo/redo, keyboard, synthetic microphone and NL/EN responsive layouts.');
    console.log('Screenshots: ' + resolve(screenshots, 'studio-desktop.png') + ', ' + resolve(screenshots, 'studio-mobile.png'));
} catch (error) {
    console.error('Studio smoke diagnostic:', {errors, failedApi, url: page.url(),
        notice: await page.locator('#studio-notice').textContent().catch(() => ''),
        voice: await page.locator('#studio-voice-status').textContent().catch(() => ''),
        save: await page.locator('#studio-save-state').textContent().catch(() => '')});
    await page.screenshot({path: resolve(screenshots, 'studio-failure.png')}).catch(() => {});
    throw error;
} finally {
    await context.close(); await observerContext.close(); await browser.close();
}
