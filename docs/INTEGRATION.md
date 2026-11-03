# Gezamenlijke Govern-versie

Deze integratie brengt de bestaande functies en de nog losse updates samen op
`integrate/all-govern-updates`. De inventaris van 3 november 2026 omvat alle
30 feature-/updatebranches en de zes open pull requests (#15 tot en met #20).
De bestaande `main` op `d213824` is de basis. Geen van deze branches is verwijderd.

Vier meest recente ontwikkellijnen dekken de veertien nog niet samengevoegde
branchehoofden. Hun geschiedenis blijft behouden via mergecommits:

| Ontwikkellijn | Vastgelegd hoofd | Opgenomen functies |
| --- | --- | --- |
| `feature/animated-overview-orb` | `54441ea` | Accounts, PostgreSQL, voorbeelddata, recordverkenning, losse vensters, tweede scherm, Gereedschap en beweging in Overzicht |
| `feature/flexible-explore-workspace` | `4df4178` | Flexibel canvas, begeleide vragen, recordkaarten en brononderbouwing van verbindingen |
| `feature/native-sql-import-preflight` | `898f0f9` | Eigen SQL-import met voorcontrole, exclusieve onderhoudslock, herstelpunt en nacontrole |
| `feature/dataset-file-import` | `16c04c6` | CSV/TXT, XLSX en JSON bekijken en importeren in MariaDB |

## Aansluitingen tussen de functies

- Explore gebruikt één canvas. Van daaruit blijven losse recordvensters,
  vergelijking en de radar op het tweede scherm bereikbaar. Een selectie uit
  dat tweede scherm keert terug naar het actuele canvas met dezelfde database,
  hetzelfde schema en de exacte recordsleutel.
  De nieuwe vensters gebruiken een onafhankelijke scopeparser, zodat ook een
  browser met het oude gecachete API-bestand de werkplek kan blijven openen.
- Een geselecteerde SQL-uitkomst blijft herkenbaar bij een taal- of andere
  presentatiewijziging. Een nieuwe uitvoering met dezelfde waarden houdt een
  eigen snapshot; oude selecties worden daar niet aan gekoppeld.
- De homepage en accountcontrole blijven de ingang. De datasetimport werkt
  vanuit het ingelogde werkvenster en verstuurt multipartverzoeken met de
  vastgelegde databasescope en actuele CSRF-token.
- Het databasevenster behoudt Browse, Structure, SQL, Import, Export en de
  datasetimport. Tijdens een eigen SQL-uitvoering of datasetverzoek kunnen
  sluiten en contextwissels het lopende werk niet onderbreken.
- PostgreSQL behoudt zijn bestaande leesfuncties. Eigen SQL-import en
  datasetimport blijven MariaDB-functies; de API controleert dit vóór het
  uitvoeren van databasespecifieke importlogica.
- De app-image bevat PHP PDO voor MariaDB, PostgreSQL en SQLite plus de lokale
  Python-bestandslezer. Ook de importerbroncode is tijdens ontwikkeling
  alleen-lezen gekoppeld, naast de bestaande PHP- en browserbroncode.
- De CI-workflow bevat de gezamenlijke controles van de vier ontwikkellijnen.
  De browserproeven gebruiken het nieuwe Gereedschap-menu en de accountstroom.

## Bijwerken en controleren

Gebruik voor deze versie één checkout van de integratiebranch en start Govern
met zijn gewone `start.cmd` of `sh start.sh`. Bestaande lokale instellingen en
databasevolumes blijven de opslag van die installatie; de integratie vraagt
geen nieuwe import of verwijdering van volumes. PostgreSQL en lokale AI houden
hun bestaande expliciete instellingen.

De lokale integratiecontrole gebruikt een afzonderlijk Docker-project met
MariaDB, PostgreSQL en eigen testaccounts. Hij gebruikt niet de gekoppelde
Rijksdienst-database. De concrete uitslagen en hun beperkingen staan in
[Validatie](VALIDATION.md). Deze versie is niet automatisch op de
Windows-computer van de gebruiker geïnstalleerd.
