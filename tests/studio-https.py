#!/usr/bin/env python3
"""Optional HTTPS gateway contracts against an isolated loopback stack.

Supply a trusted certificate through --ca-file; TLS verification stays enabled.
Credentials use GOVERN_TEST_EMAIL/GOVERN_TEST_PASSWORD and are never printed.
The gateway must use docker/studio/Caddyfile, with only upstream DNS adapted if
the isolated app container is named differently from the Compose service.
"""
import argparse
import http.cookiejar
import json
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='https://localhost:18443')
    parser.add_argument('--ca-file', required=True)
    parser.add_argument('--confirm-database', required=True)
    parser.add_argument('--schema', default='brainstorm')
    args = parser.parse_args()
    origin = args.base_url.rstrip('/')
    parsed = urllib.parse.urlsplit(origin)
    if (parsed.scheme != 'https' or parsed.hostname not in {'localhost', '127.0.0.1', '::1'}
            or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password):
        parser.error('Use an isolated loopback HTTPS origin.')
    if args.confirm_database not in {'govern_studio_test', 'govern_pg'}:
        parser.error('Confirm an isolated govern_studio_test or govern_pg database.')
    email, password = os.environ.get('GOVERN_TEST_EMAIL'), os.environ.get('GOVERN_TEST_PASSWORD')
    if not email or not password:
        parser.error('Set dedicated GOVERN_TEST_EMAIL and GOVERN_TEST_PASSWORD.')
    cookies = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=args.ca_file)),
        urllib.request.HTTPCookieProcessor(cookies))
    count = 0

    def check(condition, message):
        nonlocal count
        if not condition:
            raise AssertionError(message)
        count += 1

    def request(path, body=None, *, csrf=None, headers=None):
        request_headers = {'Accept': 'application/json', 'Origin': origin}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            request_headers['Content-Type'] = 'application/json'
        if csrf is not None:
            request_headers['X-CSRF-Token'] = csrf
        request_headers.update(headers or {})
        req = urllib.request.Request(origin + path, data=data, headers=request_headers)
        try:
            response = client.open(req, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            value = json.loads(raw) if 'application/json' in response.headers.get('Content-Type', '') else None
            return response.status, value, response.headers, raw

    def ok(result, message):
        status, payload, _, _ = result
        check(status in {200, 201} and isinstance(payload, dict) and payload.get('ok') is True, message)
        return payload['data']

    def rejects(result, status, code, message):
        actual, payload, _, _ = result
        check(actual == status and isinstance(payload, dict) and payload.get('error_code') == code, message)

    scope = {'connection': 'postgres', 'database': args.confirm_database, 'schema': args.schema}

    def api(action, body=None, *, params=None, csrf=None, headers=None):
        query = urllib.parse.urlencode({**scope, 'action': action, **(params or {})})
        return request('/api.php?' + query, body, csrf=csrf, headers=headers)

    rejects(api('studio-bootstrap'), 401, 'auth_required', 'HTTPS Studio requires authentication.')
    status = ok(request('/auth-api.php?action=status'), 'Same-origin HTTPS account status succeeds.')
    account = ok(request('/auth-api.php?action=login', {'email': email, 'password': password},
                         csrf=status['csrf']), 'Same-origin HTTPS login succeeds.')
    check(account.get('user', {}).get('status') == 'active', 'The dedicated approved account is active.')
    session = [cookie for cookie in cookies if cookie.name == 'govern_session']
    check(len(session) == 1 and session[0].secure, 'Login session cookie is Secure behind Caddy.')
    check(session[0].has_nonstandard_attr('HttpOnly') and session[0].get_nonstandard_attr('SameSite') == 'Strict',
          'Login session retains HttpOnly and SameSite=Strict.')
    boot = ok(api('studio-bootstrap'), 'Authenticated same-origin HTTPS bootstrap succeeds.')
    check(boot.get('ready') is True and boot.get('enabled') is True, 'The isolated Studio schema is ready.')
    board = str(uuid.uuid4())
    create = {'id': board, 'title': 'HTTPS gateway test', 'operation_id': str(uuid.uuid4()),
              'generation': boot['generation']}
    rejects(api('studio-create-board', create), 403, 'csrf_invalid', 'HTTPS writes require a valid CSRF token.')
    rejects(api('studio-create-board', create, csrf=account['csrf'], headers={'Origin': 'https://other.invalid'}),
            403, 'origin_not_allowed', 'A different Origin is rejected through Caddy.')
    rejects(api('studio-create-board', create, csrf=account['csrf'], headers={'Origin': 'http://' + parsed.netloc}),
            403, 'origin_not_allowed', 'An HTTP Origin cannot write to the HTTPS gateway.')
    wrong_port = '18444' if parsed.port != 18444 else '18445'
    wrong_origin = 'https://' + ('[' + parsed.hostname + ']' if ':' in parsed.hostname else parsed.hostname) + ':' + wrong_port
    rejects(api('studio-create-board', create, csrf=account['csrf'], headers={'Origin': wrong_origin}),
            403, 'origin_not_allowed', 'A different Origin port is rejected through Caddy.')
    created = ok(api('studio-create-board', create, csrf=account['csrf']), 'Same-origin HTTPS board creation succeeds.')
    check(created['id'] == board, 'The HTTPS board identity survives storage.')
    initial = ok(api('studio-board', params={'board': board}), 'HTTPS board read succeeds.')
    note_id = str(uuid.uuid4())
    note = {'id': note_id, 'kind': 'note', 'text': 'HTTPS persisted note', 'x': 20, 'y': 30,
            'width': 240, 'height': 160, 'data': {}}
    ok(api('studio-mutate', {'board_id': board, 'base_revision': initial['board']['revision'],
                            'operation_id': str(uuid.uuid4()), 'generation': boot['generation'],
                            'changes': [{'type': 'put-node', 'node': note}]}, csrf=account['csrf']),
       'Same-origin HTTPS note mutation succeeds.')
    stored = ok(api('studio-board', params={'board': board}), 'A fresh HTTPS read observes the saved note.')
    check(any(node['id'] == note_id and node['text'] == note['text'] for node in stored['nodes']),
          'The saved note reaches PostgreSQL and returns through HTTPS.')
    page = request('/studio.php')
    check(page[0] == 200 and b'studio-app' in page[3], 'Authenticated Studio HTML is available through HTTPS.')
    for path in ['/phpmyadmin', '/phpmyadmin/', '/phpmyadmin/index.php']:
        check(request(path)[0] == 404, 'The HTTPS gateway excludes ' + path + '.')
    check(request('/api.php?action=health', headers={'Host': 'wrong.invalid'})[0] == 421,
          'An unconfigured Host is rejected.')
    print(str(count) + ' optional HTTPS gateway checks passed (verified localhost TLS; no physical iPhone test).')


if __name__ == '__main__':
    main()
