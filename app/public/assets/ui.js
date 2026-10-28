export function el(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'on') {
            for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
        } else if (['value', 'checked', 'disabled', 'hidden', 'selected'].includes(key)) node[key] = value;
        else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) {
        if (child !== null && child !== undefined && child !== false) {
            node.append(child instanceof Node ? child : document.createTextNode(String(child)));
        }
    }
    return node;
}

const iconPaths = {
    grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
    table: ['M3 5h18v14H3z', 'M3 10h18', 'M9 10v9'],
    layers: ['m12 3 9 5-9 5-9-5 9-5Z', 'm3 12 9 5 9-5', 'm3 16 9 5 9-5'],
    search: ['M21 21l-5-5', 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
    flask: ['M9 3h6', 'M10 3v6L4 19a1.4 1.4 0 0 0 1.3 2h13.4a1.4 1.4 0 0 0 1.3-2L14 9V3', 'M7 15h10'],
    database: ['M20 6c0 2-3.6 3-8 3S4 8 4 6s3.6-3 8-3 8 1 8 3Z', 'M4 6v12c0 2 3.6 3 8 3s8-1 8-3V6', 'M4 12c0 2 3.6 3 8 3s8-1 8-3'],
    arrow: ['M5 12h14', 'm13 6 6 6-6 6'],
    chevron: ['m9 5 7 7-7 7'],
    down: ['m6 9 6 6 6-6'],
    download: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 16v5h14v-5'],
    external: ['M14 3h7v7', 'm21 3-11 11', 'M10 3H3v18h18v-7'],
    close: ['m6 6 12 12', 'M18 6 6 18'],
    refresh: ['M20 7v5h-5', 'M4 17v-5h5', 'M6 6a8 8 0 0 1 13 2l1 4', 'M18 18a8 8 0 0 1-13-2l-1-4'],
    plus: ['M12 5v14', 'M5 12h14'],
    code: ['m8 5-6 7 6 7', 'm16 5 6 7-6 7', 'm14 3-4 18'],
    play: ['m7 4 14 8-14 8V4Z'],
    bookmark: ['M6 3h12v18l-6-4-6 4V3Z'],
    clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 7v5l3 2'],
    shield: ['m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z', 'm8 12 3 3 5-6'],
    info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 11v6', 'M12 7v1'],
    check: ['m5 12 4 4L19 6'],
    link: ['m10 13 4-4', 'M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0', 'm16 8 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0'],
    key: ['M15 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M11 11v10', 'M11 17h4', 'M11 21h3'],
    expand: ['M8 3H3v5', 'M16 3h5v5', 'M21 16v5h-5', 'M3 16v5h5'],
    collapse: ['M3 8h5V3', 'M21 8h-5V3', 'M16 21v-5h5', 'M8 21v-5H3'],
    copy: ['M8 8h13v13H8z', 'M16 8V3H3v13h5'],
    trash: ['M3 6h18', 'M9 6V3h6v3', 'M5 6l1 15h12l1-15', 'M10 10v7', 'M14 10v7'],
    menu: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
    book: ['M12 5v16', 'M12 5C8 2 4 2 2 3v16c4-1 7 0 10 2 3-2 6-3 10-2V3c-2-1-6-1-10 2Z'],
};

export function icon(name, className = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({
        viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon ' + className,
    })) svg.setAttribute(key, value);
    for (const d of iconPaths[name] || iconPaths.table) {
        const path = document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', d);
        svg.append(path);
    }
    return svg;
}

export function button(label, handler, {kind = 'secondary', symbol, className = '', ...attributes} = {}) {
    return el('button', {type: 'button', class: 'button button-' + kind + ' ' + className, 'aria-label': label, on: {click: handler}, ...attributes},
        symbol ? icon(symbol) : null, el('span', {}, label));
}

export function badge(text, variant = '') {
    return el('span', {class: 'badge ' + variant}, text);
}

export function heading(eyebrow, title, description, actions = []) {
    return el('div', {class: 'page-heading'},
        el('div', {}, el('p', {class: 'eyebrow'}, eyebrow), el('h1', {}, title),
            description ? el('p', {class: 'page-description'}, description) : null),
        actions.length ? el('div', {class: 'heading-actions'}, actions) : null);
}

export function loading(label = 'Gegevens ophalen…') {
    return el('div', {class: 'loading-state', role: 'status'}, el('span', {class: 'spinner'}), label);
}

export function empty(title, description, action, symbol = 'table') {
    return el('div', {class: 'empty-state'}, el('div', {class: 'empty-icon'}, icon(symbol)),
        el('h3', {}, title), el('p', {}, description), action || null);
}

export function errorPanel(error, retry) {
    return el('div', {class: 'notice notice-error', role: 'alert'},
        icon('info'), el('div', {}, el('strong', {}, 'Dit lukte nog niet'), el('p', {}, error.message || String(error)),
            retry ? button('Opnieuw proberen', retry, {className: 'button-small', symbol: 'refresh'}) : null));
}

export function notice(text, variant = '') {
    return el('div', {class: 'notice ' + variant}, icon('info'), el('p', {}, text));
}

export function dataTable(columns, rows, {emptyMessage = 'Geen gegevens gevonden.', caption} = {}) {
    if (!rows.length) return empty('Geen rijen', emptyMessage);
    const normalized = columns.map((column, i) => typeof column === 'string' ? {label: column, key: i} : column);
    const table = el('table', {class: 'data-table'});
    if (caption) table.append(el('caption', {class: 'sr-only'}, caption));
    table.append(el('thead', {}, el('tr', {}, normalized.map(column => el('th', {scope: 'col'}, column.label)))));
    const body = el('tbody');
    rows.forEach(row => body.append(el('tr', {}, normalized.map(column => {
        const value = row[column.key];
        const cell = el('td', {class: column.className || ''});
        if (column.render) cell.append(column.render(value, row));
        else if (value === null || value === undefined) cell.append(el('span', {class: 'null-value'}, 'NULL'));
        else {
            const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
            cell.append(el('span', {class: 'cell-value', title: text.length > 60 ? text : null}, text));
        }
        return cell;
    }))));
    table.append(body);
    return el('div', {class: 'table-scroll', tabindex: '0', 'aria-label': caption || 'Resultaten, horizontaal te scrollen'}, table);
}

export function number(value) {
    return new Intl.NumberFormat('nl-NL').format(Number(value) || 0);
}

export function fileSize(bytes) {
    if (bytes < 1024) return number(bytes) + ' B';
    if (bytes < 1048576) return (bytes / 1024).toLocaleString('nl-NL', {maximumFractionDigits: 1}) + ' kB';
    return (bytes / 1048576).toLocaleString('nl-NL', {maximumFractionDigits: 1}) + ' MB';
}

export function dateTime(value) {
    if (!value) return 'Nog niet opgeslagen';
    let normalized = String(value).replace(' ', 'T');
    if (!/[zZ]$|[+-]\d{2}:\d{2}$/.test(normalized)) normalized += 'Z';
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('nl-NL', {dateStyle: 'medium', timeStyle: 'short'}).format(date);
}

export function quoteIdentifier(value) {
    const quote = String.fromCharCode(96);
    return quote + String(value).replaceAll(quote, quote + quote) + quote;
}

export function toast(message, type = 'success') {
    const container = document.getElementById('toasts');
    const node = el('div', {class: 'toast ' + type, role: type === 'error' ? 'alert' : 'status'},
        icon(type === 'error' ? 'info' : 'check'), el('span', {}, message));
    container.append(node);
    setTimeout(() => node.remove(), type === 'error' ? 8500 : 4500);
}

export async function copyText(value) {
    try {
        await navigator.clipboard.writeText(value);
        toast('Gekopieerd.');
    } catch {
        toast('Kopiëren is niet beschikbaar. Selecteer de tekst en kopieer deze zelf.', 'error');
    }
}

export function sqlDisclosure(sql, params) {
    const details = el('details', {class: 'sql-disclosure'});
    details.append(el('summary', {}, icon('code'), 'Toon de SQL en uitleg'));
    details.append(el('p', {}, 'Dit is de opdracht waarmee de gegevens zijn opgehaald. Een SELECT leest gegevens; de waarden bij de filters worden apart meegegeven.'));
    details.append(el('pre', {class: 'code-block'}, el('code', {}, sql)));
    if (params && Object.keys(params).length) details.append(el('p', {class: 'muted'}, 'Filterwaarden: ', el('code', {}, JSON.stringify(params))));
    return details;
}

export function confirmAction({title, description, requiredText, confirmLabel = 'Bevestigen', danger = false}) {
    return new Promise(resolve => {
        const dialog = el('dialog', {class: 'confirm-dialog', 'aria-labelledby': 'confirmation-title'});
        const form = el('form', {method: 'dialog'});
        const submit = el('button', {class: 'button button-' + (danger ? 'danger' : 'primary'), type: 'submit'}, confirmLabel);
        const field = requiredText !== undefined
            ? el('input', {class: 'input', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Typ ' + requiredText + ' om te bevestigen'})
            : null;
        let confirmed = false;
        form.append(el('div', {class: 'confirm-symbol ' + (danger ? 'danger-text' : '')}, icon(danger ? 'refresh' : 'info')),
            el('h2', {id: 'confirmation-title'}, title), el('p', {}, description));
        if (field) {
            submit.disabled = true;
            form.append(el('label', {class: 'field-label'}, 'Typ ', el('strong', {}, requiredText), ' om door te gaan.', field));
            field.addEventListener('input', () => { submit.disabled = field.value !== requiredText; });
        }
        form.append(el('div', {class: 'dialog-actions'},
            button('Annuleren', () => dialog.close()), submit));
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (field && field.value !== requiredText) return;
            confirmed = true;
            dialog.close();
        });
        dialog.addEventListener('close', () => {
            resolve(confirmed ? (field ? field.value : true) : null);
            dialog.remove();
        }, {once: true});
        dialog.append(form);
        document.body.append(dialog);
        dialog.showModal();
        (field || form.querySelector('button')).focus();
    });
}
