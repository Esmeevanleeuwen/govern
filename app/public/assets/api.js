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
            headers: body === undefined ? {'Accept': 'application/json'} : {
                'Accept': 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': token,
            },
            credentials: 'same-origin',
            signal,
            ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        });
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new Error('De werkplek is niet bereikbaar. Controleer of de omgeving nog draait en probeer het opnieuw.');
    }
    let payload;
    try {
        payload = await response.json();
    } catch {
        throw new Error('De server gaf geen leesbaar antwoord. Controleer of de werkplek volledig is gestart.');
    }
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Het verzoek kon niet worden uitgevoerd.');
    return payload.data;
}
