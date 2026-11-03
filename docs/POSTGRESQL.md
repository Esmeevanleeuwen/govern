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

Open **Database → Explore** (Nederlands: **Verkennen**) en kies een tabel en
startrecord. Een punt in deze grafiek is een echt record. De lijnen volgen
de foreign keys uit de actuele database. Het bestaande tabblad **Schema** blijft
de structuur van tabellen tonen.

Selecteer een punt of een rij in de lijst om hetzelfde record in beide te
markeren. De uitleg toont zijn velden en de bron- en doelwaarden van een
verwijzing. Met **Explore from here** ga je verder vanaf het gekozen record.
Gebruik de relatiekeuzes en het zoekveld om de geladen weergave te beperken.

De eerste versie toont één stap rond het startrecord, met zichtbare grenzen
voor het aantal records en relaties. De teller beschrijft geladen records;
een ontbrekende lijn bewijst niet dat de hele database geen verbinding bevat.
Tabellen zonder bruikbare unieke sleutel blijven in de gewone gegevensbrowser
beschikbaar. Selecteren, zoeken en verder verkennen veranderen geen gegevens.

### Zonder code: Guided / Stap voor stap

Verkennen opent standaard met eenvoudige keuzes. Kies een categorie, kies een
item en gebruik daarna een vraagknop. Met de voorbeeldgegevens kun je bijvoorbeeld:

1. **Demo organizations** en **Northbridge Council** kiezen.
2. **Show Demo systems (2)** kiezen om de geladen systemen en het startitem te zien.
3. **How is another item connected to this one?** openen en **Resident Services Portal** kiezen.
4. **Explain this connection** gebruiken voor een uitleg van de opgeslagen verwijzing.
5. Met **Follow this item** verder kijken vanaf dat systeem.

De vraagknoppen gebruiken de werkelijk geladen records en verbindingen. Het zijn
vaste kijkacties, geen vrije SQL of gegenereerde antwoorden. Aantallen tellen
verschillende gekoppelde items; meerdere verwijzingen tellen een item niet dubbel.
De bestaande grenzen van de geladen buurt blijven zichtbaar.

**Technical details / Technische details** toont op verzoek de originele
databasenaam, volledige sleutel en exacte bronvelden. Leesbare categorienamen
worden uit de identifiers afgeleid; de database en haar inhoud blijven hetzelfde.
**Detailed / Details** geeft de oorspronkelijke bediening terug zonder de
selectie of filters opnieuw in te stellen. De browser bewaart alleen de gekozen
modus. Records en sleutels worden hiervoor niet in browseropslag bewaard.

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
