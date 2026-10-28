import {registerMessages} from './i18n.js';

registerMessages('ui', {
    nl: {
        loading: 'Gegevens ophalen…', failed: 'Dit lukte nog niet', retry: 'Opnieuw proberen',
        noData: 'Geen gegevens gevonden.', noRows: 'Geen rijen', scrollResults: 'Resultaten, horizontaal te scrollen',
        unsaved: 'Nog niet opgeslagen', copied: 'Gekopieerd.',
        copyUnavailable: 'Kopiëren is niet beschikbaar. Selecteer de tekst en kopieer deze zelf.',
        showSql: 'Toon de SQL en uitleg',
        sqlHelp: 'Dit is de opdracht waarmee de gegevens zijn opgehaald. Een SELECT leest gegevens; de waarden bij de filters worden apart meegegeven.',
        filterValues: 'Filterwaarden: ', confirm: 'Bevestigen',
        confirmInput: 'Typ {value} om te bevestigen', confirmLabel: 'Typ {value} om door te gaan.', cancel: 'Annuleren',
    },
    en: {
        loading: 'Loading data…', failed: 'This did not work yet', retry: 'Try again',
        noData: 'No data found.', noRows: 'No rows', scrollResults: 'Results, scroll horizontally',
        unsaved: 'Not saved yet', copied: 'Copied.',
        copyUnavailable: 'Copying is unavailable. Select the text and copy it manually.',
        showSql: 'Show the SQL and explanation',
        sqlHelp: 'This is the statement used to fetch the data. SELECT reads data; filter values are supplied separately.',
        filterValues: 'Filter values: ', confirm: 'Confirm',
        confirmInput: 'Type {value} to confirm', confirmLabel: 'Type {value} to continue.', cancel: 'Cancel',
    },
});

registerMessages('api', {
    nl: {
        unreachable: 'De werkplek is niet bereikbaar. Controleer of de omgeving nog draait en probeer het opnieuw.',
        unreadable: 'De server gaf geen leesbaar antwoord. Controleer of de werkplek volledig is gestart.',
        failed: 'Het verzoek kon niet worden uitgevoerd.',
    },
    en: {
        unreachable: 'The workspace is unreachable. Check that it is still running and try again.',
        unreadable: 'The server returned an unreadable response. Check that the workspace has fully started.',
        failed: 'The request could not be completed.',
    },
});
