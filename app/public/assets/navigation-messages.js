import {registerMessages} from './i18n.js';

registerMessages('app.navigation', {
    nl: {
        database: 'Database', views: 'Databaseweergave', open: 'Tabellen en werkplek openen',
        show: 'Context openen', hide: 'Context inklappen', selected: 'Geselecteerde tabel',
        tables: 'Tabellen', saved: 'Opgeslagen onderzoeken', snapshots: 'Herstelpunten',
        columns: 'Kolommen', connections: 'Verbindingen', inspector: 'Tabeldetails',
        noConnections: 'Geen gedeclareerde verwijzingen vanuit deze tabel.',
        ready: 'Verbonden',
        emptySelection: 'Kies een tabel',
    },
    en: {
        database: 'Database', views: 'Database view', open: 'Open tables and workspace',
        show: 'Open context', hide: 'Collapse context', selected: 'Selected table',
        tables: 'Tables', saved: 'Saved research', snapshots: 'Restore points',
        columns: 'Columns', connections: 'Connections', inspector: 'Table details',
        noConnections: 'No declared references from this table.',
        ready: 'Connected',
        emptySelection: 'Choose a table',
    },
});
