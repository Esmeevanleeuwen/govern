#!/bin/bash
set -euo pipefail

# This one-shot service is the only network client given the local bootstrap
# account. The web application receives only PG_READ_USER/PG_READ_PASSWORD.
: "${PGDATABASE:?Missing PostgreSQL database}"
: "${PGPASSWORD:?Missing PostgreSQL bootstrap password; run start.cmd or start.sh}"
: "${PG_READ_USER:?Missing PostgreSQL reader name}"
: "${PG_READ_PASSWORD:?Missing PostgreSQL reader password; run start.cmd or start.sh}"
if [ "$PG_READ_USER" = "$PGUSER" ] || [[ "$PG_READ_USER" = pg_* ]]; then
    echo 'PostgreSQL requires a separate, non-reserved read-only role.' >&2
    exit 1
fi

psql -X -q --set ON_ERROR_STOP=1 <<'SQL'
\getenv reader PG_READ_USER
\getenv reader_password PG_READ_PASSWORD
\getenv database PGDATABASE

-- Never silently reuse a privileged account as the application reader.
SELECT EXISTS (
    SELECT 1 FROM pg_roles r WHERE r.rolname = :'reader'
      AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
           OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid)
           OR EXISTS (SELECT 1 FROM pg_database d WHERE d.datdba = r.oid)
           OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspowner = r.oid)
           OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner = r.oid))
) AS privileged_reader \gset
\if :privileged_reader
  \echo 'Configured PostgreSQL reader has ownership or elevated privileges. Choose a separate reader role.'
  \quit 1
\endif

SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
              :'reader', :'reader_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'reader') \gexec

-- Existing role passwords are preserved. A mismatch is detected by the final
-- login check instead of resetting a password on an existing data volume.
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM %I', :'database', :'reader') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database', :'reader') \gexec
SELECT format('ALTER ROLE %I IN DATABASE %I SET default_transaction_read_only = on', :'reader', :'database') \gexec
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
SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = :'schema') AS schema_exists \gset
\if :schema_exists
  SELECT format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC', :'schema') \gexec
  SELECT format('REVOKE ALL ON SCHEMA %I FROM %I', :'schema', :'reader') \gexec
  SELECT format('GRANT USAGE ON SCHEMA %I TO %I', :'schema', :'reader') \gexec
  SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC', :'schema') \gexec
  SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', :'schema', :'reader') \gexec
  SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I', :'schema', :'reader') \gexec
  SELECT format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC', :'schema') \gexec
  SELECT format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', :'schema', :'reader') \gexec
  -- Applies to tables subsequently created by the bootstrap administrator.
  SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO %I', :'schema', :'reader') \gexec
\endif
SQL
done < <(printf '%s\n' "${PG_SCHEMAS:-public}" | tr ',' '\n')

PGUSER="$PG_READ_USER" PGPASSWORD="$PG_READ_PASSWORD" psql -X -q --set ON_ERROR_STOP=1 --command 'SELECT 1' >/dev/null
echo 'PostgreSQL reader access is ready.'
