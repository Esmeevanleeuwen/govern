import {registerMessages} from './i18n.js';

registerMessages('app.databases', {
    nl: {
        choose: 'Database kiezen', saved: 'Wijzigingen opgeslagen.', inserted: 'Rij toegevoegd.', deleted: 'Rij verwijderd.', unavailable: '{name} · niet beschikbaar',
        busy: 'Rond de huidige bewerking af voordat je van database wisselt.',
        changing: 'Database openen…', actions: 'Acties', addRow: 'Rij toevoegen',
        edit: 'Bewerken', remove: 'Verwijderen', editLabel: 'Rij bewerken in {table}',
        removeLabel: 'Rij verwijderen uit {table}',
        help: 'Voeg rijen toe of bewerk een bestaande rij. Je wijzigingen worden pas opgeslagen wanneer je bevestigt.',
        fallback: 'Deze weergave heeft geen bruikbare unieke sleutel. Gebruik phpMyAdmin om de gegevens te bewerken.',
        viewFallback: 'Bewerk de brontabel van deze weergave via phpMyAdmin.',
        openEditor: 'Bewerken in phpMyAdmin',
    },
    en: {
        choose: 'Choose database', saved: 'Changes saved.', inserted: 'Row added.', deleted: 'Row deleted.', unavailable: '{name} · unavailable',
        busy: 'Finish the current operation before switching databases.',
        changing: 'Opening database…', actions: 'Actions', addRow: 'Add row',
        edit: 'Edit', remove: 'Delete', editLabel: 'Edit row in {table}',
        removeLabel: 'Delete row from {table}',
        help: 'Add rows or edit an existing row. Changes are saved when you confirm.',
        fallback: 'This view has no usable unique key. Use phpMyAdmin to edit its data.',
        viewFallback: 'Edit the source table for this view in phpMyAdmin.',
        openEditor: 'Edit in phpMyAdmin',
    },
});
