# Verbanden tussen records

De recordkaart laat zien hoe echte records binnen de gekozen database en het
gekozen schema met elkaar verbonden zijn. Een punt is één herkenbaar record.
Een lijn ontstaat wanneer de velden van twee records overeenkomen volgens
een gedeclareerde foreign key.

## Beginnen

1. Open **Database → Verbanden**. De directe werkplekroute is `#verbanden`.
2. Kies een tabel en zoek of blader naar een beginrecord.
3. Selecteer het record om zijn gegevens en verwijzingen te inspecteren.
4. Vouw een inkomende of uitgaande verwijzing uit om verbonden records toe te
   voegen. Laad volgende pagina's wanneer er meer resultaten zijn.
5. Selecteer een lijn om de constraint, bron- en doelvelden, exacte waarden en
   gebruikte query te bekijken. Open het bronrecord in Gegevens om het opnieuw
   uit te lezen naast de gewone tabelweergave.

Dezelfde kaart werkt met MariaDB en PostgreSQL. De databasekiezer blijft de
verbinding, database en het schema bepalen. Een nieuwe lege database toont een
lege toestand; de kaart maakt of importeert geen gegevens.

## De kaart lezen en bedienen

Het puntlabel gebruikt een beschikbaar leesbaar veld, zoals naam, titel of
code. De volledige recordsleutel blijft afzonderlijk zichtbaar in de
inspecteur; een label is geen identiteit. Grote tekst- en binaire velden kunnen
een herkenbaar verkorte weergave hebben. Exacte sleutels blijven behouden.

Selecteer een punt voor zijn record en uitvouwbare verwijzingen. Selecteer een
lijn voor de herkomst van het verband. Samengestelde foreign keys behouden
alle kolomparen. Een zelfverwijzing blijft een echte verwijzing naar hetzelfde
of een ander record in dezelfde tabel.

Gebruik tabelfilters om categorieën op de kaart te tonen of te verbergen.
Je kunt punten verplaatsen, het werkvlak verschuiven, zoomen en de geladen
kaart passend maken. De selectie en inspecteur blijven ook met toetsenbord en
aanraken bereikbaar. Wissen leegt de geladen kaart, niet de database.

De kaart laadt alleen wat je opvraagt. Een volgend resultaatblad is een
bewuste handeling. De melding dat er meer resultaten zijn betekent dat de
huidige kaart nog niet alle buren van die verwijzing toont. De kaart is geen
garantie dat alle records of alle verbanden in de database zijn geladen.

## Welke records en relaties zijn beschikbaar?

Een record heeft een volledige primaire sleutel of een geschikte unieke
sleutel zonder nullable velden nodig. Daarmee kan Govern hetzelfde record
later exact terugvinden. Grote gehele getallen blijven tekstwaarden, zodat
de browser hun precisie niet verliest.

Views, tabellen zonder ondersteunde identiteit, binaire recordsleutels en
niet-ondersteunde sleuteltypen krijgen een duidelijke melding. Gelijknamige
tabellen in andere schema's worden niet stil als hetzelfde object behandeld.
Externe schema- of databaseverwijzingen zijn zichtbaar als grens, maar worden
in deze eerste versie niet over die grens uitgebreid. Een lege nullable
foreign key maakt geen verzonnen doelrecord.

Een lijn beschrijft de databaseherkomst van een verband. Deze versie maakt
geen AI-suggesties, semantische gelijkenissen, correlatiematrices, 3D-clusters
of generatieve kunst. De kaart gebruikt geen model om ontbrekende relaties
in te vullen.

## Gegevens, selectie en herkomst

Punten en lijnen hebben stabiele IDs die de verbinding, database, het schema,
de tabel en de volledige recordsleutel onderscheiden. Binnen de huidige
browsersessie bewaart Govern de geladen kaart en selectie per volledige
scope. Terugkeren naar een andere scope mengt geen records of late antwoorden.
De opgehaalde recordpreviews worden niet in `localStorage` of `sessionStorage`
opgeslagen.

De herkomstinspecteur toont bij een lijn de constraintnaam, kolomparen,
bron- en doelsleutels, gequote tabelnamen en queryparameters. Dat maakt een
verband controleerbaar vanuit de eigen database. Verplaatsen, filteren,
selecteren en uitbreiden veranderen geen databasegegevens.

Technisch lopen alle kaartvragen via de bestaande leesverbinding. De
authenticatie, CSRF-controle voor POST, expliciete databasescope en
onderhoudsvergrendeling blijven gelden. De browser kan geen SQL of andere
databaseverbinding opgeven. Zie [API.md](API.md) voor het contract en
[ARCHITECTURE.md](ARCHITECTURE.md) voor de herbruikbare onderdelen.
