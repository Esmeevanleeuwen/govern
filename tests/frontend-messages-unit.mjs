/** Keep every literal frontend/shell translation key complete in Dutch and English. */
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {t, setLanguage, hasMessage} from '../app/public/assets/i18n.js';

const assets = fileURLToPath(new URL('../app/public/assets/', import.meta.url));
const files = await readdir(assets);
const messages = {nl: Object.create(null), en: Object.create(null)};
const registerMessages = (namespace, translations) => {
    assert.deepEqual(Object.keys(translations.nl).sort(), Object.keys(translations.en).sort(),
        namespace + ' must provide the same Dutch and English keys');
    for (const language of ['nl', 'en']) {
        for (const [localKey, value] of Object.entries(translations[language])) {
            const key = namespace + '.' + localKey;
            assert.equal(typeof value, 'string', key + ' must be a complete sentence or label');
            assert.ok(value.trim().length, key + ' must not be empty');
            assert.equal(Object.hasOwn(messages[language], key), false, 'Duplicate message key: ' + key);
            messages[language][key] = value;
        }
    }
};

for (const file of files.filter(name => name.endsWith('-messages.js'))) {
    const source = await readFile(path.join(assets, file), 'utf8');
    // Message modules only register dictionaries; executing with this stub reveals all namespaces.
    vm.runInNewContext(source.replace(/^import .*?;\s*$/gm, ''), {registerMessages}, {filename: file});
    await import(pathToFileURL(path.join(assets, file)).href);
}

const placeholders = text => [...new Set([...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match => match[1]))].sort();
for (const key of Object.keys(messages.nl)) {
    assert.deepEqual(placeholders(messages.nl[key]), placeholders(messages.en[key]),
        key + ' must interpolate the same data in both languages');
}

const usedKeys = new Set();
for (const file of files.filter(name => name.endsWith('.js') && !name.endsWith('-messages.js'))) {
    const source = await readFile(path.join(assets, file), 'utf8');
    // Includes t() arguments, route label keys, operator keys and client error keys.
    for (const match of source.matchAll(/['"]((?:app|ui|api|builder|modal)\.[A-Za-z0-9_.]+)['"]/g)) {
        if (!match[1].endsWith('.')) usedKeys.add(match[1]);
    }
}
const shell = await readFile(new URL('../app/public/index.php', import.meta.url), 'utf8');
for (const match of shell.matchAll(/data-i18n(?:-aria|-title|-content)?="([^"]+)"/g)) usedKeys.add(match[1]);

for (const language of ['nl', 'en']) {
    setLanguage(language);
    for (const key of usedKeys) {
        assert.ok(Object.hasOwn(messages[language], key), language + ' is missing ' + key);
        assert.equal(hasMessage(key), true, key + ' was not registered by its message module');
        assert.notEqual(t(key), key, key + ' leaked into the rendered interface');
    }
}

setLanguage('en');
assert.equal(t('app.core.data.range', {start: '1', end: '25', total: '100'}), '1–25 of 100 rows');
assert.equal(t('app.core.research.removeLabel', {name: '<exact saved name>'}), 'Delete research <exact saved name>');
setLanguage('nl');
assert.equal(t('app.core.research.run'), 'Query uitvoeren');

console.log(`PASS: ${Object.keys(messages.nl).length} bilingual messages, ${usedKeys.size} frontend/shell keys and interpolation parity.`);
