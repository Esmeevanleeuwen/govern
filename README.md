# Govern

Je persoonlijke werkplek om databases te bekijken, begrijpen en veranderen.
Bestuursatlas is het eerste oefenproject. Je werkt lokaal in één browservenster.

## Beginnen

Installeer en start Docker Desktop. Download deze repository en pak de map uit.

- **Windows:** dubbelklik op `start.cmd`.
- **macOS / Linux:** open een terminal in deze map en voer `sh start.sh` uit.

De eerste start haalt de onderdelen op, maakt lokale wachtwoorden aan en vult
een nieuwe database met de Bestuursatlas. Open daarna
[http://localhost:8080](http://localhost:8080).

Je hoeft PHP, Node, Composer of MariaDB niet zelf te installeren. Docker Compose
moet de optie `--wait` ondersteunen; een actuele Docker Desktop bevat die. Je bestaande
database buiten Docker wordt niet aangeraakt. De wachtwoorden staan alleen in
je lokale `.env`, die niet in Git wordt opgenomen.

## Wat kun je ermee?

- **Overzicht:** zie welke tabellen en overzichten je database bevat.
- **Nederlands of Engels:** verander de taal bovenaan of bij Instellingen. Je
  tabellen, records, SQL en notities houden hun oorspronkelijke tekst.
- **Je eigen werkplek:** kies bij Instellingen een accentkleur, achtergrondtint,
  licht/donker/systeem, minder transparantie en de plaats van je navigatie.
- **Dashboard indelen:** verplaats, verbreed of verberg blokken via
  **Indeling aanpassen**. Je kunt slepen of de verplaatsknoppen gebruiken.
- **Gegevens:** bekijk records, zoek, blader en bekijk de gebruikte SQL.
- **Structuur:** lees velden, sleutels, relaties en de echte tabeldefinitie.
- **Schema:** bekijk alle tabellen, kolommen en foreign keys in een interactief
  diagram. Scroll boven de tekening om rond je muisaanwijzer te zoomen en sleep
  de achtergrond om te verschuiven. Het tweede menu toont automatisch de
  gekozen tabel en haar verbindingen. Klik op een tool om het paneel uit te
  klappen, of nogmaals op de actieve tool om het in te klappen. **Wat kan ik
  hier doen?** opent een korte uitleg van alle mogelijkheden in dit scherm.
- **Onderzoeken:** voer leesvragen uit, bekijk resultaten en bewaar queries met uitleg.
- **Visueel samenstellen:** kies een tabel, kolommen, filters en een sorteervolgorde.
  Voeg eventueel een bestaande verwijzing naar een tweede tabel toe. Govern maakt
  de SQL zichtbaar; je kunt die daarna zelf aanpassen.
- **Experimenten:** maak een herstelpunt, download het als SQL en zet het terug.
- **Databasevenster:** open de echte phpMyAdmin in een groot venster met de tabs
  **Browse**, **Structure** en **SQL**. Hier kun je ook invoegen, aanpassen,
  verwijderen, tabellen ontwerpen, importeren en exporteren.
- **Context exporteren:** neem je databasestructuur en opgeslagen onderzoeken
  mee naar een gesprek met ChatGPT. Tabelrecords en wachtwoorden worden niet
  meegenomen. De opgeslagen SQL en notities zijn wel onderdeel van die export.

De eigen schermen lezen de actuele database. Een nieuwe tabel wordt na verversen
zichtbaar; je hoeft daarvoor geen nieuw onderdeel te programmeren. phpMyAdmin
blijft zijn volledige interface tonen, inclusief functies buiten de drie snelkeuzes.

Taal, uiterlijk en dashboardindeling worden in deze browser bewaard. Je keuzes
blijven bij verversen behouden en veranderen geen databasegegevens. Als de browser
bewaren blokkeert, werkt je keuze voor de huidige sessie en krijg je daar een melding
over. **Uiterlijk herstellen** wist geen onderzoeken of dashboardindeling.

De glasschermen gebruiken gedeelde kleuren, zachte schaduwen en geen harde
paneelranden. Het ontwerp en de regels voor uitbreidingen staan in
[de UX en UI documentatie](docs/DESIGN.md).

## Eerste oefening

1. Open **Gegevens** en kies `digital_systems`.
2. Bekijk de beschrijving van een systeem en de SQL achter het overzicht.
3. Open **Structuur** en zoek de verwijzing `evidence_id`.
4. Volg de onderbouwing in `evidence` en de bronkoppeling in `evidence_sources`.
5. Maak bij **Experimenten** een herstelpunt voordat je iets verandert.
6. Open **Databasevenster → Browse**, pas een beschrijving aan en ververs het
   eigen gegevensscherm. Je ziet dezelfde opgeslagen wijziging.

Zo leer je met echte gegevens wat een tabel, een verwijzing en een query doen.
De korte uitleg in het scherm is vaste uitleg over deze handeling; er wordt geen
extern AI-model aangeroepen.

### Een vraag maken zonder eerst SQL te schrijven

Open **Onderzoeken → Query samenstellen**. Kies `digital_systems`, selecteer
bijvoorbeeld `code` en `name`, en voeg een filter op `name` toe met de waarde
`DigiD`. Met **Query maken** zet je het ontwerp in de SQL-editor. Kies daarna
**Query uitvoeren** om het resultaat te bekijken en **Onderzoek bewaren** om de
vraag opnieuw te kunnen gebruiken.

Zolang je de gegenereerde SQL niet bewerkt, voert Govern het ontwerp uit met
gebonden filterwaarden. Zodra je zelf in de SQL-editor schrijft, gebruik je de
gewone SQL-route. Opgeslagen onderzoeken blijven zelfstandige SQL-vragen; er is
geen tweede bestandstype of apart gegevensmodel voor de bouwer.

De visuele bouwer helpt bij één basistabel en eventueel één bestaande verwijzing.
Voor bijvoorbeeld meerdere koppelingen, groeperingen of berekeningen werk je
verder in de SQL-editor. De voorbeelden in de bouwer hebben dezelfde grens van
200 resultaatrijen als de onderzoekweergave.

## Gegevens en herstelpunten

Er is één normale MariaDB-database. De applicatie gebruikt enkele tabellen met
het voorvoegsel `_govern_` voor opgeslagen onderzoeken en phpMyAdmin-instellingen.
Deze blijven via phpMyAdmin bereikbaar. De gewone gegevensschermen laten de
inhoudelijke tabellen zien.

De database staat in een Docker-volume en blijft behouden bij stoppen of opnieuw
opbouwen van de containers. Dat volume is geen terugdraaifunctie. Herstelpunten
zijn afzonderlijke SQL-exports met een controlegetal en tijdstip.

Bij herstellen typ je de databasenaam. Govern maakt eerst een veiligheidskopie
van de huidige toestand en zet daarna het gekozen herstelpunt terug. Ook tabellen
die je na dat herstelpunt toevoegde, verdwijnen uit de herstelde database.
Als de database al verwijderd is, kan er geen veiligheidskopie meer van die
toestand worden gemaakt. Het gekozen herstelpunt blijft wel beschikbaar.

Voer tijdens een export of herstel geen opdrachten uit in een ander
phpMyAdmin-venster. De eigen API-acties worden onderling vergrendeld; een al
lopende externe SQL-opdracht wordt daarmee niet automatisch stilgezet.
Een tabelwijziging is niet altijd terug te draaien met een SQL-transactie.

Download belangrijke herstelpunten naar een andere map of schijf. De knop
**Herstellen** werkt met de door deze installatie gemaakte herstelpunten.
Andere SQL-bestanden kun je via phpMyAdmin importeren.

### Bestaande gegevens

Bij de eerste start wordt het eerder gemaakte Bestuursatlas-ontwerp ingeladen:
23 inhoudelijke/ondersteunende tabellen, 3 views en 96 voorbeeldrecords. Het
automatische auditlog is in deze basisvulling niet geactiveerd.

Eigen wijzigingen uit je eerdere phpMyAdmin-installatie worden niet automatisch
overgenomen. Exporteer die database als je ze mee wilt nemen. Maak vóór een
vervangende import een herstelpunt van de Docker-database en controleer in
phpMyAdmin welke database geselecteerd is.

Een bestaande Docker-database wordt bij herstart niet opnieuw gevuld. Gewijzigde
startwachtwoorden worden door MariaDB ook niet automatisch op bestaande accounts
toegepast. Bewaar daarom je lokale `.env` bij deze installatie.

## Stoppen en opnieuw starten

Vanuit de projectmap:

```sh
docker compose stop
docker compose up -d
```

Na wijzigingen aan de PHP-image of de meegebouwde bronbestanden:

```sh
docker compose up -d --build
```

Gebruik `docker compose logs --tail=100` om een startfout te bekijken. Verwijder
geen volumes om een gewone startfout op te lossen; daar staan je gegevens.

## Een nieuwe versie ophalen

Werk bij in dezelfde projectmap. Download de nieuwe ZIP van GitHub en kopieer de
projectbestanden over de oude versie. **Bewaar je bestaande `.env`**: daarin staan
de wachtwoorden die bij jouw bestaande database horen. Start daarna opnieuw met
`start.cmd` of `sh start.sh`. Je database en herstelpunten blijven in hun bestaande
Docker-volumes staan; de eerste voorbeeldimport wordt niet opnieuw uitgevoerd.

Werk je al met Git, dan kun je vanuit deze map `git pull --ff-only` gebruiken en
daarna hetzelfde startbestand uitvoeren. Heb je zelf code aangepast, bewaar of
combineer die wijzigingen voordat je projectbestanden vervangt.

## Samen verder bouwen

De broncode blijft klein en rechtstreeks te volgen:

- `app/src/`: verbindingen, catalogus, onderzoeken en herstelpunten.
- `app/public/api.php`: HTTP-ingang met een vast JSON-formaat.
- `app/public/assets/`: herbruikbare browseronderdelen en stijlen.
- `docker/`: de lokale omgeving en de Bestuursatlas-startgegevens.
- `tests/`: controles van echte gebruikershandelingen.
- `docs/`: afspraken, uitleg en de API.

Begin bij [de architectuur](docs/ARCHITECTURE.md) en
[leren met Govern](docs/LEARNING.md). De uitgevoerde controles en commando's om
ze te herhalen staan bij [validatie](docs/VALIDATION.md). Het systeem is een gewone PHP-app met
JavaScriptmodules en SQL. De gegevens zitten niet vast in een eigen bestandstype
of een verzameling aparte services per onderwerp.

## Toegang

De ingang is alleen aan `127.0.0.1` gekoppeld. Dit is een persoonlijke lokale
werkplek zonder bezoekersaccounts. Iedereen die jouw lokale ingang kan gebruiken,
kan de gekoppelde werkdatabase beheren. De phpMyAdmin-verbinding heeft rechten
voor deze database; serverbeheer en andere databases vallen daar niet onder.

**Onderzoeken** gebruikt een apart databaseaccount met leesrechten. Voor
schrijvende SQL en structuurwijzigingen gebruik je het databasevenster. Die
scheiding beperkt de gewone onderzoeksknop, niet de mogelijkheden in je
persoonlijke phpMyAdmin-venster.

De interface en configuratie zijn niet bedoeld om rechtstreeks openbaar op
internet te zetten. Voor delen of publiceren hoort eerst authenticatie en een
passende toegangsconfiguratie te worden toegevoegd.
