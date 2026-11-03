#!/usr/bin/env python3
"""Exercise VPS HTTPS with a fresh local Docker fixture and verified internal CA.

No production VPS/public certificate is used. Requires Compose 2.24.4+
(!override). Existing project resources are refused. Only this run's fixture
resources are removed. Python dependencies: standard library only.
"""
import argparse
import http.client
import http.cookies
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import ssl
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
DOMAIN = 'govern.test'
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


class LocalTLS(http.client.HTTPSConnection):
    def connect(self):
        connection = socket.create_connection(('127.0.0.1', self.port), timeout=self.timeout)
        self.sock = self._context.wrap_socket(connection, server_hostname=DOMAIN)


class Client:
    def __init__(self, port, *, tls=None):
        self.port, self.tls = port, tls
        self.cookies = http.cookies.SimpleCookie()
        self.host = (DOMAIN if tls else 'localhost') + ':' + str(port)
        self.origin = ('https://' if tls else 'http://') + self.host

    def request(self, path, payload=None, csrf=None, headers=None):
        connection = (LocalTLS('127.0.0.1', self.port, context=self.tls, timeout=30)
                      if self.tls else http.client.HTTPConnection('127.0.0.1', self.port, timeout=30))
        values = {'Host': self.host, 'Accept-Language': 'en', **(headers or {})}
        if self.cookies:
            values['Cookie'] = '; '.join(key + '=' + value.value for key, value in self.cookies.items())
        body = None
        if payload is not None:
            body = json.dumps(payload).encode()
            values.update({'Content-Type': 'application/json', 'X-CSRF-Token': csrf or ''})
            values.setdefault('Origin', self.origin)
        try:
            connection.request('POST' if payload is not None else 'GET', path, body, values)
            response = connection.getresponse()
            data, result_headers = response.read(), response.getheaders()
            for key, value in result_headers:
                if key.lower() == 'set-cookie':
                    self.cookies.load(value)
            return response.status, data, result_headers
        finally:
            connection.close()

    def json(self, action, payload=None, csrf=None, headers=None):
        code, body, result_headers = self.request('/auth-api.php?action=' + action, payload, csrf, headers)
        return code, json.loads(body), result_headers


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', default='govern_vps_test_' + secrets.token_hex(4))
    parser.add_argument('--skip-build', action='store_true')
    parser.add_argument('--keep-stack', action='store_true')
    args = parser.parse_args()
    if not args.project.startswith('govern_vps_test_') or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789_' for c in args.project):
        parser.error('Use an isolated govern_vps_test_<suffix> project')
    runtime = {k: v for k, v in os.environ.items()
               if k not in {'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'}}
    for key in list(runtime):
        if key.startswith(('DB_', 'PG_', 'AI_', 'GOVERN_', 'COMPOSE_')) or key == 'APP_PORT':
            runtime.pop(key)
    checks = []

    def check(condition, message):
        if not condition:
            raise AssertionError(message)
        checks.append(message)

    def command(arguments, *, allow_failure=False):
        result = subprocess.run(arguments, cwd=ROOT, env=runtime, text=True, capture_output=True)
        if result.returncode and not allow_failure:
            raise RuntimeError('Fixture command failed: ' + ' '.join(arguments[:6]) + '\n' + result.stderr[-2200:])
        return result

    command(DOCKER + ['info', '--format', '{{.ServerVersion}}'])
    for query in (['ps', '-aq'], ['volume', 'ls', '-q'], ['network', 'ls', '-q']):
        found = command(DOCKER + query + ['--filter', 'label=com.docker.compose.project=' + args.project]).stdout.strip()
        if found:
            raise RuntimeError('Refusing a pre-existing project: ' + args.project)
    local_port, http_port, tls_port = free_port(), free_port(), free_port()
    while len({local_port, http_port, tls_port}) != 3:
        local_port, http_port, tls_port = free_port(), free_port(), free_port()
    temporary = tempfile.TemporaryDirectory(prefix='govern-vps-test-')
    work = Path(temporary.name)
    # Managed checkouts may be owner-only (600/700). Stage only application
    # sources with ordinary read modes so the real www-data runtime can read
    # them, without changing the user's checkout or copying its .env/secrets.
    source = work / 'source'
    source.mkdir()
    def ignore_private(_directory, names):
        return [name for name in names if name in {'.git', '__pycache__', 'node_modules'}
                or name.startswith('.env') or name.endswith(('.pem', '.key', '.sqlite'))]
    for directory in ('app', 'docs', 'docker'):
        shutil.copytree(ROOT / directory, source / directory, ignore=ignore_private, symlinks=True)
    for name in ('compose.yaml', 'compose.vps.yaml'):
        shutil.copy2(ROOT / name, source / name)
    for item in [source, *source.rglob('*')]:
        if item.is_symlink():
            raise RuntimeError('Unexpected symlink in the isolated source snapshot')
        item.chmod(item.stat().st_mode | (0o555 if item.is_dir() else 0o444))
    env_file = work / 'settings.env'
    email, password = 'govern-vps-test@example.test', secrets.token_urlsafe(32)
    settings = {'APP_PORT': str(local_port), 'DB_NAME': 'bestuursatlas', 'DB_DATABASES': '',
                'DB_PASSWORD': secrets.token_hex(32), 'DB_READ_PASSWORD': secrets.token_hex(32),
                'DB_ROOT_PASSWORD': secrets.token_hex(32), 'PG_ENABLED': '0', 'AI_ENABLED': '0', 'GOVERN_DOMAIN': DOMAIN}
    env_file.write_text(''.join(key + '=' + value + '\n' for key, value in settings.items()))
    env_file.chmod(0o600)
    caddy_file = work / 'Caddyfile'
    caddy_file.write_text('{\n    local_certs\n}\ngovern.test {\n    tls internal\n    reverse_proxy gateway:81\n}\n')
    override = work / 'compose.test.yaml'
    # Docker may inject an egress proxy. The internal Docker service is not an
    # Internet destination; keep proxy use for external traffic and add only
    # this local service to the existing bypass list.
    no_proxy = runtime.get('NO_PROXY', runtime.get('no_proxy', '')) + ',gateway'
    override.write_text('services:\n  caddy:\n'
                        f'    environment:\n      NO_PROXY: {json.dumps(no_proxy)}\n      no_proxy: {json.dumps(no_proxy)}\n'
                        '    ports: !override\n'
                        f'      - "127.0.0.1:{http_port}:80"\n      - "127.0.0.1:{tls_port}:443"\n'
                        f'    volumes:\n      - {caddy_file}:/etc/caddy/Caddyfile:ro\n')
    compose = DOCKER + ['compose', '--env-file', str(env_file), '-p', args.project,
                        '-f', str(source / 'compose.yaml'), '-f', str(source / 'compose.vps.yaml'), '-f', str(override)]
    base = DOCKER + ['compose', '--env-file', str(env_file), '-p', args.project,
                     '-f', str(source / 'compose.yaml')]
    started = False
    try:
        command(base + ['config', '--quiet'])
        started = True
        command(base + ['up', '-d', *([] if args.skip_build else ['--build']), '--wait', '--wait-timeout', '180'])
        local = Client(local_port)
        code, status, _ = local.json('status')
        check(code == 200 and status['ok'] and not status['data']['has_owner'], 'Loopback bootstrap reaches only the fresh fixture')
        code, registered, _ = local.json('register', {'name': 'VPS fixture owner', 'email': email, 'password': password}, status['data']['csrf'])
        check(code == 201 and registered['data']['user']['role'] == 'owner', 'The fixture owner is created before the HTTPS edge starts')
        check(not local.cookies['govern_session']['secure'], 'The SSH-tunnel route retains ordinary HTTP session handling')
        command(compose + ['config', '--quiet'])
        command(compose + ['up', '-d', '--wait', '--wait-timeout', '180'])
        root_ca = work / 'root.crt'
        for attempt in range(30):
            certificate = command(compose + ['exec', '-T', 'caddy', 'cat', '/data/caddy/pki/authorities/local/root.crt'], allow_failure=True)
            if certificate.returncode == 0 and 'BEGIN CERTIFICATE' in certificate.stdout:
                root_ca.write_text(certificate.stdout)
                break
            time.sleep(1)
        check(root_ca.is_file(), 'The local issuer created a public test root certificate')
        tls_context = ssl.create_default_context(cafile=str(root_ca))
        check(tls_context.check_hostname and tls_context.verify_mode == ssl.CERT_REQUIRED,
              'HTTPS verifies the certificate chain and requested hostname')
        local = Client(local_port)
        code, status, _ = local.json('status')
        check(code == 200 and status['data']['has_owner'], 'Enabling HTTPS preserves the existing installation owner and local access')
        code, local_login, _ = local.json('login', {'email': email, 'password': password}, status['data']['csrf'])
        check(code == 200 and local_login['data']['user']['role'] == 'owner', 'The existing owner can still sign in through the local SSH tunnel')
        code, local_rows, _ = local.request('/phpmyadmin/index.php?route=%2Fsql&db=bestuursatlas&table=digital_systems&server=1&lang=en')
        check(code == 200 and b'DigiD' in local_rows, 'Native phpMyAdmin table reads remain available through the local SSH tunnel')

        edge_http = http.client.HTTPConnection('127.0.0.1', http_port, timeout=20)
        edge_http.request('GET', '/', headers={'Host': DOMAIN})
        redirected = edge_http.getresponse()
        check(redirected.status in (301, 302, 307, 308) and redirected.getheader('Location', '').startswith('https://' + DOMAIN),
              'Public HTTP redirects to the exact HTTPS domain')
        redirected.read(); edge_http.close()
        guest = Client(tls_port, tls=tls_context)
        code, body, _ = guest.request('/')
        check(code == 200 and b'home-title' in body, 'Verified HTTPS serves the public homepage')
        code, body, headers = guest.request('/phpmyadmin/')
        location = dict((k.lower(), v) for k, v in headers).get('location', '')
        check(code == 302 and location == '/auth.php?mode=login' and b'phpMyAdmin' not in body,
              'A guest cannot enter native phpMyAdmin through HTTPS')
        code, status, _ = guest.json('status')
        check(code == 200 and status['data']['has_owner'] and status['data']['user'] is None,
              'HTTPS recognizes the owner without authenticating the guest')
        check(bool(guest.cookies['govern_session']['secure']) and bool(guest.cookies['govern_session']['httponly']),
              'HTTPS session cookies are Secure and HttpOnly')
        check(guest.cookies['govern_session']['samesite'].lower() == 'strict', 'HTTPS retains Strict SameSite cookies')
        code, signed_in, _ = guest.json('login', {'email': email, 'password': password}, status['data']['csrf'])
        check(code == 200 and signed_in['data']['user']['role'] == 'owner', 'Same-origin HTTPS login accepts the owner and current CSRF token')
        csrf = signed_in['data']['csrf']
        code, body, _ = guest.request('/workspace.php')
        check(code == 200 and b'app-shell' in body, 'The authenticated HTTPS session opens the workspace')
        code, body, _ = guest.request('/api.php?action=databases')
        check(code == 200 and json.loads(body)['ok'], 'The HTTPS session reaches database discovery')
        code, body, pma_headers = guest.request('/phpmyadmin/index.php?route=%2F&server=1&lang=en')
        check(code == 200 and b'phpMyAdmin' in body, 'The approved HTTPS session reaches official phpMyAdmin')
        check(('http://' + DOMAIN).encode() not in body, 'Native phpMyAdmin emits no insecure absolute domain URLs')
        code, native_rows, _ = guest.request('/phpmyadmin/index.php?route=%2Fsql&db=bestuursatlas&table=digital_systems&server=1&lang=en')
        check(code == 200 and b'digital_systems' in native_rows and b'DigiD' in native_rows and b'mysqli_sql_exception' not in native_rows,
              'Native phpMyAdmin executes a real read and displays seeded table rows over HTTPS')
        native_session = None
        for key, value in pma_headers:
            if key.lower() != 'set-cookie':
                continue
            for name, morsel in http.cookies.SimpleCookie(value).items():
                if name.lower().removeprefix('__secure-') == 'phpmyadmin_https':
                    native_session = morsel
        check(native_session is not None, 'Official phpMyAdmin sets its own HTTPS session cookie')
        check(bool(native_session['secure']) and bool(native_session['httponly']),
              'The native phpMyAdmin session is Secure and HttpOnly')
        check(native_session['path'].startswith('/phpmyadmin') and '/phpmyadmin/phpmyadmin/' not in native_session['path'],
              'The native HTTPS session retains a single phpMyAdmin cookie path')
        code, denied, _ = guest.json('logout', {}, csrf, {'Origin': 'https://other.test'})
        check(code == 403 and denied['error_code'] == 'origin_not_allowed', 'Cross-origin account changes remain rejected')
        code, retained, _ = guest.json('status', headers={'Origin': guest.origin, 'X-Forwarded-Proto': 'http'})
        check(code == 200 and retained['data']['user'] is not None and guest.cookies['govern_session']['secure'],
              'The private TLS listener supplies HTTPS independently from request headers')
        code, _, _ = local.json('status', headers={'Origin': local.origin, 'X-Forwarded-Proto': 'https'})
        check(code == 200 and not local.cookies['govern_session']['secure'], 'The local listener determines its own HTTP protocol')
        unknown = Client(tls_port, tls=tls_context)
        code, unknown_body, _ = unknown.request('/auth-api.php?action=status', headers={'Host': 'other.test'})
        check(code >= 400 or (code == 200 and not unknown_body), 'The public edge serves no Govern content for another host')
        gateway_id = command(compose + ['ps', '-q', 'gateway']).stdout.strip()
        bindings = json.loads(command(DOCKER + ['inspect', gateway_id, '--format', '{{json .HostConfig.PortBindings}}']).stdout)
        check(set(bindings) == {'80/tcp'} and all(item['HostIp'] == '127.0.0.1' for item in bindings['80/tcp']),
              'The gateway publishes only loopback; its TLS listener stays internal')
        for service in ('database', 'database-manager', 'app', 'phpmyadmin'):
            identity = command(compose + ['ps', '-q', service]).stdout.strip()
            bindings = json.loads(command(DOCKER + ['inspect', identity, '--format', '{{json .HostConfig.PortBindings}}']).stdout)
            check(not bindings, 'The ' + service + ' service has no published host ports')
        command(compose + ['restart', 'caddy'])
        for attempt in range(30):
            try:
                code, retained, _ = guest.json('status')
                if code == 200:
                    break
            except (OSError, http.client.HTTPException):
                pass
            time.sleep(.5)
        else:
            raise AssertionError('The restarted HTTPS edge did not become ready')
        check(retained['data']['user'] is not None, 'Restarting the edge preserves certificate trust and the authenticated installation')
        code, _, _ = guest.json('logout', {}, csrf)
        check(code == 200, 'HTTPS logout retains its CSRF contract')
        code, _, _ = guest.request('/phpmyadmin/')
        check(code == 302, 'Logout removes HTTPS access to native phpMyAdmin')
        print(json.dumps({'passed': len(checks), 'failed': 0, 'checks': checks}, indent=2))
    finally:
        if started and not args.keep_stack:
            # Preflight proved this random project had no containers/volumes.
            # Every removed resource belongs to this generated fixture only.
            cleanup = command(compose + ['down', '--volumes'], allow_failure=True)
            if cleanup.returncode:
                temporary._finalizer.detach()
                raise RuntimeError('Fixture cleanup failed; retained project ' + args.project + ' at ' + str(work))

        if args.keep_stack:
            print('Disposable fixture retained: ' + args.project + '; settings at ' + str(work))
            temporary._finalizer.detach()
        else:
            temporary.cleanup()


if __name__ == '__main__':
    main()
