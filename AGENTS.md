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
- Ondersteun meerdere werkdatabases met dezelfde catalogus en schermen.
  Applicatietabellen hebben prefix `_govern_` en horen bij hun eigen database.
- phpMyAdmin is de echte officiële toepassing achter dezelfde lokale oorsprong.
  Bouw geen gedeeltelijke imitatie die dezelfde naam of mogelijkheden claimt.
- De modal heeft Browse, Structure, SQL en Import als snelkeuzes, met de overige
  phpMyAdmin-bediening beschikbaar in het venster.

## Gegevens en toegang

- Waarden zijn gebonden parameters; dynamische identifiers komen uit de catalogus
  en worden correct gequote. Geen willekeurige identifiers uit een verzoek.
- De onderzoekverbinding heeft echte leesrechten in MariaDB. Een SQL-regex is
  geen vervanging voor databaserechten.
- De schrijfverbinding heeft rechten op toegestane werkdatabases, niet globaal.
- Stuur de database expliciet mee in iedere API-URL. Bewaar de keuze per
  browsertab, niet als veranderlijke serversessie. Ontbreekt de parameter, dan
  blijft `DB_NAME` de standaard voor bestaande links.
- De kiezer gebruikt de doorsnede van echt zichtbare databases voor schrijver
  en lezer, zonder systeemdatabases. Geconfigureerde ontbrekende databases
  blijven bereikbaar voor herstel. Kiezen verleent geen rechten.
- Alleen de opstartservice en de privéservice voor databaseaanmaak gebruiken
  root; de webapp en phpMyAdmin krijgen deze credentials nooit. Opstarten gebruikt
  `DB_DATABASES` en `DB_NAME`; de privéservice verwerkt alleen een expliciet
  gekozen, gevalideerde databasenaam via de lokale Unix-socket.
- Geef deze service geen vrije SQL, importinhoud, paden of algemene beheertaken.
  Maak ontbrekende databases aan en verleen alleen rechten per exacte naam.
  Geen globale grants; escape `_` in databasepatronen. Bestaande gegevens en
  accountwachtwoorden blijven behouden, ook bij herhalen na een gedeeltelijke fout.
- De beperkte eigen SQL-import (maximaal 256 KiB UTF-8) gebruikt dezelfde SQL-parser
  en uitvoerder als Onderzoeken. Bewaar geen SQL-bestanden, toon voor- en nacontrole,
  eis bevestiging van de exacte databasenaam en neem vooraf bij bestaande
  inhoudelijke tabellen/views een herstelpunt onder de exclusieve onderhoudslock.
  Een import is geen SQL-sandbox: `USE` kan andere reeds toegestane databases raken.
  Voor grotere bestanden blijft de echte phpMyAdmin-import beschikbaar. Beloof
  nooit een algemene rollback of sluitende inhoudelijke controle. Geef AI geen
  import- of databaseaanmaaktool.
- Gebruik voor direct wijzigen de volledige primaire sleutel of een volledige
  unieke sleutel zonder NULL-velden of prefixindex. Lees de echte rij opnieuw;
  verkorte browsewaarden zijn nooit een schrijfbron. Behoud exacte getallen,
  NULL, binaire waarden, berekende en niet-bewerkte grote velden.
- Houd database, tabel, sleutel en versie vast tijdens een rijhandeling.
  Controleer wijzigingen met een databasegebonden fingerprint en een atomische
  SQL-voorwaarde; een conflict mag geen nieuwere gegevens overschrijven.
- Houd berekende kolommen berekend; maak ze niet tot gewone invoervelden.
- Voer alle gewone app-verbindingen in UTC en de afgesproken strikte SQL-modus uit.
- Snapshotbestanden staan buiten de webroot. Credentials en dumps blijven uit Git.
- Een Docker-volume is opslag, geen backup. Herstel wordt getest met echte data.
- Beschrijf herstel eerlijk: DDL is niet transactioneel en SQL uit een ander
  phpMyAdmin-venster volgt niet automatisch onze applicatievergrendeling.
- Gebruik de gedeelde vergrendeling in `maintenance_dir`, buiten de afzonderlijke
  herstelpuntmappen. Vrije SQL kan met `USE` een andere toegestane database raken;
  herstel moet daarom gewone appverzoeken over alle databases uitsluiten.

## Uitleg en bediening

- Schrijf korte labels en foutmeldingen in Nederlands en Engels. Gebruik de
  gedeelde vertaalsleutels; vertaal geen identifiers, records of opgeslagen SQL.
- Volg `docs/DESIGN.md`: gedeelde glasmaterialen, zachte schaduwen en geen harde
  decoratieve randen. Nieuwe schermen gebruiken dezelfde componenten en tokens.
- Bewaar taal, uiterlijk en dashboardindeling onafhankelijk. Nieuwe blokken
  hebben vaste IDs; een update mag een bestaande indeling niet overschrijven.
- Een taal- of themawissel mag geen onderzoekconcept wissen of een actief
  phpMyAdmin-formulier herladen.
- Houd tabelkeuze, zoekvelden, onderzoeksconcepten en tijdelijke schermtoestand
  per database apart. Wisselen negeert oude antwoorden en behoudt de concepten
  bij terugkeren; een open rijeditor of lopende schrijfactie blokkeert wisselen.
- Leg de gebruikte SQL naast de handeling uit, zonder te doen alsof er een
  AI-verbinding bestaat als die niet is gebouwd.
- Zorg voor toetsenbordbediening, focusbeheer, bruikbare foutmeldingen en een
  werkende route terug wanneer de database verwijderd of onbereikbaar is.
- Contextexports bevatten standaard schema en opgeslagen queries, geen records
  of credentials. Wijzig deze inhoud niet ongemerkt.
- AI blijft optioneel en standaard uitgeschakeld. Toon de werkelijke provider-
  en modelstatus; geen demo-antwoorden of stille cloudfallback in productie.
- Bouw AI-context op uit de actuele catalogus van de expliciete database.
  Selectiemetadata uit de browser is een verzoek, geen vertrouwde bron. Voeg
  geen records, resultaten, opgeslagen onderzoeken of credentials automatisch toe.
- Projectcode leest alleen de servergestuurde lokale `app/`- en `docs/`-bronnen.
  Neem geen browserpaden over en verruim de brongrens niet stilzwijgend. Sla
  symlinks, geheime bestanden en niet-ondersteunde inhoud over. Geheimfiltering
  is best effort; claim geen volledige herkenning.
- Bouw projectbronnen per zoekvraag opnieuw op en behoud relatieve paden, echte
  regelnummers en snapshot-hashes. Lokale zoekacties blijven zonder model werken.
- Projectantwoorden vereisen bestaande bron-IDs en letterlijk gecontroleerde
  citaten. Zonder geldige bronnen geen gegenereerde uitleg of SQL-voorstel.
  Citaten bewijzen herkomst, niet de juistheid van alle gegenereerde uitspraken.
  De functie doorzoekt code; ze traint geen model of wist vooraf geleerde kennis.
- Houd AI-geschiedenis en concepten tijdelijk per database en brongebied apart; negeer late
  antwoorden na een wissel. Stoppen in de browser garandeert geen onmiddellijke
  stop van de modelberekening. Render antwoorden als tekst.
- AI mag SQL alleen als voorstel naar Onderzoeken sturen. Uitvoeren gebruikt
  de bestaande gebruikersstroom; geef het model geen vrije schrijfverbinding.
- Laat de onderhoudslock los nadat AI-context is opgebouwd en vóór het wachten
  op Ollama. Provideradres en model zijn serverconfiguratie, geen browserinvoer.
- Volg `docs/AI.md` bij nieuwe providers, leesfuncties, documentzoeken of blijvend
  bewaren. Houd modelkwaliteit en applicatie-integratietests uit elkaar.

## Controleren

Controleer een volledig pad: scherm → API → database → zichtbaar resultaat.
Bij wijzigingen aan herstelpunten ook wijzigen, herstellen en opnieuw uitlezen.
Bij de modal ook een echte phpMyAdmin-handeling uitvoeren, niet alleen controleren
of er een iframe bestaat. Gebruik uitsluitend de geïsoleerde testdatabase.

Volg `docs/API.md` of werk contract, backend en frontend gezamenlijk bij.
Vermeld eerlijk welke omgeving is uitgevoerd en welke controles niet konden lopen.
