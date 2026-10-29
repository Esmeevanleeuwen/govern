# Govern UX and UI design

**Design baseline 1.6.** Govern is a personal, local workspace for exploring, understanding and changing databases. This guide defines its brand, visual system, behaviour and the process for adding features without disrupting existing work.

The agreed visual direction is layered glass, soft shadows, custom colour and no hard decorative borders. Dutch and English are equal interface languages. The detailed rules below are the target for implementation; the interactive preview is a visual reference. The production modules implement the core language, appearance and layout controls; the future chart example remains a proposal.

## Interactive design reference

Use **EN / NL**, **Settings** and **Edit layout** to explore the design. The interactive reference remains on the Govern Page. Production screens use the real catalog, research service and restore points. Keep these written rules beside a visual reference when designing a new screen.

## Brand direction

**Brand idea: clarity with room to explore.** The lowercase wordmark and open geometric **g** give Govern a recognisable identity. The opening suggests a way into the data. Curved glass artwork may support welcome areas; it stays out of dense tables and task forms.

Keep the mark’s proportions and opening intact. Use the accent version on quiet surfaces and a high contrast single colour version when needed. Leave at least half the mark’s width clear around it. Use the full wordmark in the main navigation and the mark alone for compact app icons.

The product should feel calm, capable and personal. Each screen has one clear purpose and one main action. Explain the result of an action in plain language. Keep technical detail close to the task through optional SQL and explanation sections. A new dataset should work through the same screens as the first dataset.

| Design token | Baseline value | Use |
| --- | --- | --- |
| Accent `--g-accent` | Lagoon `#0B7476` | Primary actions and selected states |
| Accent presets | Iris `#6651C6`, Cobalt `#315EE8`, Clay `#A54E37` | Alternative personal accents |
| Canvas `--g-bg` | Light `#F1F3F1`; dark `#151B20` | Base beneath a soft custom tint |
| Main text `--g-ink` | Light `#172D34`; dark `#EDF3F3` | Content and important labels |
| Secondary text `--g-muted` | Light `#617278`; dark `#A9BAC0` | Help and supporting labels, subject to contrast checks |
| Chrome glass `--g-glass` | Light `#FFFFFF50`; dark `#263B4694` | Navigation and compact controls |
| Card glass `--g-frost` | Light `#FFFFFF80`; dark `#2A3B47A6` | Dashboard blocks and settings |
| Dense glass `--g-dense-frost` | Light `#FFFFFFCC`; dark `#24323DDC` | Tables, SQL and dialogs |
| Solid fallback `--g-panel` | Light `#FCFDFA`; dark `#202A30` | Reduced transparency and unsupported blur |

### Glass and depth

Use real translucency, background blur and broad shadows across navigation, cards, controls and dialogs. The token values above are base tints; the final surface also includes a gentle gradient highlight. Keep background colour soft so it does not compete with text.

Do not add panel outlines, table gridlines, divider rules or dashed editing frames. Separate sections with spacing, a subtle change in frost, gentle row shading or elevation. Selection uses a changed surface plus a checkmark, label or icon. A keyboard focus indicator remains visible.

| Surface | Blur starting point | Shadow and behaviour |
| --- | --- | --- |
| Navigation | 28 to 32 px | Floating layer with a broad, soft shadow |
| Cards and settings | 24 to 28 px | Shared card elevation and diffused highlight |
| Buttons and inputs | 14 to 20 px | Raised action or gently recessed input |
| Tables and SQL | 24 to 28 px at the panel | Denser frost; no blur on individual cells |
| Dialogs | 32 to 36 px | Highest elevation with a softened background |

The preview’s shared light card elevation is `0 18px 42px #183B451B, 0 5px 14px #183B450D, inset 2px 3px 10px #FFFFFFA6`. The control elevation is `0 7px 18px #183B451C, inset 1px 2px 7px #FFFFFFBD`. Use `--g-elevation` and `--g-control-depth` for these roles; use matching dark theme values rather than adding arbitrary shadows per screen.

**Reduced transparency** makes every reading and control surface solid and removes backdrop blur. Use the same fallback when blur is unsupported. Follow the operating system’s reduced transparency preference where available. Keep blur on a small number of panel layers so scrolling stays responsive.

### Typography and spacing

Use the system sans serif stack for the interface and monospace for SQL, identifiers and exact values. Keep ordinary body text at 14 px, secondary text at 12 px or larger, and editable mobile fields at least 16 px. Use regular weight for reading and medium or semibold for hierarchy.

| Element | Target size | Rule |
| --- | --- | --- |
| Page title | 32 px desktop, about 28 px compact | One main title per screen |
| Section heading | 18 px | Describe the section’s purpose |
| Component heading | 14 to 16 px | Short and specific |
| Body and controls | 14 px | Comfortable line height, around 1.5 |
| SQL and table detail | 12 to 14 px | Never shrink text just to fit more columns |

Use a shared spacing scale of **4, 8, 12, 16, 24 and 32 px**. Card padding is normally 20 to 24 px; page spacing is 24 to 32 px. Use about 20 px corner radii for panels, 12 px for controls and pill shapes only for compact selectors. Size adjustments belong in shared tokens.

Use small, consistent outline icons with labels for important actions. Decorative artwork carries no essential information. Motion is brief, normally 120 to 180 ms, and limited to meaningful state changes. Disable nonessential motion when reduced motion is requested.

Apple is a reference for material depth and hierarchy; Govern keeps its own identity. See [Apple’s materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials).

## Language experience

### Language flow

Use the compact language control in the top bar or **Settings → Language**. The menu names are **Nederlands** and **English**; do not use flags. On first use, choose a supported browser language, otherwise Dutch. Remember a deliberate choice in that browser.

Switch immediately, without reloading the page. Update navigation, controls, help, validation, empty states, confirmations and application messages together. Retain the active route, selected table, search, pagination, query draft, builder choices and any layout edit in progress.

Use locale aware date and number display. Preserve exact database values and SQL literal syntax. For numeric query inputs, make the expected decimal format explicit in both languages rather than silently changing a value.

### Translation implementation

Store interface text under stable keys in Dutch and English dictionaries. For example, `query.run` maps to **Query uitvoeren** and **Run query**. Components receive keys and values rather than containing separate hardcoded versions of a screen. Translate complete sentences and plural forms; avoid joining translated fragments.

The API keeps the existing error string and adds stable error codes, safe parameters and Dutch and English message maps. Maintain that additive contract when extending validation. Update the API contract and client together, keep older consumers working, and never match errors by their visible wording. Raw database diagnostics stay available as technical detail.

Database names, identifiers, record text, SQL and saved notes retain their original language. phpMyAdmin has its own language preference; use its supported integration to pass the matching language on opening. Keep the full official tool available.

## Colour and layout settings

### Appearance preferences

Settings contains three clear groups: **Language**, **Appearance** and **Workspace layout**. Appearance offers light, dark or system mode, an accent preset or custom colour, an independent background tint, and reduced transparency.

Colour selection previews live. Persist the final colour when the interaction ends, rather than on every slider movement. Language and simple appearance controls save immediately and show a short failure message if saving fails. Keep the current session usable even when browser storage is unavailable.

Derive hover, pressed, soft fill and readable foreground colours from semantic tokens. Check contrast against the final composited glass background. A bright accent must not force pale text. Keep success, warning and destructive meanings distinct from the personal accent.

### Layout editing

Open **Edit layout** from Overview or Settings. Show move handles, move buttons, width choices, hide actions, **Save layout** and **Cancel**. Use a soft lift and a visible drop destination while dragging; no dashed borders.

Save commits the arrangement. Cancel restores only the layout draft, without reverting a language or appearance change. Hidden blocks can be restored from the same mode. An empty dashboard offers a clear **Show blocks** action; navigation still provides access to the underlying features.

Save block order, width and visibility under stable block identifiers. Never use the translated title as an identifier. Keep the language control, main navigation and database access outside the rearrangeable area.

### Responsive layout

Above about 850 px, use a 12 column workspace: Small spans 4 columns, Wide spans 8, Full width spans 12. At intermediate widths, cards can occupy half or all of the available space. At about 620 px and below, use a single column and collapse navigation behind a labelled menu. Match layout changes to the available content width.

Mobile follows the saved block order and retains desktop width choices for later. All layout actions work through buttons as well as dragging. Preserve readable text and touch targets; let dense tables scroll within their own region rather than making the entire page scroll sideways.

Keep primary actions visible without hover. Check the layout at 320 px, tablet width, desktop width and enlarged text. Longer Dutch labels must fit without clipping.

## Information architecture

- **Overview / Overzicht:** a personal starting point with data access, research, guidance and restore points. Open it directly, without a second navigation menu repeating Research and Experiments. Counts come from the live database; label row estimates as estimates.

- **Database / Database:** one workspace with **Data / Gegevens**, **Structure / Structuur** and **Schema / Schema** as its views. Keep these view controls beside the workspace rather than repeating them as main navigation areas.

  - **Data:** table selection, record search, pagination, readable rows and optional SQL explanation. Add rows or use row actions to edit/delete in a focused dialog. Keep the official phpMyAdmin available for unsupported editing and its full toolset.

  - **Structure:** columns, keys, relationships and table definitions from the live catalog. Related objects have a clear route back.

  - **Schema:** a whole-database diagram for following declared foreign keys. Keep its canvas, table cards and tools when adopting the shared Database explorer.

- **Research / Onderzoeken:** visual query building, editable SQL, results and saved research. Explain the relationship between a visual design and hand edited SQL.

- **Experiments / Experimenten:** creating, downloading and restoring named restore points. Recovery remains reachable when the database is unavailable.

- **Settings / Instellingen:** language, appearance and workspace preferences. Keep it in a consistent, easy to find position.

The **database selector** belongs in the shared top bar: it changes the context
of these areas rather than adding another navigation level. Show the exact
database name and an unavailable label when needed. List schemas visible to
both database roles, plus configured unavailable schemas needed for recovery;
exclude system schemas. Selecting a database never grants access or connects
an unrelated server.

### One menu, three responsibilities

| Layer | Responsibility | Content |
| --- | --- | --- |
| Main rail | Choose an area | Overview, Database, Research and Experiments; Settings at the bottom |
| Context panel | Choose an object in that area | Tables, saved research or restore points |
| Workspace | Read, inspect or act on the object | Database views, query builder and editor, restore controls and task tools |

The rail and context panel form one connected glass surface with one shared
elevation. Do not add another tool rail beside them. Clicking an active area
with context toggles its panel; switching area replaces that panel's contents.
Overview and Settings open their own screens without a contextual menu of
links to other main areas. A dashboard action may still resume a specific task.

Database always keeps a searchable table explorer. Selecting a table highlights
it in the list and updates the workspace; details appear below the list rather
than replacing it. The next table stays one click away. The same table selection
and explorer search carry between Data, Structure and Schema. Record search and
pagination belong to Data and remain separate from explorer search.

### Predictable placement within Database

Use the same order in Data, Structure and Schema:

1. A compact **Database** heading. The **Tables** opener occupies the same header
   position in every view when the explorer is collapsed or the mobile drawer is closed.
2. One view row directly beneath it: **Data**, **Structure**, **Schema**, followed
   by the selected table context. Let that context wrap below the views on narrow screens.
3. One tool area immediately before the table, structure or canvas it controls.
4. The main content, followed by a compact summary or optional explanation.

The sidebar owns the searchable table list and expandable table details. Do not
repeat Browse, Structure or Focus connections buttons there: the view row and
Schema connection filter already provide those actions. Keep selecting another
table independent from expanding its columns or connections.

In Schema, group the tool area by purpose: connection filtering and column
display; arrangement; zoom, actual size and fit; then refresh and Help. Keep
those groups together above the canvas, with consistent alignment and wrapping.
Zoom controls must not cover table fields or move below a large diagram.
Put table/relationship counts and the PK/FK legend in a compact canvas footer.
Long interaction, relationship and local-layout explanations belong in Help or
a collapsed explanation below the canvas, keeping the initial workspace concise.

The Database rail entry returns to the last Database view in the current
session. Preserve direct links and existing hashes: `#gegevens`, `#structuur`
and `#schema`, including supported table parameters. Changing navigation must
not discard research drafts, builder choices, table state or schema placement.

Research uses the shared panel for saved research and Experiments for restore
points. Keep execution, saving and restoration controls in their workspace.
Panel content must have its own loading, empty and error states. Recovery and
Settings remain reachable when the database is unavailable.

Move the complete connected menu together when the user chooses navigation on
the right. At compact widths, use a labelled opener for the same navigation and
explorer; keep the selected table and task tools visible in the workspace.
Automatic selection updates must not reopen a deliberately collapsed panel or
steal focus. Preserve context and collapse choices through language and theme
changes, and keep keyboard access and focus return working.

## Core user flows

### Switch databases without losing context

Choose a database in the shared selector. Keep the same main area and restore
that database's own table, explorer search, Data search/page, research draft,
results, builder choices and schema state. The selector and workspace name
update together, with a short loading state before new data appears. Cancel old
reads and ignore late replies. The current choice belongs to this browser tab;
another tab may work on a different database.

Keep drafts per database for the current page session. Saved research lives in
the selected database and is distinct from those drafts. Appearance, language
and dashboard arrangement remain shared browser preferences. A direct route
carries the database name; old routes without it still use the configured
default. Schema positions remain stored per database.

Disable the outer selector during SQL execution, saving, snapshot work and an
open row editor or phpMyAdmin window. Explain a blocked switch and let the user
finish or close that task first. Do not move an open form onto another target.
An unavailable configured database still offers recovery and an easy switch
to another database. The context export and snapshot actions always follow the
visible selected name.

The phpMyAdmin window opens at the selected database and has its own deliberate
database navigation. Its frame keeps unsaved work during incidental shell,
theme and language updates; only explicit tool navigation loads another page.

### Inspect any Govern element

**Select pointer** belongs in the shared top bar because it inspects the whole
Govern interface. It applies to text, buttons, fields and panels as well as data
tables, records, cells, schema fields and declared connections. Keep the pointer,
selection count and clear action together; use a soft highlight and numbered
marker for selected objects. Do not add checkboxes or a separate selection basket.

Clicking replaces the selection. **Shift + click** adds or removes an object.
Hovering never changes the selection. After more than three seconds over the
same object, show a small glass tag with its friendly name, semantic kind, actual
HTML tag and **More**. Keep it open while moving the pointer onto its controls.
A short ancestor path lets the user choose a containing row or table precisely.

**More** on a selected object explains the selected set. On an unselected object
it explains that hovered object without silently changing the existing selection.
The modal describes each exact object, how the objects fit together and relevant
next actions. Use actual values, comments, column types, complete primary keys
and declared foreign keys. Similar names do not prove a relationship. Unknown
interface elements get a factual role, text and HTML description. No AI service
is implied, and an offered SQL action prepares a read query without running it.
An explicit **Ask AI** action can open the separate optional assistant with the
selected context; the ordinary explanation remains available without a model.

The pointer intercepts ordinary activation, input and dragging while enabled.
Inspecting a button must not execute it, and selecting a schema card must not
move it. Retain ordinary scrolling and diagram wheel zoom. The official
phpMyAdmin iframe is a separate application; inspection stops at that boundary.

Arrow keys browse inspectable objects, **Enter** selects and **Shift + Enter**
adds or removes. The selection count provides access without the hover delay,
including for touch users. **Escape** closes the modal first, then exits pointer
mode. Preserve focus return and keep the tag and modal inside the available
screen width. Both languages, shared glass tokens and reduced transparency apply.

Selection is temporary session state. Keep selected data snapshots identifiable
when their original elements leave the screen; do not present them as a newly
read database result. Only complete real primary keys, including composite keys,
can identify records for a prepared query. Keyless rows remain snapshots.

### Ask the local assistant

**AI** in the shared top bar and **Ask AI** in the selection explanation open
one reusable assistant. On desktop it is a temporary glass panel beside the
workspace; on narrow screens it becomes a native dialog with contained focus.
Opening and closing the assistant preserves the current table, SQL and schema
view. Closing returns focus to the logical opener, including after a language
change remounts that control.

The assistant header always names its database and configured model. Show the
selected objects and source preview before sending. The first version uses
live schema and bounded interface descriptions; it explicitly says that records
are not included. Never silently attach row values, a full query result or saved
research merely because it is visible on the screen. The user's typed question
and conversation are still sent to the chosen local provider.

Give connection states distinct language and next steps: **Disabled**, **Not
reachable**, **Model missing** and **Ready**. Ready requires a successful check;
it is not a decoration applied when the panel opens. Keep a question available
after an error, with a retry action and a route to **Settings → Local AI**.
Disabled setup has no generated sample answer. Settings shows the server's
provider/model and connection test; it does not accept an arbitrary provider URL
from the browser.

Use one labelled question field and one primary **Send** action. During a
request, prevent duplicate sends and offer **Disconnect response**. State
honestly that this ends waiting in the browser and may not immediately stop a
running local model.
Render answers as text with an optional, separate SQL proposal. **Open in query
workspace** prepares an editable draft and uses the existing replacement
confirmation when necessary. It never executes SQL.

Questions, history and context are temporary per-database session state. A
database switch immediately shows that database's conversation and ignores any
late response for the previous one. Reopening preserves the current draft;
clearing a conversation is a deliberate action. A page reload begins a new chat.
Changing language updates controls and status without erasing text or asking
the model to regenerate the current answer.

The assistant uses shared glass, shadows, typography and reduced-transparency
fallbacks. Keep its scrolling inside the panel and preserve a useful amount of
working space. It must work with the main navigation on either side, enlarged
text, keyboard-only use and a 320 px viewport. The underlying extension contract
and local setup live in [the AI architecture](AI.md).

### Follow the schema

Open **Database → Schema** using the shared view row; the current table stays
selected. The canvas shows live tables, views, columns, primary keys
and declared foreign keys. Select an object to read its exact connections, and
continue to its data or structure without losing the table explorer. Search
filters the explorer only; it must not silently remove tables from the canvas.
Use the explicit selected-table connections filter to reduce diagram density,
then return to the complete diagram.

Table headers can be dragged or moved with the keyboard. Zoom, fit and reset
controls keep the diagram navigable. Scrolling over the canvas zooms at the
cursor without moving the surrounding page; dragging the background pans it.
Scrolling over menus or the surrounding page keeps its ordinary behaviour.
Mouse wheels, trackpads and Ctrl/pinch wheel events use the same cursor anchor.
Mobile users also have the table index and textual relationship details.
Relationship strokes communicate data rather than
decorating panel boundaries. The cards keep the shared frost and soft shadows.

The shared Database context panel keeps the table list visible above the selected
table's details. Expand columns or connections there without replacing the list.
Choosing another table updates its highlight, exact connections and workspace
selection. Keep Schema tools, zoom, fit, arrangement and guide controls together
immediately above the canvas, including when the explorer is collapsed. Opening
or closing the explorer keeps the selection, zoom and diagram center intact.

**Help** stays available among the Schema workspace tools and opens the **What can I do here?**
guide modal. Explain actual capabilities: search, declared keys and connections,
selection actions, wheel zoom, panning, table placement, layout controls and
refreshing. Include keyboard instructions and make the difference between diagram
placement and database editing clear. Keep the guide readable with shared glass,
bounded scrolling, a visible close control and a return action. Tab navigation
stays inside the modal; Escape, the close controls and the backdrop dismiss it
and restore the opener's focus. A language change preserves an open guide, while
leaving Schema closes and disposes it. The guide makes no database changes.

Keep table positions per database and separate from dashboard layout. A language
or theme switch preserves search, selection, positions and the viewport.
Refreshing reads current metadata, keeps valid positions and discovers new
objects. Resetting the diagram changes its arrangement only. A view or a field
with a similar name does not establish a foreign key. Explain references outside
the visible catalog instead of drawing a connection to the wrong local table.

### Explore and change data

Choose a table, read or search its rows, and optionally open the SQL explanation.
Place **Add row** in the table's action area and **Edit** / **Delete** beside each
row with a usable identity. These actions remain visible without hover and
preserve the table explorer, search and pagination. A dialog names both database
and table; it keeps that target fixed from opening until completion.

Read the full current record for editing rather than copying shortened table
cells. Use persistent column labels, data types and nearby default/required
help. Offer separate **Value**, **NULL** and **Default** choices when applicable;
an empty string stays a value. Display exact large numeric strings without
rounding and describe binary input as hexadecimal. Generated, unsupported and
oversized fields remain read-only with a reason; editing another field preserves
their original contents. Changing a primary-key value is a supported edit.

The form distinguishes loading, validation, saving, saved, failed and conflict
states. Keep typed input after an error. On a concurrent change, explain that
the row has changed and offer **Reload row**, with discard confirmation if the
form is dirty. Do not silently resubmit over newer data. Closing a dirty form
asks before discarding; language changes translate labels without rebuilding
its values. Return focus to the row action when possible after closing.

Delete shows the exact database, table and complete key in its confirmation.
Only confirmed writes refresh the visible data and show success. Adding is also
possible in ordinary keyless tables, but update/delete requires a complete
primary key or supported unique non-null key. Views and unsafe identities show
a clear route to the official phpMyAdmin rather than a guessed row action.
**Open in phpMyAdmin** uses the selected database/table, keeps its complete
toolset available and refreshes relevant catalog/data on closing. If a table
was removed, explain that and offer another table rather than a blank screen.

### Build and save research

Choose a table, columns and filters, then generate SQL. Show that SQL before execution. Run visual designs through the read only research connection and show results, limits and any truncation. The free SQL editor uses the same scoped database account as phpMyAdmin. Clearly describe its writable DML, DDL, routine and transaction capabilities in Dutch and English; do not label that editor read only.

One **Run query** submits a script using one temporary database session. Support
multiple statements and `DELIMITER` routines, functions and triggers. Keep one
result card per statement, with compact **Result n** headings when a `CALL`
produces multiple rowsets. Show actual row counts, affected counts, warnings and
truncation. Keep per-statement warning counts and available final diagnostic
text distinct; offer `SHOW WARNINGS` for messages needed at an earlier point in
the script. Stop visibly at the first failure while retaining completed and
partial procedure results. Every result set supports snapshot inspection without
guessing a source table or record key.

Use the existing confirmation dialog for potentially destructive SQL. Its
preflight is advisory and makes no changes; mode-dependent scripts may not have
an exact statement count before execution. Database grants determine which SQL
can run. File import controls and server administration remain separate official
tool capabilities rather than claims made by the query editor.

Keep a complete transaction, including `COMMIT` or `ROLLBACK`, in one run. Report
an unfinished transaction being rolled back when its session ends, and do not
imply that committed work or DDL was undone. After execution, refresh the live
catalog without discarding the SQL, results, focus or caret. A procedure can
change data even when its visible result contains only rows.

Editing generated SQL changes the active mode to manual SQL. The builder must not quietly overwrite that work. Changing builder choices creates a draft until the user applies them. Saved research remains ordinary SQL with its name and notes. Reopening it must not invent a visual design that was never saved.

Cancel or ignore outdated requests when inputs or routes change. A late response must never replace a newer result. Preserve the draft after a validation or connection error.

### Change settings without losing work

Open Settings, change a preference and return to the previous task. The table selection, search and unsaved research remain intact. Theme and language changes update shared components together. Report whether a preference was saved; do not show a success message after a failed write.

### Create and restore a point

Name a restore point, create it and show its time, size and download action.
Lists belong to the selected database. Restoring is a separate flow: identify
the point and target database, explain what will be replaced and require that
selected database name. Never move a restore point to another database implicitly.

Use the existing safety export when the current database exists. During
restoration, prevent competing app actions across all databases and show clear
progress: free SQL can also target another allowed schema. A failure stays
visible with a recovery path and any available safety point. Do not promise a
universal undo: DDL is not transactional, and another phpMyAdmin window does not
automatically follow the app's lock.

## Shared components and states

Use one shared version of each pattern. A feature should extend the pattern when it needs new behaviour.

| Pattern | Consistent behaviour |
| --- | --- |
| Action buttons | One primary action per task; clear verbs; pending state prevents duplicate submission |
| Fields | Persistent labels, nearby help and specific validation; typed values survive an error |
| Glass panels | Shared material, radius and elevation; spacing separates content |
| Data tables | Column meaning, readable exact values, contained horizontal scrolling and clear empty results |
| SQL disclosure | Optional explanation beside the relevant task; copying gives feedback |
| Dialogs | Clear title and consequence, labelled close action, contained focus and return to the opener |
| Local assistant | Explicit database/sources, truthful connection state, retained draft, separate SQL proposal and no automatic execution |
| Notices | Persistent for unresolved problems; short toasts only for noncritical confirmations |
| Dashboard blocks | Stable identity, supported sizes, optional visibility and independent loading or failure |

Every data component defines **loading, ready, empty, filtered empty, error and unavailable** states. Writing components also define **validation, saving, saved and failed** states. Distinguish “no data yet” from “no results for this filter”. Explain the next useful action.

Use readable loading placeholders without continuous decorative animation. Keep a failed block from blocking unrelated blocks. If the whole database is unavailable, keep navigation, useful connection guidance and restore access working.

## Writing and feedback

Use short, direct language in both languages. Name the object and action: **Save research**, **Create restore point**, **Restore database**. A successful message follows a confirmed result. Error messages say what failed, retain the user’s input and offer a useful next step.

Keep interface help separate from raw diagnostics. Do not imply an AI service is connected unless a real integration has been built and explicitly enabled. Context exports continue to contain schema and saved queries without records or credentials.

## Accessibility and rendering

Treat accessibility as part of the shared component, not a later screen specific repair.

- Keep normal text at least **4.5:1** contrast and qualifying large text at least **3:1**, following [WCAG text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum).

- Make essential control shapes and state indicators meet the applicable **3:1** nontext contrast requirement. See [WCAG nontext contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

- Test the final glass composition in both themes and with custom colours. Increase material density or change the foreground when needed.

- Keep keyboard focus clearly visible. Use semantic buttons, labels and headings; provide movement alternatives to drag actions.

- Give touch actions a comfortable target of about **44 by 44 px**. This is the Govern design target.

- Use labels, checkmarks or icons alongside colour. Critical actions and feedback never rely on colour alone.

- Support reduced transparency, reduced motion and system contrast settings. Keep native focus visible when the browser supplies it.

- Maintain reading order and operability with enlarged text and at 200 percent zoom. Dialogs return focus; status changes are announced without repeating the entire screen.

## How future features should fit

### Start with the user task

For every addition, write down the user’s goal, entry point, information needed, main action, visible result and route back. Name the state that must survive if the user leaves or changes language. This short brief comes before new screens or controls.

Place the addition in an existing area whenever its task belongs there. A new query capability belongs in Research; a reading tool belongs near Data or Research; a preference belongs in Settings. Add a top level navigation item only for a distinct, recurring task that cannot fit the existing structure clearly.

### Use this implementation sequence

1. **Define the flow.** Write the start, main action, result, exit and recovery path.

2. **Choose shared patterns.** Reuse existing controls and panels. If a pattern is missing, design a reusable component with a clear responsibility.

3. **Design the states.** Include loading, empty, errors, unavailable data, keyboard use, mobile and both languages before implementation.

4. **Check data needs.** Reuse the live catalog and existing API where possible. Agree any changed request and response contract before wiring the screen.

5. **Build one complete path.** Connect the screen to the real service and show its returned result. Avoid shipping a working looking control with no action.

6. **Protect continuity.** Check current routes, drafts, preference storage, existing records and saved layouts.

7. **Verify the task.** Follow screen → API → database → visible result in the isolated test environment. Fix the flow when a check fails.

8. **Update this guide.** Record new shared patterns, tokens, state behaviour and migration rules with the implementation.

### Keep the code aligned with the design

Preserve the existing PHP, JavaScript module and SQL structure. Add a dependency only when it solves a concrete need. Use small, reusable components rather than copying a screen for each table or dataset.

| Responsibility | Existing place or proposed extension |
| --- | --- |
| Shared materials and geometry | Tokens and component styles in `styles.css` |
| Unified navigation and context | Shared shell and route coordination in `app.js`; one context host for the active area |
| Buttons, tables, notices and dialogs | Shared helpers in `ui.js` |
| Requests and consistent failures | `api.js` and the documented API contract |
| Routes and feature coordination | `app.js`; keep feature behaviour in focused modules |
| Element inspection | `selection-pointer.js` for interaction, `selection-registry.js` for semantic targets and `selection-content.js` for factual explanations |
| Local assistant | `ai-workspace.js`, live `AiContext`, `AiService` and the optional configured `OllamaClient` |
| Query design | `query-builder.js` and the existing backend services |
| Direct row editing | `row-editor.js`, live catalog metadata and `RowEditor` / `RecordIdentity` |
| Official database window | `database-modal.js` and the same origin phpMyAdmin integration |
| Language and preferences | `i18n.js` and `preferences.js` |
| Movable blocks | `dashboard-layout.js` with a small block registry |

These modules own shared responsibilities. Extend these pieces instead of copying the entire prototype into one production file.

New components can register their semantic selection metadata with
`registerSelection` in `selection-registry.js`. Reuse live catalog metadata and
stable object keys; do not add a custom inspector or copied explanation for each
database table. Generic interface inspection remains available without a
registration, while registered targets provide the more precise data context.

Continue discovering tables, columns and relationships from the live catalog. Bind values, validate identifiers, keep visual designs read only and preserve CSRF protection. Add an API endpoint only when the existing contract cannot serve the task. Update frontend, backend and API documentation together. If a real feature needs app owned database tables, use the existing `_govern_` namespace and a tested migration.

Carry explicit database scope through new requests, routes, downloads and
asynchronous callbacks. Keep per-database drafts separate and reject stale
responses. Never let a confirmation opened for one database submit to another.
Use the shared root maintenance lock for data operations that must cooperate
with snapshots; phpMyAdmin remains an independently executing official tool.

### Make new blocks safe for saved layouts

Give every block a stable ID, a translated title key, a renderer, default size, allowed sizes and complete loading, empty and error behaviour. Keep this as a small JavaScript registration, not a second copy of the data model.

The table list uses `overview.tables`, title key `app.dashboard.tables`, default size **Wide**, and allowed widths **Small**, **Wide**, **Full width**. Its ID stays the same when the language or label changes.

When a new block arrives, preserve all known order, size and hidden choices. Add the new block at a documented default position after the user’s existing blocks. Never replace the whole layout with the newest default. Skip unknown or unavailable blocks gracefully and retain their preference entries so a temporary absence does not erase the arrangement.

### Version preferences and preserve work

Keep appearance, language and layout separate from database records and research drafts. For the first local implementation, browser storage is sufficient; account syncing is a separate future capability.

Use versioned preference data, validate it on load and migrate supported older versions. A malformed value falls back only for that setting. Resetting appearance must not remove layouts, research or database data. Never clear all browser storage as an upgrade step.

Save layout edits as a draft until **Save layout**. Keep language and appearance updates independent. Protect unsaved research before an action that would discard it; routine theme or language switches must not discard it.

### Example of a future chart feature

A chart could start from an existing saved query in Research. The user chooses **Create chart**, selects fields and a chart type, then sees the same query results presented visually. A new top level chart application is not needed for that first task.

Use the existing query service, translation keys, glass panel and error patterns. Explain row limits and truncation; a chart of preview rows must not imply totals for the whole database. A dashboard version becomes an optional registered block referencing its saved query. Keep chart presentation settings separate from the saved SQL.

Changing the language, theme or block position should require no chart specific settings system. If the source query is removed, the block explains the problem and offers **Choose a source** or **Remove block**. It does not break the dashboard.

## Checks before a feature is ready

- [ ] The feature has a clear entry, main action, result and route back.

- [ ] It uses shared components and tokens, with no new hard decorative borders.

- [ ] Dutch and English cover labels, help, validation and feedback.

- [ ] Switching language or theme preserves the current draft and selection.

- [ ] Default and extreme custom colours remain readable on the final glass surfaces.

- [ ] Keyboard and touch users can complete the task; dragging has button alternatives.

- [ ] Mobile, enlarged text, reduced motion and reduced transparency work.

- [ ] Loading, empty, filtered empty, failure and unavailable states have a useful next step.

- [ ] New blocks preserve existing order, sizes and hidden choices after an upgrade.

- [ ] Failed saves retain input; outdated responses cannot replace newer state.

- [ ] Database switching preserves separate drafts and selections; every action targets the visible database.

- [ ] Row edits retain exact values, preserve read-only fields and show a recovery path for concurrent changes or unsafe identity.

- [ ] The actual screen to API to database path has been checked with isolated data.

- [ ] phpMyAdmin changes are checked with a real action when affected; restore changes are checked by restoring and reading back.

- [ ] The API contract, design guide and preference migrations match the delivered behaviour.

## Maintaining the design

Treat shared tokens, component behaviour, routes, translation keys and block IDs as contracts. Change a shared pattern centrally and check every screen that uses it. Prefer additive changes; document a migration when an existing contract must change.

Record each meaningful design change with its reason, affected components, effect on saved work and verification result. A visual adjustment should not silently change data behaviour or export contents. Update the documentation in the same change as the feature so the next implementation starts from the current rules.

The current direction keeps the open g identity, frosted materials, deeper soft shadows, border free panels, Dutch and English, personal colours and configurable dashboard blocks. New capabilities should extend that system.

## Implementation roadmap

Implement in small, complete stages. Each stage must leave the existing workspace usable.

| Stage | Scope | Ready when |
| --- | --- | --- |
| Language foundation | Dictionaries, language control, preference storage and translatable API errors | Dutch and English cover a complete task and switching preserves its draft |
| Shared visual foundation | Tokens, glass, shadows, typography, controls and fallbacks | Existing screens use the same components in both themes |
| Appearance settings | Custom accent, background tint, system theme and accessibility preferences | Choices persist and stay readable after reload |
| Layout system | Block registration, order, widths, visibility and migrations | Save and Cancel work, including mobile and existing saved layouts |
| Task migration | Apply the patterns to data, structure, research, experiments and phpMyAdmin shell | Real end to end flows pass against an isolated database |
| Optional local assistant | Context preview, provider status, questions and editable SQL proposals | Disabled/offline paths remain useful; per-database state, language, focus and proposal-only behaviour are verified |
| Future additions | Add each new capability through the process above | Its design, states, translations and integration checks are complete |

Do not reset the database, replace saved SQL or overwrite user layouts to apply a visual update. If a later feature needs a database migration, give it a separate migration and test its recovery with isolated data.

## Technical references

The existing application behaviour and integration boundaries are described in the [Govern architecture](https://github.com/Esmeevanleeuwen/govern/blob/main/docs/ARCHITECTURE.md), [API contract](https://github.com/Esmeevanleeuwen/govern/blob/main/docs/API.md) and [repository working guide](https://github.com/Esmeevanleeuwen/govern/blob/main/AGENTS.md). This documentation defines the UX and visual system for current and future changes. The original prototype remains illustrative; production controls operate through the real API.
