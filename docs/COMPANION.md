# Een tweede scherm voor Govern

De **Vergelijkingsdesk / Comparison desk** en **Relatieradar / Relationship
radar** gebruiken alleen-lezen gegevens uit de bestaande werkdatabases. Een
extra monitor is handig; twee browservensters naast elkaar werken ook.

## Openen en vergelijken

1. Open **Database → Verkennen / Explore**.
2. Klik op **Tweede scherm / Second screen** en verplaats het nieuwe
   browservenster naar je monitor.
3. Kies een record en klik op **Vastzetten om te vergelijken / Pin to comparison**,
   of gebruik het pin-icoon naast een record in de lijst.
4. Zet maximaal vier records naast elkaar. **Alleen verschillen / Only
   differences** filtert bekende verschillen. In Guided blijven technische
   velden optioneel; Detailed toont de oorspronkelijke velden.
5. De verversknop haalt dezelfde bron opnieuw op. De sluitknop verwijdert
   alleen de vergelijking, nooit het database-record.

Navigeren of een andere database/schema openen verandert vastgezette bronnen
niet. Dezelfde bron opnieuw vastzetten maakt geen dubbele kolom. Iedere kolom
vermeldt de oorspronkelijke database, het schema en de tabel. Onvolledige
previews, ontbrekende velden, SQL NULL en lege tekst blijven onderscheiden.

De vergelijking lijnt oorspronkelijke kolomnamen uit. Dezelfde naam in andere
tabellen betekent niet automatisch dezelfde zakelijke betekenis. Gedeelde
verbindingen zijn werkelijk geladen verwijzingen naar hetzelfde record binnen
dezelfde scope. De begrensde selectie bewijst niet dat er geen andere links zijn.

## Verbanden volgen

Open **Relatieradar / Relationship radar**. **Selectie volgen / Follow selection**
volgt het record op het hoofdscherm. **Deze weergave vastzetten / Pin this view**
houdt de huidige bron vast. Kies een knooppunt of een record in de lijst voor
zijn waarden; klik op een verbinding voor de echte foreign-key-kolommen en waarden.

Vanuit de radar kun je een record aan de desk toevoegen, lokaal verder verkennen
of expliciet op het hoofdscherm openen. Lokaal verkennen zet de radar vast;
**Selectie volgen** hervat bij de laatste hoofdselectie. Gebruik zoomknoppen,
passend maken, slepen en pijltoetsen voor grotere buurten. De grafiek vermeldt de
bestaande Explore-begrenzingen en leidt geen zakelijke betekenis af uit links.

## Verbinding en tijdelijk werk

Elke werkplektab heeft zijn eigen begeleidende venster. Alleen database, tabel
en exacte recordsleutel gaan over het tijdelijke kanaal. Elk venster haalt zijn
eigen gegevens op via de bestaande geauthenticeerde GET-actie. Andere tabs
sturen geen selecties naar dit venster.

Pins staan alleen in geheugen. Sluiten of herladen wist de vergelijking.
Herladen verbindt opnieuw met de nog geopende werkplektab. Als het hoofdscherm
sluit, blijven geladen momentopnamen zichtbaar met een verbroken-verbindingsstatus.
Open vanuit de werkplek opnieuw **Tweede scherm** voor een nieuw venster.

Bij een geblokkeerd venster: sta pop-ups voor Govern toe en kies **Opnieuw openen /
Open again**. Een actuele browser met BroadcastChannel is nodig. De bestaande
inloggrens en database-allowlists blijven gelden. Na een verlopen sessie kun je
opnieuw inloggen en expliciet opnieuw laden.

## Onderdelen

- `companion-channel.js`: tijdelijk vensterpaar, handshake, volgorde en status;
  geen records of accounts in browseropslag.
- `companion-workspace.js` en `record-explorer.js`: ingang, selectie en pinacties.
- `companion-model.js`: exacte bronidentiteit, gevalideerd laden, vergelijking
  en gedeelde geladen verbindingen. Grote sleutels blijven tekst.
- `companion.php` en `companion.js`: dezelfde HTML-inloggrens, desk en tijdelijke pins.
- `companion-radar.js`: grafiek, volgen/vastzetten en verwijzingsbewijs.

De [gedeelde vensterlaag](MODALS.md) blijft beschikbaar voor losse recordvensters
binnen beide browservensters. Nieuwe inhoud kan dezelfde broncontext gebruiken.
