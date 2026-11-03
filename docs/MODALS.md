# Vensters en modalinhoud

De vensterbediening staat in `app/public/assets/modal-shell.js` en
`modal-shell.css`. Een inhoudsmodule bepaalt welke gegevens horen bij de
aangeklikte context. `record-window.js` werkt voor iedere tabel en exacte
recordsleutel zonder aparte formulieren per tabel.

## Bediening

Onder **Database → Verkennen / Explore** opent **Open in venster / Open in
window** het geselecteerde record. Het icoon naast iedere rij en de gekoppelde
items in een recordvenster openen ook een nieuw venster om records te vergelijken.

Sleep de titelbalk, of focus de titelbalk en gebruik **Alt + pijltoets**
(met Shift een grotere stap). Ook vanuit bedieningselementen in de titelbalk
werken deze sneltoetsen. De inhoud scrolt afzonderlijk; de sluitknop blijft
bereikbaar bij het verkleinen van de browser. Een klik in een ander venster
haalt dat naar voren. Escape sluit het bovenste venster. Een klik buiten alle
vensters sluit alleen het bovenste venster; een knop die een nieuw venster
opent houdt beide open.

Bewerk- en bevestigingsdialogen blijven blokkerend. Ook deze zijn verplaatsbaar
en sluiten bij een klik erbuiten. Die klik volgt dezelfde `cancel`-route als
Escape: de rijeditor vraagt nog om bevestiging bij onopgeslagen wijzigingen en
een lopende opslag kan sluiten tegenhouden. Het vaste AI-zijpaneel op desktop
blijft staan; de mobiele AI-modal gebruikt de gedeelde buitenklikbediening.

## Nieuwe inhoud toevoegen

Een inhoudsmodule configureert een nieuwe instantie per klik:

```js
import {createModal} from './modal-shell.js';

export function openItemWindow(context) {
    const modal = createModal({
        title: '…', // Gebruik een gedeelde NL/EN-vertaalsleutel.
        context,
        load: (captured, {signal}) => loadItem(captured, {signal}),
        render: (item, {context: captured, signal}) => {
            const content = document.createElement('section');
            content.textContent = item.label;
            // Voeg hier inhoud voor captured toe. Gebruik signal voor listeners.
            return content;
        },
    });
    modal.open();
    return modal;
}
```

`context` wordt gekopieerd met `structuredClone` en diep bevroren. Geef database,
tabel en exacte sleutel expliciet mee. Lees de selectie niet opnieuw uit globale
schermtoestand na een asynchrone opdracht. De inhoudsmodule valideert het antwoord
tegen haar context. De shell kent geen API-acties, tabellen of records. Render
bronwaarden met `textContent` of de gedeelde `el`-helper.

`load` ontvangt een AbortSignal. `reload()` breekt het vorige verzoek af en ruimt
oude inhoud op; late antwoorden worden genegeerd. `render` retourneert een
DOM-node, tekst of een opruimfunctie als het zelf inhoud aan `body` toevoegt.
Geef tijdelijke listeners datzelfde signal mee. Een taalwissel vertaalt de shell
zonder opnieuw te laden. De inhoudsmodule vertaalt haar geladen inhoud zelf,
zoals `record-window.js`, met behoud van bronwaarden en concepten.

De instantie biedt `dialog`, `header`, `title`, `description`, `body`,
`setTitle()`, `open()`, `close()`, `reload()`, `bringToFront()` en `destroy()`.
`beforeClose({reason, context, dialog})` kan asynchroon sluiten tegenhouden;
een fout houdt het venster open. `onClose` wordt eenmaal per geopende cyclus
aangeroepen, ook bij expliciet opruimen. Standaard verwijdert sluiten de instantie.
Met `disposeOnClose: false` kun je dezelfde instantie opnieuw openen; gebruik
`destroy()` wanneer de eigenaar wordt opgeruimd.

Leesvensters zijn standaard niet blokkerend. Gebruik `modal: true` voor een
handeling die eerst moet worden afgerond. Bestaande native dialogen gebruiken
`attachDialog(dialog, {handle: header})`; hun inhoud, `showModal()`, `close()`
en bestaande `cancel`-controles blijven bij de eigenaar. Ruim de geretourneerde
attachment met `destroy()` op wanneer de eigenaar verdwijnt.

## Vastgehouden gegevensbron

Een recordvenster vermeldt de oorspronkelijke database en bij PostgreSQL ook
het schema. Navigeren of een andere database kiezen verandert die bron niet.
Alleen **Verversen / Refresh** haalt opnieuw hetzelfde record op. Het venster
toont een begrensde momentopname via de bestaande alleen-lezen `explore`-actie;
geladen koppelingen zijn geen totaal van de database. Vensterinhoud, sleutels
en posities worden niet opgeslagen in localStorage.
