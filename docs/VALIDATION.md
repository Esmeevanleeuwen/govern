# Validatie

Stand van de controles: **3 november 2026**. Eerdere resultaten hieronder horen
bij hun beschreven wijziging en zijn niet automatisch opnieuw uitgevoerd.

## Navigatie en herbruikbare vensters

De werkplek heeft een compactere scrollbar in de zijbalk, een verborgen
document-scrollbar met behoud van scrollen, een bijgewerkte databasekiezer en
een gedeelde vensterlaag. Explore opent onafhankelijke alleen-lezen
recordvensters; bestaande native dialogen behouden hun annuleringscontroles.

Uitgevoerd tegen het afzonderlijke PostgreSQL-/MariaDB-testproject:

- De navigatieproef slaagt. Visueel gecontroleerd op 1440, 1024, 768, 375 en
  320 px, met werkende PageDown, donkere weergave en verminderde transparantie.
- De bestaande browserproeven voor Guided, Detailed, werkplek, selectie,
  schemahulp, AI en homepage/accounts slagen.
- De nieuwe vensterproef slaagt met echte records: meerdere vensters, focus en
  stapeling, slepen en Alt+pijltoetsen, buitenklik/Escape, 320 px, terugkeer van
  focus, behoud van de oorspronkelijke scope, weigeren van een verkeerd
  schema-antwoord, annuleren van late antwoorden en de bevestiging bij
  onopgeslagen rijwijzigingen. Laad-/foutteksten en de werkende retryknop
  vertalen zonder opnieuw te laden. Deze proef doet geen database-POSTs.
- De importproef heeft een echt SQL-bestand via officiële phpMyAdmin geïmporteerd
  en de ontstane tabellen, verwijzing en exacte records opnieuw gelezen. Ook
  lopende databaseaanmaak en het behoud van een actief importformulier bij
  taalwisseling zijn gecontroleerd.
- De nieuwe geometrieproef en de bestaande record-/guide-modelproeven slagen,
  evenals i18n, **1.072** tweetalige berichten en JavaScript-/PHP-syntaxcontroles
  voor de gewijzigde componenten. Een onafhankelijke bronreview vond geen
  blokkerende defecten; laad-, fout- en retryteksten vertalen nu ook ter plekke.

Deze wijziging raakt geen backendcontract of databaserechten. De volledige
CI-workflow en een echte Windows-browser zijn niet lokaal opnieuw uitgevoerd.

## Guided / Stap voor stap voor collega's

De recordverkenner heeft nu een standaard begeleide kijkmodus met categorieën,
items en vaste vraagknoppen. Dezelfde geladen records en GET-actie blijven de
bron voor de grafiek, groepen, uitleg en verder verkennen. Detailed bewaart de
oorspronkelijke bediening zonder het werk opnieuw te laden.

Uitgevoerd in Chromium tegen het afzonderlijke PostgreSQL-/MariaDB-testproject:

- De nieuwe begeleide browsersuite controleert de eerste start, leesbare
  categorienamen, zoeken op die namen, verschillende itemaantallen, echte
  verwijzingen, optionele technische details, verder volgen, NL/EN,
  modusbehoud, schemawisseling, toetsenbordbediening en **320 px**.
- De bestaande Detailed-browsersuite en gedeelde navigatieproef slagen.
  Alle dataverzoeken in de kijkproeven blijven GET; er worden geen
  database- of rechtenwijzigingen uitgevoerd door de nieuwe modus.
- Helperproeven controleren dubbele verwijzingen, ontbrekende of niet-geladen
  nodes, exacte bronwaarden, ongewijzigde records en opslag van alleen de modus.
  Een mislukte opslagopdracht met nog leesbare oude opslag behoudt nu ook
  de expliciete keuze voor de huidige pagina.
- De bestaande graph/modelproef, i18n-proef en **1.055** tweetalige berichten
  slagen. De bestaande **66** Explore-HTTP-controles slagen eveneens.

Desktop en mobiel zijn visueel bekeken. De nieuwe helper- en browsersuite staan
in CI; de volledige CI-workflow en de gebruikerinstallatie zijn niet opnieuw
uitgevoerd. Er zijn geen nieuwe afhankelijkheden, AI-aanroepen of wijzigingen
aan het backendcontract toegevoegd.

## Alleen-lezen records verkennen

De nieuwe Database-weergave **Explore / Verkennen** toont echte records, hun
gedeclareerde foreign keys, een gekoppelde recordlijst en uitleg met exacte
bron- en doelwaarden. De eerste versie haalt één begrensde buurt per vraag op.

Uitgevoerd op het afzonderlijke Docker-project met PostgreSQL 18 en MariaDB 10.11:

- **68** backend-integratiecontroles voor echte relaties, stabiele scopes en
  identiteit, samengestelde/unieke sleutels, exacte grote getallen, NULL en
  binaire previews, zelfverwijzingen, parallelle relaties, grote buurten en
  verkorte velden. De proef toonde PDO-afronding van aangrenzende DOUBLE-sleutels;
  serverconversie naar tekst behoudt nu beide records en hun herselectie.
- **90** PostgreSQL-scopecontroles en **207** backend-lokalisatiecontroles.
- **66** geauthenticeerde Explore-HTTP-controles voor gast-/methodebeveiliging,
  echte catalogusbewijzen, exacte sleutels, schema-afbakening, ontbrekende
  records, keyless views en behoud van de PostgreSQL-schrijfbeperking.
- De Explore-browsersuite controleert grafiek-/lijstselectie, zichtbaarheid
  van de geselecteerde rij, toetsenbordbediening, bronwaarden, filters, verder
  verkennen, NL/EN, bewaarde focus, een vertraagd antwoord over een schemawissel,
  MariaDB en een mobiele breedte van **320 px**. Alle dataverzoeken blijven GET.
- De modelproef controleert filters, onveranderde bronwaarden, stabiele kleuren
  en een niet-overlappende indeling voor **60** records. De bestaande
  JavaScript-unitsuites, **1.002** tweetalige berichten, PostgreSQL-browsersuite
  en gedeelde navigatieproef slagen eveneens.
- De bestaande **66** PostgreSQL-HTTP- en **39** MariaDB-/phpMyAdmin-controles
  slagen na toevoeging van de nieuwe leesactie.

Desktop en mobiel zijn visueel bekeken. De nieuwe proeven staan in CI; de
volledige CI-workflow en de installatie op de gebruikercomputer zijn niet
opnieuw uitgevoerd. Er zijn geen nieuwe afhankelijkheden of schrijfbevoegdheden
voor de webapp toegevoegd.

## Optionele PostgreSQL-voorbeeldgegevens

De nieuwe `load-postgres-demo.cmd` en `load-postgres-demo.sh` laden vijf
gekoppelde tabellen met 39 fictieve records en de view `demo_project_overview`.
Normaal starten blijft ongewijzigd; laden is een expliciete gebruikershandeling.

Uitgevoerd met het afzonderlijke Docker-testproject en PostgreSQL 18:

- **30** loaderfixtures voor de shellopdracht, ingesteld doel, SQL-invoer,
  foutstatussen en behoud van `.env`.
- **31** echte databasecontroles voor de schema- en leesrolvoorwaarden, een
  bestaande naam met ongewijzigde gegevens, ontbreken van gedeeltelijke imports,
  rijaantallen, zes foreign keys, de view, echte leesrechten en geweigerde writes.
  Opnieuw laden behoudt een bewerkte voorbeeldrij; bestaande niet-demotabellen
  blijven ongewijzigd.
- Chromium leest voorbeeldrecords, toont alle vijf tabellen en zes verbindingen
  in het diagram, leest de samengevoegde view en behoudt de selectie na herladen.
- De echte shellloader en de bestaande **66** PostgreSQL-HTTP-controles slagen
  ook met de voorbeelden aanwezig. De API-scope-JavaScriptcontrole slaagt.

De loaderfixtures, databaseproef en browsersuite zijn opgenomen in CI. De
Windows-loader is beoordeeld maar niet op Windows uitgevoerd; de volledige
CI-workflow en de gebruikerinstallatie zijn niet opnieuw uitgevoerd.

## PostgreSQL kiezen na een update met een oudere browsermodule

De verbindingsfout is gereproduceerd in Chromium met de echte `api.js` uit
commit `d213824`. De actuele module stuurde verbinding, database en schema en
kreeg 200; de oudere module stuurde alleen `database=postgres:govern_pg:public`
en kreeg 403 `database_not_available`. De API herkent nu deze volledige sleutel
wanneer de afzonderlijke verbinding- en schemaparameters ontbreken. Dezelfde
configuratie- en capabilitycontroles blijven gelden.

Uitgevoerd in een afzonderlijk Docker-project met PostgreSQL 18, PHP 8.4 en
de testfixtures voor `public` en `archive`:

- **88** PostgreSQL-scopecontroles, inclusief ongeldige codering, expliciete
  parameterconflicten, onbekende scopes en uitgeschakelde PostgreSQL-toegang.
- **66** geauthenticeerde PostgreSQL-HTTP-controles en **35** echte catalogus-,
  gegevenstype- en leesrechtencontroles.
- De bestaande PostgreSQL-browsersuite en de nieuwe
  `postgres-cached-api-smoke.mjs` met de bevroren oudere module. Deze controleren
  echte records, schemawisseling, diagram, herladen en teruggaan naar MariaDB.
- De bestaande **39** MariaDB-/phpMyAdmin-HTTP-controles, **15** backendunits,
  API-scope-JavaScriptcontroles en tweetalige frontendberichten.

De nieuwe browserproef is opgenomen in de CI-workflow. Deze lokale uitslagen
bewijzen de gecontroleerde versie en testomgeving; de volledige CI-workflow en
de installatie op de gebruikercomputer zijn niet opnieuw uitgevoerd.

## Werkpleklinks en cache na een update

Een externe documentlink naar `workspace.php` reproduceerde lokaal de onjuiste
503: de algemene cross-sitecontrole blokkeerde ook een gewone GET-navigatie.
Na de gerichte uitzondering op alleen de HTML-grens slagen **52 account- en
navigatiecontroles** in `tests/auth-integration.py`. De tests controleren ook
dat fetches, embeds, POST, API-verzoeken en ongeldige Origin/Host geblokkeerd
blijven. De backendunitcontroles (15), lokalisatiecontroles (205),
API-scopesuite en 32 opstartfixtures slagen lokaal.

De Nginx-proef in `tests/auth-gateway.py` controleert assethervalidatie voor de
hoofdmodule, geimporteerde module en CSS, plus behoud van API/HTML `no-store`.
Die echte gatewaycontrole en de bestaande Docker-/browsersuites worden in CI
voor de bijbehorende commit uitgevoerd. Eerder geslaagde PostgreSQL- en
MariaDB-controles horen bij commit `7d53c17a57f5ef9e19ca15e789481ef5b60dc65a`
en [deze workflow](https://github.com/Esmeevanleeuwen/govern/actions/runs/41527598865).

## Startpagina en lokale accounts

Voor deze wijziging zijn in de afzonderlijke native omgeving met PHP 8.3,
PDO SQLite en tijdelijke opslag uitgevoerd:

- `php tests/auth_unit.php`: **42 controles geslaagd**, waaronder Argon2id zonder
  bcrypt-afkapping, sessie-/CSRF-vernieuwing, verlopen sessies, status/rol opnieuw
  uitlezen, blijvende pogingenlimieten, eigenaar-goedkeuring en twee gelijktijdige
  registratieprocessen die samen precies één eigenaar opleveren.
- `python3 tests/auth-integration.py`: **33 HTTP-controles geslaagd** tegen een
  afzonderlijke PHP-testserver. Deze gebruiken echte sessiecookies en endpoints
  voor registreren, pending/approve, inloggen en uitloggen, ongeldige CSRF/origin,
  gasttoegang tot gegevensroutes, en de directe `auth-check.php`-grens.
- PHP-syntaxis: **56 bestanden zonder fouten** op het moment van die controle.
- De **zeven bestaande Node-unitsuites** zijn geslaagd: `i18n-unit.mjs`,
  `frontend-messages-unit.mjs` (928 tweetalige sleutels), `preferences-unit.mjs`,
  `dashboard-layout-unit.mjs`, `schema-model-unit.mjs`, `schema-navigation-unit.mjs`
  en `selection-content-unit.mjs`. De gewijzigde browser-/Docker-suites bevatten
  accountfixtures; het aanpassen van die fixtures betekent niet dat die
  volledige suites lokaal zijn uitgevoerd.
- `python3 tests/start-gateway-reload.py`: **24 fixturecontroles geslaagd** voor
  de Unix-startvolgorde, configuratiecontrole vóór reload, stoppen van alleen de
  gateway bij drie afzonderlijke foutpaden, en behoud van volumes. Deze proef
  gebruikt een Docker-commandofixture, geen echte containers. `sh -n` slaagde.
- `git diff --check` en Python-syntaxiscontrole van de auth-HTTP-proef slaagden.

De rootcontrole van homepage en accountvormgeving gebruikt een statische
browserpreview van de markup. Daarmee is de vormgeving bekeken; het is geen
volledige browser → PHP → databaseproef van de bestaande werkplek. Een blijvende
PHP-previewserver is in deze browseromgeving niet ondersteund. De auth-HTTP-
proef voert de echte backend wel afzonderlijk in tijdelijke opslag uit.

Docker is in deze werkomgeving niet beschikbaar. De echte Nginx `auth_request`
naar `auth-check.php`, de officiële phpMyAdmin en de volledige Compose-stack
zijn daarom lokaal niet als geheel uitgevoerd. De stacksmokecontrole/CI moet
rechtstreeks phpMyAdmin vóór login blokkeren met een echte redirect, na login
toelaten en na logout opnieuw blokkeren. Alleen een geslaagde directe
`auth-check.php`-proef bewijst die proxygrens niet.

Beide startbestanden testen en herladen na een geslaagde Compose-start de
gatewayconfiguratie. Mislukt de start of het toepassen van de nieuwe regels,
dan stoppen ze alleen de gateway en behouden ze de volumes. Windows-
batchuitvoering en een echte Docker-herlaadactie blijven omgevingscontroles.

Accounts zijn installatiebreed, geen tenants. De pogingenlimieten, sessies en
eigenaar-goedkeuring bewijzen geen geschiktheid voor openbare hosting. Mail-
verificatie, wachtwoordreset, herstelmail en privéschema's per gebruiker zijn
niet geïmplementeerd. De configuratie blijft uitsluitend op loopback bereikbaar.

## Databases toevoegen en echte SQL-import

De gerichte controles voor deze uitbreiding staan in
`tests/database_provisioner_unit.php`,
`tests/database-provisioning-integration.php` en
`tests/database-import-smoke.mjs`. Ze richten zich op de grens tussen het
naamformulier, de CSRF-beveiligde API, de privéservice en de echte database.
De uiteindelijke uitvoeruitslag hoort bij de betreffende commit en workflow.

De backendproeven behandelen begrensde verzoeken en helperantwoorden,
ongeldige en gereserveerde namen, alleen rechten per exacte naam, ontsnapte
underscores, opnieuw uitvoeren en het behouden van bestaande gegevens. De
gewone webapp en phpMyAdmin mogen het rootwachtwoord niet ontvangen. Een
aanmaakfout mag geen database verwijderen of accountwachtwoord vervangen.

De browserproef moet via de nieuwe dialoog een database voorbereiden en daarna
een echt SQL-bestand uploaden in de officiële phpMyAdmin-import. Alleen een
iframe of importknop aantreffen is onvoldoende: lees de geïmporteerde tabel en
rij terug in Govern en controleer de schemavernieuwing. Controleer ook teruggaan
naar de oorspronkelijke database met behoud van het SQL-concept, herhalen bij
een bestaande naam, foutbehoud, Nederlands/Engels, toetsenbord en 320 px.

Een importcontrole gebruikt uitsluitend een afzonderlijke testdatabase. Ze
bewijst niet dat ieder extern SQL-bestand past binnen de ingestelde 128 MB en
300 seconden, of dat DDL atomair kan worden teruggedraaid. Deze uitbreiding
verbindt geen andere databaseserver en verandert de AI-brongrens niet.

`tests/proxy-restart-smoke.py` controleert de afzonderlijke Docker-proxygrens.
De expliciet ingeschakelde proef geeft de app- en phpMyAdmin-container nieuwe
IP-adressen terwijl de gateway blijft staan en controleert daarna Govern,
API-health en phpMyAdmin opnieuw. Hij verwijdert geen databasevolume. Dit test
de dynamische Docker-DNS-resolutie in Nginx na opnieuw maken van webcontainers;
het is geen inspectie van de netwerktoestand op de gebruikercomputer.

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
docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/database_provisioner_unit.php
docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/local_code_search_unit.php
docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/ai_project_unit.php

docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/backend_integration.php --confirm-database=bestuursatlas
docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/database-provisioning-integration.php --confirm-database=bestuursatlas
docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" -e GOVERN_TEST_SECOND_DATABASE app php /workspace/tests/multidatabase-row-integration.php --confirm-database=bestuursatlas --confirm-second-database=govern_multi_test
docker compose run --rm -T --no-deps -v "$PWD:/workspace:ro" app php /workspace/tests/backup_integration.php --confirm-database=bestuursatlas

python3 tests/smoke.py --base-url http://127.0.0.1:18080
GOVERN_DOCKER_NETWORK_TEST=1 python3 tests/proxy-restart-smoke.py --base-url http://127.0.0.1:18080 --confirm-project=govern-verify
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
BASE_URL=http://127.0.0.1:18080 GOVERN_UI_WRITE_TESTS=1 node tests/database-import-smoke.mjs
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
