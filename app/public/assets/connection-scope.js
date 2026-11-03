import {t} from './i18n.js';
import './ui-messages.js';

function invalidScope() {
    const error = new Error(t('api.failed'));
    error.translationKey = 'api.failed';
    error.error_params = {};
    return error;
}

/** Decode an explicit source without depending on a cached request module or active selection. */
export function parseConnectionScope(value) {
    if (typeof value !== 'string') throw invalidScope();
    if (!value.startsWith('postgres:')) return {database: value};
    const parts = value.split(':');
    if (parts.length !== 3) throw invalidScope();
    let name;
    let schema;
    try { name = decodeURIComponent(parts[1]); schema = decodeURIComponent(parts[2]); }
    catch { throw invalidScope(); }
    if (!name || !schema || /[\u0000-\u001f\u007f]/u.test(name + schema)) throw invalidScope();
    return {connection: 'postgres', database: name, schema};
}
