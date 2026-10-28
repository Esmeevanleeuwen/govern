import {t} from './i18n.js';
import './builder-messages.js';
import {request} from './api.js';
import {el, icon, button, loading, empty, errorPanel, notice} from './ui.js';

const operators = {"eq": "builder.operator.eq", "neq": "builder.operator.neq", "contains": "builder.operator.contains", "starts_with": "builder.operator.starts_with", "ends_with": "builder.operator.ends_with", "gt": "builder.operator.gt", "gte": "builder.operator.gte", "lt": "builder.operator.lt", "lte": "builder.operator.lte", "is_null": "builder.operator.is_null", "is_not_null": "builder.operator.is_not_null"};
const textTypes = new Set(['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set']);
const numericTypes = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'numeric', 'float', 'double', 'real', 'year']);
const dateTypes = new Set(['date', 'datetime', 'timestamp', 'time']);
const nullOperators = new Set(['is_null', 'is_not_null']);
const refKey = reference => JSON.stringify([reference.source, reference.column]);
const fieldReference = field => ({source: field.source, column: field.column});

function select(label, options, value, change, attributes = {}) {
    const control = el('select', {class: 'input select', 'aria-label': label, ...attributes},
        options.map(([key, text]) => el('option', {value: key}, text)));
    if (value && !options.some(([key]) => key === value)) {
        control.append(el('option', {value}, value + t('builder.unavailable')));
    }
    control.value = value;
    control.addEventListener('change', () => change(control.value));
    return control;
}

function clientError(key) {
    const error = new Error(t(key));
    error.translationKey = key;
    return error;
}

function section(number, title, ...children) {
    return el('fieldset', {class: 'builder-section'},
        el('legend', {}, el('span', {class: 'step-number', 'aria-hidden': 'true'}, number), title), children);
}

/** A temporary design over the live catalog; saved investigations stay SQL. */
export class QueryBuilder {
    constructor({tables, database, initialTable, draft, open, scope, onDraft, onToggle, getRevision, onApply}) {
        Object.assign(this, {tables, database, scope, onDraft, onToggle, getRevision, onApply});
        this.design = draft ? structuredClone(draft) : {
            table: initialTable || tables[0]?.name || '', join: null, columns: [],
            filters: [], match: 'all', order: [], limit: 25,
        };
        this.revision = 0;
        this.metadataRevision = 0;
        this.base = null;
        this.related = null;
        this.element = el('details', {class: 'card query-builder', open},
            el('summary', {}, icon('layers'), el('span', {}, el('strong', {}, t('builder.title')),
                el('small', {}, t('builder.subtitle'))), icon('down', 'builder-chevron')));
        this.body = el('div', {class: 'builder-body'});
        this.element.append(this.body);
        this.element.addEventListener('toggle', () => onToggle(this.element.open));
        scope.cleanup.push(() => this.destroy());
        this.loadTable(!draft);
    }

    refreshLanguage() {
        this.element.querySelector('summary strong').textContent = t('builder.title');
        this.element.querySelector('summary small').textContent = t('builder.subtitle');
        this.render();
    }

    destroy() {
        this.metadataRevision += 1;
        this.metadataController?.abort();
        this.buildController?.abort();
    }

    changed() {
        this.revision += 1;
        this.onDraft(structuredClone(this.design));
        if (this.status && !this.busy) this.status.replaceChildren();
    }

    async loadTable(selectDefaults = false) {
        this.metadataController?.abort();
        this.metadataController = new AbortController();
        const revision = ++this.metadataRevision;
        this.base = null;
        this.related = null;
        this.render();
        if (!this.tables.length || !this.design.table) return;
        try {
            const data = await request('structure', {params: {table: this.design.table}, signal: this.metadataController.signal});
            if (!this.scope.live() || revision !== this.metadataRevision) return;
            this.base = data;
            if (selectDefaults) {
                this.design.columns = data.columns.map(column => ({source: 'base', column: column.name}));
                this.changed();
            }
            await this.loadRelated(revision);
        } catch (error) {
            if (error.name !== 'AbortError' && this.scope.live() && revision === this.metadataRevision) {
                this.metadataError = error;
                this.render();
            }
        }
    }

    async loadRelated(revision) {
        this.related = null;
        this.metadataError = null;
        this.render();
        if (this.design.join) {
            const relation = this.base.foreign_keys.find(key => key.name === this.design.join.foreign_key);
            if (!relation || relation.referenced_schema !== this.database || !this.tables.some(table => table.name === relation.referenced_table)) {
                throw clientError('builder.relationUnavailable');
            }
            const data = await request('structure', {params: {table: relation.referenced_table}, signal: this.metadataController.signal});
            if (!this.scope.live() || revision !== this.metadataRevision) return;
            this.related = data;
        }
        if (this.scope.live() && revision === this.metadataRevision) this.render();
    }

    async changeJoin(name) {
        this.metadataController?.abort();
        this.metadataController = new AbortController();
        const revision = ++this.metadataRevision;
        const removed = this.design.columns.some(field => field.source === 'related') ||
            this.design.filters.some(field => field.source === 'related') || this.design.order.some(field => field.source === 'related');
        this.design.join = name ? {foreign_key: name, type: this.design.join?.type || 'left'} : null;
        for (const key of ['columns', 'filters', 'order']) this.design[key] = this.design[key].filter(field => field.source === 'base');
        this.changeNotice = removed ? 'builder.joinChanged' : '';
        this.changed();
        try { await this.loadRelated(revision); }
        catch (error) {
            if (error.name !== 'AbortError' && this.scope.live() && revision === this.metadataRevision) {
                this.metadataError = error;
                this.render();
            }
        }
    }

    fields() {
        return [['base', this.base], ['related', this.related]].flatMap(([source, table]) =>
            (table?.columns || []).map(column => ({source, column: column.name, meta: column,
                label: (source === 'related' ? t('builder.relatedPrefix') : '') + table.table + '.' + column.name})));
    }

    fieldSelect(label, reference, change) {
        return select(label, this.fields().map(field => [refKey(field), field.label]), refKey(reference), value => {
            const [source, column] = JSON.parse(value);
            change({source, column});
        });
    }

    allowedOperators(reference) {
        const type = this.fields().find(field => refKey(field) === refKey(reference))?.meta.data_type;
        const comparisons = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'];
        return [...(textTypes.has(type) ? ['eq', 'neq', 'contains', 'starts_with', 'ends_with', 'gt', 'gte', 'lt', 'lte'] :
            numericTypes.has(type) || dateTypes.has(type) ? comparisons : []), 'is_null', 'is_not_null'];
    }

    render() {
        const focusedLabel = this.body.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
        if (focusedLabel) this.focusAfterRender = focusedLabel;
        queueMicrotask(() => {
            if (!this.scope.live() || !this.focusAfterRender) return;
            if (document.activeElement !== document.body) { this.focusAfterRender = null; return; }
            const control = [...this.body.querySelectorAll('[aria-label]')].find(node =>
                node.getAttribute('aria-label') === this.focusAfterRender && node.getClientRects().length);
            if (control) { control.focus({preventScroll: true}); this.focusAfterRender = null; }
            else if (!this.body.querySelector('.loading-state')) this.focusAfterRender = null;
        });
        this.body.replaceChildren();
        if (!this.tables.length) {
            this.body.append(empty(t('builder.startTitle'), t('builder.startCopy'), null, 'table'));
            return;
        }
        const table = select(t('builder.baseTable'), this.tables.map(table => [table.name, table.name + (table.type === 'view' ? ' · view' : '')]), this.design.table, name => {
            this.design = {...this.design, table: name, join: null, columns: [], filters: [], order: [], match: 'all'};
            this.metadataError = null;
            this.changeNotice = 'builder.baseChanged';
            this.changed();
            this.loadTable(true);
        });
        this.body.append(el('p', {class: 'builder-intro'}, t('builder.intro')),
            el('label', {class: 'field-label'}, t('builder.baseTable'), table));
        if (this.metadataError) {
            this.body.append(errorPanel(this.metadataError, () => { this.metadataError = null; this.loadTable(false); }));
            if (this.base && this.design.join) {
                this.body.append(button(t('builder.removeJoin'), () => this.changeJoin(''), {symbol: 'close', className: 'button-small'}));
            }
            return;
        }
        if (!this.base || (this.design.join && !this.related)) {
            this.body.append(loading(t('builder.loadMetadata')));
            return;
        }
        const form = el('form', {class: 'builder-form'});
        form.addEventListener('submit', event => { event.preventDefault(); this.build(form); });
        const relations = this.base.foreign_keys.filter(key => key.referenced_schema === this.database && this.tables.some(table => table.name === key.referenced_table));
        const join = select(t('builder.join'), [['', t('builder.baseOnly')], ...relations.map(key =>
            [key.name, key.columns.join(', ') + ' → ' + key.referenced_table + ' (' + key.referenced_columns.join(', ') + ')'])],
        this.design.join?.foreign_key || '', name => this.changeJoin(name));
        const joinFields = el('div', {class: 'builder-two-columns'}, el('label', {class: 'field-label'}, t('builder.join'), join));
        if (this.design.join) {
            joinFields.append(el('label', {class: 'field-label'}, t('builder.includedRows'),
                select(t('builder.joinType'), [['left', t('builder.leftJoin')], ['inner', t('builder.innerJoin')]], this.design.join.type,
                    type => { this.design.join.type = type; this.changed(); })));
        }
        form.append(section('1', t('builder.joinSection'), joinFields,
            el('p', {class: 'field-hint'}, this.design.join ? t('builder.joinHelp') :
                relations.length ? t('builder.availableJoins') : t('builder.noJoins'))));
        if (this.changeNotice) form.append(notice(t(this.changeNotice)));

        const columnGroups = el('div', {class: 'builder-column-groups'});
        for (const [source, schema] of [['base', this.base], ['related', this.related]]) {
            if (!schema) continue;
            const groupName = source === 'base' ? t('builder.baseGroup') : t('builder.relatedGroup');
            const selected = new Set(this.design.columns.map(refKey));
            const list = el('div', {class: 'builder-columns'});
            const updateGroup = checked => {
                const keep = this.design.columns.filter(column => column.source !== source);
                this.design.columns = checked ? [...keep, ...schema.columns.map(column => ({source, column: column.name}))] : keep;
                this.changed();
                list.querySelectorAll('input').forEach(input => { input.checked = checked; });
                this.renderMissingColumns();
            };
            for (const column of schema.columns) {
                const reference = {source, column: column.name};
                const input = el('input', {type: 'checkbox', checked: selected.has(refKey(reference)),
                    'aria-label': (source === 'related' ? t('builder.relatedColumn') : t('builder.baseColumn')) + column.name});
                input.addEventListener('change', () => {
                    this.design.columns = this.design.columns.filter(field => refKey(field) !== refKey(reference));
                    if (input.checked) this.design.columns.push(reference);
                    this.changed();
                    this.renderMissingColumns();
                });
                list.append(el('label', {class: 'builder-column', title: column.comment || column.type}, input,
                    el('span', {}, column.name), el('small', {}, column.type)));
            }
            columnGroups.append(el('section', {class: 'builder-column-group'},
                el('div', {class: 'builder-group-heading'}, el('h3', {}, (source === 'related' ? t('builder.relatedGroupPrefix') : '') + schema.table),
                    el('div', {}, button(t('builder.all'), () => updateGroup(true), {kind: 'ghost', className: 'button-small', 'aria-label': t('builder.allColumns', {group: groupName})}),
                        button(t('builder.none'), () => updateGroup(false), {kind: 'ghost', className: 'button-small', 'aria-label': t('builder.clearColumns', {group: groupName})}))), list));
        }
        this.missingColumns = el('div', {class: 'builder-missing-columns'});
        this.renderMissingColumns();
        form.append(section('2', t('builder.columnsSection'), columnGroups, this.missingColumns));
        const filters = el('div', {class: 'builder-filter-list'});
        const addFilter = button(t('builder.addFilter'), () => {
            const field = this.fields()[0];
            this.design.filters.push({...fieldReference(field), operator: this.allowedOperators(field)[0], value: ''});
            this.changed(); this.renderFilters(filters, addFilter);
            filters.lastElementChild?.querySelector('select')?.focus();
        }, {symbol: 'plus', className: 'button-small'});
        this.renderFilters(filters, addFilter);
        form.append(section('3', t('builder.filtersSection'),
            el('label', {class: 'field-label'}, t('builder.match'),
                select(t('builder.match'), [['all', t('builder.matchAll')], ['any', t('builder.matchAny')]], this.design.match,
                    match => { this.design.match = match; this.changed(); })),
            filters, addFilter, el('p', {class: 'field-hint'}, t('builder.filterHelp'))));
        const ordering = el('div', {class: 'builder-order-list'});
        const addOrder = button(t('builder.addOrder'), () => {
            this.design.order.push({...fieldReference(this.fields()[0]), direction: 'asc'});
            this.changed(); this.renderOrder(ordering, addOrder);
            ordering.lastElementChild?.querySelector('select')?.focus();
        }, {symbol: 'plus', className: 'button-small'});
        this.renderOrder(ordering, addOrder);
        const limit = el('input', {class: 'input', type: 'number', min: '1', max: '200', step: '1', required: true, value: this.design.limit});
        limit.addEventListener('input', () => { this.design.limit = Number(limit.value); this.changed(); });
        form.append(section('4', t('builder.orderSection'), ordering, addOrder,
            el('label', {class: 'field-label builder-limit'}, t('builder.limit'), limit),
            el('p', {class: 'field-hint'}, t('builder.limitHelp'))));
        this.status = el('div', {class: 'builder-status', 'aria-live': 'polite'});
        this.submit = el('button', {type: 'submit', class: 'button button-primary', disabled: this.busy}, icon('code'), t('builder.create'));
        form.append(el('div', {class: 'builder-actions'}, this.submit,
            el('span', {class: 'small muted'}, t('builder.applyHint'))), this.status);
        this.body.append(form);
    }

    renderMissingColumns() {
        const available = new Set(this.fields().map(refKey));
        const missing = this.design.columns.filter(reference => !available.has(refKey(reference)));
        this.missingColumns.replaceChildren();
        if (!missing.length) return;
        this.missingColumns.append(notice(t('builder.missingColumn'), 'notice-warning'));
        for (const reference of missing) {
            const source = reference.source === 'related' ? this.related?.table || t('builder.relatedTable') : this.design.table;
            const name = source + '.' + reference.column;
            this.missingColumns.append(el('div', {class: 'builder-missing-choice'}, el('code', {}, name),
                button(t('builder.removeChoice'), () => {
                    this.design.columns = this.design.columns.filter(field => refKey(field) !== refKey(reference));
                    this.changed();
                    this.renderMissingColumns();
                    (this.missingColumns.querySelector('button') || this.body.querySelector('.builder-column input'))?.focus({preventScroll: true});
                }, {symbol: 'close', className: 'button-small', 'aria-label': t('builder.removeMissing', {name})})));
        }
    }

    renderFilters(container, addButton) {
        container.replaceChildren();
        this.design.filters.forEach((filter, index) => {
            const title = t('builder.condition', {number: index + 1});
            const field = this.fieldSelect(t('builder.conditionColumn', {number: index + 1}), filter, reference => {
                Object.assign(filter, reference);
                const allowed = this.allowedOperators(filter);
                if (!allowed.includes(filter.operator)) filter.operator = allowed[0];
                this.changed(); this.renderFilters(container, addButton);
                container.children[index]?.querySelector('select')?.focus();
            });
            const operation = select(t('builder.conditionOperator', {number: index + 1}), this.allowedOperators(filter).map(key => [key, t(operators[key])]), filter.operator, value => {
                filter.operator = value;
                this.changed(); this.renderFilters(container, addButton);
                container.children[index]?.querySelectorAll('select')[1]?.focus();
            });
            const type = this.fields().find(item => refKey(item) === refKey(filter))?.meta.data_type;
            const input = el('input', {class: 'input', type: 'text', 'aria-label': t('builder.conditionValue', {number: index + 1}),
                value: filter.value ?? '', inputmode: numericTypes.has(type) ? 'decimal' : 'text', placeholder: t('builder.valuePlaceholder')});
            input.addEventListener('input', () => { filter.value = input.value; this.changed(); });
            container.append(el('div', {class: 'builder-filter-row'}, el('span', {class: 'builder-row-label'}, title), field, operation,
                nullOperators.has(filter.operator) ? el('span', {class: 'builder-no-value'}, t('builder.noValue')) : input,
                button(t('builder.remove'), () => {
                    this.design.filters.splice(index, 1); this.changed(); this.renderFilters(container, addButton); addButton.focus();
                }, {kind: 'ghost', symbol: 'trash', className: 'icon-button', 'aria-label': t('builder.removeItem', {name: title})})));
        });
        if (!this.design.filters.length) container.append(el('p', {class: 'builder-empty'}, t('builder.noFilters')));
    }

    renderOrder(container, addButton) {
        container.replaceChildren();
        this.design.order.forEach((order, index) => {
            const title = t('builder.order', {number: index + 1});
            container.append(el('div', {class: 'builder-order-row'}, el('span', {class: 'builder-row-label'}, title),
                this.fieldSelect(t('builder.orderColumn', {number: index + 1}), order, reference => { Object.assign(order, reference); this.changed(); }),
                select(t('builder.orderDirection', {number: index + 1}), [['asc', t('builder.ascending')], ['desc', t('builder.descending')]], order.direction,
                    direction => { order.direction = direction; this.changed(); }),
                button(t('builder.remove'), () => {
                    this.design.order.splice(index, 1); this.changed(); this.renderOrder(container, addButton); addButton.focus();
                }, {kind: 'ghost', symbol: 'trash', className: 'icon-button', 'aria-label': t('builder.removeItem', {name: title})})));
        });
        if (!this.design.order.length) container.append(el('p', {class: 'builder-empty'}, t('builder.noOrder')));
    }

    async build(form) {
        if (this.busy || !form.reportValidity()) return;
        if (!this.design.columns.length) {
            this.status.replaceChildren(errorPanel(clientError('builder.chooseColumn')));
            form.querySelector('.builder-column input')?.focus();
            return;
        }
        const design = structuredClone(this.design);
        design.filters = design.filters.map(filter => {
            if (nullOperators.has(filter.operator)) delete filter.value;
            else filter.value = filter.value ?? '';
            return filter;
        });
        const revision = this.revision;
        const editorRevision = this.getRevision();
        this.buildController?.abort();
        this.buildController = new AbortController();
        this.busy = true;
        this.submit.disabled = true;
        this.status.replaceChildren(notice(t('builder.building')));
        try {
            const built = await request('build-query', {body: {design}, signal: this.buildController.signal});
            if (!this.scope.live() || revision !== this.revision || editorRevision !== this.getRevision()) {
                if (this.scope.live()) this.status.replaceChildren(notice(t('builder.outdated')));
                return;
            }
            this.onApply(built, design);
            this.status.replaceChildren(notice(t('builder.applied')));
        } catch (error) {
            if (error.name !== 'AbortError' && this.scope.live()) this.status.replaceChildren(errorPanel(error));
        } finally {
            this.busy = false;
            if (this.scope.live()) this.submit.disabled = false;
        }
    }
}
