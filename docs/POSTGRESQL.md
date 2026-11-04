# PostgreSQL in Govern

Govern kan naast MariaDB een optionele lokale PostgreSQL-verbinding tonen.
Dezelfde werkplek laat tabellen, records, kolommen, indexen en relaties zien.
Je kunt zoeken, bladeren, records verkennen en via **Records** rijen toevoegen,
bewerken en verwijderen. **Onderzoeken** voert vrije SQL uit. Via **Database toevoegen** start je een nieuwe
database of import; **Gegevens toevoegen** werkt binnen een bestaande database.
**Backups** beheert de schemaherstelpunten. De visuele
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
**govern_pg · PostgreSQL** in de databasekiezer. Een nieuwe PostgreSQL-
database is leeg. Deze uitbreiding zet geen MySQL-dumps automatisch om en
importeert de voorbeeldgegevens van Bestuursatlas niet naar PostgreSQL.

Blijft na een update de melding **Choose a database available to this connection**
staan? Herlaad de werkplek met **Ctrl+Shift+R** (Mac: **Cmd+Shift+R**) en kies de
PostgreSQL-verbinding opnieuw. Een oudere browsermodule kan nog in de cache
staan. De API ondersteunt ook de volledige scopesleutel die deze module stuurt,
met dezelfde controle op de toegestane database en schema's.

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

Klik na het laden op **Refresh** in Govern. Kies de PostgreSQL-database en het
schema `public`, open **Database → Records** en selecteer bijvoorbeeld `demo_systems`.
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

## Een database aanmaken of importeren

**Database toevoegen / Add database** begint met drie verschillende taken:
**Lege database maken / Create an empty database**, **Databasebackup importeren /
Import a database backup** en **Dataset importeren / Import a dataset**.
Bij een lege database kies je de engine en de echte nieuwe naam. De eindactie
maakt die lege database aan; daarna kun je haar openen en met de native
**Eerste tabel toevoegen / Add your first table** een ondersteunde tabel maken.
Bij beide imports kies je eerst het bestand. Een backup bepaalt het compatibele
SQL-dialect; een dataset kan naar PostgreSQL of MariaDB. Daarna volgen de nieuwe
naam, tabelnamen waar nodig, het voorbeeld en één benoemde eindactie.

Een globale import maakt een werkelijk nieuwe database. Een bezette naam wordt
geweigerd: geen stille overname, overschrijving of merge. Het naamveld is de echte
nieuwe naam; opnieuw typen als extra bevestiging is niet nodig. Bestaande
databases open je met de normale kiezer. **Gegevens toevoegen / Add data** binnen
zo'n database hergebruikt de datasetstroom met engine, database en schema vast.
Je kiest een nieuwe tabel of expliciete append-koppelingen. Gewone Add data
heeft geen vervangingsoptie. Herstellen blijft onder **Backups**.

SQL-backups zijn beperkt tot ondersteunde UTF-8-tekst van maximaal 256 KiB.
Een `.sql`-extensie bewijst geen compatibiliteit. Bij twijfel vraagt Govern de
bronengine. `psql`-opdrachten, inline `COPY ... FROM STDIN`, PostgreSQL custom-
archieven (`PGDMP`) en niet veilig naar het nieuwe doel verwijzende database-
selecties worden geweigerd. Exporteer opnieuw naar de ondersteunde subset; er
is geen automatische MariaDB-naar-PostgreSQL-conversie of globale naamvervanging.
De SQL-editor en oudere compatibele API-routes houden hun eigen grenzen; ze
zijn geen extra gewone importkeuze in de nieuwe bediening.

Datasetwaarden blijven exacte tekst of NULL. Postcodes als `00123` worden niet
automatisch getallen. Lege CSV-cellen blijven standaard lege tekst; JSON null en
ontbrekende velden worden NULL. Leeg-naar-NULL-regels, overgeslagen kolommen,
bladkeuze en doelkoppelingen staan expliciet in het voorbeeld. Nieuwe tabellen
krijgen een aparte gegenereerde rij-identiteit, zonder afgeleide foreign keys of
ontdubbeling. De lezer is begrensd op 16 MiB, 100.000 rijen en 256 kolommen.
Append controleert de doelstructuur en beperkingen opnieuw; een verouderd plan
moet opnieuw worden bekeken.

De laatste actie bewaart een taak buiten de werkdatabase. De aparte
`import-worker` controleert opnieuw of het account actief is en voert één
vastgelegde poging uit. Na herladen lees je de bewaarde voortgang; SQL wordt
niet opnieuw ingezonden. De inzendingssleutel voorkomt een dubbele geaccepteerde
inzending, maar maakt willekeurige SQL niet algemeen exact eenmaal uitvoerbaar.
Voortgang noemt echte fasen en bekende aantallen. Stop aanvragen belooft geen
rollback of onmiddellijke onderbreking van een actieve databaseopdracht.
Gedeeltelijk en Onbekend blijven verschillende uitkomsten; na een onzekere
uitvoering wordt SQL niet automatisch herhaald en een achtergebleven nieuwe
database blijft inspecteerbaar.

Bronbestanden en taakmetadata staan privé in `import_data`, buiten de webroot.
Niet-ingezonden bronnen verlopen na 24 uur. Na voltooiing, gedeeltelijk resultaat,
fout of bevestigde annulering vervalt de bron uiterlijk na nog 24 uur, met een
harde bovengrens van zeven dagen vanaf upload. Bronverwijdering verwijdert geen
geïmporteerde database en is geen undo. Bewaar belangrijke database-exports
bewust als backup; een tijdelijke importbron is geen herstelpunt.

## Herstelpunten van één schema

Open **Database → Tools → Backups** en geef het punt een herkenbare naam.
Het punt hoort bij de gekozen database én het schema. De download is een
PostgreSQL custom-archief (`.dump`), geen `.sql`-tekst en geen Docker-volume.
Bewaar belangrijke downloads op een andere plek. Deze interface herstelt de
punten van deze installatie; ze is geen algemene uploadroute voor dumpbestanden.
De privéservice ondersteunt ook later toegevoegde databases wanneer zowel de
gewone lezer als schrijver expliciete CONNECT-rechten hebben. PUBLIC CONNECT
alleen is onvoldoende. Een gelijknamig schema in een andere database blijft
een ander doel; de kopie bindt database én schema.

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

`PG_DATABASE` blijft de standaard en eerste bestaande PostgreSQL-database.
`PG_DATABASES` kan desgewenst extra geconfigureerde namen bevatten die ook bij
onbereikbaarheid herkenbaar blijven. Daarnaast ontdekt Govern toegankelijke
werkdatabases via expliciete CONNECT-rechten voor zowel de lezer als schrijver.
Een nieuwe database verschijnt dus zonder `.env`-wijziging of herstart.
Systeemdatabases en alleen via PUBLIC zichtbare namen worden geen werkkeuze.

Elke database staat één keer in de hoofdkiezer, met PostgreSQL als enginebadge.
Het schema is een afzonderlijke, secundaire keuze. `PG_SCHEMAS` begrenst de
schema's van de oorspronkelijke database, bijvoorbeeld `public,archive`.
Nieuwe databases beginnen in `public`, dat voor die nieuwe doelen expliciet
beschikbaar is. Andere ingestelde schema's zijn pas beschikbaar als ze bestaan
en leesbaar zijn. Opstarten vult geen ontbrekende schema's met voorbeelden.
Oude expliciete scopesleutels zoals `postgres:govern_pg:archive` blijven werken;
concepten, caches en verzoeken blijven per database én schema gescheiden.

Aanmaken gebruikt de privéservice voor een vast gevalideerd engine-, naam- en
operatie-ID-verzoek. Die service krijgt geen SQL, browserpaden of algemene
beheertaken. Een private, duurzame ontvangstregistratie maakt alleen dezelfde
bekende poging herhaalbaar. Een bezette naam wordt geweigerd. Bij een onzekere
onderbreking na databaseaanmaak mag de service een bestaand doel niet adopteren:
de uitkomst vraagt inspectie. Bestaande data en wachtwoorden blijven behouden.

Het bootstrapwachtwoord hoort alleen bij PostgreSQL en de privéservices voor
vaste rechten-, aanmaak- en herstelhandelingen; nooit bij webapp of importworker.
Lezen gebruikt `PG_READ_USER` in een read-only sessie; rijbewerkingen gebruiken
`PG_USER`. Gewone vrije SQL gebruikt `PG_SQL_USER`. Een import naar een nieuwe
database gebruikt een afzonderlijk loginaccount met een willekeurig wachtwoord.
Dat account krijgt alleen expliciete aanmaak- en objectrechten in dat doel,
zonder superuser-, rolbeheer- of databaseaanmaakrechten. Het erft geen bredere
applicatierol; credentials blijven server-side. De normale lezer, rijschrijver en
SQL-rol krijgen passende rechten op nieuwe importobjecten. De SQL-rol kan hun
structuur onderhouden zonder beheerder te worden.

PostgreSQL PUBLIC-rechten op andere databases blijven een afzonderlijke
serverinstelling; deze aanmaakhandeling verandert hun bestaande ACL's niet.
De importverbinding blijft aan het nieuwe doel gebonden en voert geen
clientcommando's uit om naar een andere database te verbinden.

`PG_RESTORE_PASSWORD` gaat alleen naar de privéherstelservice met native
PostgreSQL 18-hulpmiddelen. Bij herstart veranderen bestaande rolwachtwoorden en
data niet. Goedkeuring blijft op installatieniveau; meerdere databases maken
geen privétenants voor afzonderlijke gebruikers.

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

De server accepteert alleen geconfigureerde of werkelijk toegankelijke
werkdatabases en hun toegestane schema's. De browser
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
