#!/bin/sh
set -eu
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
    echo 'Install Docker and start Govern with PG_ENABLED=1 before loading sample data.' >&2
    exit 1
fi
if ! docker info >/dev/null 2>&1; then
    echo 'Docker is not running. Start Docker and Govern before loading sample data.' >&2
    exit 1
fi

# Use the running container's configured database, not a caller-supplied name.
# demo.sql checks the public schema/reader and loads its own tables atomically.
if docker compose --profile postgres exec -T postgres sh -c '
    set -eu
    case "$POSTGRES_DB" in
        ""|*[!a-zA-Z0-9_]*) echo "Invalid PostgreSQL database name." >&2; exit 1 ;;
    esac
    case "$POSTGRES_USER" in
        ""|*[!a-zA-Z0-9_]*) echo "Invalid PostgreSQL bootstrap user." >&2; exit 1 ;;
    esac
    exec psql -X --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set ON_ERROR_STOP=1
' < docker/postgres/demo.sql; then
    echo 'Sample data is ready. Refresh Govern and choose the public PostgreSQL schema.'
else
    result=$?
    echo 'Sample data could not be loaded. Start Govern with PG_ENABLED=1 and inspect the error above.' >&2
    exit "$result"
fi
