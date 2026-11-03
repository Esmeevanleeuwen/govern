#!/usr/bin/env python3
"""PostgreSQL tools against the explicitly disposable database. Run after other writers.

The confirmed public-schema restore removes this suite's newly created objects.
"""
import argparse
import hashlib
import http.cookiejar
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from auth_http import ensure_authenticated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:8080')
    parser.add_argument('--confirm-database', required=True, choices=['govern_pg'])
    parser.add_argument('--confirm-schema', required=True, choices=['public'])
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    if urllib.parse.urlparse(base).hostname not in {'127.0.0.1', 'localhost', '::1'}:
        raise RuntimeError('Use only an isolated loopback test installation')
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    ensure_authenticated(client, base)
    scope = {'connection': 'postgres', 'database': args.confirm_database, 'schema': args.confirm_schema}
    checks, csrf = 0, ''
    baseline, restored = None, False
    marker = 'govern_http_tools_' + uuid.uuid4().hex[:14]
    table, imported, absent = marker + '_sql', marker + '_import', marker + '_absent'

    def check(condition, message):
        nonlocal checks
        if not condition:
            raise AssertionError(message)
        checks += 1

    def request(action, payload=None, parameters=None, *, token=True, guest=False, binary=False):
        headers = {'Accept': 'application/json', 'Accept-Language': 'en'}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            headers['Content-Type'] = 'application/json'
            if token:
                headers['X-CSRF-Token'] = csrf
        req = urllib.request.Request(base + '/api.php?' + urllib.parse.urlencode({'action': action, **scope, **(parameters or {})}),
                                     data=data, headers=headers)
        opener = urllib.request.build_opener() if guest else client
        try:
            response = opener.open(req, timeout=600)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            value = raw if binary and response.status < 400 else json.loads(raw)
            return response.status, value, dict(response.headers)

    def api(action, payload=None, parameters=None):
        status, result, _ = request(action, payload, parameters)
        check(200 <= status < 300 and result.get('ok') is True, action + ': ' + json.dumps(result, ensure_ascii=False))
        return result['data']

    def sql(text, *, confirm=False):
        result = api('query', {'sql': text, 'confirm': confirm})
        check(not result['confirm_required'] and result['failed'] is None, 'SQL completed: ' + json.dumps(result.get('failed')))
        return result

    boot = api('bootstrap')
    csrf = boot['csrf']
    check(all(boot['capabilities'][key] for key in ['query', 'import', 'snapshots'])
          and not boot['capabilities']['phpmyadmin'] and not boot['capabilities']['query_builder'],
          'Native tools are advertised separately from unfinished engine tools')
    original_tables = sorted(item['name'] for item in boot['tables'])
    original_rows = api('browse', parameters={'table': 'govern_pg_values'})['rows']
    archive_rows = api('browse', parameters={'table': 'govern_pg_values', 'schema': 'archive'})['rows']
    status, result, _ = request('snapshots', guest=True)
    check(status == 401 and result.get('error_code') == 'auth_required', 'Guests cannot list checkpoints')
    for action, payload in [
        ('query', {'sql': 'SELECT 1'}), ('native-import-preview', {'sql': 'SELECT 1'}),
        ('native-import-execute', {'sql': 'SELECT 1', 'preview_token': '0' * 64, 'confirmation': 'govern_pg.public'}),
        ('create-snapshot', {'label': marker}),
        ('restore-snapshot', {'id': '20000101T000000Z_0000000000000000', 'confirmation': 'govern_pg.public'}),
    ]:
        status, result, _ = request(action, payload, token=False)
        check(status == 403 and result.get('error_code') == 'csrf_invalid', 'CSRF precedes ' + action)
        status, result, _ = request(action, payload, guest=True)
        check(status == 401 and result.get('error_code') == 'auth_required', 'Guests cannot invoke ' + action)
    status, result, _ = request('query', {'sql': 'SELECT 1'}, {'schema': 'pg_catalog'})
    check(status == 403 and result.get('error_code') == 'database_not_available', 'System schemas are not request-selected')
    status, result, _ = request('query', {'design': {}})
    check(status == 403 and result.get('error_code') == 'postgres_read_only', 'PG SQL cannot invoke the MariaDB-only visual compiler')
    for text in ['COPY sample FROM STDIN;', '\\connect other\nSELECT 1;']:
        status, result, _ = request('native-import-preview', {'sql': text})
        check(status == 422 and result.get('error_code') in ['postgres_sql_copy_unsupported', 'postgres_sql_client_command'],
              'Unsupported client transports receive stable errors')
    result = sql("SELECT 9007199254740993::bigint AS same,'123456789012345678901234.12'::numeric(30,2) AS same;"
                 "SELECT E'literal\\nsecond; line' AS text;")
    check(result['executed'] == 2 and result['statements'][0]['columns'] == ['same', 'same']
          and result['statements'][0]['rows'] == [['9007199254740993', '123456789012345678901234.12']],
          'Separate results retain duplicate aliases and exact numbers')
    check(result['statements'][1]['rows'] == [['literal\nsecond; line']], 'Escape strings remain exact result text')
    preview = api('query', {'sql': f'CREATE TABLE public.{table}(id integer); DELETE FROM public.{table};'})
    check(preview['confirm_required'] and preview['destructive'][0]['reason'] == 'delete_no_where', 'Destructive confirmation precedes execution')
    check(table not in [item['name'] for item in api('bootstrap')['tables']], 'Preview executes no earlier DDL')

    try:
        baseline = api('create-snapshot', {'label': marker + ' baseline'})
        check(baseline['database'] == 'govern_pg' and baseline['schema'] == 'public'
              and baseline['format'] == 'postgres-custom-v1' and baseline['size_bytes'] > 0, 'Descriptor identifies an actual scoped PostgreSQL archive')
        check(any(item['id'] == baseline['id'] for item in api('snapshots')), 'The schema lists its checkpoint')
        status, contents, headers = request('download-snapshot', parameters={'id': baseline['id']}, binary=True)
        check(status == 200 and contents[:5] == b'PGDMP' and len(contents) == baseline['size_bytes']
              and hashlib.sha256(contents).hexdigest() == baseline['sha256'], 'Download matches archive magic, length and SHA256')
        check('.dump' in headers.get('Content-Disposition', ''), 'Download retains its real file format')
        status, result, _ = request('download-snapshot', parameters={'id': baseline['id']}, guest=True)
        check(status == 401, 'Archive download requires an account')
        status, result, _ = request('download-snapshot', parameters={'id': baseline['id'], 'schema': 'archive'})
        check(status == 422 and result.get('error_code') == 'snapshot_missing', 'Download IDs cannot cross schemas')
        sql(f"CREATE TABLE public.{table}(id bigint PRIMARY KEY,label text,amount numeric(30,2));"
            f"INSERT INTO public.{table} VALUES(9007199254740993,'HTTP original',123456789012345678901234.13);")
        check(api('browse', parameters={'table': table})['rows'][0]['amount'] == '123456789012345678901234.13', 'Independent browse sees native SQL writes exactly')
        script = f"CREATE TABLE public.{imported}(id integer PRIMARY KEY,label text); INSERT INTO public.{imported} VALUES(1,'native import HTTP');"
        imported_preview = api('native-import-preview', {'sql': script})
        check(imported_preview['confirmation'] == 'govern_pg.public' and imported_preview['statement_count'] == 2, 'Preflight retains complete scope and statement count')
        status, result, _ = request('native-import-execute', {'sql': script, 'preview_token': imported_preview['preview_token'], 'confirmation': 'govern_pg'})
        check(status == 422 and result.get('error_code') == 'postgres_import_confirm', 'Import needs database.schema confirmation')
        imported_result = api('native-import-execute', {'sql': script, 'preview_token': imported_preview['preview_token'], 'confirmation': 'govern_pg.public'})
        check(imported_result['completed'] and imported_result['executed'] == 2 and imported in imported_result['added_tables'], 'Import reports its committed new table')
        points = {item['schema']: item['id'] for item in imported_result['safety_snapshots']}
        check(set(points) == {'public', 'archive'} and imported_result['safety_snapshot']['id'] == points['public'], 'Every configured schema has a recovery checkpoint before import')
        check(api('browse', parameters={'table': imported})['rows'] == [{'id': '1', 'label': 'native import HTTP'}], 'Table browsing rereads the imported values')
        check(any(item['id'] == points['public'] for item in api('snapshots')), 'Import recovery point appears in the normal list')
        stale_script = f'CREATE TABLE public.{absent}(label text);'
        stale = api('native-import-preview', {'sql': stale_script})
        sql(f'ALTER TABLE public.{table} ADD COLUMN extra text;')
        status, result, _ = request('native-import-execute', {'sql': stale_script, 'preview_token': stale['preview_token'], 'confirmation': 'govern_pg.public'})
        check(status == 409 and result.get('error_code') == 'import_preview_stale', 'Changed metadata invalidates import preflight')
        check(absent not in [item['name'] for item in api('bootstrap')['tables']], 'Stale import creates no table')
        sql("UPDATE public.govern_pg_values SET label='changed before HTTP restore' WHERE id=9007199254740993;")
        status, result, _ = request('restore-snapshot', {'id': baseline['id'], 'confirmation': 'govern_pg'})
        check(status == 422 and result.get('error_code') == 'restore_confirmation_invalid', 'Restore needs the complete schema confirmation')
        check(api('browse', parameters={'table': 'govern_pg_values'})['rows'] != original_rows, 'Rejected restore preserves current written data')
        status, result, _ = request('restore-snapshot', {'id': baseline['id'], 'confirmation': 'govern_pg.archive'}, {'schema': 'archive'})
        check(status == 422 and result.get('error_code') == 'snapshot_missing', 'Checkpoint IDs cannot restore another schema')
        recovery = api('restore-snapshot', {'id': baseline['id'], 'confirmation': 'govern_pg.public'})
        restored = True
        check(recovery['restored'] == baseline['id'] and recovery['safety_snapshot']['schema'] == 'public', 'Restore takes a safety checkpoint first')
        check(api('browse', parameters={'table': 'govern_pg_values'})['rows'] == original_rows, 'Real restore reads original exact/binary/generated records back')
        check(sorted(item['name'] for item in api('bootstrap')['tables']) == original_tables, 'Restore removes objects created after the checkpoint')
        check(api('browse', parameters={'table': 'govern_pg_values', 'schema': 'archive'})['rows'] == archive_rows, 'Public restore preserves archive records')
    finally:
        if baseline is not None and not restored:
            status, result, _ = request('restore-snapshot', {'id': baseline['id'], 'confirmation': 'govern_pg.public'})
            if status >= 400 or not result.get('ok'):
                print('Isolated HTTP fixture kept with its baseline checkpoint because cleanup restore failed.', file=sys.stderr)
    print(f'PASS: {checks} PostgreSQL tools HTTP, auth/CSRF, SQL/import, archive integrity and restore/readback checks.')


if __name__ == '__main__':
    main()
