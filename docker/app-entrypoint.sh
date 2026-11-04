#!/bin/sh
set -eu
mkdir -p "${BACKUP_DIR:-/var/lib/govern/backups}"
chown www-data:www-data "${BACKUP_DIR:-/var/lib/govern/backups}"
chmod 700 "${BACKUP_DIR:-/var/lib/govern/backups}"
mkdir -p "${IMPORT_DIR:-/var/lib/govern/imports}"
chown www-data:www-data "${IMPORT_DIR:-/var/lib/govern/imports}"
chmod 700 "${IMPORT_DIR:-/var/lib/govern/imports}"
if [ "${1:-}" = php ] && [ "${2:-}" = /var/www/bin/import-worker.php ]; then
    # App startup already initialized the account volume; worker sees it read-only.
    exec runuser -u www-data -- docker-php-entrypoint "$@"
fi
mkdir -p "${AUTH_DIR:-/var/lib/govern/auth}"
chown www-data:www-data "${AUTH_DIR:-/var/lib/govern/auth}"
chmod 700 "${AUTH_DIR:-/var/lib/govern/auth}"
exec docker-php-entrypoint "$@"
