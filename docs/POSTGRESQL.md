# PostgreSQL in Govern

Govern kan naast MariaDB een optionele lokale PostgreSQL-verbinding tonen.
Dezelfde werkplek laat tabellen, records, kolommen, indexen en relaties zien.
Je kunt zoeken, bladeren, records verkennen en via **Records** rijen toevoegen,
bewerken en verwijderen. **Onderzoeken** voert vrije SQL uit; via **Tools**
kun je bestanden importeren en schemaherstelpunten beheren. De visuele
querybouwer, opgeslagen onderzoeken, context-export en AI zijn nog niet
beschikbaar voor PostgreSQL. phpMyAdmin blijft alleen voor MariaDB beschikbaar.

## Inschakelen

Open `.env` in de projectmap en voeg deze instellingen toe of pas ze aan:

```dotenv
PG_ENABLED=1
PG_HOST=postgres
PG_PORT=5432
PG_DATABASE=govern_pg
PG_SCHEMAS=public
PG_READ_USER=govern_pg_reader
PG_USER=govern_pg_writer
PG_SQL_USER=govern_pg_sql
PG_RESTORE_USER=govern_pg_restore
```

Start daarna vanuit de Govern-map:

```powershell
.\start.cmd
```

Op macOS/Linux gebruik je `sh start.sh`. De scripts genereren ontbrekende
`PG_READ_PASSWORD`, `PG_PASSWORD`, `PG_SQL_PASSWORD`, `PG_RESTORE_PASSWORD` en
`PG_ADMIN_PASSWORD` in je lokale `.env`.
Ze schakelen het Compose-profiel `postgres` in. Bewaar die wachtwoorden bij een bestaande
installatie. De database krijgt een eigen volume; starten vervangt geen
MariaDB-gegevens of bestaande PostgreSQL-tabellen.

Log in op [localhost:8080](http://localhost:8080), open de werkplek en kies
**govern_pg · public · PostgreSQL** in de databasekiezer. Een nieuwe PostgreSQL-
database is leeg. Deze uitbreiding zet geen MySQL-dumps automatisch om en
importeert de voorbeeldgegevens van Bestuursatlas niet naar PostgreSQL.

Blijft na een update de melding **Choose a database available to this connection**
staan? Herlaad de werkplek met **Ctrl+Shift+R** (Mac: **Cmd+Shift+R**) en kies de
PostgreSQL-verbinding opnieuw. Een oudere browsermodule kan nog in de cache
staan. De API ondersteunt ook de volledige scopesleutel die deze module stuurt,
met dezelfde controle op de ingestelde database en schema's.

## Voorbeeldgegevens toevoegen

De optionele voorbeelden gaan over fictieve organisaties, digitale systemen,
projecten en contactpersonen. Start eerst Govern met PostgreSQL ingeschakeld.
Open daarna PowerShell in de Govern-map en voer uit:

```powershell
.\load-postgres-demo.cmd
```

Op macOS/Linux:

```sh
sh load-postgres-demo.sh
```

Het script gebruikt de draaiende PostgreSQL-container en diens ingestelde
database. `PG_SCHEMAS` moet `public` bevatten. De voorbeelden bestaan uit:

| Tabel | Records | Relatie |
| --- | ---: | --- |
| `demo_organizations` | 5 | Fictieve organisaties |
| `demo_systems` | 6 | Een eigenaar per systeem |
| `demo_projects` | 8 | Een systeem en leidende organisatie per project |
| `demo_contacts` | 8 | Contactpersonen per organisatie |
| `demo_project_participants` | 12 | Organisaties die aan projecten deelnemen |

De view `demo_project_overview` combineert de acht projecten met hun systeem
en leidende organisatie. De zes foreign keys zijn zichtbaar in het schemadiagram.
Namen en e-mailadressen zijn verzonnen; bedragen en projectgegevens zijn voorbeelden.

Klik na het laden op **Refresh** in Govern. Kies de PostgreSQL-vermelding met
`public`, open **Database → Data** en selecteer bijvoorbeeld `demo_systems`.
Onder **Schema** zie je de gekoppelde tabellen.

Opnieuw laden behoudt bestaande voorbeeldrecords, ook als je die later buiten
Govern hebt bewerkt. Als er al een ander object met een van deze namen bestaat,
stopt de eerste import voordat gegevens worden toegevoegd. De import gebruikt
één transactie. De aparte lezer houdt leesrechten; het rijschrijfaccount krijgt
via de ingestelde standaardrechten toegang tot de nieuwe voorbeeldtabellen.
Normaal starten laadt de voorbeelden niet automatisch.

## Rijen bewerken

Open **Database → Records**, kies een gewone tabel en gebruik **Rij toevoegen**.
**Bewerken** en **Verwijderen** staan bij rijen met een ondersteunde, volledige
primaire sleutel of unieke sleutel zonder NULL-velden. Het formulier noemt de
vastgelegde database, het schema en de tabel. Verwijderen vraagt bevestiging;
een geopend formulier blokkeert wisselen naar een andere database of een ander
schema.

De editor leest de echte rij opnieuw. Verkorte browsewaarden worden nooit
teruggeschreven. Lege tekst, `NULL` en de databasestandaard blijven verschillende
keuzes; grote getallen blijven exacte tekst en `bytea` gebruikt hexadecimale
invoer zonder `0x`. Berekende velden en niet-ondersteunde of te grote velden
blijven behouden bij wijzigen van andere velden. Defaults en automatisch gevulde
sleutels worden door PostgreSQL ingevuld.

Een wijziging of verwijdering gebruikt een transactie, rijvergrendeling en een
versiecontrole die bij deze database, dit schema, deze tabel en deze rij hoort.
Als de rij intussen gewijzigd is, blijft het formulier staan met de vraag om
opnieuw te laden. Views, materialized views, foreign tables en tabellen met
overervingskinderen zijn hier niet wijzigbaar. Een gewone tabel zonder veilige
rij-identiteit kan wel worden aangevuld; wijzigen en verwijderen vereisen een
geschikte sleutel. phpMyAdmin is geen PostgreSQL-fallback.

## Vrije SQL uitvoeren

Open **Onderzoeken**. Het voorbeeld gebruikt PostgreSQL-quotes en het gekozen
schema. Je kunt meerdere opdrachten uitvoeren, tabellen aanmaken, gegevens
schrijven en transacties of functies met dollarquotes gebruiken. De SQL-sessie
begint in het gekozen schema; gekwalificeerde SQL en `SET search_path` kunnen
ook andere toegestane schema’s raken. De databaserechten bepalen wat lukt.
Bestaande objecten van een andere eigenaar kunnen niet zomaar worden aangepast
of verwijderd. Opstarten verandert hun eigenaar niet.

Eén uitvoering gebruikt één tijdelijke sessie. Zet `COMMIT` of `ROLLBACK` in
dezelfde uitvoering. Een onafgemaakte transactie wordt teruggedraaid; eerder
gecommitteerde opdrachten blijven staan. De bevestiging voor ingrijpende SQL
is een voorcontrole, geen SQL-sandbox. Bekijk na een fout de eerdere resultaten.
Maximaal 256 KiB SQL en 200 voorbeeldrijen per resultaat worden verwerkt.

Bij dynamische quote-instellingen kan de voorcontrole geen exacte telling
geven. Een later gevonden, niet-ondersteunde opdracht stopt de uitvoering;
eerder gecommitteerd werk kan blijven staan.

Dit is een SQL-editor, geen `psql`-terminal: backslashopdrachten, `\copy`,
`COPY ... FROM STDIN` en `COPY ... TO STDOUT` worden niet ondersteund. NOTICE-
meldingen worden niet verzameld. De visuele bouwer en blijvend bewaren van
onderzoeken zijn voor PostgreSQL nog uitgeschakeld. Je concept blijft tijdelijk
per database/schema in het open browsertabblad.

## Bestanden importeren

Open **Database → Tools → Importeren**. De PostgreSQL-tabs zijn **Importeren**
voor UTF-8 `.sql` en **Bestanden importeren** voor CSV/TXT, XLSX, JSON en ZIP-
bundels. Er wordt geen phpMyAdmin-frame voor PostgreSQL geopend.

Bij SQL controleer je eerst een bestand van maximaal 256 KiB. Govern toont de
huidige objecten, een opdrachtentelling en gemarkeerde ingrijpende opdrachten.
Typ vervolgens exact `database.schema`, bijvoorbeeld `govern_pg.public`.
Vóór uitvoering maakt Govern herstelpunten van alle bestaande, ingestelde
schema’s. Mislukt één kopie, dan start de SQL-import niet. SQL kan meerdere
schema’s veranderen; de afzonderlijke kopieën vormen geen algemene rollback.
Na uitvoering blijven de nacontrole en eventuele gedeeltelijke fout zichtbaar.
Gewone PostgreSQL-SQL wordt ondersteund; een willekeurige `pg_dump`-tekst met
`psql`-opdrachten of inline COPY-data kan hier niet worden ingelezen.

Bij tabelbestanden bekijk je eerst het blad, de kolommen, aantallen en voorbeeld-
rijen. Je maakt een nieuwe tabel of voegt toe aan een passende bestaande tabel.
Waarden blijven exacte tekst of NULL; nieuwe tabellen krijgen een bigint-
identitysleutel. Bestanden hebben dezelfde limieten als de bestaande import:
16 MB, 100.000 rijen en 256 kolommen. Er is geen overwrite of automatische
ontdubbeling. De bevestiging is ook hier exact `database.schema`.

## Herstelpunten van één schema

Open **Database → Tools → Backups** en geef het punt een herkenbare naam.
Het punt hoort bij de gekozen database én het schema. De download is een
PostgreSQL custom-archief (`.dump`), geen `.sql`-tekst en geen Docker-volume.
Bewaar belangrijke downloads op een andere plek. Deze interface herstelt de
punten van deze installatie; ze is geen algemene uploadroute voor dumpbestanden.

Herstellen vraagt exact `database.schema`. Govern maakt eerst een veiligheids-
kopie en vervangt daarna in één PostgreSQL-transactie het hele geselecteerde
schema, inclusief het verwijderen van later toegevoegde objecten. Bij een
uitvoerfout wordt die vervanging teruggedraaid. Andere app-acties worden met
één onderhoudslock uitgesloten; externe PostgreSQL-clients volgen die lock niet.
Stop zulke externe wijzigingen voordat je een punt maakt of herstelt.

Inkomende verwijzingen vanuit andere schema’s kunnen door een schemaherstel
verdwijnen. Govern weigert daarom herstel wanneer zulke afhankelijkheden worden
gevonden. Zo’n kopie kan wel worden gemaakt en gedownload; zij biedt dan geen
directe herstelknop in Govern en kan gecoördineerd handmatig herstel vereisen.
Verwijzingen naar buiten het schema moeten bij herstel nog bestaan.
De controle is bewust beperkt tot ondersteunde PostgreSQL-objecten: gewone en
gepartitioneerde tabellen, views, materialized views, sequences, functies/
procedures en gebruikelijke enum-, domein-, composite- en rangetypes. Onder meer
foreign tables, custom aggregates, extensieobjecten en onbekende objectklassen
worden geweigerd. Rollen, extensies, databasebrede instellingen en large objects
horen niet bij een schemaherstelpunt. Een kopie die niet volledig leesbaar is,
bijvoorbeeld door RLS, wordt niet als geslaagd opgeslagen. De archieflimiet is
512 MiB.

Na een herstel horen de objecten in het schema bij het beperkte herstelaccount;
hun oude eigenaar en afwijkende ACL’s worden niet teruggezet. De eigenaar van
een al bestaand schema blijft behouden. De normale lezer-,
rijschrijver- en SQL-rechten worden opnieuw verleend. Het herstelproces logt
werkelijk in als dat beperkte account. Het bootstrapaccount wordt uitsluitend
voor vaste catalogus- en schemabeheerhandelingen gebruikt en voert nooit de
inhoud van een dump uit.

## Records en hun verbindingen verkennen

Open **Database → Explore** (Nederlands: **Verkennen**) en kies via de
bronbibliotheek een tabel en startrecord. Iedere kaart is een echt record;
de lijnen volgen foreign keys uit de actuele database. Het hoofdtabblad
**Schema** groepeert tabeldetails en het schemadiagram.

Kaarten, bronbibliotheek en inspecteur werken met dezelfde selectie. Vanuit
het geselecteerde record vouw je inkomende of uitgaande verwijzingen uit.
Vragen zoals **Show linked …** gebruiken diezelfde verwijzingen. Bij meer
resultaten kies je bewust een volgende pagina. **Show all loaded records**
herstelt de zichtbaarheid van geladen kaarten, zonder de hele database te lezen.

Met **Explore from here** ga je verder vanaf een gekozen record. **View row**
leest precies dat bronrecord opnieuw uit in Records. Sleutels, constraints,
kolomparen en gebruikte SQL zijn beschikbaar onder technische details.

Sleep kaarten, verschuif het werkvlak of gebruik zoom en passend maken.
**Orbit** en **Flow** rangschikken kaarten; vastgezette kaarten houden daarbij
hun positie. **Manual** bewaart je eigen indeling. Shift-selectie, Hide en Undo
horen alleen bij de canvaspresentatie. Zij veranderen geen PostgreSQL-records.
De bibliotheek en inspecteur kunnen bewegen, in breedte veranderen of sluiten;
op mobiel is één lade tegelijk open.

De teller beschrijft geladen records. Een ontbrekende lijn bewijst niet dat de
hele database geen verbinding bevat. Tabellen zonder bruikbare unieke sleutel
blijven in de gewone recordsbrowser beschikbaar. Grootte- en previewgrenzen en
externe verwijzingen blijven zichtbaar als beperking. Scope, selectie en
indeling blijven per database/schema apart; opgehaalde records gaan niet naar
browseropslag.

Met de expliciete voorbeelden kun je **Demo organizations** kiezen, daarna
**Northbridge Council**, en vervolgens een verwijzing naar **Demo systems**
uitvouwen. De inspecteur laat de echte bronkolommen zien; de werkplek vraagt
geen SQL of recordsleutel als invoer. Vragen zijn vaste leesacties en gebruiken
geen AI of gegenereerde antwoorden. Zie [Explore](RECORD_MAP.md).

## Database en schema's

`PG_DATABASE` kiest één PostgreSQL-database voor deze verbinding. `PG_SCHEMAS`
is een lijst met bestaande schema's, gescheiden door komma's, bijvoorbeeld
`public,archive`. De opstartservice maakt geen ontbrekende werkschema's of
tabellen aan. Een ontbrekend schema blijft in de kiezer staan als niet
beschikbaar. De database- en applicatierolnamen gebruiken letters, cijfers en
underscores; schema-identifiers blijven afzonderlijk gequote.

De lezer krijgt toegang tot de expliciet ingestelde, bestaande schema's en
SELECT op hun tabellen. Het afzonderlijke account `PG_USER` krijgt daar SELECT,
INSERT, UPDATE en DELETE op tabellen en USAGE op sequences voor automatisch
gevulde sleutels. Het krijgt geen schema-aanmaak of algemene beheerdersrechten.
Opstarten controleert die rechten opnieuw; bestaande rolwachtwoorden en gegevens
worden niet stil vervangen. Standaardrechten voor nieuwe tabellen en sequences
gelden voor de bootstrapbeheerder. Objecten van een andere eigenaar vereisen
passende rechten voor beide applicatieaccounts.

Het bootstrapwachtwoord hoort alleen bij PostgreSQL en de privéservices voor
rechten en vaste herstelhandelingen. Het komt niet in de webapp. Lezen gebruikt
`PG_READ_USER`/`PG_READ_PASSWORD` in een read-only sessie; rijbewerkingen gebruiken
`PG_USER`/`PG_PASSWORD`. Vrije SQL en imports gebruiken `PG_SQL_USER`/`PG_SQL_PASSWORD`
met DML en CREATE binnen de ingestelde schema’s. Nieuwe SQL-objecten krijgen
standaard passende applicatierechten. `PG_RESTORE_PASSWORD` wordt alleen aan de
privéherstelservice gegeven; die gebruikt de native PostgreSQL 18-hulpmiddelen.
Aanmelden bij Govern blijft hetzelfde installatieaccount gebruiken; PostgreSQL creëert geen nieuwe gebruikerstenants.

## Gedeelde implementatie

`Database` en `Catalog` zijn kleine facades voor MariaDB- en PostgreSQL-adapters.
Beide engines leveren dezelfde metadata aan de bestaande schermen. Alleen
verbindingen, SQL-dialect, identifierquoting en catalogusvragen verschillen.
PostgreSQL-structuurinformatie bevat geen verzonnen volledige `CREATE TABLE`.

API-verzoeken noemen verbinding, database en schema expliciet:

```text
/api.php?action=schema&connection=postgres&database=govern_pg&schema=public
/api.php?action=browse&connection=postgres&database=govern_pg&schema=public&table=example
```

De server accepteert alleen de ingestelde database en schema's. De browser
bewaart een complete scopesleutel voor selectie, verzoeken en diagramindeling.
Zo blijven bijvoorbeeld `public.example` en `archive.example` verschillend,
ook als beide dezelfde tabelnaam hebben. Zie [API.md](API.md) voor het contract.

## Verdere bouwfasen

Volgende fasen kunnen de visuele querybouwer, opgeslagen onderzoeken, bredere
dump-import en extra ondersteunde schemaobjecten toevoegen. Die mogelijkheden
blijven uitgeschakeld zolang hun volledige pad niet is gebouwd en gecontroleerd.

De gerichte controles gebruiken een afzonderlijke testdatabase met twee
schema's, samengestelde sleutels en verschillende gegevenstypen. Werkelijke
testuitslagen en omgevingsgrenzen staan in [VALIDATION.md](VALIDATION.md).
