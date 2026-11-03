import {t, getLanguage, hasMessage} from './i18n.js';
import './ui-messages.js';
import {accountRequest} from './session.js';

let token = '';
let database = '';

/** Selection belongs to this browser tab; the server receives it on every request. */
export function setDatabase(value) { database = typeof value === 'string' ? value : ''; }
export function getDatabase() { return database; }

/** A workspace key also identifies the PostgreSQL schema; names stay unmodified. */
export function databaseScope(value = database) {
    if (typeof value !== 'string') throw translatedError('api.failed');
    if (!value.startsWith('postgres:')) return {database: value};
    const parts = value.split(':');
    if (parts.length !== 3) throw translatedError('api.failed');
    let name;
    let schema;
    try { name = decodeURIComponent(parts[1]); schema = decodeURIComponent(parts[2]); }
    catch { throw translatedError('api.failed'); }
    if (!name || !schema || /[\u0000-\u001f\u007f]/u.test(name + schema)) throw translatedError('api.failed');
    return {connection: 'postgres', database: name, schema};
}

export function setCsrf(value) {
    token = value || '';
}

export function endpoint(action, params = {}) {
    const url = new URL('/api.php', window.location.origin);
    url.searchParams.set('action', action);
    // Resolve the captured workspace, rather than whichever connection is now active.
    const {database: selected = database, connection, schema, ...rest} = params;
    const scope = databaseScope(selected);
    if (connection !== undefined && connection !== '' && connection !== (scope.connection || 'mariadb')
        || schema !== undefined && schema !== '' && schema !== scope.schema) throw translatedError('api.failed');
    for (const [key, value] of Object.entries({...scope, ...rest})) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    return url.pathname + url.search;
}

export async function request(action, {params, body, signal} = {}) {
    const url = endpoint(action, params);
    // After signing in again, obtain the rotated token before the user's next
    // explicit write. Never replay a database mutation automatically.
    if (body !== undefined && !token) {
        const session = await accountRequest('status');
        token = session.csrf;
    }
    const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
    let response;
    try {
        response = await fetch(url, {
            method: body === undefined ? 'GET' : 'POST',
            headers: body === undefined ? {'Accept': 'application/json', 'Accept-Language': getLanguage()} : {
                'Accept': 'application/json', 'Accept-Language': getLanguage(), ...(multipart ? {} : {'Content-Type': 'application/json'}), 'X-CSRF-Token': token,
            },
            credentials: 'same-origin',
            signal,
            ...(body === undefined ? {} : {body: multipart ? body : JSON.stringify(body)}),
        });
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw translatedError('api.unreachable');
    }
    let payload;
    try {
        payload = await response.json();
    } catch {
        throw translatedError('api.unreadable');
    }
    if (!response.ok || !payload.ok) {
        if (response.status === 401 || payload.error_code === 'csrf_invalid') token = '';
        if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('govern:authrequired'));
        const key = payload.error_code ? 'error.' + payload.error_code : null;
        const error = translatedError(key, payload.error_params, payload.error_i18n?.[getLanguage()] || payload.error);
        error.status = response.status;
        error.error_code = payload.error_code;
        error.error_params = payload.error_params || {};
        error.error_i18n = payload.error_i18n || null;
        throw error;
    }
    return payload.data;
}

function translatedError(key, params = {}, fallback) {
    const error = new Error(hasMessage(key) ? t(key, params) : (fallback || t('api.failed')));
    error.translationKey = key;
    error.error_params = params || {};
    return error;
}
