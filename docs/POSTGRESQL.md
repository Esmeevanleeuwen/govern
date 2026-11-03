# PostgreSQL in Govern

Govern kan naast MariaDB een optionele lokale PostgreSQL-verbinding tonen.
Dezelfde werkplek laat tabellen, records, kolommen, indexen en relaties zien.
Je kunt zoeken, bladeren, records verkennen en via **Records** rijen toevoegen,
bewerken en verwijderen. Vrije SQL, opgeslagen onderzoeken, import, herstelpunten,
context-export en AI zijn nog niet beschikbaar
voor PostgreSQL. phpMyAdmin blijft alleen voor MariaDB beschikbaar.

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
```

Start daarna vanuit de Govern-map:

```powershell
.\start.cmd
```

Op macOS/Linux gebruik je `sh start.sh`. De scripts genereren ontbrekende
`PG_READ_PASSWORD`, `PG_PASSWORD` en `PG_ADMIN_PASSWORD` in je lokale `.env`.
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

Het bootstrapwachtwoord hoort alleen bij de PostgreSQL-container en de
afzonderlijke opstartservice voor applicatierechten. Het komt niet in de webapp.
Lezen gebruikt `PG_READ_USER`/`PG_READ_PASSWORD` in een read-only sessie; directe
rijbewerkingen gebruiken `PG_USER`/`PG_PASSWORD` in een aparte schrijfsessie.
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

Een volgende fase kan vrije PostgreSQL-SQL toevoegen. Import/export en herstel
vragen PostgreSQL-specifieke hulpmiddelen en een echte herstelproef. Totdat die paden
zijn gebouwd en gecontroleerd, blijven hun controls en API-acties uitgeschakeld.

De gerichte controles gebruiken een afzonderlijke testdatabase met twee
schema's, samengestelde sleutels en verschillende gegevenstypen. Werkelijke
testuitslagen en omgevingsgrenzen staan in [VALIDATION.md](VALIDATION.md).
