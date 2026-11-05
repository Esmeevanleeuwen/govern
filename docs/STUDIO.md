# Live whiteboard met Govern als databeheer

`/studio.php` is een afzonderlijke whiteboard-webapp binnen dezelfde installatie.
Je maakt whiteboards met notities, ideeën, verbindingen, penstreken en eenvoudige
schermkaarten voor wireframes. Govern blijft de beheeromgeving: **Live notities**
(`/workspace.php#studio`) volgt dezelfde opgeslagen kaarten en oorspronkelijke
transcripties. De gewone PostgreSQL-catalogus toont daarnaast de leesviews
`studio_boards`, `studio_notes` en `studio_transcripts`.

Dit is gedeelde toegang voor de goedgekeurde gebruikers van deze installatie.
Een whiteboard is geen privéproject of nieuwe tenant. De bestaande vrije
SQL-rechten blijven gelden; een API-filter is geen aanvullende database-isolatie.

## Inschakelen

Bewaar bestaande wachtwoorden en volumes. Voeg in je lokale `.env` toe:

```dotenv
PG_ENABLED=1
PG_SCHEMAS=public,brainstorm
STUDIO_ENABLED=1
STUDIO_SCHEMA=brainstorm
```

Behoud andere bestaande schema's in `PG_SCHEMAS`. Gebruik een afzonderlijk,
nieuw schema; het provisioningscript neemt geen bestaand gevuld schema over.

1. Start opnieuw met `sh start.sh` of `.\start.cmd`. Dat regelt de ontbrekende
   PostgreSQL-wachtwoorden en bestaande toepassingsrollen.
2. Voer op macOS/Linux `sh scripts/provision-studio.sh` uit. Op Windows gebruik je
   `.\scripts\provision-studio.cmd`.
3. Log in en open [Studio](http://localhost:8080/studio.php). Gebruik je een andere
   `APP_PORT`, pas dan het adres aan. Open hetzelfde whiteboard in een tweede
   browservenster om de synchronisatie te zien.

De migratie draait buiten webverzoeken met de bestaande private bootstraprol.
Zij maakt `_govern_studio_*`-tabellen, constraints en leesviews en verleent alleen
rechten binnen het gekozen schema. Herhalen bewaart bestaande gegevens en
de schemageneratie. Een onbekende migratieversie stopt de handeling.

## Live spreken

De eerste audioketen gebruikt een opnameknop in de webapp. De browser vraagt
microfoontoestemming en maakt zelfstandige PCM16-mono-WAV-fragmenten van ongeveer
zes seconden. Alleen de expliciet geconfigureerde transcriptieservice ontvangt
die audio. Elk afgerond, niet-leeg transcriptfragment maakt een nieuwe kaart;
stille fragmenten behouden alleen hun plaats in de tijdlijn.

Dit is verwerking in korte fragmenten, geen woord-voor-woord-stream. De totale
vertraging bestaat uit de fragmentduur, modelverwerking en het ophalen van de
whiteboardstatus, ongeveer iedere 1,5 seconde. De werkelijke snelheid hangt af
van het gekozen model en de computer.

Microfoonopname vereist een beveiligde browsercontext: localhost op dezelfde
computer of HTTPS op de iPhone. Houd de opnamepagina zichtbaar en de iPhone
ontgrendeld. Verbergen, fouten of een volle wachtrij stoppen de microfoon; een
mislukt fragment blijft tijdelijk in het open scherm beschikbaar om opnieuw
te versturen. Dit is geen offline-opslaggarantie. Sluit of herlaad het scherm
niet terwijl audio wacht op opnieuw proberen.

De Apple Dictafoon-app is geen live audiobron voor deze implementatie. Er is
ook geen opname op de achtergrond of tijdens schermvergrendeling gebouwd.

**Audio wordt tijdelijk verwerkt en niet als opnamearchief bewaard.** PostgreSQL
bewaart de transcriptie, opname-identiteit, fragmentvolgorde, tijdsgrenzen,
provider en checksum. De oorspronkelijke tekst blijft behouden wanneer je een
kaart bewerkt. Verwijderen en undo herstellen de bronkoppeling via een
serverbekende identiteit. Er is nog geen download van een volledige opname.

## Transcriptie lokaal aansluiten

Transcriptie staat standaard uit. Zonder dienst blijft het whiteboard bruikbaar
voor handmatige notities. Een ingeschakelde configuratie betekent nog niet dat
een model bereikbaar of geladen is; een fout wordt zichtbaar teruggegeven.

De optionele Compose-aanvulling gebruikt een lokale `faster-whisper`-dienst.
Installeer daarvoor zelf een **meertalig** faster-whisper-model in
`local/studio-model/`, met onder meer `model.bin`, configuratie en tokenizer.
Een `.en`-model is niet geschikt voor Nederlands. Een mogelijke begininstelling
is [Systran/faster-whisper-small](https://huggingface.co/Systran/faster-whisper-small).
Modelkeuze is geen garantie voor snelheid of herkenningskwaliteit.

Een expliciete, eenmalige download via Docker kan bijvoorbeeld zo:

```sh
mkdir -p local/studio-model
docker run --rm -v "$PWD/local/studio-model:/models" python:3.12-slim-bookworm sh -c 'python -m pip install --no-cache-dir huggingface_hub==0.36.0 && hf download Systran/faster-whisper-small --local-dir /models'
```

In PowerShell maak je de map met
`New-Item -ItemType Directory -Force local/studio-model` en gebruik je voor de
volumekoppeling `-v "${PWD}/local/studio-model:/models"`. Deze download maakt
bewust verbinding met PyPI en Hugging Face. De draaiende transcriptieservice
gebruikt daarna alleen de gemounte lokale modelbestanden, met Hugging Face en
Transformers in offline-modus; zij downloadt geen ontbrekend model.

Start de provider en app na de gewone installatie met:

```sh
docker compose --profile postgres -f compose.yaml -f compose.studio-transcription.yaml up -d --build --wait
```

De aanvulling zet de lokale provider aan op
`http://transcriber:8080/v1/audio/transcriptions`. De provider publiceert geen
hostpoort. Voor een bestaande Whisper-compatibele dienst kun je in plaats
daarvan `STUDIO_TRANSCRIPTION_ENABLED=1`, `STUDIO_TRANSCRIPTION_URL`,
`STUDIO_TRANSCRIPTION_MODEL` en eventueel `STUDIO_TRANSCRIPTION_API_KEY`
serverzijdig instellen. Een externe dienst vereist bovendien expliciet
`STUDIO_TRANSCRIPTION_ALLOW_REMOTE=1` en HTTPS. Er is geen cloudfallback.

## iPhone via optionele LAN-HTTPS-ingang

De gewone installatie blijft op loopback. De aanvullende
`compose.studio-lan.yaml` gebruikt Caddy en vraagt een eigen certificaat dat
door de iPhone wordt vertrouwd en past bij de gekozen LAN-host of het LAN-IP.
Plaats het certificaat in `local/studio-tls/cert.pem` en de private sleutel in
`local/studio-tls/key.pem`. Deze lokale bestanden horen niet in Git.

Stel bijvoorbeeld voor de computer op `192.168.1.20` in:

```dotenv
STUDIO_LAN_HOST=192.168.1.20
STUDIO_LAN_BIND=192.168.1.20
STUDIO_HTTPS_PORT=8443
APP_ALLOWED_HOSTS=localhost,127.0.0.1,::1,192.168.1.20
```

Kies het echte adres van jouw computer; de standaardbinding van de HTTPS-
aanvulling is ook loopback. Vertrouw de uitgevende CA op je iPhone volgens het
gebruikte certificaatbeheer en beperk een eventuele firewallregel tot je
vertrouwde lokale netwerk. Zet geen router-portforwarding aan.

```sh
docker compose --profile postgres -f compose.yaml -f compose.studio-transcription.yaml -f compose.studio-lan.yaml up -d --build --wait
```

Open dan `https://192.168.1.20:8443/studio.php` en log in. Dezelfde cookies,
Host-/Origin-controles en CSRF-grens blijven gelden. De LAN-ingang biedt geen
phpMyAdmin-route. PostgreSQL-poort 5432 wordt niet gepubliceerd. Gebruik bij
volgende starts dezelfde Compose-aanvullingen om die configuratie te behouden.

## Bewaren, conflicten en herstel

Iedere schrijfactie gebruikt de actuele schemageneratie. Canvasbewerkingen
gebruiken daarnaast een `base_revision` en unieke `operation_id`. Een herhaling
van dezelfde operatie krijgt dezelfde uitkomst; hetzelfde ID met andere inhoud
of een verouderde revisie geeft een conflict. De interface bewaart lokale
concepten voor beoordeling en overschrijft geen nieuwere servergegevens.

Een schemaherstel via de bestaande PostgreSQL-herstelvoorziening maakt de
fysieke tabellen opnieuw aan. Daardoor verandert de generatie en worden oude
open clients geweigerd, ook als het revisienummer uit de kopie gelijk is.
Herlaad na herstel voordat je verderwerkt. De bestaande onderhoudslock blijft
gelden. Zie [het API-contract](API.md#live-studio-whiteboards) voor verzoeken en
[PostgreSQL](POSTGRESQL.md) voor de algemene herstelgrenzen.

De geautomatiseerde ketentests gebruiken een afzonderlijke testdatabase en
een begrensde transcriptiefixture. Een echt taalmodel, herkenningskwaliteit,
fysieke iPhone/Safari, schermvergrendeling en Windows zijn daarmee niet getest.
De uitgevoerde controles en resterende grenzen staan in [VALIDATION.md](VALIDATION.md).
