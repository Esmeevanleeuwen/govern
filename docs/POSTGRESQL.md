# PostgreSQL in Govern

Govern kan naast MariaDB een optionele lokale PostgreSQL-verbinding tonen.
Deze eerste versie laat tabellen, records, kolommen, indexen en relaties zien
in dezelfde werkplek. Ze ondersteunt zoeken en bladeren, maar nog geen wijzigen,
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
