#!/usr/bin/env python3
"""Database-free trust and request-boundary tests for the checkpoint helper."""
import importlib.util
import os
from pathlib import Path
import re
import sys
import tempfile
from unittest.mock import patch
root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('govern_tools_unit', root / 'docker/postgres-tools/server.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
env = {'PGDATABASE': 'govern_pg', 'PG_SCHEMAS': 'public,archive', 'PGUSER': 'postgres', 'PGPASSWORD': 'unit-admin',
       'PG_READ_USER': 'govern_reader', 'PG_READ_PASSWORD': 'unit-reader', 'PG_USER': 'govern_writer',
       'PG_PASSWORD': 'unit-writer', 'PG_SQL_USER': 'govern_sql', 'PG_SQL_PASSWORD': 'unit-sql',
       'PG_RESTORE_USER': 'govern_restore', 'PG_RESTORE_PASSWORD': 'unit-restore'}
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
check(tools.process_env('writer')['PGUSER'] == 'govern_writer', 'Provision checks use actual writer login.')
check(tools.process_env('sql')['PGUSER'] == 'govern_sql', 'Provision checks use actual SQL login.')
read_only = worker.Tools({key: value for key, value in env.items() if key not in ('PG_PASSWORD', 'PG_SQL_PASSWORD')})
check(read_only.database == 'govern_pg', 'Checkpoint configuration remains valid without optional SQL/writer passwords.')
denied(lambda: read_only.request({'action': 'prepare_database', 'name': 'requires_sql_credentials'}), 'database_prepare_failed')
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

    for name in ['', 'postgres', 'POSTGRES', 'template0', 'Template1', 'pg_private', 'PG_private',
                 'a' * 64, 'has-space ', '../other', 'x;DROP DATABASE x', 3, None]:
        denied(lambda name=name: tools.request({'action': 'prepare_database', 'name': name}), 'database_create_invalid')
    denied(lambda: tools.request({'action': 'prepare_database', 'name': 'valid', 'sql': 'SELECT 1'}), 'database_create_invalid')
    check(worker.database_name('A_1') and worker.database_name('a' * 63), 'New names preserve case and PostgreSQL byte limit.')

    if os.geteuid() == 0:
        registry = worker.DatabaseRegistry(str(temporary / 'management' / 'databases.json'))
        registry.initialize()
        check(registry.read() == [], 'Worker initializes an empty completed-name registry.')
        metadata = registry.path.stat()
        check(metadata.st_uid == 0 and metadata.st_gid == 33 and metadata.st_mode & 0o777 == 0o640,
              'Registry is root-owned and read-only for the app group.')
        with registry.path.open('rb') as previous:
            with registry.locked():
                registry.write(['managed_one'])
            check(previous.read() == b'{"version":1,"databases":[]}\n' and registry.read() == ['managed_one'],
                  'Atomic replacement preserves complete bytes for readers of the previous inode.')
        scoped_tools = worker.Tools({**env, 'PG_DATABASE_REGISTRY': str(registry.path)})
        with patch.object(worker.Tools, 'list', lambda self, schema: [self.database, schema, self.schemas]):
            check(scoped_tools.request({'action': 'list', 'database': 'managed_one', 'schema': 'public'})
                  == ['managed_one', 'public', ['public']], 'Registered DB routes snapshots to its own immutable context.')
            check(scoped_tools.request({'action': 'list', 'database': 'govern_pg', 'schema': 'archive'})
                  == ['govern_pg', 'archive', ['public', 'archive']], 'Configured schemas retain their original scope.')
            check(scoped_tools.database == 'govern_pg' and scoped_tools.schemas == ['public', 'archive'],
                  'A managed DB request never changes the shared configured context.')
        denied(lambda: scoped_tools.request({'action': 'list', 'database': 'managed_one', 'schema': 'archive'}), 'postgres_tools_invalid')
        denied(lambda: scoped_tools.request({'action': 'list', 'database': 'unmanaged', 'schema': 'public'}), 'postgres_tools_invalid')
        for raw in [b'{"version":true,"databases":[]}', b'{"version":1,"databases":["a","a"]}',
                    b'{"version":1,"databases":["postgres"]}', b'{"version":1,"databases":{},"path":"x"}',
                    b'{"version":1,"databases":[{}]}', b'x' * (worker.MAX_REGISTRY + 1)]:
            registry.path.write_bytes(raw)
            denied(registry.read, 'postgres_tools_invalid')
        registry.write(['managed_one'])
        registry.path.chmod(0o660)
        denied(registry.read, 'postgres_tools_invalid')
        registry.path.chmod(0o640)
        os.chown(registry.path, 33, 33)
        denied(registry.read, 'postgres_tools_invalid')
        os.chown(registry.path, 0, 33)
        registry.path.parent.chmod(0o770)
        denied(registry.read, 'postgres_tools_invalid')
        registry.path.parent.chmod(0o750)
        actual = registry.path.with_name('actual.json')
        registry.path.rename(actual)
        registry.path.symlink_to(actual)
        denied(registry.read, 'postgres_tools_invalid')
        registry.path.unlink()
        actual.rename(registry.path)
        denied(lambda: registry.encoded(['a' * 63] * 1000), 'database_prepare_failed')

        calls = []
        def unrelated_sql(self, sql, **options):
            calls.append(sql)
            if sql.startswith('SELECT count(*)=4'):
                return 't'
            if sql.startswith('SELECT (datdba='):
                return 't|f'
            raise AssertionError('An unrelated database reached a privileged mutation.')
        with patch.object(worker.Tools, 'sql', unrelated_sql):
            denied(lambda: scoped_tools.request({'action': 'prepare_database', 'name': 'unrelated'}), 'database_prepare_failed')
        check(len(calls) == 2 and registry.read() == ['managed_one'], 'Unknown existing DB is neither granted nor registered.')

        def creation_sql(self, sql, **options):
            calls.append((self.database, sql, options.get('role', 'admin')))
            if sql.startswith('SELECT count(*)=4'):
                return 't'
            if sql.startswith('SELECT (datdba='):
                return ''
            return ''
        calls.clear()
        with patch.object(worker.Tools, 'sql', creation_sql):
            result = scoped_tools.request({'action': 'prepare_database', 'name': 'created_here'})
        create = next(sql for _, sql, _ in calls if sql.startswith('CREATE DATABASE'))
        rename = next(sql for _, sql, _ in calls if sql.startswith('COMMENT ON DATABASE'))
        check('ALLOW_CONNECTIONS false' in create and '"created_here"' not in create,
              'Final database name is never created without provenance.')
        check(rename.index('COMMENT ON DATABASE') < rename.index('RENAME TO "created_here"')
              and 'govern-created-database-v1:created_here' in rename, 'Staging provenance binds the exact final name before rename.')
        connect = next(sql for _, sql, _ in calls if 'ALLOW_CONNECTIONS true' in sql)
        check(connect.index('REVOKE ALL ON DATABASE "created_here" FROM PUBLIC;') < connect.index('ALLOW_CONNECTIONS true'),
              'Default public access is revoked while the new database is still disconnected.')
        check(result == {'database': 'created_here', 'created': True} and registry.read() == ['managed_one', 'created_here'],
              'Only a fully prepared DB enters the completed registry.')
        check({role for db, sql, role in calls if db == 'created_here' and sql == 'SELECT 1;'} == {'reader', 'writer', 'sql', 'restore'},
              'All four restricted real logins are checked before registration.')
        grants = next(sql for db, sql, _ in calls if db == 'created_here' and sql.startswith('BEGIN;'))
        check('ALTER DEFAULT PRIVILEGES FOR ROLE "govern_sql" IN SCHEMA "public" GRANT SELECT ON TABLES TO "govern_reader";' in grants
              and 'GRANT CONNECT ON DATABASE "created_here" TO "govern_writer";' in grants
              and 'GRANT USAGE ON SCHEMA "public" TO "govern_writer";' in grants
              and 'GRANT USAGE,CREATE ON SCHEMA "public" TO "govern_writer";' not in grants,
              'New DB grants preserve reader/writer restrictions and SQL-created table visibility.')

        def marked_sql(self, sql, **options):
            if sql.startswith('SELECT count(*)=4'):
                return 't'
            if sql.startswith('SELECT (datdba='):
                return 't|t'
            if sql.startswith('CREATE DATABASE') or 'RENAME TO' in sql:
                raise AssertionError('A retry replaced the existing marked database.')
            return ''
        with patch.object(worker.Tools, 'sql', marked_sql):
            result = scoped_tools.request({'action': 'prepare_database', 'name': 'interrupted_before_registry'})
        check(result == {'database': 'interrupted_before_registry', 'created': False}
              and 'interrupted_before_registry' in registry.read(), 'Marked admin-owned partial provisioning retries without replacing data.')
        with patch.object(worker.Tools, 'sql', lambda self, sql, **options: 't' if sql.startswith('SELECT count(*)=4') else 'f|t'):
            denied(lambda: scoped_tools.request({'action': 'prepare_database', 'name': 'marked_wrong_owner'}), 'database_prepare_failed')

print(f'PASS: {checks} private PostgreSQL helper request/file/role/lexical/registry/provisioning checks.')
