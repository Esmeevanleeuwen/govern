import {t, getLanguage, hasMessage} from './i18n.js';
import './ui-messages.js';

let token = '';

export function setCsrf(value) {
    token = value || '';
}

export function endpoint(action, params = {}) {
    const url = new URL('/api.php', window.location.origin);
    url.searchParams.set('action', action);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    return url.pathname + url.search;
}

export async function request(action, {params, body, signal} = {}) {
    let response;
    try {
        response = await fetch(endpoint(action, params), {
            method: body === undefined ? 'GET' : 'POST',
            headers: body === undefined ? {'Accept': 'application/json', 'Accept-Language': getLanguage()} : {
                'Accept': 'application/json', 'Accept-Language': getLanguage(), 'Content-Type': 'application/json', 'X-CSRF-Token': token,
            },
            credentials: 'same-origin',
            signal,
            ...(body === undefined ? {} : {body: JSON.stringify(body)}),
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
        const key = payload.error_code ? 'error.' + payload.error_code : null;
        const error = translatedError(key, payload.error_params, payload.error_i18n?.[getLanguage()] || payload.error);
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
