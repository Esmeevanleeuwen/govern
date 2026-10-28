# API contract — Govern

Personal local workbench. All endpoints are `GET/POST /api.php?action=...`, JSON.
Success envelope `{ "ok": true, "data": ... }`; failure `{ "ok": false, "error": "Dutch message" }` with correct HTTP status.
All POST requests use JSON and header `X-CSRF-Token` from bootstrap. PHP session cookie, same origin only.
No remote services or AI calls. One configurable MySQL/MariaDB database, live schema discovery.

## Endpoints

- GET `bootstrap`: `{csrf, database:{name,version,status,available}, stats:{tables,views,rows_estimate}, tables:[{name,type:"table"|"view",comment,rows_estimate,columns}]}`.
- GET `browse&table=...&page=1&page_size=25&q=...`: `{table,columns:[{name,type,nullable,default,generated,primary,comment}],rows:[{column:value}],page,page_size,total,sql,params}`. Named identifiers verified against live catalog; values bound; max page_size100. App-owned `_govern_` tables excluded from normal list, remain accessible in phpMyAdmin.
- GET `structure&table=...`: `{table,columns:[...],indexes:[{name,unique,columns:[name]}],foreign_keys:[{name,columns:[name],referenced_table,referenced_columns:[name]}],create_sql}`.
- POST `query` exactly one of `{sql}` or `{design}`: `{columns:[string],rows:[[value]],truncated,duration_ms,returned_rows,sql}`. A design also returns `explanation:[string]`. Separate SELECT/SHOW-only DB account and READ ONLY transactions enforce research reads (including invocations through definer views). Max200 returned rows; native single statement execution; bounded statement time. Design values are bound parameters; its metadata is revalidated before execution. For writing/DDL use full phpMyAdmin modal.
- POST `build-query` exactly `{design}`: `{sql,explanation:[string]}`. Validates against the live schema and generates editable, standalone SQL; does not execute the generated question.
- GET `queries`: `[{id,name,sql,notes,updated_at}]`.
- POST `save-query` `{id?,name,sql,notes?}`: saved item. POST `delete-query` `{id}`.
- GET `snapshots`: `[{id,label,created_at,size_bytes,sha256}]`.
- POST `create-snapshot` `{label}`: created snapshot descriptor.
- POST `restore-snapshot` `{id,confirmation}`: confirmation equals configured database name. `{restored:id,safety_snapshot:<descriptor>|null,message}`. Creates safety export before restore when the DB exists; null if already absent. Snapshot service independent of live schema; can restore if target DB was dropped. Bootstrap still returns CSRF and configured DB name with available=false if absent.
- GET `download-snapshot&id=...`: attachment SQL. Strict server-generated snapshot ids only.
- GET `context`: attachment JSON of schema and saved queries, no table rows or credentials.
- GET `health`: `{status:"ok"}` when configured DB readable; no credentials/errors disclosed.

## Visual query design

The app uses PHP **8.4 or later**, supplied by Docker. Its MySQL-specific PDO
parser correctly distinguishes parameters from quoted identifiers, including
column names containing a colon or a backtick. The integration suite checks
those names; do not replace native binding with SQL interpolation to support an
older parser. See the [PHP 8.4 PDO_MYSQL changes](https://www.php.net/manual/en/migration84.new-features.php#migration84.new-features.pdo-mysql).

Every field below is required. Use `join:null` without a relationship, and empty
lists for no filters or sorting. Column and table names are exact catalog names,
not SQL expressions. Values remain strings, including large numbers.

```json
{
  "design": {
    "table": "digital_systems",
    "join": null,
    "columns": [
      {"source": "base", "column": "code"},
      {"source": "base", "column": "name"}
    ],
    "filters": [
      {"source": "base", "column": "name", "operator": "contains", "value": "Digi"}
    ],
    "match": "all",
    "order": [{"source": "base", "column": "name", "direction": "asc"}],
    "limit": 50
  }
}
```

- `join` is `null` or `{foreign_key:string,type:"left"|"inner"}`. The key must
  be an outgoing foreign key from `structure.foreign_keys`, within the selected
  database. All columns of a composite key are joined; self references use two
  independent aliases.
- Every field reference has `source:"base"|"related"` and `column:string`.
  `related` requires a join. With a join, result labels are `basis.column` and
  `gekoppeld.column`; without a join they remain the ordinary column names.
- `columns` contains 1–1024 distinct field references. `order` contains at most
  64 distinct fields with `direction:"asc"|"desc"`.
- `filters` contains at most 64 filters. Operators are `eq`, `neq`, `gt`, `gte`,
  `lt`, `lte`, `contains`, `starts_with`, `ends_with`, `is_null`, `is_not_null`.
  NULL operators must omit `value`. Every other filter must supply a string
  value; empty strings and surrounding whitespace are preserved. Strings must
  be valid UTF-8, without NUL, and at most 8192 bytes.
- Comparisons support ordinary text, numeric and date/time types. Contains,
  starts-with and ends-with support text types only, with `%`, `_` and `=` treated
  as literal input. Other types, such as binary/spatial columns, support NULL
  filters in this helper and remain selectable.
- Exact numeric inputs use decimal notation with a point and no exponent. They
  are compared with an explicit DECIMAL cast derived from their input precision
  and scale; PHP/JavaScript floating-point conversion is not used. Inputs beyond
  the database's exact DECIMAL range are rejected. Float/double/real fields also
  accept exponent notation and use the database's approximate arithmetic.
- `match:"all"` combines filters with AND; `"any"` uses OR. Filters apply after
  the join, so filtering a related field can remove unmatched LEFT JOIN rows.
- `limit` must be an integer from 1 to 200, the existing research preview size.
  The standalone SQL editor remains available for questions outside the helper.

Unknown keys, wrong JSON types, duplicate column selections/sort fields, missing
values, unavailable fields and invalid operator combinations are rejected with
422 rather than silently ignored. A disappeared table produces 404. Existing
CSRF and method checks apply to both endpoints.

The compiler builds prepared and displayed filter fragments separately. It does
not replace placeholder-looking text inside arbitrary SQL identifiers. Displayed
string literals are quoted by PDO under the application's fixed SQL mode. Saving
a designed question stores that standalone SQL in the existing query table;
loading or manually editing it uses the ordinary SQL path, with no new storage
format or hidden builder state in the database.

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
