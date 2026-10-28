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

if [ ! -f .env ]; then
    umask 077
    random_password() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
    {
        printf 'APP_PORT=8080\nDB_NAME=bestuursatlas\n'
        printf 'DB_PASSWORD=%s\n' "$(random_password)"
        printf 'DB_READ_PASSWORD=%s\n' "$(random_password)"
        printf 'DB_ROOT_PASSWORD=%s\n' "$(random_password)"
    } > .env
    echo 'Lokale instellingen aangemaakt. Bestaande instellingen worden voortaan behouden.'
fi

docker compose up -d --build --wait --wait-timeout 180
port=$(sed -n 's/^APP_PORT=\([0-9][0-9]*\)$/\1/p' .env | head -n 1)
printf '\nOpen Govern op http://localhost:%s\n' "${port:-8080}"
printf 'De eerste start kan even duren terwijl Docker de onderdelen downloadt.\n'
