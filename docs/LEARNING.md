# Leren met je eigen gegevens

Werk telkens met één vraag en controleer het antwoord. Bewaar de query en schrijf
kort op wat de uitkomst betekent en welke beperking erbij hoort.

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
