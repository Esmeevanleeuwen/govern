#!/bin/bash
set -euo pipefail

# This one-shot service is the only network client given the local bootstrap
# account. The web application receives separate reader and scoped row-writer
# credentials, never the bootstrap password.
: "${PGDATABASE:?Missing PostgreSQL database}"
: "${PGPASSWORD:?Missing PostgreSQL bootstrap password; run start.cmd or start.sh}"
: "${PG_READ_USER:?Missing PostgreSQL reader name}"
: "${PG_READ_PASSWORD:?Missing PostgreSQL reader password; run start.cmd or start.sh}"
: "${PG_USER:?Missing PostgreSQL writer name}"
: "${PG_PASSWORD:?Missing PostgreSQL writer password; run start.cmd or start.sh}"
if [ "$PG_READ_USER" = "$PGUSER" ] || [ "$PG_USER" = "$PGUSER" ] || [ "$PG_READ_USER" = "$PG_USER" ] \
    || [[ "$PG_READ_USER" = pg_* ]] || [[ "$PG_USER" = pg_* ]] \
    || [[ ! "$PG_READ_USER" =~ ^[A-Za-z0-9_]{1,63}$ ]] || [[ ! "$PG_USER" =~ ^[A-Za-z0-9_]{1,63}$ ]]; then
    echo 'PostgreSQL requires distinct, non-reserved reader and writer roles.' >&2
    exit 1
fi

psql -X -q --set ON_ERROR_STOP=1 <<'SQL'
\getenv reader PG_READ_USER
\getenv reader_password PG_READ_PASSWORD
\getenv writer PG_USER
\getenv writer_password PG_PASSWORD
\getenv database PGDATABASE

-- Never silently reuse a privileged account for either application connection.
SELECT EXISTS (
    SELECT 1 FROM pg_roles r WHERE r.rolname IN (:'reader', :'writer')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
           OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid)
           OR EXISTS (SELECT 1 FROM pg_database d WHERE d.datdba = r.oid)
           OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspowner = r.oid)
           OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner = r.oid))
) AS privileged_application_role \gset
\if :privileged_application_role
  \echo 'Configured PostgreSQL application role has ownership or elevated privileges. Choose separate reader and writer roles.'
  \quit 1
\endif

SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
              :'reader', :'reader_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'reader') \gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
              :'writer', :'writer_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'writer') \gexec

-- Existing role passwords are preserved. A mismatch is detected by the final
-- login check instead of resetting a password on an existing data volume.
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM %I', :'database', :'reader') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database', :'reader') \gexec
SELECT format('ALTER ROLE %I IN DATABASE %I SET default_transaction_read_only = on', :'reader', :'database') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM %I', :'database', :'writer') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database', :'writer') \gexec
SELECT format('ALTER ROLE %I IN DATABASE %I SET default_transaction_read_only = off', :'writer', :'database') \gexec
SQL

# Grant only the explicitly configured existing schemas. Missing schemas remain
# visible as unavailable in Govern; startup never creates or replaces user data.
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
SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = :'schema') AS schema_exists \gset
\if :schema_exists
  SELECT format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC', :'schema') \gexec
  SELECT format('REVOKE ALL ON SCHEMA %I FROM %I', :'schema', :'reader') \gexec
  SELECT format('GRANT USAGE ON SCHEMA %I TO %I', :'schema', :'reader') \gexec
  SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC', :'schema') \gexec
  SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', :'schema', :'reader') \gexec
  SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I', :'schema', :'reader') \gexec
  SELECT format('REVOKE ALL ON SCHEMA %I FROM %I', :'schema', :'writer') \gexec
  SELECT format('GRANT USAGE ON SCHEMA %I TO %I', :'schema', :'writer') \gexec
  SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', :'schema', :'writer') \gexec
  SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', :'schema', :'writer') \gexec
  SELECT format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC', :'schema') \gexec
  SELECT format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', :'schema', :'reader') \gexec
  SELECT format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', :'schema', :'writer') \gexec
  SELECT format('GRANT USAGE ON ALL SEQUENCES IN SCHEMA %I TO %I', :'schema', :'writer') \gexec
  -- Applies to tables subsequently created by the bootstrap administrator.
  SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM %I', :'schema', :'reader') \gexec
  SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO %I', :'schema', :'reader') \gexec
  SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM %I', :'schema', :'writer') \gexec
  SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'schema', :'writer') \gexec
  SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I', :'schema', :'reader') \gexec
  SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I', :'schema', :'writer') \gexec
  SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE ON SEQUENCES TO %I', :'schema', :'writer') \gexec
\endif
SQL
done < <(printf '%s\n' "${PG_SCHEMAS:-public}" | tr ',' '\n')

PGUSER="$PG_READ_USER" PGPASSWORD="$PG_READ_PASSWORD" psql -X -q --set ON_ERROR_STOP=1 --command 'SELECT 1' >/dev/null
PGUSER="$PG_USER" PGPASSWORD="$PG_PASSWORD" psql -X -q --set ON_ERROR_STOP=1 --command 'SELECT 1' >/dev/null
echo 'PostgreSQL reader and row-writer access is ready.'
