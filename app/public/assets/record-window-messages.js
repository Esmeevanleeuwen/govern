import {registerMessages} from './i18n.js';

registerMessages('app.recordWindow', {
    nl: {
        title: 'Record bekijken',
        open: 'Open in venster',
        openRecord: 'Open {label} in een venster',
        scope: 'Database: {database}',
        postgresScope: 'PostgreSQL · {database} · schema {schema}',
        readOnly: 'Alleen bekijken',
        snapshot: 'Dit venster houdt zijn eigen database en record vast. Ververs voor de nieuwste gegevens.',
        refresh: 'Record verversen',
        links: 'Verbonden items in deze weergave',
        linksHelp: 'Open een verbonden item in een eigen venster om te vergelijken. Dit is een begrensde selectie van opgeslagen relaties.',
        noLinks: 'Geen verbonden items in deze selectie.',
        wrongRecord: 'Het antwoord hoort niet bij het record of de database van dit venster.',
    },
    en: {
        title: 'Record details',
        open: 'Open in window',
        openRecord: 'Open {label} in a window',
        scope: 'Database: {database}',
        postgresScope: 'PostgreSQL · {database} · schema {schema}',
        readOnly: 'Read only',
        snapshot: 'This window keeps its own database and record. Refresh to fetch the latest values.',
        refresh: 'Refresh record',
        links: 'Connected items in this preview',
        linksHelp: 'Open a connected item in its own window to compare. This is a bounded selection of stored relationships.',
        noLinks: 'No connected items in this selection.',
        wrongRecord: 'The response does not belong to this window’s record or database.',
    },
});
