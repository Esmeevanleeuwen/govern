/** Browser-only appearance preferences. Database records and dashboard layout use separate storage. */
export const PREFERENCES_STORAGE_KEY = 'govern.preferences.v1';
const VERSION = 1;
const fields = ['language', 'accent', 'backgroundTint', 'theme', 'reduceTransparency', 'sidebar'];
const listeners = new Set();

function media(query) {
    try { return globalThis.matchMedia?.(query) || null; } catch { return null; }
}

const darkMedia = media('(prefers-color-scheme: dark)');
const transparencyMedia = media('(prefers-reduced-transparency: reduce)');

function browserLanguage() {
    const languages = globalThis.navigator?.languages || [globalThis.navigator?.language];
    for (const language of languages) {
        const short = String(language || '').toLowerCase().split('-')[0];
        if (short === 'nl' || short === 'en') return short;
    }
    return 'nl';
}

function defaults() {
    return {
        language: browserLanguage(), accent: '#0b7476', backgroundTint: '#85a7a0',
        theme: 'light', reduceTransparency: Boolean(transparencyMedia?.matches), sidebar: 'left',
    };
}

/** Invalid individual values retain their own fallback without resetting other preferences. */
export function normalizePreferences(value, fallback = defaults()) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const normalized = {...fallback};
    if (['nl', 'en'].includes(source.language)) normalized.language = source.language;
    if (typeof source.accent === 'string' && /^#[0-9a-f]{6}$/i.test(source.accent)) normalized.accent = source.accent.toLowerCase();
    if (typeof source.backgroundTint === 'string' && /^#[0-9a-f]{6}$/i.test(source.backgroundTint)) normalized.backgroundTint = source.backgroundTint.toLowerCase();
    if (['light', 'dark', 'system'].includes(source.theme)) normalized.theme = source.theme;
    if (typeof source.reduceTransparency === 'boolean') normalized.reduceTransparency = source.reduceTransparency;
    if (['left', 'right'].includes(source.sidebar)) normalized.sidebar = source.sidebar;
    return normalized;
}

function getStorage() {
    try { return globalThis.localStorage || null; } catch { return null; }
}

function decode(raw) {
    if (!raw) return {envelope: {}, preferences: defaults(), writable: true};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid preferences');
        // Older unversioned preferences can migrate on the next deliberate save. Never downgrade a future version.
        const source = parsed.preferences && typeof parsed.preferences === 'object' ? parsed.preferences : parsed;
        return {
            envelope: parsed, preferences: normalizePreferences(source),
            writable: parsed.version === undefined || parsed.version === 0 || parsed.version === VERSION,
        };
    } catch {
        return {envelope: {}, preferences: defaults(), writable: true};
    }
}

let initialRaw = null;
try { initialRaw = getStorage()?.getItem(PREFERENCES_STORAGE_KEY) || null; } catch { /* Session defaults remain usable. */ }
let {envelope, preferences, writable} = decode(initialRaw);
let transparencyExplicit = typeof (envelope.preferences || envelope).reduceTransparency === 'boolean';

export function getPreferences() { return {...preferences}; }

function channel(value) {
    const n = value / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

function rgb(hex) { return hex.slice(1).match(/../g).map(value => parseInt(value, 16)); }

export function colorContrast(first, second) {
    const luminance = hex => rgb(hex).reduce((sum, value, i) => sum + channel(value) * [0.2126, 0.7152, 0.0722][i], 0);
    const a = luminance(first), b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function mix(first, second, amount) {
    const other = rgb(second);
    return '#' + rgb(first).map((value, i) => Math.round(value * (1 - amount) + other[i] * amount).toString(16).padStart(2, '0')).join('');
}

function readableAccent(accent, dark) {
    // Use the least favourable reading surface, not only the solid fallback panel.
    const background = dark ? '#43545f' : '#c6d0cc';
    const end = dark ? '#ffffff' : '#000000';
    for (let step = 0; step <= 20; step += 1) {
        const candidate = mix(accent, end, step / 20);
        if (colorContrast(candidate, background) >= 4.5) return candidate;
    }
    return end;
}

/** Apply only shared tokens; CSS composes the canvas tint and supplies material/theme surfaces. */
export function applyAppearance() {
    const root = globalThis.document?.documentElement;
    if (!root) return;
    const dark = preferences.theme === 'dark' || (preferences.theme === 'system' && Boolean(darkMedia?.matches));
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.reduceTransparency = String(preferences.reduceTransparency);
    root.dataset.sidebar = preferences.sidebar;
    const accent = preferences.accent;
    const onAccent = colorContrast(accent, '#ffffff') >= colorContrast(accent, '#000000') ? '#ffffff' : '#000000';
    const tokens = {
        '--g-accent': accent, '--g-on-accent': onAccent,
        '--g-accent-text': readableAccent(accent, dark),
        '--g-soft': accent + (dark ? '25' : '10'), '--g-glow': accent + (dark ? '38' : '29'),
        '--g-background-tint': preferences.backgroundTint,
    };
    for (const [key, value] of Object.entries(tokens)) root.style.setProperty(key, value);
}

function notify(metadata) {
    const snapshot = getPreferences();
    for (const callback of listeners) callback(snapshot, metadata);
}

function persistPreferences() {
    const storage = getStorage();
    if (!storage || !writable) return false;
    try {
        // Preserve unknown fields in a supported envelope for additive upgrades.
        const previous = envelope.preferences && typeof envelope.preferences === 'object' ? envelope.preferences : {};
        const next = {...envelope, version: VERSION, preferences: {...previous, ...preferences}};
        storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(next));
        envelope = next;
        return true;
    } catch { return false; }
}

/** persist:false previews in this session. Its saved:false result is not a failed attempted write. */
export function updatePreferences(patch, {persist = true} = {}) {
    const before = preferences;
    preferences = normalizePreferences(patch, preferences);
    if (patch && typeof patch.reduceTransparency === 'boolean') transparencyExplicit = true;
    applyAppearance();
    const saved = persist ? persistPreferences() : false;
    const changed = fields.filter(key => before[key] !== preferences[key]);
    notify({reason: 'update', changed, saved, persisted: persist});
    return {saved, preferences: getPreferences()};
}

/** Appearance reset deliberately retains language, sidebar placement and every separate storage key. */
export function resetAppearance() {
    const baseline = defaults();
    return updatePreferences({
        accent: baseline.accent, backgroundTint: baseline.backgroundTint,
        theme: baseline.theme, reduceTransparency: baseline.reduceTransparency,
    });
}

export function subscribePreferences(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

function listen(target, callback) {
    if (target?.addEventListener) target.addEventListener('change', callback);
    else target?.addListener?.(callback);
}

listen(darkMedia, () => {
    if (preferences.theme !== 'system') return;
    applyAppearance();
    notify({reason: 'system', changed: [], saved: false, persisted: false});
});

listen(transparencyMedia, event => {
    if (transparencyExplicit) return;
    preferences = {...preferences, reduceTransparency: Boolean(event.matches)};
    applyAppearance();
    notify({reason: 'system', changed: ['reduceTransparency'], saved: false, persisted: false});
});

globalThis.addEventListener?.('storage', event => {
    if (event.key !== PREFERENCES_STORAGE_KEY && event.key !== null) return;
    if (event.storageArea && event.storageArea !== getStorage()) return;
    if (event.newValue) {
        try { JSON.parse(event.newValue); } catch { return; }
    }
    const incoming = decode(event.key === null ? null : event.newValue);
    envelope = incoming.envelope;
    writable = incoming.writable;
    if (!incoming.writable) return;
    const before = preferences;
    preferences = incoming.preferences;
    transparencyExplicit = typeof (envelope.preferences || envelope).reduceTransparency === 'boolean';
    applyAppearance();
    notify({reason: 'storage', changed: fields.filter(key => before[key] !== preferences[key]), saved: true, persisted: true});
});

applyAppearance();
