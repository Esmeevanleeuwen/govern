# Vindbaarheid van governn.nl

## Publieke pagina

De officiële productpagina is `https://governn.nl/`. De HTML bevat de volledige
uitleg zonder dat JavaScript of een databaseverbinding nodig is. Titel en
beschrijving noemen databasebeheer, SQL en gegevens verkennen. De bestaande
taalkeuze werkt deze teksten bij in Nederlands en Engels.

- De canonical verwijst naar `https://governn.nl/`.
- `/index.php` en `/homepage.php` sturen GET/HEAD met status 301 naar `/`.
  Queryparameters en browserfragmenten blijven bruikbaar voor oude werkpleklinks.
- `/sitemap.xml` bevat alleen de officiële homepage, geen inlogpagina's,
  werkdatabases, fragmenten of verzonnen wijzigingsdatums.
- `/robots.txt` laat de homepage en assets toe en verwijst naar de sitemap.
  API- en phpMyAdmin-routes worden uitgesloten van crawlen. De accountpagina
  blijft crawlbaar zodat Google de bestaande `noindex` kan lezen.
- Authenticatie en de bestaande toegang tot databases blijven verantwoordelijk
  voor privacy. `robots.txt` en `noindex` vervangen die toegang niet.

Deze metadata beschrijven de officiële Govern-productwebsite, ook wanneer de
broncode lokaal wordt gestart. Publiceer je een eigen, anders genoemde publieke
productwebsite, pas dan de URL samen aan in `homepage.php`, `sitemap.xml` en
`robots.txt`. Interne navigatie en redirects blijven relatief aan de installatie;
een lokaal werkplekadres wordt niet naar de publieke website gestuurd.

## Publiceren en www

Een GitHub-commit of pull request publiceert niet vanzelf een nieuwe versie.
In deze repository is geen productie-deployworkflow vastgelegd. Werk de checkout
of image van de bestaande hosting bij, met behoud van de huidige configuratie
en volumes. Controleer welke branch de host werkelijk gebruikt: de onderzochte
live homepage verwees op 16 november 2026 naar `integrate/all-govern-updates`,
terwijl de repository standaard `main` gebruikt. Dat is een aanwijzing, geen
bewijs van de actieve deploymentbranch.

De live website stond tijdens de controle achter Caddy/Apache. De configuratie
van die publieke ingang en DNS staat niet in deze repository. De lokale
Compose-gateway blijft daarom ongewijzigd.

Voor `www.governn.nl` moet de hostingbeheerder:

1. DNS voor `www` naar de bestaande publieke ingang laten verwijzen; neem geen
   oud of gegokt server-IP over.
2. Een geldig TLS-certificaat voor `www.governn.nl` laten uitgeven.
3. Alle www-verzoeken permanent naar `https://governn.nl` laten verwijzen,
   met behoud van pad en query. Controleer eerst dat dit dezelfde installatie is.

Bij een zelf beheerde Caddy-configuratie kan het afzonderlijke www-siteblok
er zo uitzien, naast de bestaande configuratie voor het hoofddomein:

```caddyfile
www.governn.nl {
    redir https://governn.nl{uri} permanent
}
```

Vervang hiermee niet de huidige reverse-proxy- of authenticatieconfiguratie.
Bij beheerde hosting gebruik je de domein- en redirectinstellingen van die host.
De HTTPS-verbinding moet werken voordat een HTTP-redirect bereikt kan worden.

## Controle na publicatie

```sh
curl -I https://governn.nl/
curl -I 'https://governn.nl/index.php?database=bestuursatlas'
curl -I https://governn.nl/homepage.php
curl -I https://www.governn.nl/
curl -fsS https://governn.nl/robots.txt
curl -fsS https://governn.nl/sitemap.xml
```

Verwacht 200 voor de homepage, robots en sitemap; 301 voor de twee PHP-aliases.
De www-versie moet een permanente redirect naar het hoofddomein geven, geen
TLS-fout. Controleer de canonical in de ontvangen HTML en na taalwisselen.
Voeg in GitHub bij de repository onder **About → Website** ook
`https://governn.nl/` toe; de README bevat die link al.

## Google Search Console

Het gedeelde overzicht op 16 november 2026 toont één geïndexeerde pagina,
drie niet-geïndexeerde pagina's en nul zoekklikken. Het noemt niet welke URL
geïndexeerd is, waarom de andere URL's zijn uitgesloten, of hoeveel vertoningen
er waren. Nul klikken betekent niet dat de website niet in de index staat.

1. Inspecteer `https://governn.nl/` via **URL-inspectie**. Controleer de exacte
   indexstatus, laatste crawl, bereikbaarheid en de door Google gekozen canonical.
2. Gebruik na publicatie **Live URL testen** en vraag eenmaal indexering aan.
3. Dien onder **Sitemaps** `https://governn.nl/sitemap.xml` in, nadat deze live
   een geldig XML-bestand met status 200 teruggeeft.
4. Open bij **Pagina-indexering** de redenen voor de drie uitgesloten URL's.
   Een inlogpagina met `noindex` of een omgeleide alias hoort niet afzonderlijk
   in Google. Alleen gewenste publieke pagina's hebben herstel nodig.
5. Bekijk onder **Prestaties** ook vertoningen, zoekopdrachten en gemiddelde
   positie. Die maken onderscheid tussen weinig zichtbaarheid en weinig klikken.

Geen Core Web Vitals-data betekent hier dat er geen rapportgegevens zijn;
het bewijst geen snelheidsprobleem. Een sitemap, canonical of indexeringsverzoek
garandeert geen positie, bezoekers of opname. Nieuwe verwerking kan dagen tot
weken duren. Deze wijzigingen maken geen nieuwe Nederlandstalige URL's aan.

## Bronnen

- [Google: voorkeursadressen en duplicaten](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google: een sitemap maken en indienen](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google: opnieuw crawlen aanvragen](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)
- [Caddy: redir](https://caddyserver.com/docs/caddyfile/directives/redir)
