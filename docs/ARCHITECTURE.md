# Architectuur

## Eén gegevensmodel, meerdere bruikbare schermen

De werkdatabase is de bron voor zowel Govern als phpMyAdmin. Govern vraagt de
catalogus op en bouwt daar zijn verkenner uit. Een nieuwe tabel verschijnt na
verversen, zonder een nieuwe resourceklasse of een kopie van de database in
applicatiecode. Commentaren in de database zijn ook beschikbaar in het scherm.

Het domeinmodel blijft relationeel. De koppeling tussen organisatie, systeem,
onderbouwing en bron hoort in gewone tabellen met foreign keys. De UI maakt die
structuur zichtbaar en kan later gerichte hulpmiddelen toevoegen.

## Onderdelen

De lokale ingang verdeelt verzoeken naar de PHP-app en naar phpMyAdmin. Beide
hebben dezelfde oorsprong, zodat het databasevenster zonder publieke iframe-
toestemming kan werken. MariaDB is alleen bereikbaar binnen het Docker-netwerk.

De PHP-app heeft een kleine API. Een catalogusservice beschrijft tabellen; een
onderzoekservice voert leesvragen uit en bewaart ze; een backupservice maakt en
herstelt SQL-exports. Het HTTP-bestand behandelt sessie, CSRF, foutstatus en JSON.
Deze verdeling volgt verantwoordelijkheden, niet afzonderlijke overheidsdomeinen.

De browser gebruikt herbruikbare onderdelen voor tabellen, meldingen, dialoog-
vensters, SQL-blokken en API-verzoeken. Tabnamen uit de database zijn gegevens,
geen uitvoerbare JavaScript of HTML.

De onderdelen hebben een kleine, duidelijke taak:

| Onderdeel | Verantwoordelijkheid |
| --- | --- |
| `app.js` | Routes, schermtoestand en de samenwerking tussen onderdelen |
| `ui.js` | Knoppen, tabellen, meldingen, bevestigingen en SQL-uitleg |
| `api.js` | Verzoeken, CSRF en consistente foutobjecten |
| `i18n.js` en de `*-messages.js` bestanden | Stabiele vertaalsleutels, Nederlands en Engels |
| `preferences.js` | Gevalideerde browservoorkeuren en gedeelde uiterlijktokens |
| `dashboard-layout.js` | Blokvolgorde, breedtes, zichtbaarheid en een aparte bewerkingsversie |
| `query-builder.js` | Het tijdelijke visuele queryontwerp en de toegepaste versie |
| `schema-model.js` en `schema-visualizer.js` | Live relaties, diagramindeling en interactieve schemaverkenning |
| `schema-navigation.js` | Alleen binnen het diagram genormaliseerde, muisgerichte scrollzoom |
| `schema-help.js` | Een vertaalde schemagids in een native dialoog met focusbeheer en opruimen |
| `selection-pointer.js` | Globale selectiepijl, Shift-selectie, vertraagde naamkaartjes en de uitlegdialoog |
| `selection-registry.js` | Semantische metadata van zichtbare onderdelen, los van hun normale bediening |
| `selection-content.js` | Feitelijke uitleg en mogelijke vervolgstappen uit geselecteerde metadata |
| `database-modal.js` | Het venster rondom de echte phpMyAdmin |
| `Messages.php` | Vertaalde applicatiefeedback met stabiele foutcodes |

## Selectie en gerichte uitleg

De selectiepijl staat in de gedeelde bovenbalk en werkt over de eigen Govern-
interface. De interactielaag vangt activeren, typen en slepen af zolang de pijl
aanstaat; normaal scrollen en schemazoom blijven beschikbaar. Klikken vervangt
de selectie, Shift-klikken wisselt een onderdeel in of uit de selectie. Het
naamkaartje verschijnt na meer dan drie seconden hover en bevat Meer en een
pad naar bovenliggende onderdelen. De teller biedt toegang zonder hover.

Schermen registreren tabellen, kolommen, rijen, cellen en relaties via
`registerSelection`. Ze gebruiken de bestaande catalogus- en browsegegevens,
geen tabelspecifieke controllers of kopie van het gegevensmodel. Niet
geregistreerde interfaceonderdelen krijgen een algemene uitleg van hun rol,
zichtbare tekst en HTML-tag. De inhoud van het officiële phpMyAdmin-frame valt
buiten deze inspectielaag.

De uitlegmodule gebruikt geselecteerde waarden, commentaren, sleutels en
gedeclareerde relaties. Selecties die niet meer in het scherm staan blijven
herkenbare momentopnamen. Een recordquery vereist alle werkelijke primaire-
sleutelvelden; samengestelde sleutels blijven intact en rijen zonder sleutel
worden niet als blijvend geïdentificeerde records behandeld. De vervolgstap kan
een leesquery in Onderzoeken klaarzetten, maar voert die niet uit. De selectie
verandert geen records, contextexports of opgeslagen voorkeuren. De vertalingen
gebruiken dezelfde berichtregistratie als de rest van de interface.

## Schemavisualisatie

De route `#schema` biedt een afzonderlijk werkvlak om de hele database te
verkennen. Vanuit Structuur kan de huidige tabel direct in het diagram worden
geselecteerd. Vanuit het diagram blijven Gegevens en Structuur bereikbaar voor
de gekozen tabel. De visualizer gebruikt dezelfde glasmaterialen, vertaalsleutels
en instellingen als de andere schermen.

`GET schema` haalt de metadata in drie gebonden catalogusqueries op via de
leesverbinding. Alleen gedeclareerde foreign keys leveren verbindingen op;
samengestelde sleutels behouden alle kolomparen. Een verwijzing naar een ander
schema wordt niet aan een gelijknamige lokale tabel gekoppeld. Views blijven
zichtbaar zonder verzonnen afhankelijkheden. De API levert geen tabelrecords.

De browser houdt de schemametadata bij tijdens taalwisselingen en haalt die na
werkplekverversing opnieuw op. Filter, selectie en diagramtoestand staan los van
onderzoekconcepten en dashboardindeling. Tabelposities worden per database in
een eigen versie van browseropslag bewaard; verplaatsen wijzigt geen tabellen,
kolommen of sleutels in MariaDB.

De schemaverkenner gebruikt een compacte gereedschapsbalk naast de
hoofdnavigatie. Tabellen en Geselecteerd klappen hun bijbehorende paneel uit.
Klikken op de actieve tool klapt alleen de inhoud in; de balk blijft zichtbaar.
Selecteren in de tekening werkt de context automatisch bij terwijl de
toetsenbordfocus in de tekening blijft. Een bewust ingeklapt menu blijft dicht. De tab en open/dicht-
toestand blijven in de schermtoestand tijdens taalwisselingen en terugkeren naar
Schema; alleen tabelposities worden naar browseropslag geschreven.

De knop Wat kan ik hier doen? blijft beschikbaar in de gereedschapsbalk, ook
zonder tabellen. De schemagids beschrijft bestaande handelingen en opent als
native `dialog`. Tab en Shift+Tab blijven binnen de gids; sluiten, Escape en
klikken op de achtergrond geven de focus terug. Een taalwisseling herbouwt de
geopende gids in de gekozen taal. Het verlaten van Schema verwijdert de dialoog
en bijbehorende toestand. Er worden geen API-mutaties uitgevoerd door de gids.

Scrollen boven de tekening zoomt rond de muispositie. De handler normaliseert
pixel-, regel- en paginascroll en werkt ook bij Ctrl-/trackpadgebaren. Buiten de
tekening blijft gewone pagina- en menuscroll werken. Opruimen van de visualizer
verwijdert ook de scrollhandler. De bestaande zoomknoppen en toetsen blijven
beschikbaar.

## Vormgeving

Govern gebruikt een open g als merk, systeemlettertypen en glasvlakken met brede,
zachte schaduwen. Het standaardaccent is Lagoon; de gebruiker kan een ander
accent en een achtergrondtint kiezen. Er zijn lichte en donkere thema's en een
systeemstand. De materialen, kleuren, afrondingen en schaduwen staan als gedeelde
`--g-*` tokens bovenaan `app/public/assets/styles.css`. Bestaande componentnamen
gebruiken dezelfde tokens via aliassen, zodat een scherm geen eigen vormtaal
hoeft te krijgen.

Panelen, knoppen en instellingen gebruiken transparantie en achtergrondvervaging.
Tabellen en SQL krijgen dichter glas om leesbaar te blijven. Ruimte, zachte
vlakverschillen en diepte vervangen harde paneelranden en scheidingslijnen.
Toetsenbordfocus blijft duidelijk zichtbaar. Minder transparantie en ontbrekende
blur-ondersteuning vallen terug op effen leesvlakken. Verminderde beweging,
systeemcontrast en ruimere aanraakdoelen horen bij de gedeelde componenten.

Er zijn geen externe lettertypen of extra UI-bibliotheken nodig. Het omringende
databasevenster volgt Govern; de inhoud blijft de officiële phpMyAdmin-interface.
De volledige visuele regels, gebruikersstromen en uitbreidingsaanpak staan in
[de UX/UI-ontwerpdocumentatie](DESIGN.md).

## Taal en bewaarde schermtoestand

Elke browserfunctie registreert zijn Nederlandse en Engelse teksten onder
stabiele sleutels. `i18n.js` levert de actieve taal, vertaling en locale voor
getal- en datumweergave. De taalkeuze wordt in browservoorkeuren bewaard. Zonder
keuze wordt een ondersteunde browsertaal gebruikt, anders Nederlands.

Een taalwisseling werkt de eigen interface bij zonder een volledige paginaherlading.
De geselecteerde tabel, zoekopdracht, paginering, querytekst, builderkeuzes en
een nog niet bewaarde dashboardindeling blijven schermtoestand. Opgeslagen
onderzoeken blijven gegevens in de database; een tijdelijk concept wordt daarmee
niet ongemerkt gelijkgesteld.

De API kiest applicatiefeedback met `Accept-Language` en geeft bij gewone
JSON-antwoorden `Content-Language` terug. De bestaande fouttekst blijft bestaan,
met daarnaast een stabiele `error_code`, veilige `error_params` en vertaalkaarten.
Ook waarschuwingen, resultaatmeldingen en queryuitleg kunnen beide talen bevatten.
Daardoor kan bestaande feedback van taal veranderen zonder de SQL opnieuw uit te
voeren. Zie het [API-contract](API.md) voor de velden.

Identifiers, SQL, exacte waarden, notities, records en exportinhoud worden niet
vertaald. Een taalgebeurtenis herlaadt ook geen geopend phpMyAdmin-frame met
mogelijk onbewaarde invoer. De nieuwe taal wordt pas meegestuurd bij de volgende
expliciete opening, tab- of tabelkeuze of herlaadactie.

## Persoonlijke instellingen en dashboardblokken

`govern.preferences.v1` bevat taal en uiterlijk in de lokale browseropslag.
`govern.dashboard.v1` bewaart afzonderlijk de indeling. Hiervoor worden geen
backend-endpoints of databasetabellen toegevoegd. Deze voorkeuren gelden voor
dezelfde browser en oorsprong; account- of apparaatsynchronisatie is geen
onderdeel van deze opslag.

De opslag heeft een versie en valideert elk veld. Een ongeldig veld krijgt zijn
eigen standaardwaarde. Ondersteunde oude gegevens kunnen bij een bewuste opslag
migreren; onbekende toekomstige versies worden niet overschreven. Als opslag
niet lukt, blijft de huidige sessie bruikbaar en krijgt de gebruiker daarover
feedback. Uiterlijk herstellen wist geen dashboardindeling of databasegegevens.

Een klein blokregister beschrijft vaste blok-ID's, vertaalsleutels en standaard-
en toegestane breedtes. De betreffende schermfunctie bepaalt de inhoud en acties;
`dashboard-layout.js` bewaart alleen de indelingsgegevens. Nieuwe blokken komen
achter bestaande keuzes; verborgen of tijdelijk onbekende blokken behouden hun
instellingen. Er is geen kopie van het relationele gegevensmodel nodig.

Indeling aanpassen maakt een aparte conceptversie. Verplaatsen werkt met slepen
en met knoppen; breedte en zichtbaarheid zijn in dezelfde modus beschikbaar.
Bewaren past de indeling toe, annuleren verwerpt alleen dat concept. Onafhankelijke
wijzigingen uit andere tabbladen worden waar mogelijk samengevoegd. Mobiel gebruikt
dezelfde volgorde in één kolom, met behoud van de desktopbreedtes.

## Visueel een query samenstellen

De querybouwer gebruikt dezelfde catalogus en onderzoekservice. De browser
beschrijft een keuze van tabel, kolommen, filters, volgorde en eventueel één
bestaande foreign key. `QueryDesigner` controleert die keuzes opnieuw tegen de
actuele database. Tabelnamen, kolomnamen en koppelvoorwaarden worden daardoor
niet rechtstreeks uit vrije invoer overgenomen.

`build-query` maakt een leesbare SQL-vraag en een korte uitleg. Bij uitvoeren
met een ontwerp gebruikt `QueryRunner` een prepared statement met gebonden
waarden. De weergegeven SQL is een zelfstandig uitvoerbare weergave van dezelfde
vraag. Een handmatige wijziging in de editor schakelt over naar de bestaande
vrije SQL-route. Beide routes gebruiken dezelfde leesrechten, tijdslimiet en
resultaatweergave.

Het ontwerp is tijdelijke schermtoestand. Opgeslagen onderzoeken blijven gewone
SQL in `_govern_queries`; een nieuw opslagmodel of een kopie van de catalogus is
daarvoor niet nodig. Uitbreidingen kunnen later extra SQL-onderdelen toevoegen
aan deze compiler zonder de tabellen of opgeslagen onderzoeken te migreren.

De PHP-container gebruikt versie 8.4. De MySQL-parser van PDO in deze versie
herkent gequote identifiers, ook wanneer een kolomnaam op een parameter lijkt.
Dat voorkomt een extra beperking op zelfgekozen namen en houdt native gebonden
waarden mogelijk. De integratietest bevat daarvoor een kolomnaam met een
dubbelepunt en een backtick. Zie de [PHP-documentatie](https://www.php.net/manual/en/migration84.new-features.php#migration84.new-features.pdo-mysql).

## Rechten

Govern gebruikt twee verbindingen naar dezelfde database. De eerste mag
onderzoeken en metadata lezen. Leestransacties beschermen ook tegen schrijvende
functies die via een zelfgemaakte view zouden worden aangeroepen. De tweede slaat eigen instellingen op en maakt
herstelpunten. phpMyAdmin gebruikt een schrijfaccount met rechten op die ene
werkdatabase. Globale serverrechten worden niet doorgegeven.

Dit is geen algemene beveiligde hostingdienst. De lokale ingang is bereikbaar
voor de gebruiker van de computer. Een publieke installatie vraagt een andere
toegangslaag; dat staat los van het gegevensmodel en kan later worden toegevoegd.

## Herstel

Herstelpunten zijn SQL-bestanden met metadata en SHA-256. Het id wordt door de
server gemaakt; download- en herstelverzoeken kiezen geen willekeurig pad.
De databaseclients worden met losse argumenten gestart. Een wachtwoord wordt
niet in de zichtbare procesargumenten gezet.

Terugzetten vervangt de geselecteerde werkdatabase en controleert het resultaat
van de client. Er wordt vooraf een veiligheidskopie gemaakt. Een fout tijdens
een DDL-import start, als er een veiligheidskopie is, een poging om de vorige
toestand te herstellen. Ook dat herstel kan mislukken en een gedeeltelijke
toestand achterlaten; de veiligheidskopie blijft beschikbaar. De foutketen en
de bijbehorende herstelpunt-ID blijven behouden. Een succesvolle procedure
wordt niet als een universele SQL-undo gepresenteerd.

## Verder uitbreiden

- Een grafiek kan de resultaten van een opgeslagen onderzoek gebruiken.
- De visuele querybouwer kan worden uitgebreid met groeperingen of meer koppelingen.
- Een schema-ontwerper kan gewone SQL genereren en de wijziging eerst laten zien.
- Een nieuw datasettype wordt als gewone tabel ingevoerd.
- Een optionele AI-koppeling kan later expliciete context krijgen, zonder de
  databaseverbinding standaard aan een externe partij te geven.

Voeg mogelijkheden toe aan het bestaande pad zolang dat duidelijk blijft. Een
extra service, database of abstractie is een keuze met kosten, geen vereiste om
uitbreidbaar te zijn.

Een toevoeging begint bij de taak, ingang, uitkomst en route terug. Hergebruik
de gedeelde componenten, vertaalsleutels, materialen en fouttoestanden voordat
er nieuwe patronen worden toegevoegd. Verbind één volledige gebruikersstroom
met de bestaande API en catalogus en behoud geldige concepten en voorkeuren.
Nieuwe appgegevens gebruiken waar nodig de `_govern_` naamruimte en een
afzonderlijke migratie; een visuele wijziging vervangt nooit de werkdatabase.
Werk de ontwerpdocumentatie en het API-contract in dezelfde wijziging bij.

## Bronnen voor de infrastructuur

- [Docker Compose](https://docs.docker.com/compose/)
- [Docker volumes](https://docs.docker.com/engine/storage/volumes/)
- [phpMyAdmin Docker-installatie](https://docs.phpmyadmin.net/en/latest/setup.html#installing-using-docker)
- [phpMyAdmin-configuratie](https://docs.phpmyadmin.net/en/latest/config.html)
- [MariaDB SQL-exports](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump)
