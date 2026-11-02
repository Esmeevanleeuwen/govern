#!/usr/bin/env python3
"""Real HTTP account/session tests, with an isolated store and no work database."""
import http.cookiejar
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
PHP = os.environ.get('PHP_BIN', 'php')
checks = 0


def check(condition, message):
    global checks
    if not condition:
        raise AssertionError(message)
    checks += 1


def browser():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)), jar


def request(client, path, payload=None, csrf=None, headers=None):
    options = {'Accept-Language': 'en'}
    if payload is not None:
        options['Content-Type'] = 'application/json'
    if csrf:
        options['X-CSRF-Token'] = csrf
    options.update(headers or {})
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(base + path, data=data, headers=options)
    try:
        response = client.open(req, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read().decode()
    return response.code, json.loads(raw) if raw and raw.startswith('{') else raw, response.headers


def api(client, action, payload=None, csrf=None, headers=None):
    return request(client, '/auth-api.php?action=' + action, payload, csrf, headers)


with tempfile.TemporaryDirectory(prefix='govern-auth-http-') as temporary:
    session_dir = Path(temporary) / 'sessions'
    session_dir.mkdir(mode=0o700)
    with socket.socket() as reserve:
        reserve.bind(('127.0.0.1', 0))
        port = reserve.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    environment = {**os.environ, 'AUTH_DIR': str(Path(temporary) / 'accounts')}
    with open(Path(temporary) / 'server.log', 'w+') as log:
        server = subprocess.Popen([PHP, '-d', 'display_errors=0', '-d', f'session.save_path={session_dir}', '-S', f'127.0.0.1:{port}', '-t', str(ROOT / 'app/public')], env=environment, stdout=log, stderr=log)
        try:
            owner, owner_cookies = browser()
            for _ in range(100):
                try:
                    status, body, headers = api(owner, 'status')
                    break
                except (urllib.error.URLError, ConnectionError):
                    time.sleep(0.05)
            else:
                raise RuntimeError('The isolated PHP HTTP server did not start.')
            check(status == 200 and body['data']['user'] is None and not body['data']['has_owner'], 'Guest status exposes no user.')
            csrf = body['data']['csrf']
            check('no-store' in headers.get('Cache-Control', ''), 'Authentication responses are not cached.')
            check('HttpOnly' in headers.get('Set-Cookie', '') and 'SameSite=Strict' in headers.get('Set-Cookie', ''), 'The session cookie is HttpOnly and SameSite Strict.')
            check(request(owner, '/auth-check.php')[0] == 401, 'The phpMyAdmin session check denies guests.')
            for action in ('bootstrap', 'databases', 'schema', 'context', 'snapshots', 'download-snapshot', 'ai-status'):
                code, data, _ = request(owner, '/api.php?action=' + action)
                check(code == 401 and data['error_code'] == 'auth_required', f'Guest data route {action} is denied before any database work.')
            # Opening a link from an external page is an ordinary browser
            # document navigation. It must reach the sign-in form, not a 503.
            document_navigation = {'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document'}
            for path in ('/workspace.php', '/account.php'):
                code, document, _ = request(owner, path, headers=document_navigation)
                check(code == 200 and 'data-account-page="auth"' in document,
                      f'External guest navigation to {path} follows the normal login redirect.')
            registration = {'name': 'Test Owner', 'email': 'owner@example.test', 'password': 'test-only passphrase 8392'}
            check(api(owner, 'register', registration)[0] == 403, 'Registration requires a valid CSRF token.')
            check(api(owner, 'register', registration, csrf, {'Origin': 'https://untrusted.example'})[0] == 403, 'Cross-origin registration is rejected.')
            old_session = next(c.value for c in owner_cookies if c.name == 'govern_session')
            status, body, _ = api(owner, 'register', registration, csrf)
            check(status == 201 and body['data']['registration'] == 'active', 'The real registration endpoint creates the first active owner.')
            check(body['data']['user']['role'] == 'owner' and 'password_hash' not in body['data']['user'], 'The registration result contains only public user fields.')
            csrf = body['data']['csrf']
            check(old_session != next(c.value for c in owner_cookies if c.name == 'govern_session'), 'Login regenerates the browser session ID.')
            check(request(owner, '/auth-check.php')[0] == 204, 'The native phpMyAdmin gate accepts the approved owner.')

            # Supplying the same metadata with an authenticated test cookie
            # exercises the HTML boundary independently of browser SameSite
            # cookie handling. APIs never opt into this HTML-only exception.
            for path, marker in (('/workspace.php', 'class="app-shell"'), ('/account.php', 'data-account-page="account"')):
                code, document, _ = request(owner, path, headers=document_navigation)
                check(code == 200 and marker in document, f'External GET document navigation to {path} renders the signed-in page.')
                for metadata in (
                    {'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty'},
                    {'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'iframe'},
                    {'Sec-Fetch-Site': 'cross-site'},
                ):
                    check(request(owner, path, headers=metadata)[0] == 403,
                          f'Cross-site fetch/embed/missing navigation metadata cannot open {path}.')
                check(request(owner, path, {}, csrf, document_navigation)[0] == 403,
                      f'A cross-site POST cannot use the document-navigation exception for {path}.')
                check(request(owner, path, headers={**document_navigation, 'Origin': 'https://untrusted.example'})[0] == 403,
                      f'The Origin check remains enforced for {path} document navigation.')
            for path in ('/api.php?action=bootstrap', '/auth-api.php?action=status', '/auth-check.php'):
                code, rejected, _ = request(owner, path, headers=document_navigation)
                check(code == 403 and (not isinstance(rejected, dict) or rejected.get('error_code') == 'same_window_required'),
                      f'The HTML exception never permits cross-site API/gate navigation to {path}.')
            for path in ('/api.php?action=query', '/auth-api.php?action=logout'):
                code, rejected, _ = request(owner, path, {}, csrf, document_navigation)
                check(code == 403 and rejected.get('error_code') == 'same_window_required',
                      f'Cross-site API POST {path} remains blocked even with a valid token.')

            guest, _ = browser()
            guest_csrf = api(guest, 'status')[1]['data']['csrf']
            member_registration = {'name': '<script>alert(1)</script>', 'email': 'member@example.test', 'password': 'test-only member phrase 8392', 'role': 'owner'}
            code, body, _ = api(guest, 'register', member_registration, guest_csrf)
            check(code == 201 and body['data']['registration'] == 'pending' and body['data']['user'] is None, 'Later registrations wait for owner approval.')
            check(request(guest, '/auth-check.php')[0] == 401, 'A new pending signup cannot use native phpMyAdmin.')
            check(api(guest, 'requests')[0] == 401, 'Guests cannot see other registrations.')
            check(api(guest, 'login', {'email': 'member@example.test', 'password': 'test-only member phrase 8392'}, guest_csrf)[0] == 403, 'Pending-account login is blocked.')
            code, body, _ = api(owner, 'requests')
            check(code == 200 and len(body['data']['users']) == 1, 'The owner can list real pending requests.')
            member_id = body['data']['users'][0]['id']
            check(api(guest, 'approve', {'user_id': member_id}, guest_csrf)[0] == 401, 'Guest approval is rejected.')
            check(api(owner, 'approve', {'user_id': member_id})[0] == 403, 'Even owner approval requires CSRF.')
            check(api(owner, 'approve', {'user_id': member_id}, csrf)[0] == 200, 'Owner approval activates the selected request.')
            code, body, _ = api(guest, 'login', {'email': 'member@example.test', 'password': 'test-only member phrase 8392'}, guest_csrf)
            check(code == 200 and body['data']['user']['role'] == 'member', 'An approved member can authenticate.')
            member_csrf = body['data']['csrf']
            check(api(guest, 'requests')[0] == 403, 'A member cannot list owner-only requests.')
            check(request(guest, '/auth-check.php')[0] == 204, 'An approved member has workspace access.')
            check(api(guest, 'logout', {}, member_csrf)[0] == 200, 'The authenticated logout endpoint succeeds.')
            check(request(guest, '/auth-check.php')[0] == 401, 'Logout immediately removes phpMyAdmin access.')
            check(request(guest, '/api.php?action=schema')[0] == 401, 'Logout immediately removes data API access.')
            check(api(guest, 'login', {'email': 'member@example.test', 'password': 'test-only member phrase 8392'}, member_csrf)[0] == 403, 'A pre-logout CSRF token cannot start a new session.')
            check(api(guest, 'status', headers={'Host': 'untrusted.example'})[0] == 403, 'Untrusted hosts cannot use the auth API.')
        finally:
            server.terminate()
            server.wait(timeout=10)

print(f'Auth HTTP checks: {checks} passed.')
