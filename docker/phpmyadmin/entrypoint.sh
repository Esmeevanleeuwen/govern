#!/bin/sh
set -eu
php /opt/govern/init-storage.php
exec /docker-entrypoint.sh "$@"
