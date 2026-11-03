import {getLanguage} from './i18n.js';

let csrf = '';

/** Account requests use server sessions. No credentials are kept in browser storage. */
export async function accountRequest(action, body) {
    if (body !== undefined && !csrf) await accountRequest('status');
    let response;
    try {
        response = await fetch('/auth-api.php?action=' + encodeURIComponent(action), {
            method: body === undefined ? 'GET' : 'POST',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json', 'Accept-Language': getLanguage(),
                ...(body === undefined ? {} : {'Content-Type': 'application/json', 'X-CSRF-Token': csrf}),
            },
            ...(body === undefined ? {} : {body: JSON.stringify(body)}),
            signal: AbortSignal.timeout(20000),
        });
    } catch {
        throw accountError({nl: 'Govern is niet bereikbaar. Probeer opnieuw.', en: 'Govern could not be reached. Try again.'});
    }
    let result;
    try { result = await response.json(); } catch {
        throw accountError({nl: 'Govern gaf geen geldig antwoord. Probeer opnieuw.', en: 'Govern returned an unreadable response. Try again.'});
    }
    if (!response.ok || !result.ok) {
        if (result.error_code === 'csrf_invalid') csrf = '';
        const error = new Error(result.error_i18n?.[getLanguage()] || result.error || 'Account request failed.');
        error.status = response.status;
        error.code = result.error_code;
        error.translations = result.error_i18n;
        throw error;
    }
    if (result.data?.csrf) csrf = result.data.csrf;
    return result.data;
}

function accountError(translations) {
    const error = new Error(translations[getLanguage()]);
    error.translations = translations;
    return error;
}
