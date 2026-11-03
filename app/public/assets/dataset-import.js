import {t} from './i18n.js';
import './dataset-messages.js';
import {el, button, errorText} from './ui.js';
import {request} from './api.js';

/** One draft per database, with immutable request scope and no automatic retries. */
export class DatasetImportPanel {
    constructor(onBusy) {
        this.onBusy = onBusy;
        this.drafts = new Map();
        this.panel = el('section', {id: 'dataset-import-panel', class: 'dataset-import', hidden: true, role: 'tabpanel', 'aria-labelledby': 'database-tab-dataset'});
    }
    configure(database) {
        this.database = database;
        if (!this.drafts.has(database)) this.drafts.set(database, {file: null, preview: null, index: 0, name: 'import_data', mode: 'create', target: '', confirmation: '', error: '', result: null});
        this.draft = this.drafts.get(database);
        this.render();
    }
    field(key, control) {
        const id = 'dataset-' + key;
        control.id = id;
        return el('div', {class: 'dataset-field'}, el('label', {for: id}, t('dataset.' + key)), control);
    }
    render() {
        const d = this.draft;
        if (!d) return;
        const file = el('input', {type: 'file', class: 'input', accept: '.xlsx,.csv,.tsv,.txt,.json,.zip', on: {change: () => {
            d.file = file.files[0] || null; d.preview = null; d.result = null; d.error = ''; d.confirmation = ''; this.render();
        }}});
        const previewButton = button(t('dataset.preview'), () => this.preview(), {kind: 'primary', disabled: !d.file});
        const content = [el('h3', {}, t('dataset.title')), el('p', {}, t('dataset.description')),
            el('p', {}, this.database), this.field('file', file), d.file ? el('p', {}, d.file.name) : null,
            el('p', {}, t('dataset.limits')), previewButton];
        if (d.result) content.push(el('p', {role: 'status'}, t('dataset.saved', {count: d.result.imported, ...d.result})));
        if (d.error) content.push(el('p', {role: 'alert', class: 'error-text'}, d.error));
        if (d.preview && !d.result) {
            const item = d.preview.datasets[d.index];
            const sheet = el('select', {class: 'input', on: {change: e => {d.index = Number(e.target.value); d.target = ''; d.confirmation = ''; this.render();}}},
                d.preview.datasets.map((v, i) => el('option', {value: i, selected: d.index === i}, v.name)));
            const mode = el('select', {class: 'input', on: {change: e => {d.mode = e.target.value; d.confirmation = ''; this.render();}}},
                el('option', {value: 'create', selected: d.mode === 'create'}, t('dataset.create')),
                el('option', {value: 'append', selected: d.mode === 'append', disabled: !item.targets.length}, t('dataset.append')));
            const name = el('input', {class: 'input', value: d.name, maxlength: 64, on: {input: e => {d.name = e.target.value;}}});
            if (!item.targets.some(v => v.name === d.target)) d.target = item.targets[0]?.name || '';
            const target = el('select', {class: 'input', on: {change: e => {d.target = e.target.value;}}}, item.targets.map(v => el('option', {value: v.name, selected: v.name === d.target}, v.name)));
            content.push(this.field('sheet', sheet), el('p', {}, t('dataset.summary', {count: item.count, columns: item.columns.length, duplicates: item.duplicate_rows})),
                el('p', {}, t('dataset.storage')), item.formulas ? el('p', {}, t('dataset.cached', {count: item.formulas})) : null,
                this.field('mode', mode), d.mode === 'create' ? this.field('table', name) : this.field('target', target),
                el('div', {class: 'dataset-scroll'}, el('table', {class: 'data-table'},
                    el('thead', {}, el('tr', {}, ['source', 'column', 'type', 'empty', 'unique'].map(k => el('th', {scope: 'col'}, t('dataset.' + k))))),
                    el('tbody', {}, item.columns.map(c => el('tr', {}, [c.source, c.name, t('dataset.' + c.suggestion), c.empty, t('dataset.' + (c.unique ? 'yes' : 'no'))].map(v => el('td', {}, v))))))),
                el('p', {}, t('dataset.sample', {count: item.rows.length})),
                el('div', {class: 'dataset-scroll'}, el('table', {class: 'data-table'},
                    el('thead', {}, el('tr', {}, item.columns.map(c => el('th', {scope: 'col'}, c.name)))),
                    el('tbody', {}, item.rows.map(row => el('tr', {}, row.map(v => el('td', {}, v === null ? 'NULL' : v))))))));
            const chart = el('div', {class: 'dataset-chart'});
            const draw = index => {
                const counts = new Map();
                item.rows.forEach(row => {const value = row[index] === null ? 'NULL' : row[index]; counts.set(value, (counts.get(value) || 0) + 1);});
                chart.replaceChildren(...[...counts].sort((a, b) => b[1] - a[1]).map(([key, count]) =>
                    el('div', {class: 'dataset-bar'}, el('span', {}, key), el('meter', {min: 0, max: item.rows.length, value: count}, count), el('span', {}, count))));
            };
            const group = el('select', {class: 'input', on: {change: e => draw(Number(e.target.value))}}, item.columns.map((c, i) => el('option', {value: i}, c.source || c.name)));
            draw(0);
            content.push(this.field('chart', group), chart, el('p', {}, t('dataset.consequence', {database: this.database})));
            const commit = button(t('dataset.import'), () => this.commit(), {kind: 'primary', disabled: d.confirmation !== this.database});
            const confirm = el('input', {class: 'input', value: d.confirmation, autocomplete: 'off', on: {input: e => {d.confirmation = e.target.value; commit.disabled = d.confirmation !== this.database;}}});
            content.push(this.field('confirmation', confirm), commit);
        }
        this.panel.replaceChildren(...content.filter(Boolean));
        if (this.busy) this.panel.querySelectorAll('button,input,select').forEach(n => {n.disabled = true;});
    }
    async run(action, commit = false) {
        if (this.busy) return;
        const d = this.draft;
        const database = this.database;
        if (!d.file) {d.error = t('dataset.choose'); this.render(); return;}
        this.busy = true; d.error = ''; this.onBusy?.(true); this.render();
        const progress = el('p', {role: 'status'}, t('dataset.' + (commit ? 'saving' : 'loading')));
        this.panel.prepend(progress);
        try {
            const data = new FormData();
            data.append('file', d.file);
            if (commit) {
                const item = d.preview.datasets[d.index];
                const target = item.targets.find(v => v.name === d.target);
                for (const [key, value] of Object.entries({dataset: d.index, mode: d.mode, table: d.mode === 'create' ? d.name : d.target,
                    confirmation: d.confirmation, sha256: d.preview.sha256, version: target?.version || ''})) data.append(key, value);
            }
            const result = await request(action, {params: {database}, body: data});
            if (commit) {d.result = result; d.preview = null; d.confirmation = '';}
            else {d.preview = result; d.index = 0; d.confirmation = ''; d.result = null;}
        } catch (error) {
            d.error = errorText(error) + (commit ? ' ' + t('dataset.uncertain') : '');
            if (commit) {d.preview = null; d.confirmation = '';}
        } finally {
            this.busy = false; this.onBusy?.(false); this.render();
        }
    }
    preview() {return this.run('dataset-preview');}
    commit() {return this.run('dataset-import', true);}
}
