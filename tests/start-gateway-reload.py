#!/usr/bin/env python3
"""Exercise startup/reload ordering and fail-closed exits with a Docker fixture."""
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


fixture = '''#!/usr/bin/env python3
import json, os, sys
with open(os.environ['GOVERN_START_TEST_LOG'], 'a') as stream:
    stream.write(json.dumps(sys.argv[1:]) + '\\n')
args = sys.argv[1:]
failure = os.environ.get('GOVERN_START_TEST_FAILURE', '')
if failure == 'up' and args[:2] == ['compose', 'up']: sys.exit(1)
if failure == 'check' and args[-2:] == ['nginx', '-t']: sys.exit(1)
if failure == 'reload' and args[-3:] == ['nginx', '-s', 'reload']: sys.exit(1)
'''

for failure in ('', 'up', 'check', 'reload'):
    with tempfile.TemporaryDirectory(prefix='govern-start-test-') as directory:
        workspace = Path(directory)
        (workspace / 'scripts').mkdir()
        (workspace / 'bin').mkdir()
        shutil.copy2(root / 'scripts/start.sh', workspace / 'scripts/start.sh')
        (workspace / '.env').write_text('APP_PORT=8089\n')
        docker = workspace / 'bin/docker'
        docker.write_text(fixture)
        docker.chmod(0o700)
        log = workspace / 'commands.jsonl'
        environment = {**os.environ, 'PATH': str(workspace / 'bin') + os.pathsep + os.environ['PATH'],
                       'GOVERN_START_TEST_LOG': str(log), 'GOVERN_START_TEST_FAILURE': failure}
        result = subprocess.run(['sh', str(workspace / 'scripts/start.sh')], env=environment, capture_output=True, text=True)
        commands = [json.loads(line) for line in log.read_text().splitlines()]
        up = ['compose', 'up', '-d', '--build', '--wait', '--wait-timeout', '180']
        config_check = ['compose', 'exec', '-T', 'gateway', 'nginx', '-t']
        reload = ['compose', 'exec', '-T', 'gateway', 'nginx', '-s', 'reload']
        stop = ['compose', 'stop', 'gateway']
        check(up in commands, 'Startup always waits for the Compose stack.')
        check(not any('down' in command or '-v' in command for command in commands), 'Startup never removes containers or volumes.')
        if not failure:
            check(result.returncode == 0, 'A successful reload produces a successful startup.')
            check(commands.index(up) < commands.index(config_check) < commands.index(reload), 'Configuration validation precedes gateway reload after stack readiness.')
            check(stop not in commands, 'Successful startup leaves the gateway running.')
            check('http://localhost:8089' in result.stdout, 'Successful startup reports the configured entry point.')
        else:
            check(result.returncode != 0, 'Partial startup or reload failure is visible to the caller.')
            check(commands[-1] == stop, 'A failure stops only the gateway, retaining persisted data.')
            check('Open Govern op' not in result.stdout, 'A failed start does not advertise a working entry point.')
            if failure == 'up':
                check(config_check not in commands and reload not in commands, 'A failed stack is not reloaded.')
            elif failure == 'check':
                check(config_check in commands and reload not in commands, 'An invalid configuration is never reloaded.')
            else:
                check(commands.index(config_check) < commands.index(reload) < commands.index(stop), 'A failed reload closes the old gateway after configuration validation.')

print(f'Startup gateway fixture checks: {checks} passed.')
