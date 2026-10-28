import assert from 'node:assert/strict';

Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {languages: ['fr-FR', 'nl-NL']}});
const changes = [];
globalThis.window = {location: {origin: 'http://localhost:8080'}, dispatchEvent: event => changes.push(event.detail.language)};

const {registerMessages, t, getLanguage, getLocale, setLanguage, hasMessage} = await import('../app/public/assets/i18n.js');
const {request, endpoint, setCsrf} = await import('../app/public/assets/api.js');
const {phpMyAdminUrl} = await import('../app/public/assets/database-modal.js');

assert.equal(getLanguage(), 'nl', 'Choose the first supported browser language');
registerMessages('test', {nl: {greeting: 'Hallo {name}', fallback: 'Nederlandse terugval'}, en: {greeting: 'Hello {name}'}});
assert.equal(t('test.greeting', {name: 'Esmee'}), 'Hallo Esmee');
assert.equal(setLanguage('en'), true);
assert.equal(getLocale(), 'en-GB');
assert.equal(t('test.greeting', {name: '<exact data>'}), 'Hello <exact data>');
assert.equal(t('test.fallback'), 'Nederlandse terugval');
assert.equal(t('test.unknown'), 'test.unknown');
assert.equal(hasMessage('test.unknown'), false);
assert.equal(setLanguage('en'), false);
assert.equal(setLanguage('de'), false);
assert.deepEqual(changes, ['en'], 'Notify only when a supported language changes');

let sent;
globalThis.fetch = async (url, options) => {
    sent = {url, options};
    return {ok: true, json: async () => ({ok: true, data: {rows: [['900719925474099312345']]}})};
};
setCsrf('test-csrf');
const sql = "SELECT 'exact :value & data'";
const data = await request('query', {body: {sql}});
assert.equal(sent.options.headers['Accept-Language'], 'en');
assert.equal(sent.options.headers['X-CSRF-Token'], 'test-csrf');
assert.deepEqual(JSON.parse(sent.options.body), {sql});
assert.equal(data.rows[0][0], '900719925474099312345', 'Do not coerce exact result values');
assert.equal(new URL(endpoint('browse', {table: 'name & `value`'}), window.location.origin).searchParams.get('table'), 'name & `value`');

registerMessages('error', {nl: {test_invalid: 'Kies {column}.'}, en: {test_invalid: 'Choose {column}.'}});
globalThis.fetch = async () => ({ok: false, json: async () => ({ok: false, error: 'Server fallback', error_code: 'test_invalid', error_params: {column: 'name'}})});
await assert.rejects(request('query'), error => error.message === 'Choose name.' && error.error_code === 'test_invalid' && error.error_params.column === 'name');
globalThis.fetch = async () => ({ok: false, json: async () => ({ok: false, error: 'Localized server message', error_code: 'unregistered_code', error_i18n: {nl: 'Serverbericht', en: 'Localized server message'}})});
await assert.rejects(request('query'), error => error.message === 'Localized server message' && error.error_i18n.nl === 'Serverbericht');
setLanguage('nl');
await assert.rejects(request('query'), error => error.message === 'Serverbericht', 'An old-language response uses the current language map.');
setLanguage('en');
globalThis.fetch = async () => ({ok: false, json: async () => ({ok: false, error: 'Legacy server message'})});
await assert.rejects(request('query'), error => error.message === 'Legacy server message');

globalThis.fetch = async () => { throw new TypeError('offline'); };
await assert.rejects(request('bootstrap'), error => error.translationKey === 'api.unreachable' && error.message.startsWith('The workspace'));
const aborted = new DOMException('Cancelled', 'AbortError');
globalThis.fetch = async () => { throw aborted; };
await assert.rejects(request('bootstrap'), error => error === aborted);
globalThis.fetch = async () => ({ok: false, json: async () => { throw new SyntaxError('html'); }});
await assert.rejects(request('bootstrap'), error => error.translationKey === 'api.unreadable');

const pma = new URL(phpMyAdminUrl('database & test', 'table/name', 'sql'), window.location.origin);
assert.equal(pma.searchParams.get('lang'), 'en');
assert.equal(pma.searchParams.get('route'), '/table/sql');
assert.equal(pma.searchParams.get('db'), 'database & test');
assert.equal(pma.searchParams.get('table'), 'table/name');
setLanguage('nl');
assert.equal(getLocale(), 'nl-NL');
assert.equal(new URL(phpMyAdminUrl('db', '', 'browse'), window.location.origin).searchParams.get('lang'), 'nl');
console.log('i18n, localized request failures, exact values and phpMyAdmin language checks passed.');
