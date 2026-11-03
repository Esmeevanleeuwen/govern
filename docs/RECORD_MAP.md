# Explore: records en verbindingen

Explore toont echte records binnen de gekozen database en het gekozen schema.
Een kaart is één herkenbaar record. Een lijn ontstaat wanneer records bij
elkaar passen volgens een gedeclareerde foreign key. Indeling en verplaatsing
vertellen niets over belang, afstand of oorzakelijkheid.

## Waar staat wat?

- **Database → Records:** gewone tabelrijen bekijken, zoeken en bewerken.
- **Database → Explore:** records selecteren, verbindingen volgen en inspecteren.
- **Database → Schema:** tabeldetails en het schemadiagram.
- **Database → Tools:** import, export en herstelpunten. Import/export gebruikt
  de bestaande officiële phpMyAdmin-integratie waar deze beschikbaar is.
- **Onderzoeken:** querybouwer, SQL en opgeslagen onderzoeken.

De databasekiezer blijft bovenaan staan. De route voor Explore is `#verkennen`;
een oude `#verbanden`-link opent dezelfde werkplek. Schema blijft over tabellen
gaan; Explore gaat over hun records.

## Beginnen

1. Open **Database → Explore** en open **Sources**, de bronbibliotheek.
2. Kies een tabel en zoek of blader naar een beginrecord.
3. Selecteer het record. De inspecteur toont de beschikbare inkomende en
   uitgaande verwijzingen. Technische sleutels en SQL staan onder Details.
4. Vouw een verwijzing uit om passende records toe te voegen. Een vraag zoals
   **Show linked …** gebruikt dezelfde echte verwijzing. Bij meer resultaten
   laad je bewust een volgende pagina.
5. Selecteer een andere kaart of lijn om de bijbehorende herkomst te lezen.
   **Explore from here** gaat verder vanaf een gekozen record; **View row**
   leest precies dat bronrecord opnieuw uit in Records.

De kaart, bronbibliotheek, vragen en inspecteur werken met dezelfde selectie.
Er is geen afzonderlijk Guided- en Detailed-scherm dat nog een tweede
verkenner of tabelkiezer toevoegt. Details zijn op verzoek beschikbaar.

## Het werkvlak aanpassen

Sleep een kaart om haar positie te veranderen. Sleep de achtergrond om het
werkvlak te verschuiven; zoom en passend maken blijven ook via knoppen
bereikbaar. Shift-selectie voegt kaarten toe aan een meervoudige selectie.
Kleur helpt tabelsoorten herkennen, maar de labels blijven leidend.

**Orbit** en **Flow** ordenen de kaarten opnieuw. **Manual** bewaart de zelf
gekozen posities. **Pin** houdt een kaart bij opnieuw indelen op haar plaats.
Een uitbreiding plaatst nieuwe buren zonder bestaande kaarten opnieuw te
rangschikken. Er is geen voortdurend bewegende simulatie.

**Hide** verbergt kaarten alleen in deze presentatie. Tabelfilters verbergen
categorieën zonder de geladen records als databaseobject te verwijderen.
**Show all loaded records** maakt verborgen geladen records weer zichtbaar.
Deze handeling haalt niet automatisch alle records van de database op.

**Undo** herstelt een vorige canvaspresentatie, zoals een verplaatsing,
indeling, pinstatus of zichtbaarheid. Na een uitbreiding kan Undo de nieuwe
kaarten weer verbergen; het draait de gelezen databasegegevens niet terug.
Verouderde bronrecords, lijnen en paginacursors worden niet teruggehaald.
**Clear map** leegt de geladen kaart en begint opnieuw; dit is geen
presentatiehandeling die met Undo kan worden hersteld en verwijdert geen databasegegevens.

De bronbibliotheek en inspecteur kunnen worden verborgen, verplaatst en in
breedte aangepast. De hoofdnavigatie blijft op haar vaste plaats. Op smalle
schermen is één lade tegelijk open. Sluiten van een paneel sluit de kaart niet.
Toetsenbord- en aanraakbediening blijven naast slepen beschikbaar.

## Geladen records en grenzen

De kaart laadt alleen wat je opvraagt. Een volgend resultaatblad is een
bewuste handeling. Geladen aantallen zijn geen volledige databaseaantallen.
Een melding dat er meer resultaten zijn betekent dat nog niet alle buren
van die verwijzing in de kaart staan.

Een record heeft een volledige primaire sleutel of een geschikte unieke
sleutel zonder nullable velden nodig. Een leesbaar label is nooit de
identiteit. Grote gehele getallen blijven tekstwaarden, zodat de browser
hun precisie niet verliest. Grote tekst- en binaire velden kunnen herkenbaar
verkort worden; exacte sleutels blijven afzonderlijk behouden.

Views, tabellen zonder ondersteunde identiteit, binaire recordsleutels en
niet-ondersteunde sleuteltypen krijgen een melding. Gelijknamige tabellen
in andere schema's worden niet als hetzelfde object behandeld. Externe
schema- of databaseverwijzingen blijven herkenbare grenzen; een lege nullable
foreign key maakt geen verzonnen doelrecord.

De werkplek werkt met MariaDB en PostgreSQL. Een lege database blijft leeg:
Explore voegt geen voorbeelddata toe. De bestaande expliciete PostgreSQL-
voorbeeldlader is een afzonderlijke gebruikershandeling.

## Gegevens, selectie en herkomst

Records en lijnen hebben stabiele IDs met verbinding, database, schema,
tabel en volledige recordsleutel. De browsersessie houdt de geladen kaart,
selectie en indeling per volledige scope apart. Wisselen annuleert oud
leeswerk en negeert antwoorden uit een vorige scope. Recordpreviews worden
niet in `localStorage` of `sessionStorage` opgeslagen.

De inspecteur toont bij een lijn de constraintnaam, geordende kolomparen,
volledige overeenkomende bron- en doelwaarden, recordsleutels en de gebruikte
SQL met parameters. Relatiewaarden komen niet uit een verkorte veldpreview. Samengestelde en
zelfverwijzende foreign keys houden hun werkelijke identiteit. Een lijn
beschrijft een databaseverwijzing; zij bewijst geen inhoudelijke invloed of
causaal verband. Er worden geen AI-relaties verzonnen.

Alle kaartvragen gebruiken de bestaande leesverbinding. Authenticatie,
CSRF-controle voor POST, expliciete databasescope en de onderhoudslock
blijven gelden. De browser kan geen SQL of andere verbinding opgeven.
Bewegen, selecteren, filteren, pinnen, uitbreiden en undo veranderen geen
rijen, schema's, accounts of rechten.

Zie [API.md](API.md) voor het actuele map-contract en het compatibele
`GET explore`, en [ARCHITECTURE.md](ARCHITECTURE.md) voor de herbruikbare
onderdelen.
