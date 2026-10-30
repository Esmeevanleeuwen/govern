# Govern

Je persoonlijke werkplek om databases te bekijken, begrijpen en veranderen.
Bestuursatlas is het eerste oefenproject. Je werkt lokaal in één browservenster.

## Beginnen

Installeer en start Docker Desktop. Download deze repository en pak de map uit.

- **Windows:** dubbelklik op `start.cmd`.
- **macOS / Linux:** open een terminal in deze map en voer `sh start.sh` uit.

De eerste start haalt de onderdelen op, maakt lokale wachtwoorden aan en vult
een nieuwe database met de Bestuursatlas. Open daarna
[http://localhost:8080](http://localhost:8080).

Je hoeft PHP, Node, Composer of MariaDB niet zelf te installeren. Docker Compose
moet de optie `--wait` ondersteunen; een actuele Docker Desktop bevat die. Je bestaande
database buiten Docker wordt niet aangeraakt. De wachtwoorden staan alleen in
je lokale `.env`, die niet in Git wordt opgenomen.

## Een andere database kiezen of toevoegen

Kies bovenaan je database. De tabelverkenner, schemaweergave, onderzoeken,
context-export en herstelpunten volgen die keuze. Je onderzoeksconcept en
tabelkeuze blijven tijdens deze browsersessie per database behouden; de keuze
geldt alleen voor dit browsertabblad.

Gebruik **Database toevoegen of importeren** naast de databasekiezer. Je hoeft
daarvoor `.env` niet aan te passen:

1. Vul een databasenaam in, bijvoorbeeld `onderzoek`.
2. Kies **Database aanmaken** of **Aanmaken en SQL importeren**.
3. Govern maakt een ontbrekende database leeg aan en kiest die database. Bij
   importeren opent de echte phpMyAdmin direct op zijn importscherm.
4. Kies daar je SQL-bestand en voer de import uit. Sluit het databasevenster om
   de geïmporteerde tabellen en relaties in Govern te verversen.

De tab **Import** toont vóór het uploaden hoeveel tabellen, views, relaties en records al
bestaan. Na een native SQL-upload vergelijkt Govern de actuele structuur en
rijaantallen met de voorcontrole. Onder **Tabellen en inhoudelijke volledigheid**
zie je bij Bestuursatlas ook welke onderdelen ontbreken of nog leeg zijn.
Foutmeldingen uit phpMyAdmin en de leescontrole worden zichtbaar gemaakt; het
volledige importresultaat blijft in phpMyAdmin. Niet alle grote tabellen kunnen
exact worden geteld: zulke aantallen staan uitdrukkelijk als niet gecontroleerd.
Dit is geen garantie dat een import veilig of volledig is.

In hetzelfde venster kun je een bestaande database kiezen of de import voor de
geselecteerde database openen. Een bestaande naam toevoegen vervangt geen
gegevens; de expliciete import kan dat wel doen, afhankelijk van het SQL-bestand.
Import is geen herstelpunt en heeft geen algemene undo. De bestaande
phpMyAdmin-importgrens is 128 MB, met maximaal 300 seconden uitvoeringstijd.

Namen gebruiken letters, cijfers en underscores. Systeemdatabases kunnen niet
worden toegevoegd. De bijbehorende rechten blijven in het databasevolume bewaard,
zodat een toegevoegde database ook na opnieuw starten in de kiezer verschijnt.
De privéservice voor databaseaanmaak moet bereikbaar zijn; een ontbrekende
service geeft een melding en bewaart de ingevulde naam.

De bestaande opstartconfiguratie blijft ook beschikbaar. Om bijvoorbeeld vooraf
extra databases te laten aanmaken:

1. Open `.env` in de projectmap. Voeg deze regel toe, of voeg de naam toe aan
   de bestaande lijst:

   ```dotenv
   DB_DATABASES=onderzoek,project_data
   ```

2. Bewaar de bestaande wachtwoorden en `DB_NAME`.
3. Start opnieuw met `start.cmd` op Windows of `sh start.sh` op macOS / Linux.
4. Kies de database bovenaan. Nieuwe extra databases zijn leeg; importeer je
   bestaande SQL desgewenst via **Databasevenster** in de gekozen database.

De namen zijn een expliciete lijst met letters, cijfers en underscores, gescheiden
door komma's; `DB_NAME` blijft altijd beschikbaar. Opstarten maakt ontbrekende
databases aan en verleent beide Govern-accounts passende rechten zonder bestaande
gegevens opnieuw te vullen of wachtwoorden te vervangen. Dit werkt ook met je
bestaande Docker-volume. Verwijder daarvoor geen volumes.

Databases op dezelfde MariaDB-server die al voor zowel het schrijf- als het
leesaccount zichtbaar zijn, verschijnen ook. Systeemdatabases worden weggelaten.
Een geconfigureerde database die ontbreekt blijft in de kiezer staan voor herstel.
Een database buiten deze Docker-installatie wordt niet automatisch gekoppeld.

## Wat kun je ermee?

- **Overzicht:** zie welke tabellen en overzichten je database bevat.
- **Nederlands of Engels:** verander de taal bovenaan of bij Instellingen. Je
  tabellen, records, SQL en notities houden hun oorspronkelijke tekst.
- **Je eigen werkplek:** kies bij Instellingen een accentkleur, achtergrondtint,
  licht/donker/systeem, minder transparantie en de plaats van je navigatie.
- **Dashboard indelen:** verplaats, verbreed of verberg blokken via
  **Indeling aanpassen**. Je kunt slepen of de verplaatsknoppen gebruiken.
- **Selectieaanwijzer:** schakel bovenaan de selectiepijl in en klik op een
  onderdeel van Govern. Met **Shift + klik** voeg je onderdelen toe of haal je
  ze uit de selectie. Houd de aanwijzer langer dan drie seconden boven een
  onderdeel om de naam en HTML-tag te zien. **Meer** opent uitleg over precies
  dat onderdeel of de geselecteerde combinatie. Via het pad in het naamkaartje
  kun je bijvoorbeeld de hele rij of tabel kiezen.
- **Lokale AI:** open het AI-paneel bovenaan of kies **Vraag AI** bij je selectie.
  Bekijk welke schema-informatie wordt gebruikt, stel een vraag en zet een
  SQL-voorstel desgewenst klaar in Onderzoeken. De koppeling staat standaard uit;
  beschikbaarheid wordt gecontroleerd bij je eigen Ollama-server. Kies
  **Projectcode** om de lokale implementatie met bronpassages en regelnummers
  te doorzoeken; de zoekactie werkt ook zonder AI.
- **Eén menu:** kies Overzicht, Database, Onderzoeken of Experimenten in de
  hoofdbalk. Instellingen staat onderaan. Het aansluitende paneel toont alleen
  de tabellen, opgeslagen onderzoeken of herstelpunten die bij dat gebied horen.
  Overzicht en Instellingen openen direct, zonder herhaalde navigatielijst.
- **Database → Gegevens:** bekijk records, zoek, blader en bekijk de gebruikte SQL.
  Gebruik **Rij toevoegen**, of **Bewerken** en **Verwijderen** bij een rij om
  rechtstreeks gegevens te veranderen. Het formulier toont database en tabel;
  verwijderen vraagt bevestiging.
- **Database → Structuur:** lees velden, sleutels, relaties en de echte tabeldefinitie.
- **Database → Schema:** bekijk alle tabellen, kolommen en foreign keys in een interactief
  diagram. Scroll boven de tekening om rond je muisaanwijzer te zoomen en sleep
  de achtergrond om te verschuiven. De tabellenlijst blijft zichtbaar wanneer
  je een tabel kiest; de details staan eronder. Wissel direct naar een andere
  tabel of naar Gegevens en Structuur. Zoeken filtert alleen deze lijst; gebruik
  de aparte verbindingsfilter om het diagram te beperken. Schematools staan
  gegroepeerd boven het werkvlak: weergave, indeling, zoom en hulp. Ze blijven
  bereikbaar als je het paneel inklapt. **Help**
  opent een korte uitleg van alle mogelijkheden in dit scherm.
- **Onderzoeken:** voer SQL uit, bekijk resultaten en bewaar queries met uitleg.
  Schrijf ook `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER` en `DROP`, of maak
  procedures, functies en triggers met `DELIMITER`. Meerdere opdrachten en alle
  resultaatsets van `CALL` blijven samen zichtbaar. Ingrijpende opdrachten vragen
  om bevestiging. De visuele querybouwer gebruikt de leesverbinding.
- **Visueel samenstellen:** kies een tabel, kolommen, filters en een sorteervolgorde.
  Voeg eventueel een bestaande verwijzing naar een tweede tabel toe. Govern maakt
  de SQL zichtbaar; je kunt die daarna zelf aanpassen.
- **Experimenten:** maak een herstelpunt, download het als SQL en zet het terug.
- **Databasevenster:** open de echte phpMyAdmin in een groot venster met de tabs
  **Browse**, **Structure**, **SQL** en **Import**. Hier kun je ook invoegen, aanpassen,
  verwijderen, tabellen ontwerpen, importeren en exporteren.
- **Context exporteren:** neem je databasestructuur en opgeslagen onderzoeken
  mee naar een gesprek met ChatGPT. Tabelrecords en wachtwoorden worden niet
  meegenomen. De opgeslagen SQL en notities zijn wel onderdeel van die export.

De eigen schermen lezen de actuele database. Een nieuwe tabel wordt na verversen
zichtbaar; je hoeft daarvoor geen nieuw onderdeel te programmeren. phpMyAdmin
blijft zijn volledige interface tonen, inclusief functies buiten de drie snelkeuzes.

De rijeditor houdt een lege waarde, `NULL` en de databasestandaard apart.
Berekende velden worden door MariaDB gevuld. Grote of niet-ondersteunde velden
blijven behouden wanneer je een ander veld verandert; binaire velden gebruiken
hexadecimale tekst. Exacte grote getallen worden niet afgerond. Voor wijzigen en
verwijderen is een volledige primaire sleutel of een geschikte unieke sleutel
nodig. Bij views of ontbrekende veilige rij-identiteit open je de officiële
phpMyAdmin via de aangeboden knop. Toevoegen kan ook bij een gewone tabel zonder
sleutel. Als de rij intussen veranderd is, vraagt Govern de actuele rij opnieuw
te laden voordat je verdergaat.

De selectieaanwijzer werkt op gegevens en interfaceonderdelen: ook een knop,
tekst of invoerveld kun je bekijken zonder het te activeren. Het aantal naast
de pijl opent de selectie zonder hover; wissen maakt de selectie leeg. Gebruik
de pijltoetsen en Enter, of Shift + Enter, voor toetsenbordselectie. Escape sluit
eerst de uitleg en verlaat daarna de selectiestand. Scrollen en schemazoom blijven
werken. De aanwijzer inspecteert niet binnen het afzonderlijke phpMyAdmin-frame.
De gewone selectie-uitleg gebruikt beschikbare metadata en roept geen AI-model aan.
**Vraag AI** is een afzonderlijke, optionele handeling met zichtbare context.
Een eventuele recordquery wordt alleen klaargezet, niet automatisch uitgevoerd.

De Database-knop onthoudt tijdens je sessie de laatste weergave en tabel. De
bestaande links naar `#gegevens`, `#structuur` en `#schema` blijven werken.
Iedere databaseweergave gebruikt dezelfde volgorde: een compacte titel, de
weergaveknoppen met je tabelkeuze en daaronder de hulpmiddelen en inhoud.
Met **Tabellen** in de kop open je de lijst opnieuw wanneer die is ingeklapt.
Je tabelkeuze, zoekopdracht en schema-indeling blijven behouden wanneer je
tussen de databaseweergaven wisselt. De hele navigatie kan links of rechts staan;
op een klein scherm open je hetzelfde menu via de navigatieknop.

Taal, uiterlijk en dashboardindeling worden in deze browser bewaard. Je keuzes
blijven bij verversen behouden en veranderen geen databasegegevens. Als de browser
bewaren blokkeert, werkt je keuze voor de huidige sessie en krijg je daar een melding
over. **Uiterlijk herstellen** wist geen onderzoeken of dashboardindeling.

De glasschermen gebruiken gedeelde kleuren, zachte schaduwen en geen harde
paneelranden. Het ontwerp en de regels voor uitbreidingen staan in
[de UX en UI documentatie](docs/DESIGN.md).

## Lokale AI voorbereiden

De AI-interface en backend zijn voorbereid voor een lokale Ollama-installatie.
Govern installeert geen AI-model en toont geen verzonnen antwoord wanneer die
verbinding ontbreekt. **Instellingen → Lokale AI** toont de provider, het
ingestelde model, de status en een verbindingstest.

Het brongebied **Database** gebruikt actuele tabel- en kolominformatie en
beschreven interfaceonderdelen. Records, resultaten en opgeslagen onderzoeken worden niet
automatisch meegestuurd. Zelf getypte vragen en gespreksgeschiedenis gaan naar
de ingestelde lokale provider. Gesprekken en concepten blijven tijdelijk per
database in het open tabblad; herladen begint opnieuw.

**Projectcode → Zoek lokale code** zoekt alleen in de lokale mappen `app/` en
`docs/`. Bestandsnamen, regelnummers en passages blijven zichtbaar; zoeken werkt
ook met AI uit. Met een verbonden model kan dezelfde vraag een uitleg met
gecontroleerde broncitaten krijgen. Zonder passende bronnen zegt Govern dat het
antwoord niet in het project is gevonden. Dit traint het model niet en verwijdert
zijn vooraf geleerde algemene kennis niet. Een geldig citaat bewijst ook niet
automatisch dat alle uitleg juist is. Zie de brongrens in de AI-gids.

Een SQL-voorstel uit Database opent alleen een concept in **Onderzoeken**. Bekijk, wijzig en
voer het daar zelf uit. De AI krijgt geen uitvoerbare databasehandelingen.

Voor het aansluiten van Ollama, `.env`-instellingen, de Windows/Docker-netwerkgrens
en verdere uitbreidingen: [lokale AI en systeemarchitectuur](docs/AI.md).
De gewone werkplek blijft werken met `AI_ENABLED=0`, de standaardinstelling.

## Eerste oefening

1. Open **Database → Gegevens** en kies `digital_systems`.
2. Bekijk de beschrijving van een systeem en de SQL achter het overzicht.
3. Open **Structuur** binnen Database en zoek de verwijzing `evidence_id`.
4. Volg de onderbouwing in `evidence` en de bronkoppeling in `evidence_sources`.
5. Maak bij **Experimenten** een herstelpunt voordat je iets verandert.
6. Ga naar **Gegevens**, kies **Bewerken** bij een rij en pas een beschrijving
   aan. Na bewaren zie je dezelfde wijziging ook in **Databasevenster → Browse**.

Zo leer je met echte gegevens wat een tabel, een verwijzing en een query doen.
De korte uitleg in het scherm is vaste uitleg over deze handeling. De optionele
AI-koppeling vraagt een afzonderlijke vraag en een beschikbare lokale provider.

### Een vraag maken zonder eerst SQL te schrijven

Open **Onderzoeken → Query samenstellen**. Kies `digital_systems`, selecteer
bijvoorbeeld `code` en `name`, en voeg een filter op `name` toe met de waarde
`DigiD`. Met **Query maken** zet je het ontwerp in de SQL-editor. Kies daarna
**Query uitvoeren** om het resultaat te bekijken en **Onderzoek bewaren** om de
vraag opnieuw te kunnen gebruiken.

Zolang je de gegenereerde SQL niet bewerkt, voert Govern het ontwerp uit met
gebonden filterwaarden. Zodra je zelf in de SQL-editor schrijft, gebruik je de
gewone SQL-route. Opgeslagen onderzoeken blijven zelfstandige SQL-vragen; er is
geen tweede bestandstype of apart gegevensmodel voor de bouwer.

De visuele bouwer helpt bij één basistabel en eventueel één bestaande verwijzing.
Voor bijvoorbeeld meerdere koppelingen, groeperingen of berekeningen werk je
verder in de SQL-editor. De voorbeelden in de bouwer hebben dezelfde grens van
200 resultaatrijen als de onderzoekweergave.

### Zelf SQL schrijven

De SQL-editor gebruikt hetzelfde databaseaccount als het phpMyAdmin-venster.
Je kunt de SQL-opdrachten uitvoeren waarvoor dat account rechten heeft op deze
geselecteerde database; er is geen lijst die alleen leesopdrachten toestaat.
Met `USE` of gekwalificeerde tabelnamen kan SQL ook een andere database raken
waarvoor datzelfde account rechten heeft. Bestanden
importeren en serverbeheer blijven aparte mogelijkheden van de officiële tool
en de beschikbare databaserechten.

Eén klik op **Query uitvoeren** gebruikt één tijdelijke databasesessie. Zet een
hele transactie, inclusief `COMMIT` of `ROLLBACK`, in dezelfde uitvoering.
Variabelen en tijdelijke tabellen bestaan alleen tijdens die uitvoering.
Een nog open transactie wordt aan het einde teruggedraaid en krijgt een melding.
DDL kan zelf committen en is geen algemene terugdraaifunctie.

Je ziet per opdracht de rijen of het aantal gewijzigde rijen, alle resultaatsets
van een procedure en de waarschuwingenteller. Voor de precieze meldingen van een
eerdere stap zet je daar direct `SHOW WARNINGS` in het script. Bij een fout blijven eerdere
resultaten zichtbaar en stoppen latere opdrachten. De voorvertoning bevat
maximaal 200 rijen per resultaatset; die weergavegrens beperkt niet hoeveel
rijen een schrijvende opdracht wijzigt. Na uitvoeren wordt de catalogus ververst
met behoud van je SQL, resultaten en invoerpositie.

## Gegevens en herstelpunten

Eén lokale MariaDB-server kan meerdere werkdatabases bevatten. Opgeslagen
onderzoeken staan per database in `_govern_queries`; phpMyAdmin bewaart zijn
gedeelde instellingen in de oorspronkelijke `DB_NAME`-database. Tabellen met
het voorvoegsel `_govern_` blijven via phpMyAdmin bereikbaar. De gewone
gegevensschermen laten de inhoudelijke tabellen zien.

De database staat in een Docker-volume en blijft behouden bij stoppen of opnieuw
opbouwen van de containers. Dat volume is geen terugdraaifunctie. Herstelpunten
zijn afzonderlijke SQL-exports met een controlegetal en tijdstip.
Iedere database heeft een eigen lijst; een herstelpunt uit de ene database
kan niet via de herstelknop op een andere worden toegepast.

Bij herstellen typ je de databasenaam. Govern maakt eerst een veiligheidskopie
van de huidige toestand en zet daarna het gekozen herstelpunt terug. Ook tabellen
die je na dat herstelpunt toevoegde, verdwijnen uit de herstelde database.
Als de database al verwijderd is, kan er geen veiligheidskopie meer van die
toestand worden gemaakt. Het gekozen herstelpunt blijft wel beschikbaar.

Voer tijdens een export of herstel geen opdrachten uit in een ander
phpMyAdmin-venster. De eigen API-acties worden over alle databases onderling
vergrendeld; een al
lopende externe SQL-opdracht wordt daarmee niet automatisch stilgezet.
Een tabelwijziging is niet altijd terug te draaien met een SQL-transactie.

Download belangrijke herstelpunten naar een andere map of schijf. De knop
**Herstellen** werkt met de door deze installatie gemaakte herstelpunten.
Andere SQL-bestanden kun je via phpMyAdmin importeren.

### Bestaande gegevens

Bij de eerste start wordt het eerder gemaakte Bestuursatlas-ontwerp ingeladen:
23 inhoudelijke/ondersteunende tabellen, 3 views en 96 voorbeeldrecords. Het
automatische auditlog is in deze basisvulling niet geactiveerd.

Eigen wijzigingen uit je eerdere phpMyAdmin-installatie worden niet automatisch
overgenomen. Exporteer die database als je ze mee wilt nemen. Maak vóór een
vervangende import een herstelpunt van de Docker-database en controleer in
phpMyAdmin welke database geselecteerd is.

Een bestaande Docker-database wordt bij herstart niet opnieuw gevuld. Gewijzigde
startwachtwoorden worden door MariaDB ook niet automatisch op bestaande accounts
toegepast. Bewaar daarom je lokale `.env` bij deze installatie.

## Stoppen en opnieuw starten

Vanuit de projectmap:

```sh
docker compose stop
docker compose up -d
```

Na wijzigingen aan de PHP-image of de meegebouwde bronbestanden:

```sh
docker compose up -d --build
```

Gebruik `docker compose logs --tail=100` om een startfout te bekijken. Verwijder
geen volumes om een gewone startfout op te lossen; daar staan je gegevens.

## Een nieuwe versie ophalen

Werk bij in dezelfde projectmap. Download de nieuwe ZIP van GitHub en kopieer de
projectbestanden over de oude versie. **Bewaar je bestaande `.env`**: daarin staan
de wachtwoorden die bij jouw bestaande database horen. Start daarna opnieuw met
`start.cmd` of `sh start.sh`. Je database en herstelpunten blijven in hun bestaande
Docker-volumes staan; de eerste voorbeeldimport wordt niet opnieuw uitgevoerd.

Werk je al met Git, dan kun je vanuit deze map `git pull --ff-only` gebruiken en
daarna hetzelfde startbestand uitvoeren. Heb je zelf code aangepast, bewaar of
combineer die wijzigingen voordat je projectbestanden vervangt.

Werk je bij vanaf een versie zonder dynamische proxy-adressen? Voer na het
starten eenmalig `docker compose restart gateway` uit om de nieuwe
Nginx-instellingen te laden. Dit verwijdert geen databases of volumes.

## Samen verder bouwen

De broncode blijft klein en rechtstreeks te volgen:

- `app/src/`: verbindingen, catalogus, onderzoeken en herstelpunten.
- `app/public/api.php`: HTTP-ingang met een vast JSON-formaat.
- `app/public/assets/`: herbruikbare browseronderdelen en stijlen.
- `docker/`: de lokale omgeving en de Bestuursatlas-startgegevens.
- `tests/`: controles van echte gebruikershandelingen.
- `docs/`: afspraken, uitleg en de API.

Begin bij [de architectuur](docs/ARCHITECTURE.md) en
[leren met Govern](docs/LEARNING.md). De optionele AI-stroom staat bij
[lokale AI](docs/AI.md). De uitgevoerde controles en commando's om
ze te herhalen staan bij [validatie](docs/VALIDATION.md). Het systeem is een gewone PHP-app met
JavaScriptmodules en SQL. De gegevens zitten niet vast in een eigen bestandstype
of een verzameling aparte services per onderwerp.

## Toegang

De ingang is alleen aan `127.0.0.1` gekoppeld. Dit is een persoonlijke lokale
werkplek zonder bezoekersaccounts. Iedereen die jouw lokale ingang kan gebruiken,
kan werkdatabases toevoegen en de toegestane werkdatabases beheren. De phpMyAdmin-verbinding heeft rechten
voor de expliciet ingeschakelde databases en eventueel eerder verleende rechten;
Govern voegt geen globale serverrechten toe. Verwijderen uit `DB_DATABASES`
trekt bestaande rechten niet automatisch in.

De **visuele querybouwer** gebruikt een apart databaseaccount met leesrechten.
Vrije SQL in **Onderzoeken** en het databasevenster gebruiken het schrijfaccount
voor de toegestane databases. Vrije SQL vraagt bevestiging voor ingrijpende opdrachten;
eerdere opdrachten in een script kunnen al zijn uitgevoerd als een latere faalt.

De interface en configuratie zijn niet bedoeld om rechtstreeks openbaar op
internet te zetten. Voor delen of publiceren hoort eerst authenticatie en een
passende toegangsconfiguratie te worden toegevoegd.
