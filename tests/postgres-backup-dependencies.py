#!/usr/bin/env python3
"""Exercise checkpoint dependency boundaries in an isolated PostgreSQL database."""
import argparse
import importlib.util
from pathlib import Path
import secrets
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--confirm-project', required=True)
    parser.add_argument('--confirm-database', required=True, choices=['govern_pg'])
    parser.add_argument('--env-file')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]

    spec = importlib.util.spec_from_file_location(
        'govern_checkpoint_dependency_review', root / 'docker/postgres-tools/server.py')
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    tools = worker.Tools.__new__(worker.Tools)
    queries = []
    tools.sql = lambda query: queries.append(query) or 'f'
    suffix = secrets.token_hex(4)
    selected = 'govern_guard_a_' + suffix
    outside = 'govern_guard_b_' + suffix
    tools.external_dependencies(selected)
    guard = queries[-1].strip().rstrip(';')
    selected = worker.identifier(selected)
    outside = worker.identifier(outside)

    def check_sql(label):
        return f"SELECT '{label}|' || ({guard})::text;\n"

    # Every fixture, including schema creation, rolls back in one connection.
    sql = f"""DO $verify$ BEGIN
      IF current_database() <> 'govern_pg' THEN
        RAISE EXCEPTION 'Dependency checks require the isolated govern_pg database';
      END IF;
    END $verify$;
    BEGIN;
    CREATE SCHEMA {selected};
    CREATE SCHEMA {outside};
    CREATE TABLE {selected}.t(id bigint PRIMARY KEY, note text);
    CREATE TABLE {outside}.t(id bigint PRIMARY KEY);
    """ + check_sql('same_schema_toast_allowed') + f"""
    SAVEPOINT incoming_fk;
    CREATE TABLE {outside}.child(id bigint REFERENCES {selected}.t(id));
    """ + check_sql('incoming_fk_blocked') + f"""
    ROLLBACK TO SAVEPOINT incoming_fk;
    RELEASE SAVEPOINT incoming_fk;
    SAVEPOINT incoming_view;
    CREATE VIEW {outside}.v AS SELECT * FROM {selected}.t;
    """ + check_sql('incoming_view_blocked') + f"""
    ROLLBACK TO SAVEPOINT incoming_view;
    RELEASE SAVEPOINT incoming_view;
    SAVEPOINT outgoing_fk;
    ALTER TABLE {selected}.t ADD COLUMN ref bigint REFERENCES {outside}.t(id);
    """ + check_sql('outgoing_fk_allowed') + f"""
    ROLLBACK TO SAVEPOINT outgoing_fk;
    RELEASE SAVEPOINT outgoing_fk;
    SAVEPOINT outside_trigger;
    CREATE FUNCTION {selected}.trigger_f() RETURNS trigger LANGUAGE plpgsql
      AS $trigger$ BEGIN RETURN NEW; END $trigger$;
    CREATE TRIGGER outside_trigger BEFORE INSERT ON {outside}.t
      FOR EACH ROW EXECUTE FUNCTION {selected}.trigger_f();
    """ + check_sql('standalone_external_trigger_blocked') + f"""
    ROLLBACK TO SAVEPOINT outside_trigger;
    RELEASE SAVEPOINT outside_trigger;
    CREATE FUNCTION {selected}.f() RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
    CREATE VIEW {selected}.v AS SELECT {selected}.f() AS id;
    CREATE VIEW {outside}.v AS SELECT * FROM {selected}.v;
    """ + check_sql('nested_external_view_blocked') + "ROLLBACK;\n"

    command = ['docker', 'compose']
    if args.env_file:
        command += ['--env-file', args.env_file]
    command += ['--project-name', args.confirm_project, '--profile', 'postgres',
                'exec', '-T', 'postgres', 'sh', '-c',
                'test "$POSTGRES_DB" = govern_pg && exec psql -X -qAt '
                '--username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1']
    result = subprocess.run(command, input=sql, text=True, capture_output=True, cwd=root)
    if result.returncode:
        raise RuntimeError('Dependency fixture or guard query failed: ' + result.stderr[-2000:])
    observed = dict(line.split('|', 1) for line in result.stdout.splitlines() if '|' in line)
    expected = {
        'same_schema_toast_allowed': 'false',
        'incoming_fk_blocked': 'true',
        'incoming_view_blocked': 'true',
        'outgoing_fk_allowed': 'false',
        'standalone_external_trigger_blocked': 'true',
        'nested_external_view_blocked': 'true',
    }
    if observed != expected:
        raise AssertionError(f'Expected dependency boundaries {expected}, got {observed}')
    print('PostgreSQL checkpoint dependency checks: 6 passed (all fixtures rolled back).')


if __name__ == '__main__':
    main()
