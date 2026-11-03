#!/usr/bin/env python3
"""Load demo data only in an explicitly confirmed, disposable Compose project.

Requires the ordinary PostgreSQL integration fixtures. Creates and removes one
owned collision probe, then leaves the complete example dataset available for
the browser suite. Never point this at a working installation.
"""
import argparse
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-project", required=True)
    parser.add_argument("--confirm-database", required=True)
    args = parser.parse_args()
    if args.confirm_database != "govern_pg" or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", args.confirm_project):
        raise RuntimeError("Confirm the disposable Compose project and its govern_pg fixture database")
    root = Path(__file__).resolve().parents[1]
    seed = (root / "docker/postgres/demo.sql").read_text()
    prefix = ["docker", "compose", "--project-name", args.confirm_project, "--profile", "postgres", "exec", "-T"]
    checks = 0

    def check(condition, message):
        nonlocal checks
        if not condition:
            raise AssertionError(message)
        checks += 1

    def run(sql, *, reader=False, variables=None):
        command = prefix.copy()
        for name, value in (variables or {}).items():
            command += ["--env", name + "=" + value]
        client = ('test "$POSTGRES_DB" = govern_pg && '
                  + ('PGPASSWORD="$PG_READ_PASSWORD" ' if reader else '')
                  + 'exec psql -X --set ON_ERROR_STOP=1 --quiet --tuples-only --no-align '
                  + ('--host=127.0.0.1 --username "$PG_READ_USER" ' if reader else '--username "$POSTGRES_USER" ')
                  + '--dbname "$POSTGRES_DB"')
        return subprocess.run(command + ["postgres", "sh", "-c", client], input=sql, cwd=root,
                              capture_output=True, text=True, timeout=60)

    def query(sql, *, reader=False):
        result = run(sql, reader=reader)
        if result.returncode:
            raise RuntimeError("PostgreSQL fixture query failed: " + result.stderr)
        return result.stdout.strip()

    names = ["demo_organizations", "demo_systems", "demo_projects", "demo_contacts",
             "demo_project_participants", "demo_project_overview"]
    quoted_names = ",".join("'" + name + "'" for name in names)
    object_count = ("SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace "
                    "WHERE n.nspname='public' AND c.relname IN (" + quoted_names + ");")
    check(query(object_count) == "0", "The demo tests require a fresh isolated public namespace")
    existing = query("SELECT json_agg(row_to_json(t)) FROM (SELECT * FROM public.govern_pg_values ORDER BY id) t;")

    result = run(seed, variables={"PG_SCHEMAS": "archive"})
    check(result.returncode != 0 and "PG_SCHEMAS must include public" in result.stdout + result.stderr,
          "Excluded public schemas fail before creating objects")
    check(query(object_count) == "0", "An excluded schema leaves no partial demo objects")
    result = run(seed, variables={"PG_READ_USER": "govern_demo_missing_reader"})
    check(result.returncode != 0 and "separate PostgreSQL reader role" in result.stdout + result.stderr,
          "A missing reader role is rejected before creating objects")
    check(query(object_count) == "0", "A missing reader leaves no partial demo objects")

    query("CREATE TABLE public.demo_organizations(id integer PRIMARY KEY, note text); "
          "INSERT INTO public.demo_organizations VALUES (9001, 'owned collision probe');")
    try:
        result = run(seed)
        check(result.returncode != 0 and "A demo object name already exists" in result.stderr,
              "An existing name collision fails the load")
        check(query("SELECT note FROM public.demo_organizations WHERE id=9001;") == "owned collision probe",
              "The collision probe keeps its original records")
        check(query(object_count) == "1", "A failed load creates no other demo objects")
    finally:
        # This is the probe created by this test, not a working demo table.
        query("DROP TABLE public.demo_organizations;")

    result = run(seed)
    check(result.returncode == 0, "The first demo load succeeds: " + result.stderr)
    check(query(object_count) == "6", "The load creates five tables and one view")
    expected = {"demo_organizations": 5, "demo_systems": 6, "demo_projects": 8,
                "demo_contacts": 8, "demo_project_participants": 12}
    for name, count in expected.items():
        check(query("SELECT count(*) FROM public." + name + ";") == str(count), "Expected records in " + name)
    check(query("SELECT count(*) FROM public.demo_project_overview;") == "8", "The overview view contains eight joined records")
    check(query("SELECT lead_organization FROM public.demo_project_overview WHERE id=1;") == "Northbridge Council",
          "The view joins the real example relationships")
    check(query("SELECT count(*) FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class t ON t.oid=c.conrelid "
                "JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace WHERE c.contype='f' AND n.nspname='public' "
                "AND t.relname IN (" + quoted_names + ");") == "6", "The five tables have six real foreign keys")
    check(query("SELECT count(*) FROM public.demo_systems;", reader=True) == "6", "The application reader can browse the new tables")
    check(query("SELECT count(*) FROM public.demo_project_overview;", reader=True) == "8", "The application reader can browse the invoker-rights view")
    check(query("SELECT has_table_privilege(current_user,'public.demo_systems','INSERT') OR "
                "has_table_privilege(current_user,'public.demo_systems','UPDATE') OR "
                "has_table_privilege(current_user,'public.demo_systems','DELETE');", reader=True) == "f",
          "The loader grants no data-writing privileges to the application reader")
    result = run("UPDATE public.demo_organizations SET name='reader must not write' WHERE id=1;", reader=True)
    check(result.returncode != 0, "An actual write from the application reader is rejected")

    original = query("SELECT name FROM public.demo_organizations WHERE id=1;")
    query("UPDATE public.demo_organizations SET name='Edited fictional organization' WHERE id=1;")
    try:
        result = run(seed)
        check(result.returncode == 0 and "already exist" in result.stdout, "Repeating a recognized demo load succeeds without reinserting")
        check(query("SELECT name FROM public.demo_organizations WHERE id=1;") == "Edited fictional organization",
              "Repeating the load preserves edited example records")
        for name, count in expected.items():
            check(query("SELECT count(*) FROM public." + name + ";") == str(count), "Repeating the load keeps counts in " + name)
    finally:
        # Restore only the test's edit, leaving the useful demo available.
        query("UPDATE public.demo_organizations SET name='Northbridge Council' WHERE id=1;")
    check(original == "Northbridge Council", "The reader's rejected write changed no example data")
    check(query("SELECT json_agg(row_to_json(t)) FROM (SELECT * FROM public.govern_pg_values ORDER BY id) t;") == existing,
          "Existing non-demo integration tables and records remain unchanged")
    print(f"PASS: {checks} PostgreSQL demo guards, atomicity, records, relations, permissions and repeat-load checks.")


if __name__ == "__main__":
    main()
