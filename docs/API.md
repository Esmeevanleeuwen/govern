# API contract — Govern

Personal local workbench. Database endpoints are `GET/POST /api.php?action=...`,
and installation-account endpoints are `GET/POST /auth-api.php?action=...`, JSON.
Success envelope `{ "ok": true, "data": ... }`. A failure keeps the existing
`error` string and adds stable localization fields, with the same HTTP status:

```json
{
  "ok": false,
  "error": "Enter valid text for sql.",
  "error_code": "text_invalid",
  "error_params": {"field": "sql"},
  "error_i18n": {
    "nl": "Vul een geldige tekst in voor sql.",
    "en": "Enter valid text for sql."
  }
}
```

POST requests use JSON, except the multipart dataset uploads described below,
and header `X-CSRF-Token` from authenticated bootstrap
or account status. PHP session cookie, same origin only. Except fixed database
readiness, every database API route requires an approved installation account.
One MySQL/MariaDB server with multiple selectable databases, plus an optional
server-configured PostgreSQL connection with a selected database and allowlisted schemas.
The optional local Ollama connection is disabled by default; only the separate AI
endpoints can call that configured provider. Ordinary database operations and
selection explanations do not require a model.

## Installation accounts and HTML routes

`GET /` renders the public homepage and its clearly labelled fictional product
preview. `GET /workspace.php` requires an approved account and renders the
existing workspace. Legacy workspace hashes entered at `/` retain their hash
and database parameter when forwarded to `/workspace.php`. `/auth.php?mode=login`
and `?mode=register` render the account forms; `/account.php` requires login and
contains account/logout controls and owner-only approval controls. HTML page
guards redirect unauthenticated requests with 303; JSON routes return 401.

Workspace and account HTML pages accept a cross-site GET only for a top-level
document navigation (`Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`).
This permits opening a local workspace link from another site. It does not
relax API, Origin, Host or CSRF checks; cross-site fetches, embeds and POSTs
remain rejected. Browser assets under `/assets/` require cache revalidation so
updated modules do not keep sending an older database-selection format.

All account endpoints use the ordinary success/error envelope and bilingual
error fields. Public user records are
`{id:integer,name,email,role:"owner"|"member",status:"active"|"pending",created_at}`;
they never include a password hash. The request `action` is a URL parameter.

| Method / account action | Input | Successful data |
| --- | --- | --- |
| GET `status` | None | `{csrf,user:PublicUser|null,has_owner:boolean}` |
| POST `register` | `{name,email,password}` | 201 `{csrf,user:PublicUser|null,registration:"active"|"pending"}` |
| POST `login` | `{email,password}` | `{csrf,user:PublicUser}` |
| POST `logout` | `{}` | `{csrf,user:null}` |
| GET `requests` | None; owner required | `{users:PublicUser[]}` with up to 100 pending requests |
| POST `approve` | `{user_id:integer}`; owner required | `{user:PublicUser}` |

Registration atomically makes the first account the active owner and signs it
in. Later accounts stay pending; supplied role/status properties grant nothing.
Duplicate email registration has the same public pending response. Only the
owner can approve a pending member. Approved accounts deliberately share access
to this installation's existing work databases; they do not create isolated
tenants or private schemas. A correct password for a pending account returns
403 `auth_pending`; incorrect or unknown credentials return the same 401
`auth_credentials_invalid`. Owner-only actions return 403
`auth_owner_required`; missing/expired login returns 401 `auth_required`.

Passwords contain 12–128 UTF-8 characters and at most 512 bytes, without NUL;
they are hashed using Argon2id. Login rate limits are 60 attempts per peer and
10 per normalized email over 15 minutes; registration allows 15 attempts per
peer over one hour. Counters persist in SQLite using hashed bucket keys.
The gateway is the PHP peer in Docker, so its peer limit is shared by this
local installation. A full bucket returns 429 `auth_rate_limited` and a
`Retry-After` header. Account input validation uses stable `auth_*` error codes.

`Http::start()` checks host/origin and creates the Strict, HttpOnly session
cookie; Secure follows HTTPS. Every account mutation requires the current
session's CSRF header. Login and logout rotate both session ID and CSRF token:
clients must retain the returned token or reload status before their next
mutation. A logged-in session is valid for at most 43,200 seconds, and access
checks re-read status/role from server storage. Failure to open that storage
returns 503 `auth_unavailable`, never a guest bypass.

`AUTH_DIR=/var/lib/govern/auth` stores `accounts.sqlite` in the separate
`account_data` Docker volume, outside public files and work-database exports.
PHP PDO SQLite and Argon2id support are required. Email is only an account
identifier: email verification, email delivery and password-reset/recovery
endpoints are not implemented. Bindings/allowed hosts remain loopback-only;
these accounts do not make this configuration an internet service.

Nginx protects every native `/phpmyadmin/` route with internal
`/_govern_auth` → `/auth-check.php`. An approved session returns 204; missing
login returns 401, and failed checks deny access. The gateway converts missing
login to an explicit 302 redirect to `/auth.php?mode=login`. The internal location
cannot be requested directly. Native uploads/downloads and direct links receive
the same check; official phpMyAdmin remains the actual application.

## Eerste eigen SQL-import

Govern ondersteunt naast de officiële phpMyAdmin-import een beperkte eigen route in de
bestaande Import-tab. Deze route accepteert **UTF-8 SQL-bestanden tot 262144 bytes**.
De browser leest het bestand lokaal als tekst en verstuurt JSON met CSRF, zonder
server-side uploadbestand of opgeslagen SQL-concept.

- `POST native-import-preview?database=<name>` met `{sql:string}` retourneert
  `{database,bytes,sha256,statement_count,destructive,destructive_truncated,before,preview_token,max_bytes}`.
  `before` is dezelfde best-effort cataloguscontrole als `GET import-inspection`.
  Er wordt nog geen SQL uitgevoerd. De risicoselectie is **geen volledige parser-audit**.
- `POST native-import-execute?database=<name>` met
  `{sql:string,preview_token:string,confirmation:string}` vraagt de exacte
  databasenaam als bevestiging. De preview-token bindt bestand, database en
  geobserveerde staat. Wanneer de staat wijzigde volgt HTTP 409.
  De server houdt bij deze fase een exclusieve onderhoudslock vast.
  Als vooraf al tabellen of views bestaan, inclusief interne applicatietabellen, wordt onder die lock
  eerst een automatisch herstelpunt gemaakt. De uitvoerder stopt op een SQL-fout.
  De respons bevat `completed,executed,statement_count,failed,before,after`,
  toegevoegde/verwijderde objectnamen, `unchecked_rows` en zo nodig
  `safety_snapshot:{id}`. Er wordt nooit automatisch hersteld na een fout.

Import gebruikt de bestaande `SqlScript` en `QueryRunner`, met dezelfde
schrijfrechten als vrije SQL. Een bestand met `USE` of gekwalificeerde namen
kan dus ook een **andere toegestane database** wijzigen. Een token of
databasekeuzelabel is geen SQL-sandbox. De controle toont alleen wat daadwerkelijk
wordt gemeten en kan gelijktijdige wijzigingen in phpMyAdmin niet blokkeren.
De phpMyAdmin-import blijft nodig voor grote of niet-ondersteunde SQL-bestanden.

## Database scope

### Optional PostgreSQL connection

The default connection remains `mariadb`. PostgreSQL requests specify
`connection=postgres&database=<configured database>&schema=<configured schema>`
on every scoped API URL. Missing `database`/`schema` parameters use that
connection's configured defaults. The browser cannot submit a hostname, port,
role or password. Unknown connections, databases and schemas return 403
`database_not_available`; selecting a scope does not grant access.

For compatibility with cached API modules from before PostgreSQL support,
`database` may contain the complete server-issued `postgres:<database>:<schema>`
workspace key when both `connection` and `schema` parameters are absent. Its
percent-encoded identifiers pass through the same configured scope validation.
Malformed keys and packed keys combined with explicit connection/schema
parameters return 403 `database_not_available`. Normal authentication, CSRF
and PostgreSQL capability checks still apply.

`GET databases` remains an installation-wide list. Each entry retains
`name` and `available`, and adds `connection`, `engine`, `schema`, `scope_key`
and `label`. MariaDB scope keys remain the exact database name. PostgreSQL keys
are `postgres:` + RFC 3986 percent-encoded database + `:` + percent-encoded schema.
The UI stores this complete key in its per-tab selection, state caches, diagram
layout and bookmarks. API requests expand it into separate connection/database/
schema parameters, so equal table names in separate schemas stay independent.
Only names from `PG_DATABASE` and `PG_SCHEMAS` are listed for PostgreSQL;
configured schemas that cannot be read remain visible with `available:false`.

PostgreSQL supports authenticated GET actions `bootstrap`, `schema`,
`structure`, `browse`, `explore`, `record-map-records`, `row-editor`,
`import-inspection`, `snapshots` and `download-snapshot`; the read-only POST
`record-map`; and POST `insert-row`, `update-row`, `delete-row`, `query`,
`native-import-preview`, `native-import-execute`, `dataset-preview`,
`dataset-import`, `create-snapshot` and `restore-snapshot`. Normal methods,
sessions and CSRF checks apply. `query` accepts manual SQL only; visual designs
remain unsupported. Other scoped actions return 403 `postgres_read_only` before
the corresponding service runs, including saved queries, database creation,
context export and AI. phpMyAdmin is never a PostgreSQL fallback.

Bootstrap adds `scope_key` and `capabilities`, and database fields
`connection`, `engine`, `schema` and `scope_key`. Read capabilities are true.
`write` requires separate row-writer credentials. `query` and `import` require
SQL credentials; `snapshots` requires the configured tools socket. These flags
describe configured routes, not a successful live connection; database grants
and service errors remain authoritative. `query_builder`, `saved_queries`,
`phpmyadmin`, `create_database`, `ai` and `context` remain false for PostgreSQL.
The normalized catalog/browse response retains the existing table, column and
relationship fields. PostgreSQL browse includes exact `row_keys` and
`key_columns` for supported complete identities, independently of preview
shortening. Unsupported rows keep null keys. Schema responses use
`database` for the selected schema namespace and `database_name` for the real
PostgreSQL database, keeping external-schema foreign keys distinguishable.
Structure can leave `create_sql` empty rather than inventing a full table DDL.

### Compatibility: read-only record exploration

`GET explore` remains available for existing clients. The unified Explore
workspace uses the paginated record-map endpoints below; it does not combine
these two response shapes or their node IDs into a second graph.

`GET explore` accepts a catalog `table` and an optional `key` containing a JSON
object with the record's complete primary or non-nullable unique key. Ordinary
connection/database/schema scoping, account access and GET-only checks apply.
The service uses the database reader for both engines and accepts no SQL.
Keys are limited to 2,048 encoded JSON bytes so generated GET requests remain
usable; oversized or unsupported stored identities are explicitly omitted.

The response contains `scope_key`, `table`, `center` (a node ID or null),
`candidates` for the starting-record picker, `nodes`, `edges`, `relations`,
`limits`, `partial`, `omitted` and `elapsed_ms`. Each node carries an opaque,
scope-specific stable `id`, `table`, `label`, exact `key`, preview `values` and
`truncated` flag. Preview values are never used as record identity.

Edges point from the referencing record to the referenced record. Each includes
its source/target node IDs, foreign-key `name`, source/target tables, ordered
`columns`/`referenced_columns`, and matching `source_values`/`target_values`.
Only catalog-declared foreign keys within the selected schema are followed.
The evidence describes database references, not a claim of causal influence.

Each response covers one starting record and one hop of incoming/outgoing
neighbors. Fixed limits are 25 starting candidates, 15 neighbors per relation,
12 relations, 60 nodes and 120 edges. `partial` and `omitted` describe skipped
or bounded content; the response is not a full-database graph or total count.
Keyless tables/views produce an empty graph and an explicit omission. Malformed
keys return 422 and a requested record that no longer exists returns 404.
Exact key and relationship scalars are serialized as text by the engine before
PDO conversion, preserving adjacent DOUBLE values as separate identities.

The endpoint performs no row, schema, privilege or account mutation and does
not enable the PostgreSQL SQL editor. Clients must keep the complete scope
attached to requests and ignore replies belonging to an older scope.

The public `health` action continues to check only the fixed MariaDB startup
connection. PostgreSQL readiness appears in its authenticated bootstrap data;
an unavailable optional PostgreSQL connection does not become a health target.

### Unified Explore workspace and record-map API

Both engines use the same read-only map endpoints. Every request carries the
ordinary connection/database/schema URL scope and requires an approved account.
Map operations use the reader connection and the ordinary maintenance lock.
They accept no SQL, host, credentials or identifier expressions from the browser.

`GET record-map-records` accepts `table`, `q`, `page` and `page_size` and returns
`{table,nodes,key_columns,supported,reason_code?,page,page_size,has_more,next_page?}`.
It lists possible starting records from one live catalog table. The default
page size is 25, capped at 50. Unsupported views or record identities are
explicit; they do not become invented node IDs.

`POST record-map` uses JSON and the normal `X-CSRF-Token` header. Its input is
`{table:string,key:object,relation?:string,offset?:integer,page_size?:integer}`.
`key` contains the complete selected primary or suitable non-nullable unique
key. Every value is an exact string, including large integers. Extra, missing
or fabricated key fields are rejected, and the selected record is read again.
An omitted `relation` inspects that record and lists its declared incoming and
outgoing references. A `relation` ID returned by the live catalog expands one
reference, with offset pagination and a default page size of 25 (maximum 50).

The result is
`{focus,nodes,edges,relations,has_more,next_offset,relation?}`. Nodes contain
`{id,table,key,label,row,columns,truncated}`. `key` and `row` remain JSON objects,
including when identifiers look numeric. Stable node IDs include connection,
database, schema, table and the complete canonical key; preview text is never
the source of identity. Large display values can be shortened explicitly.
Identity and relationship columns are projected as engine text before PDO
conversion, keeping adjacent floating-point keys distinct from rounded browser
or PDO numeric previews.

Edges contain source/target node IDs, `kind:"foreign_key"`, constraint name,
source/target table and column names, exact source/target keys, and
`source_values`/`target_values` objects keyed by their original column names.
These additive objects carry complete matching FK values as text (or null),
separately from shortened node previews and record primary keys. `evidence`
contains prepared SQL, parameters, ordered column pairs and schema names.
Relation descriptors identify incoming/outgoing direction and indicate whether
the reference can be expanded. Cross-schema references, views and unsupported
record keys remain labelled unavailable rather than being redirected to a
same-named table in the current scope. Composite and self-references retain
their declared identities. A nullable reference without matching values does
not create a fictional target record.

Only current records matching a declared foreign key create edges. This API
does not generate semantic similarities, AI inferences or causal claims. Map
selection and fetched previews stay in per-scope browser memory, not persistent
browser record storage. Opening a selected source record in Records reads it again
through `record-map`; it does not rely on a shortened preview or the first page
of a table. Pagination describes the loaded result, not a claim that the entire
database has been mapped. See [RECORD_MAP.md](RECORD_MAP.md).

The workspace route is `#verkennen`; old `#verbanden` bookmarks resolve to the
same workspace. Canvas movement, pinning, hiding, arrangement and undo are
client presentation operations. They introduce no write endpoint or free-SQL
argument. Undo must not resurrect an older record preview, edge or relationship
cursor after that evidence has been refreshed. Changing the active connection,
database or schema keeps each scope's temporary workspace separate.

### Existing MariaDB scope

Every scoped endpoint accepts the URL parameter `database=<exact name>`, on GET
and POST alike. The request body does not change the target database. Omitting
the parameter retains `DB_NAME` for older clients and links. There is no mutable
server-session selection; two browser tabs can use different databases safely.

`GET databases` returns `{databases:[{name,available,...}],default_database,can_create}` without
requiring a selected database connection. Available names are the intersection
of the writer's and reader's live `SHOW DATABASES` results, excluding
`information_schema`, `mysql`, `performance_schema` and `sys`. `DB_NAME` and
`DB_DATABASES` also remain listed when unavailable, so recovery stays reachable.
Selecting a name outside this set returns 403 `database_not_available`. Selection
does not grant privileges. The separate explicit preparation action below can
add a named database through the private provisioner. Free SQL may use `USE` or qualified names to reach
other schemas already allowed by the same database account.

The browser includes the selected database in routes, requests, downloads and
context exports. It remembers the choice per tab in `govern.database.v1`
session storage, and keeps table/search state, SQL drafts, results and visual
builder state separately per database in memory. Changing scope cancels old
reads and ignores late replies. Async mutations capture their original scope.

### Create or prepare a database for import

`POST prepare-database` accepts exactly `{name:string}` with the ordinary CSRF
header and explicit current `database` URL parameter. The current selection is
still validated; `name` names the database to prepare rather than silently
changing that request's scope. The response is
`{database:string,created:boolean,databases:[{name,available}],default_database}`.
The refreshed list is read from the actual writer/reader visibility after the
operation. The browser deliberately selects the returned database after success.
The status is 201 when a database was created and 200 when an existing database
was prepared without replacing its data.

Names contain 1–64 ASCII letters, digits or underscores. The escaped GRANT
pattern must also fit the supported database-name length. System names
`mysql`, `information_schema`, `performance_schema` and `sys` are rejected
case-insensitively. Extra input fields, invalid names and system names return
422 `database_create_invalid`. The browser cannot provide SQL, account names,
collation, root credentials, a socket path or an import file to this endpoint.

The private `database-manager` service supports only a bounded
`prepare_database` request over `/run/govern-databases/provision.sock`. It creates
the named database if missing and grants the existing writer and reader their
per-database rights. An existing name is explicitly made available without
replacing its data. Repeating the operation can finish access setup after a
partial failure; it does not drop data or reset account passwords. Grants persist
in the MariaDB volume, so newly prepared databases remain discoverable after
restart without an edit to `DB_DATABASES`.

`can_create` and bootstrap's additive `can_create_database` report availability
of this local preparation path, independently of ordinary database browsing.
They do not guarantee that a later create request succeeds. An unavailable
socket returns 503 `database_manager_unavailable`; a failed database operation
returns 503 `database_prepare_failed`; an invalid helper reply returns 502
`database_manager_invalid`. Errors use the ordinary bilingual envelope and do
not expose SQL or credentials.

`GET import-inspection?database=<name>` is a read-only snapshot of the selected database,
using the same maintenance lock and the reader account. It returns
`{database,tables:[name],views:[name],foreign_keys,row_counts:{table:integer},
unchecked_rows:[name],total_records:integer|null,template,expected_foreign_keys,
missing_tables,missing_views,missing_foreign_keys,sections:[{key,expected,present,missing,empty,records}]}`.
Only catalog-resolved tables are counted; large tables (>250,000 estimated rows),
tables beyond the first 40 and failed counts are marked unchecked. A null
`total_records` means the result is not exact. A `bestuursatlas` template report
compares 23 known tables, three views and 54 foreign-key constraints and groups
missing or empty tables into five content areas. These checks detect structural
and numerical differences, not semantic truth or a successful transaction.

SQL upload is handled by official phpMyAdmin, not by a new Govern import parser.
The database modal's Import shortcut opens `/database/import` or `/table/import`
with the chosen `db` and optional `table`. The existing 128 MB upload and 300-second
execution settings apply. Import may modify or replace data according to its
SQL; DDL is not generally transactional and no universal rollback is promised.
Closing the modal refreshes the live catalog. Databases on other servers are
not connected by this operation.

## Language and compatible feedback

Send `Accept-Language: nl` or `Accept-Language: en` for application feedback.
Regional tags and quality weights are supported; the highest-quality supported
language wins. Missing, unsupported or excluded preferences fall back to Dutch.
Regular JSON replies include `Content-Language` for the selected language.

The selected `error`, `warning`, `notice`, `message` and `explanation` fields
remain readable on their own. Their additive translation maps let the interface
change language without rerunning an already completed SQL query:

| Field | Shape | Available when |
| --- | --- | --- |
| `error_i18n` | `{nl:string,en:string}` | An application error has a known message code |
| `warning_i18n` | `{nl:string,en:string}` | Bootstrap returns a connection or recovery warning |
| `notice_i18n` | `{nl:string,en:string}` or `null` | Browse or query preview has been shortened |
| `message_i18n` | `{nl:string,en:string}` | A restore action returns its completion message |
| `explanation_i18n` | `{nl:string[],en:string[]}` | A visual query has been compiled |

Clients may use the current language's map entry and fall back to the existing
selected field. Keep `error_code` independent of its visible wording and treat
`error_params` as a JSON object, including `{}` when empty. Parameters contain
bounded diagnostics, identifiers, field label keys or numeric limits as needed;
render feedback as text. Do not infer error identity by matching a translated
sentence. The backend catalog is `app/src/Messages.php`.

Language never changes identifiers, SQL, bound values, stored notes or records.
Driver SQL diagnostics retain their text within the existing display limit.
Context attachments, backup SQL files and saved restore point labels keep their
existing contents; changing the interface language does not translate exports.

Appearance and dashboard layout are browser preferences, not API resources or
database schema. The current keys are `govern.preferences.v1` and
`govern.dashboard.v1`. They do not change saved research or database data and do
not provide cross-device syncing. See [the design guide](DESIGN.md) for the
interface and future feature rules.

## Endpoints

- GET `databases`: `{databases:[{name,available}],default_database,can_create}`; see database scope above.
- POST `prepare-database` exactly `{name}`: `{database,created,databases:[{name,available}],default_database}`; see database preparation above.
- GET `bootstrap`: `{csrf, databases:[{name,available}],default_database,can_create_database,database:{name,version,status,available}, stats:{tables,views,rows_estimate}, tables:[{name,type:"table"|"view",comment,rows_estimate,columns}]}`. An unavailable database can also return `warning` and `warning_i18n`; bootstrap still supplies the selected database name and CSRF token for recovery.
- GET `browse&table=...&page=1&page_size=25&q=...`: `{table,columns:[{name,type,nullable,default,generated,primary,comment}],rows:[{column:value}],key_columns:[name],row_keys:[object|null],page,page_size,total,sql,params,truncated,notice,notice_i18n}`. `row_keys` aligns with `rows` and is extracted before preview truncation; key values are exact strings, binary keys hex encoded. Named identifiers verified against live catalog; values bound; max page_size100. App-owned `_govern_` tables excluded from normal list, remain accessible in phpMyAdmin.
- GET `structure&table=...`: `{table,columns:[...],indexes:[{name,unique,columns:[name]}],foreign_keys:[{name,columns:[name],referenced_table,referenced_columns:[name]}],create_sql}`.
- GET `schema`: `{database:string,tables:[{name,type:"table"|"view",comment,columns:[...],foreign_keys:[{name,columns:[name],referenced_schema,referenced_table,referenced_columns:[name]}]}]}`. Full live metadata for the schema visualizer, read through the restricted reader with three batched catalog queries. No table rows, DDL, credentials or saved queries; `_govern_` source tables are excluded.
- GET `row-editor&table=...&key=<JSON object>`: `{database,table,type,editable,can_insert,key_columns,columns,row,key,version,reason,reason_code,reason_i18n}`. Omit `key` to describe insertion. See the row contract below.
- POST `insert-row` `{table,values}`: 201 `{affected_rows,key,row,version}`. POST `update-row` `{table,key,version,values}` returns the same shape. POST `delete-row` `{table,key,version}` returns `{affected_rows,key,row:null}`. CSRF required; database scope stays in the URL.
- POST `query` exactly one of `{sql,confirm?:boolean}` or `{design}`, with JSON property order immaterial. A design returns `{columns,rows,truncated,duration_ms,returned_rows,sql,notice,notice_i18n,explanation,explanation_i18n}` and runs on the read-only account (SELECT grants + READ ONLY transaction, definer views included). Free SQL runs on the scoped write account; see the script contract below. CSRF is required.
- POST `build-query` exactly `{design}`: `{sql,explanation:[string],explanation_i18n:{nl:[string],en:[string]}}`. Validates against the live schema and generates editable, standalone SQL; does not execute the generated question.
- GET `queries`: `[{id,name,sql,notes,updated_at}]`, stored in the selected schema's `_govern_queries`.
- POST `save-query` `{id?,name,sql,notes?}`: saved item. POST `delete-query` `{id}`.
- GET `snapshots`: `[{id,label,created_at,size_bytes,sha256}]`.
- POST `create-snapshot` `{label}`: created snapshot descriptor.
- POST `restore-snapshot` `{id,confirmation}`: confirmation equals selected database name. `{restored:id,safety_snapshot:<descriptor>|null,message,message_i18n}`. Creates safety export before restore when the DB exists; null if already absent. Snapshot service independent of live schema; can restore a configured target DB that was dropped. Bootstrap still returns CSRF and selected DB name with available=false if absent.
- GET `download-snapshot&id=...`: attachment SQL. Strict server-generated snapshot ids only.
- GET `context`: attachment JSON of schema and saved queries, no table rows or credentials.
- GET `ai-status`: actual optional local-provider configuration and readiness; see the AI contract below.
- POST `ai-context` `{scope?,message?,targets?,route?}`: bounded schema/UI context, or local project passages when `scope:"project"`; without table records.
- POST `ai-chat` `{scope?,message,targets?,route?,language?,history?}`: schema explanation and optional SQL proposal, or cited project explanation; never executes a proposal.
- GET `health`: unauthenticated `{status:"ok"}` when the fixed base-configuration
  database is readable. Caller-supplied `database` does not change that check.
  This route does not enumerate accessible schemas or disclose credentials.

## Optional local AI

AI calls use the ordinary same-origin session, POST CSRF checks, error envelope
and explicit `database` URL parameter. A body cannot choose a different database,
provider address, model or database account. AI is optional; `AI_ENABLED=0` keeps
the workspace usable and produces a truthful disabled status without a provider
request. Local project search in `ai-context` remains available without a model.
The existing `context` download is separate and retains its contents.

`scope` is `"database"` (default, compatible with existing requests) or
`"project"`; any other value returns 422 `ai_input_invalid`. Project scope
chooses a local source area, not another database or a filesystem permission.
It keeps the ordinary session, CSRF and selected-database validation but does
not read the catalog or acquire the database maintenance lock.

### Status

`GET ai-status` returns:

```json
{
  "enabled": false,
  "provider": "ollama",
  "model": "qwen3:4b-instruct",
  "status": "disabled",
  "ready": false,
  "models": [],
  "capabilities": {
    "schema": true,
    "project": true,
    "records": false,
    "execution": false,
    "chat": false,
    "sql_proposals": false
  }
}
```

When enabled, status checks `/api/tags` with a two-second timeout. Status is
`offline` for connection/invalid-provider-reply failures, `model_missing` when
the configured local model is not listed, or `ready` when it is available.
`chat` and `sql_proposals` become true only when ready. An offline response may
include `error_code`; readiness is a current connectivity/model-list check,
not a guarantee that a later generation will succeed. Cloud model aliases are
not offered as local models and no status check downloads a model.

The additive `project` field reports the local reader status independently of
model readiness: `{status:"ready"|"unavailable",roots:["app","docs"],sources:[],
truncated:false,files_scanned:0}`. Status does not index file contents.
`capabilities.project:true` means that local preview/search is supported, not
that inference is enabled or that an answer has been verified.

### Database context preview

With omitted `scope` or `scope:"database"`, `POST ai-context` accepts an optional `route` (one of Govern's existing route
names, default `overzicht`) and `targets`, a list of up to eight objects:

```json
{
  "route": "structuur",
  "targets": [
    {"kind": "table", "table": "digital_systems"},
    {"kind": "column", "table": "digital_systems", "column": "code"}
  ]
}
```

Supported kinds are `table`, `column`, `row`, `cell`, `relationship`, `control`,
`element` and `workspace`. Data kinds require a table; `column` and `cell` also
require a column. Supplied names are checked against the current selected
schema. Data target labels are regenerated from those identifiers so a row/cell
label cannot attach its record value. UI targets can carry bounded `label`
(240 UTF-8 bytes) and `tag` (64 bytes). These remain untrusted source text.
Client `record`, `value`, key, SQL and other extra snapshot fields are not
forwarded as context. App-owned `_govern_` tables are not AI sources.

The result is
`{database,route,targets,sources,records_included:false,truncated,context_id}`.
Each source includes `table`, `type`, bounded `comment`, `column_count`,
`foreign_key_count`, `columns`, `foreign_keys`, `columns_omitted` and
`foreign_keys_omitted`. Column entries include name/type, nullable/primary/
generated flags and a bounded comment; foreign keys retain declared source and
target identifiers. There are no row values, column defaults, saved research,
app settings or credentials. `context_id` is a SHA-256 fingerprint of the
selected database/schema/target snapshot, not a permission token.

The whole context JSON is limited to 6,000 UTF-8 bytes, including its ID. Keep
every chosen source visible and prioritise selected columns; add metadata only
while it fits. Omitted metadata and shortened comments set `truncated:true` and
the omission counts remain visible. If the source identities alone cannot fit,
return 413 instead of silently discarding a selected table. Invalid selection
input returns 422 `ai_context_invalid`; unavailable table/column names use the
ordinary catalog errors.

### Local project search

`POST ai-context` with `scope:"project"` accepts `message` as a local search
question (at most 4,000 UTF-8 bytes) and optional `route`. An empty message
returns reader status without scanning sources. `targets`, browser paths,
source passages and other extra client metadata never select files. Example:

```json
{
  "scope": "project",
  "message": "How does switching databases work?",
  "route": "overzicht"
}
```

The result retains the common context fields and uses a separate source shape:

```json
{
  "database": "bestuursatlas",
  "route": "overzicht",
  "scope": "project",
  "targets": [],
  "records_included": false,
  "truncated": false,
  "context_id": "<sha256 of this context snapshot>",
  "project": {
    "status": "ready",
    "roots": ["app", "docs"],
    "files_scanned": 42
  },
  "sources": [
    {
      "id": "S1",
      "path": "app/src/DatabaseScope.php",
      "start_line": 1,
      "end_line": 4,
      "content": "<actual bounded source passage>",
      "sha256": "<sha256 of the sanitized file snapshot>"
    }
  ]
}
```

Paths are relative to a server-owned project root. `AI_PROJECT_ROOT` is server
configuration only; the local source checkout defaults to its repository root,
and Docker sets `/opt/govern/project`. Only `app/` and `docs/` are offered there,
read-only and outside the public webroot. Supported text is restricted to PHP,
JavaScript, CSS and Markdown. Symlinks, hidden paths, excluded dependency/data
folders, binary/invalid UTF-8 content and recognizable secret file names are
skipped. Entire lines containing recognizable literal secrets or overlong
content are omitted. Returned passages contain exact original safe lines and
actual line numbers, without replacement text. Detection is best effort, not a
guarantee that all possible secrets are detected.
No arbitrary file read endpoint or folder chooser is introduced.

The words/identifier index is rebuilt in memory on each search. There is no
persistent vector database, model training, shell command or external request.
At most three source passages fit within a 5,000-byte JSON source budget;
file count, file size and total bytes read are also bounded. `truncated` marks
limits or omissions. `sha256` identifies the sanitized file snapshot, with internal omitted-line
markers used only for hashing and never returned in source passages. It is not
an authorization token or a claim that a later edit cannot occur.

### Chat and proposals

`POST ai-chat` adds `message` (nonblank, at most 4,000 UTF-8 bytes), optional
`language` (`nl` or `en`, default `nl`) and optional `history`:

```json
{
  "message": "Leg uit hoe deze tabellen met elkaar verbonden zijn.",
  "route": "schema",
  "targets": [{"kind": "table", "table": "digital_systems"}],
  "language": "nl",
  "history": [{"role": "user", "content": "Wat betekent een foreign key?"}]
}
```

History accepts up to eight `user`/`assistant` entries, 4,000 bytes in total.
System/tool roles are rejected. The backend builds context again for this
request; a preview supplied by the client is not a substitute for live metadata.
It prepares the snapshot under the ordinary metadata lock, then releases that
lock before waiting for the provider. No database reads occur in `completeChat`.

The response is
`{database,model,answer,sql,context,history_truncated}`. `answer` is nonempty plain
text; `sql` is a string or `null`. Each is limited to 16,000 bytes. A proposal is
untrusted text and must be shown or placed in the ordinary SQL editor, never
executed by receiving the response. Server-generated answers are not translated
again when the interface language changes.

The local `/api/chat` request uses `stream:false`, a JSON response schema for
`answer`/`sql`, a 4,096-token context setting and at most 768 generated tokens.
The complete messages JSON is capped at 10,000 UTF-8 bytes; oldest history is
removed to fit and `history_truncated:true` reports this. If the required current
context/question cannot fit, the request returns 413. Byte bounds are not an
exact tokenizer budget. HTTP replies are capped at 128 KiB, redirects are not
followed, and unexpected tool calls or malformed/incomplete output are rejected.

Known AI failure codes include `ai_disabled` (503), `ai_config_invalid` (503),
`ai_unavailable` (503), `ai_timeout` (504), `ai_response_invalid` (502),
`ai_input_invalid` (422), `ai_input_too_large` (413), `ai_context_invalid` (422)
and `ai_context_too_large` (413). Client abort discards the response and does not
promise cancellation of an already running model calculation.

### Cited project answers

`POST ai-chat` with `scope:"project"` uses the same bounded nonblank `message`
and `language` as database chat. History is validated by the common input
contract but omitted from the project model request; `history_truncated:true`
reports that omission when applicable. The server searches the current files
again; a browser preview, supplied file path or previous answer is not evidence.
The ordinary `AI_ENABLED` check still applies to chat.

The provider receives the question and a bounded snapshot of retrieved passages,
marked as untrusted source data. Its project-specific structured output is
`{answer:string,citations:[{source_id:string,quote:string}]}` with no SQL field.
The server accepts only existing source IDs and nonempty literal quotations
present in the supplied passages. It derives paths and line ranges itself.

The response retains common chat fields and adds:

```json
{
  "scope": "project",
  "sql": null,
  "grounded": true,
  "citations": [
    {
      "source_id": "S1",
      "path": "app/src/DatabaseScope.php",
      "start_line": 1,
      "end_line": 2,
      "quote": "<exact quotation from the supplied passage>",
      "sha256": "<sanitized file snapshot hash>"
    }
  ]
}
```

`context.sources` lists retrieved passages; `citations` lists the validated
references used by the answer. No sources or unavailable source folders skip
provider inference and return a localized abstention, `grounded:false`, empty
citations and `sql:null`. Invalid citations withhold the generated prose in the
same way. `refusal_reason` is `no_sources`, `sources_unavailable`,
`context_budget` or `invalid_citations` when abstaining. Model/protocol failures
still use the ordinary error envelope.

The combined messages JSON remains at most 10,000 UTF-8 bytes. Lowest-ranked
whole passages are dropped when needed; sources and context fingerprint reflect
what was actually supplied. If no useful passage fits, the result abstains.
Citations establish excerpt provenance, not semantic entailment of every claim.
Local retrieval does not erase a model's pretraining or promise that generated
text uses no prior general knowledge. The model has no SQL execution, file,
network or other callable tools. See [the local source boundary](AI.md).

Questions and history are client-provided and may contain text the user typed.
The automatic context exclusion is not a promise to redact that text. The
frontend keeps conversations and drafts temporarily in memory per database and
source area (at most forty messages per database/source area) and
ignores stale responses after scope changes. See [local AI](AI.md) for setup,
network boundaries and the next implementation stages.

## Direct row editing

Both engines use `row-editor`, `insert-row`, `update-row` and `delete-row` with
the same request shapes. The PostgreSQL route uses `PostgresRowEditor` and
never invokes the MariaDB editor. Every PostgreSQL URL must retain its explicit
connection, database and schema scope. The sections below describe the shared
contract and MariaDB details; PostgreSQL dialect differences follow.

The editor discovers columns and indexes from the current catalog. It prefers
the complete primary key, otherwise a complete unique index whose columns are
all non-nullable, non-generated and supported. Prefix/expression indexes are
not identities. `key` is an object containing exactly these column names and
string values; never construct a write payload from shortened browse cells.
The descriptor reads the actual row again and adds `editable`, `encoding`
(`text` or `hex`) and `large` to each ordinary column descriptor.

`values` maps exact column names to one of:

```json
{
  "description": {"mode":"value","value":"Exact text, including whitespace"},
  "optional_field": {"mode":"null"},
  "created_at": {"mode":"default"}
}
```

`value` is always a string, including BIGINT/DECIMAL values; no PHP or JavaScript
floating-point conversion is applied. Empty text is distinct from NULL.
Binary/blob values use pairs of hexadecimal digits and bound `UNHEX` expressions.
BIT and spatial fields remain read-only. Generated fields are never submitted.
Fields above 128 KiB, invalid UTF-8 text and fields outside the editor's 512 KiB
display budget are read-only; unchanged values remain intact. Submitted values
also have 128 KiB per-field and 512 KiB combined limits. Larger requests retain
the ordinary 1 MiB HTTP body limit. Use the official phpMyAdmin for unsupported
MariaDB editing tasks.

Insert may omit fields or use `default` to let MariaDB supply their defaults;
update changes only submitted fields and uses `DEFAULT(column)` when requested.
Constraints, strict SQL mode and database permissions remain authoritative.
Insertion into a base table does not require a key. Updating/deleting does;
views and tables without safe identity return an unsupported reason or 422.
The UI offers phpMyAdmin for those cases rather than guessing a row.

`version` is an opaque 64-character fingerprint of the database, table and full
record, including byte digests of fields that are not editable. Update/delete
re-read the row in a writer transaction with `FOR UPDATE`, check that version,
and include the full original key plus NULL-safe byte-digest predicates in the
mutation itself. A changed record returns 409 `row_stale`; a missing record
returns 404. Reload before retrying; never silently overwrite a concurrent edit.
The original key can be updated, and the response contains its new identity
when it can be read back. `key`, `row` and `version` may be null after an insert
or key-default change whose exact resulting identity cannot be determined.

Permissions failures map to 403 `row_permission_denied`; database constraint
failures retain bounded diagnostic detail in 422 `row_write_failed`. Other
invalid inputs return their stable localized error codes. No successful write
is inferred from a closed dialog: the API result drives refresh and feedback.

### PostgreSQL row editing

`PG_USER`/`PG_PASSWORD` select a separate, non-admin row-writer role. The reader
remains a real read-only session. The writer receives SELECT, INSERT, UPDATE,
DELETE on configured-schema tables and USAGE on their sequences, without free
SQL or DDL API access. Missing writer credentials leave `capabilities.write`
false; connection failures and database permissions are not hidden by the UI.

Schema-qualified identifiers come from the live catalog. The editor chooses a
complete primary or immediate unique index without NULL columns, expressions
or a partial predicate. Included index columns are not part of the identity.
Browse omits row keys whose percent-encoded JSON exceeds 4,096 bytes, keeping
editor GET URLs within practical request limits.
Values and keys are cast to text in PostgreSQL before PDO conversion; `bytea`
uses hexadecimal text and bound `decode(..., 'hex')` expressions. INSERT may
omit fields or use DEFAULT VALUES; updates use PostgreSQL's `DEFAULT` keyword.
Generated columns and generated-always identities are read-only and omitted;
serial and generated-by-default identities can use defaults or explicit values.
RETURNING reads the resulting exact identity, including server-created defaults.

The opaque version is bound to the database, schema, table, catalog definition
and complete row. Updates/deletes reread using `FOR UPDATE` and compare the
version, then guard the SQL mutation atomically with the original identity and
tuple version. A newer row returns 409 `row_stale` without overwriting it.
PostgreSQL constraints and triggers remain authoritative. An AFTER trigger that
changes or removes the returned identity can leave `key`, `row`, `version` null;
the client refreshes browse rather than inventing a new identity. Inserts into a
keyless table also return null identity fields.

Editing supports PostgreSQL integer, numeric and float types; bool; text,
varchar, bpchar and name; date/time/timestamp/interval; UUID; JSON/JSONB; bytea;
inet/cidr/macaddr/macaddr8; money and enums, including supported base types under
a domain. Array, composite and other unknown fields are read-only and retained
when another field changes. A required unsupported field without a default
makes insertion unavailable. Plain tables without inheritance children and
partitioned tables can be edited; views, materialized views, foreign tables and
inheritance parents remain read-only. Unsupported tables and identities return
a descriptor reason or 422; no phpMyAdmin action is offered for this engine.
The same per-field/form/body limits apply.

## PostgreSQL SQL, imports and schema snapshots

`POST query` with `{sql:string,confirm?:boolean}` uses `PostgresQueryRunner`
and `PostgresSqlScript`, retaining the ordinary per-statement/result_sets
response shape and destructive-confirmation flow below. Each run opens one
fresh `PG_SQL_USER` session with the selected schema search path, UTC and native
prepared settings. There is no SQL permission sandbox: qualified SQL, functions
and search-path changes can touch other granted schemas. No database/schema
creation, administrative role or transfer of existing object ownership is added.
Creating a new table in a permitted schema is supported; altering an existing
object owned by another role can fail with the database permission error.

The PostgreSQL parser supports dollar quotes, E strings, double-quoted
identifiers and nested block comments. Client backslash commands and COPY over
STDIN/STDOUT are unsupported; this route is not a general `psql` script or
plain `pg_dump` import. When a statement can change string-lexing settings,
the advisory preview reports an unknown statement count rather than evaluating
it. The actual session setting determines the next parse; an unsupported
command reached later then fails while earlier committed work can remain. SQL is bounded to 256 KiB, each result to 200
preview rows, and display byte budgets retain the shared limits. Earlier
completed results survive a later error. Open transactions are rolled back
before discarding the session, while already committed work remains. NOTICE
counts are not collected: statement `warning_count` is 0, `warnings` is empty
and `notices_available:false` distinguishes this from a verified absence of
PostgreSQL notices. Catalog refresh preserves SQL, results, focus and caret.

`native-import-preview` and `native-import-execute` keep their existing request
shapes but bind the token to full PostgreSQL scope, SQL bytes and inspection
states for all configured existing schemas. Preview adds `schema`, `scope_key`,
`confirmation:"database.schema"` and `safety_schemas`. Execution requires that
exact confirmation. Under the global exclusive maintenance lock it first calls
`PostgresBackupService::createLocked` for every configured existing schema. A
failed copy aborts before any import SQL. Execution returns the normal before/
after/result fields plus `safety_snapshots:[{schema,id,restore_available}]`; `safety_snapshot`
retains the selected schema's `{id,restore_available}` for compatibility. A copy
can be exported even when incoming dependencies currently block direct restore;
`restore_available:false` requires an explicit coordinated/manual-recovery notice. Qualified SQL can affect
several schemas, so these separate copies are not a universal rollback. An
unavailable post-inspection is reported without inventing exact counts.

`PostgresBackupService` uses a private Unix-socket worker for list/create/
restore/download, never arbitrary SQL, archive upload or caller paths. Server
configuration fixes the database, schema allowlist, credentials and backup root.
Each checkpoint includes scope, format `postgres-custom-v1`, byte size, SHA256
and creation time. IDs and confined regular files are verified before use;
symlinks, scope mismatches and altered archives are refused. Download is an
`application/octet-stream` `.dump` PostgreSQL custom archive, bounded to 512 MiB.
It is not a SQL text file and is not accepted as a native SQL-import upload.

Restore requires exact `database.schema`. It first creates a safety point when
the schema exists, refuses unsupported object classes or incoming cross-schema
dependencies, then atomically replaces the entire chosen schema and removes
newer objects. Foreign tables, custom aggregates, extension members and unknown
object classes are conservatively unsupported; database-wide roles/extensions/
settings and large objects are outside schema snapshots. The read-only account
must be able to dump complete data; inaccessible/RLS content fails the snapshot
instead of silently producing a partial checkpoint. Outside dependencies needed
by the restored objects must still exist. External PostgreSQL sessions do not
participate in the app maintenance lock.

Archive content runs with an actual non-superuser `PG_RESTORE_USER` login,
never an admin-authenticated `SET ROLE` session. The worker's fixed admin
lifecycle operation can transfer only the selected schema ownership for the
explicit restore, reverting an existing schema owner afterward. Restored objects are
owned by the restricted restore role; old owners/custom ACLs are intentionally
not restored. Standard application grants/default grants are reapplied. The
web app never receives `PG_ADMIN_PASSWORD` or `PG_RESTORE_PASSWORD`.

## Free SQL scripts

`QueryRunner::executeScript` accepts DML, DDL, diagnostic statements, transactions,
stored routines and triggers under the same database grants used by phpMyAdmin.
There is no read-only keyword allowlist. `DELIMITER` lines are client directives,
not server statements; their token may contain up to 32 non-whitespace bytes,
excluding quotes and backslashes. Quoted delimiters and ordinary comments stay intact;
standalone MySQL `/*!...*/` and MariaDB `/*M!...*/` executable comments reach the
server. Parsing starts from the configured connection SQL mode and tracks
ordinary literal `SET sql_mode` assignments. See the advanced mode note below
for dynamically computed mode changes.

A completed or partially completed run returns:

| Field | Meaning |
| --- | --- |
| `confirm_required:false` | Execution was attempted |
| `statements` | Results in submitted order; a partially failed `CALL` can retain its produced result sets |
| `failed` | `null` or `{index,sql,detail}`; `index` is the actual one-based failed statement, excluding delimiter directives |
| `statement_count` | Exact total once parsing reaches the end; otherwise a known preview count or `null` |
| `executed` | Number of fully completed statements, excluding a partially failed statement |
| `transaction_rolled_back` | An unfinished transaction was explicitly rolled back before discarding the session |
| `schema_refresh_needed` | A manual statement was attempted; refresh metadata even when a `CALL` hides writes |
| `duration_ms`, `sql` | Whole-run duration and original script |

Each statement result retains the compatible first-set fields
`{sql,columns,rows,truncated,returned_rows,affected_rows,duration_ms}` and adds:

- `result_sets:[{columns,rows,truncated,returned_rows,affected_rows}]`, including
  every rowset returned by `CALL`; row-bearing sets can have different columns.
- `completed:boolean`, false when later processing of that statement failed.
- `warning_count`, read from the native driver status without a SQL query.
- `warnings:[{level,code,message}]`, normally empty for earlier statements. Only
  the final actual statement can include up to 20 available diagnostic messages,
  each bounded to 2,000 bytes. Text stays as returned by the database. Insert
  `SHOW WARNINGS` immediately after a step when its diagnostic rows are needed
  before subsequent statements run.

`affected_rows` is null for a row-bearing result. The preview limits are 200 rows
and 2 MiB per rowset, with 8 MiB of row data across a script. They bound displayed
data, not affected database rows. SQL text remains limited to 256 KiB; initial
statement timeouts and disabled `LOCAL INFILE` remain connection settings.

Before execution, an advisory scan uses the existing confirmation flow for
`DROP`, `TRUNCATE`, `DELETE`/`UPDATE` without `WHERE` and `ALTER ... DROP`.
An unconfirmed run returns
`{confirm_required:true,destructive:[{index,line,sql,reason}],statement_count}`
without executing the script. SQL-mode expressions and dynamic prepared SQL can
make future parsing unknown: the count and preview index may be `null`, and the
scan can conservatively flag potentially destructive text. It does not evaluate
expressions or run preview statements. This confirmation is not a permission or
SQL-security boundary; the database grants remain authoritative.

One run owns one fresh writer session. Session variables, temporary tables and
transactions work across statements within that run, not across HTTP requests.
Include `COMMIT` or `ROLLBACK` in the same submission. On failure, committed work
can remain while an unfinished transaction is rolled back; DDL may commit
implicitly. Stop at the first failure and preserve completed results. The UI
shows rollback and warning feedback, refreshes the catalog, and retains the SQL
draft, result snapshots, focus and caret. Arbitrary SQL result sets do not imply
a source table or primary key for the selection explainer.

### Diagnostic state and advanced SQL modes

PHP 8.4 `PDO::connect()` supplies the native `Pdo\Mysql` driver, whose
`getWarningCount()` needs no SQL statement. The runner leaves ordinary DML,
`SELECT`, `CALL` and `PREPARE`/`EXECUTE` statements adjacent, so internal
diagnostic queries do not overwrite `ROW_COUNT()`, `FOUND_ROWS()` or the warning
list between them. It fetches final diagnostic text only after user SQL ends.

Literal SQL-mode assignments are tracked locally. Native quoting/server status
tracks `NO_BACKSLASH_ESCAPES` without a SQL query, including after dynamic
execution. A computed `SET sql_mode` or an anonymous compound statement that can
change parsing may require an internal `SELECT @@SESSION.sql_mode`, which can
affect diagnostic counters. Pure dynamic `EXECUTE` changes to `ANSI_QUOTES` are
not fully tracked; use an ordinary literal mode assignment when subsequent
client parsing depends on that flag. This is a client parsing limitation, not
an expansion or restriction of database grants.

## Schema visualizer metadata

`schema` returns tables and views in catalog name order and columns in ordinal
order. Each column has the same descriptor as `structure`: `name`, `type`,
`data_type`, `nullable`, `default`, `generated`, `generation_expression`,
`primary`, `auto_increment`, `extra` and `comment`. Metadata may be unavailable
for a view; its `columns` list can then be empty rather than fabricated.

Foreign keys are actual constraints, grouped by source table and constraint
name. Preserve every position of `columns` and `referenced_columns` together:
composite keys form one constraint, and separate constraints linking the same
tables remain separate. Self references are retained. `referenced_schema` is
the actual target schema; a same-named table in another schema must not be
connected to a local table. A target absent from the returned list (including
an internal table) is unavailable in the diagram, not proof of a broken key.
Views have no inferred relationships from their SQL definitions, and ordinary
similarly named fields have no inferred relationships either.

The response is a current catalog read, not a transactionally frozen schema:
DDL from another database window can occur between its three metadata reads.
Refreshing the diagram reads the catalog again. Requests keep the normal GET,
session, maintenance-lock and localized error handling; no mutation is
performed by this endpoint or by changing a diagram's layout.

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
Frontend owns the public page templates, `workspace.php`, and `app/public/assets/*`.
Infrastructure owns Docker files, compose.yaml, bootstrap scripts, app/src/BackupService.php.
Root owns database seed, docs, integration tests, review and GitHub.

## Backend settings

`DB_HOST=database`, `DB_PORT=3306`, `DB_NAME=bestuursatlas`, optional comma-separated
`DB_DATABASES`, `DB_USER=govern`, `DB_PASSWORD`, `DB_READ_USER=govern_reader`,
`DB_READ_PASSWORD`; optional `DB_SOCKET` for isolated native validation.
`BACKUP_DIR=/var/lib/govern/backups`, `DB_DUMP_BIN=mariadb-dump`,
`DB_CLIENT_BIN=mariadb`. Config keys: `host`, `port`, `name`, `databases`, `user`,
`password`, `read_user`, `read_password`, `socket`, `backup_dir`, `dump_bin`,
`client_bin`, `schema_file`, `allowed_hosts`; `DatabaseScope::select` adds
`maintenance_dir` and scopes `backup_dir`.

Local AI has a separate `AiConfig::fromEnvironment()` configuration:
`AI_ENABLED=0`, `AI_BASE_URL=http://host.docker.internal:11434`,
`AI_MODEL=qwen3:4b-instruct`, `AI_TIMEOUT_SECONDS=60` (allowed range 5–120).
The address is HTTP with no credentials, query, fragment or path beyond `/`;
supported hosts are `localhost`, `127.0.0.1`, `::1`, `host.docker.internal` and
`ollama`. Provider/model settings are never accepted from the request body.
Explicit cloud model names are rejected and there is no cloud fallback.
Model availability and host networking remain deployment responsibilities;
see [the local setup guide](AI.md). No Ollama service or model download is added
to the default Compose startup.

`LocalCodeSearch` separately reads server-only `AI_PROJECT_ROOT`. Docker sets
`/opt/govern/project` and supplies only `app/` and `docs/` read-only there. The
source checkout defaults to its repository root. This setting never makes
folders outside the fixed `app/` and `docs/` source areas readable through a
browser request.

The default database retains the existing `BACKUP_DIR` path. Other databases use
`BACKUP_DIR/databases/<sha256(database name)>`; manifest database names and
checksums are verified before use. Ordinary app data/research requests share the
root maintenance lock, while snapshot creation/restoration obtains it exclusively.
This lock covers every app database because free SQL can change schemas with
`USE`. Database discovery remains possible for recovery; independent phpMyAdmin
SQL does not participate in this application lock.

Docker's privileged `database-access` job runs after MariaDB is healthy and
before app/phpMyAdmin. It creates missing explicitly configured schemas and
grants writer ALL and reader SELECT/SHOW VIEW on each exact schema, without
seeding additional databases, resetting existing passwords or granting `*.*`.
Provisioned names use ASCII letters, digits and underscores, with system schemas
rejected and underscores escaped as grant-pattern literals. The escaped grant
pattern must fit 64 bytes. Known legacy unescaped default-schema grants are
narrowed. Runtime app/phpMyAdmin containers never receive the root password.
Removing an allowlist entry does not revoke existing grants or delete data.

`DatabaseProvisioner` separately reads server-owned `DB_MANAGER_SOCKET`, whose
Compose value is `/run/govern-databases/provision.sock`. The `database-manager`
service receives the database host, port, fixed account names and root password;
the app only receives the socket path. The socket is the only management
transport. The service has no HTTP listener, published port, SQL execution
endpoint or file-import channel. Missing setup leaves ordinary browsing usable
and returns the bounded helper error through the normal API envelope.

PHP8.4+, PDO MySQL and PDO SQLite, Argon2id support, native PHP classes and ES modules, no build framework. Namespace `Govern`, small explicit bootstrap loading or autoloader. Config class `Config::fromEnvironment(): array`. BackupService `__construct(array $config)`, `list(): array`, `create(string $label): array`, `restore(string $id,string $confirmation): array`, `download(string $id): array` returning `{path,filename}`. Backup service verifies files/checksums, invokes clients using argv arrays, credentials only private temporary file. No shell command concatenation.

## phpMyAdmin integration

Same origin at `/phpmyadmin/` via Nginx. Modal shortcuts are Browse, Structure,
SQL, Import and Export. Iframe uses actual phpMyAdmin, not a partial imitation.
URL query routes are `/sql` (Browse), `/table/structure`, `/table/sql`,
`/table/import` or `/table/export`, with encoded selected `db` and `table`.
No-table fallbacks are `/database/structure`, `/database/sql`,
`/database/import` and `/database/export`. Allow only
same-origin framing; config auth uses the scoped writer account and actual
MariaDB grants determine available databases. The four system schemas are hidden;
`only_db` does not restrict additional granted schemas. Display current DB/table,
database choice and a separate-window link. Keep full phpMyAdmin capabilities
available inside frame. Shared `_govern_pma__*` storage stays in original `DB_NAME`.

Explicit database window navigation includes `lang=nl` or `lang=en`. Changing
Govern's language updates the surrounding controls immediately, but must not
reload an open phpMyAdmin frame: its editor may contain unsaved work. The new
language applies on the next explicit open, tab/table navigation or reload.
The embedded application's own interface remains phpMyAdmin's responsibility.

MariaDB snapshots are SQL exports; PostgreSQL snapshots are native custom schema archives. Neither is a container volume snapshot. Restoring overwrites current selected DB contents; user confirmation and automatic safety export required. DDL is not represented as transactionally undoable. No database or phpMyAdmin host port; only proxy bound127.0.0.1:8080. Nothing runs on the user computer until they start this project.


## Tabular dataset upload

`POST dataset-preview` and `POST dataset-import` are exceptions to the JSON request
body convention: they accept multipart FormData with a single `file` upload.
Both require an approved installation account, the ordinary `X-CSRF-Token`,
same-origin session and explicit URL scope. PostgreSQL additionally carries
`connection=postgres` and `schema`, or the compatible packed workspace key.
Both engines reuse the same upload reader.
They return the usual JSON envelope. The PHP upload limit is
16 MB (18 MB multipart envelope); ordinary JSON POST remains limited to 1 MB.

Preview returns `{database,sha256,datasets:[{index,name,count,columns,rows,
formulas,duplicate_rows,targets}]}`. Columns include `{source,name,type:"LONGTEXT",
suggestion,empty,distinct,unique}`; rows contain the first 20 records only, while
counts/profile cover the complete imported table. `unique` suggests a possible key,
not a generated constraint. Targets contain compatible catalog table names and
structure versions. Preview does not create any table.

Import additionally accepts multipart string fields `dataset` (zero-based index),
`mode` (`create` or `append`), `table`, `confirmation` (exact database name),
`sha256` (from preview), and `version` (required for append). The uploaded file is
parsed again. Success returns `{database,table,mode,imported}` after commit.
No overwrite, merge, deduplication or automatic retry is performed. All source
values are text or NULL; new tables use LONGTEXT columns plus `_govern_id`.
Append supports compatible InnoDB text tables only; schema drift returns 409.
Source column names are normalized by the reader, and existing destinations are
resolved through the catalog. Values always use bound parameters.

PostgreSQL uses `PostgresDatasetImport` and the same dataset profile/preview
shape, with `type:"TEXT"`, `schema`, `scope_key` and
`confirmation:"database.schema"`. Both create and append require the exact
full confirmation. New tables use TEXT columns and a bigint generated-always
identity `_govern_id`. PostgreSQL DDL and rows commit atomically, without
overwrite. Append accepts compatible plain PostgreSQL text tables; its version
binds schema, relation identity, columns and constraints. The table is locked
and the structure rechecked before appending. PostgreSQL names have a
63-byte limit; unsupported/generated source targets and stale metadata fail
explicitly. Source values remain bound strings or NULL.

Stable errors: `dataset_upload`, `dataset_invalid`, `dataset_unavailable`,
`dataset_name`, `dataset_changed`, `dataset_exists`, plus ordinary CSRF/database
errors. SQL files use the separate native SQL preflight/execution flow or the
official phpMyAdmin import.

## Live Studio whiteboards

Studio is an opt-in domain API inside the existing `/api.php` boundary. It
requires `STUDIO_ENABLED=1`, PostgreSQL and the exact server-configured
`STUDIO_SCHEMA` in `PG_SCHEMAS`. Provisioning is a separate private CLI action;
ordinary web requests never create tables. All requests require an approved
installation account and explicit `connection=postgres&database=...&schema=...`.
Every POST uses the ordinary CSRF header, including multipart audio.

The separate UI is `/studio.php`; `/workspace.php#studio` is Govern's read-only
live monitor. The `studio_boards`, `studio_notes` and `studio_transcripts` views
are deliberately non-updatable and visible through the existing catalog.
Underlying `_govern_studio_*` tables are application-internal. Approved accounts
share access; these objects do not establish private projects or tenants.

| Method / action | Input | Successful data |
| --- | --- | --- |
| GET `studio-bootstrap` | Explicit scope | `{csrf,enabled,ready,schema,scope_key,generation,boards,transcription,limits}` |
| GET `studio-board` | URL `board:<uuid>` | `{generation,board,nodes,edges,segments,recordings}` |
| POST `studio-create-board` | `{generation,id,title,operation_id}` | `{id,title,revision,created_at,updated_at}` |
| POST `studio-mutate` | `{generation,board_id,base_revision,operation_id,changes}` | `{revision,operation_id}` |
| POST `studio-start-recording` | `{generation,id,board_id,operation_id}` | `{id,board_id,status,revision}` |
| POST `studio-stop-recording` | `{generation,id,board_id}` | `{id,status,revision}` |
| POST `studio-audio` | Multipart fields below | `{revision,segment,duplicate}` |

All externally supplied object and operation IDs are UUIDs. Every write requires
the latest `generation`. It binds the database, physical board relation and
migration installation identity. Govern's native schema restore recreates the
relation, so stale clients fail with 409 `studio_generation_conflict` even if a
restored revision happens to equal their old revision.

`studio-mutate` accepts 1–100 ordered changes in one transaction:

```json
{
  "generation": "<generation from bootstrap or board>",
  "board_id": "<uuid>",
  "base_revision": 4,
  "operation_id": "<new uuid for this operation>",
  "changes": [
    {"type":"put-node","node":{"id":"<uuid>","kind":"note","text":"A new idea","x":40,"y":60,"width":280,"height":200,"data":{}}},
    {"type":"delete-edge","id":"<uuid>"}
  ]
}
```

Change types are `put-node`, `delete-node`, `put-edge`, `delete-edge`.
An edge is `{id,from_node_id,to_node_id,label}` and both endpoints must exist in
the same board. Deleting a node removes its incident edges. Node kinds are
`note`, `idea`, `screen` and `stroke`; source fields are server-owned and cannot
be submitted by clients. Stroke data is
`{points:[[x,y],...],color:"#RRGGBB",size:number}` with 2–2000 finite points.
Screen data can select `layout:"form"|"dashboard"|"landing"`; note/idea data can
contain an optional colour. Text is bounded to 8000 UTF-8 bytes; finite geometry,
style fields, per-board content and snapshot sizes are checked server-side.

The board row serializes mutations. An outdated `base_revision` returns 409
`studio_revision_conflict`; no partial changes commit. Successful operation IDs
bind the normalized request and stored response. An exact replay returns the
original response, while reuse with other content returns 409
`studio_operation_conflict`. Ordinary failed or uncertain writes must not be
blindly replayed with a new ID. Audio-derived notes use the same board revision
but append new objects, preserving manually edited cards.

`studio-audio` accepts one file plus string fields `generation`, `board_id`,
`recording_id`, `sequence`, `start_ms`, `end_ms`, `operation_id`. The file must
be a complete PCM16 mono RIFF/WAVE, 8–48 kHz, at most 2 MiB and 12 seconds.
The browser normally sends approximately six-second chunks. Sequence starts at
zero and timing must be contiguous within one recording. Claimed duration is
checked against actual WAV sample count. No filename or MIME declaration alone
establishes valid audio; imported M4A/Dictafoon files are not this endpoint's
input format.

Before any provider call, the server checks generation, board, active recording,
timeline and an existing segment. Exact recorded retries return the saved
segment without retranscribing. Reuse of a sequence or operation ID with
different audio/checksum or timing returns 409 `studio_segment_conflict` or
`studio_operation_conflict`. Reusing a completed audio operation ID for a new
sequence is rejected during preflight, before another provider call.
The provider call holds neither a database transaction nor the maintenance
lock. A short recording-specific processing lock prevents duplicate concurrent
inference. Generation and recording status are checked again before commit.

A segment contains its ID, recording ID, sequence, start/end milliseconds,
original text, checksum, provider, operation ID and optional current node ID.
Nonempty text creates a new note; silence creates no card. Original transcript
text is immutable through this API. Editing or deleting its card does not
change that source. Undo can restore its server-known source association.
Audio bytes are temporary and are not archived or made downloadable.

`transcription.enabled` describes server configuration, not successful model
loading. The configured Whisper-compatible provider is local by default;
external HTTPS requires separate explicit opt-in. There is no browser speech
service or cloud fallback. The first version uses fragment transcription plus
approximately 1.5-second snapshot polling, not word-level streaming or offline
collaboration. See [STUDIO.md](STUDIO.md) for local model and HTTPS setup.

Other stable errors include `studio_disabled`, `studio_config_invalid`,
`studio_schema_unavailable`, `studio_input_invalid`, `studio_limit`,
`studio_board_missing`, `studio_node_missing`, `studio_recording_missing`,
`studio_recording_stopped`, `studio_busy`, `studio_recording_busy`,
`studio_audio_invalid` and `studio_transcription_*` configuration/transport errors.

## GhostSketch storage and archive inspection

GhostSketch owns recording, transcription and linking. Govern only archives source
audio/transcripts. `/dictation-api.php` uses the normal approved installation session
for GET `list` and GET `recording` with validated database scope. It has no upload or
transcribe action. `/dictation.php` is an inspection screen.

`/ghostsketch-storage.php` requires `Authorization: Bearer <GHOSTSKETCH_STORAGE_TOKEN>`
(minimum 32 characters; blank disables access). It fixes the database and schema to
server configuration and permits only these actions:

| Method / action | Input | Result |
| --- | --- | --- |
| POST `upload` | multipart `file` | validated archived audio metadata, deduplicated by SHA-256 |
| POST `complete` | JSON `{id,sha256,text}` | one immutable full-file transcript, ready status |
| GET `list` | none | latest 500 recordings |
| GET `recording` | UUID `id` | metadata and ordered transcript fragments |
| GET `audio` | UUID `id` | original binary audio |

JSON actions use the normal `{ok,data}` / `{ok:false,error,...}` envelope. Binary
responses use `application/octet-stream` and no-store headers. Upload is limited to
16 MiB / 30 minutes and validated with ffmpeg/ffprobe (WAV/M4A/MP3). Transcripts are
bounded to 512 KiB UTF-8; GhostSketch additionally bounds them to 100,000 characters.
`complete` locks the recording row, verifies the audio checksum and commits transcript
and status together. Identical completion is idempotent; changed text or a previous
partial transcript returns 409. Audio is retained if transcription fails elsewhere.
No model runs here. Provisioning migration 003 expands the original fragment text
constraint without replacing existing data.

`GET /dictation-feed.php` remains an optional read-only feed using its separate
`GHOSTSKETCH_READ_TOKEN` and reader connection. No id returns recordings; id returns
the selected metadata/transcript. It never returns audio. The browser never receives
either service token. See [DICTATION.md](DICTATION.md) for setup.
