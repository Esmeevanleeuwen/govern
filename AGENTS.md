# Werken aan Govern

Govern is een persoonlijke, lokale databasewerkplek. De gebruiker wil tijdens
echte werkzaamheden leren en later gemakkelijk nieuwe mogelijkheden kunnen
toevoegen. Bestuursatlas is het eerste gegevensmodel, niet een vast ingebouwde
beperking van de werkplek.

## Ontwerp

- Lees tabellen, kolommen en relaties uit de actuele database. Geen aparte
  controller of gekopieerd formulier voor elke Bestuursatlas-tabel.
- Houd code in kleine, herbruikbare onderdelen met één duidelijke taak.
- Gebruik gewone SQL en duidelijke PHP/JavaScript. Voeg pas een afhankelijkheid
  of abstractielaag toe wanneer die een concrete taak eenvoudiger maakt.
- Er is één werkdatabase. Applicatietabellen hebben prefix `_govern_`.
- phpMyAdmin is de echte officiële toepassing achter dezelfde lokale oorsprong.
  Bouw geen gedeeltelijke imitatie die dezelfde naam of mogelijkheden claimt.
- De modal heeft Browse, Structure en SQL als snelkeuzes, met de overige
  phpMyAdmin-bediening beschikbaar in het venster.

## Gegevens en toegang

- Waarden zijn gebonden parameters; dynamische identifiers komen uit de catalogus
  en worden correct gequote. Geen willekeurige identifiers uit een verzoek.
- De onderzoekverbinding heeft echte leesrechten in MariaDB. Een SQL-regex is
  geen vervanging voor databaserechten.
- De schrijfverbinding heeft rechten op de geselecteerde database, niet globaal.
- Houd berekende kolommen berekend; maak ze niet tot gewone invoervelden.
- Voer alle gewone app-verbindingen in UTC en de afgesproken strikte SQL-modus uit.
- Snapshotbestanden staan buiten de webroot. Credentials en dumps blijven uit Git.
- Een Docker-volume is opslag, geen backup. Herstel wordt getest met echte data.
- Beschrijf herstel eerlijk: DDL is niet transactioneel en SQL uit een ander
  phpMyAdmin-venster volgt niet automatisch onze applicatievergrendeling.

## Uitleg en bediening

- Schrijf korte Nederlandse labels en foutmeldingen.
- Leg de gebruikte SQL naast de handeling uit, zonder te doen alsof er een
  AI-verbinding bestaat als die niet is gebouwd.
- Zorg voor toetsenbordbediening, focusbeheer, bruikbare foutmeldingen en een
  werkende route terug wanneer de database verwijderd of onbereikbaar is.
- Contextexports bevatten standaard schema en opgeslagen queries, geen records
  of credentials. Wijzig deze inhoud niet ongemerkt.

## Controleren

Controleer een volledig pad: scherm → API → database → zichtbaar resultaat.
Bij wijzigingen aan herstelpunten ook wijzigen, herstellen en opnieuw uitlezen.
Bij de modal ook een echte phpMyAdmin-handeling uitvoeren, niet alleen controleren
of er een iframe bestaat. Gebruik uitsluitend de geïsoleerde testdatabase.

Volg `docs/API.md` of werk contract, backend en frontend gezamenlijk bij.
Vermeld eerlijk welke omgeving is uitgevoerd en welke controles niet konden lopen.
