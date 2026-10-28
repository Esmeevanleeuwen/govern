#!/bin/bash
# The official MariaDB image runs this only for an empty data volume.
# A subshell also keeps options private when an image sources a non-executable .sh.
(
set -eu

case "$MARIADB_DATABASE" in
    ''|*[!a-zA-Z0-9_]*) echo 'DB_NAME mag alleen letters, cijfers en underscores bevatten.' >&2; exit 1 ;;
esac
case "$DB_READ_USER" in
    ''|*[!a-zA-Z0-9_]*) echo 'Ongeldige reader-accountnaam.' >&2; exit 1 ;;
esac

# NO_BACKSLASH_ESCAPES makes apostrophe doubling unambiguous for the password.
reader_password=$(printf '%s' "$DB_READ_PASSWORD" | sed "s/'/''/g")
MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb --protocol=socket --user=root <<SQL
SET SESSION sql_mode='NO_BACKSLASH_ESCAPES';
CREATE USER IF NOT EXISTS '$DB_READ_USER'@'%' IDENTIFIED BY '$reader_password';
GRANT SELECT, SHOW VIEW ON \`$MARIADB_DATABASE\`.* TO '$DB_READ_USER'@'%';
ALTER USER '$DB_READ_USER'@'%' WITH MAX_STATEMENT_TIME 5;
SQL
unset reader_password

# Views and future routines must share the scoped workbench owner. Running the
# seed as root would produce DEFINER clauses that this account cannot restore.
MYSQL_PWD="$MARIADB_PASSWORD" mariadb --protocol=socket --user="$MARIADB_USER" "$MARIADB_DATABASE" < /opt/govern/seed.sql
MYSQL_PWD="$MARIADB_PASSWORD" mariadb --protocol=socket --user="$MARIADB_USER" "$MARIADB_DATABASE" < /opt/govern/workbench.sql
)
