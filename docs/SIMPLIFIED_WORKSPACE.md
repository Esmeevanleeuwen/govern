# Simplified database workspace

Govern's everyday database work now follows one order: choose a database, choose
a table, then **Browse**, **Structure** or **SQL**. The change keeps the existing
database services and optional tools while reducing competing menus and repeated
context. The navigation change is in
[PR #30](https://github.com/Esmeevanleeuwen/govern/pull/30), based on `main` at
`98c9166`. `feature/native-table-creation` builds on its verified head `7529aac`
and adds the native table builder below.

## Where each task belongs

| Place | Actions |
| --- | --- |
| Header | Database picker, **+** to add/select a database, **Refresh**, **Workspace** |
| Sidebar | Searchable tables; **New** to create a table; optional table details |
| Main views | **Browse**, **Structure**, **SQL** |
| Database actions | **Import**; **Export via phpMyAdmin** for MariaDB or **Export backup** for PostgreSQL |
| **More** | **Explore**, **Diagram**, **Backups** |
| **Workspace** | Selection inspection, second screen, local AI, advanced phpMyAdmin, context export, language and Account |

Browse is the default view. Structure and SQL remain beside it, with the same
table list available. The selected table and SQL draft survive view changes.
Overview and Settings remain accessible. The expanded sidebar is one compact
column; its collapsed state, right-side preference and mobile drawer remain.

SQL opens with the editor and results. Query builder, saved queries and SQL help
begin collapsed underneath. Saved queries retain their name, notes and existing
storage. Extra table details are also collapsed initially, keeping the table list
clear. These changes make the common actions direct while keeping more involved
tools available where they are used.

## Create a table

Choose **New** beside **Tables**, enter a table name and add columns. The form
supports text, whole numbers, decimals, booleans, dates and date/time values.
An optional **Add ID column** gives new rows an automatic primary key. Review
the definition, then choose **Create table**. The generated SQL is available in
a collapsed disclosure.

MariaDB and PostgreSQL use the same flow with their own generated SQL. The
database/schema stays fixed while the form is open. Unfinished forms are kept
separately for each scope, including after a language change. Cancel writes
nothing. Creation opens the new table in Browse, ready for **Add row**, without
replacing an existing SQL draft. A failed refresh offers a new read attempt;
it does not repeat creation.

The empty database view offers **Create table** first and keeps **Create a
table with SQL** as a secondary option.

## Import and export

The direct Import button, import into an existing database, and create-and-import
all open the same native window. Its choices are **SQL file** and **Dataset**.
They reuse the existing preview, target selection, confirmation, execution and
result handling. Database/schema stays visible; changing it invalidates the
previous review.

The routine SQL form does not load the phpMyAdmin iframe alongside it.
**Advanced import via phpMyAdmin** deliberately opens the official MariaDB
importer when needed. Its full interface also remains under
**Workspace → Advanced: phpMyAdmin**.

MariaDB Export opens the official exporter for the selected table or database.
PostgreSQL Export backup opens the existing backup workspace and its archive
download. Context export continues to contain schema and saved-query context;
it does not export table records.

## Features retained

- Row browsing, search, pagination, add/edit/delete and existing conflict handling.
- Table metadata, foreign keys, schema diagram, record exploration and source evidence.
- SQL execution, MariaDB query builder and saved queries, with existing per-database drafts.
- SQL/dataset imports, restore points and engine-specific backup/restore behaviour.
- Record windows, second screen, selection inspection and optional local AI.
- Accounts, EN/NL labels, appearance preferences and configurable Overview blocks.
- Existing URLs, including `#gegevens`, `#structuur`, `#onderzoeken`, `#schema`,
  `#verkennen`, the `#verbanden` alias and `#experimenten`.

## Current limits

**Structure shows metadata.** Column and key changes use SQL or, for MariaDB,
the explicit phpMyAdmin structure action. The native builder creates new
tables; it does not alter existing tables. It supports one primary-key column
and literal defaults, with lowercase names up to 63 characters. Advanced
types, composite keys, foreign keys, indexes and expressions remain available
through SQL or the existing MariaDB tools.

**Exports still use existing services.** This change adds no general native
table exporter or editor for existing table definitions. Native SQL import retains its 256 KiB
UTF-8 limit; the existing advanced MariaDB path handles larger supported files.
Dataset formats and limits remain those documented in the README and API guide.

**Engine capabilities stay explicit.** PostgreSQL supports browsing, row edits,
SQL, native table creation, structure, diagram/record views, native imports and schema backups. The
visual query builder, saved queries, context export, AI and phpMyAdmin remain
MariaDB-only. The current database manager creates MariaDB databases;
PostgreSQL provisioning is outside this change.

## Relationship to other open work

At this review, [PR #28](https://github.com/Esmeevanleeuwen/govern/pull/28)
(`feature/unified-database-journeys`, `c3c32cb`) and
[PR #29](https://github.com/Esmeevanleeuwen/govern/pull/29)
(`improve/unified-database-workspace`, `8042dff`) are separate unmerged
implementations. Both overlap with navigation and import work.

PR #28 adds a broader import workflow, native table builder and provisioning
changes. PR #29 reorganizes database views and adds PostgreSQL creation.
PR #30 keeps the presentation change separate. This follow-up reuses only
PR #28's isolated table-definition service and form, with dedicated API and
real-database/browser checks. It does not include that branch's import worker
or provisioning changes. Combining the remaining work needs deliberate
reconciliation of navigation, import entry points, database scope and tests.

## Source and verification

The implementation is in [app.js](../app/public/assets/app.js),
[database-modal.js](../app/public/assets/database-modal.js),
[workspace-tools.js](../app/public/assets/workspace-tools.js) and
[workspace-navigation.css](../app/public/assets/workspace-navigation.css).
See [DESIGN.md](DESIGN.md) for interaction rules, [ARCHITECTURE.md](ARCHITECTURE.md)
for service boundaries, and [VALIDATION.md](VALIDATION.md) for recorded test
outcomes and environment limits.
