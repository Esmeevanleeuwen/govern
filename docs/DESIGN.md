# Govern UX and UI design

**Design baseline 1.9.** Govern is a personal, local workspace for exploring, understanding and changing databases. This guide defines its brand, visual system, behaviour and the process for adding features without disrupting existing work.

The agreed visual direction is layered glass, soft shadows, custom colour and no hard decorative borders. Dutch and English are equal interface languages. The detailed rules below are the target for implementation; the interactive preview is a visual reference. The production modules implement the core language, appearance and layout controls; the future chart example remains a proposal.

## Public homepage and account journey

The homepage at `/` introduces Govern with **Your data. Your next idea.** and
an invitation to help shape the project: **Be here at the beginning.** Use
oversized sans serif typography, the existing open geometric mark, and the
application's actual lagoon/sage palette. Subtle lavender and pale gold ambient
light support the same pearl glass materials as the workspace. A dark sample
workspace provides contrast within the light marketing canvas.

The landing page uses a floating, sticky glass header with anchor offsets that
keep headings visible below it. The hero pairs a clear registration action with
**Try the demo**, leading directly to the interactive preview. Connected glass
record illustrations are decorative and hidden from assistive technology.
Use the local system font, a restrained type scale, generous spacing and shared
surface/shadow tokens; no external font or UI dependency is needed.

The preview has its own heading, readable controls and explicit selected states.
The sample SQL card sits outside the workspace instead of covering its content.
At narrow widths all four preview tabs remain visible in a two-column layout;
dense tables and the schema scroll inside their own region with a visible hint.
Keep important controls at least 44 px high and retain their keyboard behaviour.

The capability guide uses varied card widths, shared outline icons and short
summaries. The complete instructions remain in native **How to use it**
disclosures. A guide link opens its destination's disclosure. Section links,
numbered Explore steps and a separate FAQ make the longer page easy to scan.
Use solid reading surfaces for long content rather than adding more blur layers.
Reduced motion, reduced transparency, forced colours and 320 px layouts remain
part of the same design, rather than separate versions of the page.

The product preview is labelled **Illustrative workspace · sample data**.
Its Records, Explore, Table details and Schema controls explore a small fictional
store. Explore follows explicit sample foreign-key values between records and
shows the matching columns and values. It is a small learning example, separate
from the production canvas, and never executes SQL or connects to work databases.
Do not make sample counts or example queries look like installation results.
The preview's Tools disclosure links to explanations of the real workspace tools.

**How it works** introduces Sources, record selection, expanding connections and
source evidence, followed by canvas controls and a guide to Records/Schema,
record windows and second-screen comparison/radar, both Tools entry points,
imports, SQL/restore points and optional local AI. Explain the difference between
table structure and record relationships, the read-only canvas, temporary work,
installation accounts and PostgreSQL's SQL, import and schema-backup capabilities. Keep the
longer control reference and common questions in keyboard-accessible disclosures.

The setup dialog offers new-installation and existing-checkout commands for
Windows PowerShell and macOS/Linux, with copy feedback. Both use the current
`main` branch.
Existing-checkout instructions retain `.env` and Docker volumes. Update the
commands and documentation links together if the release branch changes.
Project, documentation and setup links remain real navigation actions.

**Start exploring / Make it your workspace** opens registration for this
installation. **Log in** opens the shared account form in login mode. Account
screens support EN/NL, labelled fields, browser autofill, password visibility,
password confirmation, keyboard-operated mode tabs, disabled pending controls,
nearby errors and retry. Preserve entered data after a rejected request; never
store a password in browser storage. Use at least twelve characters and a
clear 12–128-character hint rather than invented strength claims.

Registration explains the real access boundary. The first account owns this
installation and signs in immediately. Every later request waits for the owner;
show that outcome explicitly, without suggesting access or email verification
has been completed. Approved users share the same permitted work databases.
An account is not a private database, hosted cloud workspace or new tenant.

`/account.php` shows the escaped name/email, local role and shared-database
boundary, a route into `/workspace.php`, and logout. Owners additionally see
pending requests, refresh, and explicit approval controls with a statement of
the database access being granted. Members do not receive owner controls.
Logout uses the authenticated POST endpoint and returns to the public entry.
The workspace keeps an account link without replacing its existing navigation.

The real workspace is now served from `/workspace.php`, behind the same
server-side session gate as data APIs and official phpMyAdmin. Preserve old
workspace hashes and database parameters when forwarding links from `/`.
Homepage, auth and account controls reuse the application's language mechanism
and visual vocabulary; ordinary schema, SQL, layout and preference flows retain
their existing responsibilities. Account syncing, email delivery and password
reset are not part of this delivery.

Responsive layouts keep the headline, primary action and account fields
readable at 320 px. Dense sample tables stay within their own region. Keep
visible focus, dialog focus return, sensible reading order, labelled non-colour
states, and reduced-motion/reduced-transparency fallbacks. No invented users,
testimonials, live collaboration or adoption statistics belong in this story.

## PostgreSQL in the existing workspace

Use the same table list, record browser, structure details and schema canvas
for both SQL engines. The database picker identifies PostgreSQL entries with
their database and schema as well as the engine name, for example
**govern_pg · public · PostgreSQL**. Keep identical table names in separate
schemas visually and functionally scoped to their selected entry.

Show a short localized notice that this PostgreSQL version supports browsing
only. Make unsupported row editing, arbitrary SQL, research, restore points,
phpMyAdmin/import, context export and AI unavailable rather than opening
MariaDB tools against the selected PostgreSQL scope. These limits belong next
to the affected task; keep the existing shared navigation and visual tokens.
Do not create a separate PostgreSQL-themed UI or duplicate the table screens.

Switching between engines preserves each complete scope's table, search and
diagram state. Cached data and delayed responses from another scope must never
replace the visible selection. A configured but unreadable schema uses the
same honest unavailable state as other connection failures.

## Unified record exploration

**Database → Explore / Verkennen** combines the guided record explorer and
relationship map in one workspace. Records is for ordinary rows and editing;
Explore is for following actual record connections; Schema groups table details
and the table diagram. Keep these tasks in the fixed order **Records, Explore,
Schema**. The old `#verbanden` hash is an alias of `#verkennen`.

Let the canvas dominate Explore. Use readable record cards, a floating source
library and a selected-record inspector rather than a second fixed table list.
The library owns table choice, record search and paginated starting records.
The inspector owns the selected record's references, source actions and evidence.
Cards, questions and inspector share one exact selection and the same reader API.

Provide Select/Pan, zoom and Fit; Shift-selection; Pin/Unpin; Hide; and bounded
Undo for canvas presentation. Orbit and Flow arrange unpinned cards; Manual
keeps the user's positions. Expanding a reference adds nearby records without
rearranging existing cards. Show explicit loading and further-page actions.
Hide and filters change visibility only. Undo may restore presentation or hide
newly expanded cards, but must never restore stale record/edge evidence or
relationship cursors. Clear map starts a fresh loaded graph and is not undone.

The source library and inspector can move, resize in width, close and reopen.
Keep main navigation fixed. On narrow screens use one drawer at a time, with
readable controls and focus return. Keyboard and touch alternatives accompany
dragging. Avoid continuous simulation motion and respect reduced motion.

Questions stay near the current selection: show the linked records for a real
reference, or show all records already loaded in this canvas. They are fixed
read actions, not generated answers or free SQL. Loaded counts never imply a
complete database graph. Unsupported identities, external references, missing
records and truncated previews have explicit states and a route back.

Keep names readable while preserving exact identifiers, complete keys, FK
column pairs and SQL/parameters under **Technical details**. Do not infer
ownership or causality from a field name. Opening **View row** reads the exact
selected source again in Records. Technical detail is a disclosure inside the
same workspace, not a separate Guided/Detailed navigation mode.

Keep complete scope identity and cancellation checks on every read. Language,
appearance and panel changes preserve temporary work. Each connection,
database and schema owns its own selection, filters, loaded records and canvas
presentation. Never persist fetched records or evidence in browser storage.

## Shared windows

Keep window chrome separate from content and data loading. The shared modal
shell owns dragging, viewport bounds, stacking, outside dismissal and focus;
feature modules configure their captured context, requests and rendering. See
[window configuration](MODALS.md).

Explore offers independent read-only record windows for comparison. A window
keeps its original database/schema and exact key when the workspace navigates.
Show that source explicitly and refresh only on request. Clicking a peer brings
it forward; opening another window preserves existing peers. Clicking outside
all windows or pressing Escape closes the top window. Drag the titlebar or use
Alt+Arrow keys. Window bodies scroll while their headers remain reachable.

Editing and confirmation dialogs remain blocking and preserve existing dirty
form and in-flight save guards through the shared cancel route. The desktop AI
panel remains docked. Its mobile modal follows outside dismissal. Never reload
the phpMyAdmin iframe to update window chrome, position, language or theme.

Workspace navigation uses a slim muted scrollbar. Hide the outer document
scrollbar while retaining document, keyboard and touch scrolling. Keep the
database picker and connection status together, including on mobile. Database
creation and import remain available in the compact Tools menu.

## Compact workspace header

Keep the database picker and Open database visible in one compact row. Group
secondary actions in a labelled Tools disclosure: exploration, database tools
and preferences. The panel shows full action labels, native language selection
and the current disabled/hidden states. On narrow screens use accessible icon
buttons in the header and retain full labels inside the panel. Keep connection
status as an inline dot with its text available to assistive technology and a
tooltip. Active tools have a small header indicator.

Use a nonmodal popover, with outside/Escape dismissal, natural Tab navigation
and a visible focus route back to Tools. Opening a dialog or assistant closes
the menu before activating the original control. Language changes preserve
the open panel and current work. Preserve the original control nodes and
listeners; relocating presentation must not change scope or capabilities.

## Second-screen companion

The companion window has a Comparison desk and Relationship radar. Keep the
same glass, typography, readable aliases and NL/EN preferences as the workspace.
Provide a main-screen entry and a pin action alongside record selection. Let
the user move the browser window to another monitor without a screen-permission
prompt. Explain and recover from a blocked popup.

Comparison pins keep their captured source while the main screen navigates.
Show database/schema/table per column, limit the desk to four records and keep
refresh/removal local to that pin. Align original field names, distinguish
missing/NULL/empty values, and never imply equality from an incomplete preview
or a comparison still loading. Shared links describe actual loaded references.
Guided keeps technical identifiers optional; Detailed retains original fields.

The radar follows the main selection until explicitly pinned. Local traversal
pins its source; resuming follows the latest main selection. Keep graph nodes,
foreign-key evidence and pin actions keyboard accessible. Show the actual scope
and bounded-preview status. Language and appearance changes preserve pins,
selection and active requests. A disconnected main screen leaves an offline
status beside the loaded snapshots.

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

The overview's decorative glass lens uses a slow float and an independent front
layer rotation. Animate transforms only, preserving its layout and existing
glass materials. This ambient motion runs only with `prefers-reduced-motion:
no-preference`; reduced motion keeps the original static shape.

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

- **Overview / Overzicht:** a starting point with data access, research,
  guidance and restore points. Open it directly. Counts come from the live
  database; row estimates are labelled as estimates.

- **Database / Database:** one fixed primary row: **Records**, **Explore /
  Verkennen**, **Schema**. These are workspace views, not extra main rail areas.

  - **Records:** table selection, search, pagination, readable rows and optional
    SQL explanation. Add rows or edit/delete through focused row dialogs. Keep
    official phpMyAdmin available for unsupported editing and its full toolset.
  - **Explore:** one flexible record canvas, source library, selection and
    inspector. Contextual questions expand declared references. Every card can
    open its source row; every line exposes its exact database evidence.
  - **Schema:** secondary **Table details / Tabeldetails** and **Diagram** views.
    Table details show columns, keys, relationships and definitions. Diagram
    shows the live whole-database table/foreign-key structure.
  - **Tools:** import and Backups, plus official phpMyAdmin actions for MariaDB.
    PostgreSQL uses native SQL/file imports and schema backups; keep engine
    capabilities explicit.
    Backup creation, download and recovery use the existing restore-point flow;
    old `#experimenten` bookmarks remain reachable.

- **Research / Onderzoeken:** visual query building, editable SQL, results and
  saved research. Keep it separate from visually following loaded records.

- **Settings / Instellingen:** language, appearance, workspace preferences and
  existing local AI configuration. Keep its entry in a consistent position.

The **database selector** belongs in the shared top bar: it changes the context
of these areas rather than adding another navigation level. Show the exact
database name and an unavailable label when needed. List schemas visible to
both database roles, plus configured unavailable schemas needed for recovery;
exclude system schemas. Selecting a database never grants access or connects
an unrelated server.

### One menu, three responsibilities

| Layer | Responsibility | Content |
| --- | --- | --- |
| Main rail | Choose an area | Overview, Database and Research; Settings at the bottom |
| Context panel or Explore library | Choose an object in that area | Tables, records, saved research or restore points |
| Workspace | Read, inspect or act on the object | Database views, query builder and editor, restore controls and task tools |

The rail and context panel form one connected glass surface with one shared
elevation. Do not add another tool rail beside them. Clicking an active area
with context toggles its panel; switching area replaces that panel's contents.
Overview and Settings open their own screens without a contextual menu of
links to other main areas. A dashboard action may still resume a specific task.

Records and Schema keep the searchable table explorer. Selecting a table
highlights it and updates the workspace; details do not replace the list.
Explore uses its single floating source library instead of duplicating that
fixed panel. The selected table carries between the three Database tasks.
Record search and pagination remain separate from table-catalog search.

### Predictable placement within Database

Use the same order across Database:

1. A compact **Database** heading and the shared source/panel opener.
2. One primary view row: **Records**, **Explore**, **Schema**, with the selected
   table context. Allow wrapping on narrow screens. Database Tools stays here.
3. Schema alone adds **Table details / Diagram** beneath its primary task.
4. Local tools stay beside the content they control. Canvas tools may float
   within Explore; main navigation and the database selector do not move.
5. Main content, then a compact loaded summary or optional explanation.

Keep object selection separate from changing view or expanding details. The
fixed explorer serves Records and Schema; Explore owns one floating library
and inspector. Avoid a second table picker, another rail, or a permanent column
for every tool.

In Schema, group the tool area by purpose: connection filtering and column
display; arrangement; zoom, actual size and fit; then refresh and Help. Keep
those groups together above the canvas, with consistent alignment and wrapping.
Zoom controls must not cover table fields or move below a large diagram.
Put table/relationship counts and the PK/FK legend in a compact canvas footer.

Schema and Explore share the canvas material in `canvas-workspace.css`: the same
accent/violet glow, low-contrast 22 px dot grid, elevation, corner radii and
660 px height (630 px on compact screens). Both use the available workspace
width and the same compact Database heading. Panning moves each grid with its
diagram. Tables and records use opaque shared panel material with a clear
selected state, and their local toolbars use the same surface, spacing and
control states. Theme, reduced transparency and forced colours apply to both.
Schema keeps its grouped toolbar above the diagram and its persistent table
explorer; its table positions, selected table and navigation remain intact.

### Record canvas

Use the unified Explore behaviour above. Start from one actual record and
expand declared incoming/outgoing references deliberately. Composite and self
links retain their identity; table colour remains stable and paired with text.
Selecting an edge exposes its ordered column pairs, complete keys and optional
prepared SQL. The graph never implies inferred similarity or causal influence.

Keep the empty, unsupported, missing-record, cross-schema and partial-result
states close to the relevant action. Show loaded records rather than claiming
a full database scan. A source row can be inspected even if it is outside the
first Records page. See [RECORD_MAP.md](RECORD_MAP.md) for controls and limits.

The Database rail entry returns to the last Database view in the current
session. Preserve direct links and existing hashes: `#gegevens`, `#structuur`,
`#schema`, `#verkennen` and `#verbanden`, including table parameters. Changing navigation must
not discard research drafts, builder choices, table state or schema placement.

Research uses the shared panel for saved research. Database Tools opens the
existing backup workspace and its restore-point context. Keep execution,
saving and restoration controls in their workspace.
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

### Add a database and import SQL

Keep one labelled create/import action in the Tools menu beside the shared
database selector. It opens a focused glass dialog.
The dialog offers existing database choice and import, plus a name field for a
new database. Keep the selected target visible in every action; changing the
name must not silently change the active workspace before the request succeeds.

Creating a missing database starts empty. Preparing an existing name preserves
its data and makes it available to Govern explicitly. Explain that importing SQL
is a separate operation that can change or replace data. Do not turn the name
form into a server administration panel or ask the user to paste credentials.
If the private creation service is unavailable, retain the entered name, show
the failure and keep existing database selection/import usable.

The create-and-import action prepares the database, switches through the shared
database flow and opens the official phpMyAdmin Import screen. Import into an
existing database opens that same screen directly. The user selects the file in
phpMyAdmin; do not add a duplicate file picker that would require choosing the
file twice. Keep **Import** and **Export** beside Browse, Structure and SQL
as native modal shortcuts while leaving all of phpMyAdmin's tools available.
Database Tools uses these same screens; it adds no competing import/export
engine.

Show pending state during preparation and prevent duplicate creation or a
competing target switch. Keep validation and server errors beside the name and
preserve it for retry. Closing the native import window refreshes tables,
structure and relationships while retaining valid previous workspace state.
The earlier database's SQL draft remains available when switching back. A
language change updates the dialog text without discarding its name or moving
the text caret; it never reloads an active phpMyAdmin import form. Support
keyboard focus return and a usable single-column dialog at 320 px.

This flow prepares a database on Govern's existing MariaDB server. It does not
discover or connect remote servers, promise that arbitrary SQL is reversible,
or bypass the configured import size and execution limits.

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

The assistant header always names its database and configured model. A labelled
**Database / Project code** selector chooses the source area. Show selected
objects and the source preview before sending. Database uses live schema and
bounded interface descriptions; it explicitly says that records
are not included. Never silently attach row values, a full query result or saved
research merely because it is visible on the screen. The user's typed question
and, for Database, bounded conversation history are still sent to the chosen
local provider.

Give connection states distinct language and next steps: **Disabled**, **Not
reachable**, **Model missing** and **Ready**. Ready requires a successful check;
it is not a decoration applied when the panel opens. Keep a question available
after an error, with a retry action and a route to **Settings → Local AI**.
Disabled setup has no generated sample answer. Settings shows the server's
provider/model and connection test; it does not accept an arbitrary provider URL
from the browser.

In Project code, offer **Search local code** beside the question. This action
works while the provider is disabled or unavailable. Explain that only local
`app/` and `docs/` files are searched; the browser does not choose arbitrary
folders. Use useful project questions, such as how database switching works.
Distinguish **Retrieved local code** from **Code cited in this answer** in an answer. Each source
opens a read-only passage inside the panel, with its relative file name and
actual line range. Render code and quotations as text; opening a source must not
visit a third-party site or fetch an arbitrary file path.

Show searching, no results, unavailable files and shortened context explicitly.
A project response with no matching sources or invalid citations says that an
answer could not be found in the project. Do not display a fake explanation or
SQL proposal in its place. Explain briefly that local search does not train the
model or erase its prior knowledge, and that valid references do not establish
the correctness of every generated claim.

Use one labelled question field and one primary **Send** action. During a
request, prevent duplicate sends and offer **Disconnect response**. State
honestly that this ends waiting in the browser and may not immediately stop a
running local model.
Render answers as text with an optional, separate SQL proposal. **Open in query
workspace** prepares an editable draft and uses the existing replacement
confirmation when necessary. It never executes SQL.

Questions, history and context are temporary per-database and source-area
session state, capped at forty messages per database/source area. A database or
source-area switch shows the corresponding
conversation and ignores any late response for the previous context. Reopening preserves the current draft;
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

Open Records, choose a table, read or search its rows, and optionally open the SQL explanation.
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

For PostgreSQL, reuse the SQL editor with engine-correct quoted/qualified
examples and explicit role-grant limits. Hide the visual builder, saved-query
form and phpMyAdmin shortcut until those paths exist for that engine. Explain
that client commands and COPY STDIN/STDOUT are unavailable, and that NOTICE
messages are not collected. Keep plain results/error diagnostics as text.

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
universal undo: MariaDB DDL is not generally transactional, ordinary SQL may
already have committed, and external clients do not automatically follow the
app's lock. PostgreSQL schema replacement has its own atomic transaction.

PostgreSQL imports reuse the native SQL/file-preview forms without displaying
phpMyAdmin tabs, iframe, fallback or external link. Keep the captured database
and schema visible and fixed during a modal operation. Confirm with exact
`database.schema`. SQL preflight explains the safety snapshots for every
configured existing schema and the possibility of already committed work after
an error. File imports retain exact text/NULL and never silently overwrite.
Changing language must preserve the chosen file, confirmation and preview.

PostgreSQL backups explicitly name the selected schema. Label a custom archive
as **PostgreSQL archive**, not SQL export. Restore confirms `database.schema`,
explains replacement of later objects and standard permission normalization,
and preserves other schemas. Unsupported objects or incoming external
relationships produce an actionable error rather than widening restore scope.
Retain the safety-copy recovery path; imported/native dump content is never
presented as a privileged SQL-execution capability.

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
| Local assistant | `ai-workspace.js`, live `AiContext`, local `LocalCodeSearch`, `AiService` and the optional configured `OllamaClient` |
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


## Tabular file import

A new **Bestanden importeren / Import files** tab lives inside the existing database
window, alongside the official SQL-import shortcut. It uses shared buttons, input
styles and semantic labels. Its panel has its own tabpanel ID and a contained scroll
area for wide tables. The file preview explains its limits and distinguishes
whole-file profile counts from the 20-row sample chart. The main action requires
the visible database name before import. During a pending request all context
controls and close actions are disabled. A language change preserves the draft.
Errors preserve the chosen file; an uncertain write response invalidates the old
preview and asks the user to inspect the table before retrying. Success identifies
database, table and record count; closing refreshes the normal Govern catalog.
This first phase adds tabular readers and a sample visualization, without a new
top-level area, persisted charts or maps.

## GhostSketch source inspection

`/dictation.php` lists archived recordings and their transcript. Its help directs
recording, importing, transcription and note linking to the separate GhostSketch app.
The Studio menu retains access to this archive view. The old Live Whiteboard remains
available for compatibility; GhostSketch has its own notebook/page interface.
