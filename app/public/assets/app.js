import {request, setCsrf, endpoint} from './api.js';
import {el, icon, button, badge, heading, loading, empty, errorPanel, notice, dataTable, number, fileSize, dateTime, quoteIdentifier, toast, copyText, sqlDisclosure, confirmAction} from './ui.js';
import {DatabaseModal} from './database-modal.js';
import {QueryBuilder} from './query-builder.js';

const routes = {
    overzicht: {label: 'Overzicht', icon: 'grid'},
    gegevens: {label: 'Gegevens', icon: 'table'},
    structuur: {label: 'Structuur', icon: 'layers'},
    onderzoeken: {label: 'Onderzoeken', icon: 'search'},
    experimenten: {label: 'Experimenten', icon: 'flask'},
};
const state = {
    bootstrap: null,
    table: '',
    queryDraft: '',
    queryName: '',
    queryNotes: '',
    queryId: null,
    queryResult: null,
    queryRevision: 0,
    queryDesign: null,
    builderDraft: null,
    builderOpen: true,
    restoring: false,
};
const page = document.getElementById('page');
const globalNotice = document.getElementById('global-notice');
const openDatabase = document.getElementById('open-database');
const refreshButton = document.getElementById('refresh-app');
const navigation = document.getElementById('navigation');
let currentScope;
let bootstrapController;
let routeVersion = 0;

const databaseModal = new DatabaseModal(() => {
    if (!state.restoring) refreshBootstrap(false).then(() => {
        if (!databaseModal.dialog.open && document.activeElement === document.body) openDatabase.focus();
    }).catch(error => toast(error.message, 'error'));
});
for (const [key, route] of Object.entries(routes)) {
    navigation.append(el('a', {class: 'nav-link', href: '#' + key, 'data-route': key},
        icon(route.icon), el('span', {}, route.label), icon('chevron', 'nav-arrow')));
}
openDatabase.prepend(icon('database'));
openDatabase.addEventListener('click', () => databaseModal.open(state.table, 'browse'));
refreshButton.append(icon('refresh'));
refreshButton.addEventListener('click', () => refreshBootstrap(true));
document.getElementById('context-export').prepend(icon('download'));
const menuToggle = document.getElementById('menu-toggle');
const sidebar = document.getElementById('sidebar');
const mobileViewport = window.matchMedia('(max-width: 820px)');
menuToggle.append(icon('menu'));
menuToggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('sidebar-open');
    syncSidebar();
    if (open) navigation.querySelector('[aria-current="page"]')?.focus();
});
navigation.addEventListener('click', event => { if (event.target.closest('a')) closeSidebar(); });
mobileViewport.addEventListener('change', () => {
    if (!mobileViewport.matches) document.body.classList.remove('sidebar-open');
    syncSidebar();
});
document.addEventListener('click', event => {
    if (document.body.classList.contains('sidebar-open') && !event.target.closest('#sidebar, #menu-toggle')) closeSidebar();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSidebar();
});

function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    syncSidebar();
}

function syncSidebar() {
    const open = document.body.classList.contains('sidebar-open');
    const hidden = mobileViewport.matches && !open;
    sidebar.inert = hidden;
    sidebar.setAttribute('aria-hidden', String(hidden));
    menuToggle.setAttribute('aria-expanded', String(open));
}
syncSidebar();

function route() {
    const [name, query = ''] = window.location.hash.slice(1).split('?');
    return {name: routes[name] ? name : 'overzicht', params: new URLSearchParams(query)};
}

function go(name, params = {}) {
    const search = new URLSearchParams(params).toString();
    const hash = '#' + name + (search ? '?' + search : '');
    if (window.location.hash === hash) render();
    else window.location.hash = hash;
}

function tables() {
    return state.bootstrap?.tables || [];
}

function activeTable(params) {
    const supplied = params.get('table');
    if (supplied && tables().some(table => table.name === supplied)) state.table = supplied;
    if (!tables().some(table => table.name === state.table)) {
        state.table = (tables().find(table => table.type === 'table' && Number(table.rows_estimate) > 0) || tables()[0])?.name || '';
    }
    return tables().find(table => table.name === state.table);
}

function defaultSql(table = state.table || tables()[0]?.name) {
    return table ? 'SELECT *\nFROM ' + quoteIdentifier(table) + '\nLIMIT 20;' : 'SELECT VERSION() AS databaseversie;';
}

function openResearch(sql) {
    state.queryRevision += 1;
    state.queryDraft = sql;
    state.queryId = null;
    state.queryName = '';
    state.queryNotes = '';
    state.queryResult = null;
    state.queryDesign = null;
    go('onderzoeken');
}

async function refreshBootstrap(notify = false) {
    bootstrapController?.abort();
    bootstrapController = new AbortController();
    refreshButton.disabled = true;
    try {
        const data = await request('bootstrap', {signal: bootstrapController.signal});
        state.bootstrap = data;
        setCsrf(data.csrf);
        databaseModal.configure(data.database.name, data.tables || []);
        openDatabase.disabled = false;
        const ready = data.database.status !== 'unavailable';
        document.getElementById('connection-state').replaceChildren(
            el('span', {class: 'status-dot ' + (ready ? '' : 'offline')}),
            el('span', {title: data.database.name}, data.database.name));
        document.getElementById('footer-database').textContent = data.database.name + (data.database.version ? ' · ' + data.database.version : '');
        globalNotice.replaceChildren();
        if (data.warning) globalNotice.append(notice(data.warning + ' Je herstelpunten blijven beschikbaar onder Experimenten.', 'notice-warning'));
        render();
        if (notify) toast('De werkplek is bijgewerkt.');
    } catch (error) {
        if (error.name === 'AbortError') return;
        if (!state.bootstrap) {
            page.replaceChildren(heading('VERBINDING', 'Je werkplek staat nog niet klaar.', 'De database of webserver kan nog bezig zijn met starten.'),
                errorPanel(error, () => refreshBootstrap()));
        } else globalNotice.replaceChildren(errorPanel(error, () => refreshBootstrap()));
        document.getElementById('connection-state').replaceChildren(el('span', {class: 'status-dot offline'}), el('span', {}, 'Verbinding onderbroken'));
    } finally {
        refreshButton.disabled = false;
    }
}

function render() {
    if (!state.bootstrap) return;
    currentScope?.controller.abort();
    currentScope?.cleanup.forEach(callback => callback());
    const version = ++routeVersion;
    const controller = new AbortController();
    const scope = {controller, signal: controller.signal, cleanup: [], live: () => version === routeVersion && !controller.signal.aborted};
    currentScope = scope;
    const location = route();
    activeTable(location.params);
    for (const link of navigation.querySelectorAll('a')) {
        const active = link.dataset.route === location.name;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    }
    document.getElementById('breadcrumb-current').textContent = routes[location.name].label;
    document.title = routes[location.name].label + ' — Govern';
    page.replaceChildren();
    const views = {overzicht: renderOverview, gegevens: renderData, structuur: renderStructure, onderzoeken: renderResearch, experimenten: renderExperiments};
    Promise.resolve(views[location.name](scope)).catch(error => {
        if (error.name !== 'AbortError' && scope.live()) page.append(errorPanel(error, () => render()));
    });
}

function renderOverview() {
    const data = state.bootstrap;
    page.append(heading('PERSOONLIJKE WERKPLEK', 'Je data, helder in beeld.', 'Bekijk wat je hebt, ontdek hoe het samenhangt en bouw stap voor stap verder.'));
    const visual = el('div', {class: 'hero-visual', 'aria-hidden': 'true'},
        el('div', {class: 'hero-sheet'}, el('div', {class: 'hero-sheet-top'}, icon('table'), 'JOUW GEGEVENS'),
            el('div', {class: 'hero-sheet-lines'}, Array.from({length: 18}, () => el('span')))),
        el('div', {class: 'hero-float'}, icon('link'), 'Alles begint met een verband'));
    page.append(el('section', {class: 'hero-card', 'aria-labelledby': 'hero-title'},
        el('div', {}, el('h2', {id: 'hero-title'}, 'Wat wil je vandaag uitzoeken?'),
            el('p', {}, 'Je database is je vertrekpunt. Verken de gegevens, stel een vraag of maak ruimte voor een experiment.'),
            el('div', {class: 'hero-actions'},
                button('Gegevens verkennen', () => go('gegevens'), {kind: 'primary', symbol: 'arrow'}),
                button('Een query proberen', () => openResearch(defaultSql()), {symbol: 'code'}))), visual));
    const stats = [
        ['Tabellen', data.stats.tables, 'table', 'De bouwstenen van je database'],
        ['Overzichten', data.stats.views, 'layers', 'Bewaarde manieren om data te lezen'],
        ['Geschatte rijen', data.stats.rows_estimate, 'database', 'Schatting uit de databasecatalogus'],
    ];
    page.append(el('div', {class: 'stats-grid'}, stats.map(([label, value, symbol, note]) =>
        el('div', {class: 'stat-card'}, el('div', {class: 'stat-icon'}, icon(symbol)),
            el('p', {}, label), el('strong', {class: 'stat-value'}, number(value)), el('span', {class: 'stat-note'}, note)))));
    const list = el('div', {class: 'home-table-list'});
    const featured = [...tables()].sort((a, b) => Number(b.rows_estimate || 0) - Number(a.rows_estimate || 0)).slice(0, 5);
    for (const table of featured) {
        list.append(el('button', {class: 'home-table-item', type: 'button', on: {click: () => go('gegevens', {table: table.name})}},
            icon(table.type === 'view' ? 'layers' : 'table'),
            el('span', {}, el('span', {class: 'home-table-name'}, table.name),
                el('span', {class: 'home-table-detail'}, number(table.columns) + ' kolommen · ' + (table.type === 'view' ? 'overzicht' : 'tabel'))),
            icon('chevron', 'row-chevron')));
    }
    if (!featured.length) list.append(empty('Nog geen tabellen', 'Open het databasevenster om gegevens te importeren, of herstel een eerder herstelpunt.'));
    const learning = [
        ['Verkennen', 'Lees een tabel en bekijk wat iedere kolom betekent.'],
        ['Verbanden begrijpen', 'Volg een verwijzing naar een andere tabel.'],
        ['Bewust experimenteren', 'Maak eerst een herstelpunt en bekijk daarna wat een wijziging doet.'],
    ];
    page.append(el('div', {class: 'home-columns'},
        el('section', {class: 'card'},
            el('div', {class: 'card-header'}, el('div', {}, el('h2', {}, 'In je database'), el('p', {}, data.database.name)),
                button('Alles bekijken', () => go('gegevens'), {kind: 'ghost', className: 'button-small', symbol: 'arrow'})),
            list),
        el('section', {class: 'card'},
            el('div', {class: 'card-header'}, el('div', {}, el('h2', {}, 'Leren door te doen'), el('p', {}, 'Kleine stappen, met je eigen gegevens.')), icon('book')),
            el('div', {class: 'learning-list'}, learning.map(([title, description], index) =>
                el('div', {class: 'learning-item'}, el('span', {class: 'step-number'}, String(index + 1)),
                    el('div', {}, el('h3', {}, title), el('p', {}, description))))),
            el('div', {class: 'learning-bottom'}, 'Gebruik ‘Toon de SQL en uitleg’ om te zien wat er gebeurt.'))));
}

function catalog(routeName) {
    const list = el('div', {class: 'catalog-list'});
    const search = el('input', {type: 'search', class: 'input', placeholder: 'Zoek een tabel…', 'aria-label': 'Zoek een tabel of view', autocomplete: 'off'});
    const draw = () => {
        const query = search.value.trim().toLocaleLowerCase();
        const matching = tables().filter(table => table.name.toLocaleLowerCase().includes(query));
        list.replaceChildren(...matching.map(table => el('button', {
            class: 'catalog-item' + (table.name === state.table ? ' active' : ''),
            type: 'button', title: table.name + (table.comment ? ' — ' + table.comment : ''),
            'aria-current': table.name === state.table ? 'true' : null,
            on: {click: () => go(routeName, {table: table.name})},
        }, icon(table.type === 'view' ? 'layers' : 'table'), el('span', {class: 'catalog-item-name'}, table.name),
        el('span', {class: 'catalog-item-count'}, number(table.columns)))));
        if (!matching.length) list.append(el('p', {class: 'catalog-empty'}, 'Geen tabellen gevonden.'));
    };
    search.addEventListener('input', draw);
    draw();
    return el('aside', {class: 'catalog', 'aria-label': 'Tabellen en views'},
        el('div', {class: 'catalog-head'}, el('div', {class: 'catalog-title'}, el('h2', {}, 'Tabellen & overzichten'), badge(number(tables().length))),
            el('div', {class: 'search-field'}, icon('search'), search)), list);
}

function tableHeader(table, tab) {
    return el('div', {class: 'table-heading'},
        el('div', {}, el('div', {class: 'table-heading-title'}, el('h2', {}, table.name), badge(table.type === 'view' ? 'VIEW' : 'TABEL', table.type === 'view' ? 'badge-blue' : 'badge-green')),
            table.comment ? el('p', {}, table.comment) : null),
        el('div', {class: 'table-heading-actions'},
            button(tab === 'structure' ? 'Open Structure' : 'Open Browse', () => databaseModal.open(table.name, tab), {className: 'button-small', symbol: 'database'})));
}

function noTables() {
    return empty('Er zijn nog geen tabellen beschikbaar.', 'Open het databasevenster om een SQL-bestand te importeren. Heb je al een herstelpunt? Je vindt dit onder Experimenten.',
        button('Database openen', () => databaseModal.open('', 'sql'), {kind: 'primary', symbol: 'database'}));
}

async function renderData(scope) {
    page.append(heading('GEGEVENS', 'Verken je database.', 'Zoek en lees de gegevens. Open het databasevenster wanneer je iets wilt toevoegen of veranderen.'));
    if (!tables().length) { page.append(noTables()); return; }
    const table = tables().find(item => item.name === state.table);
    const workspace = el('section', {class: 'table-workspace'});
    const card = el('div', {class: 'card'}, tableHeader(table, 'browse'));
    const search = el('input', {type: 'search', class: 'input', placeholder: 'Zoek in deze tabel…', 'aria-label': 'Zoek in de gegevens', autocomplete: 'off'});
    const size = el('select', {class: 'input select', 'aria-label': 'Aantal rijen per pagina'},
        [25, 50, 100].map(value => el('option', {value}, String(value))));
    const result = el('div');
    const pagination = el('div', {class: 'table-pagination'});
    const sql = el('div');
    let currentPage = 1;
    let timer;
    let requestId = 0;
    let rowController;
    scope.cleanup.push(() => { clearTimeout(timer); rowController?.abort(); });
    const load = async () => {
        rowController?.abort();
        rowController = new AbortController();
        const id = ++requestId;
        result.replaceChildren(loading());
        pagination.replaceChildren();
        sql.replaceChildren();
        try {
            const data = await request('browse', {params: {table: table.name, page: currentPage, page_size: size.value, q: search.value.trim()}, signal: rowController.signal});
            if (!scope.live() || id !== requestId) return;
            result.replaceChildren(dataTable(data.columns.map(column => ({key: column.name, label: column.name})), data.rows, {
                emptyMessage: search.value ? 'Probeer een ander zoekwoord of maak het zoekveld leeg.' : 'Deze tabel bevat nog geen rijen. Via Browse in het databasevenster kun je gegevens toevoegen.',
                caption: 'Gegevens uit ' + table.name,
            }));
            if (data.notice) result.append(notice(data.notice));
            const pages = Math.max(1, Math.ceil(Number(data.total) / Number(data.page_size)));
            currentPage = Number(data.page);
            const start = data.total ? (currentPage - 1) * Number(data.page_size) + 1 : 0;
            const end = Math.min(currentPage * Number(data.page_size), Number(data.total));
            pagination.replaceChildren(el('span', {}, number(start) + '–' + number(end) + ' van ' + number(data.total) + ' rijen'),
                el('div', {class: 'pagination-buttons'},
                    button('Vorige', () => { currentPage -= 1; load(); }, {disabled: currentPage <= 1}),
                    el('span', {}, currentPage + ' / ' + pages),
                    button('Volgende', () => { currentPage += 1; load(); }, {disabled: currentPage >= pages})));
            sql.append(sqlDisclosure(data.sql, data.params));
        } catch (error) {
            if (error.name !== 'AbortError' && scope.live() && id === requestId) result.replaceChildren(errorPanel(error, load));
        }
    };
    search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => { currentPage = 1; load(); }, 300);
    });
    size.addEventListener('change', () => { currentPage = 1; load(); });
    card.append(el('div', {class: 'table-toolbar'},
        el('div', {class: 'search-field'}, icon('search'), search),
        el('div', {class: 'table-toolbar-right'}, el('span', {class: 'small muted'}, 'Rijen'), size,
            button('Structuur', () => go('structuur', {table: table.name}), {kind: 'ghost', symbol: 'layers', className: 'button-small'}))),
        result, pagination);
    workspace.append(card, el('p', {class: 'table-caption'}, 'Dit overzicht leest je gegevens. Browse in het databasevenster biedt ook invoegen, wijzigen en verwijderen.'), sql);
    page.append(el('div', {class: 'explorer-layout'}, catalog('gegevens'), workspace));
    await load();
}

async function renderStructure(scope) {
    page.append(heading('STRUCTUUR', 'Begrijp hoe je data samenhangt.', 'Bekijk velden, sleutels en verwijzingen. De structuur wordt rechtstreeks uit je database gelezen.'));
    if (!tables().length) { page.append(noTables()); return; }
    const table = tables().find(item => item.name === state.table);
    const workspace = el('section', {class: 'table-workspace'}, loading('Structuur ophalen…'));
    page.append(el('div', {class: 'explorer-layout'}, catalog('structuur'), workspace));
    let data;
    try {
        data = await request('structure', {params: {table: table.name}, signal: scope.signal});
    } catch (error) {
        if (error.name !== 'AbortError' && scope.live()) workspace.replaceChildren(errorPanel(error, () => render()));
        return;
    }
    if (!scope.live()) return;
    const columns = [
        {key: 'name', label: 'Veld', render: (value, row) => el('span', {class: 'column-name'}, row.primary ? icon('key') : null, value)},
        {key: 'type', label: 'Type'},
        {key: 'nullable', label: 'Mag leeg zijn', render: value => el('span', {}, value ? 'Ja' : 'Nee')},
        {key: 'default', label: 'Standaardwaarde'},
        {key: 'generated', label: 'Invoer', render: value => value ? badge('Berekend', 'badge-blue') : el('span', {class: 'muted'}, 'Gewoon veld')},
        {key: 'comment', label: 'Betekenis', className: 'cell-wrap', render: value => el('span', {class: 'cell-value'}, value || '—')},
    ];
    const card = el('div', {class: 'card'}, tableHeader(table, 'structure'), dataTable(columns, data.columns, {caption: 'Kolommen van ' + table.name}));
    workspace.replaceChildren(card, el('p', {class: 'table-caption'}, 'Een sleutel herkent een rij. Een verwijzing verbindt die rij met een andere tabel. Berekende velden vult de database zelf in.'));
    const relations = el('section', {class: 'structure-section'}, el('h3', {}, 'Verwijzingen naar andere tabellen'));
    const keys = data.foreign_keys || [];
    if (!keys.length) relations.append(notice('Deze tabel heeft geen directe foreign keys naar andere tabellen. Andere tabellen kunnen wel naar deze tabel verwijzen.'));
    keys.forEach(foreignKey => {
        const target = foreignKey.referenced_table;
        const join = foreignKey.columns.map((column, index) => 'a.' + quoteIdentifier(column) + ' = b.' + quoteIdentifier(foreignKey.referenced_columns[index])).join('\n  AND ');
        const query = 'SELECT a.*, b.*\nFROM ' + quoteIdentifier(table.name) + ' AS a\nJOIN ' + quoteIdentifier(target) + ' AS b\n  ON ' + join + '\nLIMIT 20;';
        relations.append(el('div', {class: 'relation-card'}, icon('link'),
            el('div', {class: 'relation-content'}, el('p', {}, foreignKey.columns.join(', ') + ' → ' + target + '.' + foreignKey.referenced_columns.join(', ')),
                el('small', {}, foreignKey.name)),
            button('Bekijken', () => go('structuur', {table: target}), {kind: 'ghost', className: 'button-small'}),
            button('Onderzoek koppeling', () => openResearch(query), {className: 'button-small', symbol: 'code'})));
    });
    workspace.append(relations);
    const indexes = el('section', {class: 'structure-section'}, el('h3', {}, 'Indexen en unieke sleutels'));
    if (data.indexes?.length) {
        indexes.append(el('div', {class: 'index-list'}, data.indexes.map(index => el('div', {class: 'index-item'},
            el('strong', {}, index.name), el('small', {}, index.columns.join(', ') + (index.unique ? ' · uniek' : ''))))));
    } else indexes.append(el('p', {class: 'small muted'}, 'Geen indexen voor dit object.'));
    workspace.append(indexes);
    const ddl = el('details', {class: 'sql-disclosure'},
        el('summary', {}, icon('code'), 'Bekijk de SQL-definitie'),
        el('p', {}, 'Dit is de definitie die de database voor deze tabel of dit overzicht teruggeeft.'),
        el('pre', {class: 'code-block'}, el('code', {}, data.create_sql)),
        button('Definitie kopiëren', () => copyText(data.create_sql), {kind: 'ghost', className: 'button-small', symbol: 'copy'}));
    workspace.append(ddl);
}

async function renderResearch(scope) {
    page.append(heading('ONDERZOEKEN', 'Stel een vraag aan je gegevens.', 'Stel je query samen of schrijf zelf SQL. Bekijk het resultaat en bewaar wat je opnieuw wilt gebruiken.',
        [button('Volledige SQL-editor', () => databaseModal.open(state.table, 'sql'), {symbol: 'external'})]));
    if (!state.queryDraft) state.queryDraft = defaultSql();
    const result = el('div', {class: 'query-result'});
    const editor = el('textarea', {id: 'sql-editor', class: 'sql-editor', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'SQL-query'}, state.queryDraft);
    editor.value = state.queryDraft;
    editor.addEventListener('input', () => {
        state.queryRevision += 1;
        state.queryDraft = editor.value;
        state.queryDesign = null;
    });
    const explanation = el('div', {class: 'query-explanation'});
    const drawExplanation = () => {
        const binding = state.queryDesign;
        explanation.replaceChildren();
        if (binding && binding.sql === editor.value) {
            explanation.append(el('h3', {}, icon('book'), 'Wat deze query doet'),
                el('ul', {}, binding.explanation.map(text => el('li', {}, text))),
                el('p', {}, 'Je kunt deze SQL zelf aanpassen. Je keuzes in de bouwer blijven beschikbaar voor een volgende query.'));
        }
    };
    const runButton = button('Query uitvoeren', () => run(), {kind: 'primary', symbol: 'play'});
    const name = el('input', {class: 'input', type: 'text', maxlength: '160', value: state.queryName, placeholder: 'Bijvoorbeeld: systemen per organisatie', required: true});
    const notes = el('textarea', {class: 'input', rows: '3', placeholder: 'Wat wil je hiermee onderzoeken?', maxlength: '10000'}, state.queryNotes);
    notes.value = state.queryNotes;
    name.addEventListener('input', () => { state.queryName = name.value; });
    notes.addEventListener('input', () => { state.queryNotes = notes.value; });
    const saveLabel = el('span', {}, state.queryId ? 'Wijzigingen bewaren' : 'Onderzoek bewaren');
    const saveButton = el('button', {class: 'button button-primary', type: 'submit'}, icon('bookmark'), saveLabel);
    const savedList = el('div', {class: 'saved-list'}, loading('Opgeslagen onderzoeken ophalen…'));
    const saveError = el('div');
    const form = el('form', {class: 'save-query-form'},
        el('label', {class: 'field-label'}, 'Naam van je onderzoek', name),
        el('label', {class: 'field-label'}, 'Notitie', notes), saveButton,
        button('Als nieuw onderzoek bewaren', () => {
            if (saveButton.disabled) return;
            state.queryRevision += 1;
            state.queryId = null;
            saveLabel.textContent = 'Onderzoek bewaren';
            form.requestSubmit();
        }, {kind: 'ghost', className: 'button-small'}), saveError);
    const updateSavedList = async () => {
        const queries = await request('queries', {signal: scope.signal});
        if (!scope.live()) return;
        savedList.replaceChildren();
        if (!queries.length) {
            savedList.append(el('p', {class: 'catalog-empty'}, 'Je hebt nog geen onderzoeken bewaard.'));
            return;
        }
        queries.forEach(query => {
            const remove = button('Verwijderen', async () => {
                const confirmed = await confirmAction({title: 'Onderzoek verwijderen?', description: 'Je verwijdert alleen dit opgeslagen onderzoek. Je databasegegevens blijven bestaan.', confirmLabel: 'Onderzoek verwijderen', danger: true});
                if (!confirmed) return;
                remove.disabled = true;
                try {
                    await request('delete-query', {body: {id: query.id}});
                    if (String(state.queryId) === String(query.id)) {
                        state.queryId = null;
                        saveLabel.textContent = 'Onderzoek bewaren';
                    }
                    toast('Onderzoek verwijderd.');
                    await updateSavedList();
                } catch (error) { toast(error.message, 'error'); remove.disabled = false; }
            }, {kind: 'ghost', symbol: 'trash', className: 'icon-button', 'aria-label': 'Verwijder onderzoek ' + query.name});
            remove.querySelector('span').className = 'sr-only';
            savedList.append(el('div', {class: 'saved-item'},
                el('button', {class: 'saved-item-open', type: 'button', on: {click: () => {
                    state.queryRevision += 1;
                    state.queryId = query.id;
                    state.queryDraft = query.sql;
                    state.queryName = query.name;
                    state.queryNotes = query.notes || '';
                    state.queryResult = null;
                    state.queryDesign = null;
                    editor.value = query.sql;
                    name.value = query.name;
                    notes.value = query.notes || '';
                    saveLabel.textContent = 'Wijzigingen bewaren';
                    drawResult();
                    drawExplanation();
                    editor.focus();
                }}}, el('strong', {}, query.name), el('small', {}, dateTime(query.updated_at))), remove));
        });
    };
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (saveButton.disabled) return;
        if (!name.value.trim()) { name.focus(); return; }
        saveButton.disabled = true;
        saveError.replaceChildren();
        const revision = state.queryRevision;
        const submission = {id: state.queryId || undefined, name: name.value.trim(), sql: editor.value, notes: notes.value};
        try {
            const saved = await request('save-query', {body: submission});
            if (state.queryRevision === revision) state.queryId = saved.id;
            if (scope.live()) {
                saveLabel.textContent = state.queryId ? 'Wijzigingen bewaren' : 'Onderzoek bewaren';
                toast('Onderzoek bewaard.');
                await updateSavedList();
            }
        } catch (error) {
            if (scope.live()) saveError.replaceChildren(errorPanel(error));
        } finally { saveButton.disabled = false; }
    });
    const drawResult = () => {
        result.replaceChildren();
        const data = state.queryResult;
        if (!data) {
            result.append(el('div', {class: 'card query-placeholder'},
                empty('Hier verschijnt je resultaat.', 'Voer de query uit om de gegevens te bekijken. In deze werkplaats kun je veilig lezen.', null, 'search')));
            return;
        }
        const metrics = el('div', {class: 'query-metrics'}, badge(number(data.returned_rows) + ' rijen', 'badge-green'),
            el('span', {}, number(data.duration_ms) + ' ms'));
        const card = el('section', {class: 'card'},
            el('div', {class: 'card-header'}, el('h2', {}, 'Resultaat'), metrics),
            dataTable(data.columns, data.rows, {caption: 'Queryresultaat', emptyMessage: 'De query is uitgevoerd, maar leverde geen rijen op.'}));
        result.append(card);
        if (data.truncated) result.append(notice('Je ziet maximaal 200 rijen. Maak je vraag specifieker met WHERE of bekijk het volledige resultaat in het databasevenster.'));
        if (data.notice) result.append(notice(data.notice));
    };
    const run = async () => {
        if (runButton.disabled || !editor.value.trim()) { editor.focus(); return; }
        state.queryDraft = editor.value;
        state.queryResult = null;
        const sql = editor.value;
        const binding = state.queryDesign;
        const body = binding?.sql === sql ? {design: structuredClone(binding.design)} : {sql};
        const revision = state.queryRevision;
        runButton.disabled = true;
        result.replaceChildren(loading('Query uitvoeren…'));
        try {
            const data = await request('query', {body, signal: scope.signal});
            if (!scope.live() || revision !== state.queryRevision || editor.value !== sql) return;
            if (body.design) {
                if (data.sql !== sql) {
                    state.queryRevision += 1;
                    data.notice = [data.notice, 'De SQL is aangepast aan de actuele databasestructuur. De editor toont de uitgevoerde query.'].filter(Boolean).join(' ');
                }
                state.queryDraft = data.sql;
                editor.value = data.sql;
                state.queryDesign = {design: structuredClone(body.design), sql: data.sql, explanation: [...data.explanation]};
                drawExplanation();
            }
            state.queryResult = data;
            drawResult();
        } catch (error) {
            if (error.name !== 'AbortError' && scope.live() && revision === state.queryRevision && editor.value === sql) result.replaceChildren(errorPanel(error),
                el('p', {class: 'table-caption'}, 'Deze werkplaats leest gegevens. Gebruik de volledige SQL-editor in het databasevenster voor wijzigingen aan gegevens of structuur.'));
        } finally { runButton.disabled = false; }
    };
    editor.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); run(); }
    });
    editor.addEventListener('input', () => {
        state.queryResult = null;
        drawResult();
        drawExplanation();
    });
    const newQuery = () => {
        state.queryRevision += 1;
        state.queryDraft = defaultSql();
        state.queryName = '';
        state.queryNotes = '';
        state.queryId = null;
        state.queryResult = null;
        state.queryDesign = null;
        editor.value = state.queryDraft;
        name.value = '';
        notes.value = '';
        saveLabel.textContent = 'Onderzoek bewaren';
        drawResult();
        drawExplanation();
        editor.focus();
    };
    const editorCard = el('section', {class: 'card'},
        el('div', {class: 'editor-topbar'}, el('h2', {}, 'Querywerkplaats'), badge('Alleen lezen', 'badge-green')),
        el('div', {class: 'editor-wrap'}, editor),
        el('div', {class: 'editor-actions'}, el('div', {class: 'editor-action-buttons'}, runButton,
            button('Nieuw', newQuery, {kind: 'ghost', symbol: 'plus'}),
            button('Kopiëren', () => copyText(editor.value), {kind: 'ghost', symbol: 'copy'})),
            el('span', {class: 'keyboard-hint'}, 'Ctrl / ⌘ + Enter')),
        el('p', {class: 'query-hint'}, 'Eén opdracht per keer · maximaal 200 resultaatrijen · wijzigingen kunnen via de volledige SQL-editor.'), explanation);
    const help = el('section', {class: 'learning-help'},
        el('h3', {}, icon('book'), 'Begrijpen wat je doet'),
        el('details', {}, el('summary', {}, 'SELECT: welke gegevens wil je zien?'),
            el('p', {}, 'SELECT kiest de kolommen. FROM kiest de tabel. Een ster (*) betekent: alle kolommen. LIMIT beperkt het aantal resultaatrijen.'),
            button('Gebruik een voorbeeld', () => {
                state.queryRevision += 1;
                state.queryDesign = null;
                state.queryResult = null;
                editor.value = defaultSql(); state.queryDraft = editor.value;
                drawResult(); drawExplanation(); editor.focus();
            }, {className: 'button-small'})),
        el('details', {}, el('summary', {}, 'WHERE: welke rijen horen erbij?'),
            el('p', {}, 'Met WHERE voeg je een voorwaarde toe, bijvoorbeeld WHERE id = 1. Alleen rijen die aan die voorwaarde voldoen verschijnen.')),
        el('details', {}, el('summary', {}, 'JOIN: hoe verbind je tabellen?'),
            el('p', {}, 'Een JOIN haalt gegevens uit gekoppelde tabellen samen op. Bekijk bij Structuur een verwijzing en kies Onderzoek koppeling voor een voorbeeld met jouw eigen velden.'),
            button('Bekijk de structuur', () => go('structuur', {table: state.table}), {className: 'button-small'})));
    const builder = new QueryBuilder({
        tables: tables(), database: state.bootstrap.database.name, initialTable: state.table,
        draft: state.builderDraft, open: state.builderOpen, scope,
        onDraft: draft => { state.builderDraft = structuredClone(draft); },
        onToggle: open => { state.builderOpen = open; },
        getRevision: () => state.queryRevision,
        onApply: (built, design) => {
            state.queryRevision += 1;
            state.queryDraft = built.sql;
            state.queryDesign = {design: structuredClone(design), sql: built.sql, explanation: [...built.explanation]};
            state.queryResult = null;
            editor.value = built.sql;
            drawResult(); drawExplanation();
        },
    });
    page.append(el('div', {class: 'research-layout'},
        el('div', {}, builder.element, editorCard, result),
        el('aside', {class: 'research-aside'},
            el('section', {class: 'card saved-panel'}, el('div', {class: 'card-header'}, el('h2', {}, 'Onderzoek bewaren'), icon('bookmark')), form, savedList), help)));
    drawResult();
    drawExplanation();
    try { await updateSavedList(); } catch (error) {
        if (error.name !== 'AbortError' && scope.live()) savedList.replaceChildren(errorPanel(error));
    }
}

async function renderExperiments(scope) {
    page.append(heading('EXPERIMENTEN', 'Maak ruimte om iets te proberen.', 'Bewaar een herstelpunt voordat je gegevens of de structuur verandert. Je kunt het ook downloaden als gewoon SQL-bestand.',
        [button('Open databasevenster', () => databaseModal.open(state.table, 'sql'), {symbol: 'database'})]));
    const list = el('div', {class: 'snapshot-list'});
    const counter = el('span');
    const label = el('input', {class: 'input', maxlength: '160', placeholder: 'Bijvoorbeeld: vóór mijn eerste experiment', 'aria-label': 'Naam voor het herstelpunt'});
    const createButton = button('Herstelpunt maken', () => createSnapshot(), {kind: 'primary', symbol: 'plus'});
    const status = el('div');
    const create = el('section', {class: 'card snapshot-create'},
        el('div', {class: 'card-header'}, el('h2', {}, 'Bewaar de huidige toestand'), icon('shield')),
        el('div', {class: 'card-body'},
            el('p', {}, 'Een herstelpunt bevat de tabellen, gegevens en overzichten van ' + state.bootstrap.database.name + '.'),
            el('label', {class: 'field-label'}, 'Geef het een herkenbare naam', label), createButton, status));
    const load = async () => {
        list.replaceChildren(loading('Herstelpunten ophalen…'));
        try {
            const snapshots = await request('snapshots', {signal: scope.signal});
            if (!scope.live()) return;
            counter.textContent = number(snapshots.length);
            list.replaceChildren();
            if (!snapshots.length) {
                list.append(el('div', {class: 'card'}, empty('Je eerste herstelpunt begint hier.', 'Bewaar je database voordat je gaat experimenteren. Dan heb je een duidelijk punt om naar terug te keren.', null, 'clock')));
            }
            snapshots.forEach(snapshot => {
                const restore = button('Terugzetten', () => restoreSnapshot(snapshot, restore), {className: 'button-small', symbol: 'refresh'});
                list.append(el('article', {class: 'snapshot-card'},
                    el('div', {class: 'snapshot-top'}, el('span', {class: 'snapshot-symbol'}, icon('clock')),
                        el('div', {class: 'snapshot-info'}, el('h3', {}, snapshot.label || 'Herstelpunt'),
                            el('p', {}, dateTime(snapshot.created_at) + ' · ' + fileSize(snapshot.size_bytes))), badge('SQL-export')),
                    el('div', {class: 'snapshot-actions'},
                        el('a', {class: 'button button-secondary button-small', href: endpoint('download-snapshot', {id: snapshot.id})}, icon('download'), 'Download SQL'),
                        restore, el('code', {title: snapshot.sha256}, (snapshot.sha256 || '').slice(0, 12)))));
            });
        } catch (error) {
            if (error.name !== 'AbortError' && scope.live()) list.replaceChildren(errorPanel(error, load));
        }
    };
    const createSnapshot = async () => {
        createButton.disabled = true;
        status.replaceChildren(notice('De SQL-export wordt gemaakt. Voer ondertussen geen structuurwijzigingen uit.'));
        try {
            await request('create-snapshot', {body: {label: label.value.trim()}});
            if (!scope.live()) return;
            label.value = '';
            status.replaceChildren();
            toast('Herstelpunt gemaakt.');
            await load();
        } catch (error) {
            if (scope.live()) status.replaceChildren(errorPanel(error));
        } finally { createButton.disabled = false; }
    };
    const restoreSnapshot = async (snapshot, restoreButton) => {
        const database = state.bootstrap.database.name;
        const confirmation = await confirmAction({
            title: 'Herstelpunt terugzetten?',
            description: 'Je zet ' + database + ' terug naar ‘' + (snapshot.label || 'Herstelpunt') + '’. De huidige tabellen en gegevens worden vervangen. Als de huidige database bereikbaar is, wordt eerst een extra herstelpunt van de huidige toestand gemaakt.',
            requiredText: database, confirmLabel: 'Database terugzetten', danger: true,
        });
        if (confirmation === null) return;
        restoreButton.disabled = true;
        createButton.disabled = true;
        state.restoring = true;
        openDatabase.disabled = true;
        if (databaseModal.dialog.open) databaseModal.dialog.close();
        status.replaceChildren(notice('Herstelpunt wordt teruggezet. Laat de werkplek open en voer nu geen databasewijzigingen uit.'));
        try {
            const result = await request('restore-snapshot', {body: {id: snapshot.id, confirmation}});
            toast(result.message || 'Het herstelpunt is teruggezet.');
            await refreshBootstrap(false);
        } catch (error) {
            if (scope.live()) status.replaceChildren(errorPanel(error));
            toast('Terugzetten is niet voltooid. Bekijk de foutmelding voordat je verdergaat.', 'error');
        } finally {
            state.restoring = false;
            openDatabase.disabled = false;
            createButton.disabled = false;
            restoreButton.disabled = false;
        }
    };
    page.append(el('div', {class: 'snapshot-layout'},
        el('div', {}, create, el('p', {class: 'snapshot-help'},
            el('strong', {}, 'Een herstelpunt is een bewuste kopie. '),
            'Een herstart van Docker draait je wijzigingen niet terug. Downloads kun je apart bewaren of gebruiken om je gegevens mee te nemen.')),
        el('section', {}, el('div', {class: 'section-title'}, el('h2', {}, 'Je herstelpunten'), counter), list)));
    await load();
}

window.addEventListener('hashchange', () => {
    closeSidebar();
    render();
    document.getElementById('main-content').focus({preventScroll: true});
});
refreshBootstrap();
