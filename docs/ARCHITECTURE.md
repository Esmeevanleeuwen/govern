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
een DDL-import kan een gedeeltelijke toestand achterlaten: de veiligheidskopie
blijft dan beschikbaar voor herstel. Een succesvolle procedure wordt niet als
een universele SQL-undo gepresenteerd.

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

## Bronnen voor de infrastructuur

- [Docker Compose](https://docs.docker.com/compose/)
- [Docker volumes](https://docs.docker.com/engine/storage/volumes/)
- [phpMyAdmin Docker-installatie](https://docs.phpmyadmin.net/en/latest/setup.html#installing-using-docker)
- [phpMyAdmin-configuratie](https://docs.phpmyadmin.net/en/latest/config.html)
- [MariaDB SQL-exports](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump)
