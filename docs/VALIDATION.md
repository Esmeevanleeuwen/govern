# Validatie

Stand van de controles: **28 oktober 2026**.

## Uitgevoerd

In één opnieuw ingerichte, afzonderlijke testomgeving zijn **94 controles
geslaagd**:

- 15 backend-unitcontroles.
- 9 controles van herstelpuntbestanden, namen en controlegetallen.
- 34 backend-integratiecontroles met een echte database.
- 15 integratiecontroles van SQL-export en herstel.
- 21 HTTP-controles van de API en phpMyAdmin.

Daarvoor zijn PHP **8.3.6**, MariaDB **10.11.14**, Nginx **1.24.0** en de officiële
phpMyAdmin **5.2.3** gebruikt. De testgegevens kwamen uit het meegeleverde
Bestuursatlas-bestand. De database van de gebruiker buiten deze testomgeving
is niet benaderd.

De hersteltest controleert onder meer gegevens, berekende kolommen, views,
functies, procedures, triggers en events. Ook verkeerde bevestiging,
een gewijzigd exportbestand en herstel na `DROP DATABASE` zijn gecontroleerd.
Het terugzetten verwijdert ook tabellen die na het gekozen herstelpunt zijn
toegevoegd. Na de test is de oorspronkelijke testdatabase hersteld.

Daarnaast is de browsercontrole met Playwright **1.62.1** en Chrome
**156.0.8078.73** geslaagd. Die controleert gegevens zoeken, structuur en
koppelingen bekijken, SQL uitvoeren, exacte grote getallen, dubbele kolomnamen,
veilige tekstweergave, onderzoeken bewaren en verwijderen, de drie echte
phpMyAdmin-tabs, toetsenbordbediening en de mobiele weergave. De schermen zijn
ook visueel nagekeken.

Een aanvullende browserproef maakte via de phpMyAdmin SQL-tab een nieuwe tabel
en een record aan. Govern ontdekte de tabel en toonde het geschreven record
zonder een wijziging aan de applicatiecode.

## Nog niet aangetoond

Docker was in deze lokale testomgeving niet beschikbaar. De daadwerkelijke
containerbouw en samenwerking van de Compose-services zijn hier dus nog niet
uitgevoerd. [De GitHub-workflow](../.github/workflows/verify.yml) voert die
controles na een push uit. Een definitief oordeel daarover hoort bij de
uitslag van de workflow voor de betreffende commit.

Het Windows-startscript is beoordeeld, maar niet op Windows uitgevoerd.

## Zelf herhalen met Docker

**Integratietests zijn alleen bedoeld voor een wegwerp-testdatabase.** Ze maken
testobjecten aan en de hersteltest verwijdert en herstelt de geselecteerde
database. De vereiste optie `--confirm-database` controleert de gekozen naam;
die optie maakt een gewone werkdatabase niet geschikt als testdatabase.

Gebruik een aparte uitgepakte projectmap. De volgende opdrachten zijn voor
een shell op Linux, macOS of een Linux-testomgeving. Python 3 is alleen nodig
voor de ontwikkelaarstest van de HTTP-ingang, niet voor het gewone gebruik
van Govern.

Kies een aparte Compose-projectnaam en een vrije testpoort. Daarmee gebruikt
de test andere containers en volumes dan de gewone Govern-installatie:

```sh
export COMPOSE_PROJECT_NAME=govern-verify
export APP_PORT=18080
sh start.sh
```

De testomgeving is bereikbaar op `http://127.0.0.1:18080`. Onderstaande
opdrachten gebruiken dezelfde tests als de GitHub-workflow. Ze gaan uit van
de standaarddatabasenaam `bestuursatlas` in deze afzonderlijke omgeving:

```sh
docker compose exec -T app sh -c 'find /var/www/src /var/www/public -name "*.php" -exec php -l {} \;'

docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/backend_unit.php
docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/backup_unit.php

docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/backend_integration.php --confirm-database=bestuursatlas
docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/backup_integration.php --confirm-database=bestuursatlas

python3 tests/smoke.py --base-url http://127.0.0.1:18080
```

Voor de aanvullende browsercontrole is een ontwikkelomgeving met Node en
Playwright nodig. Installeer deze apart van de gewone Govern-installatie.
Wijs `PLAYWRIGHT_MODULE` zo nodig naar dat geïnstalleerde pakket. Met een
geïnstalleerde Playwright-browser voer je in de projectmap uit:

```sh
BASE_URL=http://127.0.0.1:18080 GOVERN_UI_WRITE_TESTS=1 node tests/frontend-smoke.mjs
```

De extra schrijvende controle maakt een eigen opgeslagen onderzoek aan en
verwijdert dat weer. phpMyAdmin kan tijdens de test eigen scherminstellingen
opslaan. Gebruik ook hiervoor de afzonderlijke testomgeving.

Bij een fout kun je de recente servicelogboeken bekijken:

```sh
docker compose logs --tail=100
```

Stop na afloop de afzonderlijke testomgeving:

```sh
docker compose down
```

Dit commando verwijdert de containers en het netwerk; de testvolumes blijven
bestaan. Voer de opdrachten uit in dezelfde shell, zodat de aparte projectnaam
actief blijft. Sluit die shell na afloop om de testinstellingen niet per ongeluk
voor een andere projectmap te gebruiken.

## Grenzen van de controle

Een geslaagde test bewijst de gecontroleerde handelingen met deze voorbeelddata.
Dat is geen garantie voor iedere toekomstige tabel, databaseomvang of wijziging.

De eigen API-acties worden tijdens export en herstel onderling vergrendeld.
Een lopende SQL-opdracht in een afzonderlijk phpMyAdmin-venster wordt daarmee
niet stilgezet. Rond zulke opdrachten af voordat je een herstelpunt maakt of
terugzet. Een volledige databaseherstelactie bestaat uit meerdere stappen;
een gewone SQL-transactie kan die niet als geheel ongedaan maken.
