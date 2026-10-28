# API contract — Govern

Personal local workbench. All endpoints are `GET/POST /api.php?action=...`, JSON.
Success envelope `{ "ok": true, "data": ... }`; failure `{ "ok": false, "error": "Dutch message" }` with correct HTTP status.
All POST requests use JSON and header `X-CSRF-Token` from bootstrap. PHP session cookie, same origin only.
No remote services or AI calls. One configurable MySQL/MariaDB database, live schema discovery.

## Endpoints

- GET `bootstrap`: `{csrf, database:{name,version,status,available}, stats:{tables,views,rows_estimate}, tables:[{name,type:"table"|"view",comment,rows_estimate,columns}]}`.
- GET `browse&table=...&page=1&page_size=25&q=...`: `{table,columns:[{name,type,nullable,default,generated,primary,comment}],rows:[{column:value}],page,page_size,total,sql,params}`. Named identifiers verified against live catalog; values bound; max page_size100. App-owned `_govern_` tables excluded from normal list, remain accessible in phpMyAdmin.
- GET `structure&table=...`: `{table,columns:[...],indexes:[{name,unique,columns:[name]}],foreign_keys:[{name,columns:[name],referenced_table,referenced_columns:[name]}],create_sql}`.
- POST `query` `{sql}`: `{columns:[string],rows:[[value]],truncated,duration_ms,returned_rows,sql}`. Separate SELECT/SHOW-only DB account and READ ONLY transactions enforce research reads (including invocations through definer views). Max200 returned rows; native single statement execution; bounded statement time. For writing/DDL use full phpMyAdmin modal.
- GET `queries`: `[{id,name,sql,notes,updated_at}]`.
- POST `save-query` `{id?,name,sql,notes?}`: saved item. POST `delete-query` `{id}`.
- GET `snapshots`: `[{id,label,created_at,size_bytes,sha256}]`.
- POST `create-snapshot` `{label}`: created snapshot descriptor.
- POST `restore-snapshot` `{id,confirmation}`: confirmation equals configured database name. `{restored:id,safety_snapshot:<descriptor>|null,message}`. Creates safety export before restore when the DB exists; null if already absent. Snapshot service independent of live schema; can restore if target DB was dropped. Bootstrap still returns CSRF and configured DB name with available=false if absent.
- GET `download-snapshot&id=...`: attachment SQL. Strict server-generated snapshot ids only.
- GET `context`: attachment JSON of schema and saved queries, no table rows or credentials.
- GET `health`: `{status:"ok"}` when configured DB readable; no credentials/errors disclosed.

## Ownership

Backend owns `app/src/*` and `app/public/api.php`, except BackupService.php.
Frontend owns `app/public/index.php`, `app/public/assets/*`.
Infrastructure owns Docker files, compose.yaml, bootstrap scripts, app/src/BackupService.php.
Root owns database seed, docs, integration tests, review and GitHub.

## Backend settings

`DB_HOST=database`, `DB_PORT=3306`, `DB_NAME=bestuursatlas`, `DB_USER=govern`, `DB_PASSWORD`, `DB_READ_USER=govern_reader`, `DB_READ_PASSWORD`; optional `DB_SOCKET` for isolated native validation. `BACKUP_DIR=/var/lib/govern/backups`, `DB_DUMP_BIN=mariadb-dump`, `DB_CLIENT_BIN=mariadb`. Config keys: `host`, `port`, `name`, `user`, `password`, `read_user`, `read_password`, `socket`, `backup_dir`, `dump_bin`, `client_bin`.

PHP8.3+, PDO MySQL, native PHP classes and ES modules, no build framework. Namespace `Govern`, small explicit bootstrap loading or autoloader. Config class `Config::fromEnvironment(): array`. BackupService `__construct(array $config)`, `list(): array`, `create(string $label): array`, `restore(string $id,string $confirmation): array`, `download(string $id): array` returning `{path,filename}`. Backup service verifies files/checksums, invokes clients using argv arrays, credentials only private temporary file. No shell command concatenation.

## phpMyAdmin integration

Same origin at `/phpmyadmin/` via Nginx. Modal top tabs exactly Browse, Structure, SQL. Iframe uses actual phpMyAdmin, not a partial imitation. URL query route `/sql` (Browse), `/table/structure`, `/table/sql`, with encoded `db` and `table`. No-table fallback `/database/structure` or `/database/sql`. Allow only same-origin framing; config auth uses DB account limited to configured database. Display current DB/table and a separate-window link. Keep full phpMyAdmin capabilities available inside frame.

Snapshots are real SQL exports, not container volume snapshots. Restoring overwrites current selected DB contents; user confirmation and automatic safety export required. DDL is not represented as transactionally undoable. No database or phpMyAdmin host port; only proxy bound127.0.0.1:8080. Nothing runs on the user computer until they start this project.
