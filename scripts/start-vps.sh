#!/bin/sh
# Opt-in HTTPS for an existing, privately initialized Govern installation.
set -eu
cd "$(dirname "$0")/.."

if [ "$#" -gt 1 ]; then
    echo 'Usage: sh scripts/start-vps.sh [govern.example.nl]' >&2
    exit 1
fi
if [ ! -f .env ]; then
    echo 'Start Govern privately with sh start.sh first, then create the installation owner through your SSH tunnel.' >&2
    exit 1
fi

# Read only literal settings. A .env file is never a shell program.
setting() { sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r'; }
domain=${1:-${GOVERN_DOMAIN:-$(setting GOVERN_DOMAIN)}}
case "$domain" in
    ''|*[!a-zA-Z0-9.-]*)
        echo 'Provide one DNS name, for example govern.example.nl, without scheme, port, path or wildcard.' >&2
        exit 1 ;;
esac
domain=$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]')
if ! printf '%s\n' "$domain" | LC_ALL=C awk '
    length($0) > 253 || index($0, ".") == 0 { exit 1 }
    {
        count = split($0, labels, ".")
        for (i = 1; i <= count; i++) {
            if (length(labels[i]) < 1 || length(labels[i]) > 63 || labels[i] ~ /^-/ || labels[i] ~ /-$/) exit 1
        }
        if (labels[count] !~ /[a-z]/) exit 1
    }
'; then
    echo 'Provide a valid DNS name with labels of 1–63 characters and a named top-level domain.' >&2
    exit 1
fi
export GOVERN_DOMAIN="$domain"

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    echo 'Docker is not available. Start Docker and check that this user can access it.' >&2
    exit 1
fi
docker compose version >/dev/null
pg_enabled=${PG_ENABLED:-$(setting PG_ENABLED | tr -d '\042\047 ')}
compose() {
    if [ "$pg_enabled" = 1 ]; then
        docker compose --profile postgres -f compose.yaml -f compose.vps.yaml "$@"
    else
        docker compose -f compose.yaml -f compose.vps.yaml "$@"
    fi
}
failed() {
    echo "$1" >&2
    echo 'The public HTTPS service is being stopped. Accounts, databases, volumes and SSH access are retained.' >&2
    compose stop caddy || true
    exit 1
}

# An existing owner must be in place before exposing registration on the domain.
# Auth::hasOwner reads the same active-owner condition as the account flow.
# A one-off CLI container reads the existing volume even after the app stopped.
if ! compose run --rm -T --no-deps --user www-data --entrypoint php app <<'PHP'
<?php
require '/var/www/src/bootstrap.php';
$path = rtrim(getenv('AUTH_DIR') ?: '/var/lib/govern/auth', '/') . '/accounts.sqlite';
if (!is_file($path)) exit(1);
try {
    exit((new \Govern\Auth())->hasOwner() ? 0 : 1);
} catch (\Throwable) {
    exit(1);
}
PHP
then
    failed 'No active installation owner could be verified. Start sh start.sh and create the first account through your private SSH tunnel, then retry.'
fi

# Upgrades may add a PostgreSQL role while retaining the existing account store.
# Fill missing passwords only after the private owner check has succeeded.
if [ "$pg_enabled" = 1 ]; then
    ensure_pg_password() {
        key=$1
        environment_value=$2
        [ -z "$environment_value" ] || return 0
        # An exported empty value must not hide an existing/generated .env value.
        unset "$key"
        value=$(setting "$key" | sed 's/^[[:blank:]]*//; s/[[:blank:]]*$//')
        case "$value" in ''|'""'|"''") ;; *) return 0 ;; esac
        password=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
        if [ "${#password}" -ne 64 ]; then
            failed 'A PostgreSQL password could not be generated.'
        fi
        case "$password" in *[!0-9a-f]*) failed 'A PostgreSQL password could not be generated.' ;; esac
        umask 077
        temporary=$(mktemp .env.govern-pg.XXXXXX) || failed 'A PostgreSQL password could not be saved.'
        trap 'rm -f "$temporary"' 0 HUP INT TERM
        if ! { awk -v key="$key" 'index($0, key "=") != 1 { print }' .env > "$temporary" \
            && printf '\n%s=%s\n' "$key" "$password" >> "$temporary" \
            && mv "$temporary" .env; }; then
            failed 'A PostgreSQL password could not be saved.'
        fi
        trap - 0 HUP INT TERM
    }
    ensure_pg_password PG_READ_PASSWORD "${PG_READ_PASSWORD:-}"
    ensure_pg_password PG_PASSWORD "${PG_PASSWORD:-}"
    ensure_pg_password PG_ADMIN_PASSWORD "${PG_ADMIN_PASSWORD:-}"
fi

# Persist the domain separately; existing credentials and unrelated settings stay.
domain_count=$(awk '/^GOVERN_DOMAIN=/ { count++ } END { print count + 0 }' .env)
if [ "$(setting GOVERN_DOMAIN)" != "$domain" ] || [ "$domain_count" -ne 1 ]; then
    umask 077
    temporary=$(mktemp .env.govern-vps.XXXXXX) || failed 'The domain setting could not be saved.'
    trap 'rm -f "$temporary"' 0 HUP INT TERM
    if ! { awk 'index($0, "GOVERN_DOMAIN=") != 1 { print }' .env > "$temporary" \
        && printf '\nGOVERN_DOMAIN=%s\n' "$domain" >> "$temporary" \
        && mv "$temporary" .env; }; then
        failed 'The domain setting could not be saved.'
    fi
    trap - 0 HUP INT TERM
fi

if ! compose config --quiet; then
    failed 'The VPS Compose configuration is invalid.'
fi
if ! compose up -d --build --wait --wait-timeout 180; then
    failed 'Govern could not start completely with its HTTPS service.'
fi
if ! compose exec -T gateway nginx -t; then
    failed 'The gateway configuration is invalid.'
fi
if ! compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile; then
    failed 'The HTTPS configuration is invalid.'
fi
if ! compose exec -T gateway nginx -s reload; then
    failed 'The updated gateway configuration could not be loaded.'
fi
if ! compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile; then
    failed 'The updated HTTPS configuration could not be loaded.'
fi

printf '\nGovern is configured for https://%s\n' "$domain"
printf 'Caddy obtains and renews the certificate when DNS resolves here and TCP ports 80 and 443 are reachable.\n'
printf 'Check the HTTPS address in your browser. This message does not verify public DNS or certificate issuance.\n'
printf 'For later updates, run this VPS script again from the same checkout.\n'
