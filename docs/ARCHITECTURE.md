# Architectuur

## Startpagina en installatieaccounts

`app/public/index.php` toont de publieke, responsive startpagina uit
`homepage.php`. `homepage.js` verzorgt vertalingen, de expliciet als voorbeeld
gemarkeerde databaseweergaven en de Docker-installatiedialoog. De voorbeelden
zijn gewone lokale schermgegevens; ze maken geen databaseverbinding en voeren
geen SQL uit. Oude werkplekhashes en hun queryparameters worden naar
`workspace.php` doorgestuurd, zodat bestaande links hun betekenis behouden.

`workspace.php` bevat de bestaande applicatieshell en vraagt vóór uitvoer
`Web::user()` om een goedgekeurde gebruiker. `Web.php` gebruikt dezelfde
`Http::start()`- en `Auth`-grens als de API. Zonder sessie volgt een redirect naar
inloggen; bij onbeschikbare accountopslag blijft de werkplek gesloten.
`auth.php` toont inloggen en registreren; `account.php` toont het lokale account,
uitloggen en alleen voor de eigenaar de openstaande toegangsverzoeken.

`Auth.php` bewaart accounts en pogingenlimieten met PDO SQLite in
`AUTH_DIR/accounts.sqlite`, standaard `/var/lib/govern/auth`, in het afzonderlijke
`account_data`-volume. De map is alleen toegankelijk voor de webservergebruiker;
de bestanden worden privé aangemaakt. Deze opslag staat buiten de webroot,
werkdatabases, schema-exports en SQL-herstelpunten. PHP's sessiecookie blijft
HttpOnly en SameSite Strict, met Secure bij HTTPS. Aanmelden en afmelden
vernieuwen sessie-ID en CSRF-token. De sessie heeft een absolute bovengrens van
twaalf uur; elke toegangscontrole leest actuele rol en status uit de accountopslag.

De eerste registratie wordt onder een `BEGIN IMMEDIATE`-transactie eigenaar.
Een gedeeltelijke unieke index staat slechts één eigenaar toe. Elke latere
registratie is `pending`, zonder toegang, totdat de eigenaar die aanvraag
goedkeurt. De database bewaart uitsluitend Argon2id-wachtwoordhashes. Login en
registratie verbruiken blijvende, begrensde pogingenvakken; ruwe inlognamen en
IP-adressen worden niet in de throttle-sleutels bewaard. Dubbele registratie
krijgt dezelfde openbare uitkomst als een wachtende aanvraag.

Dit is installatiebrede toegang, geen gebruikersspecifieke databasescheiding.
Elke goedgekeurde gebruiker krijgt dezelfde bestaande databasefuncties en
MariaDB-rechten. Er is geen mailverificatie, herstelmail, wachtwoordreset of
account-/apparaatsynchronisatie. De loopbackbinding blijft gelden; deze
authenticatie is geen claim dat het platform klaar is voor openbare hosting.

`auth-api.php` biedt het kleine accountcontract. `api.php` behandelt alleen de
vaste, minimale database-readinesscontrole zonder login; alle andere routes
vergen een goedgekeurde gebruiker vóór databasescope en gegevenswerk. De health-
route negeert een opgegeven database en gebruikt de vaste startconfiguratie.
Nginx controleert ieder `/phpmyadmin/`-verzoek met een interne `auth_request`
naar `auth-check.php`. Dat geldt ook voor uploads, downloads en AJAX-verzoeken;
een nog geldige native phpMyAdmin-cookie geeft zonder Govern-sessie geen toegang.

Alleen de HTML-paginagrens staat een cross-site GET voor een documentnavigatie
toe. Daardoor opent een werkpleklink vanuit een andere website zonder onjuiste
503. De API houdt zijn afzonderlijke cross-sitegrens en Origin/CSRF-controles.
`Web` logt de stabiele foutcode en bewaart de HTTP-status van een `ApiException`.
Nginx laat assets bij ieder gebruik hervalideren; API/HTML-cachebeleid blijft
afkomstig van de bestaande PHP-antwoorden.

Beide startbestanden voeren na `docker compose up --wait` eerst `nginx -t` en
daarna `nginx -s reload` in de gateway uit. Een gewijzigd bind-mounted bestand
zou bestaande workers anders niet bijwerken. Bij start-/configuratie-/reloadfouten
stoppen de scripts de gateway, zonder volumes te verwijderen, zodat oudere
toegangsregels niet actief achterblijven.

## Actuele databases, herbruikbare schermen

### Optionele PostgreSQL-verbinding

De PostgreSQL-uitbreiding bouwt voort op de startpagina en installatieaccounts
uit PR #16. Ze voegt een tweede SQL-engine toe aan dezelfde werkplek, zonder
een tweede tabelverkenner of schemadiagram. De leesfuncties omvatten tabellen,
kolommen, sleutels, relaties, records, zoeken binnen de gekozen tabel en de
recordkaart.

`Database` blijft de gedeelde facade en kiest `MariaDbAdapter` of
`PostgresAdapter`. `Catalog` kiest overeenkomstig `MariaDbCatalog` of
`PostgresCatalog`; beide geven dezelfde metadata aan de bestaande schermen.
MySQL-DSN's, sessie-instellingen, identifierquoting en catalogusvragen blijven
bij de MariaDB-adapter. PostgreSQL gebruikt PDO PostgreSQL, een verbinding met
één database, expliciet gequote schemanamen en zijn eigen catalogusvragen.

`ConnectionScope` combineert de bestaande `DatabaseScope` met de optionele
PostgreSQL-configuratie. Alleen de server bepaalt host en leesaccount.
Ieder verzoek bevat de verbinding, database en het schema. De PostgreSQL-kiezer
toont alleen de geconfigureerde database en de schema's uit `PG_SCHEMAS`;
de werkelijke leesbaarheid wordt met het leesaccount gecontroleerd. Een
ontbrekend of ontoegankelijk schema blijft herkenbaar als niet beschikbaar.

De browser bewaart voor PostgreSQL een volledige `scope_key` met database én
schema. Daardoor delen gelijknamige tabellen geen cache, selectie, concept of
diagramindeling. MariaDB houdt zijn bestaande databasesleutel en oude links.
Een wissel annuleert oude leesacties en laat late antwoorden uit de vorige
scope buiten de huidige weergave.

`ConnectionScope::selectRequest` blijft oude gecachete API-modules ondersteunen:
alleen wanneer `connection` en `schema` ontbreken mag `database` de volledige
servergestuurde `postgres:<database>:<schema>`-sleutel bevatten. De gedecodeerde
namen ondergaan dezelfde configuratiecontrole. Een gemengde of ongeldige
scopesleutel krijgt geen ruimere toegang en wordt geweigerd.

De capabilityvelden in bootstrap sturen de zichtbare bediening. De API weigert
voor PostgreSQL alle acties buiten bootstrap, catalogus, structuur, bladeren,
de afzonderlijke leesacties van de recordkaart en het compatibele `GET explore`;
de writer- en vrije-SQL-verbinding weigeren eveneens. Er wordt geen MariaDB-
snapshot-, query-, import- of AI-service op een PostgreSQL-scope aangeroepen.
phpMyAdmin blijft de officiële MariaDB-toepassing en wordt niet als
PostgreSQL-beheerder gepresenteerd.

Het optionele Compose-profiel `postgres` gebruikt een eigen datavolume en een
eenmalige leesrechtenservice. Alleen PostgreSQL en die opstartservice ontvangen
het bootstrapwachtwoord; de webapp ontvangt uitsluitend de lezergegevens.
De startbestanden schakelen het profiel in bij `PG_ENABLED=1` en bewaren
bestaande wachtwoorden en volumes. Zie [POSTGRESQL.md](POSTGRESQL.md) voor de
configuratie en de grens van deze eerste bouwfase.

### Compatibiliteit met de eerdere recordverkenner

`RecordExplorer.php` leest dezelfde genormaliseerde catalogus als de bestaande
schermen. De bestaande GET-actie `explore` bouwt een begrensde buurt rond één echt
record met een primaire of volledige, niet-nullbare unieke sleutel. Alle
recordvragen lopen via de reader van de gekozen adapter. Kolomnamen en relaties
komen uit de actuele catalogus; waarden worden gebonden en tabellen zijn binnen
het geselecteerde schema gekwalificeerd.

Het antwoord scheidt exacte identiteit en foreign-keywaarden van verkorte
weergavevelden. Een stabiele node-ID bevat verbinding, database, schema, tabel
en volledige sleutel. Een edge bevat de echte bron- en doelvelden en waarden.
Er worden geen relaties afgeleid uit gelijkende namen en er wordt niet buiten
de geselecteerde scope gezocht. Tabellen zonder bruikbare sleutel en externe
verwijzingen blijven herkenbaar overgeslagen.

Vaste aantals-, preview- en tijdgrenzen begrenzen iedere vraag. Het antwoord
beschrijft alleen de geladen buurt en haar beperkingen. Er is geen blijvende
index, aparte grafiekdatabase of nieuwe frameworklaag nodig.

Dit API-contract blijft beschikbaar voor oudere clients. De actuele Explore-
werkplek gebruikt de gepagineerde `RecordMap`-acties uit de sectie
**Flexibele Explore-werkplek**. Beide antwoorden en hun node-ID's worden niet
samengevoegd tot twee parallelle grafieken in één scherm. De PostgreSQL-writer
blijft ontoegankelijk.

### Gedeelde vensterlaag

`modal-shell.js` beheert stapeling, slepen, focus, buitenklik en annulering los
van inhoud en gegevensbronnen. `attachDialog` vult native dialogen aan met
behoud van cancel- en opslagcontroles. `createModal` maakt ook meerdere niet
blokkerende vensters met bevroren context, eigen AbortSignal en opruiming per
laadcyclus. `record-window.js` koppelt die laag aan de bestaande Explore-GET en
valideert scope, tabel en exacte sleutel. Zie [Vensters en modalinhoud](MODALS.md).

### Begeleidend tweede scherm

`companion.php` gebruikt dezelfde HTML-inloggrens en biedt een apart venster
met een vergelijkingsdesk en relatieradar. `companion-channel.js` koppelt één
werkplektab aan één begeleidend venster via een willekeurig tijdelijk kanaal.
Alleen gevalideerde broncoördinaten gaan over dit kanaal; recordgegevens worden
apart via de bestaande alleen-lezen Explore-GET geladen. Er zijn geen nieuwe
API-acties, SQL-rechten of blijvende recordopslag.

`companion-model.js` controleert scope, tabel en volledige tekstsleutel van elk
antwoord. Identiteit bevat ook database en schema. De desk houdt maximaal vier
bronnen vast met een eigen annuleringssignaal en revisie per record. De radar
heeft onafhankelijk volgen/vastzetten en annuleert achterhaalde antwoorden.
Vergelijking onderscheidt ontbrekende velden, NULL, lege tekst en onzekere
previews; gedeelde verbindingen matchen alleen exacte geladen recordidentiteiten.
Zie [Een tweede scherm voor Govern](COMPANION.md) voor bediening en lifecycle.

### Bestaande MariaDB-werkplek

De geselecteerde werkdatabase is de bron voor zowel Govern als phpMyAdmin.
Govern vraagt de catalogus op en bouwt daar zijn verkenner uit. Een nieuwe tabel verschijnt na
verversen, zonder een nieuwe resourceklasse of een kopie van de database in
applicatiecode. Commentaren in de database zijn ook beschikbaar in het scherm.

Het domeinmodel blijft relationeel. De koppeling tussen organisatie, systeem,
onderbouwing en bron hoort in gewone tabellen met foreign keys. De UI maakt die
structuur zichtbaar en kan later gerichte hulpmiddelen toevoegen.

## Onderdelen

De lokale ingang verdeelt verzoeken naar de PHP-app en naar phpMyAdmin. Beide
hebben dezelfde oorsprong, zodat het databasevenster zonder publieke iframe-
toestemming kan werken. MariaDB is alleen bereikbaar binnen het Docker-netwerk.

Nginx gebruikt benoemde upstreamgroepen met een gedeelde zone en Docker-DNS
(`127.0.0.11`, vijf seconden geldigheid) voor `app` en `phpmyadmin`. Daardoor
volgt een bestaande gateway nieuwe container-IP-adressen wanneer Compose na een
instellingswijziging alleen de webcontainers opnieuw maakt. De proxy blijft
`/phpmyadmin/` van de upstream-URI verwijderen en bewaart dezelfde cookiepaden,
headers en redirects. Dit gebruikt de dynamische upstreamresolutie van de
meegeleverde Nginx 1.30-image.

De PHP-app heeft een kleine API. Een catalogusservice beschrijft tabellen; een
onderzoekservice voert visuele leesvragen en vrije SQL-scripts uit en bewaart ze;
een backupservice maakt en
herstelt SQL-exports. Het HTTP-bestand behandelt sessie, CSRF, foutstatus en JSON.
Deze verdeling volgt verantwoordelijkheden, niet afzonderlijke overheidsdomeinen.

Het native importscherm is onderdeel van `import-inspection.js`, naast
de bestaande phpMyAdmin-import. Er is geen tweede SQL-parser of extra
backendservice; de import werkt alleen op expliciet geselecteerde bestanden.

De browser gebruikt herbruikbare onderdelen voor tabellen, meldingen, dialoog-
vensters, SQL-blokken en API-verzoeken. Tabnamen uit de database zijn gegevens,
geen uitvoerbare JavaScript of HTML.

De onderdelen hebben een kleine, duidelijke taak:

| Onderdeel | Verantwoordelijkheid |
| --- | --- |
| `app.js` | Routes, schermtoestand en de samenwerking tussen onderdelen |
| `ui.js` | Knoppen, tabellen, meldingen, bevestigingen en SQL-uitleg |
| `api.js` | Verzoeken, CSRF en consistente foutobjecten |
| `i18n.js` en de `*-messages.js` bestanden | Stabiele vertaalsleutels, Nederlands en Engels |
| `preferences.js` | Gevalideerde browservoorkeuren en gedeelde uiterlijktokens |
| `dashboard-layout.js` | Blokvolgorde, breedtes, zichtbaarheid en een aparte bewerkingsversie |
| `query-builder.js` | Het tijdelijke visuele queryontwerp en de toegepaste versie |
| `schema-model.js` en `schema-visualizer.js` | Live relaties, diagramindeling en interactieve schemaverkenning |
| `record-map.js`, `record-map.css` en `record-map-messages.js` | Eén Explore-canvas, bronbibliotheek, vragen en inspecteur |
| `record-map-model.js` | Scoped recordidentiteit, selectie en lokale canvaspresentatie met begrensde Undo |
| `RecordMap.php` | Alleen-lezen recordkeuze, inspectie en gepagineerde expansie van echte foreign keys |
| `RecordExplorer.php` | Het behouden `GET explore`-contract voor bestaande clients |
| `schema-navigation.js` | Alleen binnen het diagram genormaliseerde, muisgerichte scrollzoom |
| `schema-help.js` | Een vertaalde schemagids in een native dialoog met focusbeheer en opruimen |
| `selection-pointer.js` | Globale selectiepijl, Shift-selectie, vertraagde naamkaartjes en de uitlegdialoog |
| `selection-registry.js` | Semantische metadata van zichtbare onderdelen, los van hun normale bediening |
| `selection-content.js` | Feitelijke uitleg en mogelijke vervolgstappen uit geselecteerde metadata |
| `ai-workspace.js`, `ai-messages.js` en `ai-workspace.css` | Optioneel AI-paneel, status, bronnen, tijdelijke gesprekken en SQL-voorstellen |
| `AiConfig.php` | Uitsluitend servergestuurde, standaard uitgeschakelde lokale providerconfiguratie |
| `AiContext.php` | Begrensde context uit geselecteerde schema- en interfaceonderdelen |
| `LocalCodeSearch.php` | Begrensde lokale zoekindex van alleen `app/` en `docs/`, met bronpassages en regelnummers |
| `AiService.php` en `OllamaClient.php` | Gevalideerde vragen, lokaal providerverzoek, gecontroleerde projectcitaten en antwoord zonder uitvoering |
| `database-modal.js` | Het venster rondom de echte phpMyAdmin |
| `database-manager.js` | Dialoog voor databasekeuze, expliciete aanmaak en openen van de officiële import |
| `DatabaseProvisioner.php` | Begrensde client voor de privéservice voor databaseaanmaak |
| `docker/database-manager/server.php` en `DatabaseManager.php` | Privé Unix-socketserver en uitsluitend databaseaanmaak/rechten per expliciete naam |
| `row-editor.js` | Rijformulier met vaste databasecontext, exacte waarden en conflictfeedback |
| `DatabaseScope.php` | Toegestane databasekeuze, afzonderlijke herstelpuntpaden en gedeelde locklocatie |
| `RecordIdentity.php` en `RowEditor.php` | Volledige rij-identiteit, catalogusgestuurde formulieren en gecontroleerde mutaties |
| `Messages.php` | Vertaalde applicatiefeedback met stabiele foutcodes |

## Databasekeuze en afzonderlijke toestand

`Database::databaseNames` verbindt zonder een werkdatabase te kiezen en vergelijkt
de zichtbare namen voor schrijver en lezer. `DatabaseScope` gebruikt hun doorsnede,
laat de vier systeemdatabases weg en voegt geconfigureerde, niet-beschikbare namen
toe voor herstel. Een onbekende naam krijgt 403. Gewone selectie gebruikt
bestaande rechten; alleen de afzonderlijke expliciete aanmaakhandeling kan via
de privéservice toegang tot een gekozen naam voorbereiden.

Elke API-URL bevat de database expliciet, ook bij POST, downloads en contextexports.
Zonder parameter blijft `DB_NAME` de standaard. Een verbinding kiest de naam met
een gequote `USE`, zodat een catalogusnaam geen DSN-fragment kan worden. Er is
geen gedeelde actieve database in de PHP-sessie. De browser bewaart zijn keuze
per tabblad en neemt die op in routes; twee tabbladen veranderen elkaars doel niet.

De browser houdt tabelkeuze, zoekvelden, onderzoeksconcept, resultaten, builder
en tijdelijke explorer-/schematoestand per database apart. Een wissel breekt oude
leesverzoeken af en verandert de revisie, zodat een laat antwoord het nieuwe
scherm niet kan overschrijven. Een open rijeditor, databasevenster of lopende
schrijfactie blokkeert wisselen. Een rijhandeling houdt zijn oorspronkelijke
database, tabel, sleutel en versie vast, ook tijdens een bevestigingsdialoog.
Opgeslagen onderzoeken blijven in `_govern_queries` van de gekozen database.
Uiterlijk, taal en dashboardindeling blijven algemene browservoorkeuren.

Het officiële databasevenster krijgt de geselecteerde `db` in zijn URL en biedt
zelf een databasekeuze. Het volgt expliciete navigatie binnen phpMyAdmin zonder
een formulier door gewone shellupdates of taal-/themawisselingen te herladen.
De gedeelde phpMyAdmin-opslag blijft in de oorspronkelijke `DB_NAME`-database.

## Database toevoegen en SQL importeren

De actie in Gereedschap opent een eigen, kleine dialoog. Een bestaande
database kiezen gebruikt de normale wisselstroom. Een naam voorbereiden gebruikt
`POST prepare-database` met CSRF en de expliciete huidige databasescope. Het
antwoord bevat de voorbereide naam, of die nieuw was, en de opnieuw uitgelezen
databasekeuzes. Pas na een geslaagd antwoord verandert de browser zijn selectie.
Concepten van de vorige database blijven bewaard.

De webapp praat via een lokale Unix-socket met de afzonderlijke Compose-service
`database-manager`. Alleen deze service en de bestaande opstart-/databaseprocessen
hebben het rootwachtwoord. De socket heeft geen gepubliceerde netwerkpoort; de
Apache-worker kan erop aansluiten, maar de browser kiest geen pad of credentials.
Een begrensd JSON-bericht kan alleen `prepare_database` met één gevalideerde naam
vragen. Het is geen algemene SQL-, shell- of beheertool en wordt niet aan AI
beschikbaar gemaakt.

De service maakt de gekozen database alleen aan als die ontbreekt en verleent de
twee bestaande accounts rechten per exacte naam. Een bestaande naam toevoegen is
expliciet toegestaan en behoudt de data. Deze voorbereiding importeert, verwijdert
of vervangt niets. Herhalen is geschikt om een gedeeltelijk voltooide aanmaak of
grantstap af te maken. De echte grants blijven in het MariaDB-volume bewaard en
maken de nieuwe database bij een volgende start opnieuw zichtbaar.

Voor SQL-bestanden tot 256 KiB heeft Govern ook een beperkte eerste-partij import
in de Import-tab. `NativeImport` hergebruikt `SqlScript`, `QueryRunner` en
`ImportInspection`: eerst voorcontrole zonder uitvoering, daarna bevestiging
van exact de databasenaam, vergelijking van de voorcontrole-token, exclusieve
onderhoudslock en uitvoer met nacontrole. Bij een bestaande database met
tabellen of views (ook verborgen interne applicatietabellen) wordt onder de exclusieve lock een herstelpunt
gemaakt vóór uitvoering. De controle van structuur en rijen is best effort; bij
grotere tabellen zijn aantallen expliciet onbekend. De SQL zelf is niet beperkt
tot de geselecteerde database: het schrijvende account heeft ook rechten op
andere geselecteerde databases. SQL kan daarom met `USE` of gekwalificeerde
namen andere toegestane databases raken. De UI waarschuwt daarvoor en voert
geen SQL uit zonder afzonderlijke bevestiging. Er is geen algemene undo.

Voor grotere of complexe SQL-bestanden gebruikt Govern de echte phpMyAdmin. De extra snelkeuze
**Import** opent de officiële database- of tabelimport met dezelfde context als
de overige tabs. De gebruiker kiest zijn SQL-bestand en start de import daar;
Govern leest of herschrijft het bestand niet met een eigen parser. Bij sluiten
worden catalogus, tabellen en relaties opnieuw uitgelezen. De ingestelde
uploadgrens is 128 MB en de uitvoeringstijd is 300 seconden. De SQL kan bestaande
data veranderen en DDL heeft geen algemene rollback. Een import is geen
herstelpunt en is niet automatisch gekoppeld aan de applicatie-onderhoudslock.

## Gegevens rechtstreeks bewerken

`Catalog::browse` levert naast de verkorte leesvoorbeelden afzonderlijke, exacte
rijsleutels. `RecordIdentity` kiest de volledige primaire sleutel of een volledige
unieke index zonder NULL-kolommen, gegenereerde velden of prefixdelen. Binaire
sleutelwaarden worden hexadecimaal verzonden. Rijen zonder bruikbare identiteit
worden niet met een verzonnen volgnummer of een gedeeltelijke sleutel gewijzigd.

`RowEditor` leest voor het formulier opnieuw de echte rij en de actuele catalogus.
Het formulier onderscheidt een exacte waarde, NULL en de databasestandaard.
BIGINT en DECIMAL blijven strings; binary/blob gebruikt hex en gebonden `UNHEX`.
Berekende velden, BIT/geometrie en te grote of niet-bewerkbare tekstvelden zijn
alleen-lezen. Alleen gewijzigde velden worden verstuurd, zodat hun oorspronkelijke
inhoud niet door een preview wordt vervangen. Invoegen kan ook zonder sleutel;
voor wijzigen/verwijderen en views blijft de officiële phpMyAdmin de route wanneer
de eigen editor geen veilige identiteit of invoer ondersteunt.

Een database- en tabelgebonden fingerprint omvat de volledige rij, ook velden die
het formulier niet kan bewerken. Wijzigen en verwijderen lezen met `FOR UPDATE`
binnen een schrijftransactie, controleren de versie en nemen de oorspronkelijke
sleutel plus NULL-veilige byte-digests op in de SQL-voorwaarde zelf. Daarmee kan
een tussentijdse wijziging niet stilzwijgend worden overschreven, ook wanneer een
opslagengine de rijlock niet ondersteunt. Een conflict geeft 409 en biedt opnieuw
laden; invoer blijft staan tot de gebruiker daar bewust voor kiest. Een wijziging
van de primaire sleutel is toegestaan en levert de nieuwe identiteit op wanneer
die kan worden teruggelezen. MariaDB bewaakt constraints en rechten.

## Selectie en gerichte uitleg

De selectiepijl staat in de gedeelde bovenbalk en werkt over de eigen Govern-
interface. De interactielaag vangt activeren, typen en slepen af zolang de pijl
aanstaat; normaal scrollen en schemazoom blijven beschikbaar. Klikken vervangt
de selectie, Shift-klikken wisselt een onderdeel in of uit de selectie. Het
naamkaartje verschijnt na meer dan drie seconden hover en bevat Meer en een
pad naar bovenliggende onderdelen. De teller biedt toegang zonder hover.

Schermen registreren tabellen, kolommen, rijen, cellen en relaties via
`registerSelection`. Ze gebruiken de bestaande catalogus- en browsegegevens,
geen tabelspecifieke controllers of kopie van het gegevensmodel. Niet
geregistreerde interfaceonderdelen krijgen een algemene uitleg van hun rol,
zichtbare tekst en HTML-tag. De inhoud van het officiële phpMyAdmin-frame valt
buiten deze inspectielaag.

De uitlegmodule gebruikt geselecteerde waarden, commentaren, sleutels en
gedeclareerde relaties. Selecties die niet meer in het scherm staan blijven
herkenbare momentopnamen. Een recordquery vereist alle werkelijke primaire-
sleutelvelden; samengestelde sleutels blijven intact en rijen zonder sleutel
worden niet als blijvend geïdentificeerde records behandeld. De vervolgstap kan
een leesquery in Onderzoeken klaarzetten, maar voert die niet uit. De selectie
verandert geen records, contextexports of opgeslagen voorkeuren. De vertalingen
gebruiken dezelfde berichtregistratie als de rest van de interface.

## Lokale AI als optionele uitbreiding

De gewone selectie-uitleg blijft feitelijk en lokaal berekend. **Vraag AI**
opent een afzonderlijk paneel met de gekozen database en broncontext. Dezelfde
module is via de bovenbalk bereikbaar. Een uitgeschakelde of onbereikbare AI
verandert de databasewerkplek niet in een foutscherm.

De browser praat uitsluitend met Governs eigen API. `AiConfig` leest de
serverinstellingen, standaard `AI_ENABLED=0`, en staat de ondersteunde lokale
provideradressen toe. De browser kan geen willekeurige URL, provider of model
instellen. `OllamaClient` gebruikt de lokale Ollama-API met begrensde tijd,
antwoordgrootte en zonder redirects of cloudfallback. De Ollama-server zelf moet
ook lokaal en passend afgeschermd worden ingesteld; de client kan die host-
en firewallconfiguratie niet bewijzen.

`AiContext` controleert geselecteerde tabellen en kolommen opnieuw in de actuele
catalogus van de expliciete database. Het geeft een begrensde momentopname met
bronnen en een verkortingsindicator terug. Het kopieert geen rijen, celwaarden,
recordsleutels, queryresultaten, opgeslagen onderzoeken of appconfiguratie uit de
browser naar de prompt. Vragen en tijdelijke gespreksgeschiedenis zijn wel
gebruikersinvoer voor het model. Commentaren en interfacebeschrijvingen blijven
onbetrouwbare brongegevens, geen systeeminstructies.

`AiService::prepareChat` valideert invoer en bouwt databasecontext op terwijl de
gedeelde onderhoudslock geldt. De HTTP-laag laat die lock daarna los. Projectcode
gebruikt geen catalogus en loopt zonder deze lock; dezelfde CSRF- en
databasescopecontrole blijven gelden.
`AiService::completeChat` doet alleen de provideraanroep en antwoordcontrole;
een trage modelgeneratie houdt daardoor geen herstelactie tegen. Het model heeft
geen SQL-tool of eigen databaseverbinding. SQL uit een antwoord wordt pas door
een expliciete gebruikersactie een concept in de bestaande querywerkplaats.
Die route bewaart de bestaande bevestiging voor het vervangen van een concept
en de gewone uitvoerings- en schrijfgrenzen.

Het paneel bewaart vraag, geschiedenis en bronnen per database en brongebied
in het geheugen van het tabblad. Dat is geen blijvende gespreksopslag. Databasewissels breken het
zichtbare verzoek af en wijzigen de revisie; een antwoord voor A komt niet in B.
Taal- en themawisselingen behouden de vraag. Stoppen annuleert het wachten in de
browser en belooft geen onmiddellijke stop van een al draaiend lokaal model.

Het brongebied **Projectcode** gebruikt `LocalCodeSearch` in plaats van
schemametadata. `AI_PROJECT_ROOT` komt uitsluitend van de server; zonder die
instelling gebruikt de broncheckout de projectmap. In Docker staan alleen de
mappen `app/` en `docs/` onder `/opt/govern/project`, als alleen-lezen mounts en
als kopie in de image. De browser kan geen mappen of bestandspaden kiezen.
De begrensde woordenindex ontstaat opnieuw per vraag en blijft alleen in geheugen;
er is geen blijvende index, modeltraining of nieuwe afhankelijkheid.

De lezer negeert symlinks, verborgen en uitgesloten mappen, niet-ondersteunde
tekst en herkenbare geheime bestanden. Regels met herkenbare letterlijke
geheimen of te lange inhoud worden volledig weggelaten. Dit is best effort,
geen universele geheimdetector. Resultaten bevatten exacte originele veilige
regels, een relatief pad en echte regelnummers. De hash hoort bij de geschoonde
bestandsmomentopname; interne markers voor weggelaten regels verschijnen alleen
in de hashberekening, niet in passages. Lokale zoekacties werken ook als
AI uit staat en hebben geen provider nodig.

Een projectchat zoekt opnieuw aan de serverkant en gebruikt geen oudere
chatberichten als projectbewijs. De provider moet een bestaande bron-ID en een
letterlijk citaat geven. `AiService` valideert ID en citaat en berekent het pad en
de bijbehorende regels zelf. Ontbrekende bronnen of ongeldige verwijzingen leiden
tot een korte onthouding in plaats van ongecontroleerde gegenereerde uitleg.
Projectantwoorden hebben altijd `sql:null`. De citatencontrole bewijst herkomst,
geen semantische juistheid van iedere uitspraak. Het vooraf getrainde model
behoudt zijn algemene kennis; de toepassing claimt geen exclusieve training op
het project.

De uitvoerige opzet, Windows/Docker-netwerkgrens, configuratie en regels voor
verdere uitbreidingen staan in [lokale AI](AI.md). Er wordt geen nieuw agent-
framework, vectoropslag of training toegevoegd om dit eerste pad mogelijk te
maken. Een toekomstige leesfunctie krijgt een afzonderlijke, begrensde
toegangslaag; de vrije SQL-runner is daarvoor geen veilige automatische tool.

## Flexibele Explore-werkplek

De route `#verkennen` voegt de eerdere verkenner en recordkaart samen in één
Database-weergave. `#verbanden` blijft een alias voor bestaande bookmarks.
Het schemadiagram toont tabellen; Explore toont geselecteerde rijen en de
verwijzingen die werkelijk op die rijen passen. Beide gebruiken de bestaande
databasekiezer, catalogus en leesrechten.

`RecordMap` bouwt op `Database` en `Catalog` en kent geen vast domeinmodel.
De service valideert tabel, volledige recordsleutel en relatie aan de actuele
catalogus, leest het bronrecord opnieuw en gebruikt gebonden waarden met
engine-specifiek gequote identifiers. Inkomende relaties worden uit dezelfde
catalogus afgeleid. Er is geen vrije SQL of schrijfverbinding in dit pad.
Alle delen van samengestelde sleutels en foreign keys behouden hun volgorde.
Sleutel- en relatiekolommen worden vóór PDO-conversie als engine-tekst gelezen.
Daardoor komt identiteit niet uit afgeronde numerieke previews. Edges leveren
volledige bron- en doelwaarden apart van eventueel verkorte recordvelden.

`record-map-records` levert een gepagineerde keuze van beginrecords.
`record-map` inspecteert een gekozen record of breidt één gekozen verwijzing
uit. De reactie bevat punten, lijnen, beschikbare verwijzingen en herkomst:
constraint, kolomparen, exacte sleutels, SQL en parameters. Pagina's laden
bewust bij; de kaart doet geen volledige databasescan of automatische
recursieve expansie. Niet-ondersteunde sleutels, views en externe schema's
krijgen een herkenbare grens in de interface.

`record-map.js` verzorgt canvas, bronbibliotheek en inspectie. Het zuivere
`record-map-model.js` beheert de identiteit van records en lijnen, selectie en
lokale presentatie. De bronbibliotheek kiest tabel en beginrecord; de vaste
werkpleknavigatie blijft daarvan los. Een tweede vaste tabelkiezer naast de
canvasbibliotheek wordt in Explore niet getoond.

Kaarten kunnen worden verplaatst, vastgezet en uit het werkvlak verborgen.
Orbit en Flow geven de kaart een andere indeling; Manual bewaart zelfgekozen
posities. Uitbreiden plaatst nieuwe buren zonder bestaande kaarten opnieuw te
rangschikken. Undo hoort alleen bij de canvaspresentatie: het schrijft geen
gegevens terug en herstelt geen verouderde bronrecords, lijnen of cursors na
opnieuw uitlezen. De bronbibliotheek en inspecteur kunnen worden verborgen,
verplaatst en in breedte aangepast; op smalle schermen is één lade tegelijk open.

Vragen horen bij dezelfde selectie, geladen records en relatiebeschrijvingen.
Leesbare labels veranderen geen identifiers of records. Sleutels, constraint-
namen en SQL zijn beschikbaar onder technische details. Het scherm maakt geen
AI-interpretatie of causale uitleg uit alleen een foreign key.

Openen in Records toont een afzonderlijk, opnieuw uitgelezen bronrecord met zijn sleutel, ook wanneer
het niet op de eerste tabelpagina staat. De huidige Explore-werkplek voegt geen
semantisch model, correlatieberekening, 3D-clustering of datakunst toe.
Er verschijnen alleen uitgelezen databaseverbanden.

Kaarttoestand staat in het bestaande per-scope werkplekgeheugen. De complete
verbinding/database/schema-identiteit voorkomt vermenging van gelijknamige
tabellen. Weggaan of wisselen annuleert leeswerk en negeert late antwoorden.
Recordpreviews worden niet naar `localStorage` of `sessionStorage` geschreven;
de bestaande per-tab keuze van de database blijft wel bewaard. Zie
[RECORD_MAP.md](RECORD_MAP.md) voor gebruik en grenzen.

## Schemavisualisatie

Schema groepeert tabeldetails (`#structuur`) en het diagram (`#schema`) onder
één primaire Database-taak. Vanuit tabeldetails kan de huidige tabel direct in
het diagram worden geselecteerd. Vanuit het diagram blijven Records en
tabeldetails bereikbaar voor de gekozen tabel. De visualizer gebruikt dezelfde glasmaterialen, vertaalsleutels
en instellingen als de andere schermen.

`GET schema` haalt de metadata in drie gebonden catalogusqueries op via de
leesverbinding. Alleen gedeclareerde foreign keys leveren verbindingen op;
samengestelde sleutels behouden alle kolomparen. Een verwijzing naar een ander
schema wordt niet aan een gelijknamige lokale tabel gekoppeld. Views blijven
zichtbaar zonder verzonnen afhankelijkheden. De API levert geen tabelrecords.

De browser houdt de schemametadata bij tijdens taalwisselingen en haalt die na
werkplekverversing opnieuw op. Filter, selectie en diagramtoestand staan los van
onderzoekconcepten en dashboardindeling. Tabelposities worden per database in
een eigen versie van browseropslag bewaard; verplaatsen wijzigt geen tabellen,
kolommen of sleutels in MariaDB.

De schemaverkenner gebruikt een compacte gereedschapsbalk naast de
hoofdnavigatie. Tabellen en Geselecteerd klappen hun bijbehorende paneel uit.
Klikken op de actieve tool klapt alleen de inhoud in; de balk blijft zichtbaar.
Selecteren in de tekening werkt de context automatisch bij terwijl de
toetsenbordfocus in de tekening blijft. Een bewust ingeklapt menu blijft dicht. De tab en open/dicht-
toestand blijven in de schermtoestand tijdens taalwisselingen en terugkeren naar
Schema; alleen tabelposities worden naar browseropslag geschreven.

De knop Wat kan ik hier doen? blijft beschikbaar in de gereedschapsbalk, ook
zonder tabellen. De schemagids beschrijft bestaande handelingen en opent als
native `dialog`. Tab en Shift+Tab blijven binnen de gids; sluiten, Escape en
klikken op de achtergrond geven de focus terug. Een taalwisseling herbouwt de
geopende gids in de gekozen taal. Het verlaten van Schema verwijdert de dialoog
en bijbehorende toestand. Er worden geen API-mutaties uitgevoerd door de gids.

Scrollen boven de tekening zoomt rond de muispositie. De handler normaliseert
pixel-, regel- en paginascroll en werkt ook bij Ctrl-/trackpadgebaren. Buiten de
tekening blijft gewone pagina- en menuscroll werken. Opruimen van de visualizer
verwijdert ook de scrollhandler. De bestaande zoomknoppen en toetsen blijven
beschikbaar.

## Vormgeving

`workspace-tools.js` verplaatst de bestaande werkplekbediening naar één
gegroepeerde popover. IDs, handlers, rechten, disabled/hidden-toestand en
actieve hulpmiddelen blijven bij de oorspronkelijke DOM-elementen. De
databasekiezer en primaire phpMyAdmin-knop blijven in de bovenbalk. De
non-modale popover gebruikt native focus en buitenklik, met een fallback voor
browsers zonder Popover API. Sluiten vóór een handeling geeft nieuwe dialogen
een zichtbare opener; de selectieaanwijzer gebruikt dezelfde Tools-knop als
focusroute wanneer zijn eigen bediening verborgen is. Er is geen extra
voorkeurenopslag, databaseactie of wijziging van de rechten.

Govern gebruikt een open g als merk, systeemlettertypen en glasvlakken met brede,
zachte schaduwen. Het standaardaccent is Lagoon; de gebruiker kan een ander
accent en een achtergrondtint kiezen. Er zijn lichte en donkere thema's en een
systeemstand. De materialen, kleuren, afrondingen en schaduwen staan als gedeelde
`--g-*` tokens bovenaan `app/public/assets/styles.css`. Bestaande componentnamen
gebruiken dezelfde tokens via aliassen, zodat een scherm geen eigen vormtaal
hoeft te krijgen.

Panelen, knoppen en instellingen gebruiken transparantie en achtergrondvervaging.
Tabellen en SQL krijgen dichter glas om leesbaar te blijven. Ruimte, zachte
vlakverschillen en diepte vervangen harde paneelranden en scheidingslijnen.
Toetsenbordfocus blijft duidelijk zichtbaar. Minder transparantie en ontbrekende
blur-ondersteuning vallen terug op effen leesvlakken. Verminderde beweging,
systeemcontrast en ruimere aanraakdoelen horen bij de gedeelde componenten.

Er zijn geen externe lettertypen of extra UI-bibliotheken nodig. Het omringende
databasevenster volgt Govern; de inhoud blijft de officiële phpMyAdmin-interface.
De volledige visuele regels, gebruikersstromen en uitbreidingsaanpak staan in
[de UX/UI-ontwerpdocumentatie](DESIGN.md).

## Taal en bewaarde schermtoestand

Elke browserfunctie registreert zijn Nederlandse en Engelse teksten onder
stabiele sleutels. `i18n.js` levert de actieve taal, vertaling en locale voor
getal- en datumweergave. De taalkeuze wordt in browservoorkeuren bewaard. Zonder
keuze wordt een ondersteunde browsertaal gebruikt, anders Nederlands.

Een taalwisseling werkt de eigen interface bij zonder een volledige paginaherlading.
De geselecteerde tabel, zoekopdracht, paginering, querytekst, builderkeuzes en
een nog niet bewaarde dashboardindeling blijven schermtoestand. Opgeslagen
onderzoeken blijven gegevens in de database; een tijdelijk concept wordt daarmee
niet ongemerkt gelijkgesteld.

De API kiest applicatiefeedback met `Accept-Language` en geeft bij gewone
JSON-antwoorden `Content-Language` terug. De bestaande fouttekst blijft bestaan,
met daarnaast een stabiele `error_code`, veilige `error_params` en vertaalkaarten.
Ook waarschuwingen, resultaatmeldingen en queryuitleg kunnen beide talen bevatten.
Daardoor kan bestaande feedback van taal veranderen zonder de SQL opnieuw uit te
voeren. Zie het [API-contract](API.md) voor de velden.

Identifiers, SQL, exacte waarden, notities, records en exportinhoud worden niet
vertaald. Een taalgebeurtenis herlaadt ook geen geopend phpMyAdmin-frame met
mogelijk onbewaarde invoer. De nieuwe taal wordt pas meegestuurd bij de volgende
expliciete opening, tab- of tabelkeuze of herlaadactie.

## Persoonlijke instellingen en dashboardblokken

`govern.preferences.v1` bevat taal en uiterlijk in de lokale browseropslag.
`govern.dashboard.v1` bewaart afzonderlijk de indeling. Hiervoor worden geen
backend-endpoints of databasetabellen toegevoegd. Deze voorkeuren gelden voor
dezelfde browser en oorsprong; account- of apparaatsynchronisatie is geen
onderdeel van deze opslag.

De opslag heeft een versie en valideert elk veld. Een ongeldig veld krijgt zijn
eigen standaardwaarde. Ondersteunde oude gegevens kunnen bij een bewuste opslag
migreren; onbekende toekomstige versies worden niet overschreven. Als opslag
niet lukt, blijft de huidige sessie bruikbaar en krijgt de gebruiker daarover
feedback. Uiterlijk herstellen wist geen dashboardindeling of databasegegevens.

Een klein blokregister beschrijft vaste blok-ID's, vertaalsleutels en standaard-
en toegestane breedtes. De betreffende schermfunctie bepaalt de inhoud en acties;
`dashboard-layout.js` bewaart alleen de indelingsgegevens. Nieuwe blokken komen
achter bestaande keuzes; verborgen of tijdelijk onbekende blokken behouden hun
instellingen. Er is geen kopie van het relationele gegevensmodel nodig.

Indeling aanpassen maakt een aparte conceptversie. Verplaatsen werkt met slepen
en met knoppen; breedte en zichtbaarheid zijn in dezelfde modus beschikbaar.
Bewaren past de indeling toe, annuleren verwerpt alleen dat concept. Onafhankelijke
wijzigingen uit andere tabbladen worden waar mogelijk samengevoegd. Mobiel gebruikt
dezelfde volgorde in één kolom, met behoud van de desktopbreedtes.

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
vrije SQL-route. De ontwerproute gebruikt de leesverbinding met leesrechten,
tijdslimiet en resultaatweergave.

De vrije SQL-route is bewust ruimer: `QueryRunner::executeScript` voert gewone
SQL-opdrachten uit op een eigen schrijfsessie (`Database::scriptConnection`, UTC,
strikte beginmodus, tijdslimiet, `LOCAL INFILE` uit). `SqlScript::next` verwerkt
`DELIMITER`, quotes en commentaar, inclusief uitvoerbaar commentaar. Gewone
letterlijke `SET sql_mode`-toewijzingen worden lokaal gevolgd; de native
driverstatus levert de backslash-escape-instelling zonder extra SQL. Procedures,
functies en triggers met een samengestelde body gebruiken dezelfde route. De
grenzen bij dynamisch berekende modi staan in het API-contract.

De voorcontrole voert geen SQL uit. Zij vraagt bevestiging voor herkende
ingrijpende opdrachten (`DROP`, `TRUNCATE`, `DELETE`/`UPDATE` zonder `WHERE`,
`ALTER ... DROP`). Na modewijzigingen of dynamische SQL kan het resterende
aantal opdrachten onbekend zijn en kan potentieel ingrijpende tekst conservatief
worden gemarkeerd. Dit blijft een bedieningsstap, geen beveiligingsgrens of
volledige SQL-analyse; de rechten van het schrijfaccount blijven de echte grens.

`PDOStatement::nextRowset` bewaart alle resultaten van een `CALL`. De eerste set
blijft ook onder de bestaande resultaatvelden beschikbaar. Iedere set krijgt
een begrensde voorvertoning. `PDO::connect()` levert de native `Pdo\Mysql`-driver:
`getWarningCount()` bewaart de waarschuwingenteller zonder een extra SQL-opdracht.
Gewone gebruikersopdrachten blijven naast elkaar staan, zodat `ROW_COUNT()`,
`FOUND_ROWS()` en de waarschuwingen niet door verborgen diagnostiek worden
overschreven. Alleen na de laatste gebruikersopdracht worden maximaal twintig
beschikbare waarschuwingsteksten gelezen; voor een eerdere stap kan het script
zelf `SHOW WARNINGS` opnemen. De uitvoering stopt bij de eerste fout en
behoudt eerdere resultaten en al geproduceerde sets van een deels mislukte
procedure. De selectieuitleg behandelt deze vrije resultaten als momentopnamen
zonder veronderstelde tabel of primaire sleutel.

De sessie bestaat één uitvoering. Transacties, variabelen en tijdelijke tabellen
blijven binnen dat script bruikbaar. Een open transactie wordt aan het einde
expliciet teruggedraaid en als zodanig gemeld; `COMMIT` moet in dezelfde uitvoering
staan. Reeds gecommitte wijzigingen en impliciete DDL-commits zijn daarmee niet
ongedaan gemaakt. Na vrije SQL wordt de catalogus ververst, ook als een procedure
verborgen wijzigingen uitvoerde. SQL, resultaten, focus en invoerpositie blijven
bij dat verversen behouden. Zie [het API-contract](API.md#free-sql-scripts) voor
de resultaatvelden en voorvertoningsgrenzen.

Het ontwerp is tijdelijke schermtoestand. Opgeslagen onderzoeken blijven gewone
SQL in `_govern_queries` van de geselecteerde database; een nieuw opslagmodel
of een kopie van de catalogus is daarvoor niet nodig. Uitbreidingen kunnen later extra SQL-onderdelen toevoegen
aan deze compiler zonder de tabellen of opgeslagen onderzoeken te migreren.

De PHP-container gebruikt versie 8.4. De MySQL-parser van PDO in deze versie
herkent gequote identifiers, ook wanneer een kolomnaam op een parameter lijkt.
Dat voorkomt een extra beperking op zelfgekozen namen en houdt native gebonden
waarden mogelijk. De integratietest bevat daarvoor een kolomnaam met een
dubbelepunt en een backtick. Zie de [PHP-documentatie](https://www.php.net/manual/en/migration84.new-features.php#migration84.new-features.pdo-mysql).

## Rechten

Govern gebruikt twee verbindingen naar de geselecteerde database. De eerste mag
onderzoeken en metadata lezen. Leestransacties beschermen ook tegen schrijvende
functies die via een zelfgemaakte view zouden worden aangeroepen. De tweede slaat
eigen instellingen op, maakt herstelpunten en voert vrije SQL uit. Vrije SQL en
phpMyAdmin gebruiken hetzelfde schrijfaccount. Gewone catalogus- en rijacties
blijven bij de geselecteerde database; vrije SQL kan via `USE` of gekwalificeerde
namen ook andere reeds toegestane databases bereiken. Er worden voor de
SQL-editor geen extra of globale serverrechten toegevoegd; ontbrekende rechten
blijven een gewone databasemelding.

De Compose-service `database-access` draait na een gezonde MariaDB en vóór de
app en phpMyAdmin. Het rootwachtwoord blijft in de databasecontainer, deze
opstartservice en de afzonderlijke privéservice `database-manager`; de webapp en
phpMyAdmin krijgen het niet. De opstartservice gebruikt de expliciete `DB_DATABASES`-lijst plus
`DB_NAME`, maakt ontbrekende schemas leeg aan en verleent schrijver ALL en lezer
SELECT/SHOW VIEW per exacte naam. Bestaande volumes worden niet opnieuw gevuld
en bestaande accountwachtwoorden blijven behouden. Opnieuw starten past dezelfde
grants toe; verwijderen uit de lijst trekt oude grants niet automatisch in.

De opstartlijst accepteert letters, cijfers en underscores, met een begrensde
naam-/grantlengte en zonder systeemdatabases. Underscores worden in GRANT-patronen
geëscapet. Bekende oude, ongeëscapete grants voor de standaarddatabase worden
vervangen door de exacte variant, zodat een underscore geen andere databasenaam
dekt. Er worden geen `*.*`-rechten verleend. Bestaande handmatig verleende
databasenamen worden via de live catalogus ontdekt, ook buiten de opstartlijst.

Dit is geen algemene beveiligde hostingdienst. De lokale ingang is bereikbaar
voor de gebruiker van de computer. Een publieke installatie vraagt een andere
toegangslaag; dat staat los van het gegevensmodel en kan later worden toegevoegd.

## Herstel

Herstelpunten zijn SQL-bestanden met metadata en SHA-256. Het id wordt door de
server gemaakt; download- en herstelverzoeken kiezen geen willekeurig pad.
De databaseclients worden met losse argumenten gestart. Een wachtwoord wordt
niet in de zichtbare procesargumenten gezet.

De standaarddatabase houdt zijn bestaande `BACKUP_DIR`, zodat oude herstelpunten
zichtbaar blijven. Andere databases gebruiken een submap
`databases/<sha256(databasenaam)>`. De manifestcontrole vereist dezelfde
databasenaam en een geldig controlegetal; een snapshot-ID kiest nooit een
willekeurig bestand of een andere database.

`maintenance_dir` wijst voor alle databases naar de oorspronkelijke backup-root.
Gewone appgegevens- en onderzoeksverzoeken nemen daar dezelfde gedeelde lock;
export en herstel nemen een exclusieve lock. Eén lock per database zou onjuist
zijn, omdat vrije SQL vanuit de ene database met `USE` de andere kan wijzigen.
Databasediscovery blijft beschikbaar voor de herstelroute. Zelfstandige
phpMyAdmin-opdrachten volgen deze applicatielock niet; stop dat werk tijdens
een export of herstel.

Terugzetten vervangt de geselecteerde werkdatabase en controleert het resultaat
van de client. Er wordt vooraf een veiligheidskopie gemaakt. Een fout tijdens
een DDL-import start, als er een veiligheidskopie is, een poging om de vorige
toestand te herstellen. Ook dat herstel kan mislukken en een gedeeltelijke
toestand achterlaten; de veiligheidskopie blijft beschikbaar. De foutketen en
de bijbehorende herstelpunt-ID blijven behouden. Een succesvolle procedure
wordt niet als een universele SQL-undo gepresenteerd.

## Verder uitbreiden

- Een grafiek kan de resultaten van een opgeslagen onderzoek gebruiken.
- De visuele querybouwer kan worden uitgebreid met groeperingen of meer koppelingen.
- Een schema-ontwerper kan gewone SQL genereren en de wijziging eerst laten zien.
- Een nieuw datasettype wordt als gewone tabel ingevoerd.
- De optionele lokale AI kan later expliciete, begrensde gegevensleesfuncties of
  extra documentbronnen krijgen. De huidige projectzoeker blijft beperkt tot
  `app/` en `docs/`; verruiming volgt het contract en de fasering in `docs/AI.md`.

Voeg mogelijkheden toe aan het bestaande pad zolang dat duidelijk blijft. Een
extra service, database of abstractie is een keuze met kosten, geen vereiste om
uitbreidbaar te zijn.

Een toevoeging begint bij de taak, ingang, uitkomst en route terug. Hergebruik
de gedeelde componenten, vertaalsleutels, materialen en fouttoestanden voordat
er nieuwe patronen worden toegevoegd. Verbind één volledige gebruikersstroom
met de bestaande API en catalogus en behoud geldige concepten en voorkeuren.
Nieuwe appgegevens gebruiken waar nodig de `_govern_` naamruimte en een
afzonderlijke migratie; een visuele wijziging vervangt nooit de werkdatabase.
Werk de ontwerpdocumentatie en het API-contract in dezelfde wijziging bij.

## Bronnen voor de infrastructuur

- [Docker Compose](https://docs.docker.com/compose/)
- [Docker volumes](https://docs.docker.com/engine/storage/volumes/)
- [phpMyAdmin Docker-installatie](https://docs.phpmyadmin.net/en/latest/setup.html#installing-using-docker)
- [phpMyAdmin-configuratie](https://docs.phpmyadmin.net/en/latest/config.html)
- [MariaDB SQL-exports](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump)
- [Ollama chat-API](https://docs.ollama.com/api/chat)
- [Ollama-modelstatus](https://docs.ollama.com/api/tags)


## Gedeelde import voor tabelbestanden

De taak begint in Database openen → Bestanden importeren: lokaal bestand kiezen,
voorvertonen, werkblad en bestemming controleren, expliciet bevestigen, importeren
naar de zichtbare database en terugkeren naar de gewone live tabelverkenner.
`DatasetImportPanel` bewaart tijdelijke bestands- en formulierconcepten per database.
Taalwisselen behoudt het concept. Tijdens een verzoek blokkeren sluiten, tabwisselen
en databasewisselen. Verzoeken houden hun oorspronkelijke database vast.

`tabular.py` leest XLSX via de standaard ZIP/XML-lezer, CSV/TSV/TXT via `csv` en JSON
via `json`/`decimal`. Geen netwerk, macro's, formule-evaluatie of uitgepakte paden.
Elke lezer levert dezelfde beschrijving met kolommen, exacte tekstwaarden, NULL,
rijaantallen en kwaliteitskenmerken. Een nieuwe lezer kan dat contract hergebruiken.
Python draait als afzonderlijk lokaal proces zonder databasecredentials als argumenten.
De procesomgeving is geërfd, maar de lezer gebruikt geen configuratie of netwerk.
Bestandsgrootte, archiefinhoud, kolommen, rijen, CPU en procesgeheugen zijn begrensd.

`DatasetImport` controleert de upload en voert alleen de door de gebruiker gekozen
schrijfhandeling uit. Voorbeeld en import lezen het bestand onafhankelijk opnieuw.
De SHA-256 uit het voorbeeld moet gelijk blijven. Beide routes controleren de gewone
host-, origin-, sessie-, CSRF- en databasescopegrens. De lezer loopt vóór het nemen
van de gedeelde onderhoudslock. Import zelf deelt de lock met andere appverzoeken.

Nieuwe tabelnamen gebruiken een begrensde ASCII-regel. De tabel wordt eerst onder
een willekeurige interne naam gevuld en pas daarna zonder overwrite hernoemd.
Een fout ruimt alleen deze stagingtabel op. Bij een procescrash kan een interne
stagingtabel achterblijven. Bestaande tabellen komen uit de catalogus en moeten
InnoDB gebruiken, passende tekstkolommen hebben en hetzelfde structuurfingerprint
houden. Een metadata-lock houdt hun structuur vast tijdens het transactionele
invoegen. Een rijfout draait de volledige append terug. Externe SQL kan daarnaast
actief blijven. Er is geen algemene undo of automatische deduplicatie; ook een
expliciete tweede append voegt opnieuw toe. Een verloren HTTP-antwoord moet de
gebruiker eerst via de tabel controleren.

De voorbeeldgrafiek gebruikt alleen twintig voorbeeldrijen en zegt dat zichtbaar.
Deze fase maakt geen relaties op grond van kolomnamen, geen blijvende grafieken en
geen geografische weergave. De bestaande catalogus toont geïmporteerde tabellen na
sluiten van het databasevenster. SQL blijft bij officiële phpMyAdmin.
