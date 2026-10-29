# Validatie

Stand van de controles: **29 oktober 2026**.

## Schemagids en uitklapbare tools

De schemagids en de blijvend zichtbare gereedschapsbalk zijn in de browser
gecontroleerd. De gids beschrijft zeven onderdelen van het bestaande scherm,
opent als native dialoog en ondersteunt Tab/Shift+Tab, Escape, sluitknoppen,
achtergrondklikken en focusherstel. De scrollbare uitleg is met het toetsenbord
bereikbaar. Een taalwisseling vanuit een tweede tab houdt de gids open in de
nieuwe taal; het verlaten van Schema ruimt de dialoog op.

De browserproef controleert dat toolklikken het juiste paneel openen, dat een
tweede klik op de actieve tool de inhoud inklapt en dat de balk met helpknop
zichtbaar blijft. Zoom, selectie en het midden van de tekening blijven behouden.
De bestaande wielzoom- en schemacontroles zijn meegenomen, inclusief mobiele
weergave en rechter navigatie. De gids verstuurt geen schrijvende API-verzoeken.
Alle **444** berichten hebben Nederlandse en Engelse teksten. De overige
Node-controles blijven ongewijzigd onderdeel van de verificatie.

## Scrollzoom en contextmenu

De navigatie-uitbreiding is gecontroleerd met **21** afzonderlijke controles van
scrollnormalisatie, cursoranker, afbakening en opruimen van de eventhandler.
De bestaande taal-, voorkeur-, dashboard- en schemamodelcontroles slagen ook;
alle **422** interfaceberichten zijn compleet in Nederlands en Engels.

De schemabrowserproef gebruikt echte muiswielinvoer zonder Ctrl en controleert
beide zoomrichtingen, het punt onder de muis, grenzen en behoud van paginascroll.
Ook Ctrl-/trackpadgebaren, regel- en pagina-eenheden en gewone scroll buiten het
diagram zijn gecontroleerd. De tweede menulaag is getest op automatisch
bijwerken, tabtoetsen, verbergen/heropenen, kolomdetails, gerichte verbindingen
en behoud van selectie, taal en viewport.

De afzonderlijke native browserruns controleren ook de bestaande frontend en
instellingen, mobiele weergave op **375** en **320 px**, rechter hoofdnavigatie
en de scrollpositie bij een nieuwe tabelselectie. Het menu houdt lange lijsten
binnen zijn eigen scrollgebied. De schermen zijn visueel nagekeken. Dezelfde
nieuwe tests zijn toegevoegd aan de volledige Docker-workflow.

## Schemavisualisatie

De volledige native controle is opnieuw geslaagd met de schemavisualizer:
**100** database-integratiecontroles, **37** HTTP-controles inclusief phpMyAdmin,
**15** echte herstelcontroles en alle vier browsersuites. Ook de PHP-syntax,
backendunits, lokalisatie, taalvoorkeuren en dashboardindeling zijn geslaagd.
De afzonderlijke schemamodelsuite bevat **26** controles.

Het schema is via scherm, API en de echte testdatabase gecontroleerd met **26**
tabellen en views en **54** foreign keys. De proeven vergelijken elke getekende
kolomkoppeling met de actuele metadata. Samengestelde sleutels, self references,
meerdere sleutels tussen dezelfde tabellen, views en interne tabellen worden
ook in database-integratietests gecontroleerd. Browserfixtures behandelen externe
doelen en namen die op HTML lijken; die fixtures veranderen de database niet.

De browsercontrole behandelt zoeken, in- en uitgaande verwijzingen, selectie,
directe buren, slepen, herhaalde toetsenbordverplaatsing, zoomen en verschuiven.
Taalwisseling behoudt focus, filter, selectie, posities en viewport. Posities
blijven na herladen bewaard; geblokkeerde opslag houdt de sessie bruikbaar.
Fouten, opnieuw proberen, lege schema's, minder transparantie, afwezigheid van
decoratieve randen en mobiel op **375** en **320 px** zijn meegenomen.

De lichte en donkere schermen zijn visueel bekeken. De omgeving gebruikt PHP
**8.4.27**, MariaDB **10.11.14**, Nginx **1.24.0** en phpMyAdmin **5.2.3**.
Alle gegevens en services waren tijdelijk en afzonderlijk van de werkdatabase.
De GitHub-workflow voert dezelfde nieuwe controles uit met Docker; de uitslag
van die uitvoering staat bij de betreffende commit.

## Glasontwerp talen en persoonlijke indeling

De nieuwe vormgeving en voorkeuren zijn gecontroleerd in een afzonderlijke native
testomgeving met PHP **8.4.27**, MariaDB **10.11.14**, Nginx **1.24.0** en de echte
phpMyAdmin **5.2.3**. De gewone database van de gebruiker is niet benaderd.

Geslaagd zijn PHP-syntax, de backend- en herstelpuntbestandscontroles, **159**
lokalisatiecontroles, **89** database-integratiecontroles, **15** echte hersteltests,
de HTTP-controle en de drie browsersuites. De Node-controles behandelen vertalingen,
**47** voorkeurcontroles en **16** indelingscontroles. De hersteltests zetten ook na
het verwijderen van de testdatabase gegevens terug en lezen het resultaat opnieuw.

De browsers controleren Nederlands en Engels, behoud van SQL-concepten en
querybouwerkeuzes, instellingen en herladen, zoeken en paginagrootte, blokvolgorde,
breedte, verbergen en bewaren/annuleren. Ook de echte phpMyAdmin-tabs, terugkerende
toetsenbordfocus, veilige tekstweergave en de mobiele navigatie maken deel uit van
de controle. Een taalwijziging herlaadt een geopend phpMyAdmin-formulier niet.

De lichte, donkere, Engelse en Nederlandse schermen zijn visueel bekeken op
desktop en mobiel. Minder transparantie heeft een effen terugval; panelen gebruiken
geen harde decoratieve randen. De automatische GitHub-workflow herhaalt de tests
met de Docker-stack. Bekijk voor de containeruitslag de run bij de betreffende
commit; de native controle alleen bewijst geen Docker-uitvoering.

## Actuele automatische controle

[De GitHub-workflow](../.github/workflows/verify.yml) bouwt de Docker-omgeving
met PHP **8.4** en voert de PHP-, database-, herstel-, HTTP- en browsercontroles
uit. De browserproeven gebruiken Playwright **1.62.1** en Chrome van de
GitHub-runner. Bekijk de uitslag bij de betreffende commit onder
[Actions](https://github.com/Esmeevanleeuwen/govern/actions).

De uitbreiding voor de visuele querybouwer controleert onder meer:

- Exacte BIGINT- en DECIMAL-filters, NULL tegenover lege tekst en letterlijke zoektekens.
- Gebonden uitvoering en dezelfde zelfstandig uitvoerbare SQL in de editor.
- Samengestelde verwijzingen, self-JOINs, LEFT/INNER JOIN, sortering en limiet.
- Veranderde metadata en ongeldige of ontbrekende kolommen.
- Het toegepaste ontwerp tegenover een nog niet toegepaste wijziging in de bouwer.
- Handmatige SQL, late antwoorden, bewaren als gewone SQL en mobiele bediening.

De volledige backend-integratietest vereist PHP 8.4. Bij de native controle op
PHP 8.3.6 werd een beperking van de oudere PDO-parser gevonden: een dubbelepunt
binnen een gequote kolomnaam werd als parameter gelezen. Die regressietest blijft
staan. De Dockerbasis is verhoogd naar 8.4, waarin de MySQL-specifieke parser
zulke identifiers herkent. Zie de [officiële PHP-documentatie](https://www.php.net/manual/en/migration84.new-features.php#migration84.new-features.pdo-mysql).

## Eerder gecontroleerde basisversie

Voor de eerste basisversie zijn in één opnieuw ingerichte, afzonderlijke
testomgeving **94 controles geslaagd**:

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

## Eerdere Docker-uitvoering en Windows

De volledige Docker-controle is op **28 oktober 2026** ook geslaagd op GitHub
Actions, voor codecommit `735135b0eb82ee98102a8737030747c7444e3e81`.
[Bekijk de geslaagde uitvoering](https://github.com/Esmeevanleeuwen/govern/actions/runs/40756180912).
Die uitvoering bouwde en startte de Compose-services vanuit een schone omgeving,
controleerde de PHP-syntax en voerde de unit-, database-, herstel- en HTTP-tests
uit. Ook de echte phpMyAdmin-ingang maakte deel uit van de HTTP-controle.

Docker was in de lokale testomgeving niet beschikbaar; de containercontrole
is daarom op de GitHub-runner uitgevoerd.
[De workflow](../.github/workflows/verify.yml) herhaalt die controles bij pushes.
Voor een latere codewijziging geldt de uitslag bij die betreffende commit.

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
docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/backend_localization.php

docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/backend_integration.php --confirm-database=bestuursatlas
docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/backup_integration.php --confirm-database=bestuursatlas

python3 tests/smoke.py --base-url http://127.0.0.1:18080
```

Voor de aanvullende browsercontrole is een ontwikkelomgeving met Node 22 of nieuwer en
Playwright nodig. Installeer deze apart van de gewone Govern-installatie.
Wijs `PLAYWRIGHT_MODULE` zo nodig naar dat geïnstalleerde pakket. Met een
geïnstalleerde Playwright-browser voer je in de projectmap uit:

```sh
node tests/i18n-unit.mjs
node tests/frontend-messages-unit.mjs
node tests/preferences-unit.mjs
node tests/dashboard-layout-unit.mjs
node tests/schema-model-unit.mjs
node tests/schema-navigation-unit.mjs
BASE_URL=http://127.0.0.1:18080 GOVERN_UI_WRITE_TESTS=1 node tests/frontend-smoke.mjs
BASE_URL=http://127.0.0.1:18080 node tests/query-builder-smoke.mjs
BASE_URL=http://127.0.0.1:18080 node tests/ui-settings-smoke.mjs
BASE_URL=http://127.0.0.1:18080 node tests/schema-visualizer-smoke.mjs
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
