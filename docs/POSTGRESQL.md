# PostgreSQL in Govern

Govern kan naast MariaDB een optionele lokale PostgreSQL-verbinding tonen.
Deze eerste versie laat tabellen, records, kolommen, indexen en relaties zien
in dezelfde werkplek. Ze ondersteunt zoeken, bladeren en records verkennen, maar nog geen wijzigen,
vrije SQL, opgeslagen onderzoeken, import, herstelpunten, context-export of AI
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
```

Start daarna vanuit de Govern-map:

```powershell
.\start.cmd
```

Op macOS/Linux gebruik je `sh start.sh`. De scripts genereren ontbrekende
`PG_READ_PASSWORD` en `PG_ADMIN_PASSWORD` in je lokale `.env` en schakelen het
Compose-profiel `postgres` in. Bewaar die wachtwoorden bij een bestaande
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
één transactie en geeft het webaccount alleen leesrechten op de voorbeelden.
Normaal starten laadt de voorbeelden niet automatisch.

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
beschikbaar. De database- en leesrolnamen gebruiken letters, cijfers en
underscores; schema-identifiers blijven afzonderlijk gequote.

De lezer krijgt toegang tot de expliciet ingestelde, bestaande schema's en
SELECT op hun tabellen. Opstarten controleert die rechten opnieuw; bestaande
rolwachtwoorden worden niet stil vervangen. Standaardrechten voor nieuwe
tabellen gelden voor de bootstrapbeheerder. Tabellen die een andere eigenaar
later toevoegt, vereisen passende SELECT-rechten voor het leesaccount.

Het bootstrapwachtwoord hoort alleen bij de PostgreSQL-container en de
afzonderlijke opstartservice voor leesrechten. Het komt niet in de webapp.
De webapp verbindt met `PG_READ_USER`/`PG_READ_PASSWORD` en gebruikt een
read-only sessie. Aanmelden bij Govern blijft hetzelfde installatieaccount
gebruiken; PostgreSQL creëert geen nieuwe gebruikerstenants.

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

Een volgende fase kan PostgreSQL-SQL en rijbewerking toevoegen met eigen
rechten, transacties en conflictcontrole. Import/export en herstel vragen
PostgreSQL-specifieke hulpmiddelen en een echte herstelproef. Totdat die paden
zijn gebouwd en gecontroleerd, blijven hun controls en API-acties uitgeschakeld.

De gerichte controles gebruiken een afzonderlijke testdatabase met twee
schema's, samengestelde sleutels en verschillende gegevenstypen. Werkelijke
testuitslagen en omgevingsgrenzen staan in [VALIDATION.md](VALIDATION.md).
