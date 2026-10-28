const messages = {nl: Object.create(null), en: Object.create(null)};
const supported = new Set(['nl', 'en']);
const browserLanguages = typeof navigator === 'undefined' ? [] : (navigator.languages || [navigator.language]);
let language = browserLanguages.map(value => String(value).toLowerCase().split('-')[0]).find(value => supported.has(value)) || 'nl';

/** Register stable keys; feature modules own their own small dictionaries. */
export function registerMessages(namespace, translations) {
    for (const locale of supported) {
        for (const [key, value] of Object.entries(translations[locale] || {})) {
            messages[locale][namespace + '.' + key] = value;
        }
    }
}

export function hasMessage(key) {
    return Object.hasOwn(messages[language], key) || Object.hasOwn(messages.nl, key);
}

export function t(key, params = {}) {
    const value = messages[language][key] ?? messages.nl[key] ?? key;
    const text = typeof value === 'function' ? value(params) : value;
    return String(text).replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name) =>
        Object.hasOwn(params, name) ? String(params[name]) : placeholder);
}

export function getLanguage() { return language; }
export function getLocale() { return language === 'nl' ? 'nl-NL' : 'en-GB'; }

export function setLanguage(value) {
    if (!supported.has(value)) return false;
    if (typeof document !== 'undefined') document.documentElement.lang = value;
    if (value === language) return false;
    language = value;
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('govern:languagechange', {detail: {language}}));
    return true;
}

if (typeof document !== 'undefined') document.documentElement.lang = language;
