#!/bin/bash
# Apply explicitly configured schema access on every start, including existing volumes.
# This runs in a one-shot container; the web application never receives root credentials.
set -euo pipefail
export LC_ALL=C
umask 077

: "${DB_ROOT_PASSWORD:?Missing existing database root password}"
: "${DB_PASSWORD:?Missing existing Govern password}"
: "${DB_READ_PASSWORD:?Missing existing reader password}"

govern_default=${DB_NAME:-bestuursatlas}
govern_extra=${DB_DATABASES:-}
if [[ ! "$govern_default" =~ ^[a-zA-Z0-9_]+$ ]]; then
    echo 'DB_NAME must contain only letters, numbers and underscores.' >&2
    exit 1
fi
if [[ "$govern_extra" =~ [^a-zA-Z0-9_,\ ] ]]; then
    echo 'DB_DATABASES must be a comma-separated list of names containing letters, numbers and underscores.' >&2
    exit 1
fi

declare -a govern_databases=()
declare -A govern_seen=()
IFS=',' read -r -a govern_candidates <<< "$govern_extra"
for govern_name in "$govern_default" "${govern_candidates[@]}"; do
    govern_name=${govern_name#"${govern_name%%[! ]*}"}
    govern_name=${govern_name%"${govern_name##*[! ]}"}
    [[ -n "$govern_name" ]] || continue
    if [[ ! "$govern_name" =~ ^[a-zA-Z0-9_]+$ ]] || ((${#govern_name} > 64)); then
        echo 'Configured database names must contain 1–64 letters, numbers or underscores.' >&2
        exit 1
    fi
    case "${govern_name,,}" in
        mysql|information_schema|performance_schema|sys)
            echo 'System databases cannot be enabled as Govern workspaces.' >&2
            exit 1
            ;;
    esac
    # GRANT treats underscores as wildcards even inside quoted database names.
    govern_pattern=${govern_name//_/\\_}
    if ((${#govern_pattern} > 64)); then
        echo 'The escaped database permission name is too long; use a shorter configured name.' >&2
        exit 1
    fi
    if [[ -z ${govern_seen[$govern_name]+present} ]]; then
        govern_seen[$govern_name]=1
        govern_databases+=("$govern_name")
    fi
done

govern_tmp=$(mktemp -d)
govern_error=$govern_tmp/client-error
trap 'rm -f "$govern_error"; rmdir "$govern_tmp"' EXIT

govern_client=(mariadb --protocol=tcp --host="${DB_HOST:-database}" --port="${DB_PORT:-3306}"
    --connect-timeout=5 --default-character-set=utf8mb4 --batch --silent
    --skip-column-names --binary-mode --skip-reconnect)
govern_admin() {
    # Error output for CREATE USER can contain its SQL. Do not print credentials.
    if ! MYSQL_PWD="$DB_ROOT_PASSWORD" "${govern_client[@]}" --user=root "$@" 2>"$govern_error"; then
        echo 'Database access setup failed. Check DB_DATABASES and preserve the existing .env credentials.' >&2
        return 1
    fi
}

# Account creation is idempotent and never changes an existing account's password.
# NO_BACKSLASH_ESCAPES makes apostrophe doubling unambiguous for password literals.
govern_writer_password=${DB_PASSWORD//\'/\'\'}
govern_reader_password=${DB_READ_PASSWORD//\'/\'\'}
govern_admin <<SQL
SET SESSION sql_mode='NO_BACKSLASH_ESCAPES';
CREATE USER IF NOT EXISTS 'govern'@'%' IDENTIFIED BY '$govern_writer_password';
CREATE USER IF NOT EXISTS 'govern_reader'@'%' IDENTIFIED BY '$govern_reader_password';
ALTER USER 'govern_reader'@'%' WITH MAX_STATEMENT_TIME 5;
SQL
unset govern_writer_password govern_reader_password

for govern_name in "${govern_databases[@]}"; do
    govern_pattern=${govern_name//_/\\_}
    govern_admin <<SQL
SET SESSION sql_mode='NO_BACKSLASH_ESCAPES';
CREATE DATABASE IF NOT EXISTS \`$govern_name\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON \`$govern_pattern\`.* TO 'govern'@'%';
GRANT SELECT, SHOW VIEW ON \`$govern_pattern\`.* TO 'govern_reader'@'%';
SQL

    # Older images granted DB_NAME with unescaped underscores. Replace only
    # that known legacy grant for these two managed accounts, not other grants.
    if [[ "$govern_name" == "$govern_default" && "$govern_name" == *_* ]]; then
        for govern_user in govern govern_reader; do
            govern_legacy=$(govern_admin --execute="SELECT COUNT(*) FROM mysql.db WHERE Host='%' AND User='$govern_user' AND Db='$govern_name'")
            if [[ "$govern_legacy" != 0 ]]; then
                govern_admin --execute="REVOKE ALL PRIVILEGES ON \`$govern_name\`.* FROM '$govern_user'@'%'"
            fi
        done
    fi

    # Verify the configured credentials without resetting an existing user.
    for govern_user in govern govern_reader; do
        if [[ "$govern_user" == govern ]]; then govern_password=$DB_PASSWORD; else govern_password=$DB_READ_PASSWORD; fi
        if ! MYSQL_PWD="$govern_password" "${govern_client[@]}" --user="$govern_user" --database="$govern_name" \
            --execute='SELECT DATABASE()' >/dev/null 2>"$govern_error"; then
            echo 'The configured credentials do not match an existing Govern database account. Preserve your original .env passwords.' >&2
            exit 1
        fi
    done
    unset govern_password
done

printf 'Configured database access is ready for %s workspace(s).\n' "${#govern_databases[@]}"
