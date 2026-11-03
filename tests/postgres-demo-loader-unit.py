#!/usr/bin/env python3
"""Check the sample-loader command boundary without accessing a real database."""
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


docker_fixture = '''#!/usr/bin/env python3
import json, os, subprocess, sys
args = sys.argv[1:]
with open(os.environ['GOVERN_DEMO_LOG'], 'a') as stream:
    stream.write(json.dumps({'docker': args}) + '\\n')
if args == ['info']:
    sys.exit(7 if os.environ.get('GOVERN_DEMO_FAILURE') == 'info' else 0)
assert args[:6] == ['compose', '--profile', 'postgres', 'exec', '-T', 'postgres']
if os.environ.get('GOVERN_DEMO_FAILURE') == 'exec': sys.exit(9)
sys.exit(subprocess.run(args[6:], input=sys.stdin.read(), text=True).returncode)
'''
psql_fixture = '''#!/usr/bin/env python3
import json, os, sys
with open(os.environ['GOVERN_DEMO_LOG'], 'a') as stream:
    stream.write(json.dumps({'psql': sys.argv[1:], 'sql': sys.stdin.read()}) + '\\n')
sys.exit(11 if os.environ.get('GOVERN_DEMO_FAILURE') == 'sql' else 0)
'''

for failure, database in [('', 'fixture_pg'), ('info', 'fixture_pg'), ('exec', 'fixture_pg'),
                          ('sql', 'fixture_pg'), ('', 'bad database'), ('', 'bad;database')]:
    with tempfile.TemporaryDirectory(prefix='govern-demo-loader-') as directory:
        workspace = Path(directory)
        (workspace / 'bin').mkdir()
        (workspace / 'docker/postgres').mkdir(parents=True)
        script = workspace / 'load-postgres-demo.sh'
        shutil.copy2(root / script.name, script)
        source = '-- fixture SQL streamed intact\nSELECT 1;\n'
        (workspace / 'docker/postgres/demo.sql').write_text(source)
        settings = workspace / '.env'
        settings.write_text('existing-settings=preserve\n')
        for name, content in [('docker', docker_fixture), ('psql', psql_fixture)]:
            tool = workspace / 'bin' / name
            tool.write_text(content)
            tool.chmod(0o700)
        log = workspace / 'commands.jsonl'
        environment = {**os.environ, 'PATH': str(workspace / 'bin') + os.pathsep + os.environ['PATH'],
                       'GOVERN_DEMO_LOG': str(log), 'GOVERN_DEMO_FAILURE': failure,
                       'POSTGRES_DB': database, 'POSTGRES_USER': 'postgres'}
        result = subprocess.run(['sh', str(script)], cwd=workspace.parent, env=environment,
                                capture_output=True, text=True)
        commands = [json.loads(line) for line in log.read_text().splitlines()]
        psql = next((command for command in commands if 'psql' in command), None)
        check(settings.read_text() == 'existing-settings=preserve\n', 'The loader does not change .env.')
        check(not any(any(word in command.get('docker', []) for word in ['up', 'down', 'run', 'stop', '-v'])
                      for command in commands), 'Loading does not start/stop services or remove volumes.')
        if not failure and database == 'fixture_pg':
            check(result.returncode == 0, 'Successful psql finishes the loader successfully.')
            check(psql is not None and psql['sql'] == source, 'The SQL file reaches psql through standard input.')
            check(psql['psql'] == ['-X', '--username=postgres', '--dbname=fixture_pg', '--set', 'ON_ERROR_STOP=1'],
                  'The configured container database and psql error handling are retained.')
            check('Sample data is ready.' in result.stdout, 'Success tells the user to refresh Govern.')
        else:
            check(result.returncode == {'info': 1, 'exec': 9, 'sql': 11}.get(failure, 1),
                  'Docker/SQL failures and invalid targets remain nonzero with the command status preserved.')
            check('Sample data is ready.' not in result.stdout, 'Failure does not advertise loaded data.')
            if failure != 'sql':
                check(psql is None, 'Prerequisite failures and invalid identifiers do not invoke psql.')

print(f'PostgreSQL sample-loader fixture checks: {checks} passed.')
