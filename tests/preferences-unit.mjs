import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../app/public/assets/preferences.js', import.meta.url), 'utf8');
const key = 'govern.preferences.v1';
let sequence = 0;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

async function environment({stored = null, language = 'en-GB', dark = false, reduced = false, unavailable = false} = {}) {
    const values = new Map([['unrelated', 'keep'], ['govern.dashboard.v1', '{"keep":"layout"}']]);
    if (stored !== null) values.set(key, JSON.stringify(stored));
    const callbacks = new Map(), media = new Map(), style = new Map();
    for (const [name, matches] of [['(prefers-color-scheme: dark)', dark], ['(prefers-reduced-transparency: reduce)', reduced]]) {
        const listeners = [];
        media.set(name, {matches, addEventListener(_, callback) { listeners.push(callback); }, emit(value) { this.matches = value; for (const callback of listeners) callback({matches: value}); }});
    }
    Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {language, languages: [language]}});
    globalThis.document = {documentElement: {dataset: {}, style: {setProperty(name, value) { style.set(name, value); }}}};
    globalThis.localStorage = {
        getItem(name) { if (unavailable) throw new Error('Storage unavailable'); return values.get(name) || null; },
        setItem(name, value) { if (unavailable) throw new Error('Storage unavailable'); values.set(name, value); },
    };
    globalThis.matchMedia = query => media.get(query);
    globalThis.addEventListener = (event, callback) => callbacks.set(event, callback);
    const module = await import('data:text/javascript;base64,' + Buffer.from(source + '\n// test ' + sequence++).toString('base64'));
    return {module, values, style, media, root: document.documentElement, storageEvent: event => callbacks.get('storage')?.(event)};
}

{
    const e = await environment({language: 'en-US'});
    check(e.module.getPreferences().language === 'en', 'Detect supported browser language');
    check(!e.values.has(key), 'Do not persist defaults merely by loading');
    const preview = e.module.updatePreferences({accent: '#ABCDEF'}, {persist: false});
    check(!preview.saved && !e.values.has(key) && e.module.getPreferences().accent === '#abcdef', 'Live preview stays session-only');
    const saved = e.module.updatePreferences({accent: '#abcdef'});
    check(saved.saved && JSON.parse(e.values.get(key)).preferences.accent === '#abcdef', 'Persist the final preview even when its value is unchanged');
    check(e.values.get('unrelated') === 'keep', 'Leave unrelated storage alone');
}
{
    const e = await environment({stored: {version: 1, other: {keep: 42}, preferences: {language: 'en', accent: 'bad', backgroundTint: '#f1C2d3', theme: 'dark', reduceTransparency: true, sidebar: 'right', futureOption: 'keep'}}});
    const p = e.module.getPreferences();
    check(p.language === 'en' && p.theme === 'dark' && p.accent === '#0b7476' && p.backgroundTint === '#f1c2d3', 'Invalid fields fall back individually');
    e.module.resetAppearance();
    const stored = JSON.parse(e.values.get(key));
    check(stored.preferences.language === 'en' && stored.preferences.sidebar === 'right', 'Reset preserves language and sidebar placement');
    check(stored.other.keep === 42 && stored.preferences.futureOption === 'keep', 'Preserve additive unknown preference fields');
    check(e.values.get('govern.dashboard.v1') === '{"keep":"layout"}', 'Reset does not clear dashboard layout');
}
{
    const e = await environment({language: 'de-DE', reduced: true, unavailable: true});
    check(e.module.getPreferences().language === 'nl' && e.module.getPreferences().reduceTransparency, 'Fallback language and OS transparency preference');
    const result = e.module.updatePreferences({theme: 'dark', accent: '#ffffff'});
    check(!result.saved && result.preferences.theme === 'dark' && e.root.dataset.theme === 'dark', 'Failed persistence retains session changes without claiming success');
}
{
    const e = await environment();
    e.module.updatePreferences({theme: 'system'});
    e.media.get('(prefers-color-scheme: dark)').emit(true);
    check(e.root.dataset.theme === 'dark', 'System theme reacts to OS changes');
    let notification;
    const unsubscribe = e.module.subscribePreferences((value, metadata) => { notification = {value, metadata}; });
    e.storageEvent({key, newValue: JSON.stringify({version: 1, preferences: {language: 'nl', accent: '#ffcc00', theme: 'light'}}), storageArea: globalThis.localStorage});
    check(e.module.getPreferences().language === 'nl' && notification.metadata.reason === 'storage', 'Apply other-tab updates');
    const before = e.module.getPreferences();
    e.storageEvent({key, newValue: '{bad', storageArea: globalThis.localStorage});
    assert.deepEqual(e.module.getPreferences(), before); checks += 1;
    unsubscribe();
}
{
    const e = await environment({stored: {version: 99, preferences: {accent: '#123456'}, futureData: 'retain'}});
    check(!e.module.updatePreferences({language: 'en'}).saved && JSON.parse(e.values.get(key)).version === 99, 'Do not overwrite a future preference schema');
}
{
    const e = await environment();
    for (const theme of ['light', 'dark']) {
        e.module.updatePreferences({theme});
        for (const accent of ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#777777', '#ffff00', '#0b7476']) {
            e.module.updatePreferences({accent});
            check(e.module.colorContrast(accent, e.style.get('--g-on-accent')) >= 4.5, 'Readable button foreground for ' + accent);
            check(e.module.colorContrast(e.style.get('--g-accent-text'), theme === 'dark' ? '#3b4b56' : '#dce5e2') >= 4.5, 'Readable accent text for ' + accent);
        }
    }
}
console.log(`${checks} preference checks passed.`);
