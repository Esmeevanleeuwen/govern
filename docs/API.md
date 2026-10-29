# API contract — Govern

Personal local workbench. All endpoints are `GET/POST /api.php?action=...`, JSON.
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

All POST requests use JSON and header `X-CSRF-Token` from bootstrap. PHP session cookie, same origin only.
One MySQL/MariaDB server, multiple selectable databases and live schema discovery.
The optional local Ollama connection is disabled by default; only the separate AI
endpoints can call that configured provider. Ordinary database operations and
selection explanations do not require a model.

## Database scope

Every scoped endpoint accepts the URL parameter `database=<exact name>`, on GET
and POST alike. The request body does not change the target database. Omitting
the parameter retains `DB_NAME` for older clients and links. There is no mutable
server-session selection; two browser tabs can use different databases safely.

`GET databases` returns `{databases:[{name,available}],default_database,can_create}` without
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
- GET `health`: `{status:"ok"}` when selected DB readable; no credentials/errors disclosed.

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
editing tasks.

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
Frontend owns `app/public/index.php`, `app/public/assets/*`.
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

PHP8.4+, PDO MySQL, native PHP classes and ES modules, no build framework. Namespace `Govern`, small explicit bootstrap loading or autoloader. Config class `Config::fromEnvironment(): array`. BackupService `__construct(array $config)`, `list(): array`, `create(string $label): array`, `restore(string $id,string $confirmation): array`, `download(string $id): array` returning `{path,filename}`. Backup service verifies files/checksums, invokes clients using argv arrays, credentials only private temporary file. No shell command concatenation.

## phpMyAdmin integration

Same origin at `/phpmyadmin/` via Nginx. Modal shortcuts are Browse, Structure,
SQL and Import. Iframe uses actual phpMyAdmin, not a partial imitation. URL query route
`/sql` (Browse), `/table/structure`, `/table/sql` or `/table/import`, with encoded
selected `db` and `table`. No-table fallback `/database/structure`,
`/database/sql` or `/database/import`. Allow only
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

Snapshots are real SQL exports, not container volume snapshots. Restoring overwrites current selected DB contents; user confirmation and automatic safety export required. DDL is not represented as transactionally undoable. No database or phpMyAdmin host port; only proxy bound127.0.0.1:8080. Nothing runs on the user computer until they start this project.
