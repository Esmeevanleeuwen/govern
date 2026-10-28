#!/bin/sh
set -eu
mkdir -p "${BACKUP_DIR:-/var/lib/govern/backups}"
chown www-data:www-data "${BACKUP_DIR:-/var/lib/govern/backups}"
chmod 700 "${BACKUP_DIR:-/var/lib/govern/backups}"
exec docker-php-entrypoint "$@"
