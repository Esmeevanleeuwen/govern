import {request} from './api.js';
import {el, heading, loading, notice, empty} from './ui.js';
import {t, registerMessages} from './i18n.js';

registerMessages('studioMonitor', {
    nl: {title: 'Live notities', help: 'Bekijk de notities van je whiteboard terwijl ze binnenkomen. Bewerk kaarten in de aparte whiteboard-app.',
        open: 'Open whiteboard', board: 'Whiteboard', disabled: 'Whiteboard staat uit. Schakel Studio en PostgreSQL in via de serverconfiguratie.',
        setup: 'Richt eerst het whiteboardschema in met scripts/provision-studio.sh.',
        emptyTitle: 'Nog geen whiteboards', emptyHelp: 'Maak je eerste whiteboard in de aparte app.',
        noNotes: 'Nog geen notities. Voeg een kaart toe of start een opname in de whiteboard-app.',
        live: 'Bijgewerkt · revisie {revision}', original: 'Oorspronkelijke uitspraak', manual: 'Handmatige kaart',
        disconnected: 'Verversen is mislukt. De getoonde notities kunnen verouderd zijn.', note: 'Notitie', kind: 'Soort', source: 'Bron'},
    en: {title: 'Live notes', help: 'Follow whiteboard notes as they arrive. Edit cards in the separate whiteboard app.',
        open: 'Open whiteboard', board: 'Whiteboard', disabled: 'Whiteboard is disabled. Enable Studio and PostgreSQL in the server configuration.',
        setup: 'Provision the whiteboard schema with scripts/provision-studio.sh first.',
        emptyTitle: 'No whiteboards yet', emptyHelp: 'Create your first whiteboard in the separate app.',
        noNotes: 'No notes yet. Add a card or start recording in the whiteboard app.',
        live: 'Updated · revision {revision}', original: 'Original statement', manual: 'Manual card',
        disconnected: 'Refresh failed. The displayed notes may be out of date.', note: 'Note', kind: 'Kind', source: 'Source'},
});

/** Read-only live monitor. Scope is the configured Studio store, never a global selection. */
export async function mountStudioMonitor(container, {scopeKey, signal, initialBoard = '', onBoard = () => {}}) {
    const appLink = el('a', {class: 'button button-primary', href: '/studio.php'}, t('studioMonitor.open'));
    container.append(heading('Govern', t('studioMonitor.title'), t('studioMonitor.help'), [appLink]));
    if (!scopeKey) { container.append(notice(t('studioMonitor.disabled'))); return; }
    const status = el('p', {class: 'muted', role: 'status', 'aria-live': 'polite'});
    const content = el('div', {'data-studio-monitor': '', class: 'studio-monitor-content'}, loading());
    const selector = el('select', {class: 'input', 'aria-label': t('studioMonitor.board'), 'data-studio-monitor-board': ''});
    const field = el('label', {class: 'field-label'}, t('studioMonitor.board'), selector);
    container.append(field, status, content);
    let selected = initialBoard, timer, loadingBoard = false, revision = null, epoch = null, refreshVersion = 0;
    const params = () => ({database: scopeKey});
    const cancelled = () => signal.aborted;
    const renderNotes = snapshot => {
        const segments = new Map(snapshot.segments.map(item => [item.id, item]));
        const cards = snapshot.nodes.filter(item => item.kind !== 'stroke');
        if (!cards.length) { content.replaceChildren(notice(t('studioMonitor.noNotes'))); return; }
        const body = el('tbody');
        for (const item of cards) {
            const segment = segments.get(item.source_segment_id);
            const source = segment
                ? el('details', {}, el('summary', {}, t('studioMonitor.original') + ' · ' + Math.floor(segment.start_ms / 1000) + 's'),
                    el('p', {class: 'studio-monitor-source'}, segment.text))
                : t('studioMonitor.manual');
            body.append(el('tr', {'data-studio-monitor-node': item.id},
                el('td', {class: 'studio-monitor-note'}, item.text), el('td', {}, item.kind), el('td', {}, source)));
        }
        const table = el('table', {class: 'data-table'},
            el('caption', {class: 'sr-only'}, snapshot.board.title),
            el('thead', {}, el('tr', {}, ...['note', 'kind', 'source'].map(key => el('th', {scope: 'col'}, t('studioMonitor.' + key))))), body);
        content.replaceChildren(el('div', {class: 'table-scroll'}, table));
    };
    async function poll() {
        if (cancelled() || loadingBoard || !selected) return;
        loadingBoard = true;
        const board = selected, version = refreshVersion;
        try {
            const snapshot = await request('studio-board', {params: {...params(), board}, signal});
            if (cancelled() || board !== selected || version !== refreshVersion) return;
            if (revision !== snapshot.board.revision || epoch !== snapshot.generation) {
                revision = snapshot.board.revision; epoch = snapshot.generation; renderNotes(snapshot);
            }
            status.textContent = t('studioMonitor.live', {revision: snapshot.board.revision});
        } catch (error) {
            if (!cancelled() && board === selected) status.textContent = t('studioMonitor.disconnected') + ' ' + error.message;
        } finally {
            loadingBoard = false;
            if (!cancelled()) timer = setTimeout(poll, 1500);
        }
    }
    selector.addEventListener('change', () => {
        selected = selector.value; revision = null; epoch = null; refreshVersion++;
        onBoard(selected); appLink.href = '/studio.php?board=' + encodeURIComponent(selected);
        clearTimeout(timer); content.replaceChildren(loading());
        if (!loadingBoard) poll();
    });
    signal.addEventListener('abort', () => clearTimeout(timer), {once: true});
    try {
        const bootstrap = await request('studio-bootstrap', {params: params(), signal});
        if (cancelled()) return;
        if (!bootstrap.enabled || !bootstrap.ready) {
            field.hidden = true;
            content.replaceChildren(notice(t(bootstrap.enabled ? 'studioMonitor.setup' : 'studioMonitor.disabled')));
            return;
        }
        if (!bootstrap.boards.length) {
            field.hidden = true;
            content.replaceChildren(empty(t('studioMonitor.emptyTitle'), t('studioMonitor.emptyHelp')));
            return;
        }
        for (const board of bootstrap.boards) selector.append(el('option', {value: board.id}, board.title));
        if (!bootstrap.boards.some(board => board.id === selected)) selected = bootstrap.boards[0].id;
        selector.value = selected; onBoard(selected);
        appLink.href = '/studio.php?board=' + encodeURIComponent(selected);
        await poll();
    } catch (error) {
        if (!cancelled()) content.replaceChildren(notice(error.message, 'error'));
    }
}
