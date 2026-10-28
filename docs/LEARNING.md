# Leren met je eigen gegevens

Werk telkens met één vraag en controleer het antwoord. Bewaar de query en schrijf
kort op wat de uitkomst betekent en welke beperking erbij hoort.

## Beginnen met de visuele bouwer

Open **Onderzoeken → Query samenstellen**. Je kiest de onderdelen van je vraag
en ziet daarna de SQL waarmee je die vraag kunt beantwoorden.

1. Kies de tabel `digital_systems`.
2. Selecteer de kolommen `code`, `name` en `lifecycle_status`.
3. Voeg een filter op `name` toe met de tekst `DigiD`.
4. Kies de gewenste sorteervolgorde en het aantal voorbeeldrijen.
5. Klik **Query maken** en lees de SQL en de uitleg.
6. Klik **Query uitvoeren**. Controleer of het resultaat bij je vraag past.
7. Bewaar de vraag met een naam en een korte notitie.

De onderdelen die je kiest, komen uit jouw actuele database. Je kunt dezelfde
stappen dus gebruiken voor een tabel die je zelf hebt gemaakt. Wanneer je
de SQL handmatig aanpast, voer je vanaf dat moment die eigen tekst uit. De bouwer
hoeft die tekst niet terug te vertalen naar aankruisvakjes.

### Twee tabellen verbinden

Kies `system_responsibilities` als basistabel en kies de bestaande verwijzing
naar `organizations`. Selecteer bijvoorbeeld `responsibility_role` uit de basis
en `name` uit de gekoppelde tabel. De bestaande foreign key bepaalt welke
velden de verbinding vormen; je hoeft die niet te raden.

Een `LEFT JOIN` kan ook een basisrij zonder overeenkomst in de gekoppelde tabel
tonen. Een `INNER JOIN` toont alleen overeenkomende rijen. Filters worden daarna
toegepast: een filter op de gekoppelde naam kan bij een `LEFT JOIN` alsnog de
rijen zonder overeenkomst weglaten. Bekijk de gegenereerde `ON`- en `WHERE`-
regels om dat verschil te begrijpen.

Bij een koppeling heten resultaatkolommen bijvoorbeeld `basis.name` en
`gekoppeld.name`. Zo blijven gelijknamige velden uit twee tabellen herkenbaar,
ook als een tabel naar zichzelf verwijst.

### Ontbrekende gegevens, lege tekst en zoektekens

`NULL` betekent dat een waarde ontbreekt. Een lege tekst (`''`) is wel een
waarde. Kies **Is NULL** voor ontbrekende waarden; laat bij een gewoon
vergelijkingsfilter het waardevak leeg om op lege tekst te zoeken.

Bij een tekstfilter zoekt de bouwer naar de ingevoerde tekst. De tekens `%` en
`_` zijn daarbij letterlijk bedoeld, ook al hebben ze in handgeschreven SQL
met `LIKE` normaal een bijzondere betekenis. De vergelijkingsregels van de
databasekolom bepalen onder meer of hoofdletters verschil maken.

De bouwer maakt overzichtelijke voorbeelden met maximaal 200 rijen. Voor
berekeningen, groeperingen of meer koppelingen kun je de gegenereerde SQL als
beginpunt gebruiken en zelf verder schrijven. De volledige SQL-editor van
phpMyAdmin blijft beschikbaar via het databasevenster.

## 1. Lezen en filteren

Open `digital_systems` en bekijk de kolommen. Voer bij Onderzoeken uit:

```sql
SELECT code, name, lifecycle_status
FROM digital_systems
ORDER BY name;
```

`SELECT` kiest de kolommen, `FROM` kiest de tabel en `ORDER BY` bepaalt de
volgorde. Dit verandert geen gegevens.

## 2. Een relatie volgen

```sql
SELECT o.name AS organisatie,
       s.name AS systeem,
       r.responsibility_role AS rol
FROM system_responsibilities AS r
JOIN organizations AS o ON o.id = r.organization_id
JOIN digital_systems AS s ON s.id = r.system_id
ORDER BY o.name, s.name;
```

De koppeltabel bewaart de rol van een organisatie bij een systeem. Eén organisatie
kan meerdere systemen hebben en één systeem kan meerdere betrokken organisaties
hebben. De twee `JOIN`-regels halen de leesbare namen op.

Dit is een overzicht van beschreven relaties. Het zegt zonder datum- en
broncontrole niet dat elke getoonde rol vandaag geldt. Bekijk `valid_from`,
`valid_until`, `notes` en `evidence_id` voordat je die conclusie trekt.

## 3. De bron vinden

```sql
SELECT e.statement, s.title, s.url,
       es.claim_locator, es.relation_kind
FROM evidence AS e
JOIN evidence_sources AS es ON es.evidence_id = e.id
JOIN sources AS s ON s.id = es.source_id
ORDER BY e.id, s.title;
```

Een bron kan een uitspraak ondersteunen, nuanceren of tegenspreken. Een URL
alleen is niet genoeg: de vindplaats legt vast welk stuk van de bron bedoeld is.

## 4. Iets veranderen en herstellen

Maak een herstelpunt. Open het databasevenster en pas één beschrijving aan.
Controleer de opgeslagen wijziging in Gegevens. Zet daarna het herstelpunt terug
en controleer dat de oorspronkelijke beschrijving terug is.

Ga daarna pas een structuurwijziging oefenen, zoals een nieuwe oefentabel maken.
Een structuurwijziging is een andere soort handeling dan een filter of een
wijziging van één record.

## 5. Een onderzoek herhaalbaar maken

Bewaar de query, een duidelijke naam en een korte notitie:

- Welke vraag beantwoordt dit?
- Welke tabellen en filters gebruik ik?
- Welke informatie ontbreekt nog?
- Op welke datum of periode slaat de conclusie?

Een opgeslagen query wordt opnieuw uitgevoerd op de huidige gegevens. Het is
geen bevroren onderzoeksresultaat. Gebruik een gegevens-export of herstelpunt
wanneer je de exacte invoer voor later wilt bewaren.

## Samen met ChatGPT

Gebruik Context exporteren voor het schema en de opgeslagen onderzoeken. Voeg je
vraag en eventueel een concrete foutmelding toe. Een export maakt het mogelijk
dezelfde structuur te bespreken; hij geeft ChatGPT geen live toegang tot jouw
lokale database.
