/** Real account login for browser tests against an explicitly isolated stack.
 * Set GOVERN_TEST_EMAIL and GOVERN_TEST_PASSWORD; initialize that account with
 * python3 tests/auth_http.py --initialize before running the browser suites.
 */
import assert from 'node:assert/strict';
import {readFile, writeFile, chmod} from 'node:fs/promises';

async function authenticate(context, base) {
    const origin = new URL(base);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Authentication tests require a local test stack.');
    const email = process.env.GOVERN_TEST_EMAIL;
    const password = process.env.GOVERN_TEST_PASSWORD;
    assert.ok(email && password, 'Set dedicated GOVERN_TEST_EMAIL and GOVERN_TEST_PASSWORD for this isolated stack.');
    const endpoint = new URL('/auth-api.php', origin);
    endpoint.searchParams.set('action', 'status');
    const statusResponse = await context.request.get(endpoint.href);
    const status = await statusResponse.json();
    assert.ok(statusResponse.ok() && status.ok, 'The authentication status endpoint must be available.');
    // A still-approved cached test session uses the same real status check as a reload.
    if (status.data.user?.email === email && status.data.user?.status === 'active') return;
    endpoint.searchParams.set('action', 'login');
    const response = await context.request.post(endpoint.href, {
        headers: {'X-CSRF-Token': status.data.csrf}, data: {email, password},
    });
    const result = await response.json();
    assert.ok(response.ok() && result.ok && result.data.user?.status === 'active',
        'The dedicated test account must be approved. Initialize it with tests/auth_http.py --initialize.');
}

export async function authenticatedContext(browser, base, options = {}) {
    const cache = process.env.GOVERN_TEST_STORAGE_STATE;
    let storageState;
    if (cache && !options.storageState) {
        try { storageState = JSON.parse(await readFile(cache, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const context = await browser.newContext({...(storageState ? {storageState} : {}), ...options});
    try {
        await authenticate(context, base);
        if (cache) {
            await writeFile(cache, JSON.stringify(await context.storageState()), {mode: 0o600});
            await chmod(cache, 0o600);
        }
        return context;
    } catch (error) {
        await context.close();
        throw error;
    }
}

export async function authenticatedPage(browser, base, options = {}) {
    const page = await browser.newPage(options);
    try {
        await authenticate(page.context(), base);
        return page;
    } catch (error) {
        await page.close();
        throw error;
    }
}
