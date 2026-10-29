# Validatie

Stand van de controles: **29 oktober 2026**.

## Lokale projectcode en bronverwijzingen

De nieuwe PHP-bron- en projectserviceproeven slagen in de afzonderlijke native
testomgeving. Ook `ai-project-smoke.mjs` slaagt met de echte lokale zoek-API en
gerichte providerfixtures. Ook de PHP-syntaxis, tweetalige JavaScriptcontroles, bestaande
backendproeven en vier database-integratiesuites slagen. De providercontrole
gebruikt onder meer een echt lokaal HTTP-fixtureantwoord; er draait geen
gedownload taalmodel.

De 36 bronzoekcontroles slagen ook met PHP-URLstreams, socketfuncties en
processtartfuncties uitgeschakeld. Dit controleert de lokale lezer zonder die
netwerktransports; het is geen OS-firewalltest van Ollama.

De nieuwe controles staan in `tests/local_code_search_unit.php`,
`tests/ai_project_unit.php` en `tests/ai-project-smoke.mjs`. De eerste controleert
lokale zoekresultaten, bronregels en snapshots, grenzen, gewijzigde bestanden,
symlinks en uitgesloten of herkenbare geheime inhoud. De tweede controleert
het projectchatcontract, opnieuw opgebouwde context, letterlijke citaten,
verzonnen bronnen, onthouding en modelinvoer zonder uitvoerbare SQL of tools.
De browserproef controleert de echte lokale zoek-API met AI uit, bronweergave,
CSRF en de overgang tussen Database en Projectcode.
Deze browserproef en de bestaande AI-, selectieaanwijzer- en
instellingenproeven slagen in dezelfde geïsoleerde native omgeving.

De proeven gebruiken lokale testbestanden en, voor de modelstroom,
providerfixtures. Er wordt geen model op projectcode getraind. Een geldig citaat
bewijst alleen dat de passage bestond in de meegestuurde momentopname; het
bewijst niet dat alle uitleg klopt. Geheimfiltering blijft best effort.

Controle op de gebruikercomputer blijft apart: download bewust het gekozen
model, schakel de daadwerkelijke Ollama-cloudfuncties uit, controleer de
firewall en probeer lokale zoekacties en chat met internet losgekoppeld. De
applicatieproeven bewijzen geen volledige netwerkisolatie, hardwareversnelling,
snelheid of antwoordkwaliteit van dat echte model.

## Lokale AI-interface en architectuuropzet

De optionele koppeling is gecontroleerd met **44** context- en serviceproeven,
**55** providerproeven en **34** controles op actuele metadata in de afzonderlijke
testdatabase. De providerproef gebruikt ook echte lokale HTTP-antwoorden voor
modellen, chat, fouten, redirects, ongeldige inhoud, groottelimieten en timeouts.
Er is geen echt taalmodel gedownload of uitgevoerd.

De browserproef gebruikt de echte uitgeschakelde status en actuele schemacontext.
Gerichte providerfixtures controleren antwoorden, veilige tekstweergave en
SQL-voorstellen. Openen in Onderzoeken wijzigt alleen het concept; uitvoeren
blijft een gebruikershandeling. Rijen, celwaarden en een geselecteerde losse
queryresultaatwaarde komen niet automatisch in de AI-context terecht.

Ook selectie via Meer, Nederlands/Engels, mobiel op **320 px**, focus, minder
transparantie, foutbehoud, stoppen met wachten en gescheiden concepten per
database zijn gecontroleerd. Een laat antwoord van A vervangt B niet. Alle
**708** interfaceberichten hebben Nederlandse en Engelse teksten. De lichte
en donkere AI-schermen zijn visueel nagekeken.

De gewone database-, herstel- en HTTP-controles slagen eveneens. Dezelfde nieuwe
proeven zijn opgenomen in de Docker-workflow; de uitslag staat bij de betreffende
commit. Deze controle bewijst de applicatie- en protocolstroom met fixtures.
De kwaliteit, snelheid en netwerkbereikbaarheid van Ollama op de Windows-computer
van de gebruiker blijven een afzonderlijke aansluitproef. Zie [de AI-opzet](AI.md).

## Meerdere databases en rechtstreeks rijen wijzigen

De nieuwe integratieproef heeft **74** controles met twee afzonderlijke echte
testdatabases. Die behandelen catalogus, opgeslagen onderzoeken en SQL per
database, exacte primaire en unieke sleutels, toevoegen, wijzigen en verwijderen,
NULL en DEFAULT, grote getallen, binaire waarden, berekende en grote velden.
Een verouderde versie wordt geweigerd, ook als alleen het niet-getoonde einde van
een groot veld verandert. Numerieke kolomnamen blijven JSON-objecten; aangrenzende
DECIMAL-sleutels boven de JavaScript-getalgrens worden exact behandeld.

Herstelpunten hebben afzonderlijke mappen en delen één applicatievergrendeling.
De proef herstelt de daarvoor lege tweede testdatabase en leest opnieuw uit dat
de eerste database ongewijzigd bleef. Ook de bestaande **107** databasecontroles,
**176** lokalisatiecontroles, vrije SQL, herstel- en HTTP-controles slagen.

De nieuwe browserproef controleert de databasekiezer, echte rijhandelingen,
conflictherstel zonder conceptverlies, apart bewaarde SQL-concepten, tabellen,
opgeslagen onderzoeken en schema-indelingen. Een vertraagd antwoord van database
A mag database B niet vervangen. De proef voert ook een echte phpMyAdmin-wijziging
in B uit en leest zowel B als de ongewijzigde rij in A terug. Nederlands, Engels,
mobiele bediening en de nieuwe dialogs zijn meegenomen. Alle **633** berichten
hebben Nederlandse en Engelse teksten.

De opstartservice voor expliciet ingestelde databases is afzonderlijk met MariaDB
gecontroleerd op herhaalbaarheid, bestaande gegevens en wachtwoorden, leesrechten
en ontsnapte underscores in grants. Docker wordt door de GitHub-workflow getest;
de uitslag staat bij de betreffende commit. Windows is niet lokaal uitgevoerd.

## Vrije SQL in de querywerkplaats

De uitbreiding is met echte SQL in de afzonderlijke testdatabase gecontroleerd.
De nieuwe backendproef bevat **38** controles van CRUD, DDL, views, procedures,
functies, triggers, meerdere CALL-resultaten, waarschuwingen en transacties.
Zowel COMMIT en ROLLBACK als een onafgemaakte transactie zijn met opnieuw
uitlezen gecontroleerd. Gedeeltelijke fouten behouden de al uitgevoerde
resultaten en stoppen latere opdrachten.

De **58** parsercontroles behandelen onder meer DELIMITER, uitvoerbaar commentaar,
quotes, regelafbrekingen, moduswisselingen en de adviesvoorvertoning. Aanvullende
databaseproeven vergelijken ROW_COUNT(), FOUND_ROWS(), voorbereide opdrachten
en SHOW WARNINGS met de echte sessie-uitkomsten. Native PHP 8.4-waarschuwingentellers
voorkomen verborgen SHOW-opdrachten tussen gewone gebruikersopdrachten. De
grens voor dynamische wijzigingen van quote-instellingen staat in de API-gids.

De browserproef voert eigen testschrijfacties uit, leest de opgeslagen waarden
terug en controleert dat tabelwijzigingen in de catalogus verschijnen. Ook
DELIMITER/CALL, selectie van een tweede resultaatset, waarschuwingen, taalwisseling,
de bestaande bevestigingsdialoog en behoud van SQL, resultaten en focus zijn
gecontroleerd. De schermen zijn visueel nagekeken. Alle **576** interfaceberichten
zijn volledig in Nederlands en Engels. De nieuwe proeven draaien ook in de
Docker-workflow; de containeruitslag staat bij de bijbehorende commit.

## Selectieaanwijzer en contextuitleg

De aanwijzer is met echte Bestuursatlas-records in de afzonderlijke native
testdatabase gecontroleerd. Gewoon klikken vervangt de selectie; Shift-klikken
voegt toe of verwijdert. De browserproef controleert de wachttijd van meer dan
drie seconden, opeenvolgende zweefdoelen, de naam en HTML-tag, bovenliggende
rijselectie en uitleg van één onderdeel of een gecombineerde selectie.

Ook knoppen, navigatie, invoervelden, willekeurige tekst en uitgeschakelde
knoppen zijn gecontroleerd. Inspecteren activeert geen gewone handeling en
verstuurt geen schrijvende API-verzoeken. Schema slepen en pijlverplaatsing
worden in selectiemodus onderschept; wielzoom blijft werken. Focus, Tab,
Escape, een taalwisseling met geopende dialoog, veilige tekstweergave en een
donkere, ondoorzichtige weergave op 320 px zijn meegenomen. De schermen zijn
visueel nagekeken.

De afzonderlijke modelproef controleert exacte waarden, samengestelde primaire
sleutels, dubbele selectie van hetzelfde record, SQL-stringescaping, werkelijk
vastgelegde foreign keys en momentopnamen zonder betrouwbare recordidentiteit.
Verkorte/binaire voorbeeldwaarden leveren geen veronderstelde selectiesleutel
op. De queryactie zet alleen een leesvraag klaar; uitvoeren blijft een aparte
handeling. Alle **569** berichten zijn volledig in Nederlands en Engels.

Deze controles gebruikten PHP **8.4.27**, MariaDB **10.11.14**, Nginx **1.24.0**
en de officiële phpMyAdmin **5.2.3**. De nieuwe model- en browserproef zijn ook
toegevoegd aan de Docker-workflow; de containeruitslag staat bij de commit.

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
export DB_DATABASES=bestuursatlas,govern_multi_test
export GOVERN_TEST_SECOND_DATABASE=govern_multi_test
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
docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/local_code_search_unit.php
docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/ai_project_unit.php

docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/backend_integration.php --confirm-database=bestuursatlas
docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" -e GOVERN_TEST_SECOND_DATABASE app php /workspace/tests/multidatabase-row-integration.php --confirm-database=bestuursatlas --confirm-second-database=govern_multi_test
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
BASE_URL=http://127.0.0.1:18080 node tests/ai-workspace-smoke.mjs
BASE_URL=http://127.0.0.1:18080 node tests/ai-project-smoke.mjs
BASE_URL=http://127.0.0.1:18080 node tests/schema-visualizer-smoke.mjs
BASE_URL=http://127.0.0.1:18080 GOVERN_UI_WRITE_TESTS=1 GOVERN_TEST_SECOND_DATABASE=govern_multi_test node tests/multidatabase-row-smoke.mjs
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
