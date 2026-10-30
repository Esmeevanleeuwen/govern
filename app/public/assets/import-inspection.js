import {request} from './api.js';
import {t} from './i18n.js';
import {el, button} from './ui.js';
import './import-messages.js';

/** Inspection surrounds official phpMyAdmin; it never parses or executes uploaded SQL. */
export class ImportInspectionPanel {
    constructor() {
        this.database = '';
        this.version = 0;
        this.before = null;
        this.after = null;
        this.submitted = false;
        this.nativeError = '';

        this.ownEpoch = 0;
        this.ownWorking = false;
        this.ownSql = '';
        this.ownPlan = null;
        this.ownHeading = el('h4', {}, t('imports.ownTitle'));
        this.ownDescription = el('p', {class: 'small muted'}, t('imports.ownDescription'));
        this.ownFile = el('input', {id: 'native-import-file', type: 'file', accept: '.sql,text/plain', class: 'input'});
        this.ownFileLabel = el('label', {class: 'field-label', for: 'native-import-file'}, t('imports.ownChoose'));
        this.ownPreviewButton = button(t('imports.ownPreview'), () => this.previewOwn(),
            {symbol: 'search', className: 'button-small'});
        this.ownConfirmLabel = el('label', {class: 'field-label', for: 'native-import-confirm'}, t('imports.ownConfirm'));
        this.ownConfirm = el('input', {id: 'native-import-confirm', type: 'text', autocomplete: 'off', class: 'input'});
        this.ownRunButton = button(t('imports.ownRun'), () => this.executeOwn(),
            {symbol: 'play', kind: 'primary', className: 'button-small'});
        this.ownStatus = el('p', {role: 'status', 'aria-live': 'polite', class: 'small muted'});
        this.ownError = el('p', {role: 'alert', class: 'notice notice-error', hidden: true});
        this.ownPanel = el('section', {class: 'native-import'},
            this.ownHeading, this.ownDescription, this.ownFileLabel, this.ownFile,
            el('div', {class: 'database-manager-actions'}, this.ownPreviewButton),
            this.ownConfirmLabel, this.ownConfirm,
            el('div', {class: 'database-manager-actions'}, this.ownRunButton),
            this.ownStatus, this.ownError);
        this.ownFile.addEventListener('change', () => {
            this.ownEpoch++;
            this.ownSql = '';
            this.ownPlan = null;
            this.ownConfirm.value = '';
            this.ownStatus.textContent = '';
            this.ownError.hidden = true;
            this.ownControls();
        });
        this.ownConfirm.addEventListener('input', () => this.ownControls());
        this.ownControls();

        this.panel = el('section', {id: 'import-inspection', class: 'import-inspection', hidden: true,
            'aria-labelledby': 'import-inspection-title'},
            el('div', {class: 'import-inspection-heading'},
                this.title = el('h3', {id: 'import-inspection-title'}, t('imports.title')),
                this.refreshButton = button(t('imports.refresh'), () => this.refresh(this.after ? 'after' : 'before'),
                    {className: 'button-small'})),
            this.ownPanel,
            this.summary = el('p', {class: 'import-inspection-summary', role: 'status', 'aria-live': 'polite'}),
            this.warnings = el('div', {class: 'import-inspection-warnings'}),
            this.details = el('details', {class: 'import-inspection-details'},
                this.detailsTitle = el('summary', {}, t('imports.details')),
                this.contents = el('div', {class: 'import-inspection-contents'})));
    }


    ownControls() {
        this.ownFile.disabled = this.ownWorking;
        this.ownPreviewButton.disabled = this.ownWorking || !this.ownFile.files?.length;
        this.ownConfirm.disabled = this.ownWorking || !this.ownPlan;
        this.ownRunButton.disabled = this.ownWorking || !this.ownPlan || this.ownConfirm.value !== this.database;
    }

    ownFailure(error) {
        this.ownError.hidden = false;
        this.ownError.textContent = error.message || String(error);
        this.ownStatus.textContent = '';
    }

    async previewOwn() {
        const file = this.ownFile.files?.[0];
        if (!file || this.ownWorking || !this.database) return;
        const epoch = this.ownEpoch;
        const database = this.database;
        this.ownPlan = null;
        this.ownSql = '';
        this.ownError.hidden = true;
        if (file.size > 262144) {
            this.ownFailure(new Error(t('imports.ownTooLarge')));
            return;
        }
        this.ownWorking = true;
        this.ownStatus.textContent = t('imports.ownChecking');
        this.ownControls();
        try {
            // Reject malformed UTF-8 instead of silently altering the SQL.
            const sql = new TextDecoder('utf-8', {fatal: true}).decode(await file.arrayBuffer());
            if (epoch !== this.ownEpoch || database !== this.database) return;
            const plan = await request('native-import-preview', {params: {database}, body: {sql}});
            if (epoch !== this.ownEpoch || database !== this.database) return;
            this.ownSql = sql;
            this.ownPlan = plan;
            this.before = plan.before;
            this.after = null;
            this.render(plan.before, 'before');
            this.ownStatus.textContent = t('imports.ownPlanReady', {
                bytes: plan.bytes, count: plan.statement_count === null ? '?' : plan.statement_count,
                risky: plan.destructive.length + (plan.destructive_truncated ? '+' : ''),
            });
            this.ownConfirm.value = '';
        } catch (error) {
            if (epoch === this.ownEpoch && database === this.database) this.ownFailure(error);
        } finally {
            if (epoch === this.ownEpoch && database === this.database) {
                this.ownWorking = false;
                this.ownControls();
            }
        }
    }

    async executeOwn() {
        const plan = this.ownPlan;
        if (!plan || this.ownWorking || !this.database || this.ownConfirm.value !== this.database) return;
        const epoch = this.ownEpoch;
        const database = this.database;
        this.ownWorking = true;
        this.ownError.hidden = true;
        this.ownStatus.textContent = t('imports.ownRunning');
        this.ownControls();
        try {
            const result = await request('native-import-execute', {params: {database},
                body: {sql: this.ownSql, preview_token: plan.preview_token, confirmation: database}});
            if (epoch !== this.ownEpoch || database !== this.database) return;
            this.ownPlan = null;
            this.ownSql = '';
            this.after = result.after;
            this.render(result.after, 'after');
            const detail = result.failed?.detail || '';
            this.ownStatus.textContent = t(result.completed ? 'imports.ownSucceeded' : 'imports.ownPartial',
                {count: result.executed, detail: detail || '—'});
            if (result.safety_snapshot?.id) {
                this.ownStatus.textContent += ' ' + t('imports.ownBackup', {id: result.safety_snapshot.id});
            }
            this.ownConfirm.value = '';
        } catch (error) {
            if (epoch === this.ownEpoch && database === this.database) {
                this.ownPlan = null; // A changed database must be checked again.
                this.ownFailure(error);
            }
        } finally {
            if (epoch === this.ownEpoch && database === this.database) {
                this.ownWorking = false;
                this.ownControls();
            }
        }
    }

    open(database) {
        this.ownEpoch++;
        this.ownWorking = false;
        this.ownSql = '';
        this.ownPlan = null;
        this.ownFile.value = '';
        this.ownConfirm.value = '';
        this.ownStatus.textContent = '';
        this.ownError.hidden = true;
        this.ownControls();
        this.version++;
        this.database = database;
        this.before = null;
        this.after = null;
        this.submitted = false;
        this.nativeError = '';
        this.panel.hidden = false;
        this.summary.textContent = t('imports.checking');
        this.warnings.replaceChildren();
        this.contents.replaceChildren();
        this.details.open = false;
        this.refresh('before');
    }

    close() {
        this.ownEpoch++;
        this.ownPlan = null;
        this.ownSql = '';
        this.ownWorking = false;
        this.ownControls();
        this.version++;
        this.database = '';
        this.panel.hidden = true;
        this.submitted = false;
    }

    submittedFile() {
        if (!this.database || this.submitted) return;
        this.submitted = true;
        this.summary.textContent = t('imports.uploading');
    }

    finishedFile(error = '') {
        if (!this.submitted || !this.database) return;
        this.submitted = false;
        this.nativeError = String(error).slice(0, 500);
        this.refresh('after');
    }

    async refresh(phase) {
        if (!this.database) return;
        const version = ++this.version;
        const database = this.database;
        this.summary.textContent = t('imports.checking');
        try {
            const report = await request('import-inspection', {params: {database}});
            if (version !== this.version || database !== this.database) return;
            if (phase === 'before' && !this.submitted) this.before = report;
            if (phase === 'after') this.after = report;
            this.render(report, phase);
        } catch (error) {
            if (version !== this.version || database !== this.database) return;
            this.summary.textContent = t('imports.checkFailed');
            this.warnings.replaceChildren(el('p', {class: 'import-inspection-error'}, error.message));
        }
    }

    render(report, phase) {
        const isAfter = phase === 'after';
        const records = report.total_records === null ? t('imports.notAllCounted') : String(report.total_records);
        this.summary.textContent = t(isAfter ? 'imports.afterSummary' : 'imports.beforeSummary', {
            tables: report.tables.length, views: report.views.length,
            relations: report.foreign_keys, records,
        });
        const notices = [];
        const note = (key, values = {}, type = 'warning') =>
            notices.push(el('p', {class: 'import-inspection-' + type}, t(key, values)));
        if (!isAfter && report.tables.length) note('imports.existing', {count: report.tables.length});
        if (!isAfter && !report.tables.length) note('imports.empty', {}, 'info');
        if (isAfter) {
            if (this.nativeError) notices.push(el('p', {class: 'import-inspection-error'}, t('imports.nativeError', {message: this.nativeError})));
            if (this.before) {
                const added = report.tables.filter(name => !this.before.tables.includes(name)).length;
                const addedViews = report.views.filter(name => !this.before.views.includes(name)).length;
                const deltaRelations = report.foreign_keys - this.before.foreign_keys;
                const deltaRows = report.total_records !== null && this.before.total_records !== null
                    ? report.total_records - this.before.total_records : null;
                note('imports.changed', {tables: added, views: addedViews, relations: deltaRelations,
                    records: deltaRows === null ? t('imports.notAllCounted') : deltaRows}, 'info');
                if (!added && !addedViews && !deltaRelations && deltaRows === 0) note('imports.noDifference');
            } else note('imports.noBaseline');
        }
        if (report.unchecked_rows.length) note('imports.unchecked', {count: report.unchecked_rows.length});
        if (report.template === 'bestuursatlas') {
            if (report.missing_tables.length || report.missing_views.length) {
                note('imports.missing', {tables: report.missing_tables.length, views: report.missing_views.length});
            } else if (report.missing_foreign_keys.length) {
                note('imports.missingRelations', {found: report.foreign_keys, expected: report.expected_foreign_keys});
            } else note('imports.structureComplete', {}, 'info');
        }
        this.warnings.replaceChildren(...notices);
        const items = [
            el('p', {}, t('imports.objects', {tables: report.tables.join(', ') || '—', views: report.views.join(', ') || '—'})),
        ];
        if (report.template === 'bestuursatlas') {
            items.push(el('h4', {}, t('imports.completeness')));
            for (const group of report.sections) {
                const title = t('imports.' + 'section_' + group.key);
                const line = t('imports.sectionStatus', {name: title, present: group.present,
                    expected: group.expected, records: group.records === null ? t('imports.notAllCounted') : group.records});
                const missing = group.missing.length ? t('imports.missingNames', {names: group.missing.join(', ')}) : '';
                const empty = group.empty.length ? t('imports.emptyNames', {names: group.empty.join(', ')}) : '';
                items.push(el('p', {}, line + (missing ? ' · ' + missing : '') + (empty ? ' · ' + empty : '')));
            }
            if (report.missing_views.length) items.push(el('p', {}, t('imports.missingViews', {names: report.missing_views.join(', ')})));
            if (report.missing_foreign_keys.length) items.push(el('p', {}, t('imports.missingKeys', {names: report.missing_foreign_keys.join(', ')})));
        }
        if (report.unchecked_rows.length) items.push(el('p', {}, t('imports.uncheckedNames', {names: report.unchecked_rows.join(', ')})));
        this.contents.replaceChildren(...items);
    }

    translate() {
        this.ownHeading.textContent = t('imports.ownTitle');
        this.ownDescription.textContent = t('imports.ownDescription');
        this.ownFileLabel.textContent = t('imports.ownChoose');
        this.ownConfirmLabel.textContent = t('imports.ownConfirm');
        this.ownPreviewButton.querySelector('span').textContent = t('imports.ownPreview');
        this.ownRunButton.querySelector('span').textContent = t('imports.ownRun');
        this.title.textContent = t('imports.title');
        this.refreshButton.querySelector('span').textContent = t('imports.refresh');
        this.detailsTitle.textContent = t('imports.details');
        if (this.after) this.render(this.after, 'after');
        else if (this.before) this.render(this.before, 'before');
    }
}
