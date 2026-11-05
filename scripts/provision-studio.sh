#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

# Read only non-secret opt-in settings, never evaluate .env as shell code.
setting() {
    name=$1
    fallback=$2
    supplied=$3
    if [ -n "$supplied" ]; then printf '%s' "$supplied"; return; fi
    if [ -f .env ]; then
        configured=$(sed -n "s/^$name=//p" .env | tail -n 1 | tr -d '\r\042\047 ')
        if [ -n "$configured" ]; then printf '%s' "$configured"; return; fi
    fi
    printf '%s' "$fallback"
}
pg_enabled=$(setting PG_ENABLED 0 "${PG_ENABLED:-}")
studio_enabled=$(setting STUDIO_ENABLED 0 "${STUDIO_ENABLED:-}")
studio_schema=$(setting STUDIO_SCHEMA brainstorm "${STUDIO_SCHEMA:-}")
pg_schemas=$(setting PG_SCHEMAS public "${PG_SCHEMAS:-}")
if [ "$pg_enabled" != 1 ] || [ "$studio_enabled" != 1 ]; then
    echo 'Set PG_ENABLED=1 and STUDIO_ENABLED=1 explicitly before provisioning Studio.' >&2
    exit 1
fi
case "$studio_schema" in ''|public|information_schema|pg_*|[0-9]*|*[!A-Za-z0-9_]*) echo 'Choose a separate non-system STUDIO_SCHEMA.' >&2; exit 1;; esac
if [ "${#studio_schema}" -gt 63 ]; then echo 'STUDIO_SCHEMA is limited to 63 characters.' >&2; exit 1; fi
case ",$pg_schemas," in *",$studio_schema,"*) :;; *) echo 'Include STUDIO_SCHEMA explicitly in PG_SCHEMAS and restart Govern first.' >&2; exit 1;; esac
docker compose --profile postgres exec -T -e "STUDIO_SCHEMA=$studio_schema" postgres sh -c \
    'exec psql -X --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 --set studio_schema="$STUDIO_SCHEMA"' \
    < docker/postgres/studio/001-foundation.sql
docker compose --profile postgres exec -T -e "STUDIO_SCHEMA=$studio_schema" postgres sh -c \
    'exec psql -X --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 --set studio_schema="$STUDIO_SCHEMA"' \
    < docker/postgres/studio/002-dictation.sql
docker compose --profile postgres exec -T -e "STUDIO_SCHEMA=$studio_schema" postgres sh -c \
    'exec psql -X --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 --set studio_schema="$STUDIO_SCHEMA"' \
    < docker/postgres/studio/003-ghostsketch-storage.sql
echo 'Studio schema version 1 is ready. Existing data and account passwords were preserved.'
