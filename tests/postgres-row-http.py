#!/usr/bin/env python3
"""Authenticated row CRUD against isolated govern_pg fixtures, preserving seeded rows."""
import argparse
import http.cookiejar
import json
import urllib.error
import urllib.parse
import urllib.request
import uuid
from auth_http import ensure_authenticated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:8080')
    parser.add_argument('--confirm-database', required=True)
    args = parser.parse_args()
    if args.confirm_database != 'govern_pg':
        raise RuntimeError('Only isolated govern_pg is supported')
    base = args.base_url.rstrip('/')
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    ensure_authenticated(client, base)
    scope = {'connection': 'postgres', 'database': 'govern_pg', 'schema': 'public'}
    csrf, key, checks = '', None, 0
    table = 'govern_pg_edit'

    def check(condition, message):
        nonlocal checks
        if not condition:
            raise AssertionError(message)
        checks += 1

    def request(action, payload=None, parameters=None, *, token=True, guest=False):
        query = {'action': action, **scope, **(parameters or {})}
        headers = {'Accept': 'application/json', 'Accept-Language': 'en'}
        body = None
        if payload is not None:
            body = json.dumps(payload).encode()
            headers['Content-Type'] = 'application/json'
            if token:
                headers['X-CSRF-Token'] = csrf
        req = urllib.request.Request(base + '/api.php?' + urllib.parse.urlencode(query), data=body, headers=headers)
        opener = urllib.request.build_opener() if guest else client
        try:
            response = opener.open(req, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    def describe(row_key, schema='public'):
        status, result = request('row-editor', parameters={'table': table, 'key': json.dumps(row_key), 'schema': schema})
        check(status == 200 and result['ok'], 'Read exact authenticated row')
        return result['data']

    val = lambda text: {'mode': 'value', 'value': text}
    status, result = request('bootstrap')
    check(status == 200 and result['data']['capabilities']['write'], 'Configured row editing advertised')
    check(not result['data']['capabilities']['query'] and not result['data']['capabilities']['phpmyadmin'],
          'SQL and phpMyAdmin remain unavailable for PostgreSQL')
    csrf = result['data']['csrf']
    values = {'label': val('HTTP exact ' + uuid.uuid4().hex), 'amount': val('123456789012345678901234.15'),
              'nullable_text': {'mode': 'null'}, 'payload': val('00ff41'), 'default_text': {'mode': 'default'}}
    for action in ['insert-row', 'update-row', 'delete-row']:
        status, result = request(action, {'table': table, 'values': values}, token=False)
        check(status == 403 and result.get('error_code') == 'csrf_invalid', 'CSRF precedes ' + action)
        status, result = request(action, {'table': table, 'values': values}, guest=True)
        check(status == 401 and result.get('error_code') == 'auth_required', 'Guests cannot call ' + action)
    status, result = request('row-editor', parameters={'table': table}, guest=True)
    check(status == 401, 'Guests cannot read editor descriptors')
    status, result = request('insert-row', {'table': table, 'values': values}, {'schema': 'pg_catalog'})
    check(status == 403 and result.get('error_code') == 'database_not_available', 'Unconfigured schema rejects writes')
    try:
        status, result = request('insert-row', {'table': table, 'values': values})
        check(status == 201 and result['ok'] and result['data']['affected_rows'] == 1, 'Insert persists one row')
        key = result['data']['key']
        exact = describe(key)
        check(isinstance(key['id'], str) and exact['row']['amount'] == '123456789012345678901234.15',
              'Identity and numeric values remain exact JSON strings')
        check(exact['row']['nullable_text'] is None and exact['row']['payload'] == '00ff41'
              and exact['row']['default_text'] == 'server default', 'NULL, bytea and defaults survive HTTP')
        check(exact['row']['generated_label'] == values['label']['value'] + '!', 'Generated value is reread')
        status, result = request('update-row', {'table': table, 'key': key, 'version': exact['version'],
                                             'values': {'nullable_text': val(''), 'default_text': val('changed')}})
        check(status == 200 and result['ok'], 'Update persists through row API')
        changed = describe(key)
        check(changed['row']['nullable_text'] == '' and changed['row']['default_text'] == 'changed', 'Empty text differs from NULL')
        for action, extra in [('update-row', {'values': {'label': val('stale overwrite')}}), ('delete-row', {})]:
            status, result = request(action, {'table': table, 'key': key, 'version': exact['version'], **extra})
            check(status == 409 and result.get('error_code') == 'row_stale', 'Reject stale ' + action)
            check(set(result.get('error_i18n', {})) == {'nl', 'en'}, 'Conflict errors remain bilingual')
        status, result = request('update-row', {'table': table, 'key': {'id': '1'}, 'version': changed['version'],
                                             'values': {'label': val('scope replay')}}, {'schema': 'archive'})
        check(status == 409 and result.get('error_code') == 'row_stale', 'Versions cannot cross schemas')
        check(describe({'id': '1'}, 'archive')['row']['label'] == 'Archive row', 'Archive seed unchanged')
        status, result = request('update-row', {'table': table, 'key': key, 'version': changed['version'],
                                             'values': {'default_text': {'mode': 'default'}, 'nullable_text': {'mode': 'null'}}})
        check(status == 200 and result['ok'], 'Update applies native DEFAULT and NULL')
        current = describe(key)
        check(current['row']['default_text'] == 'server default' and current['row']['nullable_text'] is None,
              'Update defaults are evaluated by PostgreSQL')
        status, result = request('delete-row', {'table': table, 'key': key, 'version': current['version']})
        check(status == 200 and result['data']['affected_rows'] == 1, 'Delete removes current selected row')
        status, result = request('row-editor', parameters={'table': table, 'key': json.dumps(key)})
        check(status == 404 and result.get('error_code') == 'row_missing', 'Deleted row cannot be reread')
        key = None
    finally:
        if key is not None:
            status, result = request('row-editor', parameters={'table': table, 'key': json.dumps(key)})
            if status == 200:
                request('delete-row', {'table': table, 'key': key, 'version': result['data']['version']})
    print(f'PASS: {checks} PostgreSQL row HTTP, exact CRUD, auth, CSRF and scope checks.')


if __name__ == '__main__':
    main()
