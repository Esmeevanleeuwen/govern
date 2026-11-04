#!/bin/bash
set -euo pipefail

# Only private bootstrap/tools services receive the administrator credential.
: "${PGDATABASE:?Missing PostgreSQL database}"
: "${PGPASSWORD:?Missing PostgreSQL bootstrap password; run start.cmd or start.sh}"
: "${PG_READ_USER:?Missing PostgreSQL reader name}"
: "${PG_READ_PASSWORD:?Missing PostgreSQL reader password; run start.cmd or start.sh}"
: "${PG_USER:?Missing PostgreSQL row writer name}"
: "${PG_PASSWORD:?Missing PostgreSQL row writer password; run start.cmd or start.sh}"
: "${PG_SQL_USER:?Missing PostgreSQL SQL role name}"
: "${PG_SQL_PASSWORD:?Missing PostgreSQL SQL password; run start.cmd or start.sh}"
: "${PG_RESTORE_USER:?Missing PostgreSQL restricted restore role name}"
: "${PG_RESTORE_PASSWORD:?Missing PostgreSQL restore password; run start.cmd or start.sh}"
export PG_SCHEMAS="${PG_SCHEMAS:-public}"
declare -A role_names=()
for role_name in "$PG_READ_USER" "$PG_USER" "$PG_SQL_USER" "$PG_RESTORE_USER"; do
    if [ "$role_name" = "$PGUSER" ] || [ "${role_name,,}" = root ] || [ "${role_name,,}" = postgres ] || [[ "$role_name" = pg_* ]] \
        || [[ ! "$role_name" =~ ^[A-Za-z0-9_]{1,63}$ ]] || [ -n "${role_names[$role_name]:-}" ]; then
        echo 'PostgreSQL requires distinct, non-reserved application roles.' >&2
        exit 1
    fi
    role_names[$role_name]=1
done

psql -X -q --set ON_ERROR_STOP=1 <<'SQL'
\getenv reader PG_READ_USER
\getenv reader_password PG_READ_PASSWORD
\getenv writer PG_USER
\getenv writer_password PG_PASSWORD
\getenv sql_role PG_SQL_USER
\getenv sql_password PG_SQL_PASSWORD
\getenv restorer PG_RESTORE_USER
\getenv restore_password PG_RESTORE_PASSWORD
\getenv database PGDATABASE
\getenv schemas PG_SCHEMAS

-- Reader/row writer never own objects or inherit DDL. SQL/restore owners
-- are accepted only inside configured schemas, including associated TOAST data.
WITH allowed AS (SELECT btrim(unnest(string_to_array(:'schemas', ','))) AS name)
SELECT EXISTS (
 SELECT 1 FROM pg_roles r WHERE r.rolname IN (:'reader', :'writer', :'sql_role', :'restorer')
 AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
   OR EXISTS (SELECT 1 FROM pg_database d WHERE d.datdba = r.oid)
   OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles parent ON parent.oid = m.roleid
              WHERE m.member = r.oid AND NOT (r.rolname = :'sql_role' AND (parent.rolname = :'restorer'
                OR (parent.rolname ~ '^govern_import_[a-f0-9]{16}$'
                    AND NOT (parent.rolsuper OR parent.rolcreatedb OR parent.rolcreaterole OR parent.rolreplication OR parent.rolbypassrls)
                    AND EXISTS (SELECT 1 FROM pg_database target
                        WHERE pg_catalog.shobj_description(parent.oid, 'pg_authid') = 'govern-import-target:' || target.datname
                        AND NOT target.datistemplate AND target.datname <> 'postgres'
                        AND pg_catalog.has_database_privilege(parent.oid, target.oid, 'CONNECT'))))))
   OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspowner = r.oid
              AND (r.rolname IN (:'reader', :'writer') OR n.nspname NOT IN (SELECT name FROM allowed)))
   OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relowner = r.oid
              AND (r.rolname IN (:'reader', :'writer') OR (n.nspname <> 'pg_toast' AND n.nspname NOT IN (SELECT name FROM allowed))))
   OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proowner = r.oid
              AND (r.rolname IN (:'reader', :'writer') OR n.nspname NOT IN (SELECT name FROM allowed)))
   OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typowner = r.oid
              AND (r.rolname IN (:'reader', :'writer') OR (n.nspname <> 'pg_toast' AND n.nspname NOT IN (SELECT name FROM allowed)))))
) AS privileged_application_role \gset
\if :privileged_application_role
  DO $$ BEGIN RAISE EXCEPTION 'Configured PostgreSQL application role has elevated privileges or out-of-scope ownership.'; END $$;
\endif

SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L', :'reader', :'reader_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'reader') \gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L', :'writer', :'writer_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'writer') \gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L', :'sql_role', :'sql_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'sql_role') \gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L', :'restorer', :'restore_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'restorer') \gexec

-- SET ROLE can enter a restricted owner, never the bootstrap administrator.
SELECT format('GRANT %I TO %I WITH ADMIN FALSE', :'restorer', :'sql_role') \gexec
SELECT format('GRANT %I TO %I WITH INHERIT FALSE', :'restorer', :'sql_role') \gexec
SELECT format('GRANT %I TO %I WITH SET TRUE', :'restorer', :'sql_role') \gexec
-- Preserve existing passwords; the final real logins detect a mismatch.
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM %I', :'database', role_name)
FROM unnest(ARRAY[:'reader', :'writer', :'sql_role', :'restorer']) AS roles(role_name) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database', role_name)
FROM unnest(ARRAY[:'reader', :'writer', :'sql_role', :'restorer']) AS roles(role_name) \gexec
SELECT format('ALTER ROLE %I IN DATABASE %I SET default_transaction_read_only = on', :'reader', :'database') \gexec
SELECT format('ALTER ROLE %I IN DATABASE %I SET default_transaction_read_only = off', role_name, :'database')
FROM unnest(ARRAY[:'writer', :'sql_role', :'restorer']) AS roles(role_name) \gexec
SQL

# Missing schemas remain unavailable; startup never creates or replaces them.
while IFS= read -r schema; do
    schema=$(printf '%s' "$schema" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -n "$schema" ] || continue
    if [[ "$schema" = pg_* ]] || [ "$schema" = information_schema ]; then
        echo 'System schemas cannot be enabled as PostgreSQL workspaces.' >&2
        exit 1
    fi
    psql -X -q --set ON_ERROR_STOP=1 --set schema="$schema" <<'SQL'
\getenv reader PG_READ_USER
\getenv writer PG_USER
\getenv sql_role PG_SQL_USER
\getenv restorer PG_RESTORE_USER
SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = :'schema') AS schema_exists \gset
\if :schema_exists
 SELECT format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC', :'schema') \gexec
 SELECT format('REVOKE ALL ON SCHEMA %I FROM %I', :'schema', role_name)
 FROM unnest(ARRAY[:'reader', :'writer', :'sql_role', :'restorer']) AS roles(role_name) \gexec
 SELECT format('GRANT USAGE ON SCHEMA %I TO %I', :'schema', role_name)
 FROM unnest(ARRAY[:'reader', :'writer']) AS roles(role_name) \gexec
 SELECT format('GRANT USAGE, CREATE ON SCHEMA %I TO %I', :'schema', role_name)
 FROM unnest(ARRAY[:'sql_role', :'restorer']) AS roles(role_name) \gexec
 SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC', :'schema') \gexec
 SELECT format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC', :'schema') \gexec
 SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', :'schema', role_name)
 FROM unnest(ARRAY[:'reader', :'writer', :'sql_role', :'restorer']) AS roles(role_name) \gexec
 SELECT format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', :'schema', role_name)
 FROM unnest(ARRAY[:'reader', :'writer', :'sql_role', :'restorer']) AS roles(role_name) \gexec
 SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I', :'schema', :'reader') \gexec
 SELECT format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', :'schema', :'reader') \gexec
 SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', :'schema', role_name)
 FROM unnest(ARRAY[:'writer', :'sql_role', :'restorer']) AS roles(role_name) \gexec
 SELECT format('GRANT REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA %I TO %I', :'schema', role_name)
 FROM unnest(ARRAY[:'sql_role', :'restorer']) AS roles(role_name) \gexec
 SELECT format('GRANT USAGE ON ALL SEQUENCES IN SCHEMA %I TO %I', :'schema', role_name)
 FROM unnest(ARRAY[:'writer', :'sql_role', :'restorer']) AS roles(role_name) \gexec

 -- Bootstrap, SQL and restricted-restore creators use the same read/row grants.
 SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM %I', creator, :'schema', recipient)
 FROM unnest(ARRAY[current_user::text, :'sql_role', :'restorer']) AS creators(creator)
 CROSS JOIN unnest(ARRAY[:'reader', :'writer', :'sql_role', :'restorer']) AS recipients(recipient) \gexec
 SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I', creator, :'schema', recipient)
 FROM unnest(ARRAY[current_user::text, :'sql_role', :'restorer']) AS creators(creator)
 CROSS JOIN unnest(ARRAY[:'reader', :'writer', :'sql_role', :'restorer']) AS recipients(recipient) \gexec
 SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO %I', creator, :'schema', :'reader')
 FROM unnest(ARRAY[current_user::text, :'sql_role', :'restorer']) AS creators(creator) \gexec
 SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON SEQUENCES TO %I', creator, :'schema', :'reader')
 FROM unnest(ARRAY[current_user::text, :'sql_role', :'restorer']) AS creators(creator) \gexec
 SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', creator, :'schema', recipient)
 FROM unnest(ARRAY[current_user::text, :'sql_role', :'restorer']) AS creators(creator)
 CROSS JOIN unnest(ARRAY[:'writer', :'sql_role', :'restorer']) AS recipients(recipient) \gexec
 SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT REFERENCES, TRIGGER ON TABLES TO %I', creator, :'schema', recipient)
 FROM unnest(ARRAY[current_user::text, :'sql_role', :'restorer']) AS creators(creator)
 CROSS JOIN unnest(ARRAY[:'sql_role', :'restorer']) AS recipients(recipient) \gexec
 SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE ON SEQUENCES TO %I', creator, :'schema', recipient)
 FROM unnest(ARRAY[current_user::text, :'sql_role', :'restorer']) AS creators(creator)
 CROSS JOIN unnest(ARRAY[:'writer', :'sql_role', :'restorer']) AS recipients(recipient) \gexec
\endif
SQL
done < <(printf '%s\n' "$PG_SCHEMAS" | tr ',' '\n')

PGUSER="$PG_READ_USER" PGPASSWORD="$PG_READ_PASSWORD" psql -X -q --set ON_ERROR_STOP=1 --command 'SELECT 1' >/dev/null
PGUSER="$PG_USER" PGPASSWORD="$PG_PASSWORD" psql -X -q --set ON_ERROR_STOP=1 --command 'SELECT 1' >/dev/null
PGUSER="$PG_SQL_USER" PGPASSWORD="$PG_SQL_PASSWORD" psql -X -q --set ON_ERROR_STOP=1 --command 'SELECT 1' >/dev/null
PGUSER="$PG_RESTORE_USER" PGPASSWORD="$PG_RESTORE_PASSWORD" psql -X -q --set ON_ERROR_STOP=1 --command 'SELECT 1' >/dev/null
echo 'PostgreSQL reader, row writer, free SQL and restricted restore access is ready.'
