#!/usr/bin/env python3
"""Real database creation in a confirmed disposable stack; unique managed DBs remain.

--state-file and a later --verify-state check worker/app restart persistence.
"""
import argparse
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import uuid
from auth_http import ensure_authenticated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default=os.environ.get('BASE_URL', 'http://127.0.0.1:8080'))
    parser.add_argument('--confirm-project', required=True)
    parser.add_argument('--confirm-database', required=True, choices=['govern_pg'])
    parser.add_argument('--state-file', type=Path)
    parser.add_argument('--verify-state', action='store_true')
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    if urllib.parse.urlparse(base).hostname not in {'127.0.0.1', 'localhost', '::1'}:
        raise RuntimeError('Use an isolated loopback installation')
    if os.environ.get('GOVERN_UI_WRITE_TESTS') != '1' or not (args.confirm_project == 'govern' or args.confirm_project.startswith('govern-')):
        raise RuntimeError('Enable disposable-stack writes and confirm its govern test project')
    if args.verify_state and not args.state_file:
        parser.error('--verify-state requires --state-file')
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    ensure_authenticated(client, base)
    root = Path(__file__).resolve().parents[1]
    compose = ['docker', 'compose', '--project-name', args.confirm_project, '--profile', 'postgres']
    checks, csrf = 0, ''
    default, suffix = args.confirm_database, uuid.uuid4().hex[:12]
    names = ['govern_pg_create_' + suffix + ending for ending in ['_a', '_b']]
    table, csv_table, imported = 'govern_create_shared', 'govern_create_csv', 'govern_create_import'

    def check(condition, message):
        nonlocal checks
        if not condition:
            raise AssertionError(f'Check {checks + 1}: {message}')
        checks += 1

    def request(action, database=default, payload=None, *, params=None, token=True, guest=False, binary=False, upload=None):
        headers = {'Accept': 'application/json', 'Accept-Language': 'en'}
        data = None
        if upload is not None:
            boundary, chunks = 'GovernCreate' + suffix, []
            for key, value in (payload or {}).items():
                chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
            chunks += [f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="create.csv"\r\nContent-Type: text/csv\r\n\r\n'.encode(), upload, f'\r\n--{boundary}--\r\n'.encode()]
            data = b''.join(chunks)
            headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
        elif payload is not None:
            data = json.dumps(payload).encode()
            headers['Content-Type'] = 'application/json'
        if data is not None and token:
            headers['X-CSRF-Token'] = csrf
        query = {'action': action, 'connection': 'postgres', 'database': database, 'schema': 'public', **(params or {})}
        req = urllib.request.Request(base + '/api.php?' + urllib.parse.urlencode(query), data=data, headers=headers)
        try:
            response = (urllib.request.build_opener() if guest else client).open(req, timeout=120)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            return response.status, raw if binary and response.status < 400 else json.loads(raw)

    def api(action, database=default, payload=None, **kwargs):
        status, result = request(action, database, payload, **kwargs)
        check(200 <= status < 300 and result.get('ok') is True,
              f'{action} HTTP {status}: ' + json.dumps(result, ensure_ascii=False))
        return result['data']

    def sql(database, statement):
        result = api('query', database, {'sql': statement, 'confirm': True})
        check(not result['confirm_required'] and result['failed'] is None, 'Native SQL executes: ' + json.dumps(result.get('failed')))
        return result

    def role_sql(database, statement, role='admin'):
        users = {'reader': 'PG_READ_USER', 'writer': 'PG_USER', 'sql': 'PG_SQL_USER', 'restore': 'PG_RESTORE_USER'}
        passwords = {'reader': 'PG_READ_PASSWORD', 'writer': 'PG_PASSWORD', 'sql': 'PG_SQL_PASSWORD', 'restore': 'PG_RESTORE_PASSWORD'}
        command = 'exec psql -X -qAt --username "$POSTGRES_USER"'
        if role != 'admin':
            command = 'PGPASSWORD="$' + passwords[role] + '" exec psql -X -qAt --host=127.0.0.1 --username "$' + users[role] + '"'
        command += ' --dbname "$1" --set ON_ERROR_STOP=1'
        return subprocess.run(compose + ['exec', '-T', 'postgres', 'sh', '-c', command, 'govern-create-test', database],
                              input=statement, capture_output=True, text=True, cwd=root)

    boot = api('bootstrap')
    csrf = boot['csrf']
    check(boot['database']['name'] == default, 'Base fixture is the confirmed govern_pg database')
    if args.verify_state:
        names = json.loads(args.state_file.read_text())['databases']
        check(len(names) == 2 and all(name.startswith('govern_pg_create_') for name in names), 'Only this suite’s managed DBs are rechecked')
        for index, name in enumerate(names):
            current = api('bootstrap', name)
            check(current['database']['name'] == name and current['scope_key'] == f'postgres:{name}:public', 'Restart retains the complete selected scope')
            check(any(item['scope_key'] == f'postgres:{name}:public' and item['available'] for item in current['databases']), 'Restart retains the readable picker entry')
            check(api('browse', name, params={'table': table})['rows'][0]['label'] == f'create {index}', 'Restart preserves independent records')
        print(f'PASS: {checks} PostgreSQL managed-database restart persistence checks.')
        return
    engine = next(item for item in boot['engines'] if item['id'] == 'postgres')
    check(engine['capabilities']['create_database'] is True, 'The available private creator is advertised')
    for kwargs, expected in [({'guest': True}, 401), ({'token': False}, 403)]:
        status, result = request('prepare-database', payload={'name': names[0]}, **kwargs)
        check(status == expected, 'Creation respects account and CSRF boundaries')
    for name in ['postgres', 'template0', 'template1', 'pg_catalog', 'bad-name', 'x' * 64]:
        status, result = request('prepare-database', payload={'name': name})
        check(status >= 400 and result.get('ok') is False, 'Reserved/invalid names cannot create a database')
        check(set(result.get('error_i18n', {})) == {'nl', 'en'}, 'Creation rejection remains bilingual')
    status, result = request('prepare-database', payload={'name': names[0], 'sql': 'SELECT 1'})
    check(status >= 400 and result.get('ok') is False, 'The creator rejects arbitrary request fields')
    unmanaged = 'govern_pg_unmanaged_' + suffix
    check(role_sql(default, f'CREATE DATABASE "{unmanaged}";').returncode == 0, 'An isolated unmanaged-name fixture is installed')
    try:
        status, result = request('prepare-database', payload={'name': unmanaged})
        check(status >= 400 and result.get('ok') is False, 'An existing unmanaged database is never silently adopted')
        check(role_sql(unmanaged, "SELECT count(*) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema';").stdout.strip() == '1', 'Rejected adoption leaves existing contents intact')
    finally:
        check(role_sql(default, f'DROP DATABASE "{unmanaged}";').returncode == 0, 'Only this suite’s unmanaged fixture is removed')
    for index, name in enumerate(names):
        status, result = request('prepare-database', payload={'name': name})
        check(status == 201 and result.get('ok') is True, 'Creation completes through the real authenticated route')
        prepared = result['data']
        check(prepared['created'] is True and prepared['database'] == f'postgres:{name}:public', 'Creation returns the full new workspace key')
        check(prepared['name'] == name and prepared['connection'] == 'postgres' and prepared['schema'] == 'public', 'Creation reports actual metadata')
        check(role_sql(name, 'SELECT current_database();').stdout.strip() == name, 'PostgreSQL contains a separate real database')
        check(role_sql(name, "SELECT COALESCE((SELECT bool_or(privilege_type='CONNECT') FROM aclexplode(datacl) WHERE grantee=0),false) FROM pg_database WHERE datname=current_database();").stdout.strip() == 'f', 'PUBLIC has no CONNECT grant on a created database')
        repeated = api('prepare-database', payload={'name': name})
        check(repeated['created'] is False and repeated['database'] == prepared['database'], 'Retry safely reuses this managed database')
        fresh = api('bootstrap', name)
        check(fresh['tables'] == [] and fresh['capabilities']['query'] and fresh['capabilities']['import'], 'An empty new database supports design/import immediately')
        check([item['schema'] for item in fresh['databases'] if item['name'] == name] == ['public'], 'Created databases expose public only')
        status, result = request('bootstrap', name, params={'schema': 'archive'})
        check(status == 403, 'A base database’s extra schemas are not copied into a new database')
        sql(name, f"CREATE TABLE public.{table}(id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,label text NOT NULL); INSERT INTO public.{table}(label) VALUES('create {index}');")
        check(api('browse', name, params={'table': table})['rows'] == [{'id': '1', 'label': f'create {index}'}], 'Same-named tables read from their explicitly selected DB')
        check(any(item['name'] == table for item in api('schema', name)['tables']), 'Catalog rereads the real table')
        for role in ['reader', 'writer', 'sql', 'restore']:
            check(role_sql(name, 'SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user;', role).stdout.strip() == 'f|f|f', role + ' remains non-administrative')
        check(role_sql(name, f"SET default_transaction_read_only=off; INSERT INTO public.{table}(label) VALUES('forbidden');", 'reader').returncode != 0, 'Reader cannot write after disabling session read-only')
        check(role_sql(name, 'CREATE TABLE public.govern_create_forbidden(id integer);', 'writer').returncode != 0, 'Row writer cannot create tables')
        check(role_sql(name, 'CREATE DATABASE govern_create_forbidden;', 'sql').returncode != 0, 'SQL login cannot create databases')
        check(role_sql(name, 'CREATE SCHEMA govern_create_forbidden;', 'sql').returncode != 0, 'SQL login cannot widen schemas')
        check(role_sql(name, f"INSERT INTO public.{table}(label) VALUES('writer verified'); DELETE FROM public.{table} WHERE label='writer verified';", 'writer').returncode == 0, 'SQL-created identities grant separate row-writer access')
    first, second = names
    csv = b'code,label\n001,CSV exact <record>\n9007199254740993,second\n'
    preview = api('dataset-preview', first, upload=csv)
    check(preview['confirmation'] == first + '.public' and preview['datasets'][0]['rows'][0][0] == '001', 'CSV preview preserves strings/full target')
    check(csv_table not in [item['name'] for item in api('schema', first)['tables']], 'CSV preview creates no table')
    result = api('dataset-import', first, {'dataset': '0', 'mode': 'create', 'table': csv_table, 'confirmation': first + '.public', 'sha256': preview['sha256']}, upload=csv)
    check(result['imported'] == 2, 'CSV commits two rows into the new database')
    rows = api('browse', first, params={'table': csv_table})['rows']
    check(rows[0]['code'] == '001' and rows[1]['code'] == '9007199254740993', 'Independent browse rereads exact CSV values')
    checkpoint = api('create-snapshot', first, {'label': 'New database before SQL import'})
    status, archive = request('download-snapshot', first, params={'id': checkpoint['id']}, binary=True)
    check(status == 200 and archive[:5] == b'PGDMP' and hashlib.sha256(archive).hexdigest() == checkpoint['sha256'], 'A new database creates a real native archive')
    script = f"CREATE TABLE public.{imported}(id integer PRIMARY KEY,label text); INSERT INTO public.{imported} VALUES(1,'SQL imported'); UPDATE public.{table} SET label='changed' WHERE id=1;"
    plan = api('native-import-preview', first, {'sql': script})
    check(plan['safety_schemas'] == ['public'], 'SQL preflight snapshots only the new database’s managed schema')
    outcome = api('native-import-execute', first, {'sql': script, 'preview_token': plan['preview_token'], 'confirmation': first + '.public'})
    check(outcome['completed'] and outcome['executed'] == 3 and len(outcome['safety_snapshots']) == 1, 'SQL import runs with a preceding real recovery point')
    check(api('browse', first, params={'table': imported})['rows'] == [{'id': '1', 'label': 'SQL imported'}], 'Imported SQL data is independently readable')
    check(api('browse', second, params={'table': table})['rows'][0]['label'] == 'create 1', 'Writing one DB leaves its same-named counterpart unchanged')
    status, result = request('restore-snapshot', second, {'id': checkpoint['id'], 'confirmation': second + '.public'})
    check(status >= 400 and result.get('ok') is False, 'Snapshot IDs cannot cross database boundaries')
    restore = api('restore-snapshot', first, {'id': checkpoint['id'], 'confirmation': first + '.public'})
    check(restore['restored'] == checkpoint['id'] and restore['safety_snapshot'], 'A new database restores with its own safety copy')
    check(api('browse', first, params={'table': table})['rows'][0]['label'] == 'create 0', 'Real restore rereads the original record')
    check(imported not in [item['name'] for item in api('schema', first)['tables']], 'Restore removes newer SQL objects')
    check(api('browse', first, params={'table': csv_table})['rows'] == rows, 'Restored CSV values remain exact')
    check(role_sql(first, f"INSERT INTO public.{table}(label) VALUES('after restore'); DELETE FROM public.{table} WHERE label='after restore';", 'writer').returncode == 0, 'Restore retains separate writer grants')
    if args.state_file:
        args.state_file.parent.mkdir(parents=True, exist_ok=True)
        args.state_file.write_text(json.dumps({'databases': names}) + '\n')
    print(f'PASS: {checks} real PostgreSQL database creation/retry/permissions, CSV/SQL import, isolation and snapshot restore checks.')


if __name__ == '__main__':
    main()
