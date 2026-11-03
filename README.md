# Govern

Je persoonlijke werkplek om databases te bekijken, begrijpen en veranderen.
Bestuursatlas is het eerste oefenproject. Je werkt lokaal in je browser,
eventueel met een begeleidend venster op een tweede scherm.

## Beginnen

Installeer en start Docker Desktop. Download deze repository en pak de map uit.

- **Windows:** dubbelklik op `start.cmd`.
- **macOS / Linux:** open een terminal in deze map en voer `sh start.sh` uit.

De eerste start haalt de onderdelen op, maakt lokale wachtwoorden aan en vult
een nieuwe database met de Bestuursatlas. Open daarna
[http://localhost:8080](http://localhost:8080).

De startpagina laat zien wat Govern doet. Kies **Create account** om een account
voor deze installatie te maken. Het eerste account wordt de eigenaar en opent
meteen de werkplek. Volgende accounts wachten op goedkeuring; de eigenaar regelt
dat via **Account → Access requests**. Daarna kun je inloggen, de werkplek openen
en via Account weer uitloggen. De startpagina, accountschermen en werkplek
ondersteunen Nederlands en Engels.

Je hoeft PHP, Node, Composer, MariaDB of PostgreSQL niet zelf te installeren. Docker Compose
moet de optie `--wait` ondersteunen; een actuele Docker Desktop bevat die. Je bestaande
database buiten Docker wordt niet aangeraakt. De wachtwoorden staan alleen in
je lokale `.env`, die niet in Git wordt opgenomen.

## Startpagina en lokale accounts

- `/`: de publieke startpagina met een duidelijk gemarkeerde voorbeeldwerkplek
  en Docker-startinstructies. De voorbeelden voeren geen SQL uit.
- `/workspace.php`: de bestaande databasewerkplek, na inloggen. Bestaande
  `/#gegevens`, `/#schema`, `/#onderzoeken` en andere werkpleklinks blijven hun
  route en databaseparameter behouden.
- `/auth.php?mode=register` en `/auth.php?mode=login`: account maken en inloggen.
- `/account.php`: accountgegevens, uitloggen en voor de eigenaar openstaande
  toegangsverzoeken goedkeuren.

Accounts horen bij één Docker-installatie. Een goedgekeurd account krijgt
dezelfde toegang tot de toegestane MariaDB-werkdatabases als de eigenaar: bekijken,
wijzigen, SQL uitvoeren en herstelpunten beheren. Het account maakt geen
afzonderlijke privéomgeving of eigen database. Keur daarom alleen mensen goed
die je deze toegang wilt geven. Je kunt ook een eigen Govern-installatie starten.

Wachtwoorden worden met Argon2id gehasht. De accounts staan in het afzonderlijke
Docker-volume `account_data`, buiten de webroot en buiten SQL-herstelpunten van
werkdatabases. Bewaar dat volume als je accounts wilt behouden. Bestaande
databasevolumes, SQL, onderzoeken en herstelpunten worden door deze uitbreiding
niet vervangen.

Een sessie duurt maximaal twaalf uur en eindigt ook bij uitloggen of verlies van
de browsersessie. Inloggen en registreren hebben een tijdelijke pogingenlimiet.
E-mail is een inlognaam; deze versie verstuurt geen verificatie- of herstelmail
en heeft geen wachtwoordherstel. Bewaar het wachtwoord van het eigenaarsaccount.
De taal- en uiterlijkvoorkeuren blijven bij de browser, zonder accountsynchronisatie.

## PostgreSQL gebruiken

PostgreSQL is een optionele tweede verbinding. De bestaande tabelverkenner,
structuurweergave, het schemadiagram en de recordkaart kunnen PostgreSQL-
gegevens en relaties tonen. Deze versie ondersteunt alleen lezen en zoeken; wijzigen,
vrije SQL, import, herstelpunten en AI zijn voor PostgreSQL nog niet beschikbaar.
phpMyAdmin blijft alleen bij de MariaDB-verbinding horen.

1. Open `.env` in de Govern-map en zet `PG_ENABLED=1`.
2. Bewaar de standaardwaarden `PG_DATABASE=govern_pg` en `PG_SCHEMAS=public`,
   of kies de bestaande schema's die je wilt tonen, gescheiden door komma's.
3. Start opnieuw met `.\start.cmd` in PowerShell, of `sh start.sh` op macOS/Linux.
4. Log in en kies bovenaan de vermelding **govern_pg · public · PostgreSQL**.

De startbestanden maken ontbrekende PostgreSQL-wachtwoorden aan en starten
het optionele Docker-profiel. De nieuwe database is aanvankelijk leeg;
Govern importeert geen MariaDB-gegevens automatisch. PostgreSQL gebruikt een
eigen volume. De webapp krijgt alleen het afzonderlijke leesaccount.

Wil je meteen tabellen en relaties bekijken? Voer na het starten in PowerShell
vanuit de Govern-map uit:

```powershell
.\load-postgres-demo.cmd
```

Op macOS/Linux gebruik je `sh load-postgres-demo.sh`. Dit voegt vijf gekoppelde
voorbeeldtabellen met 39 fictieve records en één overzichtsview toe aan `public`.
Klik daarna op **Refresh** in Govern en kies de PostgreSQL-verbinding.

Onder **Database → Explore** kies je een startrecord en volg je echte
verbindingen op een flexibel canvas. De bronbibliotheek, kaart en inspecteur
werken met dezelfde selectie. Vragen bij een geselecteerd record helpen om een
verbonden tabel te bekijken; technische sleutels en SQL blijven onder Details.
Dit blijft volledig alleen lezen.

Met **Open in venster / Open in window** kun je meerdere records naast elkaar
bekijken. Sleep de titelbalk om ze te verplaatsen. Elk venster houdt zijn eigen
database en record vast. De [gedeelde vensterlaag](docs/MODALS.md) houdt bediening,
inhoud en gegevens ophalen apart voor nieuwe uitbreidingen.

Met **Tweede scherm / Second screen** open je een apart browservenster voor
je monitor. Zet maximaal vier records vast op de **Comparison desk** of laat
de **Relationship radar** je hoofdselectie volgen. Vastgezette bronnen blijven
staan als je verder navigeert. Zie [Een tweede scherm voor Govern](docs/COMPANION.md).

Meer over configuratie, schema's en de volgende bouwfasen:
[PostgreSQL in Govern](docs/POSTGRESQL.md).

## Records en verbanden verkennen

Database heeft drie vaste hoofdtaken: **Records**, **Explore** en **Schema**.
Records is voor gewone tabelrijen en bewerken; Explore is voor verbindingen
tussen echte records. Schema groepeert tabeldetails en het schemadiagram.
Onder **Database → Tools** staan import/export via phpMyAdmin en herstelpunten.
Onderzoeken blijft de plek voor de querybouwer, SQL en opgeslagen onderzoeken.

Open **Database → Explore** (`#verkennen`). Oude `#verbanden`-links openen
hetzelfde werkvlak. Open de bronbibliotheek, kies een tabel en zoek of blader
naar een beginrecord. Vanuit de inspecteur vouw je inkomende of uitgaande
verwijzingen uit; bij meer resultaten laad je bewust de volgende pagina.

- Sleep recordkaarten of verschuif de achtergrond. Gebruik zoom en passend maken
  om je werk te bekijken.
- Kies **Orbit**, **Flow** of **Manual** voor de indeling. Vastgezette kaarten
  houden bij opnieuw indelen hun positie. Uitbreiden verplaatst bestaande
  kaarten niet.
- Gebruik **Shift + klik** voor meerdere kaarten. Verbergen, vastzetten en Undo
  veranderen alleen je canvas; **Clear map** begint een nieuwe geladen kaart.
- Open, verplaats, verbreed of verberg de bronbibliotheek en inspecteur. Op mobiel
  is steeds één lade open. Vragen en technische details horen bij je selectie.
- **View row** leest precies het geselecteerde bronrecord opnieuw uit in Records.
  Een lijn laat de foreign key, kolomparen, sleutels en gebruikte SQL zien.

Dezelfde Explore-werkplek werkt met MariaDB en PostgreSQL binnen de gekozen
scope. Views of tabellen zonder ondersteunde sleutel krijgen een duidelijke
melding. Een lege database blijft leeg totdat je zelf gegevens toevoegt of de
expliciete voorbeeldlader uitvoert; de werkplek verzint geen records of relaties.

Kaart, selectie en indeling blijven tijdens deze browsersessie per verbinding,
database en schema apart. Recordgegevens gaan niet naar browseropslag. Zie
[de uitleg van Explore](docs/RECORD_MAP.md).

## Een andere database kiezen of toevoegen

De compacte bovenbalk houdt de databasekiezer en **Database openen / Open
database** zichtbaar. Onder **Gereedschap / Tools** staan de selectieaanwijzer,
het tweede scherm, de AI-assistent, verversen, context exporteren, databases
toevoegen/importeren, taal en Account. Klik buiten het menu of druk op Escape
om het te sluiten. De verbindingsstatus staat als stip bij de databasekiezer;
de volledige status blijft beschikbaar via de tooltip en schermlezer.

Kies bovenaan je database. De tabelverkenner, schemaweergave, onderzoeken,
context-export en herstelpunten volgen die keuze. Je onderzoeksconcept en
tabelkeuze blijven tijdens deze browsersessie per database behouden; de keuze
geldt alleen voor dit browsertabblad.

Gebruik **Gereedschap → Database toevoegen of importeren**. Je hoeft
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

De volledige functies hieronder gelden voor MariaDB. Voor PostgreSQL geldt
de hierboven beschreven eerste versie met alleen bekijken en zoeken.

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
- **Eén menu:** kies Overzicht, Database of Onderzoeken in de hoofdbalk.
  Instellingen staat onderaan. Database houdt de volgorde Records, Explore,
  Schema aan. Explore gebruikt één zwevende bronbibliotheek; de andere
  databaseweergaven gebruiken de bestaande tabellenlijst. Onderzoeken toont
  opgeslagen onderzoeken in zijn contextpaneel.
- **Database → Records:** bekijk records, zoek, blader en bekijk de gebruikte SQL.
  Gebruik **Rij toevoegen**, of **Bewerken** en **Verwijderen** bij een rij om
  rechtstreeks gegevens te veranderen. Het formulier toont database en tabel;
  verwijderen vraagt bevestiging.
- **Database → Schema → Table details:** lees velden, sleutels, relaties en de echte tabeldefinitie.
- **Database → Explore:** volg verbindingen tussen echte records, vouw
  verwijzingen uit en inspecteer de bron achter iedere lijn. Verplaats of pin
  kaarten, kies een indeling en gebruik vragen bij je selectie. Deze leesweergave
  is ook beschikbaar voor PostgreSQL.
- **Database → Schema → Diagram:** bekijk alle tabellen, kolommen en foreign keys in een interactief
  diagram. Scroll boven de tekening om rond je muisaanwijzer te zoomen en sleep
  de achtergrond om te verschuiven. De tabellenlijst blijft zichtbaar wanneer
  je een tabel kiest; de details staan eronder. Wissel direct naar een andere
  tabel of naar Records en Table details. Zoeken filtert alleen deze lijst; gebruik
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
- **Database → Tools → Backups:** maak een herstelpunt, download het als SQL en zet het terug.
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

1. Open **Database → Records** en kies `digital_systems`.
2. Bekijk de beschrijving van een systeem en de SQL achter het overzicht.
3. Open **Schema → Table details** binnen Database en zoek de verwijzing `evidence_id`.
4. Volg de onderbouwing in `evidence` en de bronkoppeling in `evidence_sources`.
5. Maak bij **Database → Tools → Backups** een herstelpunt voordat je iets verandert.
6. Ga naar **Records**, kies **Bewerken** bij een rij en pas een beschrijving
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

Gebruik bij deze update het startbestand. Na een geslaagde Compose-start test
het startbestand de Nginx-configuratie en herlaadt het ook een al bestaande
gateway. Zo gelden de nieuwe sessiecontroles ook voor phpMyAdmin. Mislukt de
start, configuratiecontrole of herlaadactie, dan stopt het script alleen de
gateway en geeft het een fout. De volumes blijven behouden. Los de gemelde fout
op en voer het startbestand opnieuw uit.

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

De ingang is alleen aan `127.0.0.1` gekoppeld. De startpagina en accountformulieren
zijn zonder sessie bereikbaar. Een goedgekeurd account is nodig voor de werkplek,
alle gegevens-API's en de officiële phpMyAdmin, ook bij rechtstreeks openen.
Een goedgekeurde gebruiker kan werkdatabases toevoegen en de toegestane
werkdatabases beheren. De phpMyAdmin-verbinding heeft rechten
voor de expliciet ingeschakelde databases en eventueel eerder verleende rechten;
Govern voegt geen globale serverrechten toe. Verwijderen uit `DB_DATABASES`
trekt bestaande rechten niet automatisch in.

De **visuele querybouwer** gebruikt een apart databaseaccount met leesrechten.
Vrije SQL in **Onderzoeken** en het databasevenster gebruiken het schrijfaccount
voor de toegestane databases. Vrije SQL vraagt bevestiging voor ingrijpende opdrachten;
eerdere opdrachten in een script kunnen al zijn uitgevoerd als een latere faalt.

De accountfunctie maakt deze lokale configuratie niet geschikt voor rechtstreeks
publiceren op internet. Daarvoor zijn onder meer een afzonderlijke beoordeling
van hosting, HTTPS, toegang en accountherstel nodig. De geleverde configuratie
houdt de loopbackbinding en bestaande databasegrenzen aan.
