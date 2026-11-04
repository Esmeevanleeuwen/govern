#!/usr/bin/env python3
"""Database-free trust and request-boundary tests for the checkpoint helper."""
import importlib.util
import os
from pathlib import Path
import re
import sys
import subprocess
import tempfile
root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('govern_tools_unit', root / 'docker/postgres-tools/server.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
env = {'PGDATABASE': 'govern_pg', 'PG_SCHEMAS': 'public,archive', 'PGUSER': 'postgres', 'PGPASSWORD': 'unit-admin',
       'PG_READ_USER': 'govern_reader', 'PG_READ_PASSWORD': 'unit-reader', 'PG_USER': 'govern_writer',
       'PG_SQL_USER': 'govern_sql', 'PG_RESTORE_USER': 'govern_restore', 'PG_RESTORE_PASSWORD': 'unit-restore'}
tools = worker.Tools(env)
checks = 0

def check(condition, description):
    global checks
    if not condition:
        raise AssertionError(description)
    checks += 1

def denied(action, code):
    try:
        action()
    except worker.Failure as failure:
        check(failure.code == code, f'Expected {code}, got {failure.code}')
        return
    raise AssertionError('Expected ' + code)

for request in [None, [], {}, {'action': 'list', 'database': 'other', 'schema': 'public'},
                {'action': 'list', 'database': 'govern_pg', 'schema': 'pg_catalog'},
                {'action': 'list', 'database': 'govern_pg', 'schema': 'public', 'path': '/etc/passwd'},
                {'action': 'create', 'database': 'govern_pg', 'schema': 'public', 'label': 'x', 'sql': 'SELECT 1'}]:
    denied(lambda: tools.request(request), 'postgres_tools_invalid')
check(tools.process_env('reader')['PGUSER'] == 'govern_reader', 'Dump uses actual reader.')
check(tools.process_env('restore')['PGUSER'] == 'govern_restore', 'Restore uses actual restricted login.')
check('standard_conforming_strings=on' in tools.process_env('admin')['PGOPTIONS'], 'Admin literals use fixed lexical settings.')
body = tools.drop_sql("a$govern_drop$'b")
delimiter = re.search(r'DO (\$govern_[a-f0-9]+\$)', body).group(1)
check(body.count(delimiter) == 2 and "a$govern_drop$''b" in body, 'Schema cannot terminate generated DO delimiter.')
(root / 'work').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='pg-tools-unit-', dir=root / 'work') as temporary:
    temporary = Path(temporary)
    data = temporary / 'untrusted.dump'
    data.write_bytes(b'PGDMP-unit')
    if os.geteuid() == 0:
        check(worker.Tools.read_file(data, 100) == b'PGDMP-unit', 'Immutable root-created bytes are readable.')
        data.chmod(0o622)
        denied(lambda: worker.Tools.read_file(data, 100), 'snapshot_invalid')
        data.chmod(0o600)
        os.chown(data, 33, 33)
    denied(lambda: worker.Tools.read_file(data, 100), 'snapshot_invalid')
    link = temporary / 'symlink.dump'
    link.symlink_to(data)
    denied(lambda: worker.Tools.read_file(link, 100), 'snapshot_missing')
    oversized = temporary / 'oversized.dump'
    command = [sys.executable, '-c', 'import pathlib,sys; pathlib.Path(sys.argv[1]).write_bytes(b"x" * int(sys.argv[2]))']
    denied(lambda: tools.run(command + [str(oversized), '2048'], max_file_bytes=1024), 'postgres_snapshot_failed')
    check(oversized.stat().st_size <= 1024, 'Child file limit stops a dump before it exceeds the cap.')
    small = temporary / 'small.dump'
    tools.run(command + [str(small), '512'], max_file_bytes=1024)
    check(small.read_bytes() == b'x' * 512, 'A file below the child limit is written normally.')
    inherited = worker.resource.getrlimit(worker.resource.RLIMIT_FSIZE)
    try:
        worker.resource.setrlimit(worker.resource.RLIMIT_FSIZE, (512, inherited[1]))
        limited = temporary / 'inherited.dump'
        denied(lambda: tools.run(command + [str(limited), '768'], max_file_bytes=1024), 'postgres_snapshot_failed')
        check(limited.stat().st_size <= 512, 'A lower inherited file limit is preserved.')
    finally:
        worker.resource.setrlimit(worker.resource.RLIMIT_FSIZE, inherited)
for key, value in [("PG_TOOLS_OWNER_UID", "bad"), ("PG_TOOLS_OWNER_UID", "33"),
                   ("PG_TOOLS_OWNER_UID", "2147483648"), ("PG_TOOLS_GID", "-1")]:
    environment = dict(os.environ)
    environment[key] = value
    result = subprocess.run([sys.executable, str(root / 'docker/postgres-tools/server.py'), '--health'],
                            env=environment, capture_output=True, text=True)
    check(result.returncode != 0, 'Invalid private service identity is rejected before socket or database use.')
    check(result.stderr.strip() == 'postgres_tools_invalid', 'Invalid identity emits only a fixed code.')
print(f'PASS: {checks} private PostgreSQL helper request/file/role/lexical checks.')
