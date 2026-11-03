#!/usr/bin/env python3
"""Check VPS startup through a Docker command fixture; no server is contacted."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
checks = 0


def check(condition, message):
    global checks
    if not condition:
        raise AssertionError(message)
    checks += 1


fixture = r'''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
owner = args[-3:] == ['--entrypoint', 'php', 'app']
source = sys.stdin.read() if owner else ''
with open(os.environ['GOVERN_VPS_TEST_LOG'], 'a') as stream:
    stream.write(json.dumps({'args': args, 'domain': os.environ.get('GOVERN_DOMAIN'), 'source': source,
        'pg_environment': {key: os.environ.get(key) for key in ('PG_READ_PASSWORD', 'PG_PASSWORD', 'PG_ADMIN_PASSWORD')}}) + '\n')
failure = os.environ.get('GOVERN_VPS_TEST_FAILURE', '')
if failure == 'docker' and args == ['info']: sys.exit(1)
if failure == 'owner' and owner: sys.exit(1)
if failure == 'stopped' and 'exec' in args and 'app' in args: sys.exit(1)
if failure == 'config' and args[-2:] == ['config', '--quiet']: sys.exit(1)
if failure == 'up' and 'up' in args: sys.exit(1)
if failure == 'nginx' and args[-2:] == ['nginx', '-t']: sys.exit(1)
if failure == 'caddy' and args[-4:] == ['caddy', 'validate', '--config', '/etc/caddy/Caddyfile']: sys.exit(1)
if failure == 'reload' and args[-3:] == ['nginx', '-s', 'reload']: sys.exit(1)
if failure == 'caddyreload' and args[-4:] == ['caddy', 'reload', '--config', '/etc/caddy/Caddyfile']: sys.exit(1)
'''
settings = '# Existing installation\nAPP_PORT=8080\nDB_PASSWORD=private-existing-value\nDB_ROOT_PASSWORD=private-root-value\nCUSTOM_SETTING=$(touch should-not-exist)\n'
pg_keys = ('PG_READ_PASSWORD', 'PG_PASSWORD', 'PG_ADMIN_PASSWORD')
ready_pg = 'PG_READ_PASSWORD=existing-reader\nPG_PASSWORD=existing-writer\nPG_ADMIN_PASSWORD=existing-admin\n'


def setting_values(contents):
    return dict(line.split('=', 1) for line in contents.splitlines() if '=' in line and not line.startswith('#'))


def generated_password(value):
    return len(value) == 64 and all(character in '0123456789abcdef' for character in value)


def run(arguments=(), contents=settings, failure='', environment=None, script='start-vps.sh'):
    with tempfile.TemporaryDirectory(prefix='govern-vps-startup-') as directory:
        workspace = Path(directory)
        (workspace / 'scripts').mkdir()
        (workspace / 'bin').mkdir()
        for name in ('start.sh', 'start-vps.sh'):
            shutil.copy2(root / 'scripts' / name, workspace / 'scripts' / name)
        if contents is not None:
            (workspace / '.env').write_text(contents)
        docker = workspace / 'bin/docker'
        docker.write_text(fixture)
        docker.chmod(0o700)
        log = workspace / 'commands.jsonl'
        inherited = {key: value for key, value in os.environ.items()
                     if key not in {'GOVERN_DOMAIN', 'PG_ENABLED', *pg_keys}}
        inherited.update({'PATH': str(workspace / 'bin') + os.pathsep + os.environ['PATH'],
                          'GOVERN_VPS_TEST_LOG': str(log), 'GOVERN_VPS_TEST_FAILURE': failure,
                          **(environment or {})})
        result = subprocess.run(['sh', str(workspace / 'scripts' / script), *arguments],
                                env=inherited, capture_output=True, text=True)
        entries = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        saved = (workspace / '.env').read_text() if (workspace / '.env').exists() else None
        marker = (workspace / 'should-not-exist').exists()
        return result, entries, saved, marker


for invalid in ('', 'localhost', 'https://govern.example.nl', '*.example.nl', 'govern.example.nl:443',
                'govern.example.nl/path', 'a..example.nl', '-bad.example.nl', 'bad-.example.nl',
                'x' * 64 + '.example.nl', '1.2.3.4', 'bad_name.example.nl', 'example.nl\nother.nl',
                'example.nl;echo injected', 'example.nl ', 'example.nl\n', 'example.nl.', 'éxample.nl'):
    result, entries, saved, _ = run((invalid,))
    check(result.returncode != 0 and not entries, 'Reject invalid domain before Docker: ' + repr(invalid))
    check(saved == settings, 'Invalid domains leave settings unchanged.')

for arguments, contents in [(('govern.example.nl', 'extra.example.nl'), settings), (('govern.example.nl',), None)]:
    result, entries, _, _ = run(arguments, contents)
    check(result.returncode != 0 and not entries, 'Wrong arguments or missing private installation stop before Docker.')
    check('create the installation owner' in result.stderr or 'Usage:' in result.stderr,
          'The preflight gives a concrete next step.')

result, entries, saved, _ = run(('govern.example.nl',), failure='docker')
check(result.returncode != 0 and not any('up' in entry['args'] for entry in entries),
      'Unavailable Docker never starts a public service.')
check(saved == settings, 'Unavailable Docker does not save a domain.')

prefix = ['compose', '-f', 'compose.yaml', '-f', 'compose.vps.yaml']
for failure in ('', 'owner', 'config', 'up', 'nginx', 'caddy', 'reload', 'caddyreload'):
    result, entries, saved, marker = run(('Govern.Example.NL',), failure=failure)
    commands = [entry['args'] for entry in entries]
    owner = prefix + ['run', '--rm', '-T', '--no-deps', '--user', 'www-data', '--entrypoint', 'php', 'app']
    config = prefix + ['config', '--quiet']
    up = prefix + ['up', '-d', '--build', '--wait', '--wait-timeout', '180']
    nginx = prefix + ['exec', '-T', 'gateway', 'nginx', '-t']
    caddy = prefix + ['exec', '-T', 'caddy', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile']
    reload = prefix + ['exec', '-T', 'gateway', 'nginx', '-s', 'reload']
    caddy_reload = prefix + ['exec', '-T', 'caddy', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile']
    stop = prefix + ['stop', 'caddy']
    check(owner in commands, 'An existing owner is checked as the web user.')
    before_start = commands[:commands.index(up)] if up in commands else commands
    check(not any('exec' in command for command in before_start), 'Owner verification does not depend on running services.')
    source = next(entry['source'] for entry in entries if entry['args'] == owner)
    check('is_file($path)' in source and 'hasOwner()' in source, 'The check requires existing storage and the actual owner contract.')
    check(not any('down' in command or '--volumes' in command for command in commands), 'Startup never removes volumes or containers.')
    check(all(entry['domain'] == 'govern.example.nl' for entry in entries), 'Compose receives a validated normalized domain.')
    check('private-existing-value' not in result.stdout + result.stderr and 'private-root-value' not in result.stdout + result.stderr,
          'Credentials are never printed.')
    check(not marker, 'Unknown settings are preserved without shell evaluation.')
    if failure:
        check(result.returncode != 0 and commands[-1] == stop, 'Deployment failure stops only public Caddy.')
        check('Govern is configured for https://' not in result.stdout, 'Failure does not advertise completion.')
        if failure == 'owner':
            check(up not in commands and config not in commands, 'No public stack starts before owner verification.')
            check(saved == settings, 'Failed owner verification does not save a domain.')
    else:
        check(result.returncode == 0, 'A valid installation starts successfully.')
        check(commands.index(owner) < commands.index(config) < commands.index(up) < commands.index(nginx)
              < commands.index(caddy) < commands.index(reload) < commands.index(caddy_reload), 'Owner/readiness/configuration checks happen in order.')
        check(stop not in commands, 'Successful startup keeps HTTPS running.')
        check(saved.startswith(settings) and saved.count('GOVERN_DOMAIN=') == 1, 'Only the domain is added; credentials and unknown settings remain.')
        check('https://govern.example.nl' in result.stdout and 'does not verify public DNS' in result.stdout,
              'The URL is reported without claiming certificate issuance.')

for saved_pg, environment, profile in [('1', {}, True), ('1', {'PG_ENABLED': '0'}, False), ('0', {'PG_ENABLED': '1'}, True)]:
    contents = settings + 'GOVERN_DOMAIN=govern.example.nl\nPG_ENABLED=' + saved_pg + '\n' + ready_pg
    result, entries, saved, _ = run(contents=contents, environment=environment)
    check(result.returncode == 0, 'A saved domain can be reused.')
    commands = [entry['args'] for entry in entries if entry['args'][:1] == ['compose'] and entry['args'] != ['compose', 'version']]
    check(all(('--profile' in command) is profile for command in commands), 'Saved PostgreSQL and explicit environment overrides are respected.')
    check(saved == contents, 'A repeat run preserves settings byte-for-byte.')

contents = settings + 'GOVERN_DOMAIN=old.example.nl\nGOVERN_DOMAIN=govern.example.nl\n'
result, _, saved, _ = run(('new.example.nl',), contents)
check(result.returncode == 0 and saved.count('GOVERN_DOMAIN=') == 1 and 'GOVERN_DOMAIN=new.example.nl\n' in saved,
      'Changing domain replaces duplicate declarations only.')
check(saved.startswith(settings), 'Changing domain retains credentials and unrelated settings.')
result, _, saved, _ = run(environment={'GOVERN_DOMAIN': 'env.example.nl'})
check(result.returncode == 0 and 'GOVERN_DOMAIN=env.example.nl\n' in saved, 'An environment domain is validated and saved.')
result, entries, saved, _ = run(('govern.example.nl',), failure='stopped')
check(result.returncode == 0, 'An existing owner can be verified while the normal app container is stopped.')
check(any(entry['args'] == prefix + ['run', '--rm', '-T', '--no-deps', '--user', 'www-data', '--entrypoint', 'php', 'app'] for entry in entries),
      'The stopped-app path uses a temporary CLI container without ports or service dependencies.')

# The familiar Unix entrypoint must retain an opted-in VPS deployment on updates.
for environment, saved_domain, expected in [({}, 'saved.example.nl', 'saved.example.nl'),
                                           ({'GOVERN_DOMAIN': 'env.example.nl'}, 'saved.example.nl', 'env.example.nl')]:
    result, entries, saved, _ = run(contents=settings + 'GOVERN_DOMAIN=' + saved_domain + '\n', environment=environment, script='start.sh')
    check(result.returncode == 0 and any(entry['args'] == prefix + ['up', '-d', '--build', '--wait', '--wait-timeout', '180'] for entry in entries),
          'Normal Unix startup hands off to the VPS stack when a domain is set.')
    check('GOVERN_DOMAIN=' + expected + '\n' in saved, 'The handoff respects the selected domain.')
result, entries, saved, _ = run(contents=settings + 'GOVERN_DOMAIN=https://invalid.example.nl\n', script='start.sh')
check(result.returncode != 0 and not entries and 'GOVERN_DOMAIN=https://invalid.example.nl\n' in saved,
      'Invalid saved VPS configuration fails without silently starting the local stack.')

# Older PostgreSQL installations have reader/admin credentials but no writer yet.
legacy_pg = settings + 'GOVERN_DOMAIN=govern.example.nl\nPG_ENABLED=1\nPG_READ_PASSWORD=keep-reader\nPG_ADMIN_PASSWORD=keep-admin\n'
for script in ('start-vps.sh', 'start.sh'):
    result, entries, saved, marker = run(contents=legacy_pg, script=script)
    values = setting_values(saved)
    check(result.returncode == 0 and generated_password(values.get('PG_PASSWORD', '')),
          'Both VPS entrypoints generate the missing PostgreSQL writer password during upgrades.')
    check(saved.startswith(legacy_pg) and values['PG_READ_PASSWORD'] == 'keep-reader' and values['PG_ADMIN_PASSWORD'] == 'keep-admin',
          'Upgrade generation preserves existing reader/admin credentials and unrelated settings.')
    check(not marker and values['PG_PASSWORD'] not in result.stdout + result.stderr,
          'The new writer password is never printed and unknown shell-like settings stay literal.')
    repeated, _, repeated_saved, _ = run(contents=saved, script=script)
    check(repeated.returncode == 0 and repeated_saved == saved, 'Repeated VPS starts retain the generated writer password byte-for-byte.')

blank_pg = settings + 'GOVERN_DOMAIN=govern.example.nl\nPG_ENABLED=1\nPG_READ_PASSWORD=\nPG_PASSWORD=""\nPG_ADMIN_PASSWORD=\'\'\n'
result, _, saved, marker = run(contents=blank_pg)
values = setting_values(saved)
check(result.returncode == 0 and all(generated_password(values[key]) for key in pg_keys),
      'Missing and quoted-empty PostgreSQL reader/writer/admin passwords are generated.')
check(len({values[key] for key in pg_keys}) == 3 and all(saved.count(key + '=') == 1 for key in pg_keys),
      'Each PostgreSQL role receives its own saved password without duplicate placeholders.')
check(all(values[key] not in result.stdout + result.stderr for key in pg_keys) and not marker,
      'Generated role credentials are not printed or evaluated.')
check(settings in saved and 'PG_ENABLED=1\n' in saved, 'Unrelated settings remain intact when blank credentials are filled.')
repeated, _, repeated_saved, _ = run(contents=saved)
check(repeated.returncode == 0 and repeated_saved == saved, 'A second full-password startup changes no saved settings.')

literal_pg = settings + 'GOVERN_DOMAIN=govern.example.nl\nPG_ENABLED=1\nPG_READ_PASSWORD=\'reader $ # !\'\nPG_PASSWORD=" writer $ # ! "\nPG_ADMIN_PASSWORD=\'admin " literal\'\n'
result, _, saved, _ = run(contents=literal_pg)
check(result.returncode == 0 and saved == literal_pg,
      'Non-empty quoted credentials, including spaces and punctuation, are preserved exactly.')

environment_pg = {key: 'environment-' + key + '-$# value' for key in pg_keys}
result, entries, saved, _ = run(contents=blank_pg, environment=environment_pg)
check(result.returncode == 0 and saved == blank_pg, 'Explicit environment credentials are not replaced or persisted into .env.')
check(all(entry['pg_environment'] == environment_pg for entry in entries), 'All Compose calls retain existing environment credential bindings.')
check(all(value not in result.stdout + result.stderr for value in environment_pg.values()), 'Environment credentials are never printed.')

existing_pg = settings + 'GOVERN_DOMAIN=govern.example.nl\nPG_ENABLED=1\n' + ready_pg
result, entries, saved, _ = run(contents=existing_pg, environment={key: '' for key in pg_keys})
up_entry = next(entry for entry in entries if 'up' in entry['args'])
check(result.returncode == 0 and saved == existing_pg, 'Empty exported credentials retain existing saved passwords.')
check(all(up_entry['pg_environment'][key] is None for key in pg_keys), 'Empty environment overrides are removed before Compose uses .env credentials.')

result, entries, saved, _ = run(contents=blank_pg, environment={key: '' for key in pg_keys})
values = setting_values(saved)
up_entry = next(entry for entry in entries if 'up' in entry['args'])
check(result.returncode == 0 and all(generated_password(values[key]) for key in pg_keys),
      'Empty environment bindings also permit generation of missing saved credentials.')
check(all(up_entry['pg_environment'][key] is None for key in pg_keys), 'Generated passwords are not masked by exported empty strings at startup.')

result, _, saved, _ = run(contents=blank_pg, failure='owner')
check(result.returncode != 0 and saved == blank_pg, 'A failed owner check never generates PostgreSQL credentials or edits settings.')
result, _, saved, _ = run(contents=blank_pg, environment={'PG_ENABLED': '0'})
check(result.returncode == 0 and saved == blank_pg, 'An explicit PostgreSQL opt-out leaves missing credentials untouched.')

print(f'VPS startup fixture checks: {checks} passed.')
