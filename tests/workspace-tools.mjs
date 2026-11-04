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
/** Navigate the visible task → engine → destination wizard. */
export async function openDatabaseTask(page, {task, engine, database, targetMode, name, submit = false}) {
    await clickWorkspaceTool(page, '#manage-databases');
    const dialog = page.locator('#database-manager-dialog[open]');
    await dialog.waitFor({state: 'visible'});
    await dialog.locator('#database-manager-task-' + task).click();
    await dialog.locator('#database-manager-engine-' + engine).click();
    if (targetMode !== undefined) await dialog.locator('#database-manager-target-mode').selectOption(targetMode);
    if (database !== undefined) await dialog.locator('#database-manager-existing').selectOption(database);
    if (name !== undefined) await dialog.locator('#database-manager-name').fill(name);
    if (submit) {
        await dialog.locator('#database-manager-continue').click();
        await dialog.waitFor({state: 'hidden'});
    }
    return dialog;
}
