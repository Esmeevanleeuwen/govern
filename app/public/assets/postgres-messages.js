import {registerMessages} from './i18n.js';

registerMessages('app.postgres', {
    nl: {
        readOnly: 'PostgreSQL · Alleen lezen. Bekijk tabellen, gegevens en relaties. Rijbewerking vereist een ingestelde schrijfverbinding.',
        editing: 'PostgreSQL · Voeg records toe, bewerk ze of verwijder ze via Records. Vrije SQL, import en herstelpunten zijn nog niet beschikbaar.',
        unavailable: 'Deze functie is nog niet beschikbaar voor PostgreSQL. Je kunt tabellen, gegevens en relaties bekijken en records bewerken met een ingestelde schrijfverbinding.',
        noIdentity: 'Wijzigen en verwijderen vereisen een volledige primaire of unieke sleutel zonder NULL-velden. Toevoegen blijft beschikbaar.',
        viewReadOnly: 'Deze view is hier alleen-lezen. Bewerk records in de bijbehorende brontabel.',
        tableReadOnly: 'Rijbewerking is voor dit tabeltype hier niet beschikbaar.',
        browse: 'Tabellen bekijken',
        definitionUnavailable: 'Een volledige CREATE-definitie is nog niet beschikbaar voor PostgreSQL. De kolommen, sleutels en relaties hierboven komen uit de actuele database.',
    },
    en: {
        readOnly: 'PostgreSQL · Read only. Explore tables, records and relationships. Row editing requires a configured writer connection.',
        editing: 'PostgreSQL · Add, edit or delete records in Records. Free SQL, imports and restore points are not available yet.',
        unavailable: 'This feature is not available for PostgreSQL yet. You can explore tables, records and relationships, and edit records with a configured writer connection.',
        noIdentity: 'Updating and deleting require a complete primary or unique key without NULL fields. Adding records remains available.',
        viewReadOnly: 'This view is read only here. Edit records in its source table.',
        tableReadOnly: 'Row editing is not available here for this table type.',
        browse: 'Explore tables',
        definitionUnavailable: 'A complete CREATE definition is not available for PostgreSQL yet. The columns, keys and relationships above come from the current database.',
    },
});
