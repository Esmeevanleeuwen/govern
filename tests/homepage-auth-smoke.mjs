/**
 * Real public homepage and account flow against an isolated local Docker stack.
 * Initialize a dedicated owner with tests/auth_http.py --initialize first.
 * Requires GOVERN_TEST_EMAIL/PASSWORD; creates one unique fictional member.
 * No database records are read or changed by this suite.
 *
 * Optional: PLAYWRIGHT_MODULE, BROWSER_BIN, BROWSER_ARGS_JSON, SCREENSHOTS_DIR.
 * node tests/homepage-auth-smoke.mjs
 */
import assert from 'node:assert/strict';
import {randomUUID, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {authenticatedContext} from './auth-session.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use an isolated local test stack.');
assert.ok(process.env.GOVERN_TEST_EMAIL && process.env.GOVERN_TEST_PASSWORD,
    'Initialize a dedicated test owner and set GOVERN_TEST_EMAIL/GOVERN_TEST_PASSWORD.');
const browserArgs = process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'];
assert.ok(Array.isArray(browserArgs) && browserArgs.every(value => typeof value === 'string'),
    'BROWSER_ARGS_JSON must be an array of strings.');
const screenshots = process.env.SCREENSHOTS_DIR;
if (screenshots) await mkdir(screenshots, {recursive: true});

const browser = await chromium.launch({
    headless: true,
    args: browserArgs,
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {}),
});
const errors = [];
const shot = async (page, name) => {
    if (screenshots) await page.screenshot({path: path.join(screenshots, name + '.png'), fullPage: true});
};
const trackErrors = page => page.on('pageerror', error => errors.push(error.message));
const authResponse = (page, action) => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/auth-api.php' && url.searchParams.get('action') === action;
});
const noOverflow = async (page, label) => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label);
};
const readyForm = async page => {
    await page.waitForFunction(() => document.querySelector('#account-submit')?.disabled === false);
};
const endpoint = action => new URL('/auth-api.php?action=' + action, base).href;

try {
    // Keep public visitors separate from the authenticated owner used for approval.
    const visitor = await browser.newContext({locale: 'en-GB', viewport: {width: 1440, height: 1000}});
    const page = await visitor.newPage();
    trackErrors(page);
    const publicApiRequests = [];
    const trackPublicRequest = request => {
        if (new URL(request.url()).pathname.endsWith('api.php')) publicApiRequests.push(request.url());
    };
    page.on('request', trackPublicRequest);
    await page.goto(new URL('/', base).href, {waitUntil: 'networkidle'});
    assert.deepEqual(await page.locator('#home-title > span').allTextContents(), ['Your data.', 'Your next idea.']);
    assert.equal(await page.locator('.home-schema-card').count(), 4);
    await noOverflow(page, 'The desktop homepage must not overflow the viewport.');
    await shot(page, 'homepage-desktop');

    await page.locator('.home-demo-link').click();
    assert.equal(new URL(page.url()).hash, '#product', 'Try the demo opens the interactive product preview.');
    await page.waitForFunction(() => document.querySelector('#product').getBoundingClientRect().top
        >= document.querySelector('.home-header').getBoundingClientRect().bottom);

    // These are actual public sample controls, not mocked database API responses.
    await page.locator('#home-tab-data').click();
    await page.locator('#home-demo-panel .home-demo-table').waitFor();
    assert.equal(await page.locator('#home-demo-panel tbody tr').count(), 3);
    await page.locator('[data-home-table="orders"]').click();
    assert.equal(await page.locator('#home-demo-panel h3').textContent(), 'orders');
    assert.ok((await page.locator('#home-demo-panel th').allTextContents()).includes('user_id'));
    await page.locator('#home-tab-structure').click();
    assert.deepEqual(await page.locator('#home-demo-panel th').allTextContents(), ['Field', 'Type', 'Key']);
    assert.match(await page.locator('#home-demo-panel').textContent(), /Foreign key/);
    await page.locator('#home-tab-schema').click();
    assert.equal(await page.locator('[data-schema-table="orders"]').getAttribute('data-selected'), 'true');
    await page.locator('#home-tab-schema').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#home-tab-structure').getAttribute('aria-selected'), 'true');

    // The record sample demonstrates actual linked sample values, independently
    // from the schema preview and without requesting private database content.
    await page.locator('#home-tab-explore').click();
    await page.locator('[data-home-record-table="users"][data-home-record-id="1"]').click();
    assert.equal(await page.locator('[data-home-table="users"]').getAttribute('aria-pressed'), 'true');
    await page.locator('.home-record-evidence summary').click();
    assert.match(await page.locator('.home-record-evidence').textContent(), /user_id/);
    assert.match(await page.locator('.home-record-evidence').textContent(), /users\.id/);
    await page.locator('.home-preview-tools summary').click();
    assert.equal(await page.locator('.home-preview-tools').getAttribute('open'), '');
    await page.locator('.home-preview-tools a[href="#guide-windows"]').click();
    assert.equal(new URL(page.url()).hash, '#guide-windows');
    assert.equal(await page.locator('#guide-windows .home-card-details').evaluate(node => node.open), true,
        'Following a feature link opens its full instructions.');
    assert.equal(await page.locator('#guide-windows [data-home-i18n="windowsBody"]').isVisible(), true);
    assert.equal(await page.locator('.home-guide-steps > li').count(), 3);
    assert.equal(await page.locator('.home-guide-grid > article').count(), 6);
    assert.equal(await page.locator('.home-faq details').count(), 3);
    await page.locator('.home-faq details').first().locator('summary').click();
    assert.equal(await page.locator('.home-faq details').first().getAttribute('open'), '');

    await page.locator('[data-home-open="setup"]').first().click();
    const setup = page.locator('#home-setup-dialog');
    await page.locator('#home-setup-dialog[open]').waitFor();
    await page.locator('[data-home-os="windows"]').click();
    assert.match(await page.locator('#home-commands').textContent(), /\.\\start\.cmd$/);
    assert.match(await page.locator('#home-commands').textContent(), /git clone --branch integrate\/all-govern-updates https:\/\/github\.com\/Esmeevanleeuwen\/govern\.git/);
    await page.locator('#home-install-kind').selectOption('existing');
    assert.equal(await page.locator('#home-setup-existing').isVisible(), true);
    assert.match(await page.locator('#home-commands').textContent(), /git fetch origin/);
    assert.match(await page.locator('#home-commands').textContent(), /git switch integrate\/all-govern-updates/);
    assert.match(await page.locator('#home-commands').textContent(), /git pull --ff-only origin integrate\/all-govern-updates/);
    await page.locator('[data-home-os="unix"]').click();
    assert.match(await page.locator('#home-commands').textContent(), /sh start\.sh$/);
    await page.locator('#home-install-kind').selectOption('new');
    assert.equal(await page.locator('#home-setup-existing').isVisible(), false);
    await page.keyboard.press('Escape');
    await setup.waitFor({state: 'hidden'});

    await page.locator('#home-language').selectOption('nl');
    assert.deepEqual(await page.locator('#home-title > span').allTextContents(), ['Jouw data.', 'Jouw volgende idee.']);
    assert.equal(await page.locator('#home-tab-data').textContent(), 'Records');
    for (const width of [320, 768, 1440]) {
        await page.setViewportSize({width, height: width === 320 ? 844 : 1000});
        await noOverflow(page, 'The Dutch homepage must fit at ' + width + 'px.');
    }
    await page.setViewportSize({width: 360, height: 844});
    await page.locator('#home-tab-data').click();
    await page.locator('#home-sample-table').selectOption('products');
    assert.equal(await page.locator('#home-demo-panel h3').textContent(), 'products');
    await noOverflow(page, 'Scrolling the sample data must stay within the mobile preview.');
    await shot(page, 'homepage-mobile-nl');
    await page.locator('#home-language').selectOption('en');
    assert.equal(await page.locator('#home-tab-data').textContent(), 'Records');
    await noOverflow(page, 'The English homepage must fit at 360px.');
    page.off('request', trackPublicRequest);
    assert.deepEqual(publicApiRequests, [], 'The public sample and guide never request private database APIs.');

    // Follow the real call to action, then exercise the form in both layouts.
    await page.locator('.home-hero a[href="/auth.php?mode=register"]').click();
    await page.waitForURL(url => url.pathname === '/auth.php' && url.searchParams.get('mode') === 'register');
    await readyForm(page);
    assert.equal(await page.locator('#tab-register').getAttribute('aria-selected'), 'true');
    await noOverflow(page, 'Registration must fit at 360px.');
    await page.setViewportSize({width: 1440, height: 1000});
    await noOverflow(page, 'Registration must fit at 1440px.');
    await page.locator('#tab-login').click();
    assert.equal(await page.locator('#tab-login').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#confirm-field').isVisible(), false);
    await page.setViewportSize({width: 360, height: 844});
    await noOverflow(page, 'Login must fit at 360px.');
    await page.setViewportSize({width: 1440, height: 1000});
    await noOverflow(page, 'Login must fit at 1440px.');
    await page.locator('#tab-register').click();

    const member = {
        name: 'Homepage smoke member',
        email: 'homepage-smoke-' + randomUUID() + '@example.test',
        password: 'Test-only-' + randomBytes(18).toString('hex'),
    };
    let registerPosts = 0;
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname === '/auth-api.php' && url.searchParams.get('action') === 'register' && request.method() === 'POST') registerPosts++;
    });
    await page.locator('#account-name').fill(member.name);
    await page.locator('#account-email').fill(member.email);
    await page.locator('#account-password').fill(member.password);
    await page.locator('#account-confirm').fill(member.password + '-different');
    await page.locator('#account-submit').click();
    assert.equal(await page.locator('#account-confirm').evaluate(input => input.validity.customError), true,
        'A password mismatch must be caught by the form before a request is sent.');
    assert.equal(registerPosts, 0, 'Mismatched confirmation must not submit a registration.');
    await page.locator('#account-confirm').fill(member.password);
    assert.equal(await page.locator('#account-confirm').evaluate(input => input.validity.customError), false);
    const registration = authResponse(page, 'register');
    await page.locator('#account-submit').click();
    const registrationResponse = await registration;
    assert.equal(registrationResponse.status(), 201);
    const registered = await registrationResponse.json();
    assert.equal(registered.ok, true);
    assert.equal(registered.data.registration, 'pending');
    assert.equal(registered.data.user, null);
    await page.locator('#account-form').waitFor({state: 'hidden'});
    assert.equal(await page.locator('#account-title').textContent(), 'Your request is in.');
    await shot(page, 'registration-pending');

    // A pending registration must not create a logged-in database session.
    const blockedApi = await visitor.request.get(new URL('/api.php?action=bootstrap', base).href);
    assert.equal(blockedApi.status(), 401);
    const pendingStatus = await (await visitor.request.get(endpoint('status'))).json();
    assert.equal(pendingStatus.data.user, null);
    await page.goto(new URL('/auth.php?mode=login', base).href, {waitUntil: 'networkidle'});
    await readyForm(page);
    await page.locator('#account-email').fill(member.email);
    await page.locator('#account-password').fill(member.password);
    const deniedLogin = authResponse(page, 'login');
    await page.locator('#account-submit').click();
    assert.equal((await deniedLogin).status(), 403);
    await page.locator('#account-status[role="alert"]').waitFor();
    assert.equal(new URL(page.url()).pathname, '/auth.php');

    // Approve with the dedicated real owner; do not bypass the server session.
    const owner = await authenticatedContext(browser, base, {locale: 'en-GB'});
    const ownerStatusResponse = await owner.request.get(endpoint('status'));
    const ownerStatus = await ownerStatusResponse.json();
    assert.ok(ownerStatusResponse.ok() && ownerStatus.ok);
    assert.equal(ownerStatus.data.user.role, 'owner', 'GOVERN_TEST_EMAIL must identify the isolated installation owner.');
    const requestsResponse = await owner.request.get(endpoint('requests'));
    const requests = await requestsResponse.json();
    assert.ok(requestsResponse.ok() && requests.ok);
    const request = requests.data.users.find(user => user.email === member.email);
    assert.ok(request, 'The owner must be able to see the new pending request.');
    const approvalResponse = await owner.request.post(endpoint('approve'), {
        headers: {'X-CSRF-Token': ownerStatus.data.csrf}, data: {user_id: request.id},
    });
    const approval = await approvalResponse.json();
    assert.ok(approvalResponse.ok() && approval.ok);
    assert.equal(approval.data.user.status, 'active');

    // The member must now enter and leave through the actual browser forms.
    await readyForm(page);
    const acceptedLogin = authResponse(page, 'login');
    await page.locator('#account-submit').click();
    assert.equal((await acceptedLogin).status(), 200);
    await page.waitForURL(url => url.pathname === '/workspace.php');
    const memberStatus = await (await visitor.request.get(endpoint('status'))).json();
    assert.equal(memberStatus.data.user.email, member.email);
    assert.equal(memberStatus.data.user.role, 'member');
    await page.goto(new URL('/account.php', base).href, {waitUntil: 'networkidle'});
    await page.locator('#account-logout').waitFor();
    assert.equal(await page.locator('#account-role').textContent(), 'Member');
    const logout = authResponse(page, 'logout');
    await page.locator('#account-logout').click();
    assert.equal((await logout).status(), 200);
    await page.waitForURL(url => url.pathname === '/' && !url.search && !url.hash);
    await page.locator('#home-title').waitFor();
    const loggedOut = await (await visitor.request.get(endpoint('status'))).json();
    assert.equal(loggedOut.data.user, null);
    assert.equal((await visitor.request.get(new URL('/api.php?action=bootstrap', base).href)).status(), 401,
        'Logging out must invalidate database access.');
    assert.deepEqual(errors, [], 'The public homepage and account flows must not throw browser errors.');
    console.log('PASS: homepage views, Docker setup, EN/NL, desktop/mobile layouts, real registration, owner approval, member login and logout.');
} finally {
    await browser.close();
}
