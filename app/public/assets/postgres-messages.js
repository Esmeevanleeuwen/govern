import {registerMessages} from './i18n.js';

registerMessages('app.postgres', {
    nl: {
        readOnly: 'PostgreSQL · Alleen lezen. Bekijk tabellen, gegevens en relaties. Bewerken, SQL uitvoeren, importeren en herstelpunten volgen in een volgende versie.',
        unavailable: 'Deze functie is nog niet beschikbaar voor PostgreSQL. Je kunt tabellen, gegevens en relaties bekijken.',
        browse: 'Tabellen bekijken',
        definitionUnavailable: 'Een volledige CREATE-definitie is nog niet beschikbaar voor PostgreSQL. De kolommen, sleutels en relaties hierboven komen uit de actuele database.',
    },
    en: {
        readOnly: 'PostgreSQL · Read only. Explore tables, records and relationships. Editing, SQL execution, imports and restore points will follow in a later version.',
        unavailable: 'This feature is not available for PostgreSQL yet. You can explore tables, records and relationships.',
        browse: 'Explore tables',
        definitionUnavailable: 'A complete CREATE definition is not available for PostgreSQL yet. The columns, keys and relationships above come from the current database.',
    },
});
