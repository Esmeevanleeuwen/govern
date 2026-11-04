/** Exercise the same visible Tools disclosure as a user; never force hidden controls. */
export async function ensureWorkspaceTools(page, selector) {
    const control = page.locator(selector);
    await control.waitFor({state: 'attached'});
    if (!await control.isVisible()) {
        const trigger = page.locator('#workspace-tools-toggle');
        if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
        await control.waitFor({state: 'visible'});
    }
    return control;
}

export async function clickWorkspaceTool(page, selector) {
    const control = await ensureWorkspaceTools(page, selector);
    await control.click();
}

export async function closeWorkspaceTools(page) {
    const trigger = page.locator('#workspace-tools-toggle');
    if (await trigger.getAttribute('aria-expanded') === 'true') {
        await trigger.click();
        await page.locator('#workspace-tools').waitFor({state: 'hidden'});
    }
}

export async function selectWorkspaceLanguage(page, value) {
    const select = await ensureWorkspaceTools(page, '#language-select');
    await select.selectOption(value);
    await page.waitForFunction(language => document.documentElement.lang === language, value);
    await closeWorkspaceTools(page);
}

/** Follow primary tabs and secondary database views through their visible controls. */
export async function clickDatabaseView(page, view) {
    const control = page.locator('[data-database-view="' + view + '"]');
    if (!await control.count()) {
        const databaseArea = page.locator('#navigation [data-area="database"]');
        // The mobile rail is transformed offscreen, so isVisible() alone does
        // not distinguish its inert, closed state from an open drawer.
        if (await page.locator('#sidebar').getAttribute('aria-hidden') === 'true') await page.locator('#menu-toggle').click();
        await databaseArea.click();
    }
    await control.waitFor({state: 'attached'});
    if (!await control.isVisible()) {
        const disclosure = control.locator('xpath=ancestor::details[1]');
        if (await disclosure.count() && !await disclosure.evaluate(node => node.open)) {
            await disclosure.locator('summary').first().click();
        }
    }
    await control.click();
    await page.waitForFunction(expected => location.hash.slice(1).split('?')[0] === expected
        && document.querySelector('[data-database-view="' + expected + '"]')?.getAttribute('aria-current') === 'page', view);
}

export async function clickDatabaseTool(page, name) {
    const control = page.locator('[data-database-tool="' + name + '"]');
    await control.waitFor({state: 'attached'});
    if (!await control.isVisible()) {
        const disclosure = control.locator('xpath=ancestor::details[1]');
        if (await disclosure.count() && !await disclosure.evaluate(node => node.open)) {
            await disclosure.locator('summary').first().click();
        }
    }
    await control.click();
}

export async function openQueryLibrary(page) {
    const library = page.locator('#query-library');
    await library.waitFor({state: 'visible'});
    if (!await library.evaluate(node => node.open)) await library.locator('summary').first().click();
}

export async function openQueryBuilder(page) {
    const builder = page.locator('.query-builder');
    await builder.waitFor({state: 'visible'});
    if (!await builder.evaluate(node => node.open)) await builder.locator('summary').first().click();
}
