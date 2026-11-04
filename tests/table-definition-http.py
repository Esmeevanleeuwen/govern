#!/usr/bin/env python3
"""Native table API checks with a real exclusive lock in a confirmed disposable stack."""
import argparse
import contextlib
import http.cookiejar
import json
from pathlib import Path
import selectors
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import uuid

from auth_http import ensure_authenticated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:8080')
    parser.add_argument('--confirm-project', required=True, choices=['govern'])
    parser.add_argument('--confirm-fixtures', required=True, choices=['table-definition-ci'])
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    root = Path(__file__).resolve().parents[1]
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    ensure_authenticated(client, base)
    checks, csrf = 0, ''
    scopes = [
        {'connection': 'mariadb', 'database': 'bestuursatlas', 'schema': 'bestuursatlas'},
        {'connection': 'postgres', 'database': 'govern_pg', 'schema': 'public'},
    ]
    cleanup = []

    def check(condition, message):
        nonlocal checks
        if not condition:
            raise AssertionError(message)
        checks += 1

    def request(action, scope, payload=None, *, guest=False, token=True):
        headers = {'Accept': 'application/json', 'Accept-Language': 'en'}
        body = None
        if payload is not None:
            body = json.dumps(payload).encode()
            headers['Content-Type'] = 'application/json'
            if token:
                headers['X-CSRF-Token'] = csrf
        query = urllib.parse.urlencode({'action': action, **scope})
        req = urllib.request.Request(base + '/api.php?' + query, data=body, headers=headers)
        opener = urllib.request.build_opener() if guest else client
        try:
            response = opener.open(req, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    @contextlib.contextmanager
    def exclusive_lock():
        # Use the same mounted lock and user as web requests. The PHP process
        # waits on our pipe, so release is explicit and never a guessed sleep.
        script = r'''
require '/var/www/src/bootstrap.php';
$config = Govern\Config::fromEnvironment();
if ($config['name'] !== 'bestuursatlas' || ($config['postgres']['name'] ?? '') !== 'govern_pg') exit(2);
$lock = new Govern\MaintenanceLock($config['backup_dir'], true);
fwrite(STDOUT, "LOCKED\n"); fflush(STDOUT);
fgets(STDIN);
'''
        command = ['docker', 'compose', '--project-name', args.confirm_project,
                   'exec', '-T', '--user', 'www-data', 'app', 'php', '-r', script]
        process = subprocess.Popen(command, cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        try:
            with selectors.DefaultSelector() as ready:
                ready.register(process.stdout, selectors.EVENT_READ)
                if not ready.select(timeout=15) or process.stdout.readline().strip() != 'LOCKED':
                    raise RuntimeError('The isolated app did not confirm its exclusive maintenance lock.')
            yield
        finally:
            try:
                process.communicate(input='\n', timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate(timeout=5)
                raise RuntimeError('The isolated maintenance lock holder did not exit.')
            if process.returncode != 0:
                raise RuntimeError('The isolated maintenance lock holder failed.')

    try:
        reviewed = []
        for scope in scopes:
            status, result = request('bootstrap', scope)
            check(status == 200 and result.get('ok') and result['data']['database']['available'],
                  'The confirmed fixture database is ready.')
            data = result['data']
            check(data['database']['name'] == scope['database']
                  and data['database']['schema'] == scope['schema']
                  and data['capabilities'].get('create_table') is True,
                  'Native table creation is advertised for the exact selected scope.')
            csrf = data['csrf']
            table = 'zz_definition_http_' + uuid.uuid4().hex[:16]
            definition = {'name': table, 'columns': [{'name': 'label', 'type': 'text',
                          'nullable': True, 'primary': False, 'generated': False, 'default': {'mode': 'none'}}]}
            for action in ['table-definition-preview', 'table-definition-create']:
                status, result = request(action, scope)
                check(status == 405 and result.get('error_code') == 'post_required', 'GET cannot call ' + action)
                status, result = request(action, scope, definition, guest=True)
                check(status == 401 and result.get('error_code') == 'auth_required', 'Guests cannot call ' + action)
                status, result = request(action, scope, definition, token=False)
                check(status == 403 and result.get('error_code') == 'csrf_invalid', 'CSRF is required for ' + action)
            status, result = request('table-definition-preview', scope, definition)
            check(status == 200 and result.get('ok') and result['data']['table'] == table,
                  'Authenticated preview returns the selected new table without writing it.')
            preview = result['data']
            reviewed.append((scope, preview))
            cleanup.append((scope, table))

        with exclusive_lock():
            for scope, preview in reviewed:
                for action, payload in [
                    ('table-definition-preview', preview['definition']),
                    ('table-definition-create', {'definition': preview['definition'],
                                                 'definition_token': preview['definition_token']}),
                ]:
                    status, result = request(action, scope, payload)
                    check(status == 423 and result.get('error_code') == 'maintenance_busy',
                          'An actual exclusive recovery lock prevents ' + action + ' for ' + scope['connection'])
                    check(set(result.get('error_i18n', {})) == {'nl', 'en'}, 'Lock feedback remains bilingual.')

        for scope, preview in reviewed:
            status, result = request('bootstrap', scope)
            check(status == 200 and result['data']['database']['available']
                  and preview['table'] not in [item['name'] for item in result['data']['tables']],
                  'A create rejected by the maintenance lock made no table.')
            payload = {'definition': preview['definition'], 'definition_token': preview['definition_token']}
            status, result = request('table-definition-create', scope, payload)
            expected_key = 'bestuursatlas' if scope['connection'] == 'mariadb' else 'postgres:govern_pg:public'
            check(status == 201 and result.get('ok') and result['data']['created']
                  and result['data']['verified'] and result['data']['scope_key'] == expected_key,
                  'After lock release the same reviewed creation succeeds once in the exact scope.')
            status, result = request('table-definition-create', scope, payload)
            check(status == 409 and result.get('error_code') == 'table_definition_exists',
                  'Replaying a confirmed creation reports the occupied name without replacing the table.')
    finally:
        cleanup_failed = False
        for scope, table in reversed(cleanup):
            quoted = ('"public"."' + table + '"' if scope['connection'] == 'postgres'
                      else '`bestuursatlas`.`' + table + '`')
            try:
                status, result = request('query', scope, {'sql': 'DROP TABLE IF EXISTS ' + quoted + ';', 'confirm': True})
                data = result.get('data', {})
                if status != 200 or not result.get('ok') or data.get('confirm_required') is not False \
                        or data.get('failed') is not None or data.get('executed') != 1 or data.get('statement_count') != 1:
                    cleanup_failed = True
            except Exception:
                cleanup_failed = True
        if cleanup_failed:
            raise RuntimeError('Could not remove every isolated table-definition HTTP probe.')
    print(f'PASS: {checks} native table HTTP scope, authentication, CSRF, lock exclusion and conflict checks.')


if __name__ == '__main__':
    main()
