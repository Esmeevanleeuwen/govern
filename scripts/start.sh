#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
    echo 'Installeer en start Docker Desktop (of Docker Engine met Compose) eerst.' >&2
    exit 1
fi
if ! docker info >/dev/null 2>&1; then
    echo 'Docker draait nog niet. Start Docker en probeer opnieuw.' >&2
    exit 1
fi
docker compose version >/dev/null

random_password() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
if [ ! -f .env ]; then
    umask 077
    {
        printf 'APP_PORT=8080\nDB_NAME=bestuursatlas\n'
        printf 'DB_PASSWORD=%s\n' "$(random_password)"
        printf 'DB_READ_PASSWORD=%s\n' "$(random_password)"
        printf 'DB_ROOT_PASSWORD=%s\n' "$(random_password)"
    } > .env
    echo 'Lokale instellingen aangemaakt. Bestaande instellingen worden voortaan behouden.'
fi

# Read only the explicit opt-in flag. Never source or evaluate a .env file.
pg_enabled=${PG_ENABLED:-$(sed -n 's/^PG_ENABLED=//p' .env | tail -n 1 | tr -d '\r\042\047 ')}
set --
if [ "$pg_enabled" = 1 ]; then
    ensure_pg_password() {
        key=$1
        environment_value=$2
        [ -z "$environment_value" ] || return 0
        value=$(sed -n "s/^$key=//p" .env | tail -n 1 | tr -d '\r\042\047 ')
        [ -z "$value" ] || return 0
        password=$(random_password)
        # Remove blank placeholders only; preserve every existing password.
        temporary=$(mktemp .env.govern-pg.XXXXXX)
        sed "/^$key=/d" .env > "$temporary"
        printf '\n%s=%s\n' "$key" "$password" >> "$temporary"
        mv "$temporary" .env
    }
    ensure_pg_password PG_READ_PASSWORD "${PG_READ_PASSWORD:-}"
    ensure_pg_password PG_PASSWORD "${PG_PASSWORD:-}"
    ensure_pg_password PG_SQL_PASSWORD "${PG_SQL_PASSWORD:-}"
    ensure_pg_password PG_RESTORE_PASSWORD "${PG_RESTORE_PASSWORD:-}"
    ensure_pg_password PG_ADMIN_PASSWORD "${PG_ADMIN_PASSWORD:-}"
    set -- --profile postgres
fi

if ! docker compose "$@" up -d --build --wait --wait-timeout 180; then
    echo 'Govern kon niet volledig starten. De ingang wordt gestopt om oude toegangsregels niet actief te laten.' >&2
    docker compose "$@" stop gateway || true
    exit 1
fi
# A bind-mounted configuration change does not reload an existing Nginx worker.
# Apply the session gate on upgrades too; never leave an older public route live.
if ! docker compose "$@" exec -T gateway nginx -t || ! docker compose "$@" exec -T gateway nginx -s reload; then
    echo 'De nieuwe toegangsregels konden niet worden geladen. De ingang wordt gestopt; je gegevens blijven behouden.' >&2
    docker compose "$@" stop gateway || true
    exit 1
fi
port=$(sed -n 's/^APP_PORT=\([0-9][0-9]*\)$/\1/p' .env | head -n 1)
printf '\nOpen Govern op http://localhost:%s\n' "${port:-8080}"
printf 'De eerste start kan even duren terwijl Docker de onderdelen downloadt.\n'
