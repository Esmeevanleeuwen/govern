#!/bin/sh
set -eu
mkdir -p "${BACKUP_DIR:-/var/lib/govern/backups}"
chown www-data:www-data "${BACKUP_DIR:-/var/lib/govern/backups}"
chmod 700 "${BACKUP_DIR:-/var/lib/govern/backups}"
mkdir -p "${AUTH_DIR:-/var/lib/govern/auth}"
chown www-data:www-data "${AUTH_DIR:-/var/lib/govern/auth}"
chmod 700 "${AUTH_DIR:-/var/lib/govern/auth}"
exec docker-php-entrypoint "$@"
